const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');
const deepgramTokens = document.getElementById('deepgramTokens');
const agentTokens = document.getElementById('agentTokens');
const sttBadge = document.getElementById('sttBadge');
const ttsBadge = document.getElementById('ttsBadge');
const activationNav = document.getElementById('activationNav');
const adminNav = document.getElementById('adminNav');
const logoutNav = document.getElementById('logoutNav');

let currentUser = null;
let currentProfile = null;

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

// Helper to normalize any Mongo _id to a 24-char hex string if possible
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

    // Handle ObjectId clones coming through IPC (may be plain objects with byte arrays)
    if (id._bsontype === 'ObjectId' || id._bsontype === 'ObjectID') {
      const source = id.id || id.value || (typeof id.valueOf === 'function' ? id.valueOf() : null);
      const bytes = extractBytes(source);

      if (bytes && bytes.length) {
        return bytes.map(b => Number(b).toString(16).padStart(2, '0')).join('');
      }
    }

    // Plain buffer-like shapes without _bsontype
    const fromData = extractBytes(id);
    if (fromData) {
      const hex = bytesToHex(fromData);
      if (hex) return hex;
    }

    // Last resort: search for a hex substring in the serialized object
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
    if (normalized) return normalized; // accept any non-empty id string
  }

  const fallback = idToString(userLike);
  return fallback || '';
}

async function init() {
  try {
    const result = await window.electronAPI.auth.getCurrentUser();

    if (!result.success) {
      console.error('Failed to load user data');
      return;
    }

    currentUser = result.user;
    currentProfile = result.profile;
    currentAccess = result.access;

    if (result.degraded?.reason === 'no-database') {
      showNotification('Database not connected. Showing limited dashboard.', 'warning');
    }

    console.log('[Dashboard] User data loaded:', {
      user: currentUser,
      profile: currentProfile,
      access: currentAccess
    });

    userName.textContent = currentProfile?.user_name || currentUser?.user_name || 'User';
    userEmail.textContent = currentProfile?.user_email || currentUser?.user_email || '';

    deepgramTokens.textContent = formatNumber(currentProfile?.deepgram || 0);
    agentTokens.textContent = formatNumber(currentProfile?.agent || 0);

    if (currentAccess) {
      updateFeatureBadge(sttBadge, currentAccess.stt_enabled);
      updateFeatureBadge(ttsBadge, currentAccess.tts_enabled);
    }

    // Use profile.is_admin as the single source of truth
    const isAdmin = currentProfile?.is_admin || false;
    console.log('[Dashboard] User is admin:', isAdmin);

    if (isAdmin) {
      adminNav.style.display = 'flex';
      // Sync currentUser with profile value for consistency
      currentUser.is_admin = true;
    } else {
      // Ensure admin nav is hidden for non-admins
      adminNav.style.display = 'none';
      currentUser.is_admin = false;
    }

    // Initialize WebSocket connection only if user is authenticated
    if (currentUser && currentProfile) {
      await initWebSocket();
    }

  } catch (error) {
    console.error('Initialization error:', error);
  }
}

async function initWebSocket() {
  try {
    console.log('[Dashboard] Initializing WebSocket connection...');

    // Get authentication token and server URL
    const tokenResult = await window.electronAPI.websocket.getToken();
    const urlResult = await window.electronAPI.websocket.getServerUrl();

    // Handle known failure reasons gracefully
    if (!tokenResult.success) {
      const reason = tokenResult.reason;
      if (reason === 'disabled') {
        console.log('[Dashboard] WebSocket is disabled in configuration - skipping initialization');
        return;
      } else if (reason === 'not-authenticated') {
        console.log('[Dashboard] User not authenticated - skipping WebSocket initialization');
        return;
      } else {
        console.warn('[Dashboard] Failed to get WebSocket token:', tokenResult.message);
        return;
      }
    }

    if (!urlResult.success) {
      const reason = urlResult.reason;
      if (reason === 'disabled') {
        console.log('[Dashboard] WebSocket is disabled in configuration - skipping initialization');
        return;
      } else {
        console.warn('[Dashboard] Failed to get WebSocket server URL:', urlResult.message);
        return;
      }
    }

    // Connect to WebSocket server
    await window.wsClient.connect(tokenResult.token, urlResult.url);

    // Subscribe to relevant event channels
    window.wsClient.subscribe([
      'profile:updated',
      'access:updated',
      'limit:updated',
      'token:usage'
    ]);

    // Setup event listeners
    setupWebSocketListeners();

    console.log('[Dashboard] WebSocket initialized successfully');
  } catch (error) {
    // Only log unexpected errors
    console.error('[Dashboard] Unexpected WebSocket initialization error:', error);
  }
}

