# MyVoice

MyVoice is a production-shaped MVP for daily collective voting inside Telegram.
Users authenticate with signed Telegram Mini App data, accept Terms and Privacy,
receive in-app VOX activity points, cast one immutable choice in binary votes,
invite direct referrals, follow an activity rating, and inspect completed
results. VOX are game points only: this repository contains no blockchain,
withdrawal, exchange, or wallet connection.

The repository is a pnpm monorepo:

```text
myvoice/
  apps/
    api/       NestJS REST API, Prisma, Swagger, BullMQ worker
    bot/       grammY Telegram bot
    web/       React/Vite Mini App and separate /admin UI
  packages/
    config/    the single source of business thresholds and reward values
    shared/    language, feature, and transport contracts
  docker-compose.yml
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for invariants, concurrency choices,
and risk controls.

## Architecture

MyVoice is a modular monolith. PostgreSQL is authoritative for identities,
consents, referrals, votes, results, activity, balances, and the immutable VOX
ledger. Redis is used for rate-limit counters, temporary referral launch
context, and BullMQ. It is not a source of truth.

Advertising is optional and managed from the separate administrator UI. A
campaign can be either a native banner or a rewarded video. Rewarded viewing
creates a short-lived server session; watch progress is credited in bounded
heartbeats, and a successful claim writes one immutable `AD_REWARD` VOX ledger
entry. PostgreSQL advisory locks, a unique session-to-ledger relation, and an
idempotency key prevent duplicate rewards and enforce the configured per-user
daily limit.

A vote and its MVP rewards are committed in a serializable PostgreSQL
transaction. User and vote rows are locked; database uniqueness protects one
vote per user and all rewards use immutable unique idempotency keys. A delayed
BullMQ lifecycle job activates and completes votes. The worker also scans
PostgreSQL every minute, so a Redis outage or lost delayed job is recoverable.
Completion locks the vote, recalculates counts from `user_votes`, stores a tie
explicitly, and updates activity exactly once.

Access sessions are opaque, short lived, and stored hashed. A refresh session
uses an HttpOnly cookie. Telegram ID is never accepted as an API input: the API
extracts it only from `initData` after the official HMAC check and freshness
check. Admin credentials, tokens, and Telegram tokens never enter the frontend
bundle.

## Requirements

- Node.js 22+
- pnpm 10+
- Docker Engine with Docker Compose v2
- a Telegram bot token for end-to-end Telegram testing
- an HTTPS URL/tunnel for Telegram development

## Configure

```bash
cp .env.example .env
```

On PowerShell:

```powershell
Copy-Item .env.example .env
```

Set at least:

- `TELEGRAM_BOT_TOKEN`: token issued by BotFather.
- `WEB_APP_URL`: public HTTPS Mini App URL.
- `VITE_BOT_USERNAME`: bot username without `@`.
- `SESSION_PEPPER`: long random value used when hashing user sessions.
- `ADMIN_JWT_SECRET`: separate long random admin signing secret.
- `ADMIN_SESSION_TTL_SECONDS`: short admin token lifetime; production default is 900 seconds.
- `ADMIN_THROTTLE_PEPPER`: separate random value used to hash IP/account throttle keys.
- `ADMIN_SEED_PASSWORD`: initial local admin password.
- `TURNSTILE_SITE_KEY`: public Cloudflare Turnstile widget key.
- `TURNSTILE_SECRET_KEY`: secret Turnstile key used only by the API.
- `TURNSTILE_EXPECTED_HOSTNAME`: hostname accepted in the verified CAPTCHA response.
- `CORS_ORIGIN`: exact frontend origin.

Never commit `.env`. Vite exposes only variables prefixed with `VITE_`; do not
place secrets in such variables.

## Fast local start with Docker Compose

Build and start PostgreSQL, Redis, migrations, API, worker, web, and bot:

```bash
docker compose up --build
```

The bot requires a real token. To develop API and web without starting the bot:

```bash
docker compose up --build postgres redis migrate api worker web
```

Seed the local database once:

```bash
docker compose --profile seed run --rm seed
```

Services:

- Mini App and admin UI: `http://localhost:5173`
- Admin panel: `http://localhost:5173/admin`
- API: `http://localhost:3000`
- Swagger/OpenAPI: `http://localhost:3000/docs`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

The seed admin is `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`. Change the
password before sharing an environment.

### Protect the administrator login

Create a managed Cloudflare Turnstile widget for the admin hostname and place
its keys in `.env`. Only `TURNSTILE_SITE_KEY` is returned to the login page;
`TURNSTILE_SECRET_KEY` stays in the API container. The backend validates every
challenge through Cloudflare Siteverify and checks the `admin_login` action and
the configured hostname.

