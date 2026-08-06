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


def _ensure_one_shift_per_day() -> None:
    """One shift per employee per calendar day (no Regular + Sleep/WN same day)."""
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE scheduled_shifts DROP CONSTRAINT IF EXISTS uq_emp_day_type"))
        # Remove duplicate rows if any (keep earliest by id)
        conn.execute(
            text(
                """
                DELETE FROM scheduled_shifts a
                USING scheduled_shifts b
                WHERE a.employee_id = b.employee_id
                  AND a.shift_date = b.shift_date
                  AND a.id > b.id
                """
            )
        )
        conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'uq_emp_day'
                    ) THEN
                        ALTER TABLE scheduled_shifts
                        ADD CONSTRAINT uq_emp_day UNIQUE (employee_id, shift_date);
                    END IF;
                END $$;
                """
            )
        )


def _ensure_employee_work_hours() -> None:
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_start TIME NOT NULL DEFAULT '09:00'")
        )
        conn.execute(
            text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_end TIME NOT NULL DEFAULT '17:00'")
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    _ensure_clock_override_columns()
    _ensure_one_shift_per_day()
    _ensure_employee_work_hours()
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
