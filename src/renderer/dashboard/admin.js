const loadingContainer = document.getElementById('loadingContainer');
const usersTable = document.getElementById('usersTable');
const usersTableBody = document.getElementById('usersTableBody');
const backBtn = document.getElementById('backBtn');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
const limitsModal = document.getElementById('limitsModal');
const modalUserName = document.getElementById('modalUserName');
const deepgramLimit = document.getElementById('deepgramLimit');
const agentLimit = document.getElementById('agentLimit');
const cancelLimitsBtn = document.getElementById('cancelLimitsBtn');
const saveLimitsBtn = document.getElementById('saveLimitsBtn');

let users = [];
let selectedUserId = null;

const HEX_24_REGEX = /^[a-f0-9]{24}$/i;
const HEX_24_ANYWHERE = /[a-f0-9]{24}/i;

function bytesToHex(bytes) {
  if (!bytes || !bytes.length) return '';
  return Array.from(bytes, b => Number(b).toString(16).padStart(2, '0')).join('');
}

function extractBytes(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  if (ArrayBuffer.isView(value)) return Array.from(value);
  if (value.type === 'Buffer' && Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.data)) return value.data;
  return null;
}

// Helper to normalize any Mongo _id to a 24-char hex string
function idToString(id) {
  if (!id) return '';

  if (typeof id === 'string') {
    return id.match(HEX_24_ANYWHERE)?.[0] || id;
  }

  if (typeof id === 'object') {
    if (id.$oid) return id.$oid;
    if (id.oid) return id.oid;
    if (id._id) return idToString(id._id);
    if (id.user_id) return idToString(id.user_id);
    if (id.id) return idToString(id.id);
    if (id.value) return idToString(id.value);

    if (id._bsontype === 'ObjectId' || id._bsontype === 'ObjectID') {
      const source = id.id || id.value || (typeof id.valueOf === 'function' ? id.valueOf() : null);
      const bytes = extractBytes(source);

      if (bytes && bytes.length) {
        return bytes.map(b => Number(b).toString(16).padStart(2, '0')).join('');
      }
    }

    const fromData = extractBytes(id);
    if (fromData) {
      const hex = bytesToHex(fromData);
      if (hex) return hex;
    }

    try {
      const serialized = JSON.stringify(id);
      const match = serialized?.match(HEX_24_ANYWHERE);
      if (match) return match[0];
    } catch (e) {
      // ignore
    }
  }

  if (typeof id.toHexString === 'function') return id.toHexString();

  if (typeof id.toString === 'function') {
    const str = id.toString();
    return str.match(HEX_24_ANYWHERE)?.[0] || str;
  }

  const fallback = String(id);
  return fallback.match(HEX_24_ANYWHERE)?.[0] || (fallback === '[object Object]' ? '' : fallback);
}

function isValidObjectId(id) {
  return typeof id === 'string' && HEX_24_REGEX.test(id);
}

function resolveUserId(userLike) {
  if (!userLike) return '';

  const candidates = [
    userLike._id,
    userLike.user_id,
    userLike.id,
    userLike?.access?.user_id,
    userLike?.access?._id
  ];

  for (const candidate of candidates) {
    const normalized = idToString(candidate);
    if (isValidObjectId(normalized)) {
      return normalized;
    }
  }

  const fallback = idToString(userLike);
  return isValidObjectId(fallback) ? fallback : '';
}

async function init() {
  try {
    // Check if user is admin
    const result = await window.electronAPI.auth.getCurrentUser();
    console.log('[Admin Panel] Current user data:', result);
    
    if (!result.success) {
      console.error('[Admin Panel] Failed to get current user:', result.error);
      showError('Failed to authenticate: ' + (result.error || 'Unknown error'));
      setTimeout(() => {
        window.electronAPI.dashboard.navigate('dashboard');
      }, 2000);
      return;
    }

    if (result.degraded?.reason === 'no-database') {
      showError('Database not connected. Admin panel requires MongoDB.');
      setTimeout(() => {
        window.electronAPI.dashboard.navigate('dashboard');
      }, 2000);
      return;
    }

    if (!result.user) {
      console.error('[Admin Panel] No user data found');
      showError('No user data found. Please log in again.');
      setTimeout(() => {
        window.electronAPI.auth.logout();
      }, 2000);
      return;
    }

    // Use profile.is_admin as the canonical source of truth
    const isAdmin = result.profile?.is_admin || false;
    console.log('[Admin Panel] User is admin:', isAdmin);

    if (!isAdmin) {
      console.error('[Admin Panel] User is not an admin');
      showError('Access denied: Admin privileges required');
      setTimeout(() => {
        window.electronAPI.dashboard.navigate('dashboard');
      }, 2000);
      return;
    }

    await loadUsers();
  } catch (error) {
    console.error('[Admin Panel] Initialization error:', error);
    showError('Failed to load users: ' + error.message);
  }
}

