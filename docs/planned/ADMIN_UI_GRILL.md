# Admin UI Design — Grill Working Doc

**Status:** In progress as of 2026-05-12.
**Tracks:** The "Open Question: Admin UI Design" section at the bottom of `DYNAMIC_LAYOUT_DECISIONS_LOG.md`.
**Successor format:** Each surface area resolved in this grill graduates to a numbered `D-GRH-<N>` entry in the decisions log. This document is the working scratchpad; the decisions log is the source of truth for locked decisions.

---

## Locked cross-cutting decisions (will graduate to D-GRH-<N> entries)

### LCK-1 — AdminGatewayService is the single admin write surface

**Graduated 2026-05-13 to D-GRH-69.**

**Date:** 2026-05-12.

**Decision:** A new Go process named `AdminGatewayService` is the only HTTPS surface for admin writes against the CROWDAQ backend. It owns:

- Authentication and RBAC enforcement (model TBD — see priority queue).
- Per-endpoint input validation.
- Audit logging. Every admin mutation is appended to a single append-only audit stream.
- Multi-protocol downstream dispatch:
  - NATS publish for real-time messages that bypass the schedule (e.g., OverrideInjection on `bar.<bar_id>.control` per D-GRH-65, MessagingLane).
  - DB hot tier write for schedule, rule, and bar preference rows (D-GRH-41 admin injection path).
  - Temporal signal for workflow control plane (e.g., force-reprocess on `BarPlayerSchedulerService` singleton per D-GRH-66; manual recording request per D-GRH-35).

**Rejected alternatives:**

- **Scheduler-channeled.** Every admin write routes through `BarPlayerSchedulerService` signals. Forces the scheduler to handle message types it does not author (e.g., `OverrideInjection` is out-of-band per D-SCHEMA-08, not part of `ScheduleWindow` sequence). Architectural noise.
- **Per-subsystem REST surfaces.** Scheduler, GameDeliveryService, recording each expose their own admin endpoints. Scatters auth/RBAC across N services, multiplies audit log targets, multiplies attack surface.

**Process kind:** Go process, following the D-GRH-42 precedent for GameDeliveryService — real-time inbound REST is a different domain from durable workflow logic; Temporal is the wrong fit for an HTTPS gateway.

**Pins:** every API question below. All admin REST endpoints live in this one service.

---

## Operator-set priority queue (2026-05-12)

1. Schedule authoring — **GRADUATED 2026-05-13 to D-GRH-70.**
2. Rules authoring API — **GRADUATED 2026-05-13 to D-GRH-71.**
3. **Ad inventory management** — uploading creatives, `AdSlot` policy authoring (relates to D-GRH-55 phase-1 asset-id model).
4. **Auth/RBAC** — login, scopes, scope delegation. Pins all upstream endpoint auth.
5. **Temporal workflow visibility** — built-in Temporal Web UI vs custom admin views.
6. **Journal data access** — admin reporting against journaled events.
7. **Metrics + dashboards** — emission targets, dashboard hosting.

### Items deprioritized this session

- **Override injection admin path** (D-SCHEMA-08 / D-GRH-56). The scenarios that motivated treating this as highest-priority (emergency takeover, regulatory injection) did not match the real product. Revisit only if a concrete operator workflow surfaces.

### Items still in scope but not in priority queue

These will be picked up after the priority queue drains, or sooner if a priority-queue surface depends on them:

- MessagingLane authoring API (D-GRH-57: "central admin authors" — no API defined).
- Manual recording request mechanism (D-GRH-35 references it).
- Admin pause/resume for `BarPlayerSchedulerService` or recording workflows.
- **Open architectural gap:** recording-trigger path for `cover` rules at scopes broader than `bar` (graduating Surface 2 surfaced this). To be grilled separately. **— GRADUATED 2026-05-13 to D-GRH-72.**

---

## Grill log

### Surface 1 — Schedule authoring

**Date:** 2026-05-13.

**Decision:** Admin does not author the schedule from scratch. `BarPlayerSchedulerService` (D-GRH-40) auto-generates the `ScheduleWindow` from `BarPreferences` + rules + game catalog. Admin modifies that auto-generated output via two paths:

1. Slot-level pin (one-off edit): admin selects a row in the pre-computed `ScheduleWindow`, edits it directly, gateway writes it to the DB hot tier with `pinned: true`. Scheduler skips pinned rows during full-reprocess. Pinned rows expire when the `ScheduleWindow` rolls off the rolling 24-hour horizon — no explicit unpin or GC.
2. Rule edit (persistent): admin authors or modifies a rule (see Surface 2). Persistent across `ScheduleWindow` rolls.

**Locked sub-decisions:**

