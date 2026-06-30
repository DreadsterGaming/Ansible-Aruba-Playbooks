# Aruba VLAN Manager

> Web-basiertes Dashboard zur VLAN-Verwaltung von HP Aruba 2530 Switches mit Ansible-Integration.

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-3.x-000000?logo=flask)
![Ansible](https://img.shields.io/badge/Ansible-2.15+-EE0000?logo=ansible&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- 📊 **Spreadsheet-UI** — Alle Ports und VLANs auf einen Blick, wie in Google Sheets
- 🔌 **Switch-Verwaltung** — Mehrere Aruba 2530 (8G/24G/48G) registrieren und verwalten
- ⚡ **Bootstrap VLANs** — VLANs 1–299 per Knopfdruck auf einem Switch erstellen
- 🚀 **One-Click Deploy** — VLAN-Konfiguration per Ansible über SSH auf die Switches pushen
- 🌙 **Dark Theme** — Modernes, dunkles UI-Design

## Screenshots

<!-- Screenshots hier einfügen wenn vorhanden -->
<!-- ![Dashboard](docs/screenshot.png) -->

## Voraussetzungen

- **Python 3.10+**
- **SSH-Zugang** zu den Aruba 2530 Switches
- Debian/Ubuntu Server (oder jede Linux-Distro mit Python3)

## Installation

### Automatisch (empfohlen)

```bash
git clone <dein-repo-url> aruba-vlan-manager
cd aruba-vlan-manager
sudo bash setup.sh
```

Das Setup-Script erledigt alles:
- Installiert Python3, pip, sshpass
- Erstellt ein Python venv mit Flask + Ansible
- Installiert Ansible Collections (`ansible.netcommon`, `arubanetworks.aos_switch`)
- Richtet einen systemd Service ein (startet automatisch bei Boot)

### Manuell

```bash
# Abhängigkeiten installieren
python3 -m venv venv
source venv/bin/activate
pip install flask ansible-core
ansible-galaxy collection install ansible.netcommon
ansible-galaxy collection install arubanetworks.aos_switch

# Starten
python3 app.py
```

## Benutzung

### 1. Server starten

```bash
# Mit systemd (nach setup.sh)
sudo systemctl start aruba-vlan-manager

# Oder manuell
python3 app.py
```

Öffne **http://\<server-ip\>:5000** im Browser.

### 2. Switch hinzufügen

Klicke **"+ Add Switch"** und trage ein:

| Feld | Beispiel |
|------|----------|
| Name | `SW-Lobby-01` |
| IP-Adresse | `10.0.1.10` |
| Modell | `2530-24G` |
| SSH User | `admin` |
| SSH Passwort | `•••••` |

Die Port-Tabelle wird automatisch basierend auf dem Modell generiert (8/24/48 Ports).

### 3. VLANs konfigurieren

In der Spreadsheet-Tabelle pro Port einstellen:

| Spalte | Beschreibung |
|--------|-------------|
| **Description** | Port-Beschreibung (z.B. "Uplink-Core") |
| **Mode** | `Access` (ein VLAN) oder `Trunk` (mehrere VLANs) |
| **Untagged VLAN** | Dropdown 1–299 |
| **Tagged VLANs** | Komma-getrennt, z.B. `10,20,30` (nur bei Trunk) |

→ **💾 Save Changes** klicken um zu speichern.

### 4. Auf Switch deployen

| Button | Funktion |
|--------|----------|
| ⚡ **Bootstrap VLANs** | Erstellt VLANs 1–299 auf dem Switch (einmalig pro Switch) |
| 🚀 **Deploy** | Pusht die Port-VLAN-Konfiguration auf den ausgewählten Switch |
| 🚀 **Deploy All** | Pusht auf alle registrierten Switches |
| ⚙ **Generate Config** | Generiert nur die Ansible-Dateien (ohne Deploy) |

## Projektstruktur

```
aruba-vlan-manager/
├── app.py                          # Flask Backend (REST API)
├── setup.sh                        # Automatisches Setup-Script
├── requirements.txt                # Python Abhängigkeiten
├── templates/
│   └── index.html                  # Web UI
├── static/
│   ├── css/
│   │   └── style.css               # Dark Theme Styling
│   └── js/
│       └── app.js                  # Frontend Logik
├── data/
│   └── switches.json               # Switch-Daten (wird auto-generiert)
└── ansible/
    ├── inventory/
    │   ├── hosts.yml               # Auto-generiertes Inventory
    │   └── host_vars/              # Auto-generierte Host-Variablen
    ├── playbooks/
    │   ├── bootstrap_vlans.yml     # VLANs 1-299 erstellen
    │   └── configure_ports.yml     # Port-VLAN-Zuweisung pushen
    └── templates/
        ├── bootstrap_vlans.j2      # Jinja2: VLAN-Erstellung
        └── port_config.j2          # Jinja2: Port-Konfiguration
```

## API Endpunkte

| Methode | Endpunkt | Beschreibung |
|---------|----------|-------------|
| `GET` | `/api/switches` | Alle Switches auflisten |
| `POST` | `/api/switches` | Switch hinzufügen |
| `PUT` | `/api/switches/<id>` | Switch bearbeiten |
| `DELETE` | `/api/switches/<id>` | Switch löschen |
| `PUT` | `/api/switches/<id>/ports` | Port-Konfiguration speichern |
| `POST` | `/api/generate` | Ansible-Dateien generieren |
| `POST` | `/api/deploy` | Deploy auf alle Switches |
| `POST` | `/api/deploy/<id>` | Deploy auf einen Switch |
| `POST` | `/api/bootstrap/<id>` | VLANs 1–299 erstellen |
| `GET` | `/api/deploy/status` | Letzter Deploy-Status |

## Service verwalten

```bash
# Status
sudo systemctl status aruba-vlan-manager

# Neustart
sudo systemctl restart aruba-vlan-manager

# Logs (live)
sudo journalctl -u aruba-vlan-manager -f

# Stoppen
sudo systemctl stop aruba-vlan-manager

# Deaktivieren (kein Autostart)
sudo systemctl disable aruba-vlan-manager
```

## Switch-Vorbereitung

SSH muss auf den Aruba 2530 Switches aktiviert sein:

```
# Auf dem Switch (Konsole):
crypto key generate ssh rsa bits 2048
ip ssh
```

## Hinweise

- ⚠️ SSH-Passwörter werden in `data/switches.json` im Klartext gespeichert. Für Produktionsumgebungen empfiehlt sich Ansible Vault.
- Die Datei `data/switches.json` enthält alle Switch-Daten und wird automatisch erstellt.
- Der Server läuft standardmäßig auf Port **5000**. Änderbar in `app.py`.

## Lizenz

MIT
