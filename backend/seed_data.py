from database import Base, engine, SessionLocal
from models import User
from security import hash_password

DEMO_USERS = [
    {"name": "Dana (Deal Team)", "username": "dana", "password": "dana123", "role": "deal_team"},
    {"name": "Omar (Ops Manager)", "username": "omar", "password": "omar123", "role": "ops_manager"},
    {"name": "Priya (Ops Team)", "username": "priya", "password": "priya123", "role": "ops_team_member"},
    {"name": "Chen (Checker)", "username": "chen", "password": "chen123", "role": "checker"},
    {"name": "Som (Ops Team)", "username": "som", "password": "som123", "role": "ops_team_member"},
    {"name": "Kamal (Checker)", "username": "kamal", "password": "kamal123", "role": "checker"},
]


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            print("Users already exist, skipping seed.")
            return
        for demo in DEMO_USERS:
            db.add(User(
                name=demo["name"],
                username=demo["username"],
                password_hash=hash_password(demo["password"]),
                role=demo["role"],
            ))
        db.commit()
        print(f"Seeded {len(DEMO_USERS)} demo users.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
