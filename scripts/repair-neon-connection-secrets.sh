#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIRECTORY/resume-student-deployment-from-neon.sh" \
  --repair-connection-secrets
