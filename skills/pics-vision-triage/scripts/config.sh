# pics-vision-triage configuration
# Sourced automatically by the scripts in this skill; edit to taste.
# Existing environment variables win; the values below are fallbacks.
# CLI flags (--url, --model, ...) still override everything.

# OpenAI-compatible base URL of the vision LLM server (llama-server --mmproj)
export SKILL_PICS_VISION_TRIAGE_URL="${SKILL_PICS_VISION_TRIAGE_URL:-http://localhost:8123/v1}"

# Bearer token for the vision server; empty = no Authorization header sent.
# export SKILL_PICS_VISION_TRIAGE_TOKEN=""

# Model id for the vision stage (per-image descriptions), as advertised by
# /v1/models. REQUIRED - the scripts refuse to run without it (or --model).
# (Old name SKILL_PICS_VISION_TRIAGE_MODEL still works as a fallback.)
export SKILL_PICS_VISION_TRIAGE_VISION_MODEL="${SKILL_PICS_VISION_TRIAGE_VISION_MODEL:-${SKILL_PICS_VISION_TRIAGE_MODEL:-}}"

# Base URL for the review stage; empty = same as the vision stage URL.
# (Only needed when the bigger model lives on another server.)
export SKILL_PICS_VISION_TRIAGE_CONTEXT_URL="${SKILL_PICS_VISION_TRIAGE_CONTEXT_URL:-}"

# Bearer token for the review server; empty = the vision token is used
# instead (which is empty by default -> no Authorization header).
# export SKILL_PICS_VISION_TRIAGE_CONTEXT_TOKEN=""

# Model id for the review stage (misfiles: events + outlier detection over the
# descriptions; faces: per-image face-quality flags). A larger, vision-capable
# reasoning model is recommended (the faces sub-pass sends images).
# REQUIRED - review.sh refuses to run without it (or --model), and also
# when the server does not offer the id.
export SKILL_PICS_VISION_TRIAGE_CONTEXT_MODEL="${SKILL_PICS_VISION_TRIAGE_CONTEXT_MODEL:-}"

# Max side (px) for images sent to the faces sub-pass (default 1024).
# export SKILL_PICS_VISION_TRIAGE_FACE_SIDE=1024

# Max parallel requests per stage (default 1). Raise it toward your inference
# server's concurrency to speed a stage up; if it exceeds what the server can
# handle, the extra requests just queue (no speedup, only extra CPU from the
# per-image downscale). Applies to both the vision and context stages unless a
# run overrides it with --concurrency.
export SKILL_PICS_VISION_TRIAGE_CONCURRENCY="${SKILL_PICS_VISION_TRIAGE_CONCURRENCY:-1}"

# Sampling tweaks (llama-server OpenAI-compatible body fields).
# Uncomment and set to override the built-in defaults (temperature 0,
# max_tokens 512; everything else off).
# Reference: https://docs.liquid.ai/deployment/on-device/llama-cpp#generation-parameters
# export SKILL_PICS_VISION_TRIAGE_TEMPERATURE=0
# export SKILL_PICS_VISION_TRIAGE_MIN_P=0.05
# export SKILL_PICS_VISION_TRIAGE_TOP_K=40
# export SKILL_PICS_VISION_TRIAGE_TOP_P=0.9
# export SKILL_PICS_VISION_TRIAGE_REPETITION_PENALTY=1.05
# export SKILL_PICS_VISION_TRIAGE_MAX_TOKENS=512

