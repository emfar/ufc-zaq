#!/usr/bin/env bash
# zufc (UFC ZAQ): one-time setup of the shared server for deploys from GitHub
# Actions. Safe to re-run. Log in as root (ssh root@94.20.57.239, or sudo -i) and
# paste this whole file into the terminal, or copy it there and run: bash server-setup.sh
#
# It creates the user "zufc" (SSH key only, used by GitHub Actions) and /opt/zufc,
# puts the server's existing Caddy (the container publishing port 443) on a shared
# Docker network "edge", adds the zufc.asaim.tech site to that Caddy's Caddyfile
# (checked with "caddy validate" first; the original is kept as
# Caddyfile.before-zufc) and reloads Caddy without downtime. Then it prints the
# two secrets to add in GitHub (Settings > Secrets and variables > Actions).
(
  set -euo pipefail
  SSH_HOST=${SSH_HOST:-94.20.57.239} # the address GitHub Actions connects to
  DOMAIN=${DOMAIN:-zufc.asaim.tech}
  APP_USER=zufc
  APP_DIR=/opt/zufc
  NETWORK=edge
  KEY=/root/.ssh/zufc-github-actions # the key GitHub Actions logs in with
  [ "$(id -u)" = 0 ] || { echo "Please run this as root (sudo -i)" >&2; exit 1; }

  echo "== Docker"
  command -v docker > /dev/null || curl -fsSL https://get.docker.com | sh
  docker compose version

  echo "== User $APP_USER and $APP_DIR"
  id -u "$APP_USER" > /dev/null 2>&1 || useradd --create-home --shell /bin/bash "$APP_USER"
  usermod --password '*' --append --groups docker "$APP_USER" # no password: SSH key only
  GROUP=$(id -gn "$APP_USER")
  HOME_DIR=$(getent passwd "$APP_USER" | cut -d: -f6)
  install -d -m 700 -o "$APP_USER" -g "$GROUP" "$APP_DIR" "$HOME_DIR/.ssh"

  echo "== SSH key for GitHub Actions"
  install -d -m 700 /root/.ssh
  [ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C "github-actions@$APP_USER" -f "$KEY"
  AUTH=$HOME_DIR/.ssh/authorized_keys
  { grep -vF "$(cut -d' ' -f2 "$KEY.pub")" "$AUTH" 2> /dev/null || true; echo "restrict $(cat "$KEY.pub")"; } > "$AUTH.new"
  install -m 600 -o "$APP_USER" -g "$GROUP" "$AUTH.new" "$AUTH" && rm -f "$AUTH.new"

  echo "== Shared network '$NETWORK' and the server's Caddy"
  docker network inspect "$NETWORK" > /dev/null 2>&1 || docker network create "$NETWORK"
  CADDY=$(docker ps --filter publish=443 --format '{{.Names}}' | head -n 1)
  [ -n "$CADDY" ] || { echo "No running container publishes port 443 (the server's Caddy)" >&2; exit 1; }
  docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$CADDY" |
    grep -qxF "$NETWORK" || docker network connect "$NETWORK" "$CADDY"
  CADDYFILE=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$CADDY")
  if [ -z "$CADDYFILE" ]; then
    DIR=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$CADDY")
    [ -z "$DIR" ] || CADDYFILE=$DIR/Caddyfile
  fi
  [ -f "$CADDYFILE" ] || { echo "Could not find the Caddyfile of $CADDY on this server" >&2; exit 1; }
  echo "Caddy: container $CADDY, Caddyfile $CADDYFILE"
  SITE=$(printf '# >>> zufc - added by deploy/server-setup.sh of the ufc-zaq repo\n%s {\n\tencode zstd gzip\n\treverse_proxy zufc-app:3000\n}\n# <<< zufc' "$DOMAIN")
  OLD=$(cat "$CADDYFILE")
  NEW=$(printf '%s\n' "$OLD" | awk '/^# >>> zufc/ {skip = 1} !skip {print} /^# <<< zufc/ {skip = 0}')
  NEW=$(printf '%s\n\n%s' "$NEW" "$SITE")
  if [ "$NEW" = "$OLD" ]; then
    echo "$DOMAIN is already in the Caddyfile"
  else
    [ -f "$CADDYFILE.before-zufc" ] || cp -p "$CADDYFILE" "$CADDYFILE.before-zufc"
    printf '%s\n' "$NEW" > "$CADDYFILE" # rewrite in place: the container's bind mount keeps seeing it
    if ! OUT=$(docker exec "$CADDY" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1); then
      printf '%s\n' "$OLD" > "$CADDYFILE"
      printf '%s\n' "$OUT" | tail -n 5 >&2
      echo "Caddy rejected the new Caddyfile, so the old one was put back. Nothing changed." >&2
      exit 1
    fi
    OUT=$(docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1) ||
      { printf '%s\n' "$OUT" | tail -n 5; echo "WARNING: Caddy did not reload. When convenient, run: docker restart $CADDY"; }
    echo "Added $DOMAIN to the Caddyfile (original saved as $CADDYFILE.before-zufc)"
  fi

  SSH_PORT=$(sshd -T 2> /dev/null | awk '$1 == "port" && n == 0 {print $2; n = 1}' || true)
  SSH_PORT=${SSH_PORT:-22}
  NAME=$SSH_HOST
  [ "$SSH_PORT" = 22 ] || NAME="[$SSH_HOST]:$SSH_PORT"
  echo
  echo "Add both in GitHub: repository > Settings > Secrets and variables > Actions > New repository secret"
  echo "==================== SSH_PRIVATE_KEY (every line, BEGIN and END included) ===================="
  cat "$KEY"
  echo "==================== SSH_KNOWN_HOSTS ===================="
  for f in /etc/ssh/ssh_host_*_key.pub; do [ -f "$f" ] && echo "$NAME $(cut -d' ' -f1,2 "$f")"; done
  echo "==================== end ===================="
  echo "Also add the secret APP_PASSWORD: the login password for the app, at least 8 characters."
  [ "$SSH_PORT" = 22 ] || echo "SSH listens on port $SSH_PORT: also add the repository variable SSH_PORT = $SSH_PORT"
)
