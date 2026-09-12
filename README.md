# Velozity Global Solutions Dashboard

A focused internal delivery dashboard for a small agency. The client is a React + TypeScript Vite application. The API is a separate typed Express service backed by PostgreSQL and Prisma.

## Run locally

```powershell
# Terminal 1: from the repository root, create a local env file for Docker
Copy-Item .env.example .env
# Edit .env and set POSTGRES_PASSWORD to a local password.
docker compose up -d postgres

# Terminal 2: configure and initialize the API database
cd server
npm install
Copy-Item .env.example .env
# Make DATABASE_URL use the same password as the root .env file.
npm run db:setup
npm run dev

# Terminal 3: start the React client
cd client
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/` for the client and `http://127.0.0.1:4000/health` to verify the API. `db:setup` uses `prisma db push` for this assessment workspace because no migration history is committed yet; use `prisma migrate dev --name init` before production deployment to create and commit a migration.

The seed account password is `ChangeMe123!`; change it before sharing a deployment. Do not commit `.env`.

## Architecture

- **Access:** short-lived JWT access tokens are sent in the `Authorization` header. Refresh tokens are rotated, hashed in the database, and stored in an HttpOnly, Secure cookie. Authorization middleware runs on every protected API route and filters project/task/activity queries by role.
- **Real time:** Socket.IO is used for project rooms, presence, activity events, and notification count events. Socket rooms are checked against the same project ownership/assignment policy as HTTP routes. Socket.IO was selected over native WebSocket for reconnect handling and room semantics.
- **Persistence:** PostgreSQL is the source of truth. Activity rows are written in the same transaction as status changes; the last 20 permitted rows are fetched from PostgreSQL after reconnect. Indexes cover project ownership, assignee/status, project/due date, activity chronology, and unread notifications.
- **Jobs:** node-cron runs the hourly overdue transition. This is intentionally small and transparent for a single agency process; Bull would be the next step when multiple workers or retryable jobs are needed.

## Seed coverage

The seed creates one Admin, two Project Managers, four Developers, three projects, fifteen tasks, overdue tasks, and initial activity. The UI is intentionally usable without a running API for the assessment walkthrough; the server exposes the production data contracts and role filtering needed to connect it.

## Current implementation status

The API now includes login, short-lived access JWTs, rotating hashed refresh tokens in an HttpOnly cookie, role-scoped project/task/activity queries, project and task creation, developer/PM/Admin status authorization, durable activity records, assignment/review notifications, notification read routes, authorized Socket.IO project rooms, user notification rooms, presence counts, structured errors, and the hourly overdue scheduler.

The Vite client remains a reviewable preview dataset and is not yet connected to the API login or mutation calls. Connect it through a typed API client before deployment. MFA is not part of the supplied assessment requirements and is not implemented.

GitHub publication and Vercel deployment cannot be completed from this workspace without a repository target and hosting credentials. The API should be deployed separately from the Vercel client because Socket.IO needs a persistent server runtime.

## Explanation

The hardest problem is keeping a live activity feed useful without accidentally widening access. The design treats the API and socket connection as two views of the same authorization rule: Admin receives all project rooms, a PM is restricted to projects they own, and a Developer receives only rooms for assigned tasks. Status transitions create a durable activity row before an event is broadcast, so reconnecting clients can fetch the last twenty permitted records from PostgreSQL rather than trusting an in-memory buffer. The client keeps the feed compact and readable, while the task table exposes shareable filter controls that can be mapped directly to query parameters. I chose Socket.IO because project rooms, reconnect behavior, and presence are central to this product and would otherwise create a large amount of protocol code. The next thing I would do is move the client preview data behind a typed API adapter and add end-to-end permission tests that attempt every protected route as each role.
