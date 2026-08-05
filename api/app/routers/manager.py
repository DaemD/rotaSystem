from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import require_manager
from app.models import (
    ClockEvent,
    Employee,
    LeaveRecord,
    LeaveStatus,
    LeaveType,
    Message,
    Role,
    RotaPublication,
    ScheduledShift,
    ShiftType,
    ShiftTypeCode,
)
from app.schemas import (
    AdminClockOutIn,
    BroadcastIn,
    ClockEventOut,
    EmployeeOut,
    LeaveDecisionIn,
    LeaveOut,
    MessageCreateIn,
    MessageOut,
    MessageThreadOut,
    OverviewOut,
    RotaShiftCreateIn,
    ScheduledShiftOut,
    ShiftTypeOut,
)

router = APIRouter(prefix="/admin", tags=["Manager"])


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
        employee_id=ev.employee_id,
        employee_name=ev.employee.full_name if ev.employee else None,
        admin_override=ev.admin_override,
        override_reason=ev.override_reason,
    )


def _leave_out(rec: LeaveRecord) -> LeaveOut:
    return LeaveOut(
        id=rec.id,
        leave_type=rec.leave_type,
        start_date=rec.start_date,
        end_date=rec.end_date,
        status=rec.status,
        note=rec.note,
        created_at=rec.created_at,
        employee_id=rec.employee_id,
        employee_name=rec.employee.full_name if rec.employee else None,
    )


def _scheduled_out(row: ScheduledShift) -> ScheduledShiftOut:
    return ScheduledShiftOut(
        id=row.id,
        shift_date=row.shift_date,
        start_time=row.start_time,
        end_time=row.end_time,
        shift_type=_shift_type_out(row.shift_type),
        employee_id=row.employee_id,
        employee_name=row.employee.full_name if row.employee else None,
    )


@router.get("/overview", response_model=OverviewOut)
def overview(
    range_days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_manager),
) -> OverviewOut:
    start = datetime.now(timezone.utc) - timedelta(days=range_days)
    events = (
        db.query(ClockEvent)
        .options(joinedload(ClockEvent.shift_type), joinedload(ClockEvent.employee))
        .filter(ClockEvent.clock_in_at >= start)
        .all()
    )
    hours = 0.0
    completed = 0
    late = 0
    open_count = 0
    for ev in events:
        if ev.clock_out_at is None:
            open_count += 1
            continue
        if ev.shift_type.counts_as_worked_hours:
            hours += (ev.clock_out_at - ev.clock_in_at).total_seconds() / 3600
            completed += 1
        if ev.lateness_minutes > 0:
            late += 1

    # recount currently clocked-in globally (not just in range)
    currently_in = db.query(ClockEvent).filter(ClockEvent.clock_out_at.is_(None)).count()
    staff = db.query(Employee).filter(Employee.role == Role.employee, Employee.active.is_(True)).count()
    pending = db.query(LeaveRecord).filter(LeaveRecord.status == LeaveStatus.pending).count()
    sick = (
        db.query(LeaveRecord)
        .filter(LeaveRecord.leave_type == LeaveType.sick, LeaveRecord.created_at >= start)
        .count()
    )
    annual = (
        db.query(LeaveRecord)
        .filter(LeaveRecord.leave_type == LeaveType.annual_leave, LeaveRecord.created_at >= start)
        .count()
    )
    return OverviewOut(
        range_days=range_days,
        employees_active=staff,
        currently_clocked_in=currently_in,
        hours_worked=round(hours, 2),
        shifts_completed=completed,
        late_events=late,
        pending_leave=pending,
        sick_requests=sick,
        annual_leave_requests=annual,
    )


@router.get("/live", response_model=list[ClockEventOut])
def live(
    db: Session = Depends(get_db),
    _: Employee = Depends(require_manager),
) -> list[ClockEventOut]:
    rows = (
        db.query(ClockEvent)
        .options(joinedload(ClockEvent.shift_type), joinedload(ClockEvent.employee))
        .filter(ClockEvent.clock_out_at.is_(None))
        .order_by(ClockEvent.clock_in_at.asc())
        .all()
    )
    return [_clock_out(r) for r in rows]


