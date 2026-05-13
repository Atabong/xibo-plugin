# CROWDAQ Dynamic Layout Decisions Log

Last updated: 2026-05-08

> Status: **planned / decision log for target architecture**.
>
> This document records planning decisions for the future dynamic layout/orchestration platform. It is not the implementation truth for the current Phase-1 SSE widget.
>
> See `../index.md` for the documentation map.

## Purpose

This file records decisions and Q&A from the layout-state planning interview for the future dynamic CROWDAQ/Xibo layout system.

It exists to preserve:

- confirmed decisions
- current working assumptions
- open questions
- the reasoning trail behind the layout-state model

Related doc:

- `docs/planned/DYNAMIC_LAYOUT_REQUIREMENTS.md`

## Current Confirmed Decisions

### Planning scope

- This is a planning/documentation track, not an implementation track.
- The current focus is layout states.

### Official v1 business modes

The current official v1 business-mode list is:

1. `single game`
2. `multiple games`
3. `fixtures`
4. `single game with ads`
5. `multiple games with ads`
6. `fixtures with ads`
7. `fixtures with live game`
8. `fixtures with live game and ads`

### Recap / highlights / analysis

- `recent game summary / highlights / analysis` is not a separate business mode in v1.
- It should be treated as content that can appear inside or between existing modes.

### Mode philosophy

- The system uses fixed named modes.
- Dynamic behavior lives inside those modes, especially around excitement, badges, and emphasis.
- Animated transitions are wanted between all modes and all other modes.

### State selection drivers

Primary state selection drivers are:

- scheduled programming rules
- excitement / importance
- manual overrides

Automatic-mode priority:

- scheduled programming rules first
- then content conditions

Schedule break behavior:

- automatic mode may break schedule
- but only when strong thresholds are crossed

### Whole-screen scope

- Layout state applies to the whole bar screen, not just one region.

### Live / fixtures relationship

- The system needs a `fixtures + live game` view.
- After a game ends, the screen may move to:
  - fixtures only
  - fixtures plus recent-game summary/highlights/analysis

For the official v1 business modes:

- `fixtures with live game` is a real business mode
- `fixtures with live game and ads` is a real business mode

### Multi-game quantity

- The product should support up to 4 visible games.
- The number of visible games may vary.
- `2-game`, `3-game`, and `4-game` are not separate business modes.
- They are layout variants within `multiple games`.

### Ads

- Ads are temporary insertions, not permanently reserved space.
- `single game with ads`, `multiple games with ads`, and `fixtures with ads` remain distinct business modes.
- Ad presence needs multiple ad classes, not a single binary ad/not-ad model.
- Ad classes should be defined now because layout-state behavior depends on them.

### Single-game mode behavior

- `single game` and `single game with ads` are distinct business modes.
- Plain `single game` can still include supporting non-ad content such as fixtures or summary.
- In plain `single game`, the supporting non-ad content can compete fairly strongly with the game for attention.

### Fixtures mode behavior

- `fixtures` and `fixtures with ads` are distinct business modes.
- Plain `fixtures` may include light supporting context such as:
  - standings
  - tournament info
  - brief recap text

### Hierarchy decisions

#### `fixtures with live game`

Default hierarchy:

1. fixtures
2. live game

#### `fixtures with live game and ads`

Default hierarchy:

1. fixtures
2. live game
3. ads

#### `multiple games with ads`

- This is intentionally a split-attention mode.
- Ads can take strong space and are not merely supporting decoration.

#### `multiple games`

- Visual hierarchy depends on excitement / importance at that moment.

#### `fixtures with ads`

- This is also intended to be more split-attention, not just fixtures with a minor supporting ad.

### Geometry / template model

- A single business mode may have multiple geometry templates before themes are applied.
- Template choice should be driven by both:
  - schedule/programming rules
  - content conditions
- All v1 templates are eligible for automatic selection.
- Automatic template switching within the same business mode is allowed.

#### Minimum geometry-template counts by mode family

- `single game`
  - multiple templates in v1
  - minimum: 3
  - both the game panel and supporting panel may change character significantly
- `single game with ads`
  - separate geometry family from `single game`
  - minimum: 3
- `fixtures`
  - multiple templates in v1
  - minimum: 3
  - mostly list/layout variation
  - include at least one more editorial/showcase-oriented template
- `fixtures with ads`
  - separate geometry family from `fixtures`
  - minimum: 3
- `multiple games`
  - multiple templates in v1
  - minimum: 3
  - include at least:
    - one balanced/even template
    - one hero-led template
- `multiple games with ads`
  - separate geometry family from `multiple games`
  - minimum: 3
- `fixtures with live game`
  - multiple templates in v1
  - minimum: 3
  - fixtures-led by default
  - at least one template may elevate the live game much more strongly
- `fixtures with live game and ads`
  - separate geometry family from `fixtures with live game`
  - minimum: 3

#### Ad-led requirement

- Across all four `with ads` business-mode families, at least one template in each family should be clearly ad-led.

#### Automatic in-mode template switching

- Automatic template switching within the same business mode should be gated.
- Minimum dwell time matters more than thresholds for in-mode template switching.
- The same basic dwell-time philosophy should apply across all business modes.
- `with ads` modes should be allowed to switch templates less often than non-ad modes because ad presentation needs more predictability.
- In-mode template switches may fully recompose; they do not need to preserve anchored identity.
- Ad-driven reasons alone may trigger a template switch.
- Schedule/programming rules may force an in-mode template switch even when content conditions are relatively stable.
- In `with ads` modes, ad-timing rules may override the usual minimum dwell time if an ad insertion window opens.
- That ad-preemption behavior should be broad rather than narrow.
- The same broad ad-preemption philosophy may also apply in non-ad business modes if the system decides to move into an ad mode.

#### Dwell and interrupt policy

- Business-mode changes should generally have longer minimum dwell times than in-mode template switches.
- Almost nothing should break business-mode dwell immediately.
- Interstitial ad beats should only break normal mode dwell immediately if the schedule block explicitly calls for it.
- Major live sports moments may break business-mode dwell immediately.
- A post-game recap layer may be bypassed only if another event is truly exceptional.
- Whether a major sports moment is strong enough to break dwell should be determined by an equal blend of:
  - backend/game-intelligence signals
  - schedule/programming context
- A manual timed lock is stronger than major sports moment interrupts and should hold no matter what.

#### Interrupt classes

Current direction for v1 is a small explicit interrupt-class model.

Working base set:

1. `ordinary change`
2. `scheduled change`
3. `enter ad-window`
4. `exit ad-window`
5. `major sports moment`
6. `exceptional override`
7. `enter post-game recap layer`
8. `exit post-game recap layer`

Interpretation:

- `ordinary change`
  - reactive executions and lifecycle returns
  - examples:
    - end of game
    - error recovery
    - end of major sports moment
    - end of ad-window
    - return from temporary layer
- `scheduled change`
  - a deliberate programmed transition into another planned presentation state
  - examples:
    - moving into another game block
    - moving into fixtures block
    - moving into another scheduled presentation state
- `enter ad-window`
  - entering a dedicated ad timing window
- `exit ad-window`
  - exiting that ad window and determining what should come next
- `enter post-game recap layer`
  - entering the reusable post-game transition layer
- `exit post-game recap layer`
  - exiting that layer and determining the next state through fresh evaluation

#### Automatic precedence stack

Current working automatic precedence order:

1. `exceptional override`
2. `enter ad-window`
3. `major sports moment`
4. `scheduled change`
5. `enter post-game recap layer`
6. `ordinary change`

Special handling:

- `exit ad-window`
  - excluded from the ranked stack
  - hands control back to the normal precedence evaluation
- `exit post-game recap layer`
  - excluded from the ranked stack
  - hands control back to the normal precedence evaluation

#### Exceptional override boundaries

- `exceptional override` should represent a very small explicit set of cases, not a broad catch-all.
- Forced full-screen ad requirements should remain normal ad-window behavior with override metadata, not `exceptional override`.
- `exceptional override` is primarily for:
  - sports/programming emergencies
  - truly rare system-level cases
  - serious system/error recovery situations
  - bar-operator emergency takeover style manual commands
- A truly huge sports event should still remain `major sports moment`, not `exceptional override`.
- `exceptional override` should include only failure/emergency/operator/compliance cases, not normal content events.
- A backend outage or feed corruption severe enough to make the current mode unreliable should count as `exceptional override`.
- Even a single-game feed failure may count as `exceptional override` rather than a normal `ordinary change` fallback.
- Operator emergency takeover should be strictly manual and explicit.
- `exceptional override` may also include regulatory/compliance style cases injected by a trusted control source.
- `exceptional override` does not always have to force one single template.
- It may choose among a small safe subset.
- That safe subset should be defined as cross-mode safe templates rather than per-business-mode subsets.
- Exceptional override should default to zero sponsor/ad presence unless explicitly permitted.

#### Ad-window merge behavior

- If an ad window opens and a scheduled change is also due, the system should merge them by selecting the scheduled content state's `with ads` counterpart when possible.
- Example:
  - scheduled change says move into fixtures
  - ad window is active
  - result should normally be `fixtures with ads`
- This merge behavior should happen unless the ad carries override metadata requiring something more specific, such as:
  - a required template
  - a special ad-led template
  - a full-screen treatment
- That special requirement should not be a separate interrupt class or separate ad class in v1.
- It should be modeled as metadata on normal ad-window behavior.

#### Ordinary ad-mode entry behavior

- When an ad window opens and no scheduled change is due, the default behavior should be:
  - convert the current mode into its matching `with ads` mode if one exists
- Example:
  - `fixtures` -> `fixtures with ads`
  - `single game` -> `single game with ads`
- If the current mode does not have a clean matching `with ads` counterpart:
  - use ad metadata to decide whether to fall back or skip
- When fallback is needed, honoring the ad's preferred presentation matters more than preserving current content context.
- Ordinary changes should not directly enter ad modes.
- Ad modes should only be entered via scheduled/ad-window logic.
- `ordinary change` is mainly a reactive / cleanup mechanism and should not usually outrank `scheduled change`.
- `exit post-game recap layer` should hand control back to the normal precedence stack, same as `exit ad-window`.

### Continuity between modes

- Whether a transition preserves continuity or does a full re-composition depends on the specific mode pair.

### Manual override model

The operator-control model should support:

- automatic
- timed lock
- soft override

Default normal behavior:

- automatic

Manual-override detail:

- operator should eventually be able to choose exact geometry templates later
- for now, business-mode control is the immediate focus

### Post-game behavior

- After a live game ends, the system should always show a short post-game result/recap beat first before settling into the next longer state.
- The post-game beat is a reusable transition layer, not a business mode.
- The post-game layer should use a mostly shared structure across the system.
- In v1 it should be a richer recap card containing:
  - final score
  - winner
  - highlights
  - analysis
  - and possibly upcoming-fixture or next-match context
- Typical dwell time should be longer:
  - about 20-40 seconds
- Ads should be blocked entirely while the post-game recap layer is active.
- After the post-game layer finishes, the system should re-evaluate conditions fresh instead of simply returning to the prior scheduled mode.

### Ad classes

For v1, ad classes should be defined by visual footprint / on-screen role first.

Current minimum v1 ad taxonomy:

1. `ambient branding`
2. `competitive in-layout ad unit`
3. `interstitial ad beat`

Interpretation:

- `ambient branding`
  - small sponsor bug / logo / presented-by mark / branded frame treatment
  - does not change the business mode
- `competitive in-layout ad unit`
  - a strong ad unit that meaningfully competes with sports content
  - triggers the `with ads` business modes
- `interstitial ad beat`
  - an ad beat that happens between content states
  - sits outside the business-mode system

## Interview Log

### Q&A captured so far

`Q1`
Question:
For v1, should the official mode list be just the six business modes, with recap/highlights treated as content inside a mode rather than as its own named mode?

Answer:
- `a`

Interpretation:
- Yes, keep recap/highlights as content inside existing modes.

`Q2`
Question:
For `multiple games`, should the number of visible games be treated as a variation inside that one mode rather than as separate named modes?

Answer:
- `b`

Clarified later:
- not separate business modes
- but not merely trivial variations either
- final interpretation currently: strong layout variants within `multiple games`

`Q3`
Question:
Should `single game` and `single game with ads` remain two distinct business modes because ad presence materially changes programming and attention strategy?

Answer:
- `a`

`Q4`
Question:
Should `fixtures` and `fixtures with ads` remain distinct business modes?

Answer:
- `a`

`Q5`
Question:
Should `multiple games` and `multiple games with ads` remain distinct business modes?

Answer:
- `a`

`Q6`
Question:
Should recap/highlights stay out of the official mode list and be treated as content inside other modes?

Answer:
- `a`

`Q7`
Question:
How should `2-game`, `3-game`, and `4-game` be treated under `multiple games`?

Answer:
- `c`

Interpretation:
- strong layout variants, but not truly separate states at the business-mode level

`Q8`
Question:
For `single game`, when there are no ads, should there still be room for secondary non-game content such as fixtures or summary text?

Answer:
- `b`

`Q9`
Question:
What should make the system switch from `single game` to `single game with ads`?

Answer:
- `c`

Interpretation:
- ad classification matters
- not all ad presence should be treated equally

`Q10`
Question:
How should ad presence be classified?

Answer:
- `c`

Interpretation:
- multiple ad classes are needed

`Q11`
Question:
Should those ad classes be defined now?

Answer:
- `a`

`Q12`
Question:
Should `fixtures with live game` exist as a mode?

User clarification:
- `fixtures with live game should be a mode, fixtures with live game and ads also`

`Q13`
Question:
Should `fixtures with live game` and `fixtures with live game and ads` be official v1 business modes?

Answer:
- `a`

`Q14`
Question:
In `fixtures with live game`, which side should be conceptually dominant by default?

Answer:
- `a`

Interpretation:
- fixtures primary, live game supporting

`Q15`
Question:
In `fixtures with live game and ads`, what is the default hierarchy?

Answer:
- `a`

Interpretation:
- fixtures primary, live game secondary, ads tertiary

`Q16`
Question:
For `multiple games with ads`, what should be the default hierarchy?

Answer:
- `b`

Interpretation:
- live games and ads can compete more evenly

`Q17`
Question:
For plain `multiple games` with no ads, what should be the default hierarchy?

Answer:
- `c`

Interpretation:
- depends on excitement / importance

`Q18`
Question:
For plain `single game`, what should be the default hierarchy when there is supporting non-ad content like fixtures or summary?

Answer:
- `b`

Interpretation:
- supporting panel can compete fairly strongly with the game

`Q19`
Question:
For plain `fixtures`, what should the secondary content be allowed to include by default?

Answer:
- `b`

Interpretation:
- fixtures can include light supporting context

`Q20`
Question:
For `fixtures with ads`, should fixtures remain clearly primary, or should this also be a more split-attention mode?

Answer:
- `b`

Interpretation:
- more split-attention

`Q21`
Question:
Should the system always preserve continuity between old and new states, or are full re-compositions acceptable?

Answer:
- `c`

Interpretation:
- depends on the mode pair

`Q22`
Question:
Should every business mode have one default layout geometry, or multiple geometry templates?

Answer:
- `b`

`Q23`
Question:
What should choose between geometry templates?

Answer:
- `c`

Interpretation:
- both schedule/programming rules and content conditions

`Q24`
Question:
Should an operator eventually be able to choose the exact geometry template too?

Answer:
- `c`

Interpretation:
- business mode now, geometry template selection later

`Q25`
Question:
How should manual override behave?

Answer:
- `b and c`

Interpretation:
- support both timed lock and soft override

`Q26`
Question:
Which override behavior should be default in normal use?

Answer:
- `a`

Interpretation:
- automatic is default

`Q27`
Question:
In automatic mode, what should have the highest authority for choosing mode?

Answer:
- `a`

Interpretation:
- scheduled programming rules first, then content conditions

`Q28`
Question:
When schedule and live content conflict, may automatic mode break schedule?

Answer:
- `b`

Interpretation:
- yes, but only if strong thresholds are crossed

`Q29`
Question:
What should happen right after a live game ends?

Answer:
- `b`

Interpretation:
- always show a short post-game result/recap beat first

`Q30`
Question:
Should the short post-game result/recap beat be part of the current business-mode family, or a reusable transition layer?

Answer:
- `b`

Interpretation:
- reusable transition layer

`Q31`
Question:
Should that reusable post-game transition layer always look structurally similar, or inherit more from the outgoing mode?

Answer:
- `a`

Interpretation:
- mostly one shared post-game structure across the system

`Q32`
Question:
What should the reusable post-game layer contain by default in v1?

Answer:
- `c`

Interpretation:
- richer recap card

`Q33`
Question:
How long should the post-game layer normally stay on screen?

Answer:
- `c`

Interpretation:
- about 20-40 seconds

`Q34`
Question:
Should the post-game layer block ads during its dwell time?

Answer:
- `a`

Interpretation:
- block ads entirely while post-game recap is active

`Q35`
Question:
After the post-game layer finishes, should the system return to schedule or re-evaluate fresh?

Answer:
- `b`

Interpretation:
- re-evaluate all conditions fresh

`Q36`
Question:
For v1, should ad classes be defined around visual footprint or business meaning?

Answer:
- `a`

Interpretation:
- visual footprint first

`Q37`
Question:
Should the smallest ad class be so minor that it does not change the business mode at all?

Answer:
- `a`

Interpretation:
- yes, smallest ad class should not change mode

`Q38`
Question:
What should the next ad class up represent?

Answer:
- `b`

Interpretation:
- strong in-layout ad unit that meaningfully competes with sports content

`Q39`
Question:
Do you also want a separate v1 ad class for interstitial-style ad beats that happen between content states?

Answer:
- `a` / `yes`

Interpretation:
- yes

`Q40`
Question:
Should we assume at least these three visual ad classes in v1?

Answer:
- `a` / `yes`

Interpretation:
- yes:
  - ambient branding
  - competitive in-layout ad unit
  - interstitial ad beat

`Q41`
Question:
Should the `with ads` business modes be triggered only by the `competitive in-layout ad unit`, while `ambient branding` does not change mode and `interstitial ad beat` sits outside the mode system?

Answer:
- `a` / `yes`

Interpretation:
- yes

`Q42`
Question:
Should `single game` have more than one geometry template in v1?

Answer:
- `a`

Interpretation:
- yes

`Q43`
Question:
Minimum number of `single game` geometry templates in v1?

Answer:
- `b`

Interpretation:
- 3

`Q44`
Question:
For `single game`, should the difference mainly be support-panel placement, or can the game panel itself also change character a lot?

Answer:
- `b`

Interpretation:
- both game panel and support panel can change significantly

`Q45`
Question:
Should `single game with ads` reuse `single game` geometry family, or have its own?

Answer:
- `b`

Interpretation:
- separate geometry family

`Q46`
Question:
Should `fixtures` have multiple geometry templates in v1?

Answer:
- `a`

Interpretation:
- yes

`Q47`
Question:
Minimum number of `fixtures` geometry templates in v1?

Answer:
- `b`

Interpretation:
- 3

`Q48`
Question:
For `fixtures`, should templates mainly vary by list arrangement/support placement, or become more editorial/showcase-oriented?

Answer:
- `a and b`

Interpretation:
- mostly list/layout variation
- include at least one editorial/showcase-oriented template

`Q49`
Question:
Should `fixtures with ads` reuse `fixtures` geometry family, or have its own?

Answer:
- `b`

Interpretation:
- separate geometry family

`Q50`
Question:
Should `multiple games` have multiple geometry templates in v1?

Answer:
- `a`

Interpretation:
- yes

`Q51`
Question:
Minimum number of `multiple games` geometry templates in v1?

Answer:
- `b`

Interpretation:
- 3

`Q52`
Question:
Should `multiple games` include both balanced/even and hero-led templates?

Answer:
- `a`

Interpretation:
- yes

`Q53`
Question:
Should `multiple games with ads` have its own separate geometry family?

Answer:
- `a`

Interpretation:
- yes

`Q54`
Question:
Should `fixtures with live game` have multiple geometry templates in v1?

Answer:
- `a`

Interpretation:
- yes

`Q55`
Question:
Minimum number of `fixtures with live game` geometry templates in v1?

Answer:
- `b`

Interpretation:
- 3

`Q56`
Question:
Should all `fixtures with live game` templates stay fixtures-led, or may one elevate the live game much more strongly?

Answer:
- `b`

Interpretation:
- allow one stronger live-game-elevating template

`Q57`
Question:
Should `fixtures with live game and ads` get its own separate geometry family?

Answer:
- `a`

Interpretation:
- yes

`Q58`
Question:
Minimum number of `single game with ads` geometry templates in v1?

Answer:
- `b`

Interpretation:
- 3

`Q59`
Question:
Minimum number of `fixtures with ads` geometry templates in v1?

Answer:
- `b`

Interpretation:
- 3

`Q60`
Question:
Minimum number of `multiple games with ads` geometry templates in v1?

Answer:
- `b`

Interpretation:
- 3

`Q61`
Question:
Minimum number of `fixtures with live game and ads` geometry templates in v1?

Answer:
- `b`

Interpretation:
- 3

`Q62`
Question:
Across all four `with ads` mode families, should at least one template in each family be clearly ad-led?

Answer:
- `a`

Interpretation:
- yes

`Q63`
Question:
Should all v1 geometry templates be eligible for automatic selection, or should some be manual-only?

Answer:
- `a`

Interpretation:
- all can be auto-selected

`Q64`
Question:
When staying in the same business mode, may the system still change geometry template automatically?

Answer:
- `a`

Interpretation:
- yes

`Q65`
Question:
Should in-mode automatic template switching be gated to avoid churn?

Answer:
- `a`

Interpretation:
- yes, gated by thresholds and minimum dwell times

`Q66`
Question:
Which matters more for in-mode template switching: thresholds or minimum dwell time?

Answer:
- `b`

Interpretation:
- minimum dwell time matters more

`Q67`
Question:
Should every business mode use the same minimum dwell-time philosophy for in-mode template switching?

Answer:
- `a`

Interpretation:
- same basic dwell philosophy across all modes

`Q68`
Question:
Should `with ads` modes be allowed to switch templates less often than non-ad modes?

Answer:
- `a`

Interpretation:
- yes

`Q69`
Question:
When a template switch happens within the same mode, should templates preserve anchored identity or can they fully recompose?

Answer:
- `b`

Interpretation:
- full re-composition is fine within a mode

`Q70`
Question:
For automatic in-mode template switching, should ad-driven reasons be allowed to trigger a switch by themselves?

Answer:
- `a`

Interpretation:
- yes

`Q71`
Question:
Should schedule/programming rules be allowed to force an in-mode template switch even when content conditions are stable?

Answer:
- `a`

Interpretation:
- yes

`Q72`
Question:
When in a `with ads` mode, should ad-timing rules be allowed to override the usual minimum dwell time if an ad insertion window opens?

Answer:
- `a`

Interpretation:
- yes

`Q73`
Question:
Should that ad-preemption override be narrow or broad?

Answer:
- `b`

Interpretation:
- broad

`Q74`
Question:
Should the same broad ad-preemption philosophy apply in non-ad business modes too, if the system decides to move into an ad mode?

Answer:
- `a`

Interpretation:
- yes

`Q75`
Question:
Should business-mode changes have a longer minimum dwell time than in-mode template switches?

Answer:
- `a`

Interpretation:
- yes

`Q76`
Question:
When a mode change is triggered by major live content or ad pressure, should true high-priority events be able to break dwell immediately?

Answer:
- `b`

Interpretation:
- almost nothing should break dwell immediately

`Q77`
Question:
Should interstitial ad beats count as one of those rare exceptions that can break normal dwell immediately?

Answer:
- `c`

Interpretation:
- only if the schedule block explicitly calls for it

`Q78`
Question:
For live sports urgency, should a truly major game moment be able to break mode dwell immediately?

Answer:
- `a`

Interpretation:
- yes

`Q79`
Question:
Should a major moment elsewhere be allowed to bypass the post-game recap layer?

Answer:
- `c`

Interpretation:
- only if the other event is truly exceptional

`Q80`
Question:
Should “major sports moments” be decided mainly by backend/game signals or equally by backend and schedule context?

Answer:
- `b`

Interpretation:
- equal blend of backend/game-intelligence signals and schedule/programming context

`Q81`
Question:
Should a manual timed lock be stronger than major sports moment interrupts?

Answer:
- `a`

Interpretation:
- yes, timed lock should hold no matter what

`Q82`
Question:
Do you want us to define a small explicit set of interrupt classes now for automatic mode changes?

Answer:
- `a`

Interpretation:
- yes

`Q83`
Question:
For v1, should we keep the interrupt-class set to exactly these five unless we discover a clear gap?

Answer:
- `a`

Interpretation:
- yes, start small

`Q84`
Question:
Should `scheduled change` and `ordinary change` be treated as meaningfully different classes?

Answer:
- freeform clarification from user

Interpretation:
- yes, they are meaningfully different
- `ordinary change` is for reactive executions / lifecycle changes
- `scheduled change` is for programmed transitions into another planned state

