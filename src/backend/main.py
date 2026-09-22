import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from routes import auth, deals, chat, users, documents, standing_instructions, activity, funding_document

app = FastAPI(title="dealops POC")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(deals.router)
app.include_router(chat.router)
app.include_router(users.router)
app.include_router(documents.router)
app.include_router(standing_instructions.router)
app.include_router(activity.router)
app.include_router(funding_document.router)

# Cloud Run runs one container per service, so instead of a separate Caddy
# reverse-proxy layer (the VM's approach), this same FastAPI app serves the
# frontend's production build directly when one is baked into the image —
# local dev has no dist/ here (the frontend runs on its own via `npm run
# dev`), so none of this applies there. Registered LAST so every API route
# above still wins; the catch-all only serves index.html (React Router's
# client-side routes, e.g. /deals/3, need this SPA fallback on a hard refresh).
_FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "frontend_dist")
if os.path.isdir(_FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(_FRONTEND_DIST, "assets")), name="assets")

    @app.get("/favicon.svg")
    def _favicon():
        return FileResponse(os.path.join(_FRONTEND_DIST, "favicon.svg"))

    @app.get("/icons.svg")
    def _icons():
        return FileResponse(os.path.join(_FRONTEND_DIST, "icons.svg"))

    @app.get("/{full_path:path}")
    def _spa_fallback(full_path: str):
        return FileResponse(os.path.join(_FRONTEND_DIST, "index.html"))
