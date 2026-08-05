# Supreme Childcare — Time & Attendance (employee slice)

## Stack
- `api/` — FastAPI + SQLAlchemy + PostgreSQL (Swagger at `/docs`)
- `web/` — React + TypeScript employee portal
- `docker-compose.yml` — local Postgres on **port 5433**

## Quick start

```bash
# 1) Database
docker compose up -d

# 2) API
cd api
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --app-dir .
# open http://127.0.0.1:8000/docs

# 3) Web
cd ../web
npm install
npm run dev
```

## First-time accounts
No demo users are seeded. Register via the UI or Swagger:

1. `POST /auth/register` — create a **manager**
2. `POST /auth/register` — create an **employee**
3. `POST /auth/login` → Authorize with the token

Role routes the UI automatically:
- `employee` → employee portal
- `manager` / `admin` → manager CRM

### Manager APIs (`/admin/...`)
Overview, live attendance, employees, leave approve/reject, manual rota shifts, messages/broadcast, force clock-out.

Only shift-type lookup rows are auto-created. Schedule, leave, clock events, and messages are empty until created through the API.