`Q85`
Question:
Should `enter ad-window` and `exit ad-window` be two separate interrupt classes, or one single class with direction metadata?

Answer:
- `a`

Interpretation:
- two separate classes

`Q86`
Question:
Should `enter post-game recap layer` and `exit post-game recap layer` also be treated as separate interrupt classes?

Answer:
- `a` / `yes`

Interpretation:
- yes

`Q87`
Question:
When two interrupt classes conflict at the same time, do you want an explicit precedence order in v1?

Answer:
- `a`

Interpretation:
- yes

`Q88`
Question:
Should `major sports moment` outrank `scheduled change` in automatic mode?

Answer:
- `a`

Interpretation:
- yes

`Q89`
Question:
Should `major sports moment` also outrank `enter ad-window` in automatic mode?

Answer:
- `b`

Interpretation:
- no
- `enter ad-window` outranks `major sports moment`

`Q90`
Question:
Should `enter ad-window` also outrank `scheduled change` in automatic mode?

Answer:
- `a`

Interpretation:
- yes

`Q91`
Question:
When an ad window ends, should `exit ad-window` hand control back to normal precedence, or temporarily outrank normal scheduled changes?

Answer:
- `a`

Interpretation:
- hand control back to normal precedence

Additional user clarification:
- if a scheduled change is due when the ad window opens, the system should merge the scheduled target with ad presence by choosing the scheduled target's `with ads` version
- unless ad metadata requires a specific template or stronger override treatment

`Q92`
Question:
Should those special ad requirements be treated as a separate ad subtype in v1?

Answer:
- `b`

Interpretation:
- no
- treat as metadata on normal ad-window behavior

`Q93`
Question:
When an ad window opens and no scheduled change is due, what should the default behavior be?

Answer:
- `a`

Interpretation:
- convert the current mode into its matching `with ads` mode if one exists

`Q94`
Question:
If the current mode does not have a clean matching `with ads` counterpart, what should the system do?

Answer:
- `c`

Interpretation:
- use ad metadata to decide between fallback and skip

`Q95`
Question:
Should fallback to the closest compatible ad-capable mode be based mainly on preserving current content context, or mainly on honoring ad presentation?

Answer:
- `b`

Interpretation:
- honor ad presentation preference first

`Q96`
Question:
For ordinary changes, should they ever directly create a mode transition into an ad mode?

Answer:
- `b`

Interpretation:
- no
- ad modes should only be entered by scheduled or ad-window logic

`Q97`
Question:
Should `ordinary change` ever outrank a `scheduled change`, or is it mainly a cleanup/return mechanism?

Answer:
- `b`

Interpretation:
- mainly reactive/cleanup
- does not usually outrank scheduled change

`Q98`
Question:
Should `exit post-game recap layer` behave the same way as `exit ad-window` and simply hand control back to the normal precedence stack?

Answer:
- `a`

Interpretation:
- yes

`Q99`
Question:
Should the current top of the precedence stack be `enter ad-window` above `major sports moment`, above `scheduled change`, above `ordinary change`?

Answer:
- `a`

Interpretation:
- yes

`Q100`
Question:
Should `exceptional override` sit above `enter ad-window` at the very top of automatic precedence?

Answer:
- `a`

Interpretation:
- yes

`Q101`
Question:
Should `enter post-game recap layer` sit below `scheduled change`?

Answer:
- `a`

Interpretation:
- yes

`Q102`
Question:
Should `ordinary change` remain below `enter post-game recap layer` in the stack?

Answer:
- `a`

Interpretation:
- yes

`Q103`
Question:
Should `exit ad-window` and `exit post-game recap layer` be excluded from the normal ranked stack entirely?

Answer:
- `a`

Interpretation:
- yes

`Q104`
Question:
Should `exceptional override` mean a very small, explicit set of cases only?

Answer:
- `a`

Interpretation:
- yes

`Q105`
Question:
For v1, should a forced full-screen ad requirement count as `exceptional override`, or stay under normal ad-window behavior as special ad metadata?

Answer:
- `b`

Interpretation:
- normal ad-window behavior with override metadata

`Q106`
Question:
Should `exceptional override` be reserved mainly for sports/programming emergencies and truly rare system-level cases, not for normal ad behavior?

Answer:
- `a`

Interpretation:
- yes

`Q107`
Question:
Should a serious system/error recovery situation be allowed to count as `exceptional override`, or should errors stay under `ordinary change`?

Answer:
- `a`

Interpretation:
- serious system/error recovery can be `exceptional override`

`Q108`
Question:
Should a “bar operator emergency takeover” style manual command also count as `exceptional override`, or should manual actions stay outside this automatic precedence model entirely?

Answer:
- `a`

Interpretation:
- count it as `exceptional override`

`Q109`
Question:
Should a truly huge sports event across the bar's configured priority set count as `exceptional override`, or should it remain `major sports moment`?

Answer:
- `b`

Interpretation:
- remain `major sports moment`

`Q110`
Question:
Should `exceptional override` include only failure/emergency/operator cases, rather than normal content events?

Answer:
- `a`

Interpretation:
- yes

`Q111`
Question:
Should a backend outage or feed corruption severe enough to make the current mode unreliable count as `exceptional override`?

Answer:
- `a`

Interpretation:
- yes

`Q112`
Question:
Should a single-game feed failure that still leaves other usable content available count as `exceptional override`, or just an `ordinary change` into a safer mode?

Answer:
- `a`

Interpretation:
- `exceptional override`

`Q113`
Question:
Should “operator emergency takeover” be strictly manual and explicit, or can the system infer it?

Answer:
- `a`

Interpretation:
- strictly manual and explicit

`Q114`
Question:
Should `exceptional override` also include regulatory/compliance style cases, like “do not show ads now” or “force safe fallback layout now,” if injected by a trusted control source?

Answer:
- `a`

Interpretation:
- yes

`Q115`
Question:
Should `exceptional override` always force a known-safe geometry/template, or can it sometimes still choose among multiple templates?

Answer:
- `b`

Interpretation:
- it can choose among a small safe subset

`Q116`
Question:
Should that safe subset be defined per business mode, or should `exceptional override` have its own cross-mode safe templates?

Answer:
- `b`

Interpretation:
- cross-mode safe templates

`Q117`
Question:
For v1, should we define a small fixed set of cross-mode safe templates now?

Answer:
- `a`

Interpretation:
- yes

`Q118`
Question:
For v1, do you want both `safe info layout` and `safe message/fallback layout` as separate cross-mode safe templates?

Answer:
- `a`

Interpretation:
- yes

Clarification:
- `safe info layout`
  - graceful degraded programming
  - still looks like a real programmed screen
  - may show usable content
- `safe message/fallback layout`
  - explicit fallback / notice state
  - message-first
  - used when the system needs to explain interruption, outage, or degraded operation

`Q119`
Question:
Should `safe fixtures layout` also be a separate cross-mode safe template in v1?

Answer:
- `a`

Interpretation:
- yes

Clarification:
- `safe fixtures layout` is valuable because fixtures can be downloaded and cached
- it is a resilience-oriented fallback, not just a design variation

`Q120`
Question:
Should `safe info + sponsor branding` be allowed during some exceptional-override situations, or should exceptional override default to zero sponsor/ad presence unless explicitly permitted?

Answer:
- `b`

Interpretation:
- default to no sponsor/ad presence in exceptional override

### Additional architecture clarifications from user

#### Schedule synchronization and caching

- Schedules for the next 24 hours should be downloaded to the bar player.
- Schedule updates should be pushed when the schedule changes.
- A schedule-hash heartbeat should also be sent every 5 minutes.
- Each bar player should compare the pushed/polled hash with its current hash.
- If the hash differs, the player should download the updated schedule as soon as possible.
- If a schedule changes on the backend:
  - a new hash should be computed immediately
  - that new hash should be pushed to bar players immediately so they can react
- The 5-minute hash pulses are a recovery/synchronization mechanism for players that missed the initial push and later reconnect.

#### Offline schedule / ad / journaling behavior

- The 24-hour schedule cache should be authoritative enough for the player to keep running fixtures-led modes when the backend is temporarily unreachable.
- If the backend is unreachable but the 24-hour schedule cache is valid, the player may still enter `fixtures with ads` as long as the relevant ad rules/assets are already available locally.
- Ads should be downloaded as soon as they are available.
- Progress through the schedule should be journaled locally on the player.
- Journal/progress state should be pushed back to the server on a heartbeat.
- When the server is unavailable:
  - the player should track the last successfully synced journal row locally
  - sync should resume from the last successful synced row once connectivity returns
- The local journal should include both:
  - schedule progression / state transitions
  - ad playback / progression events
- Ad playback / progression journaling should use coarse milestones, such as:
  - ad scheduled
  - ad started
  - ad completed
  - ad skipped / failed
- Mode/state journaling should be more granular, including UI/state-transition events rather than only coarse milestones.
- That granular mode/state journal should still be persisted locally in v1, even if not every fine-grained event is immediately sent upstream.
- The player should retain the full granular journal locally.
- Heartbeat sync should send the full journal in compressed/batched form.
- When connectivity returns, the player should backfill all unsynced journal rows.
- The player should not depend on local AI summarization to collapse or compress historical journal content.
- Journal rows should be append-only and immutable once written.
- Sync acknowledgement state should be tracked separately.
- Each journal row should carry a monotonic local sequence number so resume-from-last-ack is deterministic across reconnects.
- Schedule-cache updates themselves should also be journaled locally.
- Ad-asset download and availability changes should also be journaled locally.
- Unsynced journal rows must survive player restart.
- Acknowledged rows may be pruned automatically, but the player should retain a rolling local history window after acknowledgement.
- That retained-history policy should be bounded by both time and size.
- Retained acknowledged local history should target:
  - 7 days
  - 250 MB
- The 250 MB cap applies to acknowledged retained history, not to unsynced rows.
- If unsynced rows grow beyond that because the backend is unavailable, the player must still preserve them.
- Very large unsynced backlog growth should surface as an operational-health condition.
- That operational-health condition should also be reported upstream once sync returns.
- When connectivity returns:
  - current schedule/ad/control freshness should be prioritized first
  - backlog sync should resume in the background
- backlog sync may be throttled automatically so presentation responsiveness and fresh control updates remain smooth

#### Cross-mode safe template selection

- The first implementation set of cross-mode safe templates is exactly:
  - `safe info layout`
  - `safe fixtures layout`
  - `safe message/fallback layout`
- `safe fixtures layout` should be the preferred safe template whenever cached fixtures are valid.
- If cached fixtures are not valid or not sufficient, the next preferred safe template should be `safe info layout`.
- `safe message/fallback layout` should be reserved mainly for cases where the system needs to explicitly communicate degraded operation or interruption.
- `safe info layout` may include neutral operational context such as:
  - current date/time
  - venue identity
  - next scheduled block
  - tournament label
- `safe fixtures layout` should show cached schedule-based content only.
- Detailed motion/visual-behavior decisions for safe templates are deferred for later; current focus remains on state-selection logic.

#### Automatic mode-selection rules (working)

- If there is exactly one live game and valid future fixtures:
  - consult the schedule block first
  - if the schedule does not define otherwise, default to `fixtures with live game`
  - fixture emphasis should depend on market and sport relevance
- If there are multiple live games and valid fixtures:
  - the system should normally prefer a multi-game family
  - unless the schedule explicitly says otherwise
- If multiple live games exist but only one is in the configured bar priority set:
  - the system may still behave more like a single-focus live presentation with fixtures support
- If no live games are active but valid fixtures exist:
  - default automatic mode is `fixtures`
  - unless schedule or ad rules say otherwise
- If no live games are active and fixtures are unavailable or invalid:
  - go to `safe info layout` before `safe message/fallback layout`
- If multiple live games exist, the system should not remain fixtures-led just because they are low-priority/low-interest.
- If exactly one live game exists, it may still default to `fixtures with live game` instead of `single game` when:
  - schedule does not force another choice
  - valid fixtures exist
- If exactly one live game exists and there are no valid fixtures:
  - default to `single game`

#### Server-side orchestration model

- Schedule should be built server side.
- Transitions from screen to screen should be orchestrated by the backend.
- The bar player should not be the primary mode-selection engine during normal connected operation.
- The bar player should mainly:
  - execute the delivered presentation plan
  - transition automatically in and out of safe mode based on errors/connectivity
- Schedule is not primarily a high-level intent system.
- Schedule is primarily about server-side selection priority of game content.
- Presentation rules should drive the visual changes when specific content is being highlighted.
- High-profile content such as the Super Bowl or World Cup may drive special presentation behavior.
- If specific content is selected, admin should be able to select the layout if possible.
- If admin does not explicitly select a layout, the system should choose a default based on the highlighting/targeting context, including multi-game situations.
- Schedule should support rules like “local team” so those priorities can be resolved server side and delivered to the player.
- For each planned screen state, the backend should send:
  - exact business mode
  - exact selected content
  - exact layout/template
- The player should execute that exact plan when possible.
- If the requested layout/template is not available on disk, the player should choose the next best fit locally.
- That local “next best fit” logic should come from general local rules, not a server-provided fallback list and not per-state fallback metadata.
- Missing-template fallback order should be:
  1. try another template in the same business mode
  2. if none is available, go to a cross-mode safe template rather than a neighboring business mode
- This local fallback path should apply not only to missing assets/templates, but also to local execution/render failures.

`Q121`
Question:
Should the player treat the 24-hour schedule cache as authoritative enough to keep running fixtures-led modes even if the backend becomes temporarily unreachable?

Answer:
- `a`

Interpretation:
- yes

`Q122`
Question:
If the backend is unreachable but the 24-hour schedule cache is valid, should the player also be allowed to enter `fixtures with ads` using cached schedule data plus already-available ad rules/assets?

Answer:
- `a` / `yes`

Interpretation:
- yes

Additional user clarification:
- ads should be downloaded as soon as they are available
- progress through the schedule should be journaled locally
- journal/progress should be pushed to the server on a heartbeat
- when the server is unavailable, the last successfully synced row should be tracked locally and sync should resume from there

`Q123`
Question:
For the local journal, should it record just schedule progression/state transitions, or also ad playback/progression events?

Answer:
- `b`

Interpretation:
- both

`Q124`
Question:
For ad playback/progression in the local journal, should we record only coarse milestones, or detailed impression-level events?

Answer:
- `a`

Interpretation:
- coarse milestones only

`Q125`
Question:
For mode/state journaling, do you want coarse milestones or more granular UI events?

Answer:
- `b`

Interpretation:
- more granular UI events

`Q126`
Question:
Should that more granular UI journaling be persisted locally even if we do not send every fine-grained event to the server immediately?

Answer:
- `a`

Interpretation:
- yes

`Q127`
Question:
Should the server heartbeat sync receive the full granular journal, or should the player summarize/compress it before syncing?

Answer:
- `a but compressed`

Interpretation:
- send the full journal
- but in compressed/batched form

`Q128`
Question:
When connectivity returns after downtime, should the player try to backfill all unsynced journal rows, or be allowed to collapse older granular rows into summaries before upload?

Answer:
- `a`

Interpretation:
- backfill all unsynced rows

Additional user clarification:
- there will not be local AI available at the bar player to summarize anything

`Q129`
Question:
For the local journal, should row ordering be treated as strictly append-only and immutable once written, with sync acknowledgements stored separately?

Answer:
- `a`

Interpretation:
- yes

`Q130`
Question:
Should each journal row be tied to a monotonic local sequence number so resuming sync from the last acknowledged row is deterministic even across reconnects?

Answer:
- `a`

Interpretation:
- yes

`Q131`
Question:
Should schedule-cache changes themselves also be journaled locally, or only the player's resulting mode/template/ad behavior?

Answer:
- `a`

Interpretation:
- journal schedule-cache updates too

`Q132`
Question:
Should ad-asset downloads and availability changes also be journaled locally?

Answer:
- `a`

Interpretation:
- yes

`Q133`
Question:
Should journal retention be “keep everything until server acknowledges it,” even if the player restarts?

Answer:
- `a`

Interpretation:
- yes

`Q134`
Question:
After rows are acknowledged by the server, should they be eligible for local pruning automatically, or retained for some local history window?

Answer:
- `b`

Interpretation:
- keep a rolling local history window after acknowledgement

`Q135`
Question:
For v1, should that local retained history window be defined by time, by size, or both?

Answer:
- `c`

Interpretation:
- both time and size limits

`Q136`
Question:
For v1, should we decide the exact local journal retention limits now, or defer the exact numbers?

Answer:
- `a`

Interpretation:
- decide exact numbers now

`Q137`
Question:
For retained acknowledged history, what time window feels right for v1 on the player?

Answer:
- `c`

Interpretation:
- 7 days

`Q138`
Question:
For the size bound, should we think in terms of max row count or max disk size?

Answer:
- `b`

Interpretation:
- max disk size

`Q139`
Question:
For v1, what disk-size ceiling feels right for the retained local journal on a bar player?

Answer:
- `c`

Interpretation:
- 250 MB

`Q140`
Question:
Should the 250 MB cap apply to the whole journal store including unsynced rows, or only to acknowledged retained history?

Answer:
- `b`

Interpretation:
- acknowledged retained history only

`Q141`
Question:
If unsynced rows keep growing because the backend is unavailable for a long time, should the player be allowed to exceed the 250 MB retained-history cap in order to preserve all unsynced data?

Answer:
- `a`

Interpretation:
- yes

`Q142`
Question:
If unsynced journal growth becomes very large, should the player surface that as an operational health condition locally/in logs?

Answer:
- `a`

Interpretation:
- yes

`Q143`
Question:
Should that operational-health condition be only a local/logging concern, or should it also be reflected in the server once sync returns?

Answer:
- `b`

Interpretation:
- also report it upstream when sync returns

`Q144`
Question:
When the server comes back and a very large backlog exists, should the player prioritize syncing journal backlog first, or current schedule/ad/control freshness first?

Answer:
- `b`

Interpretation:
- current freshness first

`Q145`
Question:
If current freshness is prioritized first, should backlog sync then resume in the background while normal presentation continues?

Answer:
- `a`

Interpretation:
- yes

`Q146`
Question:
When backlog sync is running in the background, should the player be allowed to throttle it automatically so presentation responsiveness and fresh control updates stay smooth?

Answer:
- `a`

Interpretation:
- yes

`Q147`
Question:
For the first implementation set of cross-mode safe templates, do you want to lock exactly these three now: `safe info layout`, `safe fixtures layout`, `safe message/fallback layout`?

Answer:
- `a`

Interpretation:
- yes

`Q148`
Question:
Should `safe fixtures layout` be the preferred safe template whenever cached fixtures are valid, rather than defaulting first to `safe info layout`?

Answer:
- `a`

Interpretation:
- yes

`Q149`
Question:
If cached fixtures are not valid or not enough to drive the screen, should the next preferred safe template be `safe info layout` before `safe message/fallback layout`?

Answer:
- `a`

Interpretation:
- yes

`Q150`
Question:
Should `safe message/fallback layout` be reserved mainly for cases where the system needs to explicitly communicate degraded operation or interruption, rather than as a generic low-risk default?

Answer:
- `a`

Interpretation:
- yes

`Q151`
Question:
In `safe info layout`, should the content be allowed to include neutral operational context like current date/time, venue identity, next scheduled block, or tournament label, as long as it avoids sponsor/ad presence by default?

Answer:
- `a`

Interpretation:
- yes

`Q152`
Question:
In `safe fixtures layout`, should the screen be allowed to show only cached schedule-based content, or can it also include stale-but-clearly-labeled live/recent context if available?

Answer:
- `a`

Interpretation:
- cached schedule-only

`Q153`
Question:
Should `safe info layout` and `safe fixtures layout` both avoid strong motion and template switching, behaving more conservatively than normal modes?

Answer:
- `c`

Interpretation:
- safe templates use conservative motion only — fade and simple slide permitted; no recompositions, no layered motion, no theme-driven animation tone. See D-SAFE-01.

`Q154`
Question:
Should we defer detailed motion/visual-behavior decisions for the safe templates and stay focused on state-selection logic for now?

Answer:
- `a`

Interpretation:
- yes

`Q155`
Question:
In automatic mode, if there is exactly one live game and valid future fixtures, should the default preference be `single game`, `fixtures with live game`, or depend on schedule block?

Answer:
- `c then b`

Interpretation:
- first consult schedule block
- if schedule does not define otherwise, default to `fixtures with live game`
- fixture emphasis should depend on market and sport relevance

`Q156`
Question:
In automatic mode, if there are multiple live games and valid fixtures, should the schedule block still be able to prefer `fixtures with live game`, or should multiple live games normally push the system into a multi-game family unless schedule explicitly says otherwise?

Answer:
- `b`

Interpretation:
- multiple live games should normally push to a multi-game family unless schedule explicitly says otherwise

`Q157`
Question:
If multiple live games exist but only one is in the configured bar priority set, should the system still prefer a multi-game family, or be allowed to treat that one priority game more like the main live focus with fixtures support?

Answer:
- `b`

Interpretation:
- allow it to behave more like single-focus plus fixtures support

`Q158`
Question:
If no live games are active but valid fixtures exist, should the default automatic mode simply be `fixtures` unless schedule or ad rules say otherwise?

Answer:
- `a`

Interpretation:
- yes

`Q159`
Question:
If no live games are active and fixtures are also unavailable or invalid, should automatic mode go to `safe info layout` before `safe message/fallback layout`?

Answer:
- `a`

Interpretation:
- yes

`Q160`
Question:
If there are multiple live games, but all are low-priority or low-interest relative to the bar's configured market/sport focus, should the system still be allowed to remain fixtures-led instead of moving into `multiple games`?

Answer:
- `b`

Interpretation:
- no
- multiple live games should still drive the system toward `multiple games`

Additional user clarification:
- if the games are being recorded then the games/fixtures can be changed to multiple games

`Q161`
Question:
If exactly one live game exists, but it is low-priority/low-interest for that bar, should the system still be allowed to default to `fixtures with live game` rather than `single game` when schedule does not force a choice?

Answer:
- `a`

Interpretation:
- yes, if there are valid fixtures

`Q162`
Question:
If exactly one live game exists and there are no valid fixtures, should the default then fall back to `single game`?

Answer:
- `a`

Interpretation:
- yes

`Q163`
Question:
For v1, should a schedule block explicitly name preferred business modes, or should it only express higher-level intent and let the player derive the mode?

Answer:
- `b`

Later clarification overrides this:
- schedule is built server side
- backend orchestrates transitions from screen to screen
- player is mainly an execution client plus safe-mode fallback client

`Q164`
Question:
If schedule blocks express intent rather than exact modes, should that intent be something like “fixtures-led”, “live-led”, “ad-friendly”, “recap-friendly”?

Answer:
- `b`

`Q165`
Question:
Should a schedule block instead carry more concrete content directives without naming exact geometry?

Answer:
- `b`

Interpretation after user clarification:
- schedule should be selection priority of game content
- presentation rules should drive visual changes when specific content is highlighted
- special highlighted content may justify special presentation
- admin may select layout when possible
- otherwise backend chooses defaults

`Q166`
Question:
For each server-planned screen state delivered to the player, should the backend send exact business mode + exact selected content + exact layout/template, or leave some of that choice to the player?

Answer:
- `a`

Interpretation:
- backend sends exact business mode, exact selected content, exact layout/template
- player executes exact plan when possible

Additional user clarification:
- if the current layout/template is not available on disk, the player should select the next best fit locally

`Q167`
Question:
Should that local “next best fit” fallback be chosen from a server-provided fallback list, or should the player infer it from local rules?

Answer:
- `b`

Interpretation:
- player infers it from local rules

`Q168`
Question:
Should those local fallback rules be general across all modes/templates, or should each delivered screen state also carry a small amount of fallback metadata to guide the player?

Answer:
- `a`

Interpretation:
- general local rules only

`Q169`
Question:
When the exact requested template is missing on disk, should the player first try another template in the same business mode before falling back to a different business mode?

Answer:
- `a`

Interpretation:
- yes

`Q170`
Question:
If no template in the same business mode is available locally, should the player next prefer a neighboring business mode in the same family, or jump straight to one of the cross-mode safe templates?

Answer:
- `b`

Interpretation:
- cross-mode safe template first

`Q171`
Question:
Should this “missing template on disk” fallback path be used only for missing assets/templates, or also for other local execution failures like template render errors?

Answer:
- `b`

Interpretation:
- also for local execution/render failures

`Q172`
Question:
If the requested template fails locally and no other template in the same business mode works, should the player first try `safe fixtures layout` when valid cached fixtures exist, before considering the other safe templates?

Answer:
- `a` / `yes`

Interpretation:
- yes

`Q173`
Question:
For the local fallback order, after trying another template in the same business mode, should the safe-template order be `safe fixtures layout` if valid cached fixtures exist, then `safe info layout`, then `safe message/fallback layout`?

Answer:
- `a`

Interpretation:
- yes

`Q174`
Question:
For threshold policy, should `major sports moment` be based on explicit backend classification sent to the player, rather than the player trying to infer it locally?