async function loadUsers() {
  try {
    loadingContainer.style.display = 'block';
    usersTable.style.display = 'none';

    const result = await window.electronAPI.admin.getAllUsers();

    if (!result.success) {
      showError(result.error || 'Failed to load users');
      return;
    }

    users = result.users;
    renderUsers();

    loadingContainer.style.display = 'none';
    usersTable.style.display = 'table';

  } catch (error) {
    console.error('Load users error:', error);
    showError('An error occurred while loading users');
    loadingContainer.style.display = 'none';
  }
}

function renderUsers() {
  usersTableBody.innerHTML = '';

  users.forEach(user => {
    const row = document.createElement('tr');

    const userId = resolveUserId(user);
    const hasValidId = isValidObjectId(userId);

    if (!hasValidId) {
      console.warn('[Admin Panel] Missing or invalid user id for user:', user);
    }

    const initials = user.user_name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);

    const isAdmin = user.is_admin;
    const rawPermission = user.access ? user.access.permission : false;
    const permission = typeof rawPermission === 'boolean'
      ? rawPermission
      : rawPermission === 'yes';
    const sttEnabled = user.access ? user.access.stt_enabled === true : false;
    const ttsEnabled = user.access ? user.access.tts_enabled === true : false;
    const deepgramTokens = user.deepgram || 0;
    const agentTokensCount = user.agent || 0;

    row.innerHTML = `
      <td>
        <div class="user-info">
          <div class="user-avatar">${initials}</div>
          <div class="user-details">
            <div class="user-name">${user.user_name}</div>
          </div>
        </div>
      </td>
      <td style="color: #4a5568; font-size: 13px;">${user.user_email}</td>
      <td>
        ${isAdmin ? '<span class="badge badge-admin">Admin</span>' : '<span class="badge badge-active">User</span>'}
      </td>
      <td>
        <button class="toggle-btn ${permission ? 'yes' : 'no'}" data-user-id="${userId}" data-current="${permission}" onclick="togglePermission(this)" ${!hasValidId ? 'disabled' : ''}>
          ${permission ? 'Approved' : 'Pending'}
        </button>
      </td>
      <td>
        <button class="toggle-btn ${sttEnabled ? 'yes' : 'no'}" data-user-id="${userId}" data-current="${sttEnabled}" onclick="toggleSTT(this)" ${!hasValidId ? 'disabled' : ''}>
          ${sttEnabled ? '✓ Enabled' : '✗ Disabled'}
        </button>
      </td>
      <td>
        <button class="toggle-btn ${ttsEnabled ? 'yes' : 'no'}" data-user-id="${userId}" data-current="${ttsEnabled}" onclick="toggleTTS(this)" ${!hasValidId ? 'disabled' : ''}>
          ${ttsEnabled ? '✓ Enabled' : '✗ Disabled'}
        </button>
      </td>
      <td>
        <div style="font-size: 12px;">
          <div>DG: ${formatNumber(deepgramTokens)}</div>
          <div>AG: ${formatNumber(agentTokensCount)}</div>
        </div>
      </td>
      <td>
        <button class="action-btn" onclick="openLimitsModal('${userId}', '${user.user_name}')" ${!hasValidId ? 'disabled' : ''}>
          Set Limits
        </button>
      </td>
    `;

    usersTableBody.appendChild(row);
  });
}

function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

async function togglePermission(button) {
  const userId = button.getAttribute('data-user-id');
  const currentPermission = button.getAttribute('data-current') === 'true';
  const newPermission = !currentPermission;

  if (!isValidObjectId(userId)) {
    console.error('[Admin] Invalid userId for permission toggle:', userId);
    showError('Invalid user id. Please reload and try again.');
    return;
  }

  button.disabled = true;

  try {
    const result = await window.electronAPI.admin.updateUserPermission(userId, newPermission);

    if (result.success) {
      button.setAttribute('data-current', newPermission);
      button.className = `toggle-btn ${newPermission ? 'yes' : 'no'}`;
      button.textContent = newPermission ? 'Approved' : 'Pending';
      showSuccess(`Permission ${newPermission ? 'granted' : 'revoked'} successfully`);
    } else {
      showError(result.error || 'Failed to update permission');
    }
  } catch (error) {
    console.error('Toggle permission error:', error);
    showError('An error occurred');
  } finally {
    button.disabled = false;
  }
}

