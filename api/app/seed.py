from datetime import time

from sqlalchemy.orm import Session

from app.models import ShiftType, ShiftTypeCode

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
