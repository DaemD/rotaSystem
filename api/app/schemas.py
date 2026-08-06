from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel, Field

from app.models import LeaveStatus, LeaveType, Role, ShiftTypeCode


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginIn(BaseModel):
    email: str
    password: str


class CreateEmployeeIn(BaseModel):
    email: str
    password: str = Field(min_length=6)
    full_name: str = Field(min_length=1, max_length=255)
    contract_type: str = "full_time"
    max_weekly_hours: int = Field(default=40, ge=1, le=80)
    work_start: time | None = None
    work_end: time | None = None


class EmployeeHoursIn(BaseModel):
    work_start: time
    work_end: time


class EmployeeOut(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: Role
    contract_type: str
    max_weekly_hours: int
    work_start: time | None = None
    work_end: time | None = None
    active: bool = True

    model_config = {"from_attributes": True}


class ShiftTypeOut(BaseModel):
    id: UUID
    code: ShiftTypeCode
    display_name: str
    default_start: time | None
    default_end: time | None
    counts_as_worked_hours: bool

    model_config = {"from_attributes": True}


class ScheduledShiftOut(BaseModel):
    id: UUID
    shift_date: date
    start_time: time
    end_time: time
    shift_type: ShiftTypeOut
    employee_id: UUID | None = None
    employee_name: str | None = None

    model_config = {"from_attributes": True}


class ClockInIn(BaseModel):
    shift_type: ShiftTypeCode = ShiftTypeCode.regular


class ClockEventOut(BaseModel):
    id: UUID
    shift_type: ShiftTypeOut
    clock_in_at: datetime
    clock_out_at: datetime | None
    lateness_minutes: int
    scheduled_shift_id: UUID | None
    employee_id: UUID | None = None
    employee_name: str | None = None
    admin_override: bool = False
    override_reason: str | None = None

    model_config = {"from_attributes": True}


class LeaveCreateIn(BaseModel):
    leave_type: LeaveType
    start_date: date
    end_date: date
    note: str | None = None


class LeaveOut(BaseModel):
    id: UUID
    leave_type: LeaveType
    start_date: date
    end_date: date
    status: LeaveStatus
    note: str | None
    created_at: datetime
    employee_id: UUID | None = None
    employee_name: str | None = None

    model_config = {"from_attributes": True}


class LeaveDecisionIn(BaseModel):
    status: LeaveStatus


class MessageCreateIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class MessageOut(BaseModel):
    id: UUID
    sender_id: UUID
    recipient_id: UUID
    text: str
    read: bool
    created_at: datetime
    from_me: bool = False

    model_config = {"from_attributes": True}


class MessageThreadOut(BaseModel):
    employee_id: UUID
    employee_name: str
    last_text: str
    last_at: datetime
    unread_count: int


class BroadcastIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class AdminClockOutIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class WeeklySummaryOut(BaseModel):
    week_start: date
    week_end: date
    hours_worked: float
    shifts_completed: int
    currently_clocked_in: bool
    open_clock_event: ClockEventOut | None = None
    scheduled_this_week: int
    leave_days_pending: int


class OverviewOut(BaseModel):
    range_days: int
    employees_active: int
    currently_clocked_in: int
    hours_worked: float
    shifts_completed: int
    late_events: int
    pending_leave: int
    sick_requests: int
    annual_leave_requests: int


class RotaShiftCreateIn(BaseModel):
    employee_id: UUID
    shift_date: date
    shift_type: ShiftTypeCode
    start_time: time | None = None
    end_time: time | None = None


class RotaShiftUpsertIn(BaseModel):
    employee_id: UUID
    shift_date: date
    shift_type: ShiftTypeCode
    start_time: time
    end_time: time
