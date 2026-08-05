from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from app.auth import authenticate_employee, create_access_token, hash_password
from app.database import get_db
from app.deps import require_employee
from app.models import (
    ClockEvent,
    ContractType,
    Employee,
    LeaveRecord,
    LeaveStatus,
    Message,
    Role,
    ScheduledShift,
    ShiftType,
    ShiftTypeCode,
)
from app.schemas import (
    ClockEventOut,
    ClockInIn,
    EmployeeOut,
    LeaveCreateIn,
    LeaveOut,
    LoginIn,
    MessageCreateIn,
    MessageOut,
    RegisterIn,
    ScheduledShiftOut,
    ShiftTypeOut,
    TokenOut,
    WeeklySummaryOut,
)

router = APIRouter()


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _shift_type_out(st: ShiftType) -> ShiftTypeOut:
    return ShiftTypeOut.model_validate(st)


def _clock_out(ev: ClockEvent) -> ClockEventOut:
    return ClockEventOut(
        id=ev.id,
        shift_type=_shift_type_out(ev.shift_type),
        clock_in_at=ev.clock_in_at,
        clock_out_at=ev.clock_out_at,
        lateness_minutes=ev.lateness_minutes,
        scheduled_shift_id=ev.scheduled_shift_id,
        admin_override=bool(getattr(ev, "admin_override", False)),
        override_reason=getattr(ev, "override_reason", None),
    )


def _get_manager(db: Session) -> Employee:
    mgr = (
        db.query(Employee)
        .filter(Employee.role.in_([Role.manager, Role.admin]), Employee.active.is_(True))
        .order_by(Employee.created_at.asc())
        .first()
    )
    if not mgr:
        raise HTTPException(
            status_code=400,
            detail="No manager account yet. Register a manager via POST /auth/register first.",
        )
    return mgr


@router.post("/auth/register", response_model=EmployeeOut, status_code=201, tags=["Auth"])
def register(body: RegisterIn, db: Session = Depends(get_db)) -> Employee:
    email = body.email.strip().lower()
    if db.query(Employee).filter(Employee.email == email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    if body.role not in (Role.employee, Role.manager):
        raise HTTPException(status_code=400, detail="Role must be employee or manager")
    emp = Employee(
        email=email,
        password_hash=hash_password(body.password),
        full_name=body.full_name.strip(),
        role=body.role,
        contract_type=ContractType.full_time,
        max_weekly_hours=40,
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return emp


@router.post("/auth/login", response_model=TokenOut, tags=["Auth"])
def login(body: LoginIn, db: Session = Depends(get_db)) -> TokenOut:
    emp = authenticate_employee(db, body.email, body.password)
    if not emp:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    token = create_access_token(str(emp.id), {"role": emp.role.value})
    return TokenOut(access_token=token)


@router.get("/me", response_model=EmployeeOut, tags=["Employee"])
def me(current: Employee = Depends(require_employee)) -> Employee:
    return current


@router.get("/shift-types", response_model=list[ShiftTypeOut], tags=["Employee"])
def list_shift_types(db: Session = Depends(get_db), _: Employee = Depends(require_employee)) -> list[ShiftType]:
    return db.query(ShiftType).order_by(ShiftType.display_name).all()


@router.get("/me/shifts", response_model=list[ScheduledShiftOut], tags=["Employee"])
def my_schedule(
    week_start: date | None = Query(None, description="Monday of the week; defaults to current week"),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_employee),
) -> list[ScheduledShiftOut]:
    start = week_start or _monday(date.today())
    end = start + timedelta(days=6)
    rows = (
        db.query(ScheduledShift)
        .options(joinedload(ScheduledShift.shift_type))
        .filter(
            ScheduledShift.employee_id == current.id,
            ScheduledShift.shift_date >= start,
            ScheduledShift.shift_date <= end,
        )
        .order_by(ScheduledShift.shift_date, ScheduledShift.start_time)
        .all()
    )
    return [
        ScheduledShiftOut(
            id=r.id,
            shift_date=r.shift_date,
            start_time=r.start_time,
            end_time=r.end_time,
            shift_type=_shift_type_out(r.shift_type),
        )
        for r in rows
    ]


@router.get("/me/summary", response_model=WeeklySummaryOut, tags=["Employee"])
def my_summary(
    db: Session = Depends(get_db),
    current: Employee = Depends(require_employee),
) -> WeeklySummaryOut:
    start = _monday(date.today())
    end = start + timedelta(days=6)
    events = (
        db.query(ClockEvent)
        .options(joinedload(ClockEvent.shift_type))
        .filter(
            ClockEvent.employee_id == current.id,
            ClockEvent.clock_in_at >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
            ClockEvent.clock_in_at
            < datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc),
        )
        .all()
    )
    hours = 0.0
    completed = 0
    open_ev: ClockEvent | None = None
    for ev in events:
        if ev.clock_out_at is None:
            open_ev = ev
            continue
        if ev.shift_type.counts_as_worked_hours:
            hours += (ev.clock_out_at - ev.clock_in_at).total_seconds() / 3600
            completed += 1

    scheduled = (
        db.query(ScheduledShift)
        .filter(
            ScheduledShift.employee_id == current.id,
            ScheduledShift.shift_date >= start,
            ScheduledShift.shift_date <= end,
        )
        .count()
    )
    pending_leave = (
        db.query(LeaveRecord)
        .filter(LeaveRecord.employee_id == current.id, LeaveRecord.status == LeaveStatus.pending)
        .count()
    )
    return WeeklySummaryOut(
        week_start=start,
        week_end=end,
        hours_worked=round(hours, 2),
        shifts_completed=completed,
        currently_clocked_in=open_ev is not None,
        open_clock_event=_clock_out(open_ev) if open_ev else None,
        scheduled_this_week=scheduled,
        leave_days_pending=pending_leave,
    )


