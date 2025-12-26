const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain } = require('electron');
const path = require('path');

// Modules
const ConfigManager = require('./modules/ConfigManager');
const SpeechRecognitionController = require('./modules/SpeechRecognitionController');
const AutoLauncher = require('./modules/AutoLauncher');
const TTSService = require('./modules/TTSService');
const IndicatorManager = require('./modules/IndicatorManager');
const mongoDBService = require('./modules/MongoDBService');
const authService = require('./modules/AuthService');
const dashboardManager = require('./modules/DashboardManager');
const tokenTracker = require('./modules/TokenTracker');
const webSocketServer = require('./modules/WebSocketServer');

// Global variables
let tray = null;
let configManager = null;
let speechController = null;
let autoLauncher = null;
let ttsService = null;
let indicatorManager = null;
let sttHandlersRegistered = false;
let cleanupInProgress = false;

function registerSttHandlers() {
    // Re-register safely (remove old handlers if any)
    ipcMain.removeHandler('stt:start');
    ipcMain.removeHandler('stt:stop');

    ipcMain.handle('stt:start', async () => {
        try {
            if (!speechController) {
                throw new Error('Speech controller not initialized');
            }
            await speechController.start();
            return { success: true };
        } catch (error) {
            console.error('[IPC] stt:start error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stt:stop', async () => {
        try {
            if (!speechController) {
                throw new Error('Speech controller not initialized');
            }
            await speechController.stop();
            return { success: true };
        } catch (error) {
            console.error('[IPC] stt:stop error:', error);
            return { success: false, error: error.message };
        }
    });

    sttHandlersRegistered = true;
}

function registerSttHandlersFallback() {
    // Register fallback handlers when API key is not configured
    ipcMain.removeHandler('stt:start');
    ipcMain.removeHandler('stt:stop');

    ipcMain.handle('stt:start', async () => {
        console.warn('[IPC] stt:start called but Groq API key not configured');
        return {
            success: false,
            error: 'Groq API key not configured. Please add groqApiKey to config.js to enable Speech-to-Text features.'
        };
    });

    ipcMain.handle('stt:stop', async () => {
        console.warn('[IPC] stt:stop called but Groq API key not configured');
        return {
            success: false,
            error: 'Groq API key not configured. Please add groqApiKey to config.js to enable Speech-to-Text features.'
        };
    });

    sttHandlersRegistered = true;
    console.log('[IPC] STT fallback handlers registered (API key not configured)');
}

function registerTtsHandlers() {
    // Re-register safely (remove old handlers if any)
    ipcMain.removeHandler('tts:setEnabled');

    ipcMain.handle('tts:setEnabled', async (_event, enabled) => {
        try {
            if (!ttsService) {
                throw new Error('TTS service not initialized');
            }

            // Update in-memory config
            const ttsConfig = configManager.getTTSSettings();
            ttsConfig.enabled = enabled;
            configManager.set('tts', ttsConfig);

            // Enable/disable the TTS service
            if (enabled) {
                ttsService.enable();
                // Register the global shortcut
                registerTTSShortcut();
            } else {
                ttsService.disable();
                // Unregister the TTS shortcut
                const ttsSettings = configManager.getTTSSettings();
                globalShortcut.unregister(ttsSettings.hotkey);
                console.log(`TTS shortcut unregistered: ${ttsSettings.hotkey}`);
            }

            // Update tray menu to reflect the new state
            updateTrayMenu();

            console.log(`TTS ${enabled ? 'enabled' : 'disabled'} from dashboard`);
            return { success: true };
        } catch (error) {
            console.error('[IPC] tts:setEnabled error:', error);
            return { success: false, error: error.message };
        }
    });
}

/**
 * Initialize application
 */
async function initializeApp() {
    console.log('Initializing application...');

    // Initialize configuration
    configManager = new ConfigManager();

    // Initialize MongoDB connection
    const mongoConfig = configManager.get('mongodb');
    if (mongoConfig && mongoConfig.connectionString && mongoConfig.databaseName) {
        try {
            await mongoDBService.connect(mongoConfig.connectionString, mongoConfig.databaseName, mongoConfig);
            console.log('MongoDB connected successfully');
        } catch (error) {
            console.error('Failed to connect to MongoDB:', error);
            console.warn('Application will continue without database features');
        }
    } else {
        console.warn('MongoDB configuration not found - database features disabled');
    }

    // Initialize Auth Service (always initialize so session handling is consistent)
    const oauthConfig = configManager.get('oauth') || {};
    const websocketConfig = configManager.get('websocket');

    authService.initialize({
        oauth: {
            clientId: oauthConfig.clientId,
            clientSecret: oauthConfig.clientSecret,
            redirectUri: oauthConfig.redirectUri || 'http://localhost'
        },
        websocket: websocketConfig
    });

    if (oauthConfig.clientId && oauthConfig.clientSecret) {
        console.log('Auth service initialized');
    } else {
        console.warn('OAuth configuration not found - authentication disabled');
    }

    // Initialize WebSocket Server (can run without MongoDB; DB-backed events will be disabled)
    let mongoToWebSocketForwarderAttached = false;

    const attachMongoToWebSocketForwarder = () => {
        if (mongoToWebSocketForwarderAttached) return;
        mongoToWebSocketForwarderAttached = true;

        // Forward MongoDB change events to WebSocket clients (only fires if change streams are active)
        mongoDBService.on('database:change', (changeEvent) => {
            if (!webSocketServer || !webSocketServer.wss) return;

            console.log('[Main] Broadcasting database change:', changeEvent.type);

            // Send to specific user if userId is present
            if (changeEvent.userId) {
                webSocketServer.sendToUser(changeEvent.userId, changeEvent);
            } else {
                // Broadcast to all admins
                webSocketServer.broadcastToAdmins(changeEvent);
            }
        });
    };

    const startMongoRealtimeUpdates = () => {
        if (!mongoDBService.isConnected) return;

        attachMongoToWebSocketForwarder();
        mongoDBService.watchChanges();
        console.log('MongoDB Change Streams connected to WebSocket');
    };

    if (websocketConfig?.enabled) {
        try {
            const config = configManager.config;
            webSocketServer.initialize(config, authService);
            console.log('WebSocket server initialized');

            // If DB is connected now, start DB-backed real-time updates; otherwise keep WS up in degraded mode.
            if (mongoDBService.isConnected) {
                startMongoRealtimeUpdates();
            } else {
                console.warn('MongoDB not connected - real-time database updates disabled (WebSocket server still running)');
            }

            // If MongoDB connects later (e.g. reconnect), enable DB-backed updates automatically.
            mongoDBService.on('connected', () => {
                startMongoRealtimeUpdates();
            });
        } catch (error) {
            console.error('Failed to initialize WebSocket server:', error);
            console.warn('Application will continue without real-time updates');
        }
    } else {
        console.log('WebSocket server disabled in configuration');
    }

    // Initialize Dashboard Manager
    dashboardManager.initialize();
    dashboardManager.setWebSocketServer(webSocketServer);

    // Initialize Token Tracker
    if (mongoDBService.isConnected) {
        tokenTracker.initialize();
        console.log('Token tracker initialized');
    }

    // Check if user is authenticated, show dashboard if not
    // Dashboard opens even if MongoDB is not connected (shows connection status)
    if (!authService.isUserAuthenticated()) {
        console.log('User not authenticated - opening dashboard');
        setTimeout(() => {
            try {
                dashboardManager.createWindow();
            } catch (error) {
                console.error('Failed to create dashboard window:', error);
                showNotification('Dashboard Error', 'Failed to open dashboard. Check console for details.');
            }
        }, 1000);
    }
    
    if (!mongoDBService.isConnected) {
        console.log('MongoDB not connected - authentication features disabled');
        console.log('Dashboard will open but authentication features will be unavailable');
    }

    // Initialize indicator manager (shared between STT and TTS)
    indicatorManager = new IndicatorManager(configManager);
    indicatorManager.createWindow();

    // Initialize auto-launcher
    autoLauncher = new AutoLauncher('EchoScripts Speech Typer');

    // Setup auto-launch based on config
    setupAutoLaunch();

    // Initialize speech recognition controller (share indicator manager)
    if (configManager.hasApiKey()) {
        speechController = new SpeechRecognitionController(configManager, indicatorManager);
        setupSpeechControllerEvents();
        if (!sttHandlersRegistered) {
            registerSttHandlers();
        }

        // Log CrewAI status
        logCrewAIStatus();
    } else {
        console.warn('Groq API key not configured for STT');
        // Register fallback handlers to prevent crashes
        if (!sttHandlersRegistered) {
            registerSttHandlersFallback();
        }
    }

    // Initialize TTS service
    if (configManager.get('elevenlabsApiKey')) {
        ttsService = new TTSService(configManager);
        setupTTSServiceEvents();
        registerTtsHandlers();
        console.log('TTS service initialized with ElevenLabs');
    } else {
        console.warn('ElevenLabs API key not configured for TTS');
    }

    // Create system tray
    createSystemTray();

    // Register global shortcuts
    registerGlobalShortcut();
    registerTTSShortcut();

    console.log('Application initialized');
}

/**
 * Create system tray icon and menu
 */
function createSystemTray() {
    // Create tray icon using nativeImage for PNG support
    const { nativeImage } = require('electron');
    const fs = require('fs');

    // Load icon.png from assets
    const iconPath = path.join(__dirname, '../../assets/icon.png');
    let icon = null;

    // Try to load icon from file
    if (fs.existsSync(iconPath)) {
        try {
            icon = nativeImage.createFromPath(iconPath);

            // If loading failed, try reading as buffer
            if (icon.isEmpty()) {
                const iconBuffer = fs.readFileSync(iconPath);
                icon = nativeImage.createFromBuffer(iconBuffer);
            }
        } catch (error) {
            console.error('Error loading tray icon:', error);
        }
    }

    // If icon still empty or null, create fallback
    if (!icon || icon.isEmpty()) {
        console.warn('Failed to load tray icon from:', iconPath);
        console.log('Creating tray with fallback icon');
        icon = nativeImage.createEmpty();
    } else {
        console.log('Tray icon loaded successfully');
    }

    tray = new Tray(icon);

    // Create context menu
    updateTrayMenu();

    tray.setToolTip('EchoScript');

    // Click handler
    tray.on('click', () => {
        toggleSpeechRecognition();
    });
}

/**
 * Update tray menu based on state
 */
function updateTrayMenu() {
    const isListening = speechController && speechController.getState() === 'listening';
    const apiKeyConfigured = configManager && configManager.hasApiKey();
    const ttsSettings = configManager ? configManager.getTTSSettings() : {};
    const ttsKeyConfigured = !!(configManager && configManager.get('elevenlabsApiKey'));
    const ttsHotkey = ttsSettings.hotkey || 'Ctrl+Shift+T';
    
    // Check CrewAI status
    const crewAIEnabled = speechController && speechController.crewAIAgent && speechController.crewAIAgent.isEnabled();
    const crewAIStatus = crewAIEnabled ? '✓ Enabled' : '✗ Disabled';

    const contextMenu = Menu.buildFromTemplate([
        {
            label: isListening ? 'Stop Listening (Ctrl+Shift+S)' : 'Start Listening (Ctrl+Shift+S)',
            click: toggleSpeechRecognition,
            enabled: apiKeyConfigured
        },
        {
            label: `Read Selected Text (${ttsHotkey})`,
            click: handleTTSTrigger,
            enabled: ttsKeyConfigured && ttsSettings.enabled !== false
        },
        { type: 'separator' },
        {
            label: `CrewAI: ${crewAIStatus}`,
            enabled: false
        },
        { type: 'separator' },
        {
            label: 'Dashboard',
            click: () => {
                try {
                    dashboardManager.createWindow();
                } catch (error) {
                    console.error('Failed to open dashboard:', error);
                    showNotification('Dashboard Error', 'Failed to open dashboard. Check console for details.');
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Auto-launch on startup',
            type: 'checkbox',
            checked: configManager.get('autoLaunch'),
            click: toggleAutoLaunch
        },
        { type: 'separator' },
        {
            label: 'About',
            click: showAbout
        },
        {
            label: 'Quit',
            click: () => {
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
}

/**
 * Register global shortcut for speech recognition
 */
function registerGlobalShortcut() {
    const hotkey = configManager.get('hotkey');

    const success = globalShortcut.register(hotkey, () => {
        console.log(`Global shortcut triggered: ${hotkey}`);
        toggleSpeechRecognition();
    });

    if (success) {
        console.log(`Global shortcut registered: ${hotkey}`);
    } else {
        console.error(`Failed to register global shortcut: ${hotkey}`);
    }
}

/**
 * Register global shortcut for TTS
 */
function registerTTSShortcut() {
    const ttsSettings = configManager.getTTSSettings();
    const hotkey = ttsSettings.hotkey;

    // Always unregister first to avoid duplicate registrations across reloads/toggles
    globalShortcut.unregister(hotkey);

    if (!ttsSettings.enabled) {
        console.log('TTS is disabled, skipping hotkey registration');
        return;
    }

    // Only register if TTS is actually configured/initialized
    if (!ttsService || !configManager.get('elevenlabsApiKey')) {
        console.log('ElevenLabs API key not configured - skipping TTS hotkey registration');
        return;
    }

    const success = globalShortcut.register(hotkey, () => {
        console.log(`TTS shortcut triggered: ${hotkey}`);
        handleTTSTrigger();
    });

    if (success) {
        console.log(`TTS shortcut registered: ${hotkey}`);
    } else {
        console.error(`Failed to register TTS shortcut: ${hotkey}`);
    }
}

/**
 * Unregister global shortcut
 */
function unregisterGlobalShortcut() {
    try {
        // Guard against being called before app is ready (Windows crash)
        if (!app || (typeof app.isReady === 'function' && !app.isReady())) {
            return;
        }
        globalShortcut.unregisterAll();
        console.log('Global shortcuts unregistered');
    } catch (err) {
        console.error('Error unregistering global shortcuts:', err);
    }
}

/**
 * Toggle speech recognition on/off
 */
async function toggleSpeechRecognition() {
    if (!speechController) {
        console.error('Speech controller not initialized');
        showNotification('Error', 'Please configure API keys in config.js');
        return;
    }

    try {
        const currentState = speechController.getState();

        if (currentState === 'idle') {
            // Start listening
            try {
                await speechController.start();
            } catch (error) {
                // Check if it's a microphone error
                if (error.message && error.message.includes('device not found')) {
                    showNotification('Microphone Not Found', 
                        'No microphone device detected. Please connect a microphone and try again.');
                } else {
                    throw error; // Re-throw other errors
                }
            }
        } else {
            // Stop listening
            await speechController.stop();
        }

        updateTrayMenu();
    } catch (error) {
        console.error('Error toggling speech recognition:', error);
        showNotification('Error', error.message);
    }
}

/**
 * Setup speech controller event listeners
 */
function setupSpeechControllerEvents() {
    if (!speechController) return;

    speechController.on('started', () => {
        console.log('Speech recognition started');
    });

    speechController.on('stopped', () => {
        console.log('Speech recognition stopped');
    });

    speechController.on('interim', (text) => {
        console.log(`Interim: ${text}`);
    });

    speechController.on('text', (text) => {
        console.log(`Text typed: ${text}`);
    });

    speechController.on('command', (data) => {
        console.log(`Command executed: ${data.command}`);
    });

    speechController.on('error', (error) => {
        console.error('Speech recognition error:', error);
        showNotification('Error', error.message);
    });

    speechController.on('microphoneUnavailable', (error) => {
        console.warn('Microphone unavailable:', error.message);
        showNotification('Microphone Not Found', 
            'No microphone device detected. Speech recognition is disabled, but TTS and other features will still work.');
    });

    speechController.on('stateChange', ({ oldState, newState }) => {
        console.log(`State changed: ${oldState} -> ${newState}`);
        updateTrayMenu();
    });

    speechController.on('languageDetected', (languageData) => {
        console.log(`Language detected: ${languageData.name} (${languageData.code})`);
        showNotification('Language Detected', `Speaking in ${languageData.name}`);

        // Could forward to renderer/dashboard if needed via IPC
        // For now, just log and show notification
    });
}

/**
 * Setup TTS service event listeners
 */
function setupTTSServiceEvents() {
    if (!ttsService) return;

    ttsService.on('started', () => {
        console.log('TTS started');
        if (indicatorManager) {
            indicatorManager.processing('tts');
        }
    });

    ttsService.on('synthesizing', (data) => {
        console.log('TTS synthesizing:', data.text);
        if (indicatorManager) {
            indicatorManager.processing('tts');
        }
    });

    ttsService.on('speaking', (data) => {
        console.log('TTS speaking:', data.text);
        if (indicatorManager) {
            indicatorManager.speaking();
        }
    });

    ttsService.on('completed', (data) => {
        console.log('TTS completed:', data.text);
        if (indicatorManager) {
            indicatorManager.success();
            // Return to idle after a moment
            setTimeout(() => {
                if (indicatorManager) {
                    indicatorManager.idle();
                }
            }, 1000);
        }
    });

    ttsService.on('error', (error) => {
        console.error('TTS error:', error);
        
        // Don't show error notification for "no text selected" - we already spoke it
        const isNoTextError = error.message && error.message.includes('No text selected');
        
        if (indicatorManager) {
            if (isNoTextError) {
                // For "no text selected", just go to idle (we already spoke the message)
                indicatorManager.idle();
            } else {
                indicatorManager.error(error.message);
                // Return to idle after error
                setTimeout(() => {
                    if (indicatorManager) {
                        indicatorManager.idle();
                    }
                }, 2000);
            }
        }
        
        // Only show notification for real errors, not "no text selected"
        if (!isNoTextError) {
            showNotification('TTS Error', error.message);
        }
    });

    ttsService.on('stopped', () => {
        console.log('TTS stopped');
        if (indicatorManager) {
            indicatorManager.idle();
        }
    });
}

/**
 * Handle TTS trigger (hotkey pressed)
 */
async function handleTTSTrigger() {
    if (!ttsService) {
        console.error('TTS service not initialized');
        showNotification('Error', 'Please configure ElevenLabs API key in config.js');
        return;
    }

    if (ttsService.isCurrentlyProcessing()) {
        console.log('TTS already processing, stopping...');
        ttsService.stop();
        return;
    }

    try {
        await ttsService.readSelectedText();
    } catch (error) {
        console.error('Error in TTS trigger:', error);
        
        // Don't show notification for "no text selected" - we already spoke it
        const isNoTextError = error.message && error.message.includes('No text selected');
        if (!isNoTextError) {
            showNotification('TTS Error', error.message);
        }
    }
}



/**
 * Show about dialog
 */
function showAbout() {
    const { dialog } = require('electron');

    dialog.showMessageBox({
        type: 'info',
        title: 'About',
        message: 'EchoScripts Speech Typer',
        detail: 'Version 3.0.0\n\nA desktop speech-to-text application powered by Groq Whisper (STT) and ElevenLabs (TTS).\n\nPress Ctrl+Shift+S to activate voice typing anywhere.',
        buttons: ['OK']
    });
}

/**
 * Show notification
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 */
function showNotification(title, message) {
    const { Notification } = require('electron');

    if (Notification.isSupported()) {
        new Notification({
            title: title,
            body: message
        }).show();
    }
}

/**
 * Setup auto-launch
 */
async function setupAutoLaunch() {
    const autoLaunchEnabled = configManager.get('autoLaunch');

    if (autoLaunchEnabled) {
        await autoLauncher.enable();
    }
}

/**
 * Toggle auto-launch
 */
async function toggleAutoLaunch() {
    const currentState = configManager.get('autoLaunch');
    const newState = !currentState;

    configManager.set('autoLaunch', newState);

    if (newState) {
        await autoLauncher.enable();
    } else {
        await autoLauncher.disable();
    }

    updateTrayMenu();
}

/**
 * Log CrewAI status on startup
 */
function logCrewAIStatus() {
    if (!speechController || !speechController.crewAIAgent) {
        console.log('CrewAI: Not available (speech controller not initialized)');
        return;
    }

    const crewAI = speechController.crewAIAgent;
    const isEnabled = crewAI.isEnabled();
    const crewAIEnabled = configManager.get('crewaiEnabled') || false;
    const hasApiKey = !!configManager.get('groqApiKey');

    console.log('\n=== CrewAI Status ===');
    console.log(`Enabled in config: ${crewAIEnabled}`);
    console.log(`Groq API key configured: ${hasApiKey ? 'Yes' : 'No'}`);
    console.log(`CrewAI Active: ${isEnabled ? '✓ YES' : '✗ NO'}`);
    
    if (!isEnabled) {
        if (!crewAIEnabled) {
            console.log('→ To enable CrewAI: Set crewaiEnabled: true in config.js');
        } else if (!hasApiKey) {
            console.log('→ To enable CrewAI: Set groqApiKey in config.js');
        } else {
            console.log('→ CrewAI enabled but initialization failed (check API key validity)');
        }
    } else {
        console.log(`→ Model: ${crewAI.model || 'llama-3.3-70b-versatile'}`);
        console.log('→ CrewAI is ready to process commands intelligently');
    }
    console.log('===================\n');
}


// App lifecycle events
app.whenReady().then(async () => {
    await initializeApp();
});

async function performCleanup() {
    if (cleanupInProgress) {
        console.log('[Cleanup] Already in progress, skipping...');
        return;
    }
    cleanupInProgress = true;

    console.log('[Cleanup] Starting app cleanup...');

    try {
        // Unregister shortcuts first
        unregisterGlobalShortcut();

        // Stop speech services
        if (speechController) {
            console.log('[Cleanup] Stopping speech controller...');
            speechController.cleanup();
        }

        if (ttsService) {
            console.log('[Cleanup] Stopping TTS service...');
            ttsService.stop();
        }

        // Destroy indicator window (important: do this before app.quit)
        if (indicatorManager) {
            console.log('[Cleanup] Destroying indicator window...');
            indicatorManager.destroy();
            indicatorManager = null;
        }

        // Shutdown WebSocket server
        if (webSocketServer) {
            console.log('[Cleanup] Shutting down WebSocket server...');
            await webSocketServer.shutdown();
        }

        // Disconnect from MongoDB
        if (mongoDBService.isConnected) {
            console.log('[Cleanup] Disconnecting from MongoDB...');
            await mongoDBService.disconnect();
        }

        console.log('[Cleanup] Cleanup completed successfully');
    } catch (error) {
        console.error('[Cleanup] Error during cleanup:', error);
    } finally {
        cleanupInProgress = false;
    }
}

app.on('window-all-closed', async () => {
    // On Windows, quit when all windows are closed
    if (process.platform !== 'darwin') {
        await performCleanup();
        app.quit();
    }
});

app.on('before-quit', async () => {
    await performCleanup();
});

app.on('will-quit', () => {
    // Final cleanup
    unregisterGlobalShortcut();
});

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // Someone tried to run a second instance, show notification
        showNotification('Already Running', 'EchoScripts Speech Typer is already running in the system tray.');
    });
}
