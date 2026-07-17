/* ============================================
   Aruba VLAN Manager — Frontend Application
   ============================================ */

// --- State ---
let switches = [];
let activeSwitch = null;
let hasUnsavedChanges = false;
let deployLogExpanded = true;

// Pre-build a template <select> for VLAN 1-299 (cloned per port row for performance)
const vlanSelectTemplate = document.createElement('select');
vlanSelectTemplate.className = 'port-untagged';
for (let i = 1; i <= 299; i++) {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  vlanSelectTemplate.appendChild(opt);
}

// --- Init ---
document.addEventListener('DOMContentLoaded', init);

async function init() {
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
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
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

// --- Tabs ---
function renderTabs() {
  const container = document.getElementById('switch-tabs');
  const addBtn = document.getElementById('btn-add-switch');
  // Remove old tabs (keep the add button)
  container.querySelectorAll('.tab').forEach(t => t.remove());
  // Add tabs before the add button
  switches.forEach(sw => {
    const tab = document.createElement('button');
    tab.className = 'tab' + (sw.id === activeSwitch ? ' active' : '');
    tab.textContent = sw.name;
    tab.onclick = () => selectSwitch(sw.id);
    container.insertBefore(tab, addBtn);
  });
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
  if (taggedInput.value.trim() === '2-299') {
    // Toggle off
    taggedInput.value = '';
    btn.classList.remove('active');
  } else {
    taggedInput.value = '2-299';
    btn.classList.add('active');
  }
  markUnsaved();
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
async function savePorts() {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;

  const ports = [];
  for (const row of document.querySelectorAll('#port-grid-body tr')) {
    const port = parseInt(row.dataset.port);
    const name = row.querySelector('.port-name').value.trim();
    const untaggedVlan = parseInt(row.querySelector('.port-untagged').value);
    const taggedStr = row.querySelector('.port-tagged').value.trim();
    const taggedVlans = parseTaggedVlans(taggedStr);
    ports.push({ port, name, untagged_vlan: untaggedVlan, tagged_vlans: taggedVlans });
  }

  const btn = document.getElementById('btn-save');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Saving…';

  try {
    await apiCall('/api/switches/' + activeSwitch + '/ports', 'PUT', ports);
    sw.ports = ports;
    hasUnsavedChanges = false;
    hideSaveBar();
    showToast('Port configuration saved!', 'success');
  } catch (err) {
    showToast('Failed to save: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
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
  document.getElementById('form-ip').value = sw.ip;
  document.getElementById('form-model').value = sw.model;
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
    ip: document.getElementById('form-ip').value.trim(),
    model: document.getElementById('form-model').value,
    ssh_user: document.getElementById('form-user').value.trim(),
    ssh_password: document.getElementById('form-password').value,
    ssh_key_content: document.getElementById('form-ssh-key').value.trim(),
  };

  const btn = document.getElementById('form-submit-btn');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Saving…';

  try {
    if (isEdit) {
      await apiCall('/api/switches/' + switchId, 'PUT', payload);
      showToast('Switch updated!', 'success');
    } else {
      const created = await apiCall('/api/switches', 'POST', payload);
      showToast('Switch "' + created.name + '" added!', 'success');
    }
    closeSwitchModal();
    await fetchSwitches();
    renderTabs();

    if (isEdit) {
      selectSwitch(switchId);
    } else if (switches.length === 1) {
      selectSwitch(switches[0].id);
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
async function deployAll() {
  if (!confirm('Deploy port configuration to ALL switches?')) return;

  const btn = document.getElementById('btn-deploy-all');
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Deploying…';

  try {
    const res = await apiCall('/api/deploy', 'POST');
    showDeployLog(res.output || 'No output');
    if (res.status === 'success') {
      showToast('Deployment successful!', 'success');
    } else {
      showToast('Deployment finished with errors', 'error');
    }
  } catch (err) {
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

  try {
    const res = await apiCall('/api/deploy/' + activeSwitch, 'POST');
    showDeployLog(res.output || 'No output');
    if (res.status === 'success') {
      showToast('Deployed to ' + sw.name + '!', 'success');
    } else {
      showToast('Deploy finished with errors', 'error');
    }
  } catch (err) {
    showToast('Deploy failed: ' + err.message, 'error');
  }
}

async function bootstrapCurrentSwitch() {
  const sw = getSwitch(activeSwitch);
  if (!sw) return;
  if (!confirm('This will create VLANs 1-299 on "' + sw.name + '". Continue?')) return;

  try {
    showToast('Bootstrapping VLANs on ' + sw.name + '…', 'info');
    const res = await apiCall('/api/bootstrap/' + activeSwitch, 'POST');
    showDeployLog(res.output || 'No output');
    if (res.status === 'success') {
      showToast('VLANs bootstrapped on ' + sw.name + '!', 'success');
    } else {
      showToast('Bootstrap finished with errors', 'error');
    }
  } catch (err) {
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

    // Uplink button
    const tdUplink = document.createElement('td');
    const uplinkBtn = document.createElement('button');
    uplinkBtn.type = 'button';
    uplinkBtn.className = 'btn-uplink';
    uplinkBtn.textContent = '⬆ Uplink';
    uplinkBtn.onclick = function() { setUplink(tr); };
    tdUplink.appendChild(uplinkBtn);
    tr.appendChild(tdUplink);

    tbody.appendChild(tr);
  }
}

function genCollectPorts() {
  const ports = [];
  for (const row of document.querySelectorAll('#gen-grid-body tr')) {
    const port = parseInt(row.dataset.port);
    const name = row.querySelector('.port-name').value.trim();
    const untaggedVlan = parseInt(row.querySelector('.port-untagged').value);
    const taggedStr = row.querySelector('.port-tagged').value.trim();
    const taggedVlans = parseTaggedVlans(taggedStr);
    ports.push({ port, name, untagged_vlan: untaggedVlan, tagged_vlans: taggedVlans });
  }
  return ports;
}

async function createPlaybook() {
  const name = document.getElementById('gen-name').value.trim();
  const model = document.getElementById('gen-model').value;
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
    const res = await apiCall('/api/playbook/generate', 'POST', { name, model, ports });
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
    showDeployLog(res.output || 'No output');
    closeSSHKeysModal();
    if (res.status === 'success') {
      showToast('SSH Keys erfolgreich auf alle Switches deployed!', 'success');
    } else {
      showToast('Deploy mit Fehlern abgeschlossen.', 'error');
    }
  } catch (err) {
    showToast('Deploy fehlgeschlagen: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}
