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

## Accounts
Public registration is disabled.

**Hardcoded manager** (seeded on API start):
- Email: `manager@supreme.com`
- Password: `Manager@123`

Override with env vars if needed: `MANAGER_EMAIL`, `MANAGER_PASSWORD`, `MANAGER_NAME`.

Managers create employee accounts from **Employees → Add employee**. Employees can only sign in.

