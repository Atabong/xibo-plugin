# Player Silhouette Image Prompts (Kit A — Argentina-style, #10)

These prompts generate **legally-clean** stadium-lit player silhouettes for the
CROWDAQ Xibo widget. Used to render dynamic art per game-event kind
(`goal-celebrate`, `yellow-card-frustrated`, etc.).

## Legal / visual constraints (every prompt enforces these)

- Body is pure black silhouette — no faces, no hair detail, no skin features
- No real player likeness — generic body proportions
- No team logos, sponsor patches, or registered trademarks (no AFA sun, no Adidas stripes, no FFF rooster)
- Generic team colors only — Kit A = light blue + white vertical stripes,
  generic dark shorts; Kit B (future) = dark navy + white horizontal accent
- Number `10` on back of jersey
- Stadium-lit dramatic backlight halo so silhouette pops
- Vertical aspect 4:5 (1024 x 1280 PNG)

## Base template

> Cinematic stadium photograph, dramatic backlit silhouette of a soccer player
> viewed from `{angle}`, `{pose_description}`. The player's body, head, hair,
> arms, legs are pure black silhouette with no visible features. The jersey is
> light blue and white vertical stripes with a large `10` number on the back
> in white, no team logo, no sponsor, no crest, plain dark shorts. Stadium
> lights flare behind, audience blurred in deep focus, `{time_of_day}`.
> Photorealistic, high detail, dramatic lighting. Vertical aspect 4:5.

## 10 poses for Kit A (Argentina-style #10)

### 1. argentina-10-goal-celebrate.png
- **angle:** back
- **pose:** arms raised bent at elbow, thumbs gesturing at jersey number, head tilted slightly back
- **time_of_day:** evening, golden floodlights

### 2. argentina-10-yellow-card-frustrated.png
- **angle:** side
- **pose:** arms raised palms-up pleading toward unseen referee, head tilted, body language indignant
- **time_of_day:** late afternoon overcast, harsh white floodlights

### 3. argentina-10-red-card-shame.png
- **angle:** back / away
- **pose:** head bowed, hands clasped behind head, walking slowly off pitch toward an exit tunnel
- **time_of_day:** dusk, deep blue sky

### 4. argentina-10-sub-on-eager.png
- **angle:** side
- **pose:** jogging onto pitch, fresh strides, fists clenched, focused forward lean
- **time_of_day:** evening, bright stadium floodlights

### 5. argentina-10-sub-off-tired.png
- **angle:** side
- **pose:** walking off pitch, shoulders slumped, jersey hem grabbed in one hand wiping forehead
- **time_of_day:** evening, warm sodium-vapor lights

### 6. argentina-10-halftime-neutral.png
- **angle:** side
- **pose:** standing on touchline, hands on hips, breathing steady
- **time_of_day:** afternoon, even daylight with stadium-shadow contrast

### 7. argentina-10-fulltime-win.png
- **angle:** front
- **pose:** arms wide overhead V-shape, jersey clutched in fists at sides, triumphant
- **time_of_day:** night, full floodlights, confetti drifting

### 8. argentina-10-fulltime-loss.png
- **angle:** back
- **pose:** bent over hands on knees, exhausted, head down
- **time_of_day:** night, cool blue floodlights

### 9. argentina-10-penalty-prep.png
- **angle:** back
- **pose:** hands on hips, looking down at the ball, ready stance
- **time_of_day:** evening, dramatic single-source floodlight

### 10. argentina-10-var-review.png
- **angle:** side
- **pose:** hands raised, looking up at giant stadium screen, anxious
- **time_of_day:** night, giant stadium screen casting cool light on player

## How to generate

See `generate.sh` in this directory. Requires `OPENAI_API_KEY` with the
`api.model.images.request` scope. Codex CLI's ChatGPT-OAuth login does NOT
include that scope; you need a project API key from the OpenAI dashboard.

```bash
export OPENAI_API_KEY=sk-proj-...
bash modules/assets/players/generate.sh
```

## Kit B (France-style #10) — deferred

Same 10 poses, replace jersey description with:
> dark navy blue main color, white horizontal accent across chest, no rooster
> crest, generic white shorts

File prefix: `france-10-*.png`. Generate after Kit A is approved.