@router.post("/shifts/clock-in", response_model=ClockEventOut, tags=["Clock"])
def clock_in(
    body: ClockInIn,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_employee),
) -> ClockEventOut:
    open_ev = (
        db.query(ClockEvent)
        .filter(ClockEvent.employee_id == current.id, ClockEvent.clock_out_at.is_(None))
        .first()
    )
    if open_ev:
        raise HTTPException(status_code=400, detail="Already clocked in — clock out first")

    st = db.query(ShiftType).filter(ShiftType.code == body.shift_type).first()
    if not st:
        raise HTTPException(status_code=400, detail="Unknown shift type")
    if body.shift_type in (ShiftTypeCode.annual_leave, ShiftTypeCode.sick):
        raise HTTPException(status_code=400, detail="Use leave request for annual leave / sick")

    now = datetime.now(timezone.utc)
    today = now.date()
    scheduled = (
        db.query(ScheduledShift)
        .filter(
            ScheduledShift.employee_id == current.id,
            ScheduledShift.shift_date == today,
            ScheduledShift.shift_type_id == st.id,
        )
        .first()
    )
    lateness = 0
    if scheduled:
        scheduled_dt = datetime.combine(today, scheduled.start_time, tzinfo=timezone.utc)
        lateness = max(0, int((now - scheduled_dt).total_seconds() // 60))

    ev = ClockEvent(
        employee_id=current.id,
        scheduled_shift_id=scheduled.id if scheduled else None,
        shift_type_id=st.id,
        clock_in_at=now,
        lateness_minutes=lateness,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    ev = (
        db.query(ClockEvent)
        .options(joinedload(ClockEvent.shift_type))
        .filter(ClockEvent.id == ev.id)
        .one()
    )
    return _clock_out(ev)


@router.post("/shifts/clock-out", response_model=ClockEventOut, tags=["Clock"])
def clock_out(
    db: Session = Depends(get_db),
    current: Employee = Depends(require_employee),
) -> ClockEventOut:
    open_ev = (
        db.query(ClockEvent)
        .options(joinedload(ClockEvent.shift_type))
        .filter(ClockEvent.employee_id == current.id, ClockEvent.clock_out_at.is_(None))
        .first()
    )
    if not open_ev:
        raise HTTPException(status_code=400, detail="Not clocked in")
    open_ev.clock_out_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(open_ev)
    return _clock_out(open_ev)


@router.get("/me/clock-events", response_model=list[ClockEventOut], tags=["Clock"])
def my_clock_events(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_employee),
) -> list[ClockEventOut]:
    rows = (
        db.query(ClockEvent)
        .options(joinedload(ClockEvent.shift_type))
        .filter(ClockEvent.employee_id == current.id)
        .order_by(ClockEvent.clock_in_at.desc())
        .limit(limit)
        .all()
    )
    return [_clock_out(r) for r in rows]


@router.post("/me/leave", response_model=LeaveOut, status_code=201, tags=["Leave"])
def request_leave(
    body: LeaveCreateIn,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_employee),
) -> LeaveRecord:
    if body.end_date < body.start_date:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
    rec = LeaveRecord(
        employee_id=current.id,
        leave_type=body.leave_type,
        start_date=body.start_date,
        end_date=body.end_date,
        status=LeaveStatus.pending,
        note=body.note,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@router.get("/me/leave", response_model=list[LeaveOut], tags=["Leave"])
def my_leave(
    db: Session = Depends(get_db),
    current: Employee = Depends(require_employee),
) -> list[LeaveRecord]:
    return (
        db.query(LeaveRecord)
        .filter(LeaveRecord.employee_id == current.id)
        .order_by(LeaveRecord.start_date.desc())
        .all()
    )


@router.get("/me/messages", response_model=list[MessageOut], tags=["Messages"])
def my_messages(
    db: Session = Depends(get_db),
    current: Employee = Depends(require_employee),
) -> list[MessageOut]:
    mgr_ids = [
        m.id
        for m in db.query(Employee)
        .filter(Employee.role.in_([Role.manager, Role.admin]), Employee.active.is_(True))
        .all()
    ]
    if not mgr_ids:
        raise HTTPException(
            status_code=400,
            detail="No manager account yet. Register a manager via POST /auth/register first.",
        )
    rows = (
        db.query(Message)
        .filter(
            ((Message.sender_id == current.id) & (Message.recipient_id.in_(mgr_ids)))
            | ((Message.sender_id.in_(mgr_ids)) & (Message.recipient_id == current.id))
        )
        .order_by(Message.created_at.asc())
        .all()
    )
    for m in rows:
        if m.recipient_id == current.id and not m.read:
            m.read = True
    db.commit()
    return [
        MessageOut(
            id=m.id,
            sender_id=m.sender_id,
            recipient_id=m.recipient_id,
            text=m.text,
            read=m.read,
            created_at=m.created_at,
            from_me=m.sender_id == current.id,
        )
        for m in rows
    ]


@router.post("/me/messages", response_model=MessageOut, status_code=201, tags=["Messages"])
def send_message_to_manager(
    body: MessageCreateIn,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_employee),
) -> MessageOut:
    mgr = _get_manager(db)
    msg = Message(sender_id=current.id, recipient_id=mgr.id, text=body.text.strip())
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return MessageOut(
        id=msg.id,
        sender_id=msg.sender_id,
        recipient_id=msg.recipient_id,
        text=msg.text,
        read=msg.read,
        created_at=msg.created_at,
        from_me=True,
    )
