from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth import AuthError, employee_id_from_token, get_employee_by_id
from app.database import get_db
from app.models import Employee, Role

bearer = HTTPBearer(auto_error=False)


def get_current_employee(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> Employee:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        emp_id = employee_id_from_token(creds.credentials)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    emp = get_employee_by_id(db, emp_id)
    if not emp:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return emp


def require_employee(current: Employee = Depends(get_current_employee)) -> Employee:
    if current.role not in (Role.employee, Role.manager, Role.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return current


def require_manager(current: Employee = Depends(get_current_employee)) -> Employee:
    if current.role not in (Role.manager, Role.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager access required")
    return current
