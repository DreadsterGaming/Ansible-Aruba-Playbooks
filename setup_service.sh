#!/bin/bash
# ============================================
# Aruba VLAN Manager — Setup & Start Script
# ============================================
# Dieses Script richtet den Service ein und startet ihn.
# Ausführen mit: sudo bash setup_service.sh

set -e

APP_DIR="/home/mho/Claude/Ansible"
SERVICE_NAME="aruba-vlan-manager"
SERVICE_FILE="${APP_DIR}/${SERVICE_NAME}.service"

echo "=== Aruba VLAN Manager — Service Setup ==="
echo ""

# 1. Check if venv exists
if [ ! -d "${APP_DIR}/venv" ]; then
    echo "❌ venv nicht gefunden. Bitte zuerst: python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# 2. Install/update dependencies
echo "📦 Dependencies installieren..."
${APP_DIR}/venv/bin/pip install -r ${APP_DIR}/requirements.txt --quiet

# 3. Copy service file
echo "⚙️  Systemd Service einrichten..."
cp ${SERVICE_FILE} /etc/systemd/system/${SERVICE_NAME}.service
systemctl daemon-reload

# 4. Enable and start
echo "🚀 Service starten..."
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}

# 5. Show status
echo ""
echo "=== Status ==="
systemctl status ${SERVICE_NAME} --no-pager -l

echo ""
echo "✅ Fertig!"
echo ""
echo "🌐 Web UI erreichbar unter:"
IP=$(hostname -I | awk '{print $1}')
echo "   http://${IP}:5000"
echo "   http://$(hostname):5000"
echo ""
echo "📋 Nützliche Befehle:"
echo "   sudo systemctl status ${SERVICE_NAME}   # Status prüfen"
echo "   sudo systemctl restart ${SERVICE_NAME}  # Neustart"
echo "   sudo systemctl stop ${SERVICE_NAME}     # Stoppen"
echo "   sudo journalctl -u ${SERVICE_NAME} -f   # Live Logs"
