#!/usr/bin/env bash
# install.sh — Deploy AniList Stremio Addon to a Linux LXC container
# Usage: bash install.sh [options]
#   -p, --port PORT       Port to run the addon on (default: 3000)
#   -u, --user USER       System user to run the service as (default: addon)
#   -d, --dir DIR         Install directory (default: /opt/anilist-stremio)
#   -h, --help            Show this help message

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
PORT=3000
SERVICE_USER="addon"
INSTALL_DIR="/opt/anilist-stremio"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)  PORT="$2";        shift 2 ;;
    -u|--user)  SERVICE_USER="$2"; shift 2 ;;
    -d|--dir)   INSTALL_DIR="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,7p' "$0" | sed 's/^# *//'
      exit 0 ;;
    *) error "Unknown option: $1" ;;
  esac
done

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "This script must be run as root (sudo bash install.sh)"

# ── Port validation ───────────────────────────────────────────────────────────
[[ "$PORT" =~ ^[0-9]+$ ]] && [[ "$PORT" -ge 1 ]] && [[ "$PORT" -le 65535 ]] \
  || error "Invalid port: $PORT"

echo ""
echo "============================================================"
echo " AniList Stremio Addon — Installer"
echo "============================================================"
info "Install directory : $INSTALL_DIR"
info "Service user      : $SERVICE_USER"
info "Port              : $PORT"
echo ""

# ── Install Node.js (via NodeSource LTS) ──────────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Installing Node.js LTS..."
  if command -v apt-get &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - &>/dev/null
    apt-get install -y -qq nodejs
  elif command -v dnf &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash - &>/dev/null
    dnf install -y nodejs
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash - &>/dev/null
    yum install -y nodejs
  else
    error "Unsupported package manager. Install Node.js manually and re-run."
  fi
  success "Node.js $(node --version) installed"
else
  success "Node.js $(node --version) already installed"
fi

# ── Create service user ───────────────────────────────────────────────────────
if ! id "$SERVICE_USER" &>/dev/null; then
  info "Creating system user '$SERVICE_USER'..."
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  success "User '$SERVICE_USER' created"
else
  success "User '$SERVICE_USER' already exists"
fi

# ── Copy files ────────────────────────────────────────────────────────────────
info "Copying application files to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

rsync -a --delete \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='install.sh' \
  "$REPO_DIR/" "$INSTALL_DIR/" 2>/dev/null \
  || { cp -r "$REPO_DIR/." "$INSTALL_DIR/"; rm -f "$INSTALL_DIR/install.sh"; }

# ── Write .env (only if one does not already exist) ───────────────────────────
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  info "Creating .env file..."
  cat > "$INSTALL_DIR/.env" <<EOF
PORT=$PORT
NODE_ENV=production
EOF
  success ".env created at $INSTALL_DIR/.env"
else
  warn ".env already exists — skipping (edit $INSTALL_DIR/.env manually if needed)"
  # Update PORT in existing .env if it differs
  if grep -q "^PORT=" "$INSTALL_DIR/.env"; then
    sed -i "s/^PORT=.*/PORT=$PORT/" "$INSTALL_DIR/.env"
    info "Updated PORT=$PORT in existing .env"
  fi
fi

# ── Install npm dependencies ──────────────────────────────────────────────────
info "Installing npm dependencies..."
cd "$INSTALL_DIR"
npm install --omit=dev --silent
success "Dependencies installed"

# ── Set ownership ─────────────────────────────────────────────────────────────
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 640 "$INSTALL_DIR/.env"
# Ensure data dir is writable by the service user
mkdir -p "$INSTALL_DIR/data"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/data"
chmod 750 "$INSTALL_DIR/data"
# Initialise tokens.json if missing so the service user can write to it immediately
if [[ ! -f "$INSTALL_DIR/data/tokens.json" ]]; then
  echo '{}' > "$INSTALL_DIR/data/tokens.json"
fi
chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/data/tokens.json"
chmod 640 "$INSTALL_DIR/data/tokens.json"

# ── Create systemd service ────────────────────────────────────────────────────
SERVICE_FILE="/etc/systemd/system/anilist-stremio.service"
info "Writing systemd service to $SERVICE_FILE..."

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=AniList Stremio Addon
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$(command -v node) index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Harden the process
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$INSTALL_DIR/data

[Install]
WantedBy=multi-user.target
EOF

# ── Enable and start the service ──────────────────────────────────────────────
systemctl daemon-reload
systemctl enable anilist-stremio --quiet
systemctl restart anilist-stremio

# Give it a moment then check status
sleep 2
if systemctl is-active --quiet anilist-stremio; then
  success "Service is running"
else
  error "Service failed to start. Check logs with: journalctl -u anilist-stremio -n 50"
fi

# ── Detect outward-facing IP ──────────────────────────────────────────────────
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_SERVER_IP")

echo ""
echo "============================================================"
success "Installation complete!"
echo "============================================================"
echo ""
echo -e "  Configure page : ${CYAN}http://$HOST_IP:$PORT/${NC}"
echo ""
echo "  Open the configure page to log in with AniList, MyAnimeList, or IMDB."
echo "  Your addon URL is generated automatically after authentication."
echo ""
echo "  Manage the service:"
echo "    systemctl status  anilist-stremio"
echo "    systemctl restart anilist-stremio"
echo "    journalctl -u anilist-stremio -f"
echo ""
