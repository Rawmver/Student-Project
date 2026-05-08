# Student Group Dashboard System

This application helps university students form and submit groups, and provides administrators with tools to manage these submissions.

## Run & Operate

To run the application:
1.  **Install dependencies**: `npm install`
2.  **Generate Drizzle migrations**: `drizzle-kit generate:pg`
3.  **Apply migrations**: `drizzle-kit migrate`
4.  **Start development server**: `npm run dev` (client + server with HMR)
5.  **Build for production**: `npm run build`
6.  **Start production server**: `npm start`

Required Environment Variables:
-   `DATABASE_URL`: PostgreSQL connection string.
-   `SESSION_SECRET`: Secret for Express session cookies.
-   `REPL_ID`: Replit OIDC client ID.
-   `ISSUER_URL`: OIDC issuer URL (default: `https://replit.com/oidc`).
-   `RESEND_API_KEY`: API key for Resend email service.
-   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: Web Push (VAPID) keys and contact.
-   `VIRUSTOTAL_API_KEY`: Optional VirusTotal v3 API key.
-   `OPENAI_API_KEY`: Optional admin-supplied OpenAI key.
-   `GEMINI_API_KEY`: Optional Google Gemini key — used as automatic fallback when OpenAI is rate-limited / out of credit.
-   `YOUTUBE_API_KEY`: Optional admin-supplied YouTube Data API v3 key.

## Stack

-   **Frontend**: React 18, TypeScript, Vite, Wouter, `@tanstack/react-query`, `react-hook-form`, Zod, `shadcn/ui`, Tailwind CSS, `framer-motion`.
-   **Backend**: Express.js, Node.js (with `tsx`), TypeScript.
-   **Database**: PostgreSQL via Drizzle ORM.
-   **Authentication**: Replit Auth (OIDC), Custom Admin/Staff Auth (Basic + 2FA).
-   **Build Tool**: Vite.

## Where things live

-   **Frontend source**: `client/`
-   **Backend source**: `server/`
-   **Shared code**: `shared/` (includes Drizzle schema, Zod validation, API contracts)
-   **Database schema**: `shared/schema.ts`
-   **API contracts**: `shared/routes.ts`
-   **Replit Auth models**: `shared/models/auth.ts`
-   **UI Components**: `client/src/components/ui/` (`shadcn/ui` based)
-   **Database connection**: `server/db.ts`
-   **Study Play Room route**: `server/routes/study-play.routes.ts`
-   **File storage utility**: `server/lib/fileStorage.ts`
-   **Virus scanning logic**: `server/lib/virusScan.ts`
-   **Credential management**: `server/lib/credentials.ts` (+ `server/routes/credentials.routes.ts` — CRUD, reveal, test-connectivity, VAPID generator, health summary, export/import). Manages 60+ editable credentials across AI, Alternative AI, Email, SMTP, Push, Virus Scanning, Library, Databases (MongoDB/Redis/MySQL/Supabase/Firebase), Cloud Storage (AWS/R2), SMS & Messaging (Twilio/SendGrid/Mailgun/Slack/Discord/Telegram), Payments (Stripe/PayPal/Razorpay), Analytics (Sentry/PostHog/Mixpanel/GA), and Developer (GitHub). New entries auto-appear in the admin panel, grouped by category.
-   **File-format converter**: `server/lib/fileConvert.ts` (DOCX/images/text → PDF)

## Architecture decisions

-   **Shared Type-Safe API Contracts**: `shared/routes.ts` enforces type safety across frontend and backend using Zod schemas for all API interactions.
-   **Decoupled Project Cycles**: Separate `active_group_project_id` and `active_file_project_id` allow for flexible project management, enabling different deadlines and configurations for group submissions versus file uploads.
-   **Persistent File Storage with Object Storage**: File uploads are stored in Replit Object Storage (GCS) using a marker path (`objstore:`) in the DB, ensuring data persistence beyond ephemeral container disks.
-   **Optimistic Virus Scanning**: Files are scanned locally with a fast check (blocked extensions, magic bytes, VirusTotal hash lookup) before upload. If unknown, they are optimistically accepted while a full background VirusTotal scan is queued, with automatic deletion upon malicious detection.
-   **Runtime Editable Credentials**: Non-bootstrap environment variables can be viewed and updated via the admin panel. Changes are immediately applied and persisted in the `settings` table, allowing dynamic configuration without server restarts.
-   **Multi-provider AI with auto-failover**: All AI calls go through `server/lib/openaiClient.ts`. Provider order: Replit-built-in (if `USE_REPLIT_AI` toggle ON) → OpenAI → Gemini → Replit. The `chatComplete()` helper additionally retries with Gemini at runtime if the primary provider returns 401/402/403/429 or quota errors, so student features stay up when the OpenAI account runs out of credit. Gemini is reached via its OpenAI-compatible REST endpoint so we keep using the OpenAI SDK.
-   **Multi-provider Email router** (`server/email.ts`): Admin selects active provider via `EMAIL_PROVIDER` credential (`resend` | `sendgrid` | `mailgun`). All outgoing emails (admin OTPs, magic links, student verification) go through `sendEmail()` which dispatches via HTTP — no SDK / `nodemailer` required. Switching takes effect on the next call.
-   **Admin notification fan-out** (`server/lib/notify.ts`): `notifyAdmins(text)` posts to every channel whose `ENABLE_*_ALERTS` toggle is ON (Slack webhook / Discord webhook / Telegram bot). Per-event toggles (`ALERT_ON_VIRUS_FLAGGED`, `ALERT_ON_NEW_SUBMISSION`) gate which events fire. Wired into the virus background scanner and the file-submission success path. Failures on one channel never block the others; `notifyIfEnabled()` swallows errors so it can be fire-and-forget. Test endpoints: `POST /api/admin/email/test {to}` and `POST /api/admin/notify/test {force?}`. **All notification text is plain text** — Telegram is called without `parse_mode` so student-controlled filenames / subjects cannot inject HTML formatting.

