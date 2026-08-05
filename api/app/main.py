from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.database import Base, SessionLocal, engine
from app.routers import employee, manager
from app.seed import ensure_manager, ensure_shift_types


def _ensure_clock_override_columns() -> None:
    statements = [
        "ALTER TABLE clock_events ADD COLUMN IF NOT EXISTS admin_override BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE clock_events ADD COLUMN IF NOT EXISTS override_reason TEXT",
        "ALTER TABLE clock_events ADD COLUMN IF NOT EXISTS override_by UUID NULL REFERENCES employees(id)",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    _ensure_clock_override_columns()
    db = SessionLocal()
    try:
        ensure_shift_types(db)
        ensure_manager(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title="Supreme Childcare — Time & Attendance API",
    description="Employee + Manager APIs. Authorize with Bearer token from `/auth/login`.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(employee.router)
app.include_router(manager.router)


@app.get("/health", tags=["System"])
def health():
    return {"status": "ok"}
