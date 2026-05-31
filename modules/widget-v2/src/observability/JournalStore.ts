/**
 * SPEC-CRWDQ-061 — the player-side journal store (AC1, AC2).
 *
 * An append-only, monotonically-sequenced log persisted to IndexedDB. The
 * database is namespaced PER DISPLAY — `crowdaq.widgetV2.journal.<display_id>`
 * (AC2) — so two displays sharing one browser origin keep independent,
 * monotonic-per-display `seq` lines and never collide on `seq=1`. The store is
 * the single durable surface the rest of observability builds on:
 *  - `append` assigns the next per-display `seq`, stamps the bound identity,
 *    persists the row, and returns the assigned seq (AC1);
 *  - `seq` is monotonic and survives reloads — `ready()` bootstraps the counter
 *    from the highest stored seq so a fresh store over an existing database
 *    continues rather than restarting at 1 (AC2);
 *  - `unsynced` / `markSent` give the {@link JournalSyncClient} a backlog view
 *    and a way to retire a sent contiguous range without an ACK frame (AC7).
 *
 * IndexedDB is the one substituted boundary (INV-FACTORY-17): the store opens
 * the real `indexedDB` global (a `fake-indexeddb` engine under test). A
 * synchronous in-memory mirror of the unsynced rows backs `unsynced()` so the
 * sync loop can read the backlog without an async hop; the mirror is rebuilt
 * from IndexedDB on bootstrap, so it always reflects durable state.
 */
import type { JournalAppend, JournalEntry, JournalIdentity } from './types';

/** Per-display DB name prefix; the bound `display_id` is appended (AC2). */
const DB_NAME_PREFIX = 'crowdaq.widgetV2.journal';
const STORE = 'entries';
const DB_VERSION = 1;

/** The IndexedDB database name for a given display, namespaced per display. */
export function journalDbName(displayId: string): string {
  return `${DB_NAME_PREFIX}.${displayId}`;
}

/** A persisted row carries the journal entry plus its sync state. */
interface StoredRow extends JournalEntry {
  /** True once the row has been handed to an open socket (AC7). */
  sent: boolean;
}

export class JournalStore {
  private readonly identity: JournalIdentity;
  /** Per-display database name, derived from the bound identity (AC2). */
  private readonly dbName: string;
  private db: IDBDatabase | null = null;
  private readyPromise: Promise<void> | null = null;
  /** Highest assigned seq; bootstrapped from durable state in `ready()`. */
  private highestSeq = 0;
  /** Synchronous mirror of unsynced rows, keyed by seq, in insertion order. */
  private readonly pending = new Map<number, JournalEntry>();
  /**
   * Synchronous mirror of SENT rows (their `ts`), keyed by seq in seq order.
   * This is the prunable set (AC1): retention only ever touches rows already
   * handed to the socket. Rebuilt from durable state on bootstrap and kept in
   * step with `markSent` / `prune`.
   */
  private readonly sent = new Map<number, string>();

  constructor(identity: JournalIdentity) {
    this.identity = identity;
    this.dbName = journalDbName(identity.displayId);
  }

  /**
   * Open the database and bootstrap the seq counter + unsynced mirror from
   * durable state. Idempotent: concurrent / repeated calls share one open.
   */
  ready(): Promise<void> {
    if (this.readyPromise === null) {
      this.readyPromise = this.open();
    }
    return this.readyPromise;
  }

  /**
   * Append an entry: assign the next monotonic seq, stamp the bound identity,
   * persist, and return the assigned seq (AC1). The seq is reserved
   * synchronously before the durable write so concurrent appends never collide
   * on a number even while their writes are in flight.
   */
  async append(entry: JournalAppend): Promise<number> {
    await this.ready();
    const seq = ++this.highestSeq;
    const row: StoredRow = {
      seq,
      ts: entry.ts,
      bar_id: this.identity.barId,
      display_id: this.identity.displayId,
      event_type: entry.event_type,
      payload: entry.payload,
      sent: false,
    };
    this.pending.set(seq, this.toEntry(row));
    try {
      await this.put(row);
    } catch (err) {
      // The durable write failed — drop the phantom row from the unsynced
      // mirror so it never appears in a batch, and surface the failure to the
      // caller (the emit adapter swallows it; a direct caller can react).
      this.pending.delete(seq);
      throw err;
    }
    return seq;
  }

  /**
   * The next slice of unsynced rows in seq order, capped at `maxRows`. Read
   * synchronously from the in-memory mirror so the sync loop's tick is not an
   * async cascade.
   */
  unsynced(opts: { maxRows: number }): JournalEntry[] {
    const rows: JournalEntry[] = [];
    for (const entry of this.pending.values()) {
      if (rows.length >= opts.maxRows) break;
      rows.push(entry);
    }
    return rows;
  }

  /** Count of rows not yet handed to the socket. */
  unsyncedCount(): number {
    return this.pending.size;
  }

