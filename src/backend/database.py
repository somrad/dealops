import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Loads src/backend/.env if one exists (gitignored — real connection
# strings/secrets never get committed) — this is what lets local dev point
# at a real Postgres (Neon, Cloud SQL, whatever) by just setting
# DATABASE_URL there, no code change needed to switch targets. A real
# environment variable (Cloud Run's, for instance) always wins over
# whatever a .env file says — override=False is the default.
load_dotenv()

# No .env / no DATABASE_URL set: falls back to the SQLite file local dev
# has always used. Cloud Run's deploy sets DATABASE_URL directly (Cloud SQL
# over the Unix socket it mounts automatically) — same reasoning as
# storage_backend.py: Cloud Run's own filesystem doesn't survive between
# requests/instances, so SQLite can't live there safely.
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./dealops.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