@router.get("/employees", response_model=list[EmployeeOut])
def list_employees(
    db: Session = Depends(get_db),
    _: Employee = Depends(require_manager),
) -> list[Employee]:
    return (
        db.query(Employee)
        .filter(Employee.role == Role.employee, Employee.active.is_(True))
        .order_by(Employee.full_name.asc())
        .all()
    )


@router.get("/leave", response_model=list[LeaveOut])
def list_leave(
    status_filter: LeaveStatus | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_manager),
) -> list[LeaveOut]:
    q = db.query(LeaveRecord).options(joinedload(LeaveRecord.employee))
    if status_filter:
        q = q.filter(LeaveRecord.status == status_filter)
    rows = q.order_by(LeaveRecord.created_at.desc()).all()
    return [_leave_out(r) for r in rows]


@router.patch("/leave/{leave_id}", response_model=LeaveOut)
def decide_leave(
    leave_id: UUID,
    body: LeaveDecisionIn,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_manager),
) -> LeaveOut:
    if body.status not in (LeaveStatus.approved, LeaveStatus.rejected):
        raise HTTPException(status_code=400, detail="status must be approved or rejected")
    rec = (
        db.query(LeaveRecord)
        .options(joinedload(LeaveRecord.employee))
        .filter(LeaveRecord.id == leave_id)
        .first()
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if rec.status != LeaveStatus.pending:
        raise HTTPException(status_code=400, detail="Only pending requests can be decided")
    rec.status = body.status
    db.commit()
    db.refresh(rec)
    return _leave_out(rec)


@router.get("/rota", response_model=list[ScheduledShiftOut])
def get_rota(
    week_start: date | None = Query(None),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_manager),
) -> list[ScheduledShiftOut]:
    start = week_start or _monday(date.today())
    end = start + timedelta(days=6)
    rows = (
        db.query(ScheduledShift)
        .options(joinedload(ScheduledShift.shift_type), joinedload(ScheduledShift.employee))
        .filter(ScheduledShift.shift_date >= start, ScheduledShift.shift_date <= end)
        .order_by(ScheduledShift.shift_date, ScheduledShift.start_time)
        .all()
    )
    return [_scheduled_out(r) for r in rows]


@router.post("/rota/shifts", response_model=ScheduledShiftOut, status_code=201)
def create_rota_shift(
    body: RotaShiftCreateIn,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_manager),
) -> ScheduledShiftOut:
    emp = (
        db.query(Employee)
        .filter(Employee.id == body.employee_id, Employee.role == Role.employee, Employee.active.is_(True))
        .first()
    )
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    if body.shift_type in (ShiftTypeCode.annual_leave, ShiftTypeCode.sick):
        raise HTTPException(status_code=400, detail="Use leave flow for absence types")
    st = db.query(ShiftType).filter(ShiftType.code == body.shift_type).first()
    if not st:
        raise HTTPException(status_code=400, detail="Unknown shift type")

    start_t = body.start_time or st.default_start
    end_t = body.end_time or st.default_end
    if not start_t or not end_t:
        raise HTTPException(status_code=400, detail="start_time and end_time required for this shift type")

    week = _monday(body.shift_date)
    rota = (
        db.query(RotaPublication)
        .filter(RotaPublication.week_start_date == week, RotaPublication.status == "published")
        .first()
    )
    if not rota:
        rota = RotaPublication(week_start_date=week, status="published")
        db.add(rota)
        db.flush()

    row = ScheduledShift(
        rota_publication_id=rota.id,
        employee_id=emp.id,
        shift_date=body.shift_date,
        shift_type_id=st.id,
        start_time=start_t,
        end_time=end_t,
    )
    db.add(row)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not create shift (possible duplicate)") from exc
    row = (
        db.query(ScheduledShift)
        .options(joinedload(ScheduledShift.shift_type), joinedload(ScheduledShift.employee))
        .filter(ScheduledShift.id == row.id)
        .one()
    )
    return _scheduled_out(row)


