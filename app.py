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

# ---------------------------------------------------------------------------
# App configuration
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_FILE = os.path.join(DATA_DIR, "switches.json")
ANSIBLE_DIR = os.path.join(BASE_DIR, "ansible")
INVENTORY_DIR = os.path.join(ANSIBLE_DIR, "inventory")
HOST_VARS_DIR = os.path.join(INVENTORY_DIR, "host_vars")
PLAYBOOKS_DIR = os.path.join(ANSIBLE_DIR, "playbooks")

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
    for d in (DATA_DIR, INVENTORY_DIR, HOST_VARS_DIR, PLAYBOOKS_DIR):
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
    "2530-24G": 24,
    "2530-48G": 48,
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
            "mode": "access",
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
        lines.append(f"          ansible_connection: ansible.netcommon.network_cli")
        lines.append(f"          ansible_user: {_yaml_quote(sw['ssh_user'])}")
        lines.append(f"          ansible_password: {_yaml_quote(sw['ssh_password'])}")
        lines.append(f"          ansible_become: true")
        lines.append(f"          ansible_become_method: enable")
    return "\n".join(lines) + "\n"


def _generate_host_vars_yaml(switch: dict) -> str:
    """Build the host_vars YAML for a single switch's port configuration."""
    lines = ["ports:"]
    for p in switch.get("ports", []):
        lines.append(f"  - port: {p['port']}")
        lines.append(f"    name: {_yaml_quote(p.get('name', ''))}")
        lines.append(f"    mode: {p['mode']}")
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
    required = ("name", "ip", "model", "ssh_user", "ssh_password")
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
            "ssh_password": body["ssh_password"],
            "ports": _generate_ports(model),
        }
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

            mode = entry.get("mode", "access")
            if mode not in ("access", "trunk"):
                return jsonify({"error": f"Port {port_num}: mode must be 'access' or 'trunk'."}), 400

            tagged = entry.get("tagged_vlans", [])
            if not isinstance(tagged, list):
                return jsonify({"error": f"Port {port_num}: tagged_vlans must be a list."}), 400

            validated_ports.append({
                "port": int(port_num),
                "name": str(entry.get("name", "")),
                "mode": mode,
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
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    _ensure_dirs()
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=5000, debug=debug_mode)
