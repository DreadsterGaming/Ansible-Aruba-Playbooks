/* ============================================
   Aruba VLAN Manager — Frontend Application
   ============================================ */

// --- State ---
let switches = [];
let activeSwitch = null;
let hasUnsavedChanges = false;
let deployLogExpanded = true;
let customVlanNames = {};
let _sidebarFilter = '';

// Pre-build a template <select> for VLAN 1-299 (cloned per port row for performance)
const vlanSelectTemplate = document.createElement('select');
vlanSelectTemplate.className = 'port-untagged';

function buildVlanSelectTemplate() {
  vlanSelectTemplate.innerHTML = '';
  for (let i = 1; i <= 299; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    const val = customVlanNames[i] || customVlanNames[String(i)];
    const cName = (val && typeof val === 'object') ? val.name : val;
    opt.textContent = cName ? `${i} (${cName})` : `${i}`;
    vlanSelectTemplate.appendChild(opt);
  }
}
buildVlanSelectTemplate();

// --- Theme Toggle ---
function initTheme() {
  const saved = localStorage.getItem('aruba_theme') || 'dark';
  if (saved === 'light') {
    document.body.classList.add('light-theme');
    const icon = document.getElementById('theme-icon');
    if (icon) icon.innerHTML = '🌙 Dark Mode';
  }
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  localStorage.setItem('aruba_theme', isLight ? 'light' : 'dark');
  const icon = document.getElementById('theme-icon');
  if (icon) icon.innerHTML = isLight ? '🌙 Dark Mode' : '🌞 Light Mode';
  showToast(isLight ? 'Light Mode aktiviert' : 'Dark Mode aktiviert', 'info');
}

// --- Init ---
document.addEventListener('DOMContentLoaded', init);

let switchStatus = {}; // { switch_id: 'online' | 'offline' | 'unknown' }

async function pollPingStatus() {
  try {
    const res = await fetch('/api/switches/ping');
    if (res.ok) {
      switchStatus = await res.json();
      updateStatusDotsOnly();
    }
  } catch (err) {
    console.error('Ping status error:', err);
  }
}

function updateStatusDotsOnly() {
  document.querySelectorAll('.sidebar-item').forEach(item => {
    const sid = item.dataset.id;
    const dot = item.querySelector('.status-dot');
    if (!dot || !sid) return;
    const sw = getSwitch(sid);
    const status = switchStatus[sid] || (sw ? switchStatus[sw.name] : '') || 'unknown';
    dot.className = status === 'online' ? 'status-dot online' :
                    status === 'offline' ? 'status-dot offline' : 'status-dot unknown';
  });
}

async function init() {
  initTheme();
  await fetchVlanNames(false);
  await fetchSwitches();
  renderTabs();
  if (switches.length > 0) {
    selectSwitch(switches[0].id);
  }
  // Event delegation for grid changes
  const gridBody = document.getElementById('port-grid-body');
  gridBody.addEventListener('change', onGridChange);
  gridBody.addEventListener('input', onGridInput);
  // Unsaved changes warning
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  // Ping all switches now, then every 30 seconds
  pollPingStatus();
  setInterval(pollPingStatus, 30000);
}

// --- API Helper ---
async function apiCall(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== null) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (_) {
    if (!res.ok) {
      const cleanMsg = text.replace(/<[^>]*>?/gm, '').trim();
      throw new Error(`Server Error ${res.status}: ${cleanMsg.substring(0, 120)}`);
    }
    throw new Error('Ungültiges Format vom Server empfangen');
  }
  if (!res.ok) {
    const errorMsg = data.error || (data.output ? "Ansible Playbook fehlgeschlagen" : `HTTP ${res.status}`);
    const err = new Error(errorMsg);
    err.data = data;
    throw err;
  }
  return data;
}

// --- Data ---
async function fetchSwitches() {
  try {
    switches = await apiCall('/api/switches');
  } catch (err) {
    showToast('Failed to load switches: ' + err.message, 'error');
    switches = [];
  }
}

function getSwitch(id) {
  return switches.find(s => s.id === id);
}

let selectedSwitchIds = new Set();

function toggleSelectSwitch(id, checked) {
  if (checked) {
    selectedSwitchIds.add(id);
  } else {
    selectedSwitchIds.delete(id);
  }
  updateSelectedCountUI();
}

function toggleSelectAllSwitches(checked) {
  const q = (_sidebarFilter || '').toLowerCase().trim();
  const visible = switches.filter(sw => {
    if (!sw) return false;
    const sName = String(sw.name || '').toLowerCase();
    const sIp = String(sw.ip || '').toLowerCase();
    const sHost = String(sw.hostname || '').toLowerCase();
    return !q || sName.includes(q) || sIp.includes(q) || sHost.includes(q);
  });

  visible.forEach(sw => {
    if (checked) {
      selectedSwitchIds.add(sw.id);
    } else {
      selectedSwitchIds.delete(sw.id);
    }
  });

  renderTabs();
  updateSelectedCountUI();
}

function updateSelectedCountUI() {
  const el = document.getElementById('selected-count');
  if (el) el.textContent = selectedSwitchIds.size;
  const masterCheck = document.getElementById('check-all-sidebar');
  if (masterCheck && switches.length > 0) {
    masterCheck.checked = selectedSwitchIds.size > 0 && switches.every(sw => selectedSwitchIds.has(sw.id));
  }
}

