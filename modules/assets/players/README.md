# Player Silhouette Asset Bundle (CROWDAQ widget)

This directory holds **AI-generated stadium silhouette images** rendered by
the CROWDAQ Xibo widget when it receives match-event SSE messages. Each
silhouette is a legally-clean, sponsor-free, generic-color, faceless
silhouette — designed to dramatize moments without infringing on real
player likeness, club crests, kit-supplier marks, or registered trademarks.

## Files

- `./PROMPTS.md` — exact prompt specs for the 10 Kit A poses (and Kit B notes).
- `generate.sh` — runner script; calls OpenAI Images API (`gpt-image-1`)
  for all 10 poses. Skips files that already exist.
- `argentina-10-*.png` — 10 generated silhouettes (created on first run).

## Why isn't the bundle pre-committed?

The original generation request landed without a usable image-API credential
in the agent environment:

- Codex CLI 0.123.0 is logged in via ChatGPT OAuth (Plus subscription), and
  its access token rejects `/v1/images/generations` with
  `Missing scopes: api.model.images.request`. ChatGPT OAuth does not grant
  Images API scopes — only a project API key from the OpenAI dashboard does.
- No `OPENAI_API_KEY` was present in the operator's shell env.
- Codex agent's only image-creation capability is procedural (System.Drawing
  primitives), not photorealistic AI generation.

The defense-in-depth path is: commit the prompts + runner now, let the
operator run `generate.sh` with their own key, then commit the resulting
PNGs in a follow-up. This keeps the API key out of CI / repo history and
lets the operator review every output before merge.

## How to generate

```bash
# 1. Get an API key with images scope:
#    https://platform.openai.com/api-keys
#
#    Drop the value into ~/Documents/GitHub/xibo/openai-api.env so it
#    sits next to the other operator credentials (api-football.env,
#    cms-api.env, notion-apikey.env). The agent loads the file with
#    `set -a; source ~/Documents/GitHub/xibo/openai-api.env; set +a`
#    on the next iteration.
export OPENAI_API_KEY=sk-proj-...

# 2. Run the generator (idempotent — skips existing files)
bash modules/assets/players/generate.sh

# 3. Inspect the 10 output PNGs, regenerate any that don't meet the
#    legal/visual bar (no real likeness, no logos, no sponsors)

# 4. Commit them
git add modules/assets/players/argentina-10-*.png
git commit -m "feat(widget): commit generated silhouette PNGs (Kit A)"
git push
```

Cost estimate: `gpt-image-1` at `1024x1536` `quality=high` runs ~$0.19 per
image, so all 10 poses cost ~$1.90 per regeneration cycle.

## Wiring into the widget

The widget at `modules/crowdaq-widget.xml` reads these PNGs and fades the
matching silhouette in over the right third of the viewport for ~5s
whenever a recognised game event lands.

Mapping (live in the widget's `onRender` block — see
`PLAYER_IMAGE_KIND_MAP` and `PLAYER_IMAGE_STATUS_MAP`):

| event source                                                 | image                                       |
| ------------------------------------------------------------ | ------------------------------------------- |
| `score-update` with score change                             | `argentina-10-goal-celebrate.png`           |
| `last_moment.type === "goal"` (no score change)              | `argentina-10-goal-celebrate.png`           |
| `moment` event `moment_type === "card"`, text contains "yellow" | `argentina-10-yellow-card-frustrated.png` |
| `moment` event `moment_type === "card"`, text contains "red" | `argentina-10-red-card-shame.png`           |
| `moment` event `moment_type === "substitution"` (on / "comes on") | `argentina-10-sub-on-eager.png`        |
| `moment` event `moment_type === "substitution"` (off / "replaced") | `argentina-10-sub-off-tired.png`      |
| `status` event `state === "halftime"`                        | `argentina-10-halftime-neutral.png`         |
| `status` event `state === "final"` + home > away             | `argentina-10-fulltime-win.png`             |
| `status` event `state === "final"` + home < away             | `argentina-10-fulltime-loss.png`            |
| `moment` event `moment_type === "penalty"`                   | `argentina-10-penalty-prep.png`             |
| `moment` event `moment_type === "var"`                       | `argentina-10-var-review.png`               |

### Missing-asset behaviour

The widget probes each PNG via a transient `Image()` before painting
the overlay. If the asset 404s (or is blocked by CSP), the overlay
stays hidden and the widget logs `crowdaq:player-image-missing` once
per filename per session. There is no `<img>` tag in the rendered DOM,
so a missing asset can never paint a broken-image icon on a bar TV.

This is the safety mechanism that lets us merge the wiring before the
PNGs are generated — operator runs `generate.sh`, regenerates the dist
zip, redeploys to the CMS, and the silhouettes start appearing on the
next event without any further widget change.
