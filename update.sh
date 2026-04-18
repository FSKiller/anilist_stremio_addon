#!/usr/bin/env bash
# update.sh — Update an existing Anime Stremio Addon installation
# Usage: bash update.sh [options]
#   -d, --dir DIR         Install directory (default: /opt/anilist-stremio)
#   -h, --help            Show this help message

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
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
    -d|--dir)  INSTALL_DIR="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,6p' "$0" | sed 's/^# *//'
      exit 0 ;;
    *) error "Unknown option: $1" ;;
  esac
done

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "This script must be run as root (sudo bash update.sh)"

# ── Verify existing install ───────────────────────────────────────────────────
[[ -d "$INSTALL_DIR" ]]          || error "Install directory not found: $INSTALL_DIR\n       Run install.sh first."
[[ -f "$INSTALL_DIR/index.js" ]] || error "index.js not found in $INSTALL_DIR. Is this the right directory?"
[[ -f "$INSTALL_DIR/.env" ]]     || error ".env not found in $INSTALL_DIR. Run install.sh to set up from scratch."

# ── Read current config from .env ────────────────────────────────────────────
SERVICE_USER=$(stat -c '%U' "$INSTALL_DIR/.env")

echo ""
echo "============================================================"
echo " Anime Stremio Addon — Updater"
echo "============================================================"
info "Install directory : $INSTALL_DIR"
info "Service user      : $SERVICE_USER"
echo ""

# ── Get running version (if available) ───────────────────────────────────────
OLD_VERSION="unknown"
if [[ -f "$INSTALL_DIR/package.json" ]]; then
  OLD_VERSION=$(node -e "console.log(require('$INSTALL_DIR/package.json').version)" 2>/dev/null || echo "unknown")
fi
NEW_VERSION=$(node -e "console.log(require('$REPO_DIR/package.json').version)" 2>/dev/null || echo "unknown")

info "Installed version : $OLD_VERSION"
info "New version       : $NEW_VERSION"
echo ""

if [[ "$OLD_VERSION" == "$NEW_VERSION" ]]; then
  warn "Versions match ($OLD_VERSION). Proceeding anyway to sync any file changes."
fi

# ── Stop the service ──────────────────────────────────────────────────────────
if systemctl is-active --quiet anilist-stremio 2>/dev/null; then
  info "Stopping service..."
  systemctl stop anilist-stremio
  success "Service stopped"
else
  warn "Service was not running (continuing anyway)"
fi

# ── Back up the existing .env ─────────────────────────────────────────────────
ENV_BACKUP="$INSTALL_DIR/.env.bak"
cp "$INSTALL_DIR/.env" "$ENV_BACKUP"
info "Backed up .env to .env.bak"

# ── Sync application files (preserve .env) ───────────────────────────────────
info "Syncing application files..."

rsync -a --delete \
  --exclude='.env' \
  --exclude='.env.bak' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='install.sh' \
  --exclude='update.sh' \
  --exclude='data' \
  "$REPO_DIR/" "$INSTALL_DIR/" 2>/dev/null \
  || {
    # rsync not available — fall back to cp + manual excludes
    find "$REPO_DIR" -mindepth 1 -maxdepth 1 \
      ! -name '.env' ! -name '.env.bak' ! -name 'node_modules' \
      ! -name '.git' ! -name 'install.sh' ! -name 'update.sh' \
      ! -name 'data' \
      -exec cp -r {} "$INSTALL_DIR/" \;
  }

success "Files synced"

# ── Update npm dependencies ───────────────────────────────────────────────────
info "Updating npm dependencies..."
cd "$INSTALL_DIR"
npm install --omit=dev --silent
success "Dependencies updated"

# ── Restore ownership ─────────────────────────────────────────────────────────
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 640 "$INSTALL_DIR/.env"
# Ensure data dir is writable by the service user
mkdir -p "$INSTALL_DIR/data"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/data"
chmod 750 "$INSTALL_DIR/data"
[[ -f "$INSTALL_DIR/data/tokens.json" ]] && chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/data/tokens.json" && chmod 640 "$INSTALL_DIR/data/tokens.json"

# ── Reload systemd unit in case it changed ────────────────────────────────────
if [[ -f "/etc/systemd/system/anilist-stremio.service" ]]; then
  systemctl daemon-reload
fi

# ── Start the service ─────────────────────────────────────────────────────────
info "Starting service..."
systemctl start anilist-stremio

sleep 2
if systemctl is-active --quiet anilist-stremio; then
  success "Service is running"
else
  warn "Service failed to start — restoring previous .env from backup"
  cp "$ENV_BACKUP" "$INSTALL_DIR/.env"
  chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
  chmod 640 "$INSTALL_DIR/.env"
  error "Update failed. Check logs with: journalctl -u anilist-stremio -n 50"
fi

# ── Clean up backup if everything is fine ────────────────────────────────────
rm -f "$ENV_BACKUP"

# ── Detect outward-facing IP ──────────────────────────────────────────────────
PORT=$(grep -E '^PORT=' "$INSTALL_DIR/.env" | cut -d= -f2 || echo "3000")
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_SERVER_IP")

echo ""
echo "============================================================"
success "Update complete! ($OLD_VERSION → $NEW_VERSION)"
echo "============================================================"
echo ""
echo -e "  Configure page : ${CYAN}http://$HOST_IP:$PORT/${NC}"
echo ""
echo "  Manage the service:"
echo "    systemctl status  anilist-stremio"
echo "    journalctl -u anilist-stremio -f"
echo ""