1. **Edit model.** Slot-level pin + rule edit. No CRUD on `PlannedState` / `ProgramSlot` / `AdSlot` rows as a from-scratch authoring API.
2. **Write paths split.** Slot pin → DB hot tier direct write (D-GRH-41 admin injection path). Rule edit → DB rules table write + Temporal signal to `BarPlayerSchedulerService` (D-GRH-66) → force full-reprocess of bars in rule scope.
3. **Validation.** Statically checkable constraints in `AdminGatewayService` (LCK-1 gateway): enums, FK integrity, dwell minima, transition catalog membership. Stateful cross-row checks (pinned-vs-pinned overlap, dwell math after surrounding rows shift) run defensively in the scheduler; failures log and skip.
4. **Horizon.** Existing rolling 24-hour `ScheduleWindow` for pinned slots (D-GRH-40). `FixtureList` 7-day lookahead (D-GRH-18) is unchanged. No new admin-side horizon cap.
5. **Concurrency + versioning.** Last-write-wins, audit log only. No `If-Match`/ETag, no rollback API, no version stamp in phase 1. Founding-trio admin scale + 24-hour pin expiry makes collision probability near zero. Defer ETag and rollback to phase 2.

**Dropped:** resource scope (per-bar vs shared `ProgramSlot`/`AdSlot`) — scheduler-internal implementation detail, not an admin-UI concern.

**Pins:** D-GRH-70.

**Next question to ask:** N/A — surface graduated.

**Status:** GRADUATED 2026-05-13 to D-GRH-70.

---

### Surface 2 — Rules Authoring API

**Date:** 2026-05-13.

**Decision:** Admin authoring is split into two entity classes, both written through `AdminGatewayService` (LCK-1): `BarPreferences` (per-bar static config) and `Rule` (conditional behavior with D-GRH-47 `{scope, condition, action}` shape).

**Locked sub-decisions:**

1. **Two-tier model.** `BarPreferences` (existing entity, D-GRH-36, D-GRH-60) carries identity-shaped attributes (theme, sports, leagues, region, timezone, business hours, local team list) plus new `state` and `city` fields. `Rule` (new entity) carries conditional behavior layered over those attributes.
2. **Scope enum (phase 1, closed).** `all`, `bar:{id}`, `region:{code}`, `state:{code}`, `city:{slug}`. PRD scope-hierarchy entries `country`, `bar_type`, `display_group`, `market_cluster`, `timezone`, `campaign_window`, `sport_profile`, `compliance_tier`, `hw_tier` deferred to phase 2.
3. **Actions closed enum.** `cover` (`{priority: must|normal|optional}`), `weight` (`{delta: int}`), `ad_window` (`{mode: blackout|force|freq_override, params: {...}}`). Other PRD-authoring actions deferred to phase 2.
4. **Conflict resolution.** Most-specific scope wins. Specificity order: `bar` > `city` > `state` > `region` > `all`. Per-action tiebreak at the same specificity: `weight` additive, `cover` and `ad_window` last-write-wins via `updated_at`.
5. **Condition predicates closed (AND-only).** `sport`, `league`, `team`, `game_id`, `day_of_week`, `time_range` (HH:MM bar-local TZ), `date_range` (ISO date). No OR/NOT phase 1 — author multiple rules.
6. **Lifecycle fields.** `rule_id` (UUID server-assigned), `name` (≤100 chars, audit-log readability), `enabled` (bool, default true; pause/resume without delete), `created_at`, `updated_at` (feeds last-write tiebreak), `created_by`. No `expires_at` (use `condition.date_range`), no `priority`, no `version`.
7. **No dry-run phase 1.** Workflow: author with `enabled: false`, read scheduler output for one bar, flip `enabled: true`. Force-reprocess makes loop seconds. Defer dry-run endpoint to phase 2.

**Surfaced architectural gap:** `cover` rules at scopes broader than `bar` (e.g., `all` "cover NFL") imply a service that maps coverage rules + fixture catalog → recording-workflow spawns. No locked decision identifies that service today. Candidates: extend `BarPlayerSchedulerService`, new singleton `GameRecordingPlannerService`, or trigger from `AdminGatewayService` on rule write. To be grilled separately.

**Pins:** D-GRH-71.

**Next question to ask:** N/A — surface graduated.

**Status:** GRADUATED 2026-05-13 to D-GRH-71.

---

## Decision-log graduation rules

When a surface in this document fully locks (every sub-decision has an operator-confirmed answer), the surface is rewritten as a `D-GRH-<N>` entry and appended to `DYNAMIC_LAYOUT_DECISIONS_LOG.md`. The corresponding bullet in the open question section there is then removed in the same edit. The grill log section in this document is retained as a history trail.

Partial decisions are not promoted to the decisions log — they stay in this document until the full surface locks.
