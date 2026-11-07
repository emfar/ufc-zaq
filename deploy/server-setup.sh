#!/usr/bin/env bash
# UFC ZAQ: one-time server setup for deploys from GitHub Actions (safe to re-run).
# Log in as root (ssh root@94.20.57.239, or sudo -i), then paste this whole file
# into the terminal - or copy it to the server and run: bash server-setup.sh
# It installs Docker, creates the user "deploy" and /opt/ufc-zaq, and prints the
# two secrets to add in GitHub (Settings > Secrets and variables > Actions).
(
  set -euo pipefail
  SSH_HOST=${SSH_HOST:-94.20.57.239} # the address GitHub Actions connects to
  DEPLOY_USER=deploy
  APP_DIR=/opt/ufc-zaq
  KEY=/root/.ssh/ufc-zaq-github-actions # the key GitHub Actions logs in with
  [ "$(id -u)" = 0 ] || { echo "Please run this as root (sudo -i)" >&2; exit 1; }
  export DEBIAN_FRONTEND=noninteractive

  echo "== Docker"
  command -v curl > /dev/null || { apt-get update -q && apt-get install -yq curl; }
  command -v docker > /dev/null || curl -fsSL https://get.docker.com | sh
  docker compose version > /dev/null 2>&1 ||
    { apt-get update -q && { apt-get install -yq docker-compose-plugin || apt-get install -yq docker-compose-v2; }; }
  systemctl enable --now docker > /dev/null 2>&1 || true
  docker compose version

  echo "== User $DEPLOY_USER and $APP_DIR"
  id -u "$DEPLOY_USER" > /dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"
  usermod --password '*' --append --groups docker "$DEPLOY_USER" # no password: SSH key only
  GROUP=$(id -gn "$DEPLOY_USER")
  HOME_DIR=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
  install -d -m 700 -o "$DEPLOY_USER" -g "$GROUP" "$APP_DIR" "$HOME_DIR/.ssh"

  echo "== SSH key for GitHub Actions"
  install -d -m 700 /root/.ssh
  [ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C github-actions@ufc-zaq -f "$KEY"
  AUTH=$HOME_DIR/.ssh/authorized_keys
  touch "$AUTH"
  grep -qF "$(cut -d' ' -f2 "$KEY.pub")" "$AUTH" || echo "restrict $(cat "$KEY.pub")" >> "$AUTH"
  chown "$DEPLOY_USER:$GROUP" "$AUTH" && chmod 600 "$AUTH"

  echo "== Firewall and ports"
  SSH_PORT=$(sshd -T 2> /dev/null | awk '$1 == "port" && n == 0 {print $2; n = 1}' || true)
  SSH_PORT=${SSH_PORT:-22}
  UFW=$(ufw status 2> /dev/null || true)
  case $UFW in
    "Status: active"*) ufw allow "$SSH_PORT/tcp" && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp ;;
    *) echo "ufw is not active: nothing to open here (open 80 and 443 in your provider's firewall, if it has one)" ;;
  esac
  BUSY=$(ss -Hltunp 2> /dev/null | awk '$5 ~ /:(80|443)$/' | grep -v docker-proxy || true)
  [ -z "$BUSY" ] || printf 'WARNING: another program uses port 80/443, which Caddy needs:\n%s\n' "$BUSY"

  NAME=$SSH_HOST
  [ "$SSH_PORT" = 22 ] || NAME="[$SSH_HOST]:$SSH_PORT"
  echo
  echo "Add both in GitHub: repository > Settings > Secrets and variables > Actions > New repository secret"
  echo "==================== SSH_PRIVATE_KEY (every line, BEGIN and END included) ===================="
  cat "$KEY"
  echo "==================== SSH_KNOWN_HOSTS ===================="
  for f in /etc/ssh/ssh_host_*_key.pub; do echo "$NAME $(cut -d' ' -f1,2 "$f")"; done
  echo "==================== end ===================="
  echo "Also add the secret APP_PASSWORD: the login password for the app, at least 8 characters."
  [ "$SSH_PORT" = 22 ] || echo "SSH listens on port $SSH_PORT: also add the repository variable SSH_PORT = $SSH_PORT"
)
