# Student Group Dashboard System

A full-stack web application for university students to form and submit groups, and for admins to manage submissions. Built originally on Replit but fully portable — clone, install, configure `.env`, and run anywhere Node.js + PostgreSQL exist.

> **Stack:** React 18 + Vite + TypeScript (frontend) · Express + Node.js + tsx (backend) · PostgreSQL + Drizzle ORM · Tailwind + shadcn/ui · TanStack Query · Wouter · Resend (email) · web-push (notifications) · OpenAI (AI assistant) · YouTube Data API v3 (virtual room).

## What it does

- **Student group submission** — Form for 1 leader + 6 members, real-time validation, per-project deadline countdown, re-edit token until deadline.
- **File submissions** — Configurable allowed file types, two-file uploads, virus scanning (extension + magic-byte + VirusTotal hash), persistent storage in object storage / GCS.
- **Student portal** — Mobile-first dashboard with My Group, Calendar, Storage, Announcements, Notes, Profile, and Virtual Room (AI explainer + YouTube videos).
- **Admin dashboard** — Group/file/student management, project cycles with deadlines, announcements, calendar with file attachments, staff management, Excel export, AI Admin Assistant.
- **Push notifications** — Browser push via Web Push API for assignment / exam reminders 1–2 days before due.
- **Auto-advance semester** — Daily scheduler bumps every student's semester on Feb 1 and Sept 1.
- **Credentials panel** — Admin can edit API keys (OpenAI, YouTube, Resend, VirusTotal, VAPID) directly from the dashboard, without touching `.env`.

## Quick start (any host)

```bash
# 1. Install Node 20+ and PostgreSQL.
node --version    # should be v20+
psql --version    # should be 14+

# 2. Clone and install
git clone <your-repo-url>
cd student-group-dashboard
npm install

# 3. Configure environment
cp .env.example .env
# → Edit .env: at minimum set DATABASE_URL and SESSION_SECRET.

# 4. Push schema to the database
npm run db:push

# 5. Start dev server (frontend + backend on the same port)
npm run dev
# → Open http://localhost:5000
```

That's it. The app listens on `PORT` (default `5000`) and serves both the frontend and the API.

## Environment variables — full reference

The minimum to boot is `DATABASE_URL` and `SESSION_SECRET`. Everything else can be left unset (features that depend on them degrade gracefully or are disabled), or set later via the **Admin → Credentials** panel.

> See [`.env.example`](./.env.example) for the same list with usage examples baked in. Copy that file to `.env` and edit it.

### 1. `DATABASE_URL` — **REQUIRED**
PostgreSQL connection string. The app stores everything here (groups, students, submissions, sessions, settings, push subscriptions, calendar events, announcements).