function setupWebSocketListeners() {
  // Listen for profile updates
  window.wsClient.on('profile:updated', (data) => {
    console.log('[Dashboard] Profile updated:', data);
    if (data && data.userId === currentUser.user_id) {
      // Update profile display
      if (data.data) {
        currentProfile = data.data;
        deepgramTokens.textContent = formatNumber(data.data.deepgram || 0);
        agentTokens.textContent = formatNumber(data.data.agent || 0);
      }
    }
  });

  // Listen for access/activation updates
  window.wsClient.on('access:updated', (data) => {
    console.log('[Dashboard] Access updated:', data);
    if (data && data.userId === currentUser.user_id) {
      // Update feature badges in dashboard view
      if (data.data) {
        currentAccess = data.data;
        updateFeatureBadge(sttBadge, data.data.stt_enabled);
        updateFeatureBadge(ttsBadge, data.data.tts_enabled);

        // Update activation view if it's visible
        updateActivationUI();
      }
    }
  });

  // Listen for token usage updates
  window.wsClient.on('token:usage', async (data) => {
    console.log('[Dashboard] Token usage updated:', data);
    // Token usage updates are tracked in the profile
  });

  // Listen for connection status changes
  window.wsClient.on('connected', () => {
    console.log('[Dashboard] WebSocket connected');
    showNotification('Connected to real-time updates', 'success');
  });

  window.wsClient.on('disconnected', () => {
    console.log('[Dashboard] WebSocket disconnected');
    showNotification('Disconnected from real-time updates', 'warning');
  });

  window.wsClient.on('error', (error) => {
    console.error('[Dashboard] WebSocket error:', error);
  });

  window.wsClient.on('auth-failed', () => {
    console.error('[Dashboard] WebSocket authentication failed');
    showNotification('Real-time connection failed. Please refresh.', 'error');
  });
}