Answer:
- `a`

Interpretation:
- yes

`Q175`
Question:
Should `exceptional override` also be explicitly classified by the backend or trusted control source, rather than inferred locally by the player except for local failures/connectivity problems?

Answer:
- `a`

Interpretation:
- yes

`Q176`
Question:
For local-only problems like missing template, render failure, or lost connectivity, should the player be allowed to enter exceptional/safe fallback behavior without waiting for backend classification?

Answer:
- `a`

Interpretation:
- yes

`Q177`
Question:
Should the backend payload for each planned screen state include an explicit state identifier/version so the player can journal exactly which planned state it executed or failed to execute?

Answer:
- `a`

Interpretation:
- yes

`Q178`
Question:
Should that payload also include an explicit planned transition instruction, or is “next state arrives from backend” enough?

Answer:
- `a`

Interpretation:
- include explicit transition instruction

`Q179`
Question:
Should the planned transition instruction identify the transition family only, or the exact transition variant too?

Answer:
- `b`

Interpretation:
- exact transition variant too

`Q180`
Question:
Should the payload also include the intended dwell target for that planned state, so the player is executing backend timing rather than choosing dwell locally in normal operation?

Answer:
- `a`

Interpretation:
- yes

## Additional Consolidated Decisions

### Local fallback order

When a planned template cannot execute locally:

1. Try another template in the same business mode.
2. If that fails and valid cached fixtures exist, use `safe fixtures layout`.
3. Otherwise use `safe info layout`.
4. If needed, fall through to `safe message/fallback layout`.

This fallback path applies to:

- missing template on disk
- missing required local assets
- local render/execution failure

### Classification and payload authority

- `major sports moment` is an explicit backend classification in normal operation.
- `exceptional override` is an explicit backend or trusted-control-source classification in normal operation.
- The player may still enter exceptional/safe fallback behavior on local-only failures without waiting for backend instruction.

### Planned state payload

Each planned screen-state payload should include:

- exact business mode
- exact selected content
- exact layout/template
- explicit state identifier/version
- explicit planned transition instruction
- exact transition variant
- intended dwell target

## Open Questions

1. Is the short post-game result/recap beat:
   - resolved: reusable transition-only layer
2. What are the actual named geometry templates inside each business mode?
3. ~~Which mode pairs should preserve continuity, and which should fully recompose?~~ → resolved: see D-TRANS-01/02/03
4. What thresholds allow automatic mode to break schedule?
5. Are there any additional ad classes needed beyond the current minimum v1 taxonomy?
6. ~~What exact dwell-time rules should exist for mode changes vs in-mode template switches?~~ → resolved: see D-DWELL-01/02/03
7. Do we need any more interrupt classes beyond the current working set?
8. What exact precedence rules should govern conflicts between interrupt classes?
9. Do we need more explicit rules for ad-window entry/exit merge behavior?
10. What exact cases belong in `exceptional override`?
11. What exact thresholds should distinguish ordinary changes, major sports moments, and exceptional override entry?
12. What exact schedule-authoring/admin UX should exist server side?

---

## Server-Player Protocol Schema — Decisions (2026-05-10)

This section records all design decisions made in the Gap #10 schema design session covering the full server-player communication protocol.

---

### D-SCHEMA-01: Two-Channel Architecture

The server-player protocol uses two independent channels:

1. **Control channel** — schedule orchestration, state delivery, config, overrides, heartbeat, asset manifests, messaging lane
2. **Game data channel** — live game state and events (GameState, GameEvent, GameStateRequest)

Both channels use JSONL (newline-delimited JSON) as the wire format.

Rationale: separating orchestration from game data allows each to evolve independently and prevents game data volume from blocking control messages.

---

### D-SCHEMA-02: JSONL as Wire Format

All messages on both channels use JSONL (one JSON object per line, `\n` delimited).

This applies to:
- Control channel stream
- Game data channel stream
- JournalSync batch payload (player → server POST)

Every message object carries a `message_type` discriminator field.

---

### D-SCHEMA-03: Rolling 24-Hour Schedule Window (not calendar-day)

Schedules are delivered as rolling 24-hour windows, not calendar-day windows.

A `ScheduleWindow` covers `window_start` to `window_end` (exactly 24 hours). The server always maintains a fresh rolling window so there is no day-boundary gap problem.

`ScheduleWindow` is a header row streamed before its `PlannedState` rows on the control channel.

```jsonl
{"message_type":"ScheduleWindow","window_id":"uuid","window_start":"2026-05-10T08:00:00Z","window_end":"2026-05-11T08:00:00Z","schedule_hash":"sha256...","slot_count":96}
```

---

### D-SCHEMA-04: `expires_at` Dropped from PlannedState

`PlannedState` does not carry an `expires_at` field.

Rationale: `expires_at` creates gap risk and clock-skew anomalies at schedule boundaries. Instead, continuity is guaranteed by the contiguous `schedule_slot_index` ordering within a `ScheduleWindow`. The next state starts where the previous one ends implicitly.

---

### D-SCHEMA-05: PlannedState Schema

`PlannedState` is the core render instruction delivered on the control channel.

```jsonl
{
  "message_type": "PlannedState",
  "state_id": "uuid",
  "window_id": "uuid",
  "schedule_slot_index": 0,
  "valid_from": "iso8601",
  "interrupt_class": "scheduled_change|ordinary_change|enter_ad_window|exit_ad_window|major_sports_moment|exceptional_override|enter_post_game_recap|exit_post_game_recap",
  "business_mode": "single_game|multiple_games|fixtures|single_game_with_ads|multiple_games_with_ads|fixtures_with_ads|fixtures_with_live_game|fixtures_with_live_game_and_ads",
  "template_id": "string",
  "theme_id": "string | null | \"__unset__\"",
  "dwell_target_ms": 300000,
  "transition": {
    "variant": "fade_scale|slide_stagger|wipe_reveal|card_reshuffle|stack_collapse|split_panel|ticker_dock|lower_third_rise",
    "duration_ms": 800
  },
  "program_slot_id": "uuid | null",
  "ad_slot_id": "uuid | null"
}
```

`theme_id` three-state semantics:
- `"string"` — explicit theme override for this state
- `null` — inherit from bar/display profile (most common)
- `"__unset__"` — explicitly clear any inherited theme, revert to system default

`state_id` purpose: uniquely identify this specific planned state for journal cross-referencing, fallback reporting, and execution auditability.

Content and ad details are NOT inlined into `PlannedState`. They reference `ProgramSlot` and `AdSlot` by ID.

---

### D-SCHEMA-06: ProgramSlot — Programming Content Selection

`ProgramSlot` is a separate JSONL row that describes the programming selection (which games/fixtures are in play for a given planned state). It is referenced by `program_slot_id` from `PlannedState`.

```jsonl
{
  "message_type": "ProgramSlot",
  "program_slot_id": "uuid",
  "primary_game_id": "uuid | null",
  "game_ids": ["uuid"],
  "fixture_ids": ["uuid"]
}
```

Rationale: `PlannedState` encodes layout/orchestration intent. `ProgramSlot` encodes content selection (these 3 games are live, this is the primary). Separating them allows the same program slot to be referenced by multiple planned states without duplication.

---

### D-SCHEMA-07: AdSlot — Ad Context per Schedule Slot

`AdSlot` is a separate JSONL row that carries ad policy and reference for a given planned state. It is referenced by `ad_slot_id` from `PlannedState`. `AdSlot` belongs to the `ScheduleWindow` scope.

```jsonl
{
  "message_type": "AdSlot",
  "ad_slot_id": "uuid",
  "ad_class": "ambient_branding|competitive_in_layout|interstitial_ad_beat",
  "ad_ref": "asset-uuid",
  "policy": {
    "min_dwell_ms": 15000,
    "skippable": false,
    "blocks_recap": false
  }
}
```

`AdSlot` replaces the earlier `AdContext` / `AdWindow` naming.

---

### D-SCHEMA-08: OverrideInjection — Out-of-Band Interrupt

`OverrideInjection` delivers out-of-band interrupts (major sports moments, exceptional overrides) that are not part of the scheduled window sequence.

```jsonl
{
  "message_type": "OverrideInjection",
  "override_id": "uuid",
  "fires_at": "iso8601",
  "interrupt_class": "exceptional_override|major_sports_moment",
  "business_mode": "string",
  "template_id": "string",
  "theme_id": "string | null | \"__unset__\"",
  "dwell_target_ms": 30000,
  "transition": {
    "variant": "string",
    "duration_ms": 800
  },
  "program_slot_id": "string | null",
  "ad_slot_id": "null"
}
```

Key design decisions:
- `fires_at` provides lead time for asset download before the override activates
- Server pushes an `AssetManifest` alongside the `OverrideInjection` so player can pre-fetch required assets
- If assets are not ready when `fires_at` arrives, player falls back using standard fallback rules
- No explicit resume pointer: when override dwell completes, player re-evaluates wall clock against the active `ScheduleWindow` to determine the correct re-entry state
- Cross-window overrides (override fires_at spans into the next ScheduleWindow) are handled transparently by wall-clock re-evaluation
- `program_slot_id` may be inline (server injects a `ProgramSlot` row alongside the override) if the content is not in the active window

---

### D-SCHEMA-09: GameState — Full Snapshot

`GameState` is a full snapshot of a game's current state, delivered on the game data channel.

```jsonl
{
  "message_type": "GameState",
  "game_id": "uuid",
  "sport": "nfl|nba|nhl|mlb|mls|epl|laliga|...",
  "as_of_seq": 1042,
  "status": "pre_game|live|halftime|post_game",
  "period": "string",
  "clock": "string",
  "home": {
    "team_id": "uuid",
    "score": 21
  },
  "away": {
    "team_id": "uuid",
    "score": 17
  },
  "signals": {
    "momentum": 0.73,
    "pressure": 0.61
  },
  "sport_context": {}
}
```

`signals` are server-computed, sport-specific. For soccer the recommended signals include: `momentum`, `pressure`, `danger_zone`, `possession_pct`, `xg_delta`. Exact signal sets are defined per sport by the backend and may vary.

`sport_context` holds sport-specific fields not covered by the common schema (e.g., down-and-distance for NFL, match period details for soccer).

Player uses `GameState` for initial sync and gap recovery.

---

### D-SCHEMA-10: GameEvent — Delta Update

`GameEvent` delivers incremental game state changes on the game data channel. Player processes deltas continuously regardless of what is currently rendering on screen.

```jsonl
{
  "message_type": "GameEvent",
  "game_id": "uuid",
  "seq": 1042,
  "at": "iso8601",
  "event_type": "score|turnover|timeout|period_end|clock_update|substitution|penalty|injury|var_review",
  "payload": {}
}
```

`seq` is mandatory and monotonic per game. Player detects gaps by checking sequence continuity. On seq gap detection, player sends `GameStateRequest` to recover.

Player maintains in-memory game state (accumulated from `GameState` + subsequent `GameEvent` deltas) independently of rendering. This ensures the player always has fresh data even during an `OverrideInjection` or template switch.

---

### D-SCHEMA-11: GameStateRequest — Gap Recovery

Player sends `GameStateRequest` to server on the game data channel when a seq gap is detected.

```jsonl
{
  "message_type": "GameStateRequest",
  "game_id": "uuid",
  "last_seq": 1038
}
```

Server responds with a fresh `GameState` snapshot for the requested game.

---

### D-SCHEMA-12: Heartbeat — Unified State Envelope

`Heartbeat` is a unified envelope that replaces the earlier `ScheduleHashHeartbeat`. It carries hash state for all managed resources so the player can self-discover what has changed and request only what it needs.

```jsonl
{
  "message_type": "Heartbeat",
  "sent_at": "iso8601",
  "state": {
    "schedule": {
      "window_id": "uuid",
      "hash": "sha256"
    },
    "config": {
      "version": 42,
      "hash": "sha256"
    },
    "assets": {
      "manifest_id": "uuid",
      "hash": "sha256"
    },
    "messaging": {
      "hash": "sha256"
    }
  }
}
```

Player compares each hash against its local state. For any mismatch, player requests the updated resource. This eliminates the need for the server to track which players have applied which changes — execution truth is visible through the journal.

`ScheduleHashHeartbeat` is removed. `Heartbeat` subsumes its function.

---

### D-SCHEMA-13: JournalSync — Append-Only Journal with ACK

Journal sync uses a request-response model. Player POSTs a JSONL batch to the server. Server responds with confirmed seq range (ACK).

Player-to-server POST body (JSONL):
```jsonl
{"message_type":"JournalSync","device_id":"uuid","batch_seq_from":1001,"batch_seq_to":1048,"sent_at":"iso8601"}
{"type":"state_transition","seq":1001,"at":"iso8601","state_id":"s1","template_id":"fixtures_hero_v1","interrupt_class":"scheduled_change","fallback":false}
{"type":"fallback","seq":1002,"at":"iso8601","state_id":"s2","reason":"template_missing|render_failure|asset_missing|connectivity_lost","executed_template":"safe_fixtures_v1"}
{"type":"ad_milestone","seq":1003,"at":"iso8601","ad_slot_id":"a1","milestone":"scheduled|started|completed|skipped|failed"}
{"type":"asset_event","seq":1004,"at":"iso8601","asset_id":"uuid","event":"download_started|download_completed|evicted"}
{"type":"schedule_cache_update","seq":1005,"at":"iso8601","window_id":"uuid","schedule_hash":"sha256"}
{"type":"connectivity","seq":1006,"at":"iso8601","event":"lost|restored"}
```

Server ACK response:
```json
{"confirmed_seq_from":1001,"confirmed_seq_to":1048,"config_hash":"sha256"}
```

ACK may piggyback `config_hash` so player can detect config staleness without waiting for the next heartbeat.

Fallback reason codes are structured (enum): `template_missing`, `render_failure`, `asset_missing`, `connectivity_lost`.

Journal is append-only, immutable rows once written, monotonic local seq per row, unsynced rows survive player restart.

Retention: 7-day time window, 250 MB ceiling for acknowledged history only. Unsynced rows are uncapped.

Journal sync is pushed on heartbeat interval. On connectivity restoration, all unsynced rows must be backfilled. Current schedule/ad/control freshness is prioritized first; backlog sync resumes in background and may be throttled automatically.

---

### D-SCHEMA-14: DeviceRegistration — Player Hardware Report

Player sends `DeviceRegistration` on first connect. Server responds with `ConfigPush`.

```jsonl
{
  "message_type": "DeviceRegistration",
  "device_id": "uuid",
  "display_id": "xibo-display-uuid",
  "os": "string",
  "player_version": "string",
  "storage_total_bytes": 107374182400,
  "storage_available_bytes": 85899345920,
  "screen_resolution": "1920x1080",
  "network_type": "ethernet|wifi|cellular"
}
```

---

### D-SCHEMA-15: ConfigPush — Server-Computed Player Config

Server sends `ConfigPush` in response to `DeviceRegistration` and whenever config changes.

```jsonl
{
  "message_type": "ConfigPush",
  "config_version": 42,
  "config_hash": "sha256",
  "cache_ceiling_bytes": 10737418240,
  "heartbeat_interval_ms": 300000,
  "journal_sync_interval_ms": 300000,
  "journal_backlog_threshold_rows": 500,
  "schedule_hash_check_interval_ms": 300000
}
```

`cache_ceiling_bytes` is server-computed from device storage (minimum of 10% of storage_total_bytes or 5 GB, whichever is smaller). Admin can configure the MAX ceiling globally; server applies it per-device.

All intervals are admin-configurable server-side. Players use whatever the server pushes, not hardcoded values.

`config_hash` allows player to detect config staleness via heartbeat comparison without the server tracking individual player config versions.

---

### D-SCHEMA-16: AssetManifest — Segmented Asset Download Instructions

`AssetManifest` delivers asset download instructions segmented by schedule block.

```jsonl
{
  "message_type": "AssetManifest",
  "manifest_id": "uuid",
  "window_id": "uuid",
  "slot_range": {
    "from": 0,
    "to": 11
  },
  "assets": [
    {
      "asset_id": "uuid",
      "type": "template|ad|fixture_image|team_logo|font",
      "url": "string",
      "size_bytes": 204800,
      "content_hash": "sha256",
      "needed_by": "iso8601"
    }
  ]
}
```

`needed_by` drives LRU + time-to-needed eviction priority. Assets needed soonest are retained longest. Asset cache uses LRU eviction within the `cache_ceiling_bytes` budget. Heartbeat triggers cache management process (compare manifest hash, evict stale, queue downloads).

Server pushes an `AssetManifest` alongside any `OverrideInjection` to ensure override assets can be pre-fetched before `fires_at`.

---

### D-SCHEMA-17: MessagingLane — Independent Venue Messaging Channel

`MessagingLane` is an independent content type delivered on the control channel. It is distinct from schedule orchestration.

```jsonl
{
  "message_type": "MessagingLane",
  "lane_id": "uuid",
  "form": "overlay|template_slot",
  "content_ref": "uuid",
  "priority": 1,
  "valid_from": "iso8601",
  "valid_until": "iso8601"
}
```

Two forms:
- `overlay` — rendered over the current template (e.g., venue announcement banner)
- `template_slot` — fills a designated slot within the current template

Messaging lane has `valid_from`/`valid_until` for time-bounded display. It does not interact with business mode selection.

---

### D-SCHEMA-18: Admin Scope Model — Tag-Based ACL

Admin scoping uses a tag-based ACL model with ordered rules (first match wins).

Example tag dimensions:
- `country=usa`
- `state=az`
- `city=phoenix`
- `local_team=cardinals`
- `bar_type=sports_bar`
- `bar=uuid`
- `all`

Rules are ordered. First matching rule wins. This allows broad rules at country/state level with narrow overrides at bar or local_team level.

---

### D-SCHEMA-19: Summary — Complete Message Type Taxonomy

**Control channel (server → player):**
- `ScheduleWindow` — rolling 24h window header
- `PlannedState` — core render instruction
- `ProgramSlot` — programming content selection
- `AdSlot` — ad context
- `OverrideInjection` — out-of-band interrupt
- `AssetManifest` — asset download instructions
- `MessagingLane` — venue messaging
- `Heartbeat` — unified state hash envelope
- `ConfigPush` — player configuration
- `SyncRequest` — server requests journal sync from player

**Game data channel (server → player):**
- `GameState` — full game snapshot
- `GameEvent` — incremental delta

**Player → server (POST/request):**
- `DeviceRegistration` — hardware registration on first connect
- `GameStateRequest` — gap recovery request
- `JournalSync` — append-only journal batch (JSONL POST)

---

## Dwell Number Decisions (2026-05-10)

### D-DWELL-01: Business-Mode Change Minimum Dwell

Minimum dwell before the backend may issue a `PlannedState` with a different `business_mode`: **15 seconds**.

This is the floor — the backend will not emit a mode change until the current mode has been active for at least 15s. Rationale: bar screens are active, dynamic environments. 5 minutes is too slow to react to live content changes. 15s is enough to register the current state without mode-flipping feeling chaotic.

### D-DWELL-02: In-Mode Template Switch Minimum Dwell

Minimum dwell before the backend may issue a `PlannedState` with the same `business_mode` but a different `template_id`: **8 seconds**.

This allows enough time for the transition animation to complete and the rendered template to settle before another swap. Template switches are more frequent than mode changes by design.

### D-DWELL-03: `with ads` Mode Template Switch Gate

For `with ads` business modes, the template switch gate is: **max(8s, ad `min_dwell_ms`)**.

No separate fixed floor for `with ads` modes. The ad policy already carries `min_dwell_ms` per `AdSlot`. A template switch may not occur until both the 8s minimum and the ad's own `min_dwell_ms` have elapsed. The higher of the two wins.

---

## Transition Continuity Decisions (2026-05-11)

### D-TRANS-01: All Business-Mode Transitions Are Full Recompose

All transitions between different business modes are full recompose. No continuity-preserving morphs between modes.

Transition animations (fade, wipe, slide, etc.) may still be smooth and visually polished, but the DOM/layout is fully rebuilt when the business mode changes. This applies to all mode pairs including ad-window entry/exit (e.g., `fixtures` → `fixtures_with_ads`).

### D-TRANS-02: Each Business Mode Is a Distinct Template Family

Each business mode is a distinct template family. There is no single mega-template with conditional view-states.

`fixtures`, `fixtures_with_ads`, and `fixtures_with_live_game` are separate templates — not one template toggling sections on and off. This applies to all 8 business modes. Mode variants (e.g., the `with_ads` counterparts) are fully independent templates, not view-state forks of a shared parent.

### D-TRANS-03: In-Mode Template Switching Preserves Shared Elements Where Possible

When switching between template variants within the same business mode (same `business_mode`, different `template_id`), shared structural elements (score panels, team logos, league headers, fixture rows) should persist and reposition rather than vanish and rebuild.

Full recompose within a mode is only used when the two templates share no structural elements.

Rationale: in-mode template switching should feel like a layout evolution, not a page reload. Preserving shared elements maintains visual context for the viewer.

---

## Safe Template Motion Decision (2026-05-11)

### D-SAFE-01: Safe Templates Use Conservative Motion Only

Safe templates (`safe_info_layout`, `safe_fixtures_layout`, `safe_message_fallback_layout`) use conservative motion only:

- Allowed: fade, simple slide
- Not allowed: recompositions, layered motion, stack/collapse transitions, theme-driven animation tone

Rationale: safe templates activate during degraded state (missing asset, render failure, connectivity loss). Strong motion during fallback would hide the degradation from ops monitoring, create false confidence, and risk compounding a renderer failure. Conservative motion makes degraded state visually distinguishable and operationally transparent.

Safe templates carry their own self-contained assets, so strong motion is technically possible — the constraint is UX and operational, not technical.

---

## Game-Right-Here Feature Translation Decisions (2026-05-11)

These decisions resolve gaps identified by comparing the game-right-here reference implementation against the CROWDAQ PRD and protocol schema.

---

### D-GRH-01: Badges in GameState Payload + GameEvent Badge Events

`GameState` carries a full `badges` array alongside `signals`. Badge state is part of the game snapshot and must be present on every `GameState` message.

```jsonl
{
  "message_type": "GameState",
  "game_id": "uuid",
  "sport": "string",
  "as_of_seq": 1042,
  "status": "live",
  "period": "string",
  "clock": "string",
  "home": { "team_id": "uuid", "score": 21 },
  "away": { "team_id": "uuid", "score": 17 },
  "signals": { "excitement_score": 87, "momentum": 0.73 },
  "badges": [
    {
      "id": "game-right-here",
      "name": "Game Right Here",
      "category": "excitement",
      "priority": 1,
      "icon": "🔥",
      "color": "#ff4444",
      "short_description": "string",
      "explanation": "string",
      "triggered_at": 0.73,
      "active": true,
      "dominant": true
    }
  ],
  "sport_context": {},
  "as_of_seq": 1042
}
```

`GameEvent` adds two new event types for badge lifecycle:

- `badge_triggered` — fires when a badge becomes active for the first time
- `badge_deactivated` — fires when a previously active badge becomes inactive

These allow the player to know exactly when to fire one-time badge animations without polling full GameState.

Badge fields:
- `id`: stable identifier
- `name`: display name
- `category`: excitement | momentum | clutch | chaos | upset | historical | performance | domination
- `priority`: integer 1–13, lower = higher priority
- `icon`: emoji
- `color`: hex color string
- `short_description`: short display string
- `explanation`: full tooltip/detail string
- `triggered_at`: normalized game time 0.0–1.0 when badge fired
- `active`: boolean
- `dominant`: boolean — true for highest-priority active badge (only one badge is dominant at a time)

Badge evaluation is server-side. Templates render the dominant badge prominently; secondary badges compactly. Badge definitions are global, not per-template.

---

### D-GRH-02: DisplayEvent — Server-Triggered Ephemeral UI Alerts

A new `DisplayEvent` message type is added to the game data channel. The server explicitly triggers one-time ephemeral visual alerts. The player fires the alert once and does not repeat it.

This is consistent with the backend-as-orchestrator principle. The player does not derive "what is worth showing" independently from game state changes.

```jsonl
{
  "message_type": "DisplayEvent",
  "game_id": "uuid",
  "event_id": "uuid",
  "display_type": "excitement_tier_up|badge_triggered|badge_dominant_change|upset_confirmed|overtime|score_flash|run_alert",
  "duration_ms": 8000,
  "animation_hint": "string",
  "payload": {},
  "at": "iso8601"
}
```

- `event_id`: used for deduplication on reconnect — player must not fire the same `event_id` twice
- `display_type`: defines what kind of alert to render
- `duration_ms`: how long the alert is visible
- `animation_hint`: optional string suggesting animation style (non-binding; template may override)
- `payload`: flexible content relevant to the display type (e.g., badge object for badge_triggered, tier number for excitement_tier_up)

`DisplayEvent` is distinct from `OverrideInjection`. `OverrideInjection` changes the layout mode. `DisplayEvent` fires an ephemeral alert within the current layout without changing mode.

---

