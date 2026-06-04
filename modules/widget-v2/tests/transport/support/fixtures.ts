/**
 * Loader for the on-wire JSONL fixtures under `tests/fixtures/wire/*.jsonl`.
 *
 * Each fixture is a real GameDeliveryService transcript: one complete JSON
 * envelope per `\n`-terminated line, exactly as the server emits over the
 * WebSocket (D-GRH-42). The loader returns the raw lines so a test can feed
 * them, byte-for-byte, into the real {@link WireDeserializer} →
 * {@link FrameDispatcher} pipeline — no line is hand-parsed or partially
 * stubbed here. Blank lines are preserved (the JSONL stream may carry blank
 * separators, and the read loop must tolerate them) but a trailing newline
 * does not produce a phantom empty entry.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WIRE_DIR = join(here, '..', '..', 'fixtures', 'wire');

/**
 * Read a `*.jsonl` fixture and return its lines in order. A single trailing
 * newline is stripped (it is line termination, not an extra blank frame);
 * interior blank lines are kept verbatim.
 */
export function loadWireFixture(name: string): string[] {
  const text = readFileSync(join(WIRE_DIR, name), 'utf8');
  const withoutTrailingNewline = text.replace(/\n$/, '');
  // Split on `\n` and strip any `\r` a CRLF checkout may have introduced, so
  // the lines match the server's LF framing byte-for-byte regardless of the
  // platform git checked the fixture out on.
  return withoutTrailingNewline.split('\n').map((line) => line.replace(/\r$/, ''));
}