function showNotification(message, type = 'info') {
  // Simple notification system (can be enhanced with a toast library)
  const colors = {
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6'
  };

  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: white;
    padding: 16px;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    border-left: 4px solid ${colors[type]};
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
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

function updateFeatureBadge(badge, enabled) {
  if (enabled) {
    badge.textContent = 'Active';
    badge.classList.remove('inactive');
    badge.classList.add('active');
  } else {
    badge.textContent = 'Inactive';
    badge.classList.remove('active');
    badge.classList.add('inactive');
  }
}

// View switching
const dashboardView = document.getElementById('dashboardView');
const activationView = document.getElementById('activationView');
const adminView = document.getElementById('adminView');
const navItems = document.querySelectorAll('.nav-item');

// Activation view elements
const activationUserName = document.getElementById('activationUserName');
const activationUserEmail = document.getElementById('activationUserEmail');
const sttMicToggle = document.getElementById('sttMicToggle');
const sttMicStatus = document.getElementById('sttMicStatus');
const sttMicStatusText = document.getElementById('sttMicStatusText');
const ttsFeatureToggle = document.getElementById('ttsFeatureToggle');
const ttsActivationStatus = document.getElementById('ttsActivationStatus');
const ttsActivationStatusText = document.getElementById('ttsActivationStatusText');

let currentAccess = null;
let micActive = false;
let ttsActive = false;

function showView(viewName) {
  // Hide all views
  dashboardView.classList.remove('active');
  activationView.classList.remove('active');
  adminView.classList.remove('active');

  // Remove active class from all nav items
  navItems.forEach(item => item.classList.remove('active'));

  // Show requested view
  if (viewName === 'dashboard') {
    dashboardView.classList.add('active');
    navItems[0].classList.add('active'); // Dashboard nav item
  } else if (viewName === 'activation') {
    activationView.classList.add('active');
    activationNav.classList.add('active');
    // Update activation view with current user data
    if (currentUser && currentProfile) {
      activationUserName.textContent = currentProfile.user_name;
      activationUserEmail.textContent = currentProfile.user_email;
      updateActivationUI();
    }
  } else if (viewName === 'admin') {
    // Use profile.is_admin as the canonical source of truth
    const isAdmin = currentProfile?.is_admin || false;
    console.log('[Dashboard] Admin view access check - isAdmin:', isAdmin);

    if (!isAdmin) {
      console.error('[Dashboard] Access denied - user is not admin');
      showNotification('Access denied: Admin privileges required', 'error');
      // Redirect back to dashboard view
      showView('dashboard');
      return;
    }
    adminView.classList.add('active');
    adminNav.classList.add('active');
    loadAdminPanel();
  }
}

async function loadAdminPanel() {
  const adminContent = document.getElementById('adminContent');
  adminContent.innerHTML = '<p style="color: #718096; text-align: center; padding: 40px;">Loading users...</p>';

  try {
    const result = await window.electronAPI.admin.getAllUsers();
    if (result.success && result.users) {
      renderAdminTable(result.users);
    } else {
      adminContent.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 40px;">Failed to load users: ${result.error || 'Unknown error'}</p>`;
    }
  } catch (error) {
    console.error('Error loading admin panel:', error);
    adminContent.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 40px;">Error loading users</p>';
  }
}

function renderAdminTable(users) {
  const adminContent = document.getElementById('adminContent');

  let html = `
    <style>
      .admin-toggle-btn {
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.2s;
      }
      .admin-toggle-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .admin-toggle-btn.yes {
        background: #d1fae5;
        color: #065f46;
      }
      .admin-toggle-btn.yes:hover:not(:disabled) {
        background: #a7f3d0;
      }
      .admin-toggle-btn.no {
        background: #fee2e2;
        color: #991b1b;
      }
      .admin-toggle-btn.no:hover:not(:disabled) {
        background: #fecaca;
      }
    </style>
    <table style="width: 100%; border-collapse: collapse;">
      <thead style="background: #f7fafc;">
        <tr>
          <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #718096; text-transform: uppercase;">User</th>
          <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #718096; text-transform: uppercase;">Email</th>
          <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #718096; text-transform: uppercase;">Permission</th>
          <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #718096; text-transform: uppercase;">STT</th>
          <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #718096; text-transform: uppercase;">Tokens</th>
        </tr>
      </thead>
      <tbody>
  `;

  users.forEach(user => {
    const isUserAdmin = user.is_admin;
    const rawPermission = user.access ? user.access.permission : false;
    const permission = typeof rawPermission === 'boolean'
      ? rawPermission
      : rawPermission === 'yes';
    const sttEnabled = user.access ? user.access.stt_enabled === true : false;
    const ttsEnabled = user.access ? user.access.tts_enabled === true : false;

    const userId = resolveUserId(user);
    const hasValidId = !!userId;

    html += `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 16px 12px; font-weight: 500; color: #1a202c;">${user.user_name}${isUserAdmin ? ' <span style="font-size: 10px; color: #8b5cf6;">(Admin)</span>' : ''}</td>
        <td style="padding: 16px 12px; color: #4a5568;">${user.user_email}</td>
        <td style="padding: 16px 12px;">
          <button class="admin-toggle-btn ${permission ? 'yes' : 'no'}"
                  data-user-id="${userId}"
                  data-current="${permission}"
                  onclick="togglePermissionInDashboard(this)"
                  ${!hasValidId ? 'disabled' : ''}>
            ${permission ? 'Approved' : 'Pending'}
          </button>
        </td>
        <td style="padding: 16px 12px;">
          <button class="admin-toggle-btn ${sttEnabled ? 'yes' : 'no'}"
                  data-user-id="${userId}"
                  data-current="${sttEnabled}"
                  onclick="toggleSTTInDashboard(this)"
                  ${!hasValidId ? 'disabled' : ''}>
            ${sttEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </td>
        <td style="padding: 16px 12px; color: #4a5568; font-size: 12px;">
          <div>DG: ${formatNumber(user.deepgram || 0)}</div>
          <div>AG: ${formatNumber(user.agent || 0)}</div>
        </td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  adminContent.innerHTML = html;
}

function updateActivationUI() {
  if (!currentAccess) return;
}

function updateActivationFeatureStatus(dotElement, textElement, enabled) {
  if (enabled) {
    dotElement.classList.add('active');
    textElement.textContent = 'Active';
    textElement.style.color = '#065f46';
  } else {
    dotElement.classList.remove('active');
    textElement.textContent = 'Inactive';
    textElement.style.color = '#718096';
  }
}

activationNav.addEventListener('click', () => {
  showView('activation');
});

// Dashboard nav - first nav item
navItems[0].addEventListener('click', () => {
  showView('dashboard');
});

adminNav.addEventListener('click', () => {
  showView('admin');
});

logoutNav.addEventListener('click', async () => {
  if (confirm('Are you sure you want to logout?')) {
    await window.electronAPI.auth.logout();
  }
});

// Mic control helpers (no DB changes)
function setMicUI(on) {
  micActive = on;
  if (sttMicToggle) sttMicToggle.checked = on;
  if (sttMicStatus) {
    if (on) {
      sttMicStatus.classList.add('active');
    } else {
      sttMicStatus.classList.remove('active');
    }
  }
  if (sttMicStatusText) {
    sttMicStatusText.textContent = on ? 'Mic On' : 'Mic Off';
    sttMicStatusText.style.color = on ? '#065f46' : '#718096';
  }
}

async function startMic() {
  try {
    const result = await window.electronAPI.stt.start();
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to start microphone');
    }
    setMicUI(true);
    showNotification('Microphone enabled. You can speak now.', 'success');
  } catch (error) {
    console.error('[Dashboard] startMic error:', error);
    setMicUI(false);
    showNotification(error.message || 'Failed to start microphone', 'error');
  }
}

async function stopMic() {
  try {
    const result = await window.electronAPI.stt.stop();
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to stop microphone');
    }
    setMicUI(false);
    showNotification('Microphone disabled.', 'info');
  } catch (error) {
    console.error('[Dashboard] stopMic error:', error);
    setMicUI(false);
    showNotification(error.message || 'Failed to stop microphone', 'error');
  }
}

if (sttMicToggle) {
  sttMicToggle.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    if (enabled) {
      await startMic();
    } else {
      await stopMic();
    }
  });
}

// Initialize mic UI to off on load
setMicUI(false);

// TTS control helpers (no DB changes)
function setTTSUI(on) {
  ttsActive = on;
  if (ttsFeatureToggle) ttsFeatureToggle.checked = on;
  updateActivationFeatureStatus(ttsActivationStatus, ttsActivationStatusText, on);
}

async function enableTTS() {
  try {
    const result = await window.electronAPI.tts.setEnabled(true);
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to enable TTS');
    }
    setTTSUI(true);
    showNotification('TTS enabled. Press Ctrl+Alt+S to read selected text.', 'success');
  } catch (error) {
    console.error('[Dashboard] enableTTS error:', error);
    setTTSUI(false);
    showNotification(error.message || 'Failed to enable TTS', 'error');
  }
}

async function disableTTS() {
  try {
    const result = await window.electronAPI.tts.setEnabled(false);
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to disable TTS');
    }
    setTTSUI(false);
    showNotification('TTS disabled.', 'info');
  } catch (error) {
    console.error('[Dashboard] disableTTS error:', error);
    setTTSUI(false);
    showNotification(error.message || 'Failed to disable TTS', 'error');
  }
}

if (ttsFeatureToggle) {
  ttsFeatureToggle.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    if (enabled) {
      await enableTTS();
    } else {
      await disableTTS();
    }
  });
}

// Initialize TTS UI to off on load
setTTSUI(false);

// Admin panel toggle functions for in-dashboard admin view
async function togglePermissionInDashboard(button) {
  const userId = button.getAttribute('data-user-id');
  const currentPermission = button.getAttribute('data-current') === 'true';
  const newPermission = !currentPermission;

  if (!isValidObjectId(userId)) {
    console.error('[Dashboard] Invalid userId for permission toggle:', userId);
    showNotification('Invalid user id for this user. Please reload the dashboard.', 'error');
    return;
  }

  button.disabled = true;

  try {
    const result = await window.electronAPI.admin.updateUserPermission(userId, newPermission);

    if (result.success) {
      button.setAttribute('data-current', newPermission);
      button.className = `admin-toggle-btn ${newPermission ? 'yes' : 'no'}`;
      button.textContent = newPermission ? 'Approved' : 'Pending';
      showNotification(`Permission ${newPermission ? 'granted' : 'revoked'} successfully`, 'success');
    } else {
      showNotification(result.error || 'Failed to update permission', 'error');
    }
  } catch (error) {
    console.error('Toggle permission error:', error);
    showNotification('An error occurred', 'error');
  } finally {
    button.disabled = false;
  }
}

async function toggleSTTInDashboard(button) {
  const userId = button.getAttribute('data-user-id');
  const currentStatus = button.getAttribute('data-current') === 'true';
  const newStatus = !currentStatus;

  if (!isValidObjectId(userId)) {
    console.error('[Dashboard] Invalid userId for STT toggle:', userId);
    showNotification('Invalid user id for this user. Please reload the dashboard.', 'error');
    return;
  }

  button.disabled = true;

  try {
    const result = await window.electronAPI.admin.updateUserActivation(userId, 'stt', newStatus);

    if (result.success) {
      button.setAttribute('data-current', newStatus);
      button.className = `admin-toggle-btn ${newStatus ? 'yes' : 'no'}`;
      button.textContent = newStatus ? 'Enabled' : 'Disabled';
      showNotification(`STT ${newStatus ? 'enabled' : 'disabled'} successfully`, 'success');
    } else {
      showNotification(result.error || 'Failed to update STT activation', 'error');
    }
  } catch (error) {
    console.error('Toggle STT error:', error);
    showNotification('An error occurred', 'error');
  } finally {
    button.disabled = false;
  }
}

async function toggleTTSInDashboard(button) {
  // TTS temporarily hidden/disabled
}

// Expose functions globally so they can be called from inline onclick handlers
window.togglePermissionInDashboard = togglePermissionInDashboard;
window.toggleSTTInDashboard = toggleSTTInDashboard;
window.toggleTTSInDashboard = toggleTTSInDashboard;

init();