  /**
   * Retire a contiguous sent range [seqMin, seqMax]. "Sent" is fire-and-forget
   * (AC7): there is no server ACK — handing the frame to an open socket is the
   * commit point, so the rows are dropped from the unsynced mirror and flagged
   * `sent` durably. Idempotent over an already-retired range.
   */
  async markSent(seqMin: number, seqMax: number): Promise<void> {
    await this.ready();
    const retired: StoredRow[] = [];
    for (let seq = seqMin; seq <= seqMax; seq += 1) {
      const entry = this.pending.get(seq);
      if (entry === undefined) continue;
      this.pending.delete(seq);
      retired.push({ ...entry, sent: true });
    }
    for (const row of retired) {
      await this.put(row);
      this.sent.set(row.seq, row.ts);
    }
  }

  /** Seqs of rows already sent (and not yet pruned), in seq order. */
  sentSeqs(): number[] {
    return [...this.sent.keys()].sort((a, b) => a - b);
  }

  /**
   * Apply retention to the SENT set (AC1). Prunes sent rows that are either
   * older than `maxAgeMs` (relative to `now`, defaulting to wall-clock) OR
   * beyond the newest `maxRows` by seq order. UNSYNCED rows are never touched —
   * the unsynced backlog is uncapped per D-GRH-29. Returns the prune count.
   *
   * The two caps compose: a row is pruned if it fails EITHER bound, so the
   * surviving set is the newest `maxRows` rows that are also within `maxAgeMs`.
   */
  async prune(opts: { maxRows: number; maxAgeMs: number; now?: number }): Promise<{ pruned: number }> {
    // The prunable set is the synchronous `sent` mirror, kept in step with
    // `markSent`/`bootstrap`. Decide which rows fail a cap WITHOUT touching
    // IndexedDB so the common no-op case (nothing over the caps) returns without
    // opening a connection or even an `await this.ready()` hop — the sync loop's
    // success tail calls prune on every send and must stay cheap.
    const now = opts.now ?? Date.now();
    const seqsNewestFirst = [...this.sent.keys()].sort((a, b) => b - a);

    const doomed: number[] = [];
    seqsNewestFirst.forEach((seq, indexFromNewest) => {
      const overRowCap = indexFromNewest >= opts.maxRows;
      const ts = this.sent.get(seq)!;
      const ageMs = now - Date.parse(ts);
      const overAgeCap = Number.isFinite(ageMs) && ageMs > opts.maxAgeMs;
      if (overRowCap || overAgeCap) doomed.push(seq);
    });

    if (doomed.length === 0) return { pruned: 0 };

    await this.ready();
    await this.deleteMany(doomed);
    for (const seq of doomed) this.sent.delete(seq);
    return { pruned: doomed.length };
  }

  /**
   * Release the IndexedDB connection (lets a delete/upgrade proceed) and reset
   * the in-memory mirror + seq counter. Without the reset, a re-`ready()` on
   * the same instance would `bootstrap()` ON TOP of stale `pending`/`highestSeq`
   * — double-counting rows and advancing `seq` past the durable max. Resetting
   * here means a re-open rebuilds purely from durable state.
   */
  close(): void {
    this.db?.close();
    this.db = null;
    this.readyPromise = null;
    this.highestSeq = 0;
    this.pending.clear();
    this.sent.clear();
  }

  // --- IndexedDB plumbing ----------------------------------------------------

  private open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'seq' });
        }
      };
      req.onerror = () => reject(req.error ?? new Error('journal db open failed'));
      req.onsuccess = () => {
        this.db = req.result;
        this.bootstrap().then(resolve, reject);
      };
    });
  }

  /**
   * Replay durable rows: set `highestSeq` to the max stored seq (AC2) and
   * rebuild the unsynced mirror from rows still flagged unsent.
   */
  private bootstrap(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cursor = this.tx('readonly').openCursor();
      cursor.onerror = () => reject(cursor.error ?? new Error('journal bootstrap failed'));
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c === null) {
          resolve();
          return;
        }
        const row = c.value as StoredRow;
        if (row.seq > this.highestSeq) this.highestSeq = row.seq;
        if (row.sent) this.sent.set(row.seq, row.ts);
        else this.pending.set(row.seq, this.toEntry(row));
        c.continue();
      };
    });
  }

  private put(row: StoredRow): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const req = this.tx('readwrite').put(row);
      req.onerror = () => reject(req.error ?? new Error('journal put failed'));
      req.onsuccess = () => resolve();
    });
  }

  /**
   * Delete several rows in ONE readwrite transaction. A single transaction (vs.
   * one per seq) drains atomically and promptly, so a `close()` racing the
   * prune tail never strands an in-flight per-row transaction holding the
   * connection open (which would block the next `deleteDatabase`).
   */
  private deleteMany(seqs: readonly number[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const store = this.tx('readwrite');
      for (const seq of seqs) store.delete(seq);
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () =>
        reject(store.transaction.error ?? new Error('journal prune delete failed'));
      store.transaction.onabort = () =>
        reject(store.transaction.error ?? new Error('journal prune delete aborted'));
    });
  }

  private tx(mode: IDBTransactionMode): IDBObjectStore {
    if (this.db === null) throw new Error('journal store not ready');
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  /** Strip the durable-only `sent` flag for the public {@link JournalEntry}. */
  private toEntry(row: StoredRow): JournalEntry {
    return {
      seq: row.seq,
      ts: row.ts,
      bar_id: row.bar_id,
      display_id: row.display_id,
      event_type: row.event_type,
      payload: row.payload,
    };
  }
}
