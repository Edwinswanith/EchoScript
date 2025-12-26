const userName = document.getElementById('userName');
const statusBanner = document.getElementById('statusBanner');
const sttToggle = document.getElementById('sttToggle');
const ttsToggle = document.getElementById('ttsToggle');
const sttStatus = document.getElementById('sttStatus');
const ttsStatus = document.getElementById('ttsStatus');
const sttStatusText = document.getElementById('sttStatusText');
const ttsStatusText = document.getElementById('ttsStatusText');
const dashboardBtn = document.getElementById('dashboardBtn');
const logoutBtn = document.getElementById('logoutBtn');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');

let currentUser = null;
let currentAccess = null;

async function init() {
  try {
    const result = await window.electronAPI.auth.getCurrentUser();

    if (!result.success) {
      showError('Failed to load user data');
      return;
    }

    currentUser = result.user;
    currentAccess = result.access;

    userName.textContent = currentUser.user_email;

    if (result.degraded?.reason === 'no-database') {
      showError('Database not connected. Activation requires MongoDB.');
      sttToggle.disabled = true;
      ttsToggle.disabled = true;
      return;
    }

    updateUI();

  } catch (error) {
    console.error('Initialization error:', error);
    showError('Failed to initialize');
  }
}

function updateUI() {
  if (!currentAccess) {
    return;
  }

  const hasPermission = currentAccess.permission === 'yes';

  if (hasPermission) {
    statusBanner.textContent = 'Your account has been approved! You can now activate features.';
    statusBanner.classList.remove('pending');
    statusBanner.classList.add('approved');

    sttToggle.disabled = false;
    ttsToggle.disabled = false;
  } else {
    statusBanner.textContent = 'Your account is pending admin approval. Please wait for activation.';
    statusBanner.classList.add('pending');
    statusBanner.classList.remove('approved');

    sttToggle.disabled = true;
    ttsToggle.disabled = true;
  }

  sttToggle.checked = currentAccess.stt_enabled;
  ttsToggle.checked = currentAccess.tts_enabled;

  updateFeatureStatus('stt', currentAccess.stt_enabled);
  updateFeatureStatus('tts', currentAccess.tts_enabled);
}

function updateFeatureStatus(feature, enabled) {
  if (feature === 'stt') {
    if (enabled) {
      sttStatus.classList.add('active');
      sttStatusText.textContent = 'Active';
      sttStatusText.style.color = '#065f46';
    } else {
      sttStatus.classList.remove('active');
      sttStatusText.textContent = 'Inactive';
      sttStatusText.style.color = '#718096';
    }
  } else if (feature === 'tts') {
    if (enabled) {
      ttsStatus.classList.add('active');
      ttsStatusText.textContent = 'Active';
      ttsStatusText.style.color = '#065f46';
    } else {
      ttsStatus.classList.remove('active');
      ttsStatusText.textContent = 'Inactive';
      ttsStatusText.style.color = '#718096';
    }
  }
}

sttToggle.addEventListener('change', async (e) => {
  const enabled = e.target.checked;

  try {
    const result = await window.electronAPI.auth.updateActivation('stt', enabled);

    if (result.success) {
      currentAccess.stt_enabled = enabled;
      updateFeatureStatus('stt', enabled);
      showSuccess(`STT ${enabled ? 'activated' : 'deactivated'} successfully`);
    } else {
      showError(result.error || 'Failed to update activation');
      e.target.checked = !enabled;
    }
  } catch (error) {
    console.error('STT toggle error:', error);
    showError('An error occurred');
    e.target.checked = !enabled;
  }
});

ttsToggle.addEventListener('change', async (e) => {
  const enabled = e.target.checked;

  try {
    const result = await window.electronAPI.auth.updateActivation('tts', enabled);

    if (result.success) {
      currentAccess.tts_enabled = enabled;
      updateFeatureStatus('tts', enabled);
      showSuccess(`TTS ${enabled ? 'activated' : 'deactivated'} successfully`);
    } else {
      showError(result.error || 'Failed to update activation');
      e.target.checked = !enabled;
    }
  } catch (error) {
    console.error('TTS toggle error:', error);
    showError('An error occurred');
    e.target.checked = !enabled;
  }
});

dashboardBtn.addEventListener('click', async () => {
  await window.electronAPI.dashboard.navigate('dashboard');
});

logoutBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to logout?')) {
    await window.electronAPI.auth.logout();
  }
});

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
  successMessage.classList.remove('show');
  setTimeout(() => errorMessage.classList.remove('show'), 3000);
}

function showSuccess(message) {
  successMessage.textContent = message;
  successMessage.classList.add('show');
  errorMessage.classList.remove('show');
  setTimeout(() => successMessage.classList.remove('show'), 3000);
}

init();
