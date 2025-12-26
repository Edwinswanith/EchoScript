const AutoLaunch = require('auto-launch');
const path = require('path');

/**
 * AutoLauncher - Configure Windows startup behavior
 */
class AutoLauncher {
    constructor(appName, appPath) {
        this.appName = appName || 'Deepgram Speech Typer';
        this.appPath = appPath || process.execPath;

        // Initialize auto-launch instance
        this.autoLauncher = new AutoLaunch({
            name: this.appName,
            path: this.appPath,
            isHidden: false // Start minimized to system tray
        });
    }

    /**
     * Enable auto-launch on system startup
     * @returns {Promise<boolean>}
     */
    async enable() {
        try {
            const isEnabled = await this.isEnabled();

            if (!isEnabled) {
                await this.autoLauncher.enable();
                console.log('Auto-launch enabled');
            } else {
                console.log('Auto-launch already enabled');
            }

            return true;
        } catch (error) {
            console.error('Error enabling auto-launch:', error);
            throw error;
        }
    }

    /**
     * Disable auto-launch
     * @returns {Promise<boolean>}
     */
    async disable() {
        try {
            const isEnabled = await this.isEnabled();

            if (isEnabled) {
                await this.autoLauncher.disable();
                console.log('Auto-launch disabled');
            } else {
                console.log('Auto-launch already disabled');
            }

            return true;
        } catch (error) {
            console.error('Error disabling auto-launch:', error);
            throw error;
        }
    }

    /**
     * Check if auto-launch is enabled
     * @returns {Promise<boolean>}
     */
    async isEnabled() {
        try {
            return await this.autoLauncher.isEnabled();
        } catch (error) {
            console.error('Error checking auto-launch status:', error);
            return false;
        }
    }

    /**
     * Toggle auto-launch
     * @returns {Promise<boolean>} New state
     */
    async toggle() {
        const isEnabled = await this.isEnabled();

        if (isEnabled) {
            await this.disable();
            return false;
        } else {
            await this.enable();
            return true;
        }
    }
}

module.exports = AutoLauncher;
