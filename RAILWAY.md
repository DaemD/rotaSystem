# Railway — deploy guide
# ========================
# You need 3 services in one Railway project:
#   1) Postgres
#   2) API  (this repo /api)
#   3) Web  (this repo /web)

## 1. Create project
1. Go to https://railway.app → New Project
2. Add **PostgreSQL**
3. Connect your GitHub repo (or deploy from local CLI)

## 2. Deploy API
1. New Service → from same repo
2. Settings → **Root Directory** = `api`
3. Settings → Builder = **Dockerfile** (uses `api/Dockerfile`)
4. Variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`  (Railway variable reference)
   - `SECRET_KEY` = long random string
5. Networking → Generate domain (e.g. `https://rota-api-xxx.up.railway.app`)

## 3. Deploy Web
1. New Service → same repo
2. Root Directory = `web`
3. Builder = Dockerfile
4. Variables (set BEFORE first successful build — Vite bakes this in):
   - `VITE_API_URL` = your API public URL, **no trailing slash**
     Example: `https://rota-api-xxx.up.railway.app`
5. Networking → Generate domain

## 4. Test
1. Open the **web** URL
2. Register a manager + employee
3. API docs: `https://YOUR-API-URL/docs`

## Local Docker reminder
Postgres locally still uses `docker compose up -d` on port 5433.
Railway is separate cloud DB.

## Common issues
- **Web can't call API**: wrong/missing `VITE_API_URL` → rebuild web after fixing
- **DB connection errors**: API must use Railway `DATABASE_URL` reference, not localhost
- **CORS**: API already allows all origins for this MVP
