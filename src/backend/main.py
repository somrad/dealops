from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import auth, deals, chat, users, documents, standing_instructions, activity

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
