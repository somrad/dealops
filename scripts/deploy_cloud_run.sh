#!/usr/bin/env bash
# Builds both service images and deploys/redeploys them to Cloud Run.
# Safe to re-run any time you want to ship local changes — every step is
# idempotent (rebuilding an image just overwrites the :latest tag; deploying
# a Cloud Run service just creates a new revision and shifts traffic to it).
#
# Secrets are never hardcoded here — they're read from the same .env files
# local dev already uses (src/backend/.env for DATABASE_URL, src/ai_api/.env
# for the LLM API keys), so there's exactly one place each secret lives.
#
# Usage: ./scripts/deploy_cloud_run.sh

set -euo pipefail

PROJECT="dealops-app"
REGION="us-central1"
REPO="us-central1-docker.pkg.dev/${PROJECT}/dealops-images"
BACKEND_SERVICE="dealops-backend"
AI_API_SERVICE="dealops-ai-api"
GCS_BUCKET="dealops-app-storage"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_ENV="${REPO_ROOT}/src/backend/.env"
AI_API_ENV="${REPO_ROOT}/src/ai_api/.env"

if [[ ! -f "${AI_API_ENV}" ]]; then
  echo "Missing ${AI_API_ENV} — ai_api needs ANTHROPIC_API_KEY etc. there before deploying." >&2
  exit 1
fi
if [[ ! -f "${BACKEND_ENV}" ]]; then
  echo "Missing ${BACKEND_ENV} — backend needs DATABASE_URL there before deploying." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

cd "${REPO_ROOT}"

echo "==> Building ai_api image via Cloud Build"
gcloud builds submit --project="${PROJECT}" --config=/dev/stdin . <<EOF
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-f', 'src/ai_api/Dockerfile', '-t', '${REPO}/ai-api:latest', '.']
images:
  - '${REPO}/ai-api:latest'
options:
  logging: CLOUD_LOGGING_ONLY
EOF

echo "==> Building backend image via Cloud Build (bundles the frontend build too)"
gcloud builds submit --project="${PROJECT}" --config=/dev/stdin . <<EOF
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-f', 'src/backend/Dockerfile', '-t', '${REPO}/backend:latest', '.']
images:
  - '${REPO}/backend:latest'
options:
  logging: CLOUD_LOGGING_ONLY
  machineType: 'E2_HIGHCPU_8'
timeout: '1200s'
EOF

echo "==> Deploying ${AI_API_SERVICE} (private — only this backend's service account may call it)"
AI_API_ENV_YAML="${TMP_DIR}/ai_api_env.yaml"
{
  echo "ANTHROPIC_API_KEY: \"$(grep '^ANTHROPIC_API_KEY=' "${AI_API_ENV}" | cut -d= -f2-)\""
  echo "OPENAI_API_KEY: \"$(grep '^OPENAI_API_KEY=' "${AI_API_ENV}" | cut -d= -f2-)\""
  echo "DEFAULT_MODEL_PROVIDER: \"$(grep '^DEFAULT_MODEL_PROVIDER=' "${AI_API_ENV}" | cut -d= -f2-)\""
  echo "DEFAULT_MODEL_NAME: \"$(grep '^DEFAULT_MODEL_NAME=' "${AI_API_ENV}" | cut -d= -f2-)\""
  echo "CHEAP_MODEL_PROVIDER: \"$(grep '^CHEAP_MODEL_PROVIDER=' "${AI_API_ENV}" | cut -d= -f2-)\""
  echo "CHEAP_MODEL_NAME: \"$(grep '^CHEAP_MODEL_NAME=' "${AI_API_ENV}" | cut -d= -f2-)\""
} > "${AI_API_ENV_YAML}"

gcloud run deploy "${AI_API_SERVICE}" \
  --image="${REPO}/ai-api:latest" \
  --region="${REGION}" --project="${PROJECT}" \
  --no-allow-unauthenticated \
  --env-vars-file="${AI_API_ENV_YAML}" \
  --memory=512Mi --min-instances=0 --max-instances=3 \
  --quiet

AI_API_URL="$(gcloud run services describe "${AI_API_SERVICE}" --region="${REGION}" --project="${PROJECT}" --format="value(status.url)")"

echo "==> Ensuring the backend's service account can invoke ${AI_API_SERVICE}"
SA="$(gcloud iam service-accounts list --project="${PROJECT}" --format="value(email)" --filter="email ~ compute@developer.gserviceaccount.com")"
gcloud run services add-iam-policy-binding "${AI_API_SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" \
  --member="serviceAccount:${SA}" --role="roles/run.invoker" --quiet > /dev/null

echo "==> Deploying ${BACKEND_SERVICE} (public)"
BACKEND_ENV_YAML="${TMP_DIR}/backend_env.yaml"
DATABASE_URL_VALUE="$(grep '^DATABASE_URL=' "${BACKEND_ENV}" | cut -d= -f2-)"
{
  echo "DATABASE_URL: \"${DATABASE_URL_VALUE}\""
  echo "STORAGE_BACKEND: \"gcs\""
  echo "GCS_STORAGE_BUCKET: \"${GCS_BUCKET}\""
  echo "AI_API_BASE_URL: \"${AI_API_URL}\""
  echo "AI_API_REQUIRES_AUTH: \"true\""
} > "${BACKEND_ENV_YAML}"

gcloud run deploy "${BACKEND_SERVICE}" \
  --image="${REPO}/backend:latest" \
  --region="${REGION}" --project="${PROJECT}" \
  --allow-unauthenticated \
  --env-vars-file="${BACKEND_ENV_YAML}" \
  --memory=512Mi --min-instances=0 --max-instances=3 \
  --quiet

BACKEND_URL="$(gcloud run services describe "${BACKEND_SERVICE}" --region="${REGION}" --project="${PROJECT}" --format="value(status.url)")"

echo ""
echo "==> Done."
echo "App URL:    ${BACKEND_URL}"
echo "ai_api URL: ${AI_API_URL} (private — not directly browsable, that's expected)"