## Product

-   Student group submission with real-time validation and deadline countdown.
-   Student portal: submission management, announcements, calendar, cloud storage, notes.
-   Admin dashboard: group/submission management, user management, data export (Excel), project configuration.
-   AI Admin Assistant (OpenAI-powered) for administrative tasks.
-   Study **Play Room**: students enter any topic and an AI "game master" runs a psychology-engineered interactive roleplay (Self-Determination Theory + Zeigarnik open loops + variable rewards + identity priming + growth-mindset feedback + spaced retrieval). Each turn awards XP, may unlock badges/title-promotions, and surfaces choice-chips alongside free-text input. AI returns a structured `[[META]]{xp,choices,badge,title}[[/META]]` block parsed by the client to drive the XP bar / level / streak / badge HUD. Stateless on the server (chat history posted each turn).
-   Two-way student↔admin messaging: students send a question / issue / feedback from the **Messages** tab; admins read & reply from the **Messages** panel. Unread badges on both sides; rate-limited 5 / 10 min per student.
-   Browser push notifications for academic deadlines.
-   Integrated library search (Google Books API, Open Library/Internet Archive fallback).
-   Configurable file types for submissions by administrators.
-   **In-page file conversion (multi-target Office)**: when a student picks an unsupported file at `/file-submit` (DOCX, JPG, PNG, TXT, MD, CSV), the form offers one-click conversion buttons. Available targets per input: images→PDF/DOCX/PPTX; text(.txt/.md/.csv)→PDF/TXT/DOCX/XLSX/PPTX (CSV→XLSX produces a real grid); DOCX→PDF/TXT/HTML/XLSX/PPTX. Buttons are filtered to only the targets the admin's allowed-mime list accepts, so the converted file always passes the submission check. Endpoint: `POST /api/file-submit/convert?target=pdf|txt|html|docx|xlsx|pptx` (also `GET /api/file-submit/convert-targets?filename=…` returns the available targets). Server uses pure-JS libs only (`pdf-lib`, `mammoth`, `docx`, `exceljs`, `pptxgenjs`) — no LibreOffice / native deps. Virus-scans input first, enforces a 25 MB ceiling. DOCX→HTML output is sanitized in `server/lib/fileConvert.ts` (`sanitizeHtmlFragment`) — strips `<script>`/`<style>`/`<iframe>`/event handlers/`javascript:` URLs because the file is downloaded by the student and may be opened in a browser.
-   Automated semester advancement on Feb 1 and Sept 1.

## User preferences

Preferred communication style: Simple, everyday language.

## Gotchas

-   `DATABASE_URL` and `SESSION_SECRET` are NOT editable via the admin panel; they must be set via the hosting provider's environment variable interface.
-   Files uploaded before the object storage migration (legacy local-disk paths) are not recoverable if the container restarts and will be silently skipped from ZIP exports (a `MISSING_FILES_README.txt` is added).
-   VirusTotal API errors do not block file uploads; they are logged, and the upload proceeds to prevent submission interruption due to external service outages.

## Pointers

-   **React**: [https://react.dev/](https://react.dev/)
-   **Express**: [https://expressjs.com/](https://expressjs.com/)
-   **Drizzle ORM**: [https://orm.drizzle.team/](https://orm.drizzle.team/)
-   **Zod**: [https://zod.dev/](https://zod.dev/)
-   **shadcn/ui**: [https://ui.shadcn.com/](https://ui.shadcn.com/)
-   **Tailwind CSS**: [https://tailwindcss.com/](https://tailwindcss.com/)
-   **Replit Auth**: [https://docs.replit.com/hosting/auth](https://docs.replit.com/hosting/auth)
-   **Web Push API**: [https://developer.mozilla.org/en-US/docs/Web/API/Push_API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
-   **Google Books API**: [https://developers.google.com/books/docs/v1/getting_started](https://developers.google.com/books/docs/v1/getting_started)