function renderTabs() {
  // Render into sidebar list instead of horizontal tabs
  const list = document.getElementById('sidebar-list');
  if (!list) return;
  list.innerHTML = '';

  const q = (_sidebarFilter || '').toLowerCase().trim();
  const visible = switches.filter(sw => {
    if (!sw) return false;
    const sName = String(sw.name || '').toLowerCase();
    const sIp = String(sw.ip || '').toLowerCase();
    const sHost = String(sw.hostname || '').toLowerCase();
    return !q || sName.includes(q) || sIp.includes(q) || sHost.includes(q);
  });

  const countEl = document.getElementById('sidebar-count');
  if (countEl) countEl.textContent = switches.length + ' Switch' + (switches.length !== 1 ? 'es' : '');

  visible.forEach(sw => {
    const status = switchStatus[sw.id] || switchStatus[sw.name] || 'unknown';
    const dotClass = status === 'online' ? 'status-dot online' :
                     status === 'offline' ? 'status-dot offline' : 'status-dot unknown';
    const isChecked = selectedSwitchIds.has(sw.id);
    const displayName = sw.name || sw.hostname || sw.ip || sw.id || 'Unbenannter Switch';
    const displayIp = sw.ip || '—';

    const item = document.createElement('button');
    item.className = 'sidebar-item' + (sw.id === activeSwitch ? ' active' : '');
    item.dataset.id = sw.id;
    item.innerHTML =
      '<span class="' + dotClass + '"></span>' +
      '<input type="checkbox" class="sidebar-switch-check"' + (isChecked ? ' checked' : '') + ' title="Diesen Switch zum Deployen markieren">' +
      '<div class="sidebar-item-info">' +
        '<span class="sidebar-item-name">' + displayName + '</span>' +
        '<span class="sidebar-item-ip">' + displayIp + '</span>' +
      '</div>';

    const chk = item.querySelector('.sidebar-switch-check');
    chk.onclick = (e) => {
      e.stopPropagation();
      toggleSelectSwitch(sw.id, chk.checked);
    };

    item.onclick = () => selectSwitch(sw.id);
    list.appendChild(item);
  });

  if (visible.length === 0 && q) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-no-results';
    empty.textContent = 'Kein Treffer für "' + q + '"';
    list.appendChild(empty);
  }

  updateSelectedCountUI();
  updateStatusDotsOnly();
}

function filterSidebarSwitches(value) {
  _sidebarFilter = value || '';
  renderTabs();
}

function selectSwitch(id) {
  if (hasUnsavedChanges) {
    if (!confirm('You have unsaved changes. Switch anyway?')) return;
    hasUnsavedChanges = false;
    hideSaveBar();
  }
  activeSwitch = id;
  renderTabs();
  renderSwitchInfo();
  renderPortGrid();
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('switch-info').classList.remove('hidden');
  document.getElementById('port-grid-container').classList.remove('hidden');
}

// --- Switch Info ---
function renderSwitchInfo() {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;
  document.getElementById('chip-ip').textContent = 'IP: ' + sw.ip;
  document.getElementById('chip-model').textContent = 'Model: ' + sw.model;
  document.getElementById('chip-ports').textContent = 'Ports: ' + sw.port_count;
  const hostElem = document.getElementById('chip-hostname');
  if (hostElem) hostElem.textContent = '🏷️ Hostname: ' + (sw.hostname || sw.name);
  const dhcpInput = document.getElementById('active-dhcp-vlan');
  if (dhcpInput) dhcpInput.value = sw.dhcp_vlan || '';
}

// --- VLAN Range Helpers ---
function parseTaggedVlans(str) {
  // Parse "2-299" or "10,20-30,100" into a flat array of VLAN IDs
  if (!str.trim()) return [];
  const vlans = [];
  for (const part of str.split(',')) {
    const trimmed = part.trim();
    const rangeParts = trimmed.split('-');
    if (rangeParts.length === 2) {
      const start = parseInt(rangeParts[0]);
      const end = parseInt(rangeParts[1]);
      if (!isNaN(start) && !isNaN(end) && start >= 1 && end <= 299) {
        for (let v = start; v <= end; v++) vlans.push(v);
      }
    } else {
      const v = parseInt(trimmed);
      if (!isNaN(v) && v >= 1 && v <= 299) vlans.push(v);
    }
  }
  return [...new Set(vlans)].sort((a, b) => a - b);
}

function compressVlanRange(vlans) {
  // Compress [2,3,4,5,10,11,12] into "2-5,10-12"
  if (!vlans || vlans.length === 0) return '';
  const sorted = [...new Set(vlans)].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? '' + start : start + '-' + end);
      start = end = sorted[i];
    }
  }
  ranges.push(start === end ? '' + start : start + '-' + end);
  return ranges.join(',');
}

function setUplink(row) {
  const taggedInput = row.querySelector('.port-tagged');
  const btn = row.querySelector('.btn-uplink');
  const cb = row.querySelector('.port-check');
  if (taggedInput.value.trim() === '2-299') {
    // Toggle off
    taggedInput.value = '';
    btn.classList.remove('active');
  } else {
    taggedInput.value = '2-299';
    btn.classList.add('active');
    // Auto-check the port when setting uplink
    if (cb && !cb.checked) {
      cb.checked = true;
      togglePortRow(row, true);
    }
  }
  markUnsaved();
}

function togglePortRow(row, enabled) {
  row.classList.toggle('port-disabled', !enabled);
  for (const input of row.querySelectorAll('input:not(.port-check), select')) {
    input.disabled = !enabled;
  }
  const uplinkBtn = row.querySelector('.btn-uplink');
  if (uplinkBtn) uplinkBtn.disabled = !enabled;
}

function toggleAllPorts(masterCb) {
  for (const row of document.querySelectorAll('#port-grid-body tr')) {
    const cb = row.querySelector('.port-check');
    if (cb) {
      cb.checked = masterCb.checked;
      togglePortRow(row, masterCb.checked);
    }
  }
  markUnsaved();
}

function toggleAllGenPorts(masterCb) {
  for (const row of document.querySelectorAll('#gen-grid-body tr')) {
    const cb = row.querySelector('.port-check');
    if (cb) {
      cb.checked = masterCb.checked;
      togglePortRow(row, masterCb.checked);
    }
  }
}

