const { ipcRenderer } = require('electron');

// DOM elements
const apiKeyInput = document.getElementById('apiKey');
const languageSelect = document.getElementById('language');
const modelSelect = document.getElementById('model');
const hotkeyInput = document.getElementById('hotkey');
const typingSpeedInput = document.getElementById('typingSpeed');
const voiceCommandsCheckbox = document.getElementById('voiceCommands');
const showFloatingUICheckbox = document.getElementById('showFloatingUI');
const punctuateCheckbox = document.getElementById('punctuate');
const autoLaunchCheckbox = document.getElementById('autoLaunch');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');
const messageDiv = document.getElementById('message');

// Load current configuration
async function loadConfig() {
    try {
        const config = await ipcRenderer.invoke('get-config');

        apiKeyInput.value = config.deepgramApiKey || '';
        languageSelect.value = config.language || 'en-US';
        modelSelect.value = config.deepgramModel || 'nova-2';
        hotkeyInput.value = config.hotkey || 'CommandOrControl+Shift+S';
        typingSpeedInput.value = config.typingSpeed || 50;
        voiceCommandsCheckbox.checked = config.voiceCommands !== false;
        showFloatingUICheckbox.checked = config.showFloatingUI !== false;
        punctuateCheckbox.checked = config.punctuate !== false;
        autoLaunchCheckbox.checked = config.autoLaunch === true;
    } catch (error) {
        console.error('Error loading config:', error);
        showMessage('Error loading settings', 'error');
    }
}

// Save configuration
async function saveConfig() {
    try {
        // Collect values
        const config = {
            deepgramApiKey: apiKeyInput.value.trim(),
            language: languageSelect.value,
            deepgramModel: modelSelect.value,
            hotkey: hotkeyInput.value,
            typingSpeed: parseInt(typingSpeedInput.value),
            voiceCommands: voiceCommandsCheckbox.checked,
            showFloatingUI: showFloatingUICheckbox.checked,
            punctuate: punctuateCheckbox.checked,
            autoLaunch: autoLaunchCheckbox.checked
        };

        // Validate
        if (!config.deepgramApiKey) {
            showMessage('Please enter a Deepgram API key', 'error');
            return;
        }

        if (config.typingSpeed < 0 || config.typingSpeed > 1000) {
            showMessage('Typing speed must be between 0 and 1000ms', 'error');
            return;
        }

        // Save each setting
        for (const [key, value] of Object.entries(config)) {
            await ipcRenderer.invoke('set-config', key, value);
        }

        // Validate configuration
        const validation = await ipcRenderer.invoke('validate-config');

        if (!validation.valid) {
            showMessage(`Validation errors: ${validation.errors.join(', ')}`, 'error');
            return;
        }

        showMessage('Settings saved successfully!', 'success');

        // Close window after 1.5 seconds
        setTimeout(() => {
            window.close();
        }, 1500);
    } catch (error) {
        console.error('Error saving config:', error);
        showMessage('Error saving settings', 'error');
    }
}

// Show message
function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';
}

// Event listeners
saveBtn.addEventListener('click', saveConfig);
cancelBtn.addEventListener('click', () => {
    window.close();
});

// Load config on startup
loadConfig();
