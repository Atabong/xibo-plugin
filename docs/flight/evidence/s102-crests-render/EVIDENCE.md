# S102 — Real team crests render in the fixtures ("COMING UP") catalog

**SPEC-CRWDQ-S11** · build marker `build:s102-fixtures-crests` · PASS

## The gap (confirmed on the live bar, before)

The AssetManifest was delivered + applied (`asset_manifest_applied version:"am-a8d861f769fea268" total:17` = 16 team crests + 1 ad creative; crest bytes serve HTTP 200), but the fixtures "COMING UP" template rendered each team as **text + a generic sport chip** and emitted **no crest `<img>`** — the 16 delivered crests were unused. `single_game` and `multiple_games` already rendered real crests via the existing `CrestResolver`; **only the fixtures template never called it.**

Live pod (before deploy):

```
build marker:        build:s87-heartbeat-configpush
cdq-team-crest refs: 0          # no crest slot in the fixtures card at all
module sha256:       52ce450061b2d982e293e4c0b2e929a1dca52544fd59c95a042d6a65b74272de
```

## The fix

Wired the bootstrap-owned `CrestResolver` (the SAME instance single_game / multiple_games use) through to the fixtures card path, and render each team's crest by display name (`teamNameKey` → manifest `kind:'crest'` entry → bytes).

**Templates changed:**
- `FixtureCardSet.ts` — each team slot now renders a `.cdq-team-crest` (real-crest `<img>` on a `crestResolver.crestUrlForTeam(name)` hit; colour-block **monogram fallback** on a miss). Subscribes to `onCrestReady` so a cold crest swaps the real logo in over the monogram when its bytes warm (no new FixtureList needed). Team name moved to a `.cdq-team-name` sub-span so the crest sits cleanly inline.
- `FixturesTemplate.ts` / `FixturesAdapter.ts` — thread optional `crestResolver` into the mount context + card set.
- `FixturesWithAdsTemplate.ts` / `WithAdsAdapter.ts` — pass `crestResolver` through to the composite's fixtures child (so `fixtures_with_ads` gets crests too).
- `bootstrap.ts` — pass `crestResolver` to the `fixtures`, `fixtures_with_live_game`, and `fixtures_with_ads` adapter registrations. Bumped `BUILD_MARKER` → `build:s102-fixtures-crests`.
- `broadcast.css` (deployed sheet) + `fixtures.css` (base sheet) — crest sizing/placement inline with the team name, monogram block styling.

**`single_game` / `multiple_games` were already wired** (S11/S12); verified — no change needed. The grid (`CardSet`) already renders real crests via `crestResolver?.crestUrlForTeam(name)`.

## Crest resolution

Backend AssetManifest publishes one `kind:'crest'` entry per team, `ref = teamNameKey(displayName)` (`name.trim().toLowerCase().replace(/\s+/g,' ')`). The card asks `CrestResolver.crestUrlForTeam(team.homeTeam / .awayTeam)`:
1. normalise the display name → name_key,
2. look up the crest manifest entry whose `ref` === name_key → its `asset_id`,
3. read the warmed bytes from `AssetManifestStore` and paint `<img src>`.
A miss (no entry, or bytes not yet warm) → colour-block monogram + one best-effort warm-fetch; `onCrestReady` repaints when the bytes arrive. Never a broken image, never a fabricated crest.

## Tests

`FixtureCardSet.test.ts` extended with 4 crest tests (warm hit → distinct `<img>` per team; missing team → monogram fallback; cold get → monogram then swap-in on warm; no resolver → name-only). Support helpers `makeCrestManifest` / `warmCrest` added.

```
FixtureCardSet.test.ts: 19 passed (15 original + 4 new)
typecheck (tsc --noEmit): clean (exit 0)
full suite: 96 files, 664 tests passed
```

(A single flake in the unrelated `tests/render/crest-resolver.test.ts` — a `setTimeout(0)` timing race under heavy full-suite load — passes in isolation both before and after this change; not caused by it.)