### D-GRH-03: ScoringTimeline and ExcitementChart Required in All Single-Game Templates

All single-game templates — including `single_game` and `single_game_with_ads` — must include both:

1. **ScoringTimeline**: chronological scoring event log with run detection. Shows event type, period, clock, points, running score, scoring runs highlighted.
2. **ExcitementChart**: excitement curve (0–100 over normalized game time 0–100%) with key moments strip (top excitement spikes with context).

This applies as a hard requirement, not a variation option.

For `single_game_with_ads`: the ad unit must occupy its own layout region. Ad placement cannot displace or remove `ScoringTimeline` or `ExcitementChart`. All three must coexist in the template geometry.

Rationale: the scoring timeline is critical to the single-game experience. Dropping it to fit an ad defeats the purpose of the single-game mode.

---

### D-GRH-04: Excitement Signal Model — Named Signals Locked, Weights Backend-Internal

Signal model contract:

- Each sport has a defined named signal set. Signal names are part of the protocol contract — templates depend on these names.
- All individual signals are normalized to 0.0–1.0 range.
- The composite `excitement_score` signal uses 0–100 range.
- Signal names are stable across versions. Renaming a signal is a breaking protocol change.
- Weights and computation formulas are backend-internal implementation detail — not part of the product requirements.
- Per-sport signal lists are defined in sport-level implementation specs, not this PRD.

Reference signal set (basketball — from game-right-here reference implementation):
- `excitement_score` (0–100, composite)
- `score_change_rate` (0.0–1.0)
- `lead_change_rate` (0.0–1.0)
- `one_possession_pressure` (0.0–1.0)
- `clock_leverage` (0.0–1.0)
- `upset_pressure` (0.0–1.0)
- `overtime_bonus` (0.0–1.0)
- `run_volatility` (0.0–1.0)
- `trading_baskets` (0.0–1.0)

Other sports must define equivalent named sets before templates for those sports are built.

## D-GRH-05: fixtures_with_live_game Template — ScoringTimeline + ExcitementChart Required (2026-05-11)

**Decision:** `fixtures_with_live_game` templates must include `ScoringTimeline` and `ExcitementChart` for the featured live game. These components are not optional in this mode.

**Rationale:**
When a live game is present in `fixtures_with_live_game`, it is the primary engagement hook. The fixture cards are secondary context. Dropping `ScoringTimeline` or `ExcitementChart` in this mode creates a degraded single-game experience with no justification. The featured game panel carries both components; fixture cards sit alongside without displacing them.

**Rule:**
- Featured game panel in `fixtures_with_live_game` inherits the full `single_game` panel component set (including `ScoringTimeline`, `ExcitementChart`, `ExcitementMeter`, and all live-signal-driven components). The live game is live — signals are present.
- Fixture cards are additive context. They do not carry scoring timelines, excitement charts, or excitement meters (pre-game, no live signals).
- Layout must accommodate both the featured game panel (with full single-game component set) and the fixture card list simultaneously.

**Scope:** Extends D-GRH-03, which already covers `single_game` and `single_game_with_ads`.

## D-GRH-06: Live Ticker — Optional, Operator-Configured (2026-05-11)

**Decision:** A live ticker (scrolling scores/updates bar) is an optional layout component. No template family requires it. It is operator-configured per bar.

**Rule:**
- Live ticker is a layout slot — present or absent based on bar configuration.
- No business mode mandates a ticker.
- When enabled, ticker occupies a dedicated layout region and does not displace featured game panel, fixture cards, ScoringTimeline, ExcitementChart, or ad units.
- Ticker content (which sports/games scroll) follows bar-level sport and league filter preferences.

## D-GRH-07: Badge Display Scaling and Animation Rules (2026-05-11)

**Decision:** Badge display size and animation are context-sensitive. Badges are shown wherever a live game component is present, but their visual treatment scales to the layout density.

**Rule:**
- **Single-game panel** (`single_game`, `single_game_with_ads`, featured game panel in `fixtures_with_live_game`): full badge display, full animation permitted.
- **Multi-game grid cards** (`multiple_games`, `multiple_games_with_ads`): badges shown at reduced/card-fit size; animation is suppressible.
- **Fixtures + multiple games contexts**: badges shown at reduced size; badge animation is suppressed. This is a hard rule — not operator-toggleable.
- **Fixture cards** (pre-game): no badges (no live signals).

**Rationale:**
In dense multi-game and fixture+games layouts, badge animation competes with too many simultaneous moving elements, violating the no-flashing and no-distraction-fatigue constraint. Suppression is non-negotiable in these contexts. Operator toggle would add complexity for marginal value.

## D-GRH-08: Team Assets — Static Assets with Long TTL, Lazy Pull (2026-05-11)

**Decision:** Team metadata (name, abbreviation, colors, logo) is a static asset with a long TTL. `GameState` references teams by `team_id` only. The player resolves `team_id` → team metadata from its asset cache. Assets are fetched from the backend on first cache miss (lazy pull). No special protocol message is needed.

**Rule:**
- `GameState` payload: `team_id` only. No inline team metadata per update.
- Player maintains a team asset cache keyed by `team_id`.
- On first `team_id` cache miss: player fetches team asset from backend. Asset is cached with long TTL.
- Team metadata fields: name, abbreviation, primary color, secondary color, logo URL.
- No session-initialization push of team assets — lazy pull on demand is sufficient.
- Team assets are treated the same as other static assets in the player asset model.

## D-GRH-09: sport_context — Fixed Schema Per Sport, Protocol Contract (2026-05-11)

**Decision:** `sport_context` in `GameState` carries a fixed, sport-specific field set defined as part of the protocol contract for each sport. This follows the same pattern as named signals (D-GRH-04). The field set is not freeform.

**Rule:**
- `sport_context` schema is defined per sport as a protocol contract.
- Player templates are sport-aware and consume the sport-specific `sport_context` fields.
- New sports must define their `sport_context` schema before templates for that sport are built.
- Backend must not omit fields from the defined set for a sport; optional fields must be null if unavailable.

**Reference sport_context schemas:**

Basketball:
```json
{ "period": "Q3", "clock": "4:22", "possession": "home", "bonus": "away" }
```

Soccer:
```json
{ "half": 2, "stoppage_time": false, "added_time": 3 }
```

Baseball:
```json
{ "inning": 7, "top_bottom": "bottom", "outs": 2, "bases": [true, false, true] }
```

**Scope:** Extends D-GRH-04 (signal names as protocol contract) to sport_context fields.

## D-GRH-10: Badge Rendering — Payload-Driven, No Local Catalog (2026-05-11)

**Decision:** The player renders badges entirely from payload fields. No local badge definition catalog is required. New badge `id`s can be introduced by the backend without any player update.

**Rule:**
- Player uses `icon`, `color`, `name`, and `short_description` from the badge object in `GameState` / `GameEvent` to render a badge.
- Badge animation style is derived from the `category` field, which is a fixed protocol-level set: `excitement`, `momentum`, `clutch`, `chaos`, `upset`, `historical`, `performance`, `domination`.
- No local badge catalog on the player. Badge identity is the `id` field (used for deduplication/state tracking only, not for lookup).
- Backend can add new badge `id`s at any time without a player release.

## D-GRH-11: Backend Asset Authoring — Backend Is Intentional Owner (2026-05-11)

**Decision:** The authoring and management of badge definitions, badge icons, and team logos is a deliberate backend responsibility. The backend is the intentional owner of these assets. Delivery to the player uses the same mechanism as all other static assets (lazy pull on cache miss, long TTL — D-GRH-08).

**Rule:**
- Badge definitions (including icon assets): authored and managed by the backend.
- Team logos and team identity assets: authored and managed by the backend.
- The player is a consumer only — it does not author, validate, or substitute these assets.
- Delivery mechanism is uniform: player fetches on first cache miss, caches with long TTL. No special delivery path for badges vs team logos vs other static assets.
- Backend must ensure badge icons and team logos are available at their referenced URLs before serving `GameState` payloads that reference them.

## D-GRH-12: Multi-Game Data Delivery — Single Multiplexed Stream (2026-05-11)

**Decision:** In multi-game modes, all game data messages are delivered on a single multiplexed JSONL stream. Each message carries a `game_id` field. The player fans out internally to the appropriate game card. N concurrent streams per display are not used.

**Rule:**
- All `GameState`, `GameEvent`, and `DisplayEvent` messages on the game data channel carry `game_id`.
- A single game data channel connection serves all games currently in scope for the display.
- Player routes incoming messages to the correct game card by `game_id`.
- Single multiplexed stream applies to all business modes (single-game modes carry one game_id, multi-game modes carry N).

## D-GRH-13: Game Card Add/Remove in Multi-Game Modes — Backend Sends Updated PlannedState (2026-05-11)

**Decision:** When a game is added to or removed from the active set in multi-game modes, the backend sends an updated `PlannedState` containing the new game list. The player recomposes its card layout from the new `PlannedState`. The player does not self-manage the game card set.

**Rule:**
- `PlannedState` carries the authoritative list of `game_id`s currently in scope for the display.
- On game start or end that affects the displayed set: backend sends updated `PlannedState`.
- Player recomposes card layout from new `PlannedState.game_ids`. Cards not in the new list are removed; new game_ids get new cards.
- Player does not watch `GameState.status == "final"` to self-remove cards. Player does not self-add cards from new `game_id` arrivals on the stream.
- All layout decisions (which games show, in what order, in what mode) are orchestrator-driven.

## D-GRH-14: Multi-Game Card Order — Backend-Decided via Ordered game_ids in PlannedState (2026-05-11)

**Decision:** Card display order in multi-game modes is determined by the backend. `PlannedState` carries an ordered `game_ids` list. The player renders cards in the order provided. No local sort logic runs on the player.

**Rule:**
- `PlannedState.game_ids` is an ordered list. First entry = first card position.
- Player renders game cards in `PlannedState.game_ids` order, no reordering.
- Backend is responsible for sorting by excitement, priority, sport, or any other rule.
- If card order changes (e.g., excitement surge promotes a game), backend sends updated `PlannedState` with reordered `game_ids`.

## D-SCHEMA-20: PlannedState — game_ids Array Replaces game_id Singular (2026-05-11)

**Decision:** `PlannedState` carries `game_ids` (ordered string array) in all business modes. The singular `game_id` field defined in D-SCHEMA-01 is superseded. Single-game modes send a single-element array. Multi-game modes send N elements. Player logic is uniform across modes.

**Amends:** D-SCHEMA-01 (PlannedState schema).

**Updated PlannedState field:**
```json
{ "game_ids": ["uuid-1", "uuid-2"] }
```

**Rule:**
- `PlannedState.game_ids` is always an ordered array, never absent or null.
- Single-game modes: `game_ids` has exactly one element.
- Multi-game modes: `game_ids` has N elements in backend-determined display order (D-GRH-14).
- Player iterates `game_ids` to construct game card set. No mode-branching for singular vs plural.
- `game_id` (singular) is removed from `PlannedState` schema. Any prior reference to `PlannedState.game_id` should be read as `PlannedState.game_ids[0]`.

## D-GRH-15: Ad Placement in multiple_games_with_ads — Dedicated Panel, Always Visible (2026-05-11)

**Decision:** In `multiple_games_with_ads`, the ad unit occupies a dedicated layout region that is always visible alongside the game card grid. The ad does not replace or rotate into a game card slot.

**Rule:**
- Ad unit in `multiple_games_with_ads`: dedicated region, always present while ad is active.
- Ad does not displace any game card. Game cards retain their full count and positions.
- Consistent with `single_game_with_ads` (D-GRH-03): ad coexists with game content, never replaces it.
- Ad region geometry (size, position) is a template-level concern; the constraint is that it does not overlap or replace game cards.

## D-GRH-16: Uniform Ad Coexistence Rule Across All With-Ads Modes (2026-05-11)

**Decision:** The ad coexistence rule is uniform across all with-ads business modes. In every with-ads mode, the ad unit occupies a dedicated layout region and never displaces game content, fixture cards, game cards, or game panel components.

**Rule:**
- `single_game_with_ads`: ad coexists with game panel. Ad does not displace ScoringTimeline, ExcitementChart, or ExcitementMeter. (D-GRH-03)
- `multiple_games_with_ads`: ad coexists with game card grid. Ad does not displace any game card. (D-GRH-15)
- `fixtures_with_ads`: ad coexists with fixture card list. Ad does not displace any fixture card.
- Rule applies to any future with-ads mode variant.
- Ad region is always dedicated. Ad never rotates into content slots.

## D-GRH-17: Fixture Card Data Fields (2026-05-11)

**Decision:** Fixture cards display a minimal, high-value field set. Venue and broadcast channel are excluded (no display value). Odds and prediction signals are deferred to a future phase — the backend has no infrastructure to compute them yet.

**Required fields (v1):**
- home team (team_id → resolved from team asset cache, D-GRH-08)
- away team (team_id → resolved from team asset cache)
- scheduled datetime (ISO 8601)
- league
- sport

**Excluded from v1:**
- venue (no display value)
- broadcast channel (no display value)

**Deferred (future phase):**
- odds / prediction signals (no backend infrastructure for pre-game prediction yet)

## D-GRH-18: FixtureList — Game Data Channel, 7-Day Lookahead (2026-05-11)

**Decision:** Fixture data is delivered as a `FixtureList` message on the game data channel (the live channel). It is not embedded in `PlannedState`. The backend pushes `FixtureList` whenever fixture data changes. The lookahead window is 7 days. Scope is all fixtures relevant to the bar's sport/league preference filter, not limited to the current day.

**Rule:**
- `FixtureList` is a message type on the game data channel, alongside `GameState`, `GameEvent`, and `DisplayEvent`.
- Backend pushes `FixtureList` proactively when fixture data changes (reschedule, cancellation, new fixture added, game transitions to live).
- Lookahead window: 7 days from current time.
- Scope: all fixtures matching bar's sport/league preferences — not limited to today.
- Player caches fixture data by `fixture_id`. Incoming `FixtureList` replaces the cached set.
- `PlannedState` references fixtures by `fixture_ids` (ordered list, same pattern as `game_ids`). Fixture display data is resolved from the player's fixture cache.
- Fixture fields per D-GRH-17: home team, away team, scheduled datetime, league, sport.

**Example `FixtureList` message:**
```json
{
  "message_type": "FixtureList",
  "fixtures": [
    {
      "fixture_id": "uuid",
      "sport": "nba",
      "league": "NBA",
      "home": { "team_id": "uuid" },
      "away": { "team_id": "uuid" },
      "scheduled_at": "2026-05-12T19:30:00Z"
    }
  ],
  "generated_at": "2026-05-11T12:00:00Z"
}
```

## D-GRH-19: "Being Recorded" — Live Game Data Ingest Scope (2026-05-11)

**Decision:** "Being recorded" in the CROWDAQ system means the backend is actively capturing and storing the live game's data stream (scoring events, game state updates, signals). This is a distinct concept from a game merely existing as a scheduled fixture. Ingest scope (which games are recorded) is a backend configuration concern independent of fixture scheduling.

**Rule:**
- A game is "being recorded" when the CROWDAQ backend has that game in its live ingest pipeline — it is capturing scoring, events, and game state for it.
- A game can be live in the real world but NOT recorded by CROWDAQ (e.g., sport/league not configured for ingest, or ingest not yet started). In this case it appears in `FixtureList` as a static entry only. No `GameState` or `GameEvent` messages are produced for it. The player shows it as a fixture card with static data. No live scores are displayed.
- When a game IS being recorded: the backend pushes `GameState` and `GameEvent` to all bars in scope for that sport/league/tournament. The backend also pushes an updated `FixtureList` reflecting the game's live status.
- `game_ids` in `PlannedState` (D-SCHEMA-20) represents games that are both live AND being recorded. A game not being recorded cannot appear in `game_ids`.
- For mode selection: `multiple_games` mode requires multiple games that are live AND being recorded. A live-but-not-recorded game does not count toward multi-game mode selection — it remains a fixture card.
- Backend determines ingest scope independently of fixture scheduling. Fixture data tells the player what games are upcoming; ingest scope determines which of those games produce live data.

**Amends:** Q160 interpretation — "if the games are being recorded" means CROWDAQ has active ingest for those games, which is the precondition for any game appearing in `game_ids`. The practical filter for `multiple_games` mode is: bar cares about this sport/league AND CROWDAQ is recording it.

**Open question (pending):** Whether `FixtureList` entries need an explicit `status` or `live_data_available` field to signal to the player that live scoring data exists for a given fixture. To be decided in next session.

## D-GRH-20: FixtureList Entry — status and game_id Fields (2026-05-11)

**Decision:** Each `FixtureList` entry carries an explicit `status` field and a `game_id` field. `status` tells the player whether a fixture is upcoming, live with CROWDAQ recording it, or final. `game_id` allows the player to correlate a fixture card with the live `GameState`/`GameEvent` stream when the game is being recorded.

**Updated FixtureList entry schema:**
```json
{
  "fixture_id": "uuid",
  "sport": "nba",
  "league": "NBA",
  "home": { "team_id": "uuid" },
  "away": { "team_id": "uuid" },
  "scheduled_at": "2026-05-12T19:30:00Z",
  "status": "scheduled | live | final",
  "game_id": "uuid | null"
}
```

**Rule:**
- `status` values: `scheduled` (upcoming, static only), `live` (CROWDAQ actively recording — GameState/GameEvent available), `final` (game ended).
- `status = live` is set by the backend only when CROWDAQ has active ingest for that game (consistent with D-GRH-19 — being recorded = ingest active).
- `game_id` is `null` when `status = scheduled`.
- `game_id` is populated when `status = live` or `final`. It is the CROWDAQ game identifier used in `GameState`, `GameEvent`, `DisplayEvent`, and `PlannedState.game_ids`.
- Player uses `game_id` to correlate: "fixture card with fixture_id F is the same game as game_id G currently streaming on the game data channel."
- When backend transitions a fixture from `scheduled` → `live`, it pushes an updated `FixtureList` with the new `status` and populated `game_id`.

**Amends:** D-GRH-18 (FixtureList schema — adds `status` and `game_id` fields to each entry).

## D-GRH-21: PlannedState vs ProgramSlot — Content Selection Ownership (2026-05-11)

**Decision:** `ProgramSlot` is the authoritative owner of content selection (`game_ids`, `fixture_ids`, `primary_game_id`). `PlannedState` does NOT carry `game_ids` or `fixture_ids` directly. `PlannedState` references a `ProgramSlot` via `program_slot_id`, and the player resolves content by joining on that reference.

**Retracts:** D-SCHEMA-20. That decision incorrectly added `game_ids` directly to `PlannedState`. It is superseded by this decision.

**Rationale:** A single `ProgramSlot` row can be referenced by multiple `PlannedState` schedule entries without duplicating game lists. Backend authors one `ProgramSlot` per content selection intent, then references it from many `PlannedState` slots. Flattening `game_ids` into `PlannedState` would require duplication across every slot that shares the same lineup.

**Corrected PlannedState shape:**
```json
{
  "state_id": "uuid",
  "mode": "single_game",
  "template": "hero_single",
  "theme": "dark_premium",
  "transition": "fade_scale",
  "dwell_ms": 30000,
  "program_slot_id": "uuid",
  "ad_slot_id": "uuid | null"
}
```

**ProgramSlot shape (D-SCHEMA-06, unchanged):**
```json
{
  "program_slot_id": "uuid",
  "primary_game_id": "uuid | null",
  "game_ids": ["uuid", ...],
  "fixture_ids": ["uuid", ...]
}
```

**Note:** All references to `PlannedState.game_ids` in prior GRH decisions (D-GRH-13, D-GRH-14, D-GRH-18, D-GRH-19) should be read as "the `game_ids` in the `ProgramSlot` referenced by that `PlannedState`." The conceptual meaning is unchanged; only the schema location is corrected.

## D-GRH-22: Empty Schedule Window — Backend Responsibility (2026-05-11)

**Decision:** The backend is responsible for full schedule coverage. There are no unscheduled windows from the player's perspective. When a bar's schedule has a gap (e.g., no content authored between 11am and 3pm), the backend synthesizes a gap-filling `PlannedState` to cover that window explicitly. Schedule gaps are backend authoring errors, not player-side edge cases.

**Gap-filling PlannedState options the backend may emit:**
- `mode: "fixtures"` with available fixture data — shows upcoming games
- `mode: "ambient"` (if defined) — sponsor loop, branding, or neutral content
- `mode: "safe_info"` — static informational safe state

**Player behavior:**
- Player executes whatever `PlannedState` it receives — it has no wall-clock schedule awareness.
- Player does NOT need to detect gaps, infer schedule coverage, or decide what to show during unscheduled periods.
- The connectivity-loss fallback chain (D-SAFE-01) is orthogonal — it applies only when the control channel is unavailable or stale, not as a substitute for schedule authoring.

**Implication for backend authoring tools:** The schedule authoring UI/API must ensure full coverage — either by requiring explicit gap entries or by auto-filling gaps with a configurable default `PlannedState` template at publish time.

## D-GRH-23: Theme Asset Delivery — AssetManifest Push (2026-05-11)

**Decision:** All theme assets are delivered to the player via `AssetManifest` control channel messages. This includes fonts, color token files, textures/gradients, badge icon sets, and ad frame images. Player fetches and caches assets before first use. Themes are runtime-updatable without widget redeploy.

**AssetManifest scope for themes:**
- Color/typography token files (JSON) — one per theme
- Texture and gradient image assets — per theme
- Sport/league badge icon sets — shared across themes, keyed by sport/league identifier
- Ad frame border/container images — per theme or per ad unit

**Player responsibilities:**
- On receiving `AssetManifest`, fetch all listed assets and store in local cache.
- Cache assets by content hash or version identifier to avoid redundant re-fetches.
- Before activating a theme, verify required assets are present in cache. If missing, fetch before first render (not during render).
- Stale assets: evict on version change signaled by a new `AssetManifest` with updated hashes.

**Cache invalidation:** Backend bumps asset version in `AssetManifest` when assets change. Player detects version change on receipt and schedules re-fetch during the next safe dwell window.

**No pre-baking of theme assets in widget bundle.** Adding or updating a theme does not require a widget redeploy — only a new `AssetManifest` push from the backend.

## D-GRH-24: Schedule Override Triggers and Dwell Gate (2026-05-11)

**Decision:** The backend may emit an `OverrideInjection` (or a new `PlannedState`) that interrupts the current scheduled slot before its dwell expires. Three categories of trigger are supported. Overrides bypass the dwell gate.

**Override trigger categories:**

1. **Game lifecycle transition** — a game's `status` changes: `scheduled → live` (CROWDAQ ingest starts) or `live → final` (game ends). Deterministic, always valid trigger.

2. **Excitement threshold** — the backend's excitement/signal engine crosses a configured threshold for a game (e.g., tie in final 2 minutes, overtime start, lead change). Threshold definitions are backend-internal; the player has no awareness of them. The player simply executes the resulting `PlannedState` or `OverrideInjection`.

3. **Human operator trigger** — an operator issues a manual override via the admin UI. Takes immediate effect.

**Dwell gate on override:** Overrides bypass D-DWELL-01 (15s minimum dwell for mode change) and D-DWELL-02 (8s minimum for in-mode template switch). A game ending or a human operator action must not be held back by a timer.

**Anti-flap rule:** If multiple override signals arrive within a short window (e.g., ≤ 3 seconds), the backend coalesces them into a single `OverrideInjection` before emitting. The player does not need to debounce — coalescing is the backend's responsibility.

**Player behavior on override:** Player treats an `OverrideInjection` as an immediate `PlannedState` replacement. It transitions using the transition specified in the override payload (or a default transition if none specified) and resets its dwell timer.

## D-GRH-25: D-SCHEMA-19 Amendment — Add FixtureList and DisplayEvent (2026-05-11)

**Decision:** D-SCHEMA-19 ("Complete Message Type Taxonomy") is incomplete. Two game data channel message types established in subsequent GRH decisions are absent. This decision amends D-SCHEMA-19 by adding them.

**Amended game data channel (server → player):**
- `GameState` — full game snapshot
- `GameEvent` — incremental delta
- `FixtureList` — 7-day fixture lookahead; pushed on fixture data changes (established D-GRH-18, schema finalized D-GRH-20)
- `DisplayEvent` — presentational cues (score animation triggers, moment alerts, emphasis signals)

**No changes to control channel or player → server message types.**

**Authoritative taxonomy (post-amendment):**

Control channel (server → player):
- `ScheduleWindow` — rolling 24h window header
- `PlannedState` — core render instruction (references ProgramSlot via program_slot_id; no game_ids directly — D-GRH-21)
- `ProgramSlot` — programming content selection (game_ids, fixture_ids, primary_game_id)
- `AdSlot` — ad context
- `OverrideInjection` — out-of-band interrupt (bypasses dwell gate — D-GRH-24)
- `AssetManifest` — asset download instructions, including all theme assets (D-GRH-23)
- `MessagingLane` — venue messaging
- `Heartbeat` — unified state hash envelope
- `ConfigPush` — player configuration
- `SyncRequest` — server requests journal sync from player

