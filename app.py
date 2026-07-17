"""
Aruba VLAN Manager — Flask Backend
===================================
REST API for managing Aruba switch port/VLAN configurations.
Generates Ansible inventory and triggers playbook deployments.
"""

import json
import os
import subprocess
import re
import threading
from datetime import datetime, timezone
from flask import Flask, request, jsonify, send_from_directory, render_template
from jinja2 import Environment, FileSystemLoader

# ---------------------------------------------------------------------------
# App configuration
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_FILE = os.path.join(DATA_DIR, "switches.json")
SSH_PUBLIC_KEYS_FILE = os.path.join(DATA_DIR, "ssh_public_keys.json")
ANSIBLE_DIR = os.path.join(BASE_DIR, "ansible")
INVENTORY_DIR = os.path.join(ANSIBLE_DIR, "inventory")
HOST_VARS_DIR = os.path.join(INVENTORY_DIR, "host_vars")
PLAYBOOKS_DIR = os.path.join(ANSIBLE_DIR, "playbooks")
SSH_KEYS_DIR = os.path.join(DATA_DIR, "ssh_keys")

app = Flask(__name__, template_folder="templates", static_folder="static")
app.json.sort_keys = False

# Thread lock for safe file I/O
_file_lock = threading.Lock()

# In-memory store for the last deployment result
_last_deploy: dict | None = None


# ---------------------------------------------------------------------------
# CORS middleware (no flask-cors dependency)
# ---------------------------------------------------------------------------
@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response


# ---------------------------------------------------------------------------
# Helpers — data persistence
# ---------------------------------------------------------------------------
def _ensure_dirs():
    """Create data / ansible directory trees if they don't exist."""
    for d in (DATA_DIR, SSH_KEYS_DIR, INVENTORY_DIR, HOST_VARS_DIR, PLAYBOOKS_DIR):
        os.makedirs(d, exist_ok=True)


def _load_switches() -> list[dict]:
    """Load the switches list from the JSON data file."""
    _ensure_dirs()
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r") as fh:
        data = json.load(fh)
    return data.get("switches", [])


def _save_switches(switches: list[dict]) -> None:
    """Persist the switches list to the JSON data file."""
    _ensure_dirs()
    with open(DATA_FILE, "w") as fh:
        json.dump({"switches": switches}, fh, indent=2)


# ---------------------------------------------------------------------------
# Helpers — switch utilities
# ---------------------------------------------------------------------------
MODEL_PORT_MAP: dict[str, int] = {
    "2530-8G": 8,
    "2530-8G-PoE+": 8,
    "2530-24G": 24,
    "2530-24G-PoE+": 24,
    "2530-48G": 48,
    "2530-48G-PoE+": 48,
    "2540-24G-PoE+": 24,
    "2540-48G-PoE+": 48,
    "2930F-8G-PoE+": 8,
    "2930F-24G-PoE+": 24,
    "2930F-48G-PoE+": 48,
}