async function toggleSTT(button) {
  const userId = button.getAttribute('data-user-id');
  const currentStatus = button.getAttribute('data-current') === 'true';
  const newStatus = !currentStatus;

  if (!isValidObjectId(userId)) {
    console.error('[Admin] Invalid userId for STT toggle:', userId);
    showError('Invalid user id. Please reload and try again.');
    return;
  }

  button.disabled = true;

  try {
    const result = await window.electronAPI.admin.updateUserActivation(userId, 'stt', newStatus);

    if (result.success) {
      button.setAttribute('data-current', newStatus);
      button.className = `toggle-btn ${newStatus ? 'yes' : 'no'}`;
      button.textContent = newStatus ? '✓ Enabled' : '✗ Disabled';
      showSuccess(`STT ${newStatus ? 'enabled' : 'disabled'} successfully`);
    } else {
      showError(result.error || 'Failed to update STT activation');
    }
  } catch (error) {
    console.error('Toggle STT error:', error);
    showError('An error occurred');
  } finally {
    button.disabled = false;
  }
}

async function toggleTTS(button) {
  const userId = button.getAttribute('data-user-id');
  const currentStatus = button.getAttribute('data-current') === 'true';
  const newStatus = !currentStatus;

  if (!isValidObjectId(userId)) {
    console.error('[Admin] Invalid userId for TTS toggle:', userId);
    showError('Invalid user id. Please reload and try again.');
    return;
  }

  button.disabled = true;

  try {
    const result = await window.electronAPI.admin.updateUserActivation(userId, 'tts', newStatus);

    if (result.success) {
      button.setAttribute('data-current', newStatus);
      button.className = `toggle-btn ${newStatus ? 'yes' : 'no'}`;
      button.textContent = newStatus ? '✓ Enabled' : '✗ Disabled';
      showSuccess(`TTS ${newStatus ? 'enabled' : 'disabled'} successfully`);
    } else {
      showError(result.error || 'Failed to update TTS activation');
    }
  } catch (error) {
    console.error('Toggle TTS error:', error);
    showError('An error occurred');
  } finally {
    button.disabled = false;
  }
}

function openLimitsModal(userId, userName) {
  selectedUserId = userId;
  modalUserName.textContent = userName;

  const user = users.find(u => idToString(u._id) === userId);
  if (user && user.limit) {
    const deepgramLimits = user.limit.deepgram_token_list || [];
    const agentLimits = user.limit.agent_token_list || [];

    deepgramLimit.value = deepgramLimits[0] || 10000;
    agentLimit.value = agentLimits[0] || 50000;
  } else {
    deepgramLimit.value = 10000;
    agentLimit.value = 50000;
  }

  limitsModal.classList.add('show');
}

function closeLimitsModal() {
  limitsModal.classList.remove('show');
  selectedUserId = null;
}

cancelLimitsBtn.addEventListener('click', closeLimitsModal);

saveLimitsBtn.addEventListener('click', async () => {
  if (!selectedUserId) return;

  const deepgramValue = parseInt(deepgramLimit.value) || 10000;
  const agentValue = parseInt(agentLimit.value) || 50000;

  const deepgramLimits = Array(31).fill(deepgramValue);
  const agentLimits = Array(31).fill(agentValue);

  saveLimitsBtn.disabled = true;

  try {
    const result = await window.electronAPI.admin.updateUserLimits(selectedUserId, deepgramLimits, agentLimits);

    if (result.success) {
      showSuccess('Token limits updated successfully');
      closeLimitsModal();
      await loadUsers();
    } else {
      showError(result.error || 'Failed to update limits');
    }
  } catch (error) {
    console.error('Update limits error:', error);
    showError('An error occurred');
  } finally {
    saveLimitsBtn.disabled = false;
  }
});

backBtn.addEventListener('click', async () => {
  await window.electronAPI.dashboard.navigate('dashboard');
});

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
  successMessage.classList.remove('show');
  setTimeout(() => errorMessage.classList.remove('show'), 5000);
}

function showSuccess(message) {
  successMessage.textContent = message;
  successMessage.classList.add('show');
  errorMessage.classList.remove('show');
  setTimeout(() => successMessage.classList.remove('show'), 3000);
}

window.togglePermission = togglePermission;
window.toggleSTT = toggleSTT;
window.toggleTTS = toggleTTS;
window.openLimitsModal = openLimitsModal;

init();
