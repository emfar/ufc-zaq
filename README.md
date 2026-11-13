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

Everyone logs in with the same password. Whoever deploys the app sets it: it's
the `APP_PASSWORD` secret in GitHub (see below), applied on every deploy.
Changing it logs every phone out, so it's also how you kick everyone out.

Running the app without a password configured (e.g. on your computer) makes it
generate one on first start and print it in the log.

## Deploy on your own VPS (GitHub Actions)

Every push to the repository's default branch runs the checks, builds a Docker
image (stored privately in the repository's GitHub container registry,
`ghcr.io/<owner>/<repo>`) and deploys it to the VPS over SSH. The VPS runs the
app plus [Caddy](https://caddyserver.com), which gets and renews the HTTPS
certificate on its own. Before each deploy the database is backed up on the
server (the newest 20 backups are kept); if the new version doesn't come up
healthy, the previous one is put back automatically. Pull requests and other
branches only run the checks.

You need:

- a VPS with Ubuntu 22.04/24.04 or Debian 12 (x86-64 or ARM — the smallest
  size is plenty), reachable on ports 22, 80 and 443;
- a domain or subdomain for the app, e.g. `ufc.example.com`;
- admin rights on the GitHub repository that runs the workflow, to add secrets.
  Deploying from your own copy of this repository? Then do everything below in
  your copy; its images go to your own `ghcr.io`.

### One-time setup

1. **DNS:** create an **A** record for your domain pointing at the VPS's IP.
2. **Server:** log in as root over SSH and paste the contents of
   [`deploy/server-setup.sh`](deploy/server-setup.sh) (or copy the file over and
   run `bash server-setup.sh`). It installs Docker, creates the `deploy` user
   (SSH key only) and `/opt/ufc-zaq`, opens ports 80/443 if the ufw firewall is
   on, and prints `SSH_PRIVATE_KEY` and `SSH_KNOWN_HOSTS`. It's safe to run
   again. If it warns that ports 80/443 are in use, see
   [Already running a web server?](#already-running-a-web-server-on-ports-80443)
3. **GitHub:** repository → *Settings* → *Secrets and variables* → *Actions*:
   - **Secrets:** `SSH_PRIVATE_KEY` and `SSH_KNOWN_HOSTS` (both from step 2), and
     `APP_PASSWORD` — the club password you choose (at least 8 characters).
   - **Variables:** `SSH_HOST` — the VPS's IP or host name, and `DOMAIN` — the
     app's address, e.g. `ufc.example.com`.
4. **Deploy:** *Actions* → *CI/CD* → *Run workflow* (or push a commit). The
   first certificate takes a minute; then open `https://<your domain>`.

Until those secrets and variables exist, the deploy step is skipped with a note
saying what's missing. Every run also prints DNS and port diagnostics for the
server, which helps with the first deploy.

### Everyday use

- **Ship a change:** push to the default branch.
- **Change the club password:** update the `APP_PASSWORD` secret, then
  *Actions* → *CI/CD* → *Run workflow*. Every phone is logged out.
- **Roll back:** *Actions* → *CI/CD* → *Run workflow* and enter an older image
  tag such as `sha-1a2b3c4` (each run's summary shows its tag).

### Settings

Repository **variables** (*Settings* → *Secrets and variables* → *Actions* →
*Variables*):

| Variable | Default | What it does |
|---|---|---|
| `SSH_HOST` | — (required) | The VPS to deploy to: IP address or host name |
| `DOMAIN` | — (required) | The address the app is served on |
| `SSH_USER` | `deploy` | SSH user created by the setup script |
| `SSH_PORT` | `22` | SSH port of the VPS |
| `APP_NAME` | `UFC ZAQ` | Name in the header, login screen and home-screen icon |
| `TIMEZONE` | `Asia/Baku` | Months start and end at midnight in this time zone |
| `PLAYERS` | `Farrukh,Ramil,Ibrahim,Hikmat,Ali` | The fighters, in button order. Add a name to add a fighter; removing a name hides them but keeps their history. Don't rename here — that creates a new fighter. |

### Already running a web server on ports 80/443?

The bundled Caddy needs ports 80 and 443. If the VPS already runs a web server
(nginx, Caddy, Traefik…), let that one serve the app instead:

1. In [`deploy/docker-compose.yml`](deploy/docker-compose.yml), delete the
   `caddy` service and give the `app` service a local-only port:

   ```yaml
       ports:
         - '127.0.0.1:3000:3000'
   ```

2. Point your domain at `http://127.0.0.1:3000` in that web server and pass on
   the original host and protocol. For nginx, in the `server` block of your
   domain:

   ```nginx
   location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```

The deploy script notices that the `caddy` service is gone and skips it.

### Without GitHub Actions

To deploy by hand instead, run this on the VPS as root after step 2 above
(or on any server with Docker):

```bash
git clone https://github.com/emfar/ufc-zaq.git /root/ufc-zaq && cd /root/ufc-zaq
docker build -t ufc-zaq:local .
install -d -m 700 /opt/ufc-zaq
cp deploy/docker-compose.yml deploy/Caddyfile deploy/remote-deploy.sh /opt/ufc-zaq/
read -rsp 'Club password: ' pw && printf '%s' "$pw" > /opt/ufc-zaq/app_password && unset pw
DOMAIN=ufc.example.com SKIP_PULL=1 bash /opt/ufc-zaq/remote-deploy.sh ufc-zaq:local
```

To update later: `git pull`, build again, copy the `deploy/` files again and
rerun the last command.

### On the server

Everything lives in `/opt/ufc-zaq`; the data is in the `ufc-zaq_app-data`
Docker volume.

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