def _slugify(name: str) -> str:
    """Convert a human-readable name to a URL-safe slug id."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


def _generate_ports(model: str) -> list[dict]:
    """Return a default ports array for the given switch model."""
    count = MODEL_PORT_MAP.get(model, 24)
    return [
        {
            "port": i,
            "name": "",
            "untagged_vlan": 1,
            "tagged_vlans": [],
        }
        for i in range(1, count + 1)
    ]


def _find_switch(switches: list[dict], switch_id: str) -> dict | None:
    """Look up a switch by its id. Returns None if not found."""
    for sw in switches:
        if sw["id"] == switch_id:
            return sw
    return None


def _save_ssh_key(switch_id: str, key_content: str) -> str:
    """Save an SSH private key to disk. Returns the file path.
    If a key already exists for this switch, it is only overwritten
    when new content is explicitly provided."""
    _ensure_dirs()
    key_path = os.path.join(SSH_KEYS_DIR, f"{switch_id}.pem")
    # Normalize line endings and ensure trailing newline
    key_content = key_content.strip() + "\n"
    with open(key_path, "w") as fh:
        fh.write(key_content)
    os.chmod(key_path, 0o600)  # SSH requires strict permissions
    return key_path


def _get_ssh_key_path(switch_id: str) -> str | None:
    """Return the key file path if one exists on disk, else None."""
    key_path = os.path.join(SSH_KEYS_DIR, f"{switch_id}.pem")
    return key_path if os.path.isfile(key_path) else None


# ---------------------------------------------------------------------------
# Helpers — YAML generation (manual, no pyyaml dependency)
# ---------------------------------------------------------------------------
def _yaml_quote(value: str) -> str:
    """Quote a YAML string value if it contains special characters."""
    if not value:
        return '""'
    needs_quoting = any(ch in value for ch in (":", "{", "}", "[", "]", ",", "&", "*", "#", "?", "|", "-", "<", ">", "=", "!", "%", "@", "\\", "'", '"'))
    if needs_quoting or value.strip() != value:
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def _generate_inventory_yaml(switches: list[dict]) -> str:
    """Build the Ansible hosts.yml inventory as a YAML string."""
    lines = [
        "all:",
        "  children:",
        "    aruba_switches:",
        "      hosts:",
    ]
    for sw in switches:
        lines.append(f"        {sw['name']}:")
        lines.append(f"          ansible_host: {sw['ip']}")
        lines.append(f"          ansible_network_os: arubanetworks.aos_switch.arubaoss")
        lines.append(f"          ansible_connection: network_cli")
        lines.append(f"          ansible_user: {_yaml_quote(sw['ssh_user'])}")
        ssh_key = sw.get('ssh_key', '').strip()
        ssh_password = sw.get('ssh_password', '').strip()
        if ssh_key:
            lines.append(f"          ansible_ssh_private_key_file: {_yaml_quote(ssh_key)}")
        elif ssh_password:
            lines.append(f"          ansible_password: {_yaml_quote(ssh_password)}")
        lines.append(f"          ansible_become: true")
        lines.append(f"          ansible_become_method: enable")
    return "\n".join(lines) + "\n"


def _generate_host_vars_yaml(switch: dict) -> str:
    """Build the host_vars YAML for a single switch's port configuration."""
    lines = ["ports:"]
    for p in switch.get("ports", []):
        lines.append(f"  - port: {p['port']}")
        lines.append(f"    name: {_yaml_quote(p.get('name', ''))}")
        lines.append(f"    untagged_vlan: {p['untagged_vlan']}")
        tagged = p.get("tagged_vlans", [])
        if tagged:
            tag_items = ", ".join(str(v) for v in tagged)
            lines.append(f"    tagged_vlans: [{tag_items}]")
        else:
            lines.append(f"    tagged_vlans: []")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Internal: generate + deploy logic (reused across endpoints)
# ---------------------------------------------------------------------------
def _do_generate() -> dict:
    """Generate all Ansible inventory and host_vars files. Returns a status dict."""
    with _file_lock:
        switches = _load_switches()

    _ensure_dirs()

    # Write inventory
    inventory_path = os.path.join(INVENTORY_DIR, "hosts.yml")
    with open(inventory_path, "w") as fh:
        fh.write(_generate_inventory_yaml(switches))

    # Clean stale host_vars files
    existing_vars = set(os.listdir(HOST_VARS_DIR)) if os.path.isdir(HOST_VARS_DIR) else set()
    expected_vars = {f"{sw['name']}.yml" for sw in switches}
    for stale in existing_vars - expected_vars:
        os.remove(os.path.join(HOST_VARS_DIR, stale))

    # Write per-switch host_vars
    for sw in switches:
        path = os.path.join(HOST_VARS_DIR, f"{sw['name']}.yml")
        with open(path, "w") as fh:
            fh.write(_generate_host_vars_yaml(sw))

    return {
        "status": "ok",
        "message": f"Generated inventory for {len(switches)} switch(es).",
    }


