import enum
import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Role(str, enum.Enum):
    employee = "employee"
    manager = "manager"
    admin = "admin"


class ContractType(str, enum.Enum):
    full_time = "full_time"
    part_time = "part_time"


class ShiftTypeCode(str, enum.Enum):
    regular = "regular"
    sleep = "sleep"
    waking_night = "waking_night"
    annual_leave = "annual_leave"
    sick = "sick"


class LeaveType(str, enum.Enum):
    annual_leave = "annual_leave"
    sick = "sick"


class LeaveStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    taken = "taken"


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, name="role_enum"), default=Role.employee)
    contract_type: Mapped[ContractType] = mapped_column(
        Enum(ContractType, name="contract_type_enum"), default=ContractType.full_time
    )
    max_weekly_hours: Mapped[int] = mapped_column(Integer, default=40)
    work_start: Mapped[time] = mapped_column(Time, default=time(9, 0))
    work_end: Mapped[time] = mapped_column(Time, default=time(17, 0))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    scheduled_shifts: Mapped[list["ScheduledShift"]] = relationship(back_populates="employee")
    clock_events: Mapped[list["ClockEvent"]] = relationship(
        back_populates="employee", foreign_keys="ClockEvent.employee_id"
    )
    leave_records: Mapped[list["LeaveRecord"]] = relationship(back_populates="employee")
    sent_messages: Mapped[list["Message"]] = relationship(
        back_populates="sender", foreign_keys="Message.sender_id"
    )


class ShiftType(Base):
    __tablename__ = "shift_types"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[ShiftTypeCode] = mapped_column(
        Enum(ShiftTypeCode, name="shift_type_code_enum"), unique=True
    )
    display_name: Mapped[str] = mapped_column(String(100))
    default_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    default_end: Mapped[time | None] = mapped_column(Time, nullable=True)
    counts_as_worked_hours: Mapped[bool] = mapped_column(Boolean, default=True)


class RotaPublication(Base):
    __tablename__ = "rota_publications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    week_start_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="published")
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    scheduled_shifts: Mapped[list["ScheduledShift"]] = relationship(back_populates="rota")


class ScheduledShift(Base):
    __tablename__ = "scheduled_shifts"
    __table_args__ = (UniqueConstraint("employee_id", "shift_date", name="uq_emp_day"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rota_publication_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rota_publications.id"), nullable=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"))
    shift_date: Mapped[date] = mapped_column(Date, index=True)
    shift_type_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shift_types.id"))
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)

    employee: Mapped[Employee] = relationship(back_populates="scheduled_shifts")
    shift_type: Mapped[ShiftType] = relationship()
    rota: Mapped[RotaPublication | None] = relationship(back_populates="scheduled_shifts")


class ClockEvent(Base):
    __tablename__ = "clock_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"), index=True)
    scheduled_shift_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scheduled_shifts.id"), nullable=True
    )
    shift_type_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shift_types.id"))
    clock_in_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    clock_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lateness_minutes: Mapped[int] = mapped_column(Integer, default=0)
    admin_override: Mapped[bool] = mapped_column(Boolean, default=False)
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    override_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    employee: Mapped[Employee] = relationship(back_populates="clock_events", foreign_keys=[employee_id])
    shift_type: Mapped[ShiftType] = relationship()
    scheduled_shift: Mapped[ScheduledShift | None] = relationship()


class LeaveRecord(Base):
    __tablename__ = "leave_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"), index=True)
    leave_type: Mapped[LeaveType] = mapped_column(Enum(LeaveType, name="leave_type_enum"))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    status: Mapped[LeaveStatus] = mapped_column(
        Enum(LeaveStatus, name="leave_status_enum"), default=LeaveStatus.pending
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    employee: Mapped[Employee] = relationship(back_populates="leave_records")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sender_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"), index=True)
    recipient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sender: Mapped[Employee] = relationship(back_populates="sent_messages", foreign_keys=[sender_id])
    recipient: Mapped[Employee] = relationship(foreign_keys=[recipient_id])
