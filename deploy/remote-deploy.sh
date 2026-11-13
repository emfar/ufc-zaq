#!/usr/bin/env bash
# Deploys UFC ZAQ on the VPS. GitHub Actions runs it over SSH as the deploy user
# in /opt/ufc-zaq, next to docker-compose.yml, Caddyfile and app_password:
#
#   DOMAIN=ufc.example.com bash remote-deploy.sh ghcr.io/owner/ufc-zaq:sha-1a2b3c4
#
# Optional settings: APP_NAME, TIMEZONE, PLAYERS, SESSION_DAYS (empty = the app's
# default). A setting that is not passed at all keeps its current value.
#
# It writes .env, pulls the image, backs up the database, restarts the stack and
# waits for the app to report healthy. If it does not, it prints the app's logs,
# puts the previous .env (image and settings) back, restarts that and exits 1.
# SKIP_PULL=1 uses images already on this machine and leaves them all in place
# (for a manual deploy of a locally built image, or a manual rollback here:
# SKIP_PULL=1 bash remote-deploy.sh <image shown as "previous" in the last deploy
# log>). HEALTH_TIMEOUT=<seconds> (90).
set -euo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")"

image=${1:?usage: remote-deploy.sh <image>}
health_timeout=${HEALTH_TIMEOUT:-90}
keep_backups=20
env_file=.env.new

log() { printf '==> %s\n' "$*"; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}
compose() { docker compose --file docker-compose.yml --env-file "$env_file" "$@"; }
# current NAME: the value of NAME in the current .env
current() { sed -n "s/^$1='\(.*\)'\$/\1/p" .env 2> /dev/null || true; }
# .env values are single-quoted, which compose takes literally (no $-expansion,
# no # comments), so refuse what single quotes cannot hold.
env_line() {
  case $2 in
    *"'"* | *\\* | *[[:cntrl:]]*) die "$1 must not contain quotes, backslashes or control characters" ;;
  esac
  printf "%s='%s'\n" "$1" "$2"
}

wait_healthy() {
  local id state="" deadline=$((SECONDS + health_timeout))
  log "Waiting up to ${health_timeout}s for the app to report healthy"
  while ((SECONDS < deadline)); do
    id=$(compose ps --all --quiet app)
    state=$(docker inspect --format \
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}} {{.RestartCount}}' "$id" 2> /dev/null) ||
      state="missing 0"
    case $state in
      "healthy "*) return 0 ;;
      "unhealthy "* | "no-healthcheck "* | "missing "*) break ;;
    esac
    ((${state#* } < 3)) || break # it keeps crashing
    sleep 2
  done
  log "The app is not healthy (health, restarts: ${state:-none})"
  return 1
}

exec 9> .deploy.lock
flock --wait 600 9 || die "another deploy is still running"
docker compose version > /dev/null 2>&1 || die "docker compose does not work for $(id -un) (see deploy/server-setup.sh)"
[[ -s app_password ]] || die "app_password is missing (the GitHub Actions deploy writes it)"
# The app runs as uid 1000 in its container and reads this file through the
# compose secret; the directory (mode 700) keeps everyone else on the server out.
chmod 644 app_password

[[ $health_timeout =~ ^[0-9]+$ ]] || die "HEALTH_TIMEOUT must be a number of seconds"
[[ $image =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]*$ ]] || die "not an image reference: $image"
domain=${DOMAIN-$(current DOMAIN)}
[[ -z $domain || $domain =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] ||
  die "DOMAIN must be a host name such as ufc.example.com"
new_env=$(
  env_line APP_IMAGE "$image"
  env_line DOMAIN "$domain"
  for name in APP_NAME TIMEZONE PLAYERS SESSION_DAYS; do
    if [[ -v $name ]]; then value=${!name}; else value=$(current "$name"); fi
    env_line "$name" "$value"
  done
)
# Compose prefers variables from its environment over the env file: drop them,
# so that .env alone decides (also during a rollback).
unset APP_IMAGE DOMAIN APP_NAME TIMEZONE PLAYERS SESSION_DAYS

previous_env=$(cat .env 2> /dev/null || true)
previous_image=$(current APP_IMAGE)
trap 'rm -f .env.new' EXIT
printf '%s\n' "$new_env" > .env.new
compose config --quiet || die "docker-compose.yml or the settings are invalid - nothing was changed"
# The bundled Caddy is optional: without it, another web server proxies to the app.
has_caddy=false
if compose config --services | grep -qx caddy; then has_caddy=true; fi

if [[ ${SKIP_PULL:-} == 1 ]]; then
  log "SKIP_PULL=1: using local images"
else
  log "Pulling $image"
  compose pull --quiet app || die "could not pull $image - nothing was changed"
  if $has_caddy; then
    compose pull --quiet caddy || log "WARNING: could not update caddy:2, keeping the local copy"
  fi
fi
if $has_caddy &&
  ! out=$(compose run --rm --no-deps -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 < /dev/null); then
  printf '%s\n' "$out" | tail -n 5 >&2
  die "the Caddyfile check failed - nothing was changed"
fi

if [[ -n $(compose ps --quiet --status running app) ]]; then
  log "Backing up the database"
  compose exec -T app node scripts/backup.js < /dev/null || die "the database backup failed - nothing was changed"
  compose exec -T app sh -c "ls -1t /app/data/backups/ufc-*.db | tail -n +$((keep_backups + 1)) | xargs -r rm -f --" < /dev/null ||
    log "WARNING: could not delete old backups (keeping all of them)"
else
  log "The app is not running yet: no backup to take"
fi

mv -f .env.new .env
env_file=.env
log "Starting $image"
# --force-recreate: compose cannot see a new app_password or Caddyfile by itself.
if compose up --detach --remove-orphans --force-recreate && wait_healthy; then
  log "Deployed $image (previous: ${previous_image:-none})"
  # Free disk space: older pulled tags of this image (the previous one stays for
  # a quick rollback). Other images on the server are left alone.
  if [[ ${SKIP_PULL:-} != 1 ]]; then
    repo=${image%@*}
    [[ ${repo##*/} != *:* ]] || repo=${repo%:*}
    docker image ls --format '{{.Repository}}:{{.Tag}}' "$repo" | grep -vxF -e "$image" -e "${previous_image:-$image}" |
      xargs -r docker image rm > /dev/null 2>&1 || true
  fi
  compose ps
  exit 0
fi

log "The deploy failed. Last app log lines:"
compose logs --no-color --tail 100 app || true
if [[ -z $previous_env || $previous_env == "$new_env" ]]; then
  die "deploy of $image failed, and there is no other version to roll back to"
fi
target=$previous_image
[[ $previous_image != "$image" ]] || target="the previous settings"
log "Rolling back to $target"
printf '%s\n' "$previous_env" > .env
if compose up --detach --remove-orphans --force-recreate && wait_healthy; then
  compose ps
  die "deploy of $image failed - rolled back to $target"
fi
die "deploy of $image failed, and the rollback to $target is not healthy either"