- **Where to get it:**
  - Local: install Postgres, then `createdb student_dashboard`
  - [Neon](https://neon.tech) — free 0.5 GB, never expires (recommended)
  - [Supabase](https://supabase.com) — free 500 MB, pauses after 7 days idle
  - Render / Railway / Fly — add a Postgres add-on, copy the connection URL
- **Format:** `postgresql://USER:PASSWORD@HOST:PORT/DBNAME`
- **Example:** `postgresql://postgres:postgres@localhost:5432/student_dashboard`

### 2. `SESSION_SECRET` — **REQUIRED**
Long random string used to sign Express session cookies. Changing it logs everyone out.

- **Generate:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **Example:** `a1b2c3d4e5f6...` (64 hex chars)

### 3. `OPENAI_API_KEY` — optional
Powers the AI Admin Assistant and the Virtual Room "explain this video" feature.

- **Where to get it:** https://platform.openai.com/api-keys
- **Cost:** Pay-per-use (billed to whoever owns the key).
- **Example:** `sk-proj-abc123XYZ456...`

### 4. `YOUTUBE_API_KEY` — optional
Used by the Virtual Room video search. Without it, the app falls back to scraping youtube.com (fragile).

- **Where to get it:** https://console.cloud.google.com/apis/credentials → enable "YouTube Data API v3" → create API key.
- **Quota:** Free, 10,000 units/day.
- **Example:** `AIzaSyABC123def456GHI789jkl`

### 5. `RESEND_API_KEY` + `RESEND_FROM` — optional but **needed for student registration & admin password reset**
Sends admin 2FA codes, magic-link password resets, and student verification emails.

- **Where to get it:** https://resend.com/api-keys (free 100 emails/day).
- **`RESEND_FROM`:** must be `onboarding@resend.dev` on the free tier, or any address on a [verified domain](https://resend.com/domains).
- **Example:** `RESEND_API_KEY=re_AbCdEfGh_1234567890`
- **Example:** `RESEND_FROM=Student Group Portal <onboarding@resend.dev>`

### 6. `VIRUSTOTAL_API_KEY` — optional
Adds a third virus-scan layer (after blocked extensions and magic-byte checks). Uses v3 hash lookup — no file bytes are uploaded.

- **Where to get it:** https://www.virustotal.com/gui/my-apikey (free).
- **Quota:** 4 lookups/min, 500/day.
- **Example:** `5a3b7c9d1e2f...` (64 hex chars)

### 7. `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` — optional
Browser push notifications for assignment / exam reminders. Without these, push is silently disabled.

- **Generate:** `npx web-push generate-vapid-keys`
- **`VAPID_SUBJECT`:** any `mailto:` address you control (required by VAPID spec).
- **Warning:** changing the keys after users have subscribed invalidates every existing subscription.

### 8. `GOOGLE_BOOKS_API_KEY` — optional
Powers the student **Library** tab — search books by title, author, publisher, year, ISBN, category; download free public-domain PDFs.

- **Where to get it:** https://console.cloud.google.com/apis/credentials → enable "Books API" → create API key.
- **Quota:** Free, 100,000 queries/day with a key (vs. 1,000/day without).
- **Example:** `AIzaSyXYZ987abc654DEF321ghi`

### 9. `APP_BASE_URL` — optional
Forces the URL used in emailed links. Leave empty to auto-detect from Replit env vars or localhost.

- **Example:** `https://groups.youruniversity.edu`

### 10. `PORT` / `NODE_ENV` — server runtime
- `PORT` defaults to `5000` (frontend + API on the same port).
- `NODE_ENV=production` when running `npm run start`.

### 11. Replit-only — auto-set, ignore on other hosts
`REPL_ID`, `REPLIT_DOMAINS`, `REPLIT_DEPLOYMENT_DOMAIN`, `ISSUER_URL`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID`. Off-Replit, file uploads fall back to local disk under `./uploads/`.

### Summary table

| Variable | Required? | Editable in admin panel? |
|---|---|---|
| `DATABASE_URL`        | **Yes** | No (chicken-and-egg) |
| `SESSION_SECRET`      | **Yes** | No (would log everyone out) |
| `OPENAI_API_KEY`      | for AI features | ✅ |
| `YOUTUBE_API_KEY`     | for video search | ✅ |
| `RESEND_API_KEY`      | for emails | ✅ |
| `RESEND_FROM`         | for emails | ✅ |
| `VIRUSTOTAL_API_KEY`  | optional | ✅ |
| `VAPID_PUBLIC_KEY`    | for push | ✅ |
| `VAPID_PRIVATE_KEY`   | for push | ✅ |
| `VAPID_SUBJECT`       | for push | ✅ |
| `GOOGLE_BOOKS_API_KEY`| for Library tab | ✅ |
| `APP_BASE_URL`        | optional | ✅ |

## Project structure

```
.
├── client/                     # React frontend (Vite)
│   └── src/
│       ├── pages/              # Home, Admin, FileSubmit, StudentPortal, ...
│       ├── components/ui/      # shadcn/ui primitives
│       ├── hooks/              # use-toast, etc.
│       └── lib/                # queryClient, utils
├── server/                     # Express backend (tsx)
│   ├── index.ts                # entrypoint
│   ├── routes.ts               # legacy router; new routes under routes/
│   ├── routes/                 # ai, files, push, students, ...
│   ├── services/               # ai, push-scheduler, semester-scheduler
│   ├── lib/                    # virusScan, fileStorage, credentials
│   ├── replit_integrations/    # OpenAI / object-storage / auth helpers
│   ├── storage.ts              # IStorage data-access layer
│   ├── db.ts                   # pg Pool + drizzle
│   └── email.ts                # Resend wrapper
├── shared/                     # Code shared by client + server
│   ├── schema.ts               # Drizzle tables + Zod schemas
│   └── routes.ts               # Type-safe API contracts
├── drizzle.config.ts           # Drizzle Kit config
├── vite.config.ts              # Vite config
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── .env.example                # Copy → .env and fill in
```

## Scripts

```bash
npm run dev       # Start both backend (tsx watch) and frontend (Vite HMR) on PORT (default 5000).
npm run build     # Build frontend (Vite) + backend (esbuild bundle to dist/).
npm run start     # Run the production build (NODE_ENV=production).
npm run db:push   # Push the Drizzle schema to PostgreSQL (no migrations file).
npm run check     # TypeScript type-check.
```

## Deploying somewhere other than Replit

Anywhere that runs Node 20+ will work:

| Host | What you need |
|---|---|
| **Render / Railway / Fly.io / Heroku-like** | Set env vars in the dashboard, point start command at `npm run start`, attach a PostgreSQL add-on, add a build command of `npm run build`. |
| **VPS (DigitalOcean / Hetzner / EC2)** | Install Node + Postgres, clone, `npm ci`, `.env`, `npm run build`, `npm run start`, put behind nginx + Let's Encrypt. Use `pm2` to keep it alive. |
| **Docker** | Use `node:20-alpine`, `COPY . . && npm ci && npm run build && CMD ["npm","run","start"]`. |

**File uploads:** if you don't have Replit Object Storage, leave `PRIVATE_OBJECT_DIR` empty — uploads will fall back to local disk under `./uploads/`. For production, mount that directory on persistent storage.

**Free Postgres options:** Neon (recommended, 0.5 GB free, never expires), Supabase (500 MB but pauses after 7 days idle), Tembo (1 GB free).

## Admin Credentials Panel

Once the app is running, log in to `/admin` and open the **Credentials** tab. You can paste, edit and clear API keys (OpenAI, YouTube, Resend, VirusTotal, VAPID, etc.) without touching `.env` or restarting. Values entered here override the corresponding environment variable; clearing reverts to the environment variable.

> Two credentials must stay in `.env` (cannot be edited in the panel): `DATABASE_URL` (needed before the DB is reachable) and `SESSION_SECRET` (changing it logs everyone out).

## License

Internal university project. All rights reserved.