@router.delete("/rota/shifts/{shift_id}", status_code=204)
def delete_rota_shift(
    shift_id: UUID,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_manager),
) -> None:
    row = db.query(ScheduledShift).filter(ScheduledShift.id == shift_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Shift not found")
    db.delete(row)
    db.commit()


def _manager_ids(db: Session) -> list:
    return [
        m.id
        for m in db.query(Employee)
        .filter(Employee.role.in_([Role.manager, Role.admin]), Employee.active.is_(True))
        .all()
    ]


@router.get("/messages/threads", response_model=list[MessageThreadOut])
def message_threads(
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager),
) -> list[MessageThreadOut]:
    mgr_ids = _manager_ids(db)
    staff = (
        db.query(Employee)
        .filter(Employee.role == Role.employee, Employee.active.is_(True))
        .order_by(Employee.full_name.asc())
        .all()
    )
    threads: list[MessageThreadOut] = []
    for emp in staff:
        msgs = (
            db.query(Message)
            .filter(
                or_(
                    and_(Message.sender_id == emp.id, Message.recipient_id.in_(mgr_ids)),
                    and_(Message.sender_id.in_(mgr_ids), Message.recipient_id == emp.id),
                )
            )
            .order_by(Message.created_at.desc())
            .all()
        )
        if not msgs:
            continue
        last = msgs[0]
        unread = sum(1 for m in msgs if m.recipient_id == current.id and not m.read)
        threads.append(
            MessageThreadOut(
                employee_id=emp.id,
                employee_name=emp.full_name,
                last_text=last.text,
                last_at=last.created_at,
                unread_count=unread,
            )
        )
    threads.sort(key=lambda t: t.last_at, reverse=True)
    return threads


@router.post("/messages/broadcast", response_model=dict, status_code=201)
def broadcast(
    body: BroadcastIn,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager),
) -> dict:
    staff = db.query(Employee).filter(Employee.role == Role.employee, Employee.active.is_(True)).all()
    if not staff:
        raise HTTPException(status_code=400, detail="No employees to broadcast to")
    text = body.text.strip()
    for emp in staff:
        db.add(Message(sender_id=current.id, recipient_id=emp.id, text=text))
    db.commit()
    return {"sent": len(staff)}


@router.get("/messages/{employee_id}", response_model=list[MessageOut])
def get_thread(
    employee_id: UUID,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager),
) -> list[MessageOut]:
    emp = db.query(Employee).filter(Employee.id == employee_id, Employee.role == Role.employee).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    mgr_ids = _manager_ids(db)
    rows = (
        db.query(Message)
        .filter(
            or_(
                and_(Message.sender_id == emp.id, Message.recipient_id.in_(mgr_ids)),
                and_(Message.sender_id.in_(mgr_ids), Message.recipient_id == emp.id),
            )
        )
        .order_by(Message.created_at.asc())
        .all()
    )
    for m in rows:
        if m.recipient_id in mgr_ids and not m.read:
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
            from_me=m.sender_id in mgr_ids,
        )
        for m in rows
    ]


@router.post("/messages/{employee_id}", response_model=MessageOut, status_code=201)
def reply_to_employee(
    employee_id: UUID,
    body: MessageCreateIn,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager),
) -> MessageOut:
    emp = db.query(Employee).filter(Employee.id == employee_id, Employee.role == Role.employee).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    msg = Message(sender_id=current.id, recipient_id=emp.id, text=body.text.strip())
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


@router.post("/employees/{employee_id}/clock-out", response_model=ClockEventOut)
def admin_clock_out(
    employee_id: UUID,
    body: AdminClockOutIn,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager),
) -> ClockEventOut:
    open_ev = (
        db.query(ClockEvent)
        .options(joinedload(ClockEvent.shift_type), joinedload(ClockEvent.employee))
        .filter(ClockEvent.employee_id == employee_id, ClockEvent.clock_out_at.is_(None))
        .first()
    )
    if not open_ev:
        raise HTTPException(status_code=400, detail="Employee is not clocked in")
    open_ev.clock_out_at = datetime.now(timezone.utc)
    open_ev.admin_override = True
    open_ev.override_reason = body.reason.strip()
    open_ev.override_by = current.id
    db.commit()
    db.refresh(open_ev)
    return _clock_out(open_ev)
