# VPS Deploy

Target server:

```text
http://45.151.81.182:3000
```

Discord Developer Portal OAuth2 redirects must include:

```text
http://localhost:3000/callback
http://45.151.81.182:3000/callback
```

## 1. Prepare The VPS

Install Docker and Compose on the VPS, then clone or upload this project:

```bash
git clone <your-repo-url> Dash2.0
cd Dash2.0
cp .env.vps.example .env
nano .env
```

Fill in the real secrets in `.env`.

For the current IP-based setup, these values matter:

```env
WEB_PUBLIC_URL=http://45.151.81.182:3000
API_PUBLIC_URL=http://45.151.81.182:4000
DISCORD_OAUTH_REDIRECT=http://45.151.81.182:3000/callback
COOKIE_SECURE=false
WEB_PORT_BIND=3000:3000
API_PORT_BIND=4000:4000
POSTGRES_PORT_BIND=127.0.0.1:5432:5432
REDIS_PORT_BIND=127.0.0.1:6379:6379
NEXT_PUBLIC_API_URL=http://45.151.81.182:4000
```

## 2. Start Fresh On The VPS

If you do not need your local database data:

```bash
docker compose --env-file .env up -d --build
docker compose exec -T api npx prisma migrate deploy --schema ../../packages/db/prisma/schema.prisma
docker compose exec -T postgres psql -U hll -d hll_dashboard -f /app/packages/db/prisma/sql/init.sql
```

If the final `psql -f` command cannot see `/app`, run this instead from the VPS project folder:

```bash
docker compose cp packages/db/prisma/sql/init.sql postgres:/tmp/init.sql
docker compose exec -T postgres psql -U hll -d hll_dashboard -f /tmp/init.sql
```

## 3. Move Your Local Database To The VPS

On your local machine, create a binary Postgres dump:

```bash
docker compose exec -T postgres pg_dump -U hll -d hll_dashboard -Fc -f /tmp/hll_dashboard.dump
docker compose cp postgres:/tmp/hll_dashboard.dump ./hll_dashboard.dump
```

Upload `hll_dashboard.dump` to the VPS project folder.

On the VPS, start the database first:

```bash
docker compose --env-file .env up -d postgres redis
```

Copy and restore the dump:

```bash
docker compose cp ./hll_dashboard.dump postgres:/tmp/hll_dashboard.dump
docker compose exec -T postgres pg_restore -U hll -d hll_dashboard --clean --if-exists /tmp/hll_dashboard.dump
```

Then start the app stack:

```bash
docker compose --env-file .env up -d --build
```

## 4. Normal Updates

Use this for normal deploys and code updates:

```bash
git pull
docker compose --env-file .env up -d --build
```

This keeps the database because Postgres data is stored in the Docker named volume `pgdata`.

## 5. Do Not Run This Unless You Want To Delete Data

This removes the database volume:

```bash
docker compose down -v
```

Safe commands:

```bash
docker compose restart
docker compose down
docker compose --env-file .env up -d --build
```

## 6. Check Status

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f web
docker compose logs -f bot
```

Open:

```text
http://45.151.81.182:3000
```
