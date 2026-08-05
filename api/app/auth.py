from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Employee

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict[str, Any] = {"sub": subject, "exp": expire}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])


def authenticate_employee(db: Session, email: str, password: str) -> Employee | None:
    emp = db.query(Employee).filter(Employee.email == email.lower(), Employee.active.is_(True)).first()
    if not emp or not verify_password(password, emp.password_hash):
        return None
    return emp


def get_employee_by_id(db: Session, employee_id: UUID) -> Employee | None:
    return db.query(Employee).filter(Employee.id == employee_id, Employee.active.is_(True)).first()


class AuthError(Exception):
    pass


def employee_id_from_token(token: str) -> UUID:
    try:
        payload = decode_token(token)
        sub = payload.get("sub")
        if not sub:
            raise AuthError("Invalid token")
        return UUID(sub)
    except (JWTError, ValueError) as exc:
        raise AuthError("Invalid or expired token") from exc
