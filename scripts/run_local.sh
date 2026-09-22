#!/usr/bin/env bash
# Starts all three local dev processes (ai_api, backend, frontend) in one
# terminal. Ctrl+C stops all three together. Assumes each has already been
# set up once (venvs created + `pip install -r requirements.txt`, frontend's
# `npm install` run) — see CLAUDE.md's "How to run it" for first-time setup.
#
# Usage: ./scripts/run_local.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

AI_API_DIR="${REPO_ROOT}/src/ai_api"
BACKEND_DIR="${REPO_ROOT}/src/backend"
FRONTEND_DIR="${REPO_ROOT}/src/frontend"

for dir_venv in "${AI_API_DIR}/venv" "${BACKEND_DIR}/venv"; do
  if [[ ! -d "${dir_venv}" ]]; then
    echo "Missing ${dir_venv} — run first-time setup first (see CLAUDE.md's \"How to run it\"):" >&2
    echo "  cd $(dirname "${dir_venv}") && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt" >&2
    exit 1
  fi
done
if [[ ! -d "${FRONTEND_DIR}/node_modules" ]]; then
  echo "Missing ${FRONTEND_DIR}/node_modules — run: cd ${FRONTEND_DIR} && npm install" >&2
  exit 1
fi

LOG_DIR="${REPO_ROOT}/src/logs"
mkdir -p "${LOG_DIR}"

PIDS=()
cleanup() {
  echo ""
  echo "Stopping..."
  for pid in "${PIDS[@]}"; do
    kill "${pid}" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

echo "==> Starting ai_api on :8001 (log: ${LOG_DIR}/ai_api.local.log)"
(cd "${AI_API_DIR}" && source venv/bin/activate && exec uvicorn main:app --reload --port 8001) \
  > "${LOG_DIR}/ai_api.local.log" 2>&1 &
PIDS+=("$!")

echo "==> Starting backend on :8000 (log: ${LOG_DIR}/backend.local.log)"
(cd "${BACKEND_DIR}" && source venv/bin/activate && exec uvicorn main:app --reload --port 8000) \
  > "${LOG_DIR}/backend.local.log" 2>&1 &
PIDS+=("$!")

echo "==> Starting frontend on :5173 (log: ${LOG_DIR}/frontend.local.log)"
(cd "${FRONTEND_DIR}" && exec npm run dev) \
  > "${LOG_DIR}/frontend.local.log" 2>&1 &
PIDS+=("$!")

sleep 2
echo ""
echo "All three running. App: http://localhost:5173"
echo "Logs are streaming to ${LOG_DIR}/*.local.log — tail -f them in another terminal if needed."
echo "Press Ctrl+C to stop everything."
echo ""

wait