## On-screen result (headless e2e against the built bundle + assembled broadcast.css)

`tests/e2e/s102-fixtures-crests-proof.mjs` boots the real bundle against the mock crowdaq WS server in `fixtures` mode and screenshots before (no crest assets) vs after (crest assets), with DOM assertions:

| | cards | real crest `<img>` | monogram fallback | `data-has-crest` | DOM imgCount |
|---|---|---|---|---|---|
| **before** (no crest assets) | 3 | **0** | 6 | 0 | **0** |
| **after** (crest assets) | 3 | **6** | 0 | **6** | **6** |

- `before.png` — "COMING UP" with colour-block monogram squares (the graceful fallback; the original deployed gap showed only text + generic chip — `0` crest slots).
- `after.png` — "COMING UP" with **real, distinct per-team club crests**: DORTMUND (yellow BVB), LEIPZIG (red RBL), BARCELONA (blue FCB), SEVILLA (red SEV), JUVENTUS (black JUV), NAPOLI (blue NAP). Each card shows two distinct logos next to the team names.

**DOM imgCount jumped 0 → 6** (one crest `<img>` per team across the 3 cards). Quote from the run: `PASS — fixtures real crests render: imgCount 0 -> 6, 6 per-team crest <img>s`.

## Build / deploy

```
bundle sha256:    96fba9c40c420b2192c6df0bb38cb1e58f50092ff1d776b7e6d2fac097761cc5
packaged XML:     build/crowdaq-widget-v2.packaged.xml (244767 bytes), sha7 0db4000
build marker:     build:s102-fixtures-crests  (in bundle + packaged XML, verified)
```

Deployed durably via the Flux-managed CMS module (`xibo` repo `infra/k8s/apps/cms/custom-modules/crowdaq-widget-v2.xml`, `configMapGenerator` single-file subPath).

## Deploy + durability proof (live cluster)

PRs merged to main: **xibo-plugin#112** (`afcdd7c`) + **xibo#98** (`c370c41`).

Flux reconcile pulled `main@sha1:c370c41` and applied the CMS kustomization. The `configMapGenerator` content-hash suffix changed `…-d8ht2b2m95` → `…-d5dgm2cch5`, mutating the Deployment pod template and forcing a Recreate rollout (`deployment "xibo-cms" successfully rolled out`). The old ConfigMap was pruned by Flux.

Running pod after reconcile (`xibo-cms-5bfcc8499b-z72bw`):
```
build marker:        build:s102-fixtures-crests
cdq-team-crest refs: 6
crestUrlForTeam:     1
module sha256:       0db4000cf9cd20ca00523558be1b105214ff35574205fac26dac7060834126c2
```

**Hard pod-delete durability check** — `kubectl delete pod xibo-cms-5bfcc8499b-z72bw`; the replacement pod (`xibo-cms-5bfcc8499b-zpjzt`) serves the **identical** module:
```
build marker:        build:s102-fixtures-crests
cdq-team-crest refs: 6
module sha256:       0db4000cf9cd20ca00523558be1b105214ff35574205fac26dac7060834126c2   (UNCHANGED)
```
The module survives a hard pod-delete with sha unchanged → genuinely Flux/git-managed (configMap subPath), not a transient `kubectl cp`.

## Before → after summary

- **Before:** live module `build:s87-heartbeat-configpush`, `0` `cdq-team-crest` refs — fixtures cards rendered team text + a generic sport chip, no crest `<img>`; the 16 delivered AssetManifest crests were unused.
- **After:** live module `build:s102-fixtures-crests`, `6` `cdq-team-crest` refs; the fixtures catalog renders a **real per-team crest `<img>`** for each team (graceful monogram fallback on a miss). Headless proof: DOM imgCount **0 → 6**, 6 distinct per-team crests on screen.

**PASS — real team crests render on the bar.**
