#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env ]]; then
  echo "Missing serverless/.env. Copy .env.example to .env and fill in values." >&2
  exit 1
fi

set -a
source .env
set +a

required=(
  TWILIO_SERVERLESS_SERVICE_NAME
  LIVEKIT_URL
  LIVEKIT_API_KEY
  LIVEKIT_API_SECRET
  LIVEKIT_AGENT_NAME
  FLEX_WORKFLOW_SID
  HANDOFF_TOKEN
)

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
done

if [[ ! "$FLEX_WORKFLOW_SID" =~ ^WW[0-9a-fA-F]{32}$ ]]; then
  echo "FLEX_WORKFLOW_SID must be a TaskRouter Workflow SID that starts with WW." >&2
  exit 1
fi

args=(
  serverless:deploy
  --service-name "$TWILIO_SERVERLESS_SERVICE_NAME"
  --env .env
  --override-existing-project
)

if [[ -n "${TWILIO_PROFILE:-}" ]]; then
  args+=(-p "$TWILIO_PROFILE")
fi

twilio "${args[@]}"