def _run_playbook(playbook: str, limit: str | None = None) -> dict:
    """Execute an ansible-playbook command and return captured output."""
    global _last_deploy

    # Ensure generated files are fresh
    _do_generate()

    inventory = os.path.join(INVENTORY_DIR, "hosts.yml")
    playbook_path = os.path.join(PLAYBOOKS_DIR, playbook)

    cmd = ["ansible-playbook", "-i", inventory, playbook_path]
    if limit:
        cmd.extend(["--limit", limit])

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            cwd=ANSIBLE_DIR,
        )
        output = result.stdout + result.stderr
        status = "success" if result.returncode == 0 else "failed"
    except FileNotFoundError:
        output = "Error: ansible-playbook command not found. Is Ansible installed?"
        status = "error"
    except subprocess.TimeoutExpired:
        output = "Error: Playbook execution timed out after 300 seconds."
        status = "error"
    except Exception as exc:
        output = f"Error running playbook: {exc}"
        status = "error"

    deploy_result = {
        "status": status,
        "output": output,
        "playbook": playbook,
        "limit": limit,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    _last_deploy = deploy_result
    return deploy_result


# ===================================================================
# API Routes
# ===================================================================

# --- UI -------------------------------------------------------------------
@app.route("/")
def index():
    """Serve the main web UI."""
    return render_template("index.html")


# --- Switch CRUD ----------------------------------------------------------
@app.route("/api/switches", methods=["GET"])
def get_switches():
    """Return all switches with their port configurations."""
    with _file_lock:
        switches = _load_switches()
    return jsonify(switches)


@app.route("/api/switches", methods=["POST"])
def create_switch():
    """
    Create a new switch.
    Body: {name, ip, model, ssh_user, ssh_password}
    Ports are auto-generated based on model.
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Request body is required."}), 400

    # Validate required fields
    required = ("name", "ip", "model", "ssh_user")
    missing = [f for f in required if not body.get(f)]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

    model = body["model"]
    if model not in MODEL_PORT_MAP:
        valid = ", ".join(MODEL_PORT_MAP.keys())
        return jsonify({"error": f"Invalid model '{model}'. Valid models: {valid}"}), 400

    switch_id = _slugify(body["name"])
    if not switch_id:
        return jsonify({"error": "Name produces an empty slug."}), 400

    with _file_lock:
        switches = _load_switches()

        # Ensure unique id
        if _find_switch(switches, switch_id):
            return jsonify({"error": f"A switch with id '{switch_id}' already exists."}), 409

        new_switch = {
            "id": switch_id,
            "name": body["name"],
            "ip": body["ip"],
            "model": model,
            "port_count": MODEL_PORT_MAP[model],
            "ssh_user": body["ssh_user"],
            "ssh_password": body.get("ssh_password", ""),
            "ssh_key": "",
            "ports": _generate_ports(model),
        }

        # Handle SSH key content — save to file if provided
        ssh_key_content = body.get("ssh_key_content", "").strip()
        if ssh_key_content:
            key_path = _save_ssh_key(switch_id, ssh_key_content)
            new_switch["ssh_key"] = key_path

        switches.append(new_switch)
        _save_switches(switches)

    return jsonify(new_switch), 201


@app.route("/api/switches/<switch_id>", methods=["PUT"])
def update_switch(switch_id: str):
    """
    Update switch metadata.
    Body: {name, ip, model, ssh_user, ssh_password}
    If the model changes, ports are regenerated to match.
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Request body is required."}), 400

    with _file_lock:
        switches = _load_switches()
        switch = _find_switch(switches, switch_id)
        if not switch:
            return jsonify({"error": f"Switch '{switch_id}' not found."}), 404

        # Apply updates
        old_model = switch["model"]
        for field in ("name", "ip", "model", "ssh_user", "ssh_password"):
            if field in body:
                switch[field] = body[field]

        # Handle SSH key content — only overwrite if new content provided
        ssh_key_content = body.get("ssh_key_content", "").strip()
        if ssh_key_content:
            key_path = _save_ssh_key(switch_id, ssh_key_content)
            switch["ssh_key"] = key_path
        # If no new key content, preserve existing key path

        new_model = switch["model"]
        if new_model not in MODEL_PORT_MAP:
            valid = ", ".join(MODEL_PORT_MAP.keys())
            return jsonify({"error": f"Invalid model '{new_model}'. Valid models: {valid}"}), 400

        # Regenerate ports when the model changes
        if new_model != old_model:
            switch["ports"] = _generate_ports(new_model)
            switch["port_count"] = MODEL_PORT_MAP[new_model]

        # Re-slug the id if name changed
        if "name" in body:
            new_id = _slugify(body["name"])
            if new_id != switch_id:
                if _find_switch(switches, new_id):
                    return jsonify({"error": f"A switch with id '{new_id}' already exists."}), 409
                switch["id"] = new_id

        _save_switches(switches)

    return jsonify(switch)


@app.route("/api/switches/<switch_id>", methods=["DELETE"])
def delete_switch(switch_id: str):
    """Delete a switch by its id."""
    with _file_lock:
        switches = _load_switches()
        original_len = len(switches)
        switches = [sw for sw in switches if sw["id"] != switch_id]
        if len(switches) == original_len:
            return jsonify({"error": f"Switch '{switch_id}' not found."}), 404
        _save_switches(switches)

    return jsonify({"status": "ok", "message": f"Switch '{switch_id}' deleted."})


# --- Port configuration --------------------------------------------------
@app.route("/api/switches/<switch_id>/ports", methods=["PUT"])
def update_ports(switch_id: str):
    """
    Bulk-update all ports for a switch.
    Body: [{port, name, mode, untagged_vlan, tagged_vlans}, ...]
    """
    body = request.get_json(silent=True)
    if not isinstance(body, list):
        return jsonify({"error": "Request body must be a JSON array of port objects."}), 400

    with _file_lock:
        switches = _load_switches()
        switch = _find_switch(switches, switch_id)
        if not switch:
            return jsonify({"error": f"Switch '{switch_id}' not found."}), 404

        # Validate each port entry
        validated_ports = []
        for entry in body:
            port_num = entry.get("port")
            if port_num is None:
                return jsonify({"error": "Each port object must include a 'port' number."}), 400

            tagged = entry.get("tagged_vlans", [])
            if not isinstance(tagged, list):
                return jsonify({"error": f"Port {port_num}: tagged_vlans must be a list."}), 400

            validated_ports.append({
                "port": int(port_num),
                "name": str(entry.get("name", "")),
                "untagged_vlan": int(entry.get("untagged_vlan", 1)),
                "tagged_vlans": [int(v) for v in tagged],
            })

        switch["ports"] = validated_ports
        _save_switches(switches)

    return jsonify(switch)


# --- Ansible generate / deploy --------------------------------------------
@app.route("/api/generate", methods=["POST"])
def generate():
    """Generate Ansible inventory and host_vars files from current switch data."""
    try:
        result = _do_generate()
        return jsonify(result)
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@app.route("/api/deploy", methods=["POST"])
def deploy_all():
    """Run the configure_ports playbook against all switches."""
    result = _run_playbook("configure_ports.yml")
    code = 200 if result["status"] == "success" else 500
    return jsonify(result), code


@app.route("/api/deploy/<switch_id>", methods=["POST"])
def deploy_single(switch_id: str):
    """Run the configure_ports playbook for a single switch."""
    with _file_lock:
        switches = _load_switches()
    switch = _find_switch(switches, switch_id)
    if not switch:
        return jsonify({"error": f"Switch '{switch_id}' not found."}), 404

    result = _run_playbook("configure_ports.yml", limit=switch["name"])
    code = 200 if result["status"] == "success" else 500
    return jsonify(result), code


@app.route("/api/bootstrap/<switch_id>", methods=["POST"])
def bootstrap(switch_id: str):
    """Run the bootstrap_vlans playbook for a single switch."""
    with _file_lock:
        switches = _load_switches()
    switch = _find_switch(switches, switch_id)
    if not switch:
        return jsonify({"error": f"Switch '{switch_id}' not found."}), 404

    result = _run_playbook("bootstrap_vlans.yml", limit=switch["name"])
    code = 200 if result["status"] == "success" else 500
    return jsonify(result), code


@app.route("/api/deploy/status", methods=["GET"])
def deploy_status():
    """Return the result of the most recent deployment run."""
    if _last_deploy is None:
        return jsonify({"status": "none", "message": "No deployments have been run yet."})
    return jsonify(_last_deploy)


# ---------------------------------------------------------------------------
# Playbook Generator (preview / test without real switch)
# ---------------------------------------------------------------------------
GENERATED_DIR = os.path.join(BASE_DIR, "generated_playbooks")

@app.route("/api/playbook/generate", methods=["POST"])
def generate_playbook_preview():
    """Generate a standalone Ansible playbook from a virtual switch configuration.
    No real switch registration required — purely for preview and testing."""
    data = request.get_json() or {}
    name = data.get("name", "test-switch").strip()
    model = data.get("model", "2530-24G")
    ports = data.get("ports", [])

    if not name:
        return jsonify({"error": "Switch name is required."}), 400
    if not ports:
        return jsonify({"error": "At least one port configuration is required."}), 400

    # Validate ports
    for p in ports:
        if not isinstance(p.get("port"), int):
            return jsonify({"error": f"Invalid port entry: {p}"}), 400
        p.setdefault("name", "")
        p.setdefault("untagged_vlan", 1)
        p.setdefault("tagged_vlans", [])

    # --- Render CLI commands from the Jinja2 template ---
    try:
        tpl_dir = os.path.join(ANSIBLE_DIR, "templates")
        env = Environment(loader=FileSystemLoader(tpl_dir))
        template = env.get_template("port_config.j2")
        cli_commands = template.render(ports=ports).strip()
    except Exception as exc:
        return jsonify({"error": f"Template rendering failed: {exc}"}), 500

    # --- Build a standalone playbook YAML ---
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

    # Build commands list for the playbook
    cmd_lines = [l.strip() for l in cli_commands.splitlines() if l.strip()]
    # Format as YAML list items (12 spaces indent for under commands:)
    commands_yaml = "\n".join(f"          - \"{line}\"" for line in ["configure terminal"] + cmd_lines + ["exit"])

    playbook_yaml = f"""---
# ============================================
# Aruba Port VLAN Configuration Playbook
# Generated: {timestamp}
# Switch: {name} ({model})
# ============================================
#
# Usage:
#   ansible-playbook -i inventory.yml {slug}_ports.yml
#
# Make sure your inventory contains the target switch with:
#   ansible_network_os: arubanetworks.aos_switch.arubaoss
#   ansible_connection: network_cli

- name: "Configure port VLANs on {name} ({model})"
  hosts: "{name}"
  gather_facts: false
  connection: network_cli
  collections:
    - arubanetworks.aos_switch

  vars:
    ansible_network_os: arubanetworks.aos_switch.arubaoss

  tasks:
    - name: Apply port VLAN configuration
      arubaoss_command:
        commands:
{commands_yaml}

    - name: Save running configuration
      arubaoss_command:
        commands:
          - write memory
      register: save_result

    - name: Show save result
      ansible.builtin.debug:
        var: save_result.stdout
"""

    # --- Save to file ---
    os.makedirs(GENERATED_DIR, exist_ok=True)
    filename = f"{slug}_ports.yml"
    filepath = os.path.join(GENERATED_DIR, filename)
    with open(filepath, "w") as f:
        f.write(playbook_yaml)

    return jsonify({
        "status": "ok",
        "filename": filename,
        "filepath": filepath,
        "playbook": playbook_yaml,
        "cli_commands": cli_commands,
    })


@app.route("/api/playbook/list", methods=["GET"])
def list_generated_playbooks():
    """List all previously generated playbook files."""
    os.makedirs(GENERATED_DIR, exist_ok=True)
    files = []
    for f in sorted(os.listdir(GENERATED_DIR)):
        if f.endswith(".yml") or f.endswith(".yaml"):
            fp = os.path.join(GENERATED_DIR, f)
            stat = os.stat(fp)
            files.append({
                "filename": f,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
            })
    return jsonify(files)


@app.route("/api/playbook/download/<filename>", methods=["GET"])
def download_playbook(filename):
    """Download a generated playbook file."""
    safe_name = os.path.basename(filename)
    return send_from_directory(GENERATED_DIR, safe_name, as_attachment=True)


# ---------------------------------------------------------------------------
# SSH Public Key Management (deploy keys TO switches for team access)
# ---------------------------------------------------------------------------
def _load_ssh_keys() -> list[dict]:
    """Load SSH public keys from the JSON data file."""
    if not os.path.exists(SSH_PUBLIC_KEYS_FILE):
        return []
    with open(SSH_PUBLIC_KEYS_FILE, "r") as fh:
        data = json.load(fh)
    return data.get("keys", [])


def _save_ssh_keys(keys: list[dict]) -> None:
    """Persist SSH public keys to the JSON data file."""
    _ensure_dirs()
    with open(SSH_PUBLIC_KEYS_FILE, "w") as fh:
        json.dump({"keys": keys}, fh, indent=2)


@app.route("/api/ssh-keys", methods=["GET"])
def get_ssh_keys():
    """Return all stored SSH public keys."""
    with _file_lock:
        keys = _load_ssh_keys()
    return jsonify(keys)


@app.route("/api/ssh-keys", methods=["POST"])
def add_ssh_key():
    """Add a new SSH public key.
    Body: {name, public_key, access_level, comment}"""
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Request body is required."}), 400

    name = body.get("name", "").strip()
    public_key_raw = body.get("public_key", "").strip()
    access_level = body.get("access_level", "manager")
    comment = body.get("comment", "").strip()

    if not name:
        return jsonify({"error": "Name is required."}), 400
    if not public_key_raw:
        return jsonify({"error": "Public key is required."}), 400
    if access_level not in ("manager", "operator"):
        return jsonify({"error": "access_level must be 'manager' or 'operator'."}), 400

    # Parse key: accept full "ssh-rsa AAAA... comment" or just the key data
    parts = public_key_raw.split()
    if len(parts) >= 2 and parts[0].startswith("ssh-"):
        key_type = parts[0]
        key_data = parts[1]
        if not comment and len(parts) >= 3:
            comment = " ".join(parts[2:])
    else:
        key_type = "ssh-rsa"
        key_data = parts[0]

    key_id = _slugify(name)
    if not key_id:
        return jsonify({"error": "Name produces an empty id."}), 400

    with _file_lock:
        keys = _load_ssh_keys()
        # Check for duplicate id
        if any(k["id"] == key_id for k in keys):
            return jsonify({"error": f"A key with id '{key_id}' already exists."}), 409

        new_key = {
            "id": key_id,
            "name": name,
            "key_type": key_type,
            "public_key": key_data,
            "access_level": access_level,
            "comment": comment,
        }
        keys.append(new_key)
        _save_ssh_keys(keys)

    return jsonify(new_key), 201


@app.route("/api/ssh-keys/<key_id>", methods=["DELETE"])
def delete_ssh_key(key_id: str):
    """Delete an SSH public key by its id."""
    with _file_lock:
        keys = _load_ssh_keys()
        original_len = len(keys)
        keys = [k for k in keys if k["id"] != key_id]
        if len(keys) == original_len:
            return jsonify({"error": f"Key '{key_id}' not found."}), 404
        _save_ssh_keys(keys)

    return jsonify({"status": "ok", "message": f"Key '{key_id}' deleted."})


@app.route("/api/ssh-keys/deploy", methods=["POST"])
def deploy_ssh_keys():
    """Deploy all SSH public keys to all switches via Ansible."""
    with _file_lock:
        keys = _load_ssh_keys()
        switches = _load_switches()

    if not keys:
        return jsonify({"error": "No SSH keys to deploy."}), 400
    if not switches:
        return jsonify({"error": "No switches registered."}), 400

    # Generate inventory first
    _do_generate()

    # Write SSH keys as extra vars file
    ssh_keys_vars = {"ssh_keys": keys}
    vars_path = os.path.join(INVENTORY_DIR, "ssh_keys_vars.json")
    with open(vars_path, "w") as fh:
        json.dump(ssh_keys_vars, fh)

    # Run the deploy_ssh_keys playbook with extra vars
    inventory = os.path.join(INVENTORY_DIR, "hosts.yml")
    playbook_path = os.path.join(PLAYBOOKS_DIR, "deploy_ssh_keys.yml")

    cmd = [
        "ansible-playbook",
        "-i", inventory,
        playbook_path,
        "--extra-vars", f"@{vars_path}",
    ]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=300, cwd=ANSIBLE_DIR,
        )
        output = result.stdout + result.stderr
        status = "success" if result.returncode == 0 else "failed"
    except FileNotFoundError:
        output = "Error: ansible-playbook not found. Is Ansible installed?"
        status = "error"
    except subprocess.TimeoutExpired:
        output = "Error: Playbook timed out after 300 seconds."
        status = "error"
    except Exception as exc:
        output = f"Error: {exc}"
        status = "error"

    global _last_deploy
    deploy_result = {
        "status": status,
        "output": output,
        "playbook": "deploy_ssh_keys.yml",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    _last_deploy = deploy_result
    code = 200 if status == "success" else 500
    return jsonify(deploy_result), code


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    _ensure_dirs()
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=5000, debug=debug_mode)
