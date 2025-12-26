const { BrowserWindow, screen } = require('electron');
const path = require('path');

/**
 * IndicatorManager - Manages the visual status indicator window
 * Provides real-time visual feedback for speech recognition states
 */
class IndicatorManager {
    constructor(configManager) {
        this.config = configManager;
        this.window = null;
        this.currentState = 'idle';
        this.enabled = true;
    }

    /**
     * Create the indicator window
     */
    createWindow() {
        if (!this.enabled) {
            console.log('Indicator disabled in config');
            return;
        }

        if (this.window) {
            console.warn('Indicator window already exists');
            return;
        }

        // Get indicator configuration
        const indicatorConfig = this.config.get('indicator') || {};
        const position = indicatorConfig.position || 'bottom-right';
        const offsetX = indicatorConfig.offsetX || 40;
        const offsetY = indicatorConfig.offsetY || 40;

        // Create frameless, transparent, always-on-top window
        this.window = new BrowserWindow({
            width: 80,
            height: 80,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            focusable: false,
            hasShadow: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        // Position the window
        this.positionWindow(position, offsetX, offsetY);

        // Load UI
        const indicatorPath = path.join(__dirname, '../../renderer/indicator/IndicatorUI.html');
        this.window.loadFile(indicatorPath);

        // Make click-through (doesn't block mouse)
        if (indicatorConfig.clickThrough !== false) {
            this.window.setIgnoreMouseEvents(true);
        }

        // Handle window events
        this.window.on('closed', () => {
            this.window = null;
        });

        console.log('Indicator window created');
    }

    /**
     * Position the window based on configuration
     * @param {string} position - Position string ('bottom-right', 'bottom-left', 'top-right', 'top-left')
     * @param {number} offsetX - Horizontal offset from edge
     * @param {number} offsetY - Vertical offset from edge
     */
    positionWindow(position, offsetX, offsetY) {
        if (!this.window) return;

        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.workAreaSize;
        const windowWidth = 80;
        const windowHeight = 80;

        let x, y;

        switch (position) {
            case 'bottom-right':
                x = width - windowWidth - offsetX;
                y = height - windowHeight - offsetY;
                break;
            case 'bottom-left':
                x = offsetX;
                y = height - windowHeight - offsetY;
                break;
            case 'top-right':
                x = width - windowWidth - offsetX;
                y = offsetY;
                break;
            case 'top-left':
                x = offsetX;
                y = offsetY;
                break;
            default:
                // Default to bottom-right
                x = width - windowWidth - offsetX;
                y = height - windowHeight - offsetY;
        }

        this.window.setPosition(x, y);
    }

    /**
     * Set the indicator state
     * @param {string} newState - New state ('idle', 'listening', 'detecting', 'processing', 'speaking', 'error', 'success')
     * @param {Object} metadata - Additional metadata for the state
     */
    setState(newState, metadata = {}) {
        if (!this.window || !this.enabled) {
            return;
        }

        if (this.currentState === newState && !metadata.force) {
            return;
        }

        this.currentState = newState;

        // Send state to renderer
        this.window.webContents.send('indicator:state-change', {
            state: newState,
            timestamp: Date.now(),
            ...metadata
        });

        console.log(`Indicator state: ${newState}`);
    }

    /**
     * Public API methods for state changes
     */
    idle() {
        this.setState('idle');
    }

    listening() {
        this.setState('listening');
    }

    detecting(audioLevel = 0.5) {
        this.setState('detecting', { audioLevel });
    }

    processing(action = '') {
        this.setState('processing', { action });
    }

    error(message = '') {
        this.setState('error', { message });
    }

    success() {
        this.setState('success');
    }

    speaking() {
        this.setState('speaking');
    }

    /**
     * Show the indicator window
     */
    show() {
        if (this.window) {
            this.window.show();
            this.enabled = true;
        }
    }

    /**
     * Hide the indicator window
     */
    hide() {
        if (this.window) {
            this.window.hide();
            this.enabled = false;
        }
    }

    /**
     * Toggle indicator visibility
     */
    toggle() {
        if (this.enabled) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * Update indicator position
     * @param {string} position - New position
     * @param {number} offsetX - New X offset
     * @param {number} offsetY - New Y offset
     */
    updatePosition(position, offsetX, offsetY) {
        this.positionWindow(position, offsetX, offsetY);
    }

    /**
     * Cleanup and destroy the window
     */
    destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
        console.log('Indicator window destroyed');
    }

    /**
     * Check if indicator is enabled
     * @returns {boolean}
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Get current state
     * @returns {string}
     */
    getCurrentState() {
        return this.currentState;
    }
}

module.exports = IndicatorManager;