Game data channel (server → player):
- `GameState` — full game snapshot
- `GameEvent` — incremental delta
- `FixtureList` — 7-day fixture lookahead with status and game_id per entry (D-GRH-20)
- `DisplayEvent` — presentational cues for player-side animation/emphasis

Player → server (POST/request):
- `DeviceRegistration` — hardware registration on first connect
- `GameStateRequest` — gap recovery request
- `JournalSync` — append-only journal batch (JSONL POST)

## D-GRH-26: Ambient Mode — 9th Business Mode (2026-05-11)

**Decision:** `ambient` is a defined 9th business mode in the mode taxonomy. It is distinct from the 8 content-serving modes. It exists to fill schedule gaps with branded or sponsor content when no live game or fixture content is appropriate.

**Mode name:** `ambient`

**Purpose:** Gap-filling: sponsor loops, venue branding, neutral branded content. Not tied to live game data. Backend emits a `PlannedState` with `mode: "ambient"` to fill unscheduled windows (per D-GRH-22).

**Template family:** `ambient` mode requires its own template family (consistent with D-TRANS-02 — each mode is a distinct template family). Template renders branded/sponsor content without scoreboard, game cards, or fixture lists.

**Dwell:** Indefinite — no timer expiry. Ambient runs until the backend emits a new `PlannedState` (scheduled content or override). No minimum or maximum dwell applies.

**Content model:** Open question — see D-GRH-27 (to be decided: whether ambient content is driven by AdSlot, a dedicated playlist structure, or pre-baked template assets).

**Updated mode taxonomy (9 modes):**
1. `single_game`
2. `multiple_games`
3. `fixtures`
4. `fixtures_with_ads`
5. `single_game_with_ads`
6. `multiple_games_with_ads`
7. `fixtures_with_live_game` (if defined)
8. `safe` (safe template states — D-SAFE-01)
9. `ambient` (gap-filling branded content — this decision)

**Note:** Modes 7 and 8 may be revised as the taxonomy is finalized. This decision adds `ambient` as a peer mode alongside the others.

## D-GRH-27: Ambient Mode Content Model — AssetManifest-Driven (2026-05-11)

**Decision:** Ambient mode content is driven entirely by template assets delivered via `AssetManifest` (D-GRH-23). No `ProgramSlot` reference is needed. No `AdSlot` reference is needed. The ambient `PlannedState` carries only `mode`, `theme`, and `transition` — no `program_slot_id` and no `ad_slot_id`.

**Ambient PlannedState shape:**
```json
{
  "state_id": "uuid",
  "mode": "ambient",
  "theme": "dark_premium",
  "transition": "fade_scale",
  "dwell_ms": null
}
```
(`dwell_ms: null` = indefinite — runs until replaced. `program_slot_id` and `ad_slot_id` are absent.)

**Template renders from cached assets:** logo images, background images or video loops, brand color tokens. All delivered via prior `AssetManifest` push. Ambient template does not query game data channel.

**Content update path:** When operator changes ambient branding (new logo, new background), backend pushes a new `AssetManifest` with updated asset hashes. Player re-fetches during next safe dwell window and the ambient template picks up new assets on next render cycle — no `PlannedState` change required for asset updates.

**Resolves:** D-GRH-26 open question on ambient content model.

## D-GRH-28: Template Delivery — Pre-Baked in Widget Bundle (2026-05-11)

**Decision:** All template HTML/CSS/JS files are pre-baked in the Xibo widget bundle. Adding a new template family or fixing a template bug requires a widget redeploy via Xibo CMS push. Xibo's existing widget versioning and push mechanism handles delivery and version management.

**Scope of pre-baking:**
- All 9 business mode template families (single_game, multiple_games, fixtures, fixtures_with_ads, single_game_with_ads, multiple_games_with_ads, ambient, safe states, and any additional modes)
- All template variants within each mode
- All transition animation code
- The player-side runtime (SSE/JSONL consumer, state machine, dwell timer, fallback logic)

**NOT pre-baked (delivered via AssetManifest — D-GRH-23):**
- Theme color/typography token files
- Theme texture and gradient images
- Sport/league badge icon sets
- Ad frame images
- Ambient branding assets

**Rationale:** Dynamic loading of executable template code adds security and sandboxing complexity without clear benefit at this stage. Xibo's widget push already handles versioning and delivery to all displays. Widget size with 9 modes × multiple variants compresses acceptably within Xibo's widget bundle limits.

**Implication:** Template iteration velocity is gated on widget redeploy cycles. Theme and asset iteration (via AssetManifest) is independent of widget deploys.

## D-GRH-29: Journal Event Type Set — Write Everything (2026-05-11)

**Decision:** The player journals all significant events. Storage is cheap; missing audit data is expensive. Backend filters and aggregates. Every protocol-level event the player participates in produces a journal entry.

**Journal event types:**

| Event type | Trigger | Key fields |
|---|---|---|
| `planned_state_activated` | Player activates a new `PlannedState` | `state_id`, `mode`, `template`, `theme`, `transition`, `ts_activated` |
| `ad_slot_rendered` | Ad slot completes render in a `with_ads` mode | `ad_slot_id`, `ad_id`, `state_id`, `dwell_actual_ms` |
| `override_received` | Player receives an `OverrideInjection` | `override_id`, `prior_state_id`, `new_state_id`, `ts_received` |
| `fallback_entered` | Player enters any safe template fallback (D-SAFE-01) | `reason` (connectivity_lost / data_stale / no_state), `fallback_template`, `ts_entered` |
| `fallback_exited` | Player exits safe template fallback (normal state restored) | `fallback_template`, `duration_ms`, `ts_exited` |
| `game_state_received` | Player receives a `GameState` snapshot | `game_id`, `seq`, `ts_received` |
| `game_event_received` | Player receives a `GameEvent` delta | `game_id`, `event_id`, `event_type`, `ts_received` |
| `asset_fetch_completed` | Player completes fetching an asset from `AssetManifest` | `asset_id`, `asset_url_hash`, `success`, `duration_ms` |
| `connectivity_lost` | Control channel disconnects | `ts_lost`, `last_heartbeat_ts` |
| `connectivity_restored` | Control channel reconnects | `ts_restored`, `gap_duration_ms` |
| `config_push_received` | Player receives a `ConfigPush` | `config_version`, `ts_received` |
| `heartbeat_mismatch` | Heartbeat state hash does not match player's local state | `expected_hash`, `actual_hash`, `ts_detected` |
| `device_registration_sent` | Player sends `DeviceRegistration` on first connect | `device_id`, `ts_sent` |
| `journal_sync_sent` | Player sends a `JournalSync` batch to backend | `entry_count`, `seq_min`, `seq_max`, `ts_sent` |

**Journal entry format (all types):**
```json
{
  "seq": 1042,
  "ts": "2026-05-11T23:50:00.000Z",
  "event_type": "planned_state_activated",
  "payload": { ... event-specific fields ... }
}
```

**Retention (unchanged):** 7-day / 250 MB for acknowledged rows; unsynced rows uncapped.

**Backend responsibility:** Filtering, deduplication, and aggregation happen server-side. Player writes all events without filtering.

## D-GRH-30: Mode Taxonomy — Finalized (9 Explicit Modes) (2026-05-11)

**Decision:** All business modes are explicit, defined modes. Every `PlannedState` the backend emits carries one of these 9 mode values. There are no implicit states, orthogonal state categories, or "player-decides" mode selections. The backend always makes the mode choice.

**Final mode taxonomy:**

| # | Mode | Primary content |
|---|---|---|
| 1 | `single_game` | One featured live game, hero layout |
| 2 | `multiple_games` | Multiple live games, grid or split layout |
| 3 | `fixtures` | Upcoming fixture list only |
| 4 | `fixtures_with_ads` | Fixture list + ad panel |
| 5 | `single_game_with_ads` | Featured live game + ad panel |
| 6 | `multiple_games_with_ads` | Multiple live games + ad panel |
| 7 | `fixtures_with_live_game` | Fixture list alongside a live game panel |
| 8 | `safe` | Safe/fallback content — backend-authored or player-triggered |
| 9 | `ambient` | Gap-filling branded content (D-GRH-26) |

**`safe` mode clarification:**
- Backend may emit `PlannedState` with `mode: "safe"` explicitly (e.g., scheduled maintenance window, no content available).
- Player also enters `safe` templates unilaterally when connectivity is lost or data is stale (D-SAFE-01). These two paths converge on the same template family.
- D-SAFE-01 fallback behavior is unchanged: player-side trigger → same safe template chain. The safe template chain is now the `safe` mode template family.

**Amends:** D-GRH-26 (which listed modes 7 and 8 as uncertain). This decision supersedes that uncertainty.

## D-GRH-31: DisplayEvent Schema and Animation Catalog Model (2026-05-12)

**Decision:** Backend prescribes the exact animation the player runs. Player maintains a pre-baked animation catalog (built into the widget bundle per D-GRH-28). Backend references animations by `animation_id`. Server can also release new animations as assets via `AssetManifest` — these are movement-definition files (not images), encoding motion, timing, and keyframes independent of specific image content.

**DisplayEvent schema:**
```json
{
  "message_type": "DisplayEvent",
  "game_id": "uuid",
  "event_id": "uuid",
  "ts": "2026-05-12T00:04:00.000Z",
  "cue_type": "score_change | lead_change | overtime_start | game_end | badge | moment_alert | emphasis",
  "animation_id": "string — catalog entry name or AssetManifest asset_id",
  "target_element": "score_panel | game_card | badge_slot | ticker | full_overlay | game_header",
  "payload": {
    "home_score": 3,
    "away_score": 2,
    "badge_id": "uuid | null",
    "label": "OVERTIME"
  }
}
```

**Animation catalog:**
- **Pre-baked catalog** (in widget bundle): a set of named animations covering standard cues — score pulse, card emphasis, badge slide-in, lead-change flash, overtime banner reveal, game-end fade, etc.
- **Extended catalog** (via AssetManifest): backend can deliver new animation definition assets at runtime. These are movement files — e.g., Lottie JSON, CSS `@keyframes` definition files, Web Animation API keyframe descriptors — encoding motion, timing, and easing without image content.
- Player resolves `animation_id`: first checks pre-baked catalog, then checks fetched asset cache. If not found, player uses a default fallback animation for the `cue_type`.

**Badge support:**
- `cue_type: "badge"` triggers badge display on the target element.
- `payload.badge_id` references a badge asset (image) from the AssetManifest cache (sport/league badge icon sets — D-GRH-23).
- `animation_id` controls how the badge enters/exits (e.g., `"badge_slide_in_right"`).

**Amends D-GRH-23:** AssetManifest scope extends to include animation definition assets (movement files) in addition to the image/font/token assets listed in D-GRH-23. Animation assets are fetched and cached the same way as other AssetManifest assets.

**Player constraint:** Player must not trigger flashing or strobe-like effects regardless of what animation_id it receives (no-flash constraint — DYNAMIC_LAYOUT_REQUIREMENTS.md). If an animation definition would produce flashing, player must substitute a compliant default.

---

### D-GRH-32 — Late-Join Gamestate Recovery

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** D-GRH-34 (terminology: "recording container" → "Temporal workflow"), D-GRH-39 (GameDeliveryService warm cache is primary late-join path; Temporal Query is cold-start fallback)

#### Decision

When a bar player comes online mid-game, gamestate is recovered via two-phase snapshot + delta:

**Phase 1 — Snapshot on connect**

Recording container (one per game_id pod) maintains current full `GameState` in memory. This is a live projection recomputed on every `GameEvent` ingested from the broker — not a replay of the event log. On player connect:

1. GameDeliveryService detects new subscription for `game_id`
2. Pulls current `GameState` from recording container (synchronous call or in-memory cache in fan-out)
3. Pushes `GameState` snapshot to player immediately
4. Player renders from snapshot; begins accumulating `GameEvent` deltas going forward

> **Amended by D-GRH-39:** GameDeliveryService maintains a warm GameState projection cache (primary late-join path). Temporal Query is used only when GameDeliveryService cache is cold (restart recovery).

**Phase 2 — Delta catch-up**

GameDeliveryService tracks broker consumer offset per `(display_id, game_id)` subscription. On reconnect:
- If gap is within broker retention window (minutes): GameDeliveryService replays undelivered `GameEvent`s from stored offset
- If gap is long or offset lost: falls back to fresh `GameState` snapshot; intermediate deltas skipped; snapshot is authoritative

**Recording container crash recovery**

Recording container crash = in-memory GameState lost. On restart, container re-subscribes to its `game.{game_id}.events` stream from offset 0, replays all events, rebuilds full `GameState` projection. Broker is the durable log; container memory is the projection. This is standard event-sourcing pattern.

**GameStateRequest (explicit pull)**

Player may also send `GameStateRequest` at any time. GameDeliveryService proxies to recording container and returns current snapshot. Use cases: state corruption, debug/force-refresh, missed snapshot on initial connect.

#### Rationale

Recording container holding live projection means any player can be caught up with a single message regardless of how long it was offline. Player never needs to replay raw events itself — that complexity lives in the recording container only.

---

### D-GRH-33 — Message Broker: NATS JetStream (not Kafka)

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** implied Kafka reference in architecture discussion
**Amended by:** none

#### Decision

Message broker layer uses **NATS JetStream**, not Kafka.

#### Rationale

CROWDAQ message volume is low:
- ~20 simultaneous games × ~3 events/sec max = ~60 events/sec total
- Control messages (PlannedState, AdSlot, etc.) = ~1/min per bar

Kafka's strengths (JVM cluster, ZooKeeper/KRaft, partition management, Kafka Connect ecosystem, millions/sec throughput) do not apply at this volume. Kafka is operationally heavy relative to the actual workload.

NATS JetStream provides everything CROWDAQ needs:
- Durable ordered streams per subject (`game.{game_id}.events`, `bar.{bar_id}.control`)
- Replay from sequence offset (late-join and container restart recovery)
- Consumer groups (GameDeliveryService subscriptions)
- Fan-out to multiple bar subscriptions per game
- Single Go binary, ~20MB, no JVM, no separate cluster configuration required
- Scales to millions/sec if volume ever grows

#### Subject naming (unchanged)

| Subject | Publisher | Consumers |
|---|---|---|
| `game.{game_id}.events` | Recording container | GameDeliveryService |
| `bar.{bar_id}.control` | Schedule service | GameDeliveryService |

#### Operational model

- Single NATS JetStream node until cluster is actually needed
- JetStream persistence provides durability across restarts
- Retention per stream: game streams retained for game duration + buffer; control streams short TTL

---

### D-GRH-34 — Recording Layer: Temporal Workflows (not K8s Containers)

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** "recording container" terminology used in D-GRH-32
**Amended by:** none

#### Decision

The per-game recording layer uses **Temporal workflows**, not Kubernetes containers or raw processes.

One Temporal workflow runs per `game_id`. This workflow:
- Ingests live game data (scores, events) as it arrives
- Maintains current `GameState` as durable workflow state
- Executes a `PublishGameEvent` activity that publishes each `GameEvent` to NATS JetStream subject `game.{game_id}.events`

#### Architecture

```
[ Temporal Worker Process ]
  └─ Recording Workflow (one per game_id)
       └─ PublishGameEvent Activity
            └─ nats.Publish("game.{game_id}.events", event) ──→ [ NATS JetStream Server ]
                                                                       └─ GameDeliveryService subscribes
```

Temporal and NATS JetStream are **separate deployed services**. The Temporal worker process executes activities that call the NATS client library. NATS is not embedded in or hosted by Temporal.

#### Separation of responsibilities

| Layer | Owns |
|---|---|
| Temporal workflow | Durability, GameState projection, retries, crash recovery, workflow lifecycle |
| NATS JetStream | Fan-out, subscriptions, broker retention, delivery to GameDeliveryService |

#### GameStateRequest maps to Temporal Query

`GameStateRequest` (player → fan-out → backend) resolves as a **Temporal Query** against the running workflow for `game_id`. Temporal Queries are synchronous reads of current workflow state — no separate snapshot store needed. This replaces the "recording container HTTP call" described in D-GRH-32.

#### Crash recovery

Temporal workflow history is the event log. On worker restart, Temporal replays workflow history to restore `GameState` projection. No manual event replay from NATS required for workflow state recovery. NATS retention still needed for fan-out consumer offset catch-up (D-GRH-32 Phase 2).

#### Rationale

Temporal was already in the stack for recording jobs. Using Temporal workflows gives durable execution, crash-safe state, and built-in lifecycle management without additional per-game infrastructure. Temporal Queries provide a clean synchronous interface for `GameStateRequest` without a separate snapshot endpoint.

---

### D-GRH-35 — GameScheduler Service

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** D-GRH-71

#### Decision

A dedicated **GameScheduler** service is responsible for determining which games to record and starting Temporal recording workflows ahead of game time.

**Responsibilities:**

1. Aggregates all bar preference profiles (sports, local teams, leagues, tournaments) from the central bar profile store
2. Filters the fixture feed against aggregated preferences to determine which games need recording
3. Schedules `temporal.StartWorkflow(game_id)` at `scheduled_at - lead_time` (lead time configurable system-wide, default 15–30 min before start)
4. Accepts manual operator recording requests (operator can force-record any game_id regardless of preference match)
5. Maintains a local durable schedule snapshot (SQLite or embedded KV) so it can continue operating and survive restarts during DB outage

**Lead time:** system-wide configurable, single value applies to all recordings. Not per-sport or per-game.

**Temporal workflow idempotency:** `StartWorkflow` uses `game_id` as Temporal workflow ID. Safe to call multiple times — Temporal deduplicates by workflow ID.

**DB unavailability:** GameScheduler continues running on last-known local state during DB outage. Active Temporal workflows continue unaffected (Temporal durability). New fixture/preference changes buffered via NATS until DB reconnect reconciliation.

#### Rationale

GameScheduler is single-responsibility: it knows what needs recording and when. It does not own bar preferences (those live in the bar profile store). It does not own recording execution (Temporal owns that). It bridges preference data → recording schedule.

Manual operator override capability ensures edge cases (unlisted fixtures, special events) can always be handled without system-level preference changes.

---

### D-GRH-36 — Bar Preference Change Detection: Event-Driven Primary + Hash Reconciliation Fallback

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** D-GRH-71

#### Decision

Bar preference changes are propagated to GameScheduler via two complementary mechanisms:

**Primary: event-driven via NATS**

When an admin saves bar preferences, the bar profile store:
1. Updates the DB
2. Publishes a `BarPreferencesChanged` event to NATS

Both bar players (via `ConfigPush`) and GameScheduler subscribe to this event. GameScheduler reacts immediately — no polling cadence required as the primary mechanism.

```
Admin saves bar prefs
  → bar profile store: update DB + publish BarPreferencesChanged
      → bar player: receives ConfigPush, re-applies config
      → GameScheduler: re-evaluates fixture coverage for bar_id
```

**Secondary: hash-based reconciliation on startup / DB reconnect**

Bar profile store exposes a hash or version per bar profile. GameScheduler caches per-bar hashes in its local durable store. On startup or DB reconnect:
1. GameScheduler queries DB for all bar profiles + hashes
2. Compares against locally cached hashes
3. Re-evaluates fixture coverage for any bar whose hash differs
4. Updates local cache

This catches any preference changes that occurred during GameScheduler downtime or NATS outage (missed events).

**NATS consumer offset retention:** GameScheduler retains its NATS consumer offset. On reconnect after short outage, replays missed `BarPreferencesChanged` events from last offset. Hash reconciliation is the backstop for longer outages.

**DB unavailability state machine:**

| State | GameScheduler behavior |
|---|---|
| DB available, NATS available | Normal: event-driven updates, periodic hash check |
| DB unavailable, NATS available | Operates on local state; applies incoming NATS events to local store; no full re-sync |
| DB unavailable, NATS unavailable | Operates on local state only; no new preference updates applied |
| DB reconnects | Full hash reconciliation; replay missed NATS events from offset |

**Same hash, two consumers:** the per-bar config hash used for player `ConfigPush` detection is the same hash GameScheduler uses for reconciliation. Single hash maintained by bar profile store, consumed by both.

#### Rationale

Polling cadence alone is fragile — missed changes during downtime accumulate. Event-driven alone is fragile — missed events during NATS outage leave GameScheduler stale. Combining both gives low-latency updates in the normal path and correctness guarantees on recovery. Local durable state ensures GameScheduler can continue operating and recover correctly regardless of which external systems are temporarily unavailable.

---

### D-GRH-37 — Bar Profile Store: Central CROWDAQ DB (No Dedicated Service)

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

Bar preference profiles are stored as tables in the **central CROWDAQ DB**. No dedicated bar profile microservice.

Consumers (GameScheduler, GameDeliveryService, schedule service, admin UI) query the central DB directly for bar preference data.

On write, a thin hook publishes a `BarPreferencesChanged` event to NATS so downstream consumers (GameScheduler, GameDeliveryService) can react without polling.

#### Rationale

Dedicated service boundary adds deployment and operational overhead not justified at current scale. Central DB with event-publishing write hook gives consumers the data they need with low complexity. Schema changes are coordinated rather than hidden behind an API contract.

---

### D-GRH-38 — GameDeliveryService: Subscribe All Games, Filter Per Player

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

GameDeliveryService subscribes to **all** `game.*.events` subjects on NATS JetStream. It does not maintain per-player selective subscriptions.

On delivery, GameDeliveryService filters which events to forward to each connected player based on that player's bar preference profile and active `PlannedState`.

#### Rationale

Per-player selective NATS subscriptions require subscription lifecycle management per connection (subscribe on connect, unsubscribe on disconnect, re-subscribe on preference change). This complexity outweighs the bandwidth saving at current game volume (~60 events/sec total). Subscribing to all game events and filtering at delivery is simpler and correct.

---

### D-GRH-39 — GameDeliveryService Maintains GameState Projection Cache

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** D-GRH-32 (primary late-join snapshot path)
**Amended by:** none

#### Decision

GameDeliveryService maintains an in-memory **GameState projection** per active `game_id`. Since it already subscribes to all `game.*.events` (D-GRH-38), it applies each arriving `GameEvent` to update `GameState[game_id]` in memory as a side effect.

**Late-join delivery (primary path):**
1. Player connects mid-game
2. GameDeliveryService delivers `GameState[game_id]` from its warm cache immediately
3. Player streams `GameEvent` deltas forward from that point

No Temporal round-trip required for normal late-join.

**GameDeliveryService restart (cold-start fallback):**
1. In-memory projection is lost
2. GameDeliveryService replays recent `GameEvent`s from NATS consumer offset to rebuild projection for recent events
3. For games running longer than NATS retention window: GameDeliveryService issues a Temporal Query to get authoritative `GameState` snapshot, then streams forward from NATS

**Roles:**

| Layer | Role |
|---|---|
| NATS JetStream | Event transport + replay buffer (not a state store) |
| GameDeliveryService | GameState projection cache + late-join snapshot delivery |
| Temporal workflow | Authoritative GameState (cold-start fallback via Temporal Query) |

#### Rationale

GameDeliveryService is already receiving all game events (D-GRH-38). Maintaining a projection is a natural consequence — no additional infrastructure needed. This makes late-join delivery fast (in-process cache lookup, no external call). Temporal Query remains the authoritative backstop for cold-start recovery.

---

### D-GRH-40 — BarPlayerSchedulerService: Pre-Computed Schedule Engine

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** "schedule service" references in prior decisions
**Amended by:** D-GRH-41 (storage model + no companion TCP server; delivery via GameDeliveryService)

#### Decision

A dedicated **BarPlayerSchedulerService** generates a full pre-computed schedule per bar covering a configurable horizon (24 hours, one week, or longer). This replaces the simpler "schedule service" referenced in prior decisions.

**Inputs:**

| Input | Source |
|---|---|
| Bar preferences (sports, leagues, tournaments) | Central CROWDAQ DB (D-GRH-37) |
| Fixture availability | Fixture feed / FixtureList |
| Local team weighting | Rules system — rules define local team per bar with numeric weight score |
| Bar-specific rules | Rules system (specificity hierarchy: state/region rules overridden by bar-specific rules) |
| Ad requests / ad inventory | Ad inventory store |
| Manual admin override | Admin UI / operator action |

**Output:** a full timeline of `PlannedState` + `ProgramSlot` + `AdSlot` transitions per bar, delivered to players as `ScheduleWindow` messages (existing protocol).

**Schedule generation trigger:** event-driven primary + periodic sweep fallback (C):
- Reacts to: `BarPreferencesChanged`, fixture status transitions (`scheduled→live`, `live→final`, `postponed`), new fixture availability, rule changes, ad inventory changes, manual admin override
- Periodic sweep: catches any missed events and handles time-based expiry

**Reprocessing on live deviation:** full reprocess on any game lifecycle event. When a game goes `live`, `final`, or `postponed`, BarPlayerSchedulerService reprocesses the schedule for all affected bars and pushes a new `ScheduleWindow` immediately.

