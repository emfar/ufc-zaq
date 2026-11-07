# UFC ZAQ — monthly UFC 4 scoreboard

A small mobile web app for five friends who play UFC 4 at the PlayStation club:
log in, tap the winner after every fight, and see who's leading the month.

- **Register** — every fighter has two big buttons: **WIN +1** and **R1 KO +2**.
  One tap = one win. An *Undo* pops up right after each tap, quick double taps
  only count once, and a tap that fails on bad Wi‑Fi can be retried safely.
- **Board** — this month's standings, the leader, days left, the reigning champ,
  past months (tap ‹ ›), all-time totals with title counts, and a hall of fame.
- **History** — every win by day with who added it. Remove a wrong one with two
  taps; removals stay visible (“removed by Ali”) and can be restored.
- **Me** — change your password, log out, rules.
- Works best on phones; add it to the home screen to open it like an app.

## Rules

| | |
|---|---|
| Win | 1 point |
| 1st-round KO | 2 points |
| Monthly winner | most points; level on points → more 1st-round KOs; still level → shared title |
| Month boundaries | midnight in `TIMEZONE` (default `Asia/Baku`) |

Anyone can register or remove any win. Taking back your own entry within
5 minutes is an undo and leaves no trace; any other removal is shown in History.

## Put it online (your server + subdomain)

You need a Linux server with [Docker](https://docs.docker.com/engine/install/)
(the smallest VPS is plenty), and your subdomain's DNS **A record** pointing at the
server's IP. Ports 80 and 443 must be open. Then:

```bash
git clone https://github.com/emfar/ufc-zaq.git
cd ufc-zaq
cp .env.example .env
nano .env                    # set DOMAIN=ufc.your-domain.com
docker compose up -d --build
docker compose logs app      # shows everyone's first password
```

Open `https://ufc.your-domain.com`. [Caddy](https://caddyserver.com) gets and
renews the HTTPS certificate automatically. Share each first password privately;
everyone can change theirs on the **Me** tab.

**Reset a password** (also logs that person out everywhere):

```bash
docker compose exec app node scripts/set-password.js Ramil               # prints a new random one
docker compose exec app node scripts/set-password.js Ramil "my-new-pass"  # or set your own
```

**Back up** the scoreboard (safe while it's running):

```bash
docker compose exec app node scripts/backup.js
docker compose cp app:/app/data/backups ./backups
```

**Update** after pulling new code — the data lives in the `app-data` volume and is kept:

```bash
git pull
docker compose up -d --build
```

### Already running nginx (or another proxy) on that server?

Start only the app — it listens on `127.0.0.1:3000` — and proxy your subdomain to it:

```bash
docker compose up -d --build app
```

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Settings

Put these in `.env` (Docker) or the environment.

| Variable | Default | What it does |
|---|---|---|
| `DOMAIN` | — | Your subdomain, for HTTPS (docker compose only) |
| `APP_NAME` | `UFC ZAQ` | Name in the header, login screen and home-screen icon |
| `TIMEZONE` | `Asia/Baku` | Months start and end at midnight in this time zone |
| `PLAYERS` | `Farrukh,Ramil,Ibrahim,Hikmat,Ali` | The fighters, in button order. Add a name to add a fighter (their password appears in the logs). Removing a name hides them but keeps their history. Don't rename here — that creates a new fighter. |
| `SESSION_DAYS` | `180` | Stay logged in this long without opening the app |
| `PORT` | `3000` | HTTP port of the app |
| `TRUST_PROXY` | off (`1` in docker compose) | Set to `1` behind one reverse proxy |
| `DATA_DIR` | `./data` | Where the database (`ufc.db`) is stored |

## Run it on your computer

Needs Node.js 22 or newer.

```bash
npm ci
npm run dev       # http://localhost:3000 — first passwords are printed in the terminal
npm test
```

Without Docker on a server, the same works with `npm ci --omit=dev` and
`NODE_ENV=production TRUST_PROXY=1 npm start` behind a reverse proxy.

## How it's built

- **Server:** Node.js, Express 5 and SQLite ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) —
  one small process and one database file. The scoring rules live in `src/scoring.js`.
- **App:** plain JavaScript modules and CSS — no build step, no outside CDNs (the font is bundled).
- **Security:** scrypt password hashes, HttpOnly + SameSite session cookies, login rate limiting,
  a strict Content-Security-Policy, and cross-site write protection on the API.

```
src/          server: config, database, auth, scoring rules, API
public/       the mobile web app (HTML, CSS, JS modules, icons, font)
scripts/      set-password.js, backup.js
test/         node:test suites — run with `npm test`
deploy/       Caddyfile used by docker-compose.yml
```
