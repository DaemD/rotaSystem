from datetime import time

from sqlalchemy.orm import Session

from app.auth import hash_password
from app.config import settings
from app.models import ContractType, Employee, Role, ShiftType, ShiftTypeCode

# Reference config only (not fake people / schedules / messages)
SHIFT_TYPES = [
    (ShiftTypeCode.regular, "Regular", time(9, 0), time(17, 0), True),
    (ShiftTypeCode.sleep, "Sleep", time(22, 0), time(6, 0), True),
    (ShiftTypeCode.waking_night, "Waking Night", time(21, 30), time(7, 0), True),
    (ShiftTypeCode.annual_leave, "Annual Leave", None, None, False),
    (ShiftTypeCode.sick, "Sick", None, None, False),
]


def ensure_shift_types(db: Session) -> None:
    """Ensure shift-type lookup rows exist. Does not create users or sample data."""
    existing = {t.code for t in db.query(ShiftType).all()}
    added = False
    for code, name, start, end, counts in SHIFT_TYPES:
        if code in existing:
            continue
        db.add(
            ShiftType(
                code=code,
                display_name=name,
                default_start=start,
                default_end=end,
                counts_as_worked_hours=counts,
            )
        )
        added = True
    if added:
        db.commit()


def ensure_manager(db: Session) -> None:
    """Ensure the hardcoded manager account exists."""
    email = settings.manager_email.strip().lower()
    existing = db.query(Employee).filter(Employee.email == email).first()
    if existing:
        # Keep password/role in sync with configured bootstrap creds
        existing.password_hash = hash_password(settings.manager_password)
        existing.full_name = settings.manager_name
        existing.role = Role.manager
        existing.active = True
        db.commit()
        return

    db.add(
        Employee(
            email=email,
            password_hash=hash_password(settings.manager_password),
            full_name=settings.manager_name,
            role=Role.manager,
            contract_type=ContractType.full_time,
            max_weekly_hours=40,
            active=True,
        )
    )
    db.commit()
