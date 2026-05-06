#!/usr/bin/env bash
#
# Generate the 10 Kit A (Argentina-style #10) player silhouettes via the
# OpenAI Images API.
#
# Requires:
#   OPENAI_API_KEY   API key with `api.model.images.request` scope.
#                    NOTE: Codex CLI's ChatGPT OAuth login does NOT carry
#                    this scope — you need a project API key from
#                    https://platform.openai.com/api-keys
#
# Usage:
#   export OPENAI_API_KEY=sk-proj-...
#   bash modules/assets/players/generate.sh
#
# Output: 10 PNGs at modules/assets/players/argentina-10-*.png
#
# Cost (gpt-image-1, 1024x1536 high quality): ~$0.19 per image x 10 = ~$1.90
#
set -euo pipefail

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY not set" >&2
  echo "Get one at https://platform.openai.com/api-keys (codex OAuth token won't work)" >&2
  exit 1
fi

OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL="${MODEL:-gpt-image-1}"
SIZE="${SIZE:-1024x1536}"   # 4:5 portrait-ish (closest gpt-image-1 supports)
QUALITY="${QUALITY:-high}"

# Common preamble — strict legal/visual constraints baked into every prompt.
PREAMBLE='Cinematic stadium photograph, dramatic backlit silhouette of a soccer player'
JERSEY='The jersey is light blue and white vertical stripes with a large 10 number on the back in white, no team logo, no sponsor, no crest, plain dark shorts.'
BODY='The player'\''s body, head, hair, arms, legs are pure black silhouette with no visible features.'
STYLE='Photorealistic, high detail, dramatic lighting. Vertical aspect 4:5.'

generate_one() {
  local slug="$1"
  local angle="$2"
  local pose="$3"
  local tod="$4"
  local out="${OUT_DIR}/argentina-10-${slug}.png"

  if [[ -f "$out" ]]; then
    echo "[skip] ${out} already exists"
    return
  fi

  local prompt="${PREAMBLE} viewed from ${angle}, ${pose}. ${BODY} ${JERSEY} Stadium lights flare behind, audience blurred in deep focus, ${tod}. ${STYLE}"

  echo "[gen]  ${slug}"
  # Build JSON payload safely.
  local payload
  payload=$(jq -nc \
    --arg model "$MODEL" \
    --arg prompt "$prompt" \
    --arg size "$SIZE" \
    --arg quality "$QUALITY" \
    '{model:$model, prompt:$prompt, size:$size, quality:$quality, n:1}')

  local resp
  resp=$(curl -sS -X POST https://api.openai.com/v1/images/generations \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload")

  local b64
  b64=$(echo "$resp" | jq -r '.data[0].b64_json // empty')
  if [[ -z "$b64" ]]; then
    echo "ERROR generating ${slug}: $resp" >&2
    return 1
  fi
  echo "$b64" | base64 -d > "$out"
  echo "[ok]   ${out} ($(wc -c <"$out") bytes)"
}

# 10 poses, exact order/spec matches PROMPTS.md
generate_one "goal-celebrate"            "back"      "arms raised bent at elbow, thumbs gesturing at jersey number, head tilted slightly back"           "evening, golden floodlights"
generate_one "yellow-card-frustrated"    "side"      "arms raised palms-up pleading toward unseen referee, head tilted, body language indignant"          "late afternoon overcast, harsh white floodlights"
generate_one "red-card-shame"            "back"      "head bowed, hands clasped behind head, walking slowly off pitch toward an exit tunnel"              "dusk, deep blue sky"
generate_one "sub-on-eager"              "side"      "jogging onto pitch, fresh strides, fists clenched, focused forward lean"                            "evening, bright stadium floodlights"
generate_one "sub-off-tired"             "side"      "walking off pitch, shoulders slumped, jersey hem grabbed in one hand wiping forehead"               "evening, warm sodium-vapor lights"
generate_one "halftime-neutral"          "side"      "standing on touchline, hands on hips, breathing steady"                                             "afternoon, even daylight with stadium-shadow contrast"
generate_one "fulltime-win"              "front"     "arms wide overhead V-shape, jersey clutched in fists at sides, triumphant"                          "night, full floodlights, confetti drifting"
generate_one "fulltime-loss"             "back"      "bent over hands on knees, exhausted, head down"                                                     "night, cool blue floodlights"
generate_one "penalty-prep"              "back"      "hands on hips, looking down at the ball, ready stance"                                              "evening, dramatic single-source floodlight"
generate_one "var-review"                "side"      "hands raised, looking up at giant stadium screen, anxious"                                          "night, giant stadium screen casting cool light on player"

echo
echo "Done. Generated images in ${OUT_DIR}:"
ls -la "${OUT_DIR}"/argentina-10-*.png 2>/dev/null || true