// --- Port Grid ---
function renderPortGrid() {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;
  const tbody = document.getElementById('port-grid-body');
  tbody.innerHTML = '';

  sw.ports.forEach(p => {
    const tr = document.createElement('tr');
    tr.dataset.port = p.port;

    // Detect if port has non-default config
    const isActive = (p.untagged_vlan && p.untagged_vlan !== 1)
      || (p.tagged_vlans && p.tagged_vlans.length > 0)
      || (p.name && p.name.trim() !== '')
      || Boolean(p.dhcp_snooping_trust);

    // Checkbox
    const tdCheck = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'port-check';
    cb.checked = isActive;
    cb.onchange = function() { togglePortRow(tr, cb.checked); markUnsaved(); };
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    // Port number
    const tdPort = document.createElement('td');
    tdPort.innerHTML = '<span class="port-number">' + p.port + '</span>';
    tr.appendChild(tdPort);

    // Description
    const tdName = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'port-name';
    nameInput.value = p.name || '';
    nameInput.placeholder = 'Port description…';
    tdName.appendChild(nameInput);
    tr.appendChild(tdName);

    // Untagged VLAN
    const tdUntagged = document.createElement('td');
    const untaggedSelect = vlanSelectTemplate.cloneNode(true);
    untaggedSelect.value = p.untagged_vlan || 1;
    tdUntagged.appendChild(untaggedSelect);
    tr.appendChild(tdUntagged);

    // Tagged VLANs (display compressed ranges)
    const tdTagged = document.createElement('td');
    const taggedInput = document.createElement('input');
    taggedInput.type = 'text';
    taggedInput.className = 'port-tagged tagged-input';
    taggedInput.value = compressVlanRange(p.tagged_vlans || []);
    taggedInput.placeholder = 'z.B. 10,20-30';
    tdTagged.appendChild(taggedInput);
    tr.appendChild(tdTagged);

    // DHCP Snooping Trust
    const tdTrust = document.createElement('td');
    tdTrust.style.textAlign = 'center';
    const trustCb = document.createElement('input');
    trustCb.type = 'checkbox';
    trustCb.className = 'port-trust';
    trustCb.title = 'interface ' + p.port + ' dhcp-snooping trust';
    trustCb.checked = Boolean(p.dhcp_snooping_trust);
    trustCb.onchange = onGridChange;
    tdTrust.appendChild(trustCb);
    tr.appendChild(tdTrust);

    // Uplink button
    const tdUplink = document.createElement('td');
    const uplinkBtn = document.createElement('button');
    uplinkBtn.type = 'button';
    uplinkBtn.className = 'btn-uplink';
    uplinkBtn.textContent = '⬆ Uplink';
    uplinkBtn.onclick = function() { setUplink(tr); };
    // Check if this port is already an uplink
    const tagged = p.tagged_vlans || [];
    if (tagged.length >= 290) uplinkBtn.classList.add('active');
    tdUplink.appendChild(uplinkBtn);
    tr.appendChild(tdUplink);

    // Disable row if not active
    if (!isActive) togglePortRow(tr, false);

    tbody.appendChild(tr);
  });
}

// --- Grid Events ---
function onGridChange(e) {
  markUnsaved();
}

function onGridInput(e) {
  markUnsaved();
}

function markUnsaved() {
  if (!hasUnsavedChanges) {
    hasUnsavedChanges = true;
    showSaveBar();
  }
}

function showSaveBar() {
  document.getElementById('save-bar').classList.remove('hidden');
}

function hideSaveBar() {
  document.getElementById('save-bar').classList.add('hidden');
}

