#!/usr/bin/env bash
# UFC ZAQ: one-time setup of a VPS for deploys from GitHub Actions. Safe to re-run.
# Log in as root (or run sudo -i), then paste this whole file into the terminal,
# or copy it to the server and run: bash server-setup.sh
#
# It installs Docker, creates the user "deploy" (SSH key only, used by GitHub
# Actions) and /opt/ufc-zaq, opens ports 80/443 if the ufw firewall is on, and
# prints what to add in GitHub (Settings > Secrets and variables > Actions).
(
  set -euo pipefail
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
  { grep -vF "$(cut -d' ' -f2 "$KEY.pub")" "$AUTH" 2> /dev/null || true; echo "restrict $(cat "$KEY.pub")"; } > "$AUTH.new"
  install -m 600 -o "$DEPLOY_USER" -g "$GROUP" "$AUTH.new" "$AUTH" && rm -f "$AUTH.new"

  echo "== Firewall and ports"
  SSH_PORT=$(sshd -T 2> /dev/null | awk '$1 == "port" && n == 0 {print $2; n = 1}' || true)
  SSH_PORT=${SSH_PORT:-22}
  case $(ufw status 2> /dev/null || true) in
    "Status: active"*) ufw allow "$SSH_PORT/tcp" && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp ;;
    *) echo "ufw is not active: nothing to open here (open 80 and 443 in your provider's firewall, if it has one)" ;;
  esac
  BUSY=$(
    ss -Hltunp 2> /dev/null | awk '$5 ~ /:(80|443)$/' | grep -v docker-proxy || true
    docker ps --filter publish=80 --filter publish=443 \
      --format '{{.Names}} (docker project: {{.Label "com.docker.compose.project"}})' | grep -v '(docker project: ufc-zaq)$' || true
  )
  [ -z "$BUSY" ] || printf 'WARNING: ports 80/443 are already in use. See "Already running a web server" in the README:\n%s\n' "$BUSY"

  IP=$(hostname -I 2> /dev/null | awk '{print $1}' || true)
  echo
  echo "In GitHub: repository > Settings > Secrets and variables > Actions"
  echo "Add these two as secrets (New repository secret):"
  echo "==================== SSH_PRIVATE_KEY (every line, BEGIN and END included) ===================="
  cat "$KEY"
  echo "==================== SSH_KNOWN_HOSTS (this server's host keys) ===================="
  for f in /etc/ssh/ssh_host_*_key.pub; do [ -f "$f" ] && cut -d' ' -f1,2 "$f"; done
  echo "==================== end ===================="
  echo "Also the secret APP_PASSWORD: the club login password, at least 8 characters."
  echo "And as variables (Variables tab): SSH_HOST = this server's public IP or host name${IP:+ (probably $IP)},"
  echo "DOMAIN = the app's address, e.g. ufc.example.com (its DNS A record must point to this server)."
  [ "$SSH_PORT" = 22 ] || echo "SSH listens on port $SSH_PORT: also add the variable SSH_PORT = $SSH_PORT"
)