**Local team weighting:**
- Local team for a bar is resolved from the rules system (e.g., rule targeting all bars in Kansas → Chiefs/NFL; bar-specific override rule → Patriots/NFL)
- Weight is a numeric score defined in the rule (not a hard categorical priority)
- When multiple games compete for the same slot, BarPlayerSchedulerService ranks by weight score
- Numeric weight handles: two local games competing (e.g., Chiefs + Royals both live), championship games outranking low-stakes local games via operator-set override weight

**Patron interest weight:** same numeric weight system. Higher weight = higher priority for primary `PlannedState` slot assignment.

#### Rationale

A pre-computed schedule horizon means bar players always have context for what comes next — not just the current `PlannedState`. `ScheduleWindow` is already defined in the protocol for this purpose. Full reprocessing on game lifecycle events ensures the schedule stays accurate without requiring player-side deviation logic. Rules-based local team assignment with numeric weights gives operators precise control over scheduling priority without hard-coded categorical rules.

---

### D-GRH-41 — BarPlayerSchedulerService: Storage Model and Schedule Delivery

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** two-connection model (retracted), companion TCP server component (retracted)
**Amended by:** none

#### Decision

**BarPlayerSchedulerService is a Temporal workflow only.** No companion TCP server component. Schedule delivery to bar players is handled entirely by GameDeliveryService over the single player connection.

**Storage tiers:**

| Tier | What | Retention | Purpose |
|---|---|---|---|
| DB (hot) | Yesterday + today + tomorrow ScheduleWindow per bar | ~3 days rolling | Player connect lookup; admin manual injection |
| Disk (journal) | Compressed daily chunks per bar | 30 days | Audit trail, debug, replay |

Schedule is written in 24-hour chunks. Previous day chunk is compressed on rotation. Disk journal is never queried in normal operation.

**DB for admin injection:** admin can write directly to the DB hot tier to inject or modify schedule entries. BarPlayerSchedulerService picks up injected changes on next evaluation cycle.

**Delivery flow:**

```
Temporal Workflow (BarPlayerSchedulerService)
  → generates/reprocesses schedule
  → writes ScheduleWindow to DB (hot) + disk journal (cold)
  → publishes ScheduleWindowReady to NATS bar.{bar_id}.control

GameDeliveryService
  → subscribes to bar.{bar_id}.control
  → on ScheduleWindowReady: fetches ScheduleWindow from DB, pushes to connected player
  → on player connect: fetches current ScheduleWindow from DB, delivers immediately
```

**Two-connection model retracted.** Original motivation was avoiding choking a single connection with high-frequency game events. Actual volume (~180 events/min across 3 games = 3 events/sec) is trivially low. A single WebSocket connection per player handles both game data and schedule without contention.

#### Rationale

BarPlayerSchedulerService has no business managing player connections — that is GameDeliveryService's concern. Temporal workflow writes to DB; GameDeliveryService reads from DB and delivers. Clean boundary. DB hot tier enables admin injection without requiring BarPlayerSchedulerService to be running at inject time.

---

### D-GRH-42 — GameDeliveryService: Go Process, Single Connection, JSONL Wire Format

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

GameDeliveryService is a **standard Go server process** — not a Temporal workflow.

**Why not Temporal:** Temporal is designed for durable business logic at low-to-medium frequency. GameDeliveryService manages persistent TCP connections and relays real-time events. Every Temporal workflow step is persisted to history — applying that to high-frequency I/O fan-out is unnecessary overhead. Go's goroutine model is the right fit for concurrent connection management.

**Single connection per player:** each bar player maintains one persistent WebSocket connection to GameDeliveryService. All message types are multiplexed over this connection.

**Wire format: JSONL.** Each message is one JSON object terminated by a newline (`\n`). Message type is identified by the `message_type` field already present on all protocol messages. This applies to all message types delivered over the connection:

- `GameEvent`
- `GameState`
- `ScheduleWindow`
- `PlannedState`
- `AdSlot`
- `ProgramSlot`
- `DisplayEvent`
- `Heartbeat`
- `ConfigPush`
- `AssetManifest`
- `SyncRequest`
- `OverrideInjection`
- `MessagingLane`
- `ScheduleWindowReady` (internal signal, not player-facing)

**Internal architecture:**

```
GameDeliveryService (Go process)
  ├─ NATS consumer: game.*.events → update GameState[game_id] (in-memory projection)
  ├─ NATS consumer: bar.{bar_id}.control → forward control messages to connected player
  ├─ WebSocket listener
  │    └─ goroutine per player connection
  │         → on connect: fetch + deliver ScheduleWindow from DB
  │         → on connect: deliver GameState snapshot for active games
  │         → stream incoming NATS messages to player as JSONL
  └─ GameState map[game_id]GameState (in-memory, updated from NATS events)
```

**Horizontal scaling:** multiple GameDeliveryService instances, sharded by `bar_id` or `display_id` (consistent hash). Player reconnect delivers snapshot + NATS offset replay regardless of which instance it lands on.

**Crash recovery:** connection state is in-memory. On instance crash, player reconnects, receives fresh ScheduleWindow from DB and GameState snapshot. No Temporal required — NATS offset replay + DB read handles full recovery.

#### Rationale

Go's concurrency model (goroutines, channels) is purpose-built for this pattern. JSONL is simple, streamable, and consistent with the existing protocol message design. Single connection per player minimizes client complexity — one reconnect loop, one auth flow, one message dispatch. Actual event volume (~180 events/min) does not justify a separate connection for schedule vs game data.

---

### D-GRH-43 — Network Authentication: Tailscale (No Application-Level Auth on Player Connection)

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

All CROWDAQ backend services and bar players communicate over the **Tailscale tailnet**. Tailscale provides WireGuard-based encryption and device identity at the network layer.

No application-level authentication is required on the GameDeliveryService WebSocket connection. Tailscale device membership is the authentication boundary.

**Player connection handshake:**
1. Bar player connects to GameDeliveryService WebSocket endpoint over tailnet
2. Player sends `display_id` in the connection handshake message
3. GameDeliveryService resolves `bar_id` from central CROWDAQ DB using `display_id`
4. Connection is established; player receives `ScheduleWindow` and begins receiving game data

No token, no JWT, no client certificate needed at the application layer.

#### Rationale

Tailscale handles encryption and device authentication at the network layer. Application-level auth would be redundant overhead. This is consistent with the constraint that no long-lived secrets should be provisioned on bar player VMs (bar = adversarial physical environment). Tailscale device enrollment is the provisioning step; no additional credential management is needed.

---

### D-GRH-44 — FixtureSyncService: External Sports API Polling, Two-Tier Cadence

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

A dedicated **FixtureSyncService** polls an external sports data API for fixture list and game status. It is the sole writer of fixture data to the central CROWDAQ DB.

**Responsibility:** fixture list + game status only (`scheduled`, `live`, `final`, `postponed`). Live game event data (scores, moments) is a separate integration owned by the Temporal recording workflow (D-GRH-45).

**Polling cadence (two fixed tiers):**

| Tier | Fixtures | Cadence |
|---|---|---|
| Cold | Scheduled start > 24h from now | Daily |
| Hot | Scheduled start ≤ 24h from now (same-day) | Every 60 seconds |

Same-day cadence catches `scheduled → live` status transitions quickly enough for GameScheduler to start the Temporal recording workflow at `scheduled_at - lead_time` (D-GRH-35).

**On status change detected:**
1. FixtureSyncService updates fixture record in central DB
2. Publishes `FixtureStatusChanged` event to NATS with `game_id`, `previous_status`, `new_status`, `scheduled_at`
3. GameScheduler subscribes → schedules or cancels Temporal workflow accordingly
4. BarPlayerSchedulerService subscribes → reprocesses affected bar schedules

**Vendor:** external sports data API provider (TBD). Vendor identity is a procurement decision and does not affect architecture. FixtureSyncService normalizes external data to CROWDAQ FixtureList schema before writing to DB.

#### Rationale

FixtureSyncService is a single-responsibility integration adapter. Centralizing fixture writes prevents multiple services from maintaining independent stale copies of fixture state. Two-tier cadence balances API rate limits against the need for timely same-day status detection.

---

### D-GRH-45 — Temporal Recording Workflow: Live Event Stream Integration

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

The Temporal recording workflow (one per `game_id`, started by GameScheduler per D-GRH-35) connects **independently** to a live event stream from a sports data provider. This is a separate integration from FixtureSyncService.

**Transport:** push-based WebSocket or server-sent event stream from the sports data API (not REST polling). Provider may be the same vendor as FixtureSyncService or different — vendor identity is a procurement decision.

**Workflow responsibilities on live stream:**
1. Connect to live event stream for `game_id` at workflow start
2. Ingest incoming game events (score changes, period transitions, moments, etc.)
3. Update in-memory `GameState` projection on each event
4. Execute `PublishGameEvent` activity: publish normalized `GameEvent` to NATS `game.{game_id}.events`
5. Maintain workflow until game status = `final` + drain window

**Separation from FixtureSyncService:**

| Service | Data | Transport |
|---|---|---|
| FixtureSyncService | Fixture list, game status | REST polling |
| Temporal recording workflow | Live game events, scores | Push stream (WebSocket/SSE) |

These are different transport patterns and different data concerns. FixtureSyncService does not forward live event data to the recording workflow — the workflow connects to the live stream directly.

#### Rationale

Live event data requires push-based streaming (low latency, continuous delivery). Polling is inappropriate for per-event game data. The Temporal workflow is the natural owner of this connection — it is already long-running per game, manages state, and handles retries and crash recovery natively.

---

### D-GRH-46 — Live Stream Disconnection Recovery

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

When the Temporal recording workflow's live stream connection drops, the system uses **A + C combined**:

**A — Temporal activity retry with backoff:**
- The `ConnectLiveStream` activity fails with a retriable error on disconnect
- Temporal retries the activity with exponential backoff (configurable schedule)
- Workflow execution continues; no workflow restart required
- Temporal handles crash recovery natively if the workflow worker itself restarts

**C — GameDeliveryService stale-state signal:**
- When the recording workflow detects stream loss, it signals GameDeliveryService (via NATS `game.{game_id}.events` or a dedicated control subject) that game data is stale
- GameDeliveryService propagates a `GameDataStale` message to all connected bar players subscribed to that game
- Players display last-known `GameState` with a "data unavailable" indicator until stream recovers
- On stream reconnect, the workflow publishes a `GameDataRestored` signal; players clear the stale indicator and resume live updates

#### Rationale

A alone (retry) is invisible to bar screens — they continue showing stale data without any indication. C alone (indicator) without retry means manual intervention is needed for recovery. Combined: the workflow self-heals silently when stream reconnects quickly; for longer outages, bar screens show an honest state rather than confidently-wrong live data.

The stale indicator is a UX safety valve, not an alarm. It disappears automatically on recovery.

---

### D-GRH-47 — Rules System Structure

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

Rules use **B + C combined**: a **condition + action model** organized as a **priority-ordered list with scope hierarchy**.

**B — Condition + action model:**
Each rule is a structured object:
```json
{
  "rule_id": "...",
  "scope": "state:TX",
  "condition": { "sport": "NFL", "team": "Dallas Cowboys" },
  "action": { "weight_delta": 25 },
  "priority": 10
}
```
- `condition`: match criteria (sport, league, team, tournament, time window, game state, etc.)
- `action`: what to apply on match (weight delta, layout override, ad suppression, etc.)
- Extensible: new condition types and action types add without changing the evaluator structure

**C — Priority-ordered list, first match wins, scope hierarchy global → state/region → bar:**
- Rules are evaluated in priority order (lower number = higher priority)
- First rule whose condition matches wins; evaluation stops
- Scope hierarchy: `global` → `state:{code}` → `region:{id}` → `bar:{bar_id}`
- Bar-level rules override region, region overrides state, state overrides global
- Local team assignment (per D-GRH-40) is expressed as a rule: `scope: "bar:{id}", condition: {team: "Patriots"}, action: {weight_delta: N}`

#### Rationale

A pure numeric scoring system (A) with no structure makes rules opaque and hard to audit. Condition+action (B) makes each rule's intent legible. Scope hierarchy (C) provides override semantics without requiring full rule duplication per bar — global defaults + targeted overrides is the expected authoring pattern. First-match-wins is simpler to reason about than additive scoring across all matching rules.

---

### D-GRH-48 — Channel Architecture: One Physical Connection, Two Logical Channels

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** PRD "Two independent channels" wording
**Amended by:** none

#### Decision

The bar player maintains **one physical WebSocket connection** to GameDeliveryService. All messages — schedule orchestration, game data, control, config, overrides, heartbeat, asset manifests, messaging — are multiplexed over this single connection using JSONL.

The PRD distinction between "control channel" and "game data channel" is a **logical channel distinction**, not a physical one. The `message_type` field on every JSONL message serves as the channel discriminator. Players route messages internally by `message_type`.

There is no second WebSocket connection. The two-connection model was retracted in D-GRH-41.

**Logical channels (on one physical connection):**

| Logical channel | Message types |
|---|---|
| Control | `ScheduleWindow`, `PlannedState`, `ProgramSlot`, `AdSlot`, `OverrideInjection`, `AssetManifest`, `MessagingLane`, `Heartbeat`, `ConfigPush`, `SyncRequest` |
| Game data | `GameState`, `GameEvent`, `DisplayEvent`, `FixtureList` |
| Player → server | `DeviceRegistration`, `GameStateRequest`, `JournalSync` |

#### Rationale

~180 events/min (3 concurrent games at 1 event/sec each) creates no meaningful backpressure on a single connection. Two physical connections would add connection management overhead, complicate reconnect logic, and duplicate handshake/auth without benefit. Logical separation via `message_type` is sufficient for player routing and future channel prioritization.

#### Impact on PRD

The PRD section "Channel Architecture" (under Server-Player Protocol Schema) uses the phrase "Two independent channels" — this should be read as two logical channels over one physical WebSocket, not two physical connections.

---

### D-GRH-49 — Player Reconnect Re-Sync: Server-Initiated Full Re-Push

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

On WebSocket reconnect, GameDeliveryService detects the new connection for a known `display_id` and immediately re-pushes the full current state without waiting for player requests:

1. `ConfigPush` — current player configuration
2. `ScheduleWindow` — current active rolling window
3. All `PlannedState` entries from the current slot index onward within the active window
4. `GameState` for every active game currently being delivered to this bar
5. `AssetManifest` — current asset manifest

The player is passive on reconnect. It receives the server push and resumes execution from the delivered state.

**GameState gap recovery:** After the re-push, if the player detects a seq discontinuity in subsequent `GameEvent` deltas (i.e., missed events during the disconnect window), it sends a `GameStateRequest` as already defined (D-GRH-32, D-GRH-39). The full `GameState` in the re-push provides a baseline; `GameStateRequest` handles any delta gaps.

**Heartbeat resumes** on the normal cadence after re-push completes. Ongoing hash-based convergence (schedule hash, config hash, asset manifest hash) handles any drift after reconnect.

**`DeviceRegistration`** is only sent on first connect (new device or full widget reload), not on every reconnect. GameDeliveryService uses `display_id` from the connection handshake to identify known vs new devices.

#### Rationale

Server-initiated re-push eliminates a round-trip for critical path freshness. The player has no way to know what changed during the disconnect window — a server push is authoritative and immediate. `GameStateRequest` for delta gaps is a lightweight fallback only needed when the reconnect window spans missed events. No new message types required; all messages already exist.

---

### D-GRH-50 — PlannedState Transition Object: Flat Catalog Name

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

`PlannedState.transition` is a flat object with two fields:

```json
"transition": {
  "animation_id": "slide_stagger_in",
  "duration_ms": 600
}
```

- `animation_id`: named variant from the animation catalog (same catalog as `DisplayEvent.animation_id`, defined in D-GRH-31)
- `duration_ms`: total transition duration; backend authors the value; player executes exactly

The animation catalog is a flat namespace. Names encode family and variant in a single string (e.g., `"fade_scale_up"`, `"card_reshuffle"`, `"wipe_left"`). No two-level family/variant split is needed.

New animation variants are added to the catalog via AssetManifest (D-GRH-23, D-GRH-31) without widget redeploy. Pre-baked animations ship in the widget bundle; extensible animations are Lottie/CSS keyframe assets.

`transition` is required on every `PlannedState`. Backend must always supply a named variant — the player does not invent its own transition.

#### Rationale

A flat `animation_id` string is sufficient. A two-level family/variant split (B) adds encoding complexity with no behavior difference — the catalog name already encodes both. Phase-level breakdown (exit/enter/overlap durations) is deferred; single `duration_ms` covers v1 needs. Using the same catalog model as `DisplayEvent` keeps the player's animation executor uniform.

---

### D-GRH-51 — Theme Resolution: CSS File Per Theme via AssetManifest

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

Each theme is delivered as a **compiled CSS file** included in the `AssetManifest`. The player resolves `PlannedState.theme_id` to a CSS file by looking up the asset keyed by `theme_id` in the manifest.

**Mechanism:**
- AssetManifest includes one CSS asset per theme (e.g., `asset_id: "theme_dark_sport"`, `url: ".../themes/dark_sport.css"`)
- Player downloads and caches the CSS file on AssetManifest receipt (same lazy-pull, long-TTL model as all other assets — D-GRH-23)
- On `PlannedState` render, player swaps the active theme stylesheet (swap a `<link>` tag or inject a `<style>` block) before rendering the template
- Cache invalidation via version bump in AssetManifest (D-GRH-23)

**Backend owns the full CSS compilation.** Token → CSS variable resolution happens server-side. The player is a pure CSS consumer — no token parsing, no variable injection logic.

**`PlannedState.theme_id` three-state rule** (already defined in PRD Key Protocol Rules) applies:
- `"string"` — use named theme CSS file
- `null` — inherit from bar profile default theme
- `"__unset__"` — revert to system default theme

Bar profile default theme is resolved by GameDeliveryService and delivered as a `theme_id` string; the player never resolves bar preferences directly.

#### Rationale

Full CSS file delivery is the simplest player implementation: swap one stylesheet, render. No token schema awareness required on the player side. Backend handles the design system compilation step, which is where it belongs. AssetManifest versioning already provides cache invalidation without extra protocol machinery.

---

### D-GRH-52 — Journal Sync Transport: HTTP POST

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

Journal sync uses **HTTP POST** to a dedicated `/journal/sync` endpoint — not the WebSocket connection.

**Transport:**
- Player batches unsynced journal rows (append-only JSONL)
- Fires HTTP POST to `/journal/sync` on heartbeat cadence or when unsynced backlog crosses a threshold
- Server responds with ACK confirming the accepted seq range
- Player marks confirmed rows as synced; retains acknowledged history per retention model (7-day / 250 MB)
- Standard HTTP retry with backoff on failure

**Encoding:** gzip-compressed JSONL body. `Content-Encoding: gzip`, `Content-Type: application/x-ndjson`.

**Transport separation rationale:**
The WebSocket (D-GRH-42, D-GRH-48) is reserved for latency-sensitive orchestration: PlannedState delivery, game events, heartbeat, config, overrides. Journal sync is high-volume, batch-oriented, and tolerates latency. Separating transports avoids head-of-line blocking on the live orchestration stream and allows the journal ingest path to scale independently.

**DeviceRegistration / auth:** HTTP POST carries the same `display_id` as the WebSocket handshake. Tailscale provides network-layer auth (D-GRH-43) — no additional token needed.

#### Rationale

HTTP POST is better suited to bulk data upload: standard compression, simple retry semantics, no HOL blocking on live stream, independent scaling. The two-transport model (WebSocket for live orchestration + HTTP for bulk sync) serves different data profiles without compromising either.

---

### D-GRH-53 — GameDeliveryService Scaling: Full Subscription, No Bar Affinity

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** "horizontally scaled by bar_id" wording in D-GRH-42
**Amended by:** none

#### Decision

Every GameDeliveryService instance subscribes to **all** `game.*.events` subjects on NATS and maintains a full in-memory `GameState` projection for all currently active games (D-GRH-38, D-GRH-39).

**Scaling model:** standard connection load balancing. Any instance can serve any player. No bar_id affinity, no sticky sessions required.

**Reconnect behavior:** a player reconnecting to any instance receives a correct full re-push (D-GRH-49) because every instance maintains the same complete game state. No instance migration or state hand-off needed.

**Memory cost:** active game count at current scale is ~5–20 games. GameState per game is small (< 10 KB). Total in-memory game state per instance: < 200 KB. Negligible. Revisit selective subscription only if active game count grows into the hundreds.

**Amends D-GRH-42:** "horizontally scaled by bar_id" was imprecise. Correct model: instances are stateless with respect to bar affinity; horizontal scaling adds connection capacity uniformly.

#### Rationale

Full subscription eliminates sticky session complexity, simplifies reconnect logic, and trivializes NATS consumer setup. At current active game scale the memory cost is negligible. Affinity-based partitioning adds operational complexity with no benefit until scale demands it.

---

### D-GRH-54 — BarPlayerSchedulerService Schedule Build Triggers

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

BarPlayerSchedulerService rebuilds the schedule for a bar on any of the following triggers:

**Event-driven triggers (primary):**
1. **Game lifecycle event** — any game status transition (`scheduled→live`, `live→final`, etc.) that affects a bar's sport/league filter scope (D-GRH-40)
2. **`BarCreated`** — new bar device registered; no existing ScheduleWindow; immediate build required
3. **`BarPreferencesChanged`** — bar config or preference change (sport/league filters, theme, ad selection, rules overrides); already defined as a NATS event in D-GRH-36; schedule must reflect updated preferences immediately
4. **Service restart bootstrap** — on startup, scan for any bar missing a valid ScheduleWindow (window_end < now + buffer); trigger build for each

**Reconciliation trigger (safety net):**
5. **Daily cron** — once per day, reprocess all bars; catches any missed events, fixture-only stretches with no lifecycle events, drift from external fixture data updates

**Trigger precedence:** all triggers produce the same full-reprocess outcome per bar (D-GRH-40 — full reprocess on any trigger). No partial update path.

**Deduplication:** if multiple triggers fire for the same bar within a short window (e.g., several `BarPreferencesChanged` events in rapid succession), the service coalesces to a single reprocess. Implementation detail; no protocol impact.

#### Rationale

`BarCreated` and `BarPreferencesChanged` cover the two non-game lifecycle cases that require an immediate response: a new bar coming online and an operator changing a bar's configuration. Without these, a new bar would have no schedule until the next cron pass or a coincidental game lifecycle event. Daily cron as a reconciliation pass catches edge cases without requiring exhaustive event coverage.

---

### D-GRH-55 — Ad Creative Asset Delivery: asset_id Phase 1, URL Deferred

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

**Phase 1 (centrally managed ads):** `AdSlot.ad_ref` is an `asset_id` referencing an entry in the `AssetManifest`. Ad creatives (image, video, HTML bundle) are uploaded by central admin and delivered to players via the standard AssetManifest mechanism (D-GRH-23) — versioned, long TTL, pre-fetched before the ad window opens.

Player renders ads from local cache. Ad rendering is fully offline-safe.

**Phase 2/3 (bar-level selection, self-service publishing):** `AdSlot` schema will be extended with an explicit `ad_ref_type` discriminator field:

```json
"ad_ref": "some_id_or_url",
"ad_ref_type": "asset_id"   // phase 1
// future: "ad_ref_type": "url"
```

External URL support deferred until bar-level ad selection or self-service ad publishing requires it. No protocol ambiguity in v1 — `ad_ref_type` absent = `asset_id`.

**Admin workflow (phase 1):** Central admin uploads creative asset via admin UI → backend assigns `asset_id` → backend authors `AdSlot` with `ad_ref: asset_id` → AssetManifest updated → player pre-fetches before ad window.

#### Rationale

`asset_id` via AssetManifest keeps ad rendering consistent with all other asset delivery: offline-safe, versioned, pre-fetched with `needed_by` timing. External URL delivery requires player-side connectivity at render time and more complex cache management. Deferring URL support to when self-service ads demand it avoids over-engineering v1. The `ad_ref_type` discriminator field makes the future extension non-breaking.

---

### D-GRH-56 — OverrideInjection Schema: PlannedState Fields + fires_at

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

`OverrideInjection` carries the same render fields as `PlannedState` plus a `fires_at` timestamp. It is not a separate render instruction format — it is a queued PlannedState with a scheduled activation time.

**Schema (fields inherited from PlannedState + fires_at):**
```json
{
  "message_type": "OverrideInjection",
  "override_id": "...",
  "fires_at": "2026-05-12T20:30:00Z",
  "interrupt_class": "exceptional_override",
  "business_mode": "single_game",
  "template_id": "...",
  "theme_id": "...",
  "transition": { "animation_id": "...", "duration_ms": 600 },
  "program_slot_id": "...",
  "dwell_target_ms": 30000
}
```

**Asset pre-fetch:** required assets are delivered via `AssetManifest` (D-GRH-23) — a separate message sent alongside the `OverrideInjection`. The `AssetManifest` entry carries `needed_by` aligned to `fires_at` so the player knows the download deadline. `OverrideInjection` does not embed asset instructions.

