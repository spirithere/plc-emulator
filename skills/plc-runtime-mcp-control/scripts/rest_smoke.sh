#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${PLC_RUNTIME_BASE_URL:-http://127.0.0.1:8124}"
PROJECT_JSON=""
STEP_CYCLES="${STEP_CYCLES:-1}"
INPUT_ID="${INPUT_ID:-X0}"
INPUT_VALUE="${INPUT_VALUE:-true}"

usage() {
  cat <<'EOF'
Usage:
  rest_smoke.sh [--base-url URL] [--project-json FILE] [--cycles N] [--input-id ID] [--input-value true|false]

Examples:
  rest_smoke.sh
  rest_smoke.sh --project-json /tmp/project.json --cycles 2 --input-id X1 --input-value true

Environment:
  PLC_RUNTIME_BASE_URL   Default: http://127.0.0.1:8124
  STEP_CYCLES            Default: 1
  INPUT_ID               Default: X0
  INPUT_VALUE            Default: true
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --project-json)
      PROJECT_JSON="$2"
      shift 2
      ;;
    --cycles)
      STEP_CYCLES="$2"
      shift 2
      ;;
    --input-id)
      INPUT_ID="$2"
      shift 2
      ;;
    --input-value)
      INPUT_VALUE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

echo "==> Health"
curl -sS "${BASE_URL}/api/v1/health"
echo

if [[ -n "${PROJECT_JSON}" ]]; then
  echo "==> Load project model (${PROJECT_JSON})"
  curl -sS \
    -X POST "${BASE_URL}/api/v1/project/load" \
    -H "Content-Type: application/json" \
    --data-binary "@${PROJECT_JSON}"
  echo
fi

echo "==> Set input ${INPUT_ID}=${INPUT_VALUE}"
curl -sS \
  -X POST "${BASE_URL}/api/v1/io/inputs/set" \
  -H "Content-Type: application/json" \
  -d "{\"identifier\":\"${INPUT_ID}\",\"value\":${INPUT_VALUE}}"
echo

echo "==> Step runtime (${STEP_CYCLES} cycles)"
curl -sS \
  -X POST "${BASE_URL}/api/v1/runtime/step" \
  -H "Content-Type: application/json" \
  -d "{\"cycles\":${STEP_CYCLES}}"
echo

echo "==> Runtime state"
curl -sS "${BASE_URL}/api/v1/runtime/state"
echo

echo "==> Runtime metrics"
curl -sS "${BASE_URL}/api/v1/runtime/metrics"
echo