Failed-login state is stored in persistent Redis using hashed IP, account, and
IP+account keys. CAPTCHA becomes mandatory after three incorrect passwords.
Five incorrect passwords trigger a 15-minute block; repeated lockouts double
the duration up to 24 hours. A successful login clears the related counters.
If Turnstile has not been configured, the server still enforces the five-attempt
lockout, but production must configure both keys to enforce the CAPTCHA step.

Use separate Turnstile widgets for local/staging and production. See the
[official Turnstile setup guide](https://developers.cloudflare.com/turnstile/get-started/).

## Run services without containers

Install packages:

```bash
pnpm install
```

Start only infrastructure:

```bash
docker compose up -d postgres redis
```

Generate Prisma Client, apply committed migrations, and seed:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

Run each process in its own terminal:

```bash
pnpm --filter @myvoice/api dev
pnpm --filter @myvoice/api worker
pnpm --filter @myvoice/web dev
pnpm --filter @myvoice/bot dev
```

`apps/api/src/worker.ts` is required in normal operation. It consumes delayed
BullMQ jobs and performs the PostgreSQL reconciliation scan.

## Telegram and BotFather setup

1. Open `@BotFather`, run `/newbot`, and save the generated token in
   `TELEGRAM_BOT_TOKEN`.
2. Choose a username and set it as `VITE_BOT_USERNAME`.
3. Expose `http://localhost:5173` through an HTTPS tunnel such as Cloudflare
   Tunnel, ngrok, or a reverse proxy with a trusted development certificate.
   Telegram will not load an insecure HTTP Mini App URL.
4. Set the public URL as `WEB_APP_URL`.
5. In BotFather, use `/mybots` → your bot → **Bot Settings** →
   **Menu Button** and set the same HTTPS URL. The bot also calls
   `setChatMenuButton` at startup.
6. Configure a Mini App under **Bot Settings** → **Configure Mini App** if you
   want direct `startapp` links.
7. Restart `apps/bot`. `/start`, `/app`, `/help`, `/terms`, and `/privacy` are
   registered automatically.

A referral URL has the form
`https://t.me/<BOT_USERNAME>?start=ref_<REFERRAL_CODE>`. The bot stores the
launch parameter in Redis for 30 days and forwards it in the web-app button.
The API reads that context only after verifying signed Telegram `initData`.
Starting the bot alone never creates or rewards a user.

For local layout work outside Telegram, `/admin`, `/terms`, and `/privacy` are
available normally. User routes intentionally show “Open from Telegram”
instead of enabling mock authentication.

### Temporary HTTPS tunnel for Telegram testing

Telegram cannot open `localhost`; it requires a public HTTPS URL. The Compose
configuration includes a temporary Cloudflare Quick Tunnel and a Caddy gateway.
The gateway exposes the Mini App and proxies `/api/*` to NestJS, so the browser
inside Telegram uses one same-origin URL.

1. Install Docker Desktop and start it.
2. Create `.env` from `.env.example`. Set a real `TELEGRAM_BOT_TOKEN`, your
   `VITE_BOT_USERNAME`, and random `SESSION_PEPPER`/`ADMIN_JWT_SECRET`. Leave
   `WEB_APP_URL` as a placeholder for now.
3. Start the application and tunnel:

   ```bash
   docker compose up --build postgres redis migrate api worker web gateway
   docker compose --profile tunnel up tunnel
   ```

4. Copy the `https://*.trycloudflare.com` URL printed by the `tunnel` service
   logs into `WEB_APP_URL` in `.env`.
5. In BotFather, set this URL as the Mini App/Menu Button URL. Then start the
   bot with `docker compose --profile telegram up bot`.

Quick Tunnel URLs change after restart and are appropriate only for temporary
testing. Use a named Cloudflare Tunnel and a stable domain for staging or
production.

## Database and migrations

The Prisma schema is at `apps/api/prisma/schema.prisma`; the initial committed
SQL migration is under `apps/api/prisma/migrations`. For a new development
migration:

```bash
pnpm --filter @myvoice/api exec prisma migrate dev --name descriptive_name
pnpm db:generate
```

Production and Compose use `prisma migrate deploy`. Never edit a previously
deployed migration or delete VOX ledger rows. The current balance and each
ledger row are mutated in the same transaction; operational reconciliation
should compare each user's last `balance_after` with `users.vox_balance`.

Seed data contains:

- an administrator;
- three users, consents, a direct referral, and consistent VOX ledger entries;
- the requested English/Russian active AI vote;
- one completed localized vote;
- disabled feature flags for 10k, 1m, 10m, and 100m account stages.

## API

Swagger documents the REST surface at `/docs`. Main public session endpoints:

```text
POST   /auth/telegram
POST   /auth/refresh
POST   /auth/logout
GET    /me
PATCH  /me/language
POST   /me/consents
GET    /me/activity
GET    /me/referrals
GET    /me/vox-transactions
GET    /votes/current
GET    /votes/history
GET    /votes/:id
POST   /votes/:id/cast
GET    /votes/:id/result
POST   /suggestions
GET    /suggestions/me
GET    /ads/current
POST   /ads/:id/click
POST   /ads/:id/reward-sessions
POST   /ads/reward-sessions/:id/heartbeat
POST   /ads/reward-sessions/:id/claim
GET    /system/features
GET    /system/public-settings
```

Admin routes are under `/admin` and require the separate admin token. The UI
includes metrics, users, votes, scheduling, suggestion review, and advertising
campaigns; REST also provides blocking/unblocking, the per-user VOX ledger,
manual adjustment with a required comment, and the audit log. An administrator
can create, activate, pause, and soft-delete banner or rewarded-video campaigns.
Campaign copy is stored in English and Russian, and its schedule is stored in
UTC. Admin routes never expose vote mutation or result deletion operations.

### Advertising assets and reward limits

The MVP administrator form accepts HTTPS URLs for banner images, destination
pages, and MP4/WebM video assets; it does not upload files to the application
server. Store production media in trusted object storage/CDN and use only URLs
you are authorized to publish. For a rewarded campaign, the administrator sets
the VOX amount, minimum watch time, and how many times one user may receive the
reward per UTC day. Campaigns are created as drafts and are invisible until
explicitly activated.

The built-in viewing session protects ledger integrity and prevents simple
HTTP retries from paying twice. It is not an advertiser-network proof of a
human view. Before using paid third-party inventory at scale, integrate the
chosen network's signed server-to-server completion callback and update the
Terms/Privacy text for that provider. MyVoice does not sell VOX, withdraw VOX,
or use cryptocurrency in advertising rewards.

## Feature flags and stages

The single numeric configuration source is `packages/config/src/index.ts`.
Database `FeatureFlag` records control runtime enablement. A capability is live
only when both its server flag is enabled and completed registration count
reaches its configured threshold:

- `SUGGESTIONS`: 10,000 users; one moderated suggestion per user per 24 hours.
- `EARLY_VOTE_BONUS`: 1,000,000 users; row-locked cap of 1,000 early rewards.
- `PREDICTION_REWARDS`: 10,000,000 users; models support pending rewards, but
  the disabled MVP continues paying the immediate 10 VOX participation reward.
- `TON_WALLET`: 100,000,000 users; remains a hard-false public capability and
  contains no wallet SDK or conversion implementation.

The frontend reads only `/system/features` and safe public settings. It does
not embed thresholds or secrets.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The Jest suite covers the 15 requested security and business invariants,
including signed Telegram data, idempotent rewards, duplicate votes, tie
results, post-close rejection, private intermediate results, activity
semantics, bounded early rewards, and idempotent completion. Additional tests
cover idempotent advertising claims, concurrent repeated session starts, and
atomic daily reward limits.

For a full integration smoke test:

```bash
docker compose up -d postgres redis
pnpm db:migrate
pnpm db:seed
pnpm --filter @myvoice/api dev
pnpm --filter @myvoice/api worker
```

Open Swagger, authenticate through Telegram, accept version 1.0 documents, cast
the active seed vote, repeat the same HTTP request, and verify that only one
`UserVote` and one `VOTE_REWARD` ledger entry exist.

## Deployment order

1. Provision PostgreSQL and Redis with persistence, backups, TLS, and network
   restrictions.
2. Store all secrets in the platform secret manager.
3. Build one immutable image from the root `Dockerfile`.
4. Run `prisma migrate deploy` as a one-shot release job.
5. Deploy API and worker from the same image/version.
6. Deploy the static Vite bundle behind HTTPS and set strict CORS to its origin.
7. Deploy the single bot replica, then configure BotFather/Menu Button URLs.
8. Seed only the initial admin and flags in a controlled one-shot job; do not
   run demo seed data in production.
9. Check `/docs`, worker logs, BullMQ retries, PostgreSQL backups, Redis health,
   and Telegram `initData` freshness.
10. Rotate the seed password and monitor admin audit events, ledger
    idempotency conflicts, vote completion latency, and rate-limit pressure.

Horizontal API scaling is safe because business uniqueness is enforced in
PostgreSQL. Multiple workers are also safe because completion locks and checks
the vote state. Keep clocks synchronized and store all dates in UTC; the web
client formats them in the user's local timezone.
