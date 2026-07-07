# Hell Let Loose Clan Dashboard

A modular web dashboard for managing a Hell Let Loose clan: Discord-authenticated
access control, member directory, automated recruit intake, roster tool, match
history, and a live briefing page.

## Stack

| Layer | Tech |
|-------|------|
| Front-end | Next.js 14 (App Router, TypeScript, Tailwind) |
| Back-end | NestJS (REST + Socket.IO gateway) |
| Bot / worker | discord.js + node-cron |
| Database | PostgreSQL 16 (Prisma) |
| Cache / queue / pub-sub | Redis |
| Real-time | WebSockets backed by Postgres `LISTEN/NOTIFY` |
| Game stats | CRCON HTTP API |
| Deploy | Docker Compose + Nginx reverse proxy |

## Monorepo layout

```
apps/
  web/   Next.js front-end
  api/   NestJS REST API + realtime gateway
  bot/   Discord gateway bot + scheduled jobs
packages/
  db/      Prisma schema + client
  shared/  Shared types/DTOs
nginx/     Reverse proxy config
```

## Local development

1. Copy env: `cp .env.example .env` and fill in Discord/CRCON/RaidHelper values.
2. Start Postgres + Redis: `docker compose up -d postgres redis`
3. Install deps: `npm install`
4. Generate Prisma client + migrate:
   ```bash
   npm run db:generate
   npm run db:migrate
   psql "$DATABASE_URL" -f packages/db/prisma/sql/init.sql   # triggers + GIN index
   ```
5. Run everything: `npm run dev`

- Web: http://localhost:3000
- API: http://localhost:4000

## Discord setup

1. Create an application at https://discord.com/developers/applications.
   Use `http://localhost:3000/callback` locally and your deployed app URL
   (for example, `https://your-domain.example/callback`) in production.
2. OAuth2 → add redirect `http://localhost:3000/callback` and your production
   callback URL as needed.
3. Bot → enable **Server Members**, **Message Content**, and **Voice State**
   privileged intents. Invite the bot with `bot` + `applications.commands` scopes
   and Manage Roles permission.
4. Put the client id/secret, bot token, and guild id into `.env`.

## How the key workflows fit together

- **Auth + access control** — Discord OAuth2 → httpOnly JWT. Guild admins always
  get access; others must match an allow-listed role or user id. Effective
  permissions are cached in Redis and busted on `guildMemberUpdate`.
- **Recruit intake** — the bot polls the recruit channel every 5 min, only
  considers posts from the last 15 min, extracts the answer to
  *"3. What is your Steam/EPIC ID?"*, and stores pending recruits.
- **Accept application → auto-refresh** — `POST /recruits/:id/accept` runs one
  transaction (recruit → user → game account → member). The `members` INSERT
  fires a Postgres trigger → `NOTIFY events` → API forwards a `member.created`
  WebSocket event → the Member Directory refreshes live. The API also publishes
  an `assignRole` command to the bot over Redis to set the Discord role.
- **Roster** — built from a RaidHelper event, posted by the bot to the event's
  channel with Accept/Decline buttons; button presses update `roster_slots`,
  firing a `roster.updated` event back to the dashboard.
- **Briefing** — the bot snapshots voice presence to Redis; the API queries CRCON
  for in-game players and cross-references game id → Discord id.

## Production deploy

For host-specific deployment guidance, see [`VPS_DEPLOY.md`](./VPS_DEPLOY.md).
Then:

```bash
docker compose --env-file .env up -d --build
```

The database lives in the Docker named volume `pgdata`. Normal rebuilds do not
delete it; avoid `docker compose down -v` unless you intentionally want to wipe
the database.
