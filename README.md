# Aruba VLAN Manager

> Web-basiertes Dashboard zur VLAN-Verwaltung von HP Aruba 2530/2540/2930F Switches mit Ansible-Integration.

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.x-000000?logo=flask)](https://flask.palletsprojects.com)
[![Ansible](https://img.shields.io/badge/Ansible-2.15+-EE0000?logo=ansible&logoColor=white)](https://ansible.com)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

## Features

- 📊 **Spreadsheet-UI** — Alle Ports und VLANs auf einen Blick editierbar
- 🔌 **Switch-Verwaltung** — Mehrere Aruba 2530/2540/2930F Switches verwalten
- ⚡ **Bootstrap VLANs** — VLANs 1–299 per Knopfdruck auf einem Switch erstellen
- 🚀 **One-Click Deploy** — VLAN-Konfiguration per Ansible über SSH pushen
- 🏷️ **Hostname umbenennen** — Switch-Hostname direkt aus dem Browser setzen
- 📥 **Config Backup** — `show running-config` als Datei herunterladen
- 📥 **Inventory Import** — Geräte aus bestehender Ansible-Inventory-Datei importieren (YAML & INI)
- 🧹 **VLAN Löschen** — Benutzerdefinierte VLANs dynamisch vom Switch entfernen
- 🌙 **Dark / Light Mode** — Umschaltbares Farbschema
- 🔑 **SSH-Key Support** — Authentifizierung per Passwort oder SSH-Key
- 📋 **Live Deploy-Log** — Ansible-Output direkt im Browser anzeigen
- 🏗️ **Playbook Generator** — Ansible-Playbooks ohne echten Switch erstellen und exportieren

## Installation

### Automatisch (empfohlen)

```bash
git clone https://github.com/DreadsterGaming/Ansible-Aruba-Playbooks aruba-vlan-manager
cd aruba-vlan-manager
sudo bash setup.sh
```

Das Setup-Script erledigt alles automatisch:
- Installiert Python3, pip, sshpass
- Erstellt ein Python venv mit allen Abhängigkeiten (Flask, Ansible, PyYAML)
- Installiert Ansible Collections (`ansible.netcommon`, `arubanetworks.aos_switch`)
- Richtet einen **systemd Service** ein (startet automatisch bei Boot)

Nach erfolgreichem Setup ist das Tool erreichbar unter:

```
http://<server-ip>:5000
```

### Manuell

```bash
# Repository klonen
git clone https://github.com/DreadsterGaming/Ansible-Aruba-Playbooks aruba-vlan-manager
cd aruba-vlan-manager

# Python venv erstellen und aktivieren
python3 -m venv venv
source venv/bin/activate

# Abhängigkeiten installieren
pip install -r requirements.txt

# Ansible Collections installieren
ansible-galaxy collection install ansible.netcommon
ansible-galaxy collection install arubanetworks.aos_switch

# Server starten
python3 app.py
```

## Voraussetzungen

- **Python 3.10+**
- **SSH-Zugang** zu den Aruba Switches (Passwort oder SSH-Key)
- Linux-Server / VM mit Python3 (Debian, Ubuntu, RHEL, Fedora etc.)
- Aruba AOS-Switch Modell: 2530 (8G/24G/48G), 2540 (24G/48G), 2930F (8G/24G/48G)

## Benutzung

### 1. Server starten / verwalten

```bash
# Mit systemd (nach setup.sh)
sudo systemctl start aruba-vlan-manager
sudo systemctl status aruba-vlan-manager
sudo journalctl -u aruba-vlan-manager -f   # Live-Logs

# Oder manuell im Vordergrund
source venv/bin/activate
python3 app.py
```

Öffne **http://\<server-ip\>:5000** im Browser.

### 2. Switch hinzufügen

Klicke **„+ Add Switch"** und trage ein:

| Feld | Beispiel |
|------|----------|
| Name | `SW-Lobby-01` |
| Hardware Hostname | `sw231-h1-einlass` _(optional)_ |
| IP-Adresse | `10.0.1.10` |
| Modell | `2530-24G` |
| SSH User | `manager` |
| SSH Passwort | `•••••` |
| SSH Private Key | `/home/user/.ssh/id_rsa` _(optional, alternativ zu Passwort)_ |

### 3. Inventory Import (bestehende Ansible-Hosts)

Wenn auf dem Server bereits eine Ansible-Inventory-Datei existiert, können alle darin enthaltenen Geräte mit einem Klick importiert werden:

1. Klicke **„📥 Inventory Import"**
2. Gib den absoluten Pfad zur Inventory-Datei ein, z.B.:
   - `/etc/ansible/hosts` (INI-Format)
   - `/opt/ansible/inventory/hosts.yml` (YAML-Format)
3. Klicke **„📥 Importieren"**

IP-Adresse, SSH-User und Passwort werden automatisch aus den Host-Variablen (`ansible_host`, `ansible_user`, `ansible_password`, `ansible_ssh_private_key_file`) übernommen. Das Switch-Modell ist standardmäßig `2530-24G` und kann danach per **✏️ Edit** angepasst werden.

### 4. VLANs benennen

Klicke auf den Tab **„VLAN Names"** um deinen VLANs aussagekräftige Namen zu geben:

- VLAN-ID + Name eintragen, z.B. `15` → `15_Crew`, `22` → `22_Media`
- Optional: **DHCP Bootp** pro VLAN aktivieren (`ip address dhcp-bootp`)
- Alle Namen werden beim nächsten Deploy / Bootstrap automatisch auf die Switches gepusht

### 5. Ports konfigurieren

In der Spreadsheet-Tabelle pro Port einstellen:

| Spalte | Beschreibung |
|--------|-------------|
| **☑** | Port aktivieren/deaktivieren (inaktive Ports werden nicht konfiguriert) |
| **Description** | Port-Beschreibung (z.B. `Uplink-Core`) |
| **Untagged VLAN** | Dropdown 1–299 |
| **Tagged VLANs** | Komma-/Bereichsnotation, z.B. `10,20-30,100` |
| **DHCP Trust** | `interface X dhcp-snooping trust` aktivieren |
| **⬆ Uplink** | Setzt Tagged VLANs auf `2-299` (alle benutzerdefinierten VLANs) |

→ Änderungen werden beim nächsten **🚀 Deploy** automatisch gespeichert.

### 6. Deploy-Buttons

| Button | Funktion |
|--------|----------|
| ⚡ **Bootstrap VLANs** | Erstellt VLANs + VLAN-Namen auf dem Switch (einmalig oder nach VLAN-Änderungen) |
| 🚀 **Deploy** | Pusht Port-VLAN-Konfiguration und Hostnamen auf den ausgewählten Switch |
| 🚀 **Deploy All** | Pusht auf alle registrierten Switches |
| 🏷️ **Hostname umbenennen** | Setzt den Switch-Hostnamen direkt per CLI |
| 📥 **Config Backup** | Lädt `show running-config` als `.cfg`-Datei herunter |
| 🧹 **VLANs löschen** | Entfernt benutzerdefinierte VLANs vom Switch (dynamisch, ohne Fehler bei nicht-existierenden IDs) |
| ⚙ **Generate Config** | Generiert Ansible-Dateien lokal (ohne Deploy, zum Prüfen) |

## Projektstruktur

```
aruba-vlan-manager/
├── app.py                          # Flask Backend (REST API)
├── setup.sh                        # Automatisches Setup-Script (systemd)
├── requirements.txt                # Python-Abhängigkeiten
├── templates/
│   └── index.html                  # Web UI
├── static/
│   ├── css/style.css               # Dark/Light Theme Styling
│   └── js/app.js                   # Frontend Logik
├── data/
│   ├── switches.json               # Switch-Daten (wird auto-erstellt)
│   ├── vlans.json                  # VLAN-Namen (wird auto-erstellt)
│   ├── backups/                    # Heruntergeladene running-configs
│   └── ssh_keys/                   # Hinterlegte SSH Private Keys
└── ansible/
    ├── inventory/
    │   ├── hosts.yml               # Auto-generiertes Inventory
    │   └── host_vars/              # Auto-generierte Host-Variablen
    ├── playbooks/
    │   ├── bootstrap_vlans.yml     # VLANs + Namen erstellen
    │   ├── configure_ports.yml     # Port-VLAN-Zuweisung pushen
    │   ├── remove_vlans.yml        # VLANs dynamisch entfernen
    │   ├── backup_config.yml       # running-config sichern
    │   └── set_hostname.yml        # Switch-Hostname setzen
    └── templates/
        ├── bootstrap_vlans.j2      # Jinja2: VLAN-Erstellung mit Namen
        └── port_config.j2          # Jinja2: Port-Konfiguration + Hostname
```

## API Endpunkte

| Methode | Endpunkt | Beschreibung |
|---------|----------|-------------|
| `GET` | `/api/switches` | Alle Switches auflisten |
| `POST` | `/api/switches` | Switch hinzufügen |
| `POST` | `/api/switches/import_inventory` | Switches aus Ansible-Inventory importieren |
| `PUT` | `/api/switches/<id>` | Switch bearbeiten |
| `DELETE` | `/api/switches/<id>` | Switch löschen |
| `PUT` | `/api/switches/<id>/ports` | Port-Konfiguration speichern |
| `POST` | `/api/switches/<id>/hostname` | Switch-Hostname setzen |
| `POST` | `/api/switches/<id>/backup` | Config-Backup herunterladen |
| `POST` | `/api/switches/<id>/remove_vlans` | VLANs vom Switch löschen |
| `GET`/`PUT` | `/api/vlans` | VLAN-Namen & Einstellungen |
| `POST` | `/api/generate` | Ansible-Dateien generieren |
| `POST` | `/api/deploy` | Deploy auf alle Switches |
| `POST` | `/api/deploy/<id>` | Deploy auf einen Switch |
| `POST` | `/api/bootstrap/<id>` | VLANs erstellen + Bootstrap |
| `GET` | `/api/deploy/status` | Letzter Deploy-Status |

## Switch-Vorbereitung

SSH muss auf den Aruba Switches aktiviert sein:

```
# Auf dem Switch (Konsole / seriell):
crypto key generate ssh rsa bits 2048
ip ssh
```

## Hinweise

- ⚠️ SSH-Passwörter werden in `data/switches.json` im Klartext gespeichert. Für Produktionsumgebungen SSH-Keys verwenden oder Ansible Vault einsetzen.
- Der Server läuft standardmäßig auf Port **5000**. Änderbar in `app.py` oder per systemd-Konfiguration.
- Die Datei `data/switches.json` und `data/vlans.json` werden automatisch beim ersten Start erstellt.
- Beim Inventory-Import wird das Modell standardmäßig auf `2530-24G` gesetzt — bitte nach dem Import per **✏️ Edit** anpassen.

## Lizenz

MIT
