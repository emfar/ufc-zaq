# UFC ZAQ — monthly UFC 4 scoreboard

A small mobile web app for five friends who play UFC 4 at the PlayStation club:
tap the winner after every fight and see who's leading the month.

- **Register** — every fighter has two big buttons: **WIN +1** and **R1 KO +2**.
  One tap = one win. An *Undo* pops up right after each tap, quick double taps
  only count once, and a tap that fails on bad Wi‑Fi can be retried safely.
- **Board** — this month's standings, the leader, days left, the reigning champ,
  past months (tap ‹ ›), all-time totals with title counts, and a hall of fame.
- **History** — every win by day. Remove a wrong one with two taps; removals
  stay listed and can be restored.
- **Rules** (ⓘ in the header) — scoring rules, tips, log out.
- One shared **club password** for everyone, controlled by the admin.
- Works best on phones; add it to the home screen to open it like an app.

## Rules

| | |
|---|---|
| Win | 1 point |
| 1st-round KO | 2 points |
| Monthly winner | most points; level on points → more 1st-round KOs; still level → shared title |
| Month boundaries | midnight in `TIMEZONE` (default `Asia/Baku`) |

Taking a win back on the same phone within 5 minutes erases it. Wins removed
later, or from another phone, stay in History and can be restored.

## The club password

Everyone logs in with the same password. Only the admin sets it: it's the
`APP_PASSWORD` secret in GitHub (see below), applied on every deploy.
Changing it logs every phone out, so it's also how you kick everyone out.

Running the app without a password configured (e.g. on your computer) makes it
generate one on first start and print it in the log.

## Deployment: GitHub Actions → your server

Every push to the repository's default branch runs the checks, builds a Docker
image (stored privately in GitHub's container registry), and deploys it to the
server over SSH. The server runs the app plus [Caddy](https://caddyserver.com),
which gets and renews the HTTPS certificate on its own. Before each deploy the
database is backed up on the server (the newest 20 backups are kept), and if
the new version doesn't come up healthy it's rolled back automatically.
Pull requests and other branches only run the checks.

### One-time setup

1. **DNS:** point `zufc.asaim.tech` (an **A** record) at `94.20.57.239`.
2. **Server:** log in as root over SSH and paste the contents of
   [`deploy/server-setup.sh`](deploy/server-setup.sh). It installs Docker,
   creates a `deploy` user for GitHub Actions, opens ports 80/443 if a firewall
   is on, and prints two values: `SSH_PRIVATE_KEY` and `SSH_KNOWN_HOSTS`.
   It's safe to run again.
3. **GitHub:** repo → *Settings* → *Secrets and variables* → *Actions* →
   *New repository secret*, three times:
   - `SSH_PRIVATE_KEY` — from step 2
   - `SSH_KNOWN_HOSTS` — from step 2
   - `APP_PASSWORD` — the club password you choose (at least 8 characters)
4. **Deploy:** *Actions* → *CI/CD* → *Run workflow* (or push a commit).
   Then open `https://zufc.asaim.tech`.

### Everyday use

- **Ship a change:** push to the default branch.
- **Change the club password:** update the `APP_PASSWORD` secret, then
  *Actions* → *CI/CD* → *Run workflow*.
- **Roll back:** *Actions* → *CI/CD* → *Run workflow* and enter an older image
  tag such as `sha-1a2b3c4` (each run's summary shows its tag).

### Settings

Optional repository **variables** (*Settings* → *Secrets and variables* →
*Actions* → *Variables*):

| Variable | Default | What it does |
|---|---|---|
| `DOMAIN` | `zufc.asaim.tech` | The address the app is served on |
| `SSH_HOST` | `94.20.57.239` | Server to deploy to |
| `SSH_USER` | `deploy` | SSH user created by the setup script |
| `SSH_PORT` | `22` | SSH port |
| `APP_NAME` | `UFC ZAQ` | Name in the header, login screen and home-screen icon |
| `TIMEZONE` | `Asia/Baku` | Months start and end at midnight in this time zone |
| `PLAYERS` | `Farrukh,Ramil,Ibrahim,Hikmat,Ali` | The fighters, in button order. Add a name to add a fighter; removing a name hides them but keeps their history. Don't rename here — that creates a new fighter. |

### On the server

Everything lives in `/opt/ufc-zaq`; the data is in the `app-data` Docker volume.

```bash
cd /opt/ufc-zaq && docker compose logs --tail 50 app       # app log
docker compose exec app node scripts/backup.js             # extra backup
docker compose cp app:/app/data/backups ./backups          # copy backups out
```

## Run it on your computer

Needs Node.js 22 or newer.

```bash
npm ci
APP_PASSWORD=letmein-123 npm run dev   # http://localhost:3000
npm test
npm run lint
```

## How it's built

- **Server:** Node.js, Express 5 and SQLite ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) —
  one small process and one database file. The scoring rules live in `src/scoring.js`.
- **App:** plain JavaScript modules and CSS — no build step, no outside CDNs (the font is bundled).
- **Security:** scrypt password hash, HttpOnly + SameSite session cookies (one per phone),
  login rate limiting, a strict Content-Security-Policy, and cross-site write protection.

```
src/                 server: config, database, login, scoring rules, API
public/              the mobile web app (HTML, CSS, JS modules, icons, font)
scripts/backup.js    consistent database backup
test/                node:test suites — `npm test`
deploy/              server setup, deploy script, production docker compose + Caddyfile
.github/workflows/   CI/CD
```
