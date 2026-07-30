#!/bin/bash
# ============================================
# Aruba VLAN Manager — Automated Setup Script
# For Debian/Ubuntu VM on Proxmox
# ============================================
set -e

APP_DIR="/opt/aruba-vlan-manager"
APP_USER="aruba-mgr"
SERVICE_NAME="aruba-vlan-manager"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Aruba VLAN Manager — Setup Script      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# --- Check root ---
if [ "$EUID" -ne 0 ]; then
  echo "❌ Bitte als root ausführen: sudo bash setup.sh"
  exit 1
fi

# --- Install system dependencies ---
echo "📦 Installing system packages..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv sshpass git > /dev/null 2>&1
echo "   ✅ System packages installed"

# --- Create app user (no login shell) ---
if ! id "$APP_USER" &>/dev/null; then
  echo "👤 Creating service user '$APP_USER'..."
  useradd -r -s /bin/false -d "$APP_DIR" "$APP_USER"
  echo "   ✅ User created"
else
  echo "   ℹ️  User '$APP_USER' already exists"
fi

# --- Copy app files ---
echo "📁 Setting up application in $APP_DIR..."
mkdir -p "$APP_DIR"

# Copy everything from the current directory (where the tarball was extracted)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$SCRIPT_DIR" != "$APP_DIR" ]; then
  cp -r "$SCRIPT_DIR"/* "$APP_DIR/" 2>/dev/null || true
  cp -r "$SCRIPT_DIR"/.* "$APP_DIR/" 2>/dev/null || true
fi

# Ensure data directory exists
mkdir -p "$APP_DIR/data"
if [ ! -f "$APP_DIR/data/switches.json" ]; then
  echo '{"switches": []}' > "$APP_DIR/data/switches.json"
fi

# Ensure ansible directories exist
mkdir -p "$APP_DIR/ansible/inventory/host_vars"

echo "   ✅ App files copied"

# --- Create Python venv & install dependencies ---
echo "🐍 Setting up Python virtual environment..."
python3 -m venv "$APP_DIR/venv"
source "$APP_DIR/venv/bin/activate"
pip install --quiet --upgrade pip
if [ -f "$APP_DIR/requirements.txt" ]; then
  pip install --quiet -r "$APP_DIR/requirements.txt"
else
  pip install --quiet flask ansible-core pyyaml
fi
echo "   ✅ Python dependencies installed"

# --- Install Ansible collections ---
echo "📚 Installing Ansible collections into app directory..."
mkdir -p "$APP_DIR/ansible/collections"
"$APP_DIR/venv/bin/ansible-galaxy" collection install ansible.netcommon -p "$APP_DIR/ansible/collections" --timeout 30 > /dev/null 2>&1 || echo "   ⚠️  ansible.netcommon skipped/already present"
"$APP_DIR/venv/bin/ansible-galaxy" collection install arubanetworks.aos_switch -p "$APP_DIR/ansible/collections" --timeout 30 > /dev/null 2>&1 || echo "   ⚠️  arubanetworks.aos_switch skipped/already present"
echo "   ✅ Ansible collections checked"

deactivate

# --- Set ownership ---
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod -R 775 "$APP_DIR"

# --- Open Firewall Port 5000 ---
if command -v ufw >/dev/null 2>&1; then
  echo "🛡️  Configuring UFW firewall for port 5000..."
  ufw allow 5000/tcp >/dev/null 2>&1 || true
elif command -v firewall-cmd >/dev/null 2>&1; then
  echo "🛡️  Configuring Firewalld for port 5000..."
  firewall-cmd --add-port=5000/tcp --permanent >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi

# --- Create systemd service ---
echo "⚙️  Creating systemd service..."
cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=Aruba VLAN Manager — Web Dashboard
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment="PATH=$APP_DIR/venv/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=$APP_DIR/venv/bin/python3 $APP_DIR/app.py
Restart=always
RestartSec=5

# Security hardening
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF

# --- Enable & start service ---
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
echo "   ✅ Service created and started"

# --- Get server IP ---
SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║          ✅ Setup Complete!               ║"
echo "╠══════════════════════════════════════════╣"
echo "║                                          ║"
echo "  🌐 Web UI: http://${SERVER_IP}:5000"
echo "║                                          ║"
echo "  📁 App Dir: $APP_DIR"
echo "  📊 Data:    $APP_DIR/data/switches.json"
echo "║                                          ║"
echo "  Service commands:"
echo "  • sudo systemctl status $SERVICE_NAME"
echo "  • sudo systemctl restart $SERVICE_NAME"
echo "  • sudo journalctl -u $SERVICE_NAME -f"
echo "║                                          ║"
echo "╚══════════════════════════════════════════╝"
echo ""
