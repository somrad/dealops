# Multi-stage: build the frontend first, then bake its dist/ into the
# backend image so one Cloud Run service serves both (see main.py's
# _FRONTEND_DIST handling) — no separate reverse-proxy container needed,
# unlike the VM's Caddy setup.

FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY src/frontend/package.json src/frontend/package-lock.json ./
RUN npm install
COPY src/frontend/ ./
# Same-origin, no path prefix — this container serves both frontend and
# backend from one origin, unlike the VM's Caddy-stripped "/api" prefix.
ENV VITE_API_BASE=""
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libpq5 && rm -rf /var/lib/apt/lists/*

COPY src/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/backend/ .
COPY --from=frontend-build /frontend/dist ./frontend_dist

ENV PORT=8080
EXPOSE 8080
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}
