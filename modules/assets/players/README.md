# Player Silhouette Asset Bundle (CROWDAQ widget)

This directory holds **AI-generated stadium silhouette images** rendered by
the CROWDAQ Xibo widget when it receives match-event SSE messages. Each
silhouette is a legally-clean, sponsor-free, generic-color, faceless
silhouette — designed to dramatize moments without infringing on real
player likeness, club crests, kit-supplier marks, or registered trademarks.

## Files

- `PROMPTS.md` — exact prompt specs for the 10 Kit A poses (and Kit B notes).
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

The widget XML at `modules/crowdaq-widget.xml` does not yet reference these
images. The mapping from `last_moment.kind` → image filename is documented
in `PROMPTS.md` and will be wired in a follow-up PR (deferred from this
asset-scaffold PR per the task's "wiring is optional, defer if it slogs"
clause).

Mapping (for the follow-up wiring PR):

| event source                                | image                                |
| ------------------------------------------- | ------------------------------------ |
| `last_moment.kind === "goal"`               | `argentina-10-goal-celebrate.png`    |
| `last_moment.kind === "card"` color=yellow  | `argentina-10-yellow-card-frustrated.png` |
| `last_moment.kind === "card"` color=red     | `argentina-10-red-card-shame.png`    |
| `last_moment.kind === "substitution"` (in)  | `argentina-10-sub-on-eager.png`      |
| `last_moment.kind === "substitution"` (off) | `argentina-10-sub-off-tired.png`     |
| `status === "halftime"`                     | `argentina-10-halftime-neutral.png`  |
| `status === "final"` + winning team         | `argentina-10-fulltime-win.png`      |
| `status === "final"` + losing team          | `argentina-10-fulltime-loss.png`     |
| penalty about to be taken                   | `argentina-10-penalty-prep.png`      |
| VAR review in progress                      | `argentina-10-var-review.png`        |