**Player behavior:**
1. Receive `OverrideInjection` — queue it for execution at `fires_at`
2. Receive accompanying `AssetManifest` — begin downloading required assets
3. At `fires_at` — execute the override (render using queued fields)
4. After dwell — re-evaluate wall clock against active `ScheduleWindow`; no explicit resume pointer needed (PRD Key Protocol Rules)

#### Rationale

OverrideInjection reuses the PlannedState field set the player already renders from. No new render path required. Asset delivery is already handled by AssetManifest — there is no need to embed asset instructions in the override message.

---

### D-GRH-57 — MessagingLane Content Model: Text-Only with Display Policy

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

`MessagingLane` carries **text-only content** with a display policy. No asset dependency.

**Schema:**
```json
{
  "message_type": "MessagingLane",
  "lane_id": "...",
  "text": "Happy Hour 5–7pm — All Drafts $4",
  "display_form": "overlay",
  "dwell_ms": 8000,
  "valid_from": "2026-05-12T17:00:00Z",
  "valid_until": "2026-05-12T19:00:00Z"
}
```

**Fields:**
- `lane_id` — identifies which messaging lane (allows multiple concurrent lanes with different positioning/styling)
- `text` — plain text string; no HTML, no asset reference
- `display_form` — how the lane renders: `overlay`, `lower_third`, `ticker`, `side_rail` (player-side styling handles visual form; specific enum TBD)
- `dwell_ms` — how long the message displays before cycling or dismissing (0 = sticky until next update)
- `valid_from` / `valid_until` — time-bounded validity window; player discards message silently if wall clock is outside window

**Separation from PlannedState:** MessagingLane does not affect business mode, template, or PlannedState. It is an independent overlay layer. A new MessagingLane message replaces any prior message on the same `lane_id`.

**Central admin authors:** all MessagingLane content originates from the backend (central admin or rules-triggered). Players do not generate messaging content.

**No asset dependency:** text is embedded in the message. No AssetManifest lookup required.

#### Rationale

Text-only keeps the messaging lane simple and asset-free: no pre-fetch, no download deadline, no cache management. The display policy fields (display_form, dwell_ms, valid window) give operators enough control for typical bar messaging (happy hour, promotions, event info). Asset-bearing messaging (images, video overlays) is a future concern that can be added via a separate message type or an extended `MessagingLane` schema when needed.

---

### D-GRH-58 — Player Rendering Priority Stack

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

The player maintains three rendering layers with explicit priority:

| Priority | Layer | Source |
|----------|-------|--------|
| 1 (highest) | OverrideInjection | Queued interrupt, full-screen |
| 2 | PlannedState | Active schedule slot from ScheduleWindow |
| 3 | MessagingLane | Independent overlay(s) |

**Rules:**

- `PlannedState` (from ScheduleWindow) is the base layer. It runs continuously based on wall-clock position within the active ScheduleWindow.
- `OverrideInjection` supersedes the active `PlannedState` at `fires_at`. During its dwell, **all active `MessagingLane` overlays are suppressed** — the override occupies full screen with no competing content.
- After `OverrideInjection` dwell ends, the player reverts to the wall-clock `PlannedState` from the ScheduleWindow (Key Protocol Rules, D-GRH-56). All previously active `MessagingLane` messages whose `valid_until` has not passed automatically resume.
- `MessagingLane` overlays render on top of `PlannedState` when no override is active. Multiple lanes with different `lane_id` values coexist (different screen positions, independent cycles).
- No message is needed to resume `MessagingLane` after override dwell — validity window determines whether a lane re-renders.

**Suppression is binary:** there is no per-override `suppress_messaging_lanes` flag. All overrides suppress all lanes. This keeps the player state machine simple and the override experience unambiguous.

#### Rationale

`OverrideInjection` is an exceptional interrupt (D-GRH-56: `interrupt_class: exceptional_override`). Allowing messaging overlays to compete with an override dilutes the interrupt and creates visual noise at the moment requiring the most attention. Binary suppression is simpler to implement and test than per-override flags. MessagingLane resumption is automatic via validity window — no extra protocol message needed after override dwell.

---

---

### D-GRH-59 — Heartbeat: Bidirectional Application-Level

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

Connection health is maintained via **bidirectional application-level heartbeat** over the single WebSocket connection (D-GRH-42, D-GRH-48).

**Protocol:**

- Player sends every 30s:
```json
{ "message_type": "Heartbeat", "display_id": "...", "seq": 42 }
```
- Server responds immediately:
```json
{ "message_type": "HeartbeatAck", "seq": 42 }
```

**Detection thresholds:**
- Player: no `HeartbeatAck` within 2× interval (60s) → player closes and reconnects (D-GRH-49)
- Server: no `Heartbeat` received within 3× interval (90s) → server closes connection, emits `PlayerDisconnected` event internally

**Heartbeat carries no payload beyond identification and sequencing.** No journal state, no game data, no preference snapshot in the heartbeat message.

**seq** is a monotonically increasing integer per connection. Used only for ack correlation — not for session-level event ordering.

#### Rationale

WebSocket ping/pong (transport-level only) does not confirm the application layer is alive and processing messages. Server-only keepalive does not detect a server that is alive but stalled on outbound message processing. Bidirectional application-level heartbeat catches: dead TCP (both sides detect silence), server processing stall (player detects missing ack), player crash/freeze (server detects missing heartbeat). The 30s / 60s / 90s cadence gives reasonable detection latency without excessive keepalive traffic on a long-lived connection.

---

### D-GRH-60 — ConfigPush Content: Bar Profile Snapshot

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** D-GRH-72

#### Decision

`ConfigPush` carries a **bar profile snapshot** — the minimal set of preferences the player needs to render correctly and detect configuration drift.

**Schema:**
```json
{
  "message_type": "ConfigPush",
  "bar_id": "...",
  "display_id": "...",
  "preferences": {
    "theme_id": "dark_sport",
    "sports": ["soccer", "basketball"],
    "leagues": ["EPL", "NBA"],
    "region": "us-midwest"
  },
  "config_hash": "abc123"
}
```

**When sent:** as part of the full re-push on reconnect (D-GRH-49), and on initial DeviceRegistration. Also sent standalone when `BarPreferencesChanged` (D-GRH-36) is processed by GameDeliveryService — player receives updated preferences without a full reconnect.

**`config_hash`** matches the per-bar hash defined in D-GRH-36. Player stores the received hash; if a subsequent `ConfigPush` hash differs, player resets any locally cached preference-derived state and applies the new profile.

**Rules not included.** Active rules are evaluated server-side (D-GRH-47). The player does not re-evaluate rules client-side. `ConfigPush` carries only the resolved preference snapshot, not the rule definitions that produced it.

**`preferences` fields:**
- `theme_id` — resolved theme (string / null = bar default / `"__unset__"` = system default; same three-state rule as D-GRH-51)
- `sports` — list of sport identifiers the bar shows
- `leagues` — list of league identifiers
- `region` — geographic region string (used for local team weighting rule context, D-GRH-47)

#### Rationale

Preferences are resolved server-side (D-GRH-47 rules engine); the player only needs the resolved output, not the rules themselves. Embedding rules in ConfigPush (B) would require the player to implement rule evaluation logic — unnecessary complexity. Embedding preferences in ScheduleWindow (C) would require a full ScheduleWindow re-delivery whenever preferences change — ConfigPush as a standalone message is more targeted. The `config_hash` ties ConfigPush to the D-GRH-36 drift detection model without adding a new hashing scheme.

---

### D-GRH-61 — DeviceRegistration Handshake: Player-Initiated Message, Direct Re-Push Response

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

On first connect, the player sends a `DeviceRegistration` message. The server responds with the full re-push sequence directly — no separate `RegistrationAck` message.

**Player sends (first message after WebSocket open):**
```json
{
  "message_type": "DeviceRegistration",
  "display_id": "bar-007-screen-1",
  "player_version": "1.4.2",
  "capabilities": ["jsonl"]
}
```

**Server responds with full re-push sequence (same as reconnect re-push, D-GRH-49):**
1. `ConfigPush` (D-GRH-60)
2. `ScheduleWindow`
3. `AssetManifest` (D-GRH-23)
4. Active `PlannedState`(s)
5. Active `GameState` snapshot(s)

No `RegistrationAck` message. The `ConfigPush` arriving first serves as implicit confirmation that the server accepted the registration.

**Reconnect vs first connect distinction (D-GRH-49):**
- First connect: player sends `DeviceRegistration`
- Subsequent reconnects: player sends `DeviceRegistration` again (same message) — the server uses the `display_id` to determine the bar_id and always responds with the full re-push sequence regardless of whether this is a first connect or a reconnect

**`capabilities` field:** reserved for future protocol negotiation (e.g., compression, alternate serialization). In v1 the only valid value is `"jsonl"`. Server ignores unrecognized capabilities without error.

**`player_version`:** logged server-side for operational visibility (fleet version tracking, rollout monitoring). No protocol behavior gates on player version in v1.

#### Rationale

No `RegistrationAck` keeps the handshake minimal — the server immediately begins delivering state rather than round-tripping an acknowledgement that carries no new information. The `ConfigPush` as the first re-push message serves as implicit ack. Using `DeviceRegistration` on every connect (first and reconnect) unifies the connect path: the server always handles the same message, always responds the same way, and the player has one code path for establishing a session.

---

### D-GRH-62 — Ad Window Timing: AdSlot as First-Class PlannedState Slot, Server Pre-Computed

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

`AdSlot` is a **first-class `PlannedState` slot** within the `ScheduleWindow`. Ad timing is pre-computed server-side by `BarPlayerSchedulerService` (D-GRH-40). The player executes the schedule without ad-insertion logic.

**AdSlot as PlannedState slot:**
- An `AdSlot` entry in `ScheduleWindow` has `fires_at`, `dwell_target_ms`, `business_mode`, `template_id`, and `transition` — the same fields as any other `PlannedState` slot
- `business_mode` for an ad slot is `"ad"` (a distinct business mode, consistent with the 9-mode model)
- `ad_ref` and `ad_ref_type` (D-GRH-55) are carried in the slot to identify the creative