// --- Save Ports ---
async function savePorts(silent = false) {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;

  const ports = [];
  for (const row of document.querySelectorAll('#port-grid-body tr')) {
    const port = parseInt(row.dataset.port);
    const cb = row.querySelector('.port-check');
    const name = row.querySelector('.port-name').value.trim();
    const untaggedVlan = parseInt(row.querySelector('.port-untagged').value);
    const taggedStr = row.querySelector('.port-tagged').value.trim();
    const taggedVlans = parseTaggedVlans(taggedStr);
    const dhcpTrust = row.querySelector('.port-trust') ? row.querySelector('.port-trust').checked : false;

    // Unchecked and default values = default port, won't generate CLI commands
    if (cb && !cb.checked && !name && untaggedVlan === 1 && taggedVlans.length === 0 && !dhcpTrust) {
      ports.push({ port, name: '', untagged_vlan: 1, tagged_vlans: [], dhcp_snooping_trust: false });
      continue;
    }

    // Auto-check if custom settings exist
    if (cb && !cb.checked && (name || untaggedVlan !== 1 || taggedVlans.length > 0 || dhcpTrust)) {
      cb.checked = true;
      togglePortRow(row, true);
    }

    ports.push({ port, name, untagged_vlan: untaggedVlan, tagged_vlans: taggedVlans, dhcp_snooping_trust: dhcpTrust });
  }

  const btn = document.getElementById('btn-save');
  const origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Saving…';
  }

  try {
    await apiCall('/api/switches/' + activeSwitch + '/ports', 'PUT', ports);
    sw.ports = ports;
    hasUnsavedChanges = false;
    hideSaveBar();
    if (!silent) showToast('Port configuration saved!', 'success');
  } catch (err) {
    showToast('Failed to save: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

// --- Switch Modal ---
function openAddSwitchModal() {
  document.getElementById('modal-title').textContent = 'Add Switch';
  document.getElementById('form-submit-btn').textContent = 'Add Switch';
  document.getElementById('form-switch-id').value = '';
  document.getElementById('switch-form').reset();
  // Reset model to default
  document.getElementById('form-model').value = '2530-24G';
  document.getElementById('form-hostname').value = '';
  document.getElementById('form-dhcp-vlan').value = '';
  // Hide SSH key status (no existing key for new switches)
  document.getElementById('ssh-key-status').classList.add('hidden');
  document.getElementById('form-ssh-key').value = '';
  document.getElementById('switch-modal').classList.remove('hidden');
}

function editCurrentSwitch() {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;
  document.getElementById('modal-title').textContent = 'Edit Switch';
  document.getElementById('form-submit-btn').textContent = 'Save Changes';
  document.getElementById('form-switch-id').value = sw.id;
  document.getElementById('form-name').value = sw.name;
  document.getElementById('form-hostname').value = sw.hostname || '';
  document.getElementById('form-ip').value = sw.ip;
  document.getElementById('form-model').value = sw.model;
  document.getElementById('form-dhcp-vlan').value = sw.dhcp_vlan || '';
  document.getElementById('form-user').value = sw.ssh_user;
  document.getElementById('form-password').value = sw.ssh_password || '';
  // Show SSH key status if a key is stored, but don't expose content
  document.getElementById('form-ssh-key').value = '';
  const keyStatus = document.getElementById('ssh-key-status');
  if (sw.ssh_key) {
    keyStatus.classList.remove('hidden');
  } else {
    keyStatus.classList.add('hidden');
  }
  document.getElementById('switch-modal').classList.remove('hidden');
}

function closeSwitchModal() {
  document.getElementById('switch-modal').classList.add('hidden');
  document.getElementById('switch-form').reset();
}

async function submitSwitchForm(event) {
  event.preventDefault();
  const switchId = document.getElementById('form-switch-id').value;
  const isEdit = !!switchId;

  const payload = {
    name: document.getElementById('form-name').value.trim(),
    hostname: document.getElementById('form-hostname').value.trim(),
    ip: document.getElementById('form-ip').value.trim(),
    model: document.getElementById('form-model').value,
    dhcp_vlan: document.getElementById('form-dhcp-vlan').value.trim(),
    ssh_user: document.getElementById('form-user').value.trim(),
    ssh_password: document.getElementById('form-password').value,
    ssh_key_content: document.getElementById('form-ssh-key').value.trim(),
  };

  const btn = document.getElementById('form-submit-btn');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Saving…';

  try {
    let targetId = switchId;
    if (isEdit) {
      const updated = await apiCall('/api/switches/' + switchId, 'PUT', payload);
      targetId = (updated && updated.id) ? updated.id : switchId;
      showToast('Switch updated!', 'success');
    } else {
      const created = await apiCall('/api/switches', 'POST', payload);
      targetId = created.id;
      showToast('Switch "' + created.name + '" added!', 'success');
    }
    closeSwitchModal();
    await fetchSwitches();
    renderTabs();
    if (targetId) {
      selectSwitch(targetId);
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

async function deleteCurrentSwitch() {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;
  if (!confirm('Delete switch "' + sw.name + '"? This cannot be undone.')) return;

  try {
    await apiCall('/api/switches/' + activeSwitch, 'DELETE');
    showToast('Switch "' + sw.name + '" deleted.', 'success');
    await fetchSwitches();
    hasUnsavedChanges = false;
    hideSaveBar();

    if (switches.length > 0) {
      activeSwitch = switches[0].id;
      renderTabs();
      selectSwitch(activeSwitch);
    } else {
      activeSwitch = null;
      renderTabs();
      document.getElementById('switch-info').classList.add('hidden');
      document.getElementById('port-grid-container').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');
    }
  } catch (err) {
    showToast('Failed to delete: ' + err.message, 'error');
  }
}

// --- Generate Config ---
async function generateConfig() {
  const btn = document.getElementById('btn-generate');
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Generating…';

  try {
    const res = await apiCall('/api/generate', 'POST');
    showToast(res.message || 'Config generated!', 'success');
  } catch (err) {
    showToast('Generate failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHTML;
  }
}

// --- Deploy ---
async function deploySelectedSwitches() {
  if (selectedSwitchIds.size === 0) {
    showToast('Bitte markiere mindestens einen Switch mit der Checkbox in der Seitenleiste.', 'error');
    return;
  }
  const count = selectedSwitchIds.size;
  if (!confirm(`Konfiguration auf ${count} ausgewählte(n) Switch(es) deployen?`)) return;

  const btn = document.getElementById('btn-deploy-selected');
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Deploying (' + count + ')…';

  showToast('⏳ Speichere aktive Konfiguration und starte Deploy auf ' + count + ' Switch(es)...', 'info');
  await savePorts(true);

  try {
    const response = await fetch('/api/deploy/selected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ switch_ids: Array.from(selectedSwitchIds) })
    });
    const res = await response.json();
    showDeployLog(res.output || res.error || 'No output');
    if (res.status === 'success') {
      showToast('Deploy auf ' + count + ' Switch(es) erfolgreich!', 'success');
    } else {
      showToast('Deploy beendet mit Fehlern', 'error');
    }
  } catch (err) {
    showDeployLog('Connection error: ' + err.message);
    showToast('Deploy failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHTML;
  }
}

async function deployCurrentSwitch() {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;
  if (!confirm('Deploy port configuration to "' + sw.name + '"?')) return;

  showToast('⏳ Speichere Konfiguration und starte Deploy...', 'info');
  await savePorts(true);

  try {
    const response = await fetch('/api/deploy/' + activeSwitch, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const res = await response.json();
    showDeployLog(res.output || res.error || 'No output');
    if (res.status === 'success') {
      showToast('Deployed to ' + sw.name + '!', 'success');
    } else {
      showToast('Deploy finished with errors', 'error');
    }
  } catch (err) {
    showDeployLog('Connection error: ' + err.message);
    showToast('Deploy failed: ' + err.message, 'error');
  }
}

async function bootstrapCurrentSwitch() {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;
  if (!confirm('This will create VLANs 1-299 on "' + sw.name + '". Continue?')) return;

  try {
    showToast('Bootstrapping VLANs on ' + sw.name + '…', 'info');
    const response = await fetch('/api/bootstrap/' + activeSwitch, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const res = await response.json();
    showDeployLog(res.output || res.error || 'No output');
    if (res.status === 'success') {
      showToast('VLANs bootstrapped on ' + sw.name + '!', 'success');
    } else {
      showToast('Bootstrap finished with errors', 'error');
    }
  } catch (err) {
    showDeployLog('Connection error: ' + err.message);
    showToast('Bootstrap failed: ' + err.message, 'error');
  }
}

// --- Deploy Log ---
function toggleDeployLog() {
  const log = document.getElementById('deploy-log');
  const toggle = document.getElementById('deploy-log-toggle');
  deployLogExpanded = !deployLogExpanded;
  if (deployLogExpanded) {
    log.classList.remove('collapsed');
    toggle.textContent = '▼';
  } else {
    log.classList.add('collapsed');
    toggle.textContent = '▲';
  }
}

function showDeployLog(output) {
  const log = document.getElementById('deploy-log');
  const content = document.getElementById('deploy-log-content');
  content.textContent = output;
  log.classList.remove('hidden');
  deployLogExpanded = true;
  log.classList.remove('collapsed');
  document.getElementById('deploy-log-toggle').textContent = '▼';
  // Scroll to bottom
  content.scrollTop = content.scrollHeight;
}

// --- Toast Notifications ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML =
    '<span class="toast-icon">' + (icons[type] || icons.info) + '</span>' +
    '<span>' + escapeHtml(message) + '</span>';

  container.appendChild(toast);

  // Auto-dismiss after 4s
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- Utility ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// Playbook Generator
// ============================================
const MODEL_PORTS = {
  '2530-8G': 8, '2530-8G-PoE+': 8,
  '2530-24G': 24, '2530-24G-PoE+': 24,
  '2530-48G': 48, '2530-48G-PoE+': 48,
  '2540-24G-PoE+': 24, '2540-48G-PoE+': 48,
  '2930F-8G-PoE+': 8, '2930F-24G-PoE+': 24, '2930F-48G-PoE+': 48,
};
let genLastResult = null; // stores last generated playbook data

function openGeneratorModal() {
  document.getElementById('generator-modal').classList.remove('hidden');
  document.getElementById('gen-step-config').classList.remove('hidden');
  document.getElementById('gen-step-output').classList.add('hidden');
  genLastResult = null;
  genBuildGrid();
}

function closeGeneratorModal() {
  document.getElementById('generator-modal').classList.add('hidden');
}

function genModelChanged() {
  genBuildGrid();
}

function genBuildGrid() {
  const model = document.getElementById('gen-model').value;
  const portCount = MODEL_PORTS[model] || 24;
  const tbody = document.getElementById('gen-grid-body');
  tbody.innerHTML = '';

  for (let i = 1; i <= portCount; i++) {
    const tr = document.createElement('tr');
    tr.dataset.port = i;

    // Checkbox (unchecked by default for generator)
    const tdCheck = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'port-check';
    cb.checked = false;
    cb.onchange = function() { togglePortRow(tr, cb.checked); };
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    // Port number
    const tdPort = document.createElement('td');
    tdPort.innerHTML = '<span class="port-number">' + i + '</span>';
    tr.appendChild(tdPort);

    // Description
    const tdName = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'port-name';
    nameInput.placeholder = 'Port description…';
    tdName.appendChild(nameInput);
    tr.appendChild(tdName);

    // Untagged VLAN
    const tdUntagged = document.createElement('td');
    const untaggedSelect = vlanSelectTemplate.cloneNode(true);
    untaggedSelect.value = 1;
    tdUntagged.appendChild(untaggedSelect);
    tr.appendChild(tdUntagged);

    // Tagged VLANs
    const tdTagged = document.createElement('td');
    const taggedInput = document.createElement('input');
    taggedInput.type = 'text';
    taggedInput.className = 'port-tagged tagged-input';
    taggedInput.placeholder = 'z.B. 10,20-30';
    tdTagged.appendChild(taggedInput);
    tr.appendChild(tdTagged);

    // DHCP Snooping Trust
    const tdTrust = document.createElement('td');
    tdTrust.style.textAlign = 'center';
    const trustCb = document.createElement('input');
    trustCb.type = 'checkbox';
    trustCb.className = 'port-trust';
    trustCb.title = 'interface ' + i + ' dhcp-snooping trust';
    tdTrust.appendChild(trustCb);
    tr.appendChild(tdTrust);

    // Uplink button
    const tdUplink = document.createElement('td');
    const uplinkBtn = document.createElement('button');
    uplinkBtn.type = 'button';
    uplinkBtn.className = 'btn-uplink';
    uplinkBtn.textContent = '⬆ Uplink';
    uplinkBtn.onclick = function() { setUplink(tr); };
    tdUplink.appendChild(uplinkBtn);
    tr.appendChild(tdUplink);

    // Start disabled
    togglePortRow(tr, false);

    tbody.appendChild(tr);
  }
}

function genCollectPorts() {
  const ports = [];
  for (const row of document.querySelectorAll('#gen-grid-body tr')) {
    const port = parseInt(row.dataset.port);
    const cb = row.querySelector('.port-check');
    if (cb && !cb.checked) {
      ports.push({ port, name: '', untagged_vlan: 1, tagged_vlans: [], dhcp_snooping_trust: false });
      continue;
    }
    const name = row.querySelector('.port-name').value.trim();
    const untaggedVlan = parseInt(row.querySelector('.port-untagged').value);
    const taggedStr = row.querySelector('.port-tagged').value.trim();
    const taggedVlans = parseTaggedVlans(taggedStr);
    const dhcpTrust = row.querySelector('.port-trust') ? row.querySelector('.port-trust').checked : false;
    ports.push({ port, name, untagged_vlan: untaggedVlan, tagged_vlans: taggedVlans, dhcp_snooping_trust: dhcpTrust });
  }
  return ports;
}

async function createPlaybook() {
  const name = document.getElementById('gen-name').value.trim();
  const model = document.getElementById('gen-model').value;
  const dhcp_vlan = document.getElementById('gen-dhcp-vlan').value.trim();
  const ports = genCollectPorts();

  if (!name) {
    showToast('Bitte einen Switch-Namen eingeben.', 'error');
    return;
  }

  const btn = document.getElementById('btn-gen-create');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Generiere…';

  try {
    const res = await apiCall('/api/playbook/generate', 'POST', { name, model, dhcp_vlan, ports });
    genLastResult = res;

    // Show output
    document.getElementById('gen-out-filename').textContent = '📄 ' + res.filename;
    document.getElementById('gen-output-code').textContent = res.playbook;
    document.getElementById('gen-step-config').classList.add('hidden');
    document.getElementById('gen-step-output').classList.remove('hidden');

    showToast('Playbook "' + res.filename + '" erstellt!', 'success');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function genBackToConfig() {
  document.getElementById('gen-step-config').classList.remove('hidden');
  document.getElementById('gen-step-output').classList.add('hidden');
}

function copyPlaybook() {
  if (!genLastResult) return;
  navigator.clipboard.writeText(genLastResult.playbook).then(() => {
    showToast('Playbook in Zwischenablage kopiert!', 'success');
  }).catch(() => {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = genLastResult.playbook;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Playbook kopiert!', 'success');
  });
}

function downloadPlaybook() {
  if (!genLastResult) return;
  window.open('/api/playbook/download/' + encodeURIComponent(genLastResult.filename));
}

// ============================================
// SSH Public Key Management
// ============================================
let sshKeys = [];

async function openSSHKeysModal() {
  document.getElementById('ssh-keys-modal').classList.remove('hidden');
  await fetchSSHKeys();
}

function closeSSHKeysModal() {
  document.getElementById('ssh-keys-modal').classList.add('hidden');
}

async function fetchSSHKeys() {
  try {
    sshKeys = await apiCall('/api/ssh-keys', 'GET');
    renderSSHKeys();
  } catch (err) {
    showToast('Fehler beim Laden der SSH Keys: ' + err.message, 'error');
  }
}

function renderSSHKeys() {
  const list = document.getElementById('ssh-keys-list');
  if (sshKeys.length === 0) {
    list.innerHTML = '<div class="ssh-keys-empty">Noch keine SSH Keys hinterlegt.</div>';
    return;
  }
  list.innerHTML = '';
  sshKeys.forEach(key => {
    const card = document.createElement('div');
    card.className = 'ssh-key-card';
    const keyPreview = key.public_key.substring(0, 30) + '…';
    card.innerHTML =
      '<div class="ssh-key-info">' +
        '<strong>' + escapeHtml(key.name) + '</strong>' +
        '<span class="ssh-key-level">' + key.access_level + '</span>' +
        '<span class="ssh-key-type">' + key.key_type + '</span>' +
        (key.comment ? '<span class="ssh-key-comment">' + escapeHtml(key.comment) + '</span>' : '') +
        '<code class="ssh-key-preview">' + keyPreview + '</code>' +
      '</div>' +
      '<button class="btn btn-sm btn-danger" onclick="deleteSSHKey(\'' + key.id + '\')">🗑️</button>';
    list.appendChild(card);
  });
}

async function addSSHKey() {
  const name = document.getElementById('sshkey-name').value.trim();
  const publicKey = document.getElementById('sshkey-key').value.trim();
  const accessLevel = document.getElementById('sshkey-level').value;

  if (!name) { showToast('Bitte einen Namen eingeben.', 'error'); return; }
  if (!publicKey) { showToast('Bitte einen Public Key eingeben.', 'error'); return; }

  try {
    await apiCall('/api/ssh-keys', 'POST', {
      name, public_key: publicKey, access_level: accessLevel,
    });
    showToast('SSH Key "' + name + '" hinzugefügt!', 'success');
    document.getElementById('sshkey-name').value = '';
    document.getElementById('sshkey-key').value = '';
    await fetchSSHKeys();
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function deleteSSHKey(keyId) {
  if (!confirm('SSH Key wirklich löschen?')) return;
  try {
    await apiCall('/api/ssh-keys/' + keyId, 'DELETE');
    showToast('SSH Key gelöscht.', 'success');
    await fetchSSHKeys();
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function deploySSHKeys() {
  if (sshKeys.length === 0) {
    showToast('Keine SSH Keys zum Deployen vorhanden.', 'error');
    return;
  }
  if (!confirm('SSH Keys auf ALLE registrierten Switches deployen?')) return;

  const btn = document.getElementById('btn-deploy-keys');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Deploying…';

  try {
    const res = await apiCall('/api/ssh-keys/deploy', 'POST');
    if (res.status === 'failed' || res.status === 'error') {
      throw { message: 'Ansible Playbook fehlgeschlagen', data: res };
    }
    showDeployLog(res.output || 'No output');
    closeSSHKeysModal();
    showToast('SSH Keys erfolgreich auf alle Switches deployed!', 'success');
  } catch (err) {
    showToast('Deploy fehlgeschlagen: ' + err.message, 'error');
    if (err.data && err.data.output) {
      showDeployLog(err.data.output);
    } else if (err.data) {
      showDeployLog(JSON.stringify(err.data, null, 2));
    }
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

/* ============================================
   VLAN Names Management
   ============================================ */
async function fetchVlanNames(reRender = true) {
  try {
    const res = await apiCall('/api/vlans', 'GET');
    customVlanNames = res || {};
    buildVlanSelectTemplate();
    if (reRender && activeSwitch && !hasUnsavedChanges) {
      renderPortGrid();
    }
  } catch (err) {
    console.error('Failed to fetch VLAN names:', err);
  }
}

function openVlanNamesModal() {
  renderVlanNamesTable();
  document.getElementById('vlan-names-modal').classList.remove('hidden');
  document.getElementById('vlan-id-input').focus();
}

function closeVlanNamesModal() {
  document.getElementById('vlan-names-modal').classList.add('hidden');
}

function renderVlanNamesTable() {
  const tbody = document.getElementById('vlan-names-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const ids = Object.keys(customVlanNames).map(id => parseInt(id)).filter(id => !isNaN(id)).sort((a, b) => a - b);
  if (ids.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" style="text-align:center; padding: 1.5rem; color: var(--text-muted);">Noch keine VLAN-Namen festgelegt. Füge unten deinen ersten eigenen Namen hinzu.</td>';
    tbody.appendChild(tr);
    return;
  }

  ids.forEach(id => {
    const val = customVlanNames[String(id)] || customVlanNames[id];
    const name = (val && typeof val === 'object') ? (val.name || '') : (val ? String(val) : '');
    const dhcpBootp = (val && typeof val === 'object') ? Boolean(val.dhcp_bootp) : false;
    const tr = document.createElement('tr');

    const tdId = document.createElement('td');
    tdId.innerHTML = `<strong style="color: var(--primary-color);">VLAN ${id}</strong>`;
    tr.appendChild(tdId);

    const tdName = document.createElement('td');
    tdName.textContent = name;
    tdName.style.fontWeight = '500';
    tr.appendChild(tdName);

    const tdDhcp = document.createElement('td');
    tdDhcp.style.textAlign = 'center';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.style = 'width: 18px; height: 18px; cursor: pointer; accent-color: var(--accent-primary);';
    cb.checked = dhcpBootp;
    cb.title = 'ip address dhcp-bootp für VLAN ' + id + ' ein-/ausschalten';
    cb.onchange = (e) => toggleVlanDhcp(id, e.target.checked);
    tdDhcp.appendChild(cb);
    tr.appendChild(tdDhcp);

    const tdAction = document.createElement('td');
    tdAction.style.textAlign = 'center';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-xs btn-danger';
    delBtn.innerHTML = '🗑️';
    delBtn.title = 'VLAN-Name löschen';
    delBtn.onclick = () => deleteVlanName(id);
    tdAction.appendChild(delBtn);
    tr.appendChild(tdAction);

    tbody.appendChild(tr);
  });
}

async function toggleVlanDhcp(vid, isChecked) {
  const currentVal = customVlanNames[String(vid)] || customVlanNames[vid];
  const currentName = (currentVal && typeof currentVal === 'object') ? (currentVal.name || '') : (currentVal ? String(currentVal) : '');
  const updatedVlans = { ...customVlanNames, [String(vid)]: { name: currentName, dhcp_bootp: isChecked } };

  try {
    const res = await apiCall('/api/vlans', 'PUT', updatedVlans);
    customVlanNames = res.vlans || updatedVlans;
    buildVlanSelectTemplate();
    if (activeSwitch && !hasUnsavedChanges) {
      renderPortGrid();
    }
    showToast(`VLAN ${vid}: DHCP-BootP ${isChecked ? 'aktiviert' : 'deaktiviert'}!`, 'success');
  } catch (err) {
    showToast('Fehler beim Speichern der DHCP-BootP Einstellung: ' + err.message, 'error');
    renderVlanNamesTable();
  }
}

async function addOrUpdateVlanName() {
  const idInput = document.getElementById('vlan-id-input');
  const nameInput = document.getElementById('vlan-name-input');
  const dhcpInput = document.getElementById('vlan-dhcp-input');
  const vid = parseInt(idInput.value);
  const name = nameInput.value.trim();
  const dhcpBootp = dhcpInput ? dhcpInput.checked : false;

  if (isNaN(vid) || vid < 1 || vid > 299) {
    showToast('Bitte eine gültige VLAN-ID zwischen 1 und 299 eingeben.', 'error');
    idInput.focus();
    return;
  }
  if (!name) {
    showToast('Bitte einen Namen für das VLAN eingeben.', 'error');
    nameInput.focus();
    return;
  }

  const updatedVlans = { ...customVlanNames, [String(vid)]: { name: name, dhcp_bootp: dhcpBootp } };

  try {
    const res = await apiCall('/api/vlans', 'PUT', updatedVlans);
    customVlanNames = res.vlans || updatedVlans;
    buildVlanSelectTemplate();
    renderVlanNamesTable();
    if (activeSwitch && !hasUnsavedChanges) {
      renderPortGrid();
    }
    showToast(`VLAN ${vid} als "${name}" gespeichert!`, 'success');
    idInput.value = '';
    nameInput.value = '';
    if (dhcpInput) dhcpInput.checked = false;
    idInput.focus();
  } catch (err) {
    showToast('Fehler beim Speichern des VLAN-Namens: ' + err.message, 'error');
  }
}

async function deleteVlanName(vid) {
  const updatedVlans = { ...customVlanNames };
  delete updatedVlans[String(vid)];
  delete updatedVlans[vid];

  try {
    const res = await apiCall('/api/vlans', 'PUT', updatedVlans);
    customVlanNames = res.vlans || updatedVlans;
    buildVlanSelectTemplate();
    renderVlanNamesTable();
    if (activeSwitch && !hasUnsavedChanges) {
      renderPortGrid();
    }
    showToast(`VLAN ${vid}-Name gelöscht.`, 'success');
  } catch (err) {
    showToast('Fehler beim Löschen des VLAN-Namens: ' + err.message, 'error');
  }
}

// --- DHCP Client Management VLAN ---
async function onDhcpVlanChange(val) {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;
  try {
    const res = await apiCall('/api/switches/' + activeSwitch, 'PUT', { dhcp_vlan: val });
    sw.dhcp_vlan = res.dhcp_vlan;
    showToast(sw.dhcp_vlan ? (`DHCP Client (ip address dhcp-bootp) für VLAN ${sw.dhcp_vlan} konfiguriert`) : 'DHCP Client VLAN entfernt', 'success');
  } catch (err) {
    showToast('Fehler beim Speichern von DHCP Client VLAN: ' + err.message, 'error');
  }
}

// --- Remove VLANs from Switch ---
async function removeVlansFromSwitch() {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;
  const target = prompt(
    `Welche VLANs möchtest du vom Switch "${sw.name}" löschen?\n\nGib z. B. "2-299" für alle benutzerdefinierten VLANs ein oder einzelne IDs/Bereiche wie "15,22,30-44":`,
    "2-299"
  );
  if (target === null || !target.trim()) return;

  if (!confirm(`⚠️ ACHTUNG: Möchtest du wirklich VLAN(s) "${target}" vom Switch "${sw.name}" in Hardware entfernen?`)) return;

  showToast(`⏳ Lösche VLANs (${target}) auf Switch ${sw.name}...`, 'info');
  
  try {
    const res = await apiCall('/api/switches/' + activeSwitch + '/remove_vlans', 'POST', { target_vlans: target.trim() });
    if (res.status === 'failed' || res.status === 'error') {
      throw { message: 'Ansible Playbook fehlgeschlagen', data: res };
    }
    showDeployLog(res.output || JSON.stringify(res, null, 2));
    showToast(`VLANs (${target}) erfolgreich vom Switch entfernt!`, 'success');
  } catch (err) {
    showToast('Fehler beim Löschen der VLANs: ' + err.message, 'error');
    if (err.data && err.data.output) {
      showDeployLog(err.data.output);
    } else if (err.data) {
      showDeployLog(JSON.stringify(err.data, null, 2));
    }
  }
}

// --- Hostname & Config Backup ---
async function renameCurrentSwitchHostname() {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;
  const currentHost = sw.hostname || sw.name || '';
  const newHost = prompt('Neuer Hostname für den Switch (wird direkt via CLI am Switch gesetzt):', currentHost);
  if (newHost === null) return;
  const trimmed = newHost.trim();

  showToast('⏳ Setze Switch-Hostnamen auf "' + trimmed + '"...', 'info');
  try {
    const response = await fetch('/api/switches/' + activeSwitch + '/hostname', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname: trimmed })
    });
    const res = await response.json();
    if (response.ok && res.result && res.result.status === 'success') {
      showToast('✅ Hostname erfolgreich am Switch geändert!', 'success');
      showDeployLog(res.result.output || 'Hostname erfolgreich konfiguriert.');
      await fetchSwitches();
      renderSwitchInfo();
    } else {
      showToast('❌ Fehler beim Setzen des Hostnamens: ' + (res.error || (res.result ? res.result.output : 'Unbekannter Fehler')), 'error');
      if (res.result && res.result.output) showDeployLog(res.result.output);
    }
  } catch (err) {
    showToast('❌ Verbindungsfehler: ' + err.message, 'error');
  }
}

async function backupCurrentSwitchConfig() {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;
  if (!confirm('Komplette Konfiguration (show running-config) von "' + sw.name + '" abfragen und jetzt auf dein Gerät herunterladen?')) return;

  showToast('⏳ Ersetze / Frage running-config am Switch ab...', 'info');
  try {
    const response = await fetch('/api/switches/' + activeSwitch + '/backup', { method: 'POST' });
    const res = await response.json();
    if (response.ok && res.status === 'success' && res.config) {
      showToast('✅ Config empfangen, Download wird ausgeführt!', 'success');
      const blob = new Blob([res.config], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename || (sw.name + '_running_config.cfg');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showDeployLog('--- DOWNLOADED RUNNING-CONFIG (' + (res.filename || sw.name) + ') ---\n\n' + res.config);
    } else {
      showToast('❌ Fehler beim Herunterladen der Config: ' + (res.error || (res.output ? res.output : 'Problem am Server')), 'error');
      if (res.output) showDeployLog(res.output);
    }
  } catch (err) {
    showToast('❌ Verbindungsfehler: ' + err.message, 'error');
  }
}

// --- Inventory Import ---
function openImportInventoryModal() {
  document.getElementById('import-inv-path').value = '';
  const res = document.getElementById('import-inv-result');
  res.classList.add('hidden');
  res.innerHTML = '';
  document.getElementById('import-inv-btn').disabled = false;
  document.getElementById('import-inventory-modal').classList.remove('hidden');
}

function closeImportInventoryModal() {
  document.getElementById('import-inventory-modal').classList.add('hidden');
}

async function submitImportInventory() {
  const path = document.getElementById('import-inv-path').value.trim();
  if (!path) {
    showToast('Bitte einen Dateipfad eingeben.', 'error');
    return;
  }
  const btn = document.getElementById('import-inv-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Importiere…';

  const resBox = document.getElementById('import-inv-result');
  resBox.classList.add('hidden');
  resBox.innerHTML = '';

  try {
    const response = await fetch('/api/switches/import_inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const data = await response.json();

    if (!response.ok) {
      resBox.innerHTML = '<div class="import-error">❌ ' + (data.error || 'Unbekannter Fehler') + '</div>';
      resBox.classList.remove('hidden');
      showToast('Import fehlgeschlagen: ' + (data.error || 'Fehler'), 'error');
      return;
    }

    let html = '<div class="import-summary">';
    html += '<div class="import-stat">📊 <strong>' + data.total_found + '</strong> Hosts gefunden</div>';
    html += '<div class="import-stat import-ok">✅ <strong>' + data.total_imported + '</strong> neu importiert</div>';
    if (data.skipped && data.skipped.length) {
      html += '<div class="import-stat import-skip">⏭️ <strong>' + data.skipped.length + '</strong> bereits vorhanden: ' + data.skipped.join(', ') + '</div>';
    }
    if (data.failed && data.failed.length) {
      html += '<div class="import-stat import-fail">❌ <strong>' + data.failed.length + '</strong> fehlerhaft: ';
      html += data.failed.map(f => f.name + ' (' + f.reason + ')').join(', ');
      html += '</div>';
    }
    html += '</div>';
    resBox.innerHTML = html;
    resBox.classList.remove('hidden');

    if (data.total_imported > 0) {
      showToast('✅ ' + data.total_imported + ' Switch(es) aus Inventory importiert!', 'success');
      await fetchSwitches();
      renderTabs();
      closeImportInventoryModal();
    } else {
      showToast('Keine neuen Switches importiert.', 'info');
    }
  } catch (err) {
    resBox.innerHTML = '<div class="import-error">❌ Verbindungsfehler: ' + err.message + '</div>';
    resBox.classList.remove('hidden');
    showToast('❌ Verbindungsfehler: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '📥 Importieren';
  }
}