**Server responsibility:**
- `BarPlayerSchedulerService` determines ad slot positions when building the `ScheduleWindow` (D-GRH-40)
- Ad timing accounts for: bar ad selection preferences (D-GRH-36, D-GRH-60), ad inventory availability, dwell rules, adjacent content context (e.g., don't cut a live goal moment for an ad)
- The player receives a complete schedule with ads already interleaved — no runtime ad-injection decision on the player side

**Player responsibility:**
- Execute `PlannedState` slots in wall-clock order
- Render an `AdSlot` the same way as any other slot: apply transition, render template, dwell
- No ad-inventory awareness, no dwell-elapsed ad triggers, no local ad-insertion logic

**No `AdWindowOpen` / `AdWindowClose` messages.** Ad timing is not communicated as separate control messages at runtime — it is baked into the ScheduleWindow.

#### Rationale

Pre-computing ad timing server-side keeps the player dumb: it executes a schedule, nothing more. Ad placement logic (respecting live moments, bar preferences, inventory rules) belongs in the scheduling backend where full context is available — not in the player. Runtime ad control messages (C) would require the player to maintain ad state independently from the schedule, creating potential conflicts with ScheduleWindow slots. First-class PlannedState treatment means no special-case rendering path for ads.

---

### D-GRH-63 — GameStateRequest: Mid-Connection Seq Gap Recovery Only

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** "GameStateRequest handles delta gaps post-reconnect" in D-GRH-49
**Amended by:** none

#### Decision

`GameStateRequest` exists as a **player-to-server message for mid-connection seq gap recovery only**. It is NOT used on reconnect — reconnect triggers a full server re-push (D-GRH-49), which already includes active `GameState` snapshots.

**When the player sends `GameStateRequest`:**
- Player tracks `seq` on streaming game events received during an active (non-reconnect) connection
- If a seq gap is detected mid-connection (e.g., seq jumps from 142 to 150 with no intervening events), player sends `GameStateRequest` for the affected `game_id`
- Triggered only for games currently being rendered (in active `PlannedState`) — not proactively for all tracked games

**Schema:**
```json
{ "message_type": "GameStateRequest", "game_id": "...", "since_seq": 142 }
```

**Server response:**
```json
{ "message_type": "GameStateSnapshot", "game_id": "...", "state": { ... }, "seq": 187 }
```

- If `since_seq` is within the GameDeliveryService hot cache window (D-GRH-39) → server may return a delta; full snapshot also acceptable
- If `since_seq` is too old or not found → server returns full snapshot
- In v1, server always returns full snapshot for simplicity; delta optimization is a future concern

**Amends D-GRH-49:** "GameStateRequest handles delta gaps post-reconnect" was imprecise. Correct model: reconnect triggers full server re-push with no GameStateRequest involvement. GameStateRequest is for mid-connection seq gaps only.

#### Rationale

Reconnect already handles all post-reconnect sync (D-GRH-49 full re-push). GameStateRequest fills the remaining gap: NATS message loss or delivery anomaly during an active connection that causes a seq jump without triggering a connection drop. Reconnecting for every seq gap would be disruptive; a targeted GameStateRequest for the affected game is lighter. Full snapshot response in v1 keeps the server response logic simple — delta optimization can be added later if needed.

---

### D-GRH-64 — PlayerDisconnected: NATS Event, No Active Remediation

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

When GameDeliveryService detects a dead player connection (no `Heartbeat` within 90s per D-GRH-59, or WebSocket close frame), it:

1. Closes the WebSocket connection (if not already closed)
2. Emits a `PlayerDisconnected` event to NATS subject `bar.{bar_id}.control`
3. Takes no further active remediation

**No active reconnect.** The server does not attempt to initiate a new connection to the player. Players are responsible for detecting connection loss (D-GRH-59: no `HeartbeatAck` within 60s) and self-reconnecting.

**No schedule pause.** `BarPlayerSchedulerService` continues generating schedules for the bar regardless of player connection state. When the player reconnects, it receives a `ScheduleWindow` that is current for wall-clock time — no catch-up or replay of missed slots.

**No state reset.** GameDeliveryService discards the goroutine for the disconnected connection. All other game state, schedule state, and bar preferences remain unchanged on the server.

**`PlayerDisconnected` event consumers:**
- Ops monitoring — alerts on prolonged disconnection (dead screen detection, SLA tracking)
- Future: admin dashboard connection status indicators

**`PlayerDisconnected` NATS payload:**
```json
{
  "event": "PlayerDisconnected",
  "bar_id": "...",
  "display_id": "...",
  "disconnected_at": "2026-05-12T21:30:00Z",
  "reason": "heartbeat_timeout"
}
```

`reason` values: `"heartbeat_timeout"`, `"ws_close_clean"`, `"ws_close_error"`

#### Rationale

Players self-reconnect reliably on a Tailscale tailnet — no server-side reconnect attempt needed. Schedule generation continuing during disconnection means the player rejoins a live, current schedule on reconnect rather than a stale paused one. `PlayerDisconnected` as a NATS event keeps the signal available to any consumer (ops, future admin UI) without coupling GameDeliveryService to specific alerting infrastructure.

---

### D-GRH-65 — NATS Delivery Semantics: JetStream for All Subjects

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none; clarifies D-GRH-33
**Amended by:** none

#### Decision

All NATS subjects use **JetStream** (durable consumers, at-least-once delivery, message persistence). Core NATS is not used.

**Subjects and streams:**

| Subject | Stream | Purpose |
|---------|--------|---------|
| `game.{game_id}.events` | `GAME_EVENTS` | Recording → GameDeliveryService; game event stream per game |
| `bar.{bar_id}.control` | `BAR_CONTROL` | Schedule, preferences, ops events → GameDeliveryService |

**Why JetStream for bar.{bar_id}.control too:**
- JetStream across all subjects gives a single operational model: one NATS mode to configure, monitor, and reason about
- `bar.{bar_id}.control` carries `BarPreferencesChanged` — if GameDeliveryService restarts, JetStream replay ensures no preference change event is missed (even though the DB is authoritative per D-GRH-37, the replay avoids a forced DB query on every subject)
- `PlayerDisconnected` replayed events are idempotent (ops consumers handle duplicates)
- No split-brain between JetStream and Core NATS configuration

**Consumer model:**
- GameDeliveryService instances use a **shared durable consumer** on `GAME_EVENTS` (competing consumers — any instance processes any message; no affinity per D-GRH-53)
- GameDeliveryService instances use a **shared durable consumer** on `BAR_CONTROL`
- Temporal recording workflows publish to `GAME_EVENTS` via JetStream publish (D-GRH-34)
- BarPlayerSchedulerService publishes to `BAR_CONTROL` via JetStream publish (D-GRH-40)

**Retention:** streams retain messages for the duration of an active game + a configurable buffer (e.g., game end + 2h for `GAME_EVENTS`; 24h for `BAR_CONTROL`). Sufficient for GDS warm cache bootstrap on restart.

#### Rationale

One NATS delivery model simplifies operations: single stream configuration, single consumer management approach, single set of monitoring metrics. The overhead of JetStream for `bar.{bar_id}.control` (low-volume) is negligible. Mixing Core and JetStream would create a two-tier NATS operational model with no meaningful benefit at current scale.

---

### D-GRH-66 — BarPlayerSchedulerService Temporal Topology: Singleton Workflow

**Date:** 2026-05-12
**Status:** decided
**Supersedes:** none; clarifies D-GRH-41
**Amended by:** none

#### Decision

`BarPlayerSchedulerService` runs as a **single Temporal workflow** — a long-running singleton managing schedule generation for all bars.

**Workflow identity:**
- Workflow ID: `bar-player-scheduler` (fixed, deterministic)
- Uses **Continue-as-New** periodically to prevent Temporal history bloat (triggered on each daily cron reconciliation pass or when history exceeds a configurable event count)

**Internal state:**
- Map of `bar_id → current ScheduleWindow` for all known bars
- Rebuilt from DB on workflow start/restart (D-GRH-41 hot tier)

**Signal routing (all triggers from D-GRH-54 arrive as signals):**
- `BarCreated` → signal with `bar_id`; workflow adds bar to its map and builds initial schedule
- `BarPreferencesChanged` → signal with `bar_id`; workflow rebuilds schedule for that bar
- `GameLifecycleEvent` → signal; workflow reprocesses all affected bars
- `ServiceRestartBootstrap` → internal workflow activity on start; scans all bars, builds missing windows
- `DailyCron` → signal or Temporal cron trigger; full reconciliation pass across all bars

**Temporal Query:**
- `GetScheduleWindow(bar_id)` → returns current `ScheduleWindow` for a specific bar; used by GameDeliveryService as cold-start fallback (D-GRH-39)
- `ListAllScheduleWindows()` → returns all bar schedules; used for admin visibility

**Scale note:** at current bar count (small fleet), a singleton is appropriate. If bar count grows to hundreds, the workflow can be sharded by region or bar group without protocol changes — the signal routing and query interface remain the same.

#### Rationale

A singleton is simpler to deploy (one workflow to start, one to monitor, one to query) and sufficient at current scale. It centralizes schedule state in one place, making cross-bar reasoning (e.g., coordinated game lifecycle reprocessing) natural. Per-bar workflows would require a workflow registry or fan-out coordinator for global signals like `GameLifecycleEvent`. Continue-as-New handles Temporal's history limit constraint without requiring daily workflow restarts.

---

## D-GRH-67 — PlayerConnected NATS event

**Question:** Does the system emit a `PlayerConnected` counterpart to `PlayerDisconnected` (D-GRH-64) for ops monitoring?

**Decision:** Yes — emit `PlayerConnected` to NATS on every `DeviceRegistration` receive (option A). Every connect and reconnect produces a `PlayerConnected` event.

**Rationale:** `DeviceRegistration` already fires on every WS connection. Emitting `PlayerConnected` at that moment costs nothing extra and provides a symmetric event pair with `PlayerDisconnected` (D-GRH-64). Ops dashboards and alerting rules can subscribe to both without needing to infer presence from heartbeat stream absence.

**NATS subject:** `bar.<bar_id>.control` — same BAR_CONTROL stream defined in D-GRH-65.

**Payload:**
```json
{
  "event": "PlayerConnected",
  "bar_id": "bar-007",
  "display_id": "bar-007-screen-1",
  "connected_at": "2026-05-12T23:00:06Z",
  "player_version": "1.4.2",
  "reconnect": true
}
```

`reconnect: false` on first-ever registration for this `display_id`; `true` on all subsequent connects.

**Emitter:** GameDeliveryService, immediately after processing `DeviceRegistration` and dispatching the full re-push.

**Consumer:** Ops monitoring only — no backend business logic depends on this event in v1.

**Pair summary:**
- `PlayerConnected` → `bar.<bar_id>.control`, emitted on DeviceRegistration
- `PlayerDisconnected` → `bar.<bar_id>.control`, emitted on heartbeat timeout or WS close (D-GRH-64)

**Amends/relates:** D-GRH-61 (DeviceRegistration), D-GRH-64 (PlayerDisconnected)

---

## D-GRH-68 — Post-Game Recap Trigger Path

**Date:** 2026-05-12
**Status:** decided
**Resolves:** Open Question — Post-Game Recap Trigger Path
**Amends:** D-SCHEMA-05 (adds `"recap"` to the `business_mode` enum; drops `"enter_post_game_recap"` and `"exit_post_game_recap"` from the `interrupt_class` enum), D-GRH-54 (extends `GameLifecycleEvent` payload), automatic precedence stack (drops the `enter post-game recap layer` row at line 270 and the corresponding entries in the interrupt-classes list)
**Supersedes:** the PRD framings of post-game recap as a "transition layer, not a business mode" (lines 354–365) and as "content inside existing modes" (line 396)

### Decision

Post-game recap is a normal `business_mode` value (`recap`), not a special interrupt class or a separate transition layer. Transition into and out of recap uses `interrupt_class="scheduled_change"`. Triggering is reactive on game-final, gated by an excitement heuristic, and authored by `BarPlayerSchedulerService`.

#### Schema deltas

- `business_mode` enum gains `"recap"`.
- `interrupt_class` enum drops `"enter_post_game_recap"` and `"exit_post_game_recap"`. They are vestigial — entering and exiting a recap slot is an ordinary scheduled mode transition.
- `GameLifecycleEvent` payload gains `recap_worthy: bool` and `recap_signals: { goals, margin, red_cards, extra_time, penalties }`.
- The automatic precedence stack drops the `enter post-game recap layer` row entirely.

#### Recap PlannedState shape

```json
{
  "message_type": "PlannedState",
  "interrupt_class": "scheduled_change",
  "business_mode": "recap",
  "program_slot_id": "<same as the preceding live-game slot>",
  "template_id": "recap_card_v1",
  "dwell_target_ms": 30000
}
```

#### Content source

The player renders the recap template against its existing `GameState[game_id]` — by the time the recap slot becomes active, `GameState.status = final` and the final score, winner, goal events, and any cards/extra-time/penalties metadata are already in the player's in-memory state from the game data channel. The recap `PlannedState` carries no inlined content. The same `ProgramSlot` that drove the preceding live-game slot drives the recap slot, so the join model from D-GRH-21 stays uniform.

### Automatic trigger flow

1. `RecordFixtureWorkflow` polls API-Football and detects `matchStatus IN (FT/AET/PEN)`.
2. The workflow computes `recap_worthy = (goals >= 3) || (margin <= 1) || (red_cards >= 1) || extra_time || penalties`.
3. The workflow emits a `GameLifecycleEvent` on NATS subject `game.<game_id>.lifecycle`:
   ```json
   {
     "event": "GameLifecycleEvent",
     "game_id": "...",
     "status": "final",
     "recap_worthy": true,
     "recap_signals": {
       "goals": 5,
       "margin": 1,
       "red_cards": 1,
       "extra_time": false,
       "penalties": false
     }
   }
   ```
4. `BarPlayerSchedulerService` (the singleton workflow from D-GRH-66) receives the event as a signal via its existing `GameLifecycleEvent` handler (D-GRH-54).
5. For each bar whose current `ProgramSlot.game_ids` includes `game_id`:
   - If `recap_worthy` is `true`, the scheduler inserts a recap `PlannedState` immediately after the current live-game slot, reusing the same `program_slot_id`, with `dwell_target_ms = 30000`, and bumps downstream slots.
   - If `recap_worthy` is `false`, the scheduler does nothing; the bar advances to its next pre-planned slot when the live-game slot's dwell completes.
6. The updated `ScheduleWindow` is written to the DB hot tier (D-GRH-41).
7. `GameDeliveryService` detects the change and pushes the updated `ScheduleWindow` to the bar player over the existing WebSocket connection.
8. When the recap slot becomes active, the player renders the recap template against `GameState[game_id]`.

### Manual trigger

There is no dedicated manual-trigger API or Temporal signal for recap. Administrators inject, edit, or remove recap slots through the same schedule-authoring surface used to edit any other `ScheduleWindow` slot:

- Admin UI → schedule write API → DB hot tier write → `BarPlayerSchedulerService` picks up the change on its next evaluation cycle → updated `ScheduleWindow` is pushed to the bar player via `GameDeliveryService`.

This is the D-GRH-41 admin injection path applied verbatim. The schedule-authoring REST API itself is not designed in this decision and remains tracked under the separate "Open Question: Admin UI Design" entry.

### Scoping

Scoping is automatic via per-bar `ProgramSlot` membership. The scheduler iterates only over bars whose current `ProgramSlot.game_ids` contains the finalized `game_id`. A bar that never had `game_id` in its `ProgramSlot` never receives a recap for that game. No additional explicit scoping check is needed in the signal handler beyond the existing per-bar ProgramSlot filter.

### Recap-mode local rules

- **Blocks ads.** No `AdSlot` insertion is allowed during a `business_mode="recap"` slot's dwell window. The existing `AdSlot.blocks_recap` field documents the inverse property (an ad slot can declare that it must not be displaced by a recap), but the default mode rule is that recap dwells are ad-free.
- **Preemption.** Only `exceptional_override` (D-SCHEMA-08 / D-GRH-56) may preempt a recap slot. This is the general top-of-stack rule, not recap-specific.
- **Dwell.** Default 30 s, configurable per slot via `dwell_target_ms` within the 20–40 s range per the PRD.

### Rationale

- **Recap as `business_mode`.** Operator framing: recap is a transitive state between a game and the next event, not a special interrupt layer. Modeling it as a `business_mode` matches the schedule engine's existing vocabulary — `scheduled_change` transitions in, `scheduled_change` transitions out, no new precedence-stack rows, no parallel interrupt machinery.
- **No pre-baking.** The gating signal (`recap_worthy`) is not known until `live → final`. The scheduler cannot pre-compute recap slots at window-build time without anticipating which games will be excitement-worthy. Reactive insertion on `GameLifecycleEvent` is the minimum-state path.
- **Reuse `GameLifecycleEvent`.** D-GRH-54 already routes lifecycle events into the scheduler. Carrying one extra boolean plus a small signals struct in the payload is the smallest possible protocol delta. No new event type, no new NATS subject.
- **Scheduler-only authorship.** Recording workflow and `GameDeliveryService` are deliberately excluded from authoring `ScheduleWindow` rows. D-GRH-41's "scheduler authors, delivery delivers" boundary holds — recording emits a fact (`recap_worthy`), the scheduler turns it into a schedule edit, the delivery service ships it.
- **GameState as content source.** Removes a content-marshalling burden from the scheduler and avoids duplicating final-state data into the `PlannedState` payload. The player already has the data; the recap slot just selects a template and a dwell. Reusing the same `ProgramSlot` keeps the ProgramSlot↔PlannedState join model uniform (D-GRH-21).
- **Manual trigger = ordinary schedule edit.** Avoids creating a parallel trigger API surface. The schedule-authoring API (yet to be designed under the Admin UI open question) becomes the single way to mutate a `ScheduleWindow`, whether the mutation is a recap insertion, an ad insertion, or a content swap.
- **Boolean heuristic over engine score.** The full excitement engine is post-MVP per `crowdaq-plugin-integration.md`. A boolean computed from raw API-Football signals (goals, margin, red cards, extra-time, penalties) ships today, captures the operator's intent ("games that don't matter don't get a recap"), and can be replaced with an engine-scored threshold later without changing the wire protocol — the payload field stays `recap_worthy: bool`.

---

### D-GRH-68 — AdminGatewayService — Single Admin Write Surface

**Date:** 2026-05-13
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

A new Go process named `AdminGatewayService` is the only HTTPS surface for admin writes against the CROWDAQ backend. It owns:

- Authentication and RBAC enforcement (model to be locked in a later grill round).
- Per-endpoint input validation (statically checkable: schema, enum, bound, simple FK, syntactic). Stateful/cross-row checks (dwell-after-expansion math, rule×rule conflict, pinned-slot vs rule-output collision) run defensively in the scheduler.
- Append-only audit logging. Every admin mutation is recorded.
- Multi-protocol downstream dispatch: NATS publish for real-time messages (e.g., `MessagingLane`), DB hot-tier write for schedule and rule rows (D-GRH-41 admin injection path), Temporal signal for workflow control plane (e.g., force-reprocess on `BarPlayerSchedulerService` per D-GRH-66; manual recording request per D-GRH-35).

**Process kind:** Go process, following the D-GRH-42 precedent for `GameDeliveryService` — real-time HTTPS gateway is a different domain from durable workflow logic; Temporal is the wrong fit for inbound REST.

#### Rationale

Centralizes auth, RBAC, validation, and audit at one boundary. Scheduler-channeled (every admin write as `BarPlayerSchedulerService` signal) was rejected because the scheduler does not author message types like `OverrideInjection` (out-of-band per D-SCHEMA-08) or `MessagingLane`; routing every admin write through it adds architectural noise. Per-subsystem REST surfaces were rejected because scattering auth/RBAC across N services multiplies attack surface and audit-log fan-out.

**Pins:** every admin REST endpoint in subsequent decisions.

---

### D-GRH-69 — Schedule Authoring — Rule-Driven + Slot-Pin Override

**Date:** 2026-05-13
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

The schedule is autonomously authored by `BarPlayerSchedulerService` (D-GRH-40) from `BarPreferences` + rules (D-GRH-47, D-GRH-70) + game catalog. Admin "schedule authoring" is therefore not from-scratch authoring; it is two distinct modification paths against the auto-generated output:

1. **Slot-level edit (one-off).** Admin selects a row in the pre-computed `ScheduleWindow` and edits it directly (swap `template_id`, extend `dwell_target_ms`, replace `program_slot_id`, drop `ad_slot_id`, etc.). The edit is written to the schedule hot tier with a `pinned: true` flag. The scheduler skips pinned rows during full-reprocess. Pinned rows expire when their `ScheduleWindow` rolls off the 24-hour rolling horizon — no explicit unpin step or GC needed.
2. **Rule edit (persistent).** Admin authors or modifies a rule under D-GRH-70. Rules outlive any single `ScheduleWindow`.

**Write paths (per LCK-1 / D-GRH-68 multi-protocol dispatch):**

- Slot edit: `AdminGatewayService` → DB hot tier direct write (the D-GRH-41 admin injection path applied verbatim, identical to the recap insertion described in D-GRH-67). Scheduler picks up `pinned` rows on its next eval tick.
- Rule edit: `AdminGatewayService` → DB rules table write **plus** Temporal signal to `BarPlayerSchedulerService` (D-GRH-66) → force full-reprocess of bars in the rule's scope. Effect visible within seconds.

**Conflict between pinned slot and rule output:** pinned wins for the lifetime of the slot's `ScheduleWindow`. Admin override is intentional and short-lived by construction.

**Validation site:** statically checkable constraints in `AdminGatewayService` per D-GRH-68 (`business_mode` enum, `transition` catalog membership per D-GRH-50, `theme_id` resolvable per D-GRH-51, dwell minima per D-SCHEMA, FK integrity). Cross-row stateful checks (overlap with other pinned slots, dwell math after surrounding rows shift) run defensively in the scheduler; failures log and skip rather than crash.

**Horizon:** bounded by the rolling 24-hour `ScheduleWindow` for pinned slots. Rule edits are persistent and have no horizon. `FixtureList` 7-day lookahead (D-GRH-18) is unchanged.

**Concurrency + versioning:** last-write-wins, audit log only. No `If-Match`/ETag, no rollback API, no version stamp in phase 1. Founding-trio admin count + 24-hour pin expiry put collision probability near zero. Defer ETag and rollback to phase 2 when the admin team grows past founding-trio scale.

**Resource scope (per-bar vs shared `ProgramSlot`/`AdSlot`):** scheduler-internal implementation detail, not an admin-UI concern. Out of scope for this decision.

#### Rationale

PRD already commits: "schedule is rule-driven with overrides, not hand-authored screen-by-screen by default." The scheduler exists to convert authored intent into the wire protocol; direct CRUD on `PlannedState`/`ProgramSlot`/`AdSlot` rows would make pre-computation pointless and would break server-side ad-timing computation (D-GRH-62). The two-path model (rule for persistent shape, pinned slot for one-offs) covers admin's full use case without introducing a parallel trigger API surface (D-GRH-67 echo).

**Pins:** Surface 1 of the Admin UI grill (`ADMIN_UI_GRILL.md`). Closes Open Question: Admin UI Design bullet "Schedule authoring API".

---

### D-GRH-70 — Rules Authoring API — Two-Tier Bar Config + Conditional Rules

**Date:** 2026-05-13
**Status:** decided
**Supersedes:** none
**Amended by:** none

#### Decision

Admin authoring is split into two entity classes, both written through `AdminGatewayService` (D-GRH-68).

**Tier 1 — `BarPreferences` (per-bar static config).** Existing entity (D-GRH-36, D-GRH-60). Schema fields: `theme_id`, `sports`, `leagues`, `region`, `timezone`, `business_hours`, `local_team_list`. Single row per bar. Updated rarely (bar onboarding, infrequent operator tweaks). Carries the bar's identity-shaped attributes — what this bar is.

**Schema addition:** `BarPreferences` gains `state` (state/province code) and `city` (city slug) fields to support the phase-1 rule scope set below. The `ConfigPush.preferences` payload schema is extended in D-GRH-72.

**Tier 2 — `Rule` (conditional behavior).** New entity. D-GRH-47 shape `{scope, condition, action}`. Authored when operator wants conditional/contextual behavior beyond bare bar attributes: coverage targeting, content weighting, ad timing modifiers.

**Rule scope enum (phase 1, closed set):**

| Scope | Form | Example use |
|---|---|---|
| `all` | literal `all` | "Cover NFL globally" |
| `bar:{id}` | bar slug | Local team weight, happy-hour blackout |
| `region:{code}` | region code | "Northeast prefers New England teams" |
| `state:{code}` | state/province code | State-tier rollouts |
| `city:{slug}` | city slug | City-tier rollouts |

Deferred to phase 2 from the PRD scope-hierarchy list: `country`, `bar_type`, `display_group`, `market_cluster`, `timezone` (it is a bar attribute, not a scope), `campaign_window` (use `condition.date_range` instead), `sport_profile`, `compliance_tier`, `hw_tier`.

**Rule action vocabulary (phase 1, closed enum):**

| Action `type` | Shape | Use |
|---|---|---|
| `cover` | `{type:"cover", priority:"must"\|"normal"\|"optional"}` | Coverage targeting. Drives recording-trigger upstream as well as scheduler ordering. Filter (which sport/league/team to cover) lives in `condition`. |
| `weight` | `{type:"weight", delta:<int>}` | Patron-interest priority delta (D-GRH-47 example). Composes additively across rules at the same scope specificity. |
| `ad_window` | `{type:"ad_window", mode:"blackout"\|"force"\|"freq_override", params:{...}}` | Ad timing modifier scoped by `condition.day_of_week` + `condition.time_range`. |

Deferred to phase 2: `force_business_mode`, `template_override`, `transition_dwell_override`, `recap_emphasis`, `safe_fallback_constraint`, `prioritize_game`, plus any new actions the PRD authoring list demands when concrete operator use surfaces.

**Rule condition predicates (phase 1, closed set; AND-only):**

| Predicate | Type | Use |
|---|---|---|
| `sport` | sport slug | "Cover NFL" |
| `league` | league slug | League-tier filtering |
| `team` | team slug | "Patriots weight +20" |
| `game_id` | fixture ID | Pre-tag specific fixture |
| `day_of_week` | enum `mon`..`sun` | "Happy hour Fridays" |
| `time_range` | `{start, end}` HH:MM in bar-local TZ | "5pm–7pm" |
| `date_range` | `{start, end}` ISO date | Campaign window (e.g., March Madness span) |

No OR or NOT phase 1 — author multiple rules instead. Empty `condition: {}` means rule fires whenever its scope matches. Bar-local TZ resolution requires `BarPreferences.timezone`.

**Conflict resolution:** most-specific scope wins. Specificity order: `bar` > `city` > `state` > `region` > `all`. Per-action tiebreak at the same specificity:

- `weight`: additive across all matching rules (e.g., bar:foo +20 and region:ne +10 → +30 effective).
- `cover` and `ad_window`: last-write wins via `updated_at` (locked sub-decision 4 of Surface 2 grill).

`AdminGatewayService` may warn admin at write time when a rule is statically shadowed by a more-specific rule that already exists.

**Rule lifecycle fields:** `rule_id` (UUID, server-assigned), `name` (operator string, ≤100 chars, for admin-UI + audit log readability), `enabled` (bool, default true; pause/resume without delete), `created_at` and `updated_at` (server-assigned timestamps; the latter feeds last-write tiebreak), `created_by` (admin user id, audit). No `expires_at` (use `condition.date_range`), no `priority` (specificity is implicit), no `version` field (last-write-wins per D-GRH-69).

**Live preview / dry-run:** none in phase 1. Workflow: author rule with `enabled: false`, manually read scheduler output for one bar via the schedule read endpoint, then flip `enabled: true`. Force-reprocess signal makes the publish-observe loop seconds. Defer dry-run endpoint to phase 2 when concrete bad-coverage incidents or rule-volume growth justify the simulate-with-rule scheduler mode.

#### Rationale

PRD framing — "rules-driven scheduling with overrides, not hand-authored screen-by-screen" — pinned this two-tier split. Bar-config and conditional-rule lifecycles are different (static identity vs ongoing tuning); collapsing them into one rule entity would force everything through `{scope, condition, action}` including attributes that have no condition (a bar's timezone has no condition, just a value). Closed enums on scope, action, and condition predicates keep gateway validation tight and scheduler dispatch deterministic; each closed set is cheap to extend when concrete need lands. Specificity-based conflict resolution matches operator mental model (broad rules at `all`, narrow overrides at `bar`) without an explicit priority field that operators would have to author and reason about.

**Open architectural gap (out of scope, separate grill):** `cover` rules at scopes broader than `bar` (e.g., `all` "cover NFL") imply some service maps coverage rules + the fixture catalog to recording-workflow spawns. No locked decision currently identifies that service. D-GRH-34/D-GRH-45 define per-game recording lifecycle but not who decides which `game_id` gets a workflow. Candidates: extend `BarPlayerSchedulerService` to also plan recordings; new singleton `GameRecordingPlannerService` mirroring D-GRH-40 architecture; or trigger from `AdminGatewayService` on rule write. Locked in D-GRH-71.

**Pins:** Surface 2 of the Admin UI grill (`ADMIN_UI_GRILL.md`). Closes Open Question: Admin UI Design bullets "Rules authoring API" and "Bar preference write API" (latter is addressed by the `BarPreferences` schema addition above).

---

### D-GRH-71 — GameScheduler Coverage Driver: Rule-Driven, Not Bar-Preference-Aggregated

**Date:** 2026-05-13
**Status:** decided
**Supersedes:** none
**Amends:** D-GRH-35, D-GRH-36
**Amended by:** none

#### Decision

The GameScheduler responsibility originally stated in D-GRH-35 — "aggregates all bar preference profiles (sports, local teams, leagues, tournaments) from the central bar profile store" and "filters the fixture feed against aggregated preferences to determine which games need recording" — is **retracted**. Bar preference profiles no longer drive recording-coverage decisions.

**New coverage input: `cover` rules (D-GRH-70).** GameScheduler reads the `Rule` table, selects rules whose `action.type == "cover"`, and resolves them against the fixture catalog using D-GRH-70's specificity-aware conflict-resolution model. The union of fixtures matched by any in-force `cover` rule at any applicable scope is the recording-coverage set. Admin intent for what to record is now expressed exclusively through `cover` rules, never inferred from aggregated bar preferences.

**Other D-GRH-35 responsibilities stand unchanged:**

1. Schedules `temporal.StartWorkflow(game_id)` at `scheduled_at - lead_time`. System-wide lead-time configuration (default 15–30 min) is unchanged.
2. Temporal workflow idempotency via `game_id` as workflow ID is unchanged.
3. Manual operator force-record requests (any `game_id` regardless of rule match) are unchanged. Force-record is the third coverage input alongside rules; it does not flow through the rule table.
4. Local durable schedule snapshot for DB-outage resilience is unchanged. The snapshot now caches the resolved rules table (plus fixture catalog) instead of aggregated preferences, but the resilience semantics (continue operating on last-known local state during DB outage, replay missed events on reconnect) are identical.

**Amended trigger model (supersedes the D-GRH-36 trigger list for GameScheduler):**

`BarPreferencesChanged` events **no longer trigger** GameScheduler reprocess. (Bar players and GameDeliveryService still consume `BarPreferencesChanged` per D-GRH-38 and D-GRH-60 — the delivery-side filter path is untouched. Only the coverage-recording consumer drops the subscription.)

New GameScheduler triggers:

1. **`CoverRuleChanged{rule_id}`** — emitted by `AdminGatewayService` (D-GRH-68) on any write (create / update / enable / disable / delete) to a rule whose `action.type == "cover"`. GameScheduler re-resolves the coverage set for fixtures whose match status could be affected.
2. **Fixture catalog change** — new fixture, cancellation, or reschedule events emitted by whichever service publishes `FixtureList` (D-GRH-18). GameScheduler re-resolves any newly relevant fixtures against the current rules table.
3. **Daily cron reconciliation** — defensive sweep over the full forward fixture horizon against the current rules table. Catches any missed event or rule-evaluation drift.
4. **Service restart bootstrap scan** — on cold start, GameScheduler runs a full resolution pass against the current rules table + fixture catalog before consuming live NATS events.

**Hash-reconciliation backstop:** the D-GRH-36 hash-based fallback model is preserved structurally, but the hashed entity is the rules-table snapshot (filtered to `cover`-action rows), not the bar-preferences snapshot. On DB reconnect, GameScheduler compares the current rules-table hash against its local cached hash and re-resolves the coverage set if they differ. The bar-preferences hash continues to feed `ConfigPush` drift detection (D-GRH-60) for the delivery path — same hash mechanism, different consumer responsibilities.

**D-GRH-38 reinforced, not amended.** GameDeliveryService continues to filter per-player by bar preferences. Bar preferences keep their delivery-filter role; only their recording-coverage role is removed.

#### Rationale

D-GRH-35 predated both D-GRH-47 (rules engine) and D-GRH-70 (rules authoring API). When D-GRH-35 was authored, aggregating bar preference profiles was the only available proxy for admin intent about coverage. Now that rules exist as an explicit, operator-authored, conditional surface for coverage targeting (D-GRH-70 `cover` action), aggregating bar preferences as a coverage proxy is both redundant and incorrect:

1. **Conflation of concerns.** Bar preferences describe what a bar wants to *consume*; `cover` rules describe what the operator wants the system to *record*. These are two different decisions. A bar can consume the EPL stream without the operator wanting to record EPL globally, and an operator can choose to record NFL archivally for a future bar that has no current consumers. Coupling them through aggregation prevents either case.
2. **Operator authoring surface.** Rules are now the single explicit authoring surface for conditional behavior. Routing coverage decisions through preference aggregation hides admin intent behind a derived calculation that no operator wrote and no UI surfaces directly.
3. **Bar onboarding simplification.** With coverage decoupled, bar onboarding focuses purely on consumption-side `BarPreferences` (D-GRH-72 schema). Operators do not have to think about "if I onboard this bar, will the scheduler start recording new content?" — coverage stays stable across bar churn unless a `cover` rule is explicitly authored or scoped to change.

This is an evolution of D-GRH-35 in light of decisions that were not yet locked when D-GRH-35 was written, not a contradiction of D-GRH-35's architectural intent (single-responsibility coverage planner ahead of Temporal recording). The single-responsibility framing is preserved; only the input source shifts from "aggregated bar preferences" to "cover rules".

**Pins:** Surface 3 (recording-trigger) of the admin UI grill session 2026-05-13. Closes the open architectural gap surfaced in D-GRH-70.

---

### D-GRH-72 — BarPreferences Schema Lock + ConfigPush.preferences Payload Extension

**Date:** 2026-05-13
**Status:** decided
**Supersedes:** none
**Amends:** D-GRH-60
**Amended by:** none

#### Decision

The `BarPreferences` row schema (per bar, single row, central CROWDAQ DB per D-GRH-37) and the `ConfigPush.preferences` wire payload (D-GRH-60) are locked to the following field set:

| Field | Type | Notes |
|---|---|---|
| `theme_id` | string (nullable / `"__unset__"` per D-GRH-51) | Resolved theme. Unchanged from D-GRH-60. |
| `sports` | string array | Sport slugs the bar shows. Unchanged from D-GRH-60. |
| `leagues` | string array | League slugs. Unchanged from D-GRH-60. |
| `region` | string | Region code (e.g., `us-midwest`). Unchanged from D-GRH-60. |
| `state` | string | State / province code. **Added.** Required by D-GRH-70 rule scope `state:{code}` resolution. |
| `city` | string | City slug. **Added.** Required by D-GRH-70 rule scope `city:{slug}` resolution. |
| `timezone` | string (IANA TZ, e.g., `America/New_York`) | **Added.** Required by D-GRH-70 condition predicates `time_range` and `day_of_week`, which resolve in bar-local TZ. |
| `business_hours` | array of `{day_of_week, start_local, end_local}` | **Added.** Required because D-GRH-70 locked it as part of the Tier-1 `BarPreferences` schema. |
| `local_team_list` | string array | Team slugs. **Added.** Required because D-GRH-70 locked it as part of the Tier-1 `BarPreferences` schema and because team-tier weight rules (D-GRH-47 example) resolve against it. |

**`ConfigPush.preferences` payload (extends D-GRH-60 schema):**

```json
{
  "message_type": "ConfigPush",
  "bar_id": "...",
  "display_id": "...",
  "preferences": {
    "theme_id": "dark_sport",
    "sports": ["soccer", "basketball"],
    "leagues": ["EPL", "NBA"],
    "region": "us-midwest",
    "state": "IL",
    "city": "chicago",
    "timezone": "America/Chicago",
    "business_hours": [
      {"day_of_week": "fri", "start_local": "16:00", "end_local": "02:00"}
    ],
    "local_team_list": ["chicago-bears", "chicago-bulls"]
  },
  "config_hash": "abc123"
}
```

All other D-GRH-60 framing — when sent (reconnect re-push, initial DeviceRegistration, standalone on `BarPreferencesChanged`), `config_hash` semantics, "rules not included" — is unchanged. Only the resolved preference field set on the wire grows.

**Scope of this amendment:** D-GRH-37 (storage location: central CROWDAQ DB) is **not** amended. Where the data lives is unchanged; only the field set carried in `BarPreferences` rows and the corresponding `ConfigPush.preferences` payload changes.

#### Rationale

D-GRH-70 introduced rule scopes (`state:{code}`, `city:{slug}`) and condition predicates (`time_range`, `day_of_week`) whose resolution depends on bar-side data fields that D-GRH-60's original four-field payload (`theme_id`, `sports`, `leagues`, `region`) did not carry. Tier-1 `BarPreferences` in D-GRH-70 already enumerated the broader field set (`timezone`, `business_hours`, `local_team_list`, plus the schema addition of `state` and `city`), but the `ConfigPush` wire schema was never updated in step. Locking both the row schema and the wire payload in a single decision gives downstream consumers — `AdminGatewayService` write validation, `GameScheduler` rule resolution, `GameDeliveryService` per-player filtering, and the bar-player `ConfigPush` handler — one authoritative reference for the field set instead of forcing each consumer to re-derive it from a scattered combination of D-GRH-37, D-GRH-60, and D-GRH-70.

**Pins:** D-GRH-70 BarPreferences Tier-1 schema. Closes the cross-decision drift flagged in the scribe report 2026-05-13.

---

## Open Question: Admin UI Design

**Status:** Unresolved — requires separate design pass

**Context:** The decisions log (D-GRH-01 through D-GRH-67) fully defines backend orchestration and player wire protocol. The admin/process-management/observability UI was identified as a separate design concern with no API contracts, auth model, or authoring UX defined.

**Known gaps requiring design:**
- Admin REST API endpoints (none defined)
- Admin auth/authz (login, RBAC, scope delegation)
- Override injection admin path (UI → backend → NATS)
- Manual recording request mechanism (D-GRH-35 references it)
- MessagingLane authoring API (D-GRH-57: "central admin authors" — no API)
- Ad inventory management API
- Temporal workflow visibility (internal Temporal UI vs. custom)
- Admin pause/resume for BarPlayerSchedulerService or recording workflows
- Journal data access for admin reporting
- Metrics emission and dashboard targets

**Resolved 2026-05-13:** D-GRH-68 (AdminGatewayService single write surface), D-GRH-69 (Schedule authoring — rule-driven + slot-pin override), D-GRH-70 (Rules authoring API — two-tier BarPreferences + Rule). Closes the "Rules authoring API", "Schedule authoring API", and "Bar preference write API" bullets above.

**Recommended next step:** Grill the remaining surfaces in operator-prioritized order: ad inventory management (D-GRH-55 phase-1 asset model), auth/RBAC, Temporal workflow visibility, journal data access, metrics + dashboards.

---

---
