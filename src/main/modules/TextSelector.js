const { clipboard } = require('electron');
const { exec } = require('child_process');
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

const isLinux = process.platform === 'linux';

/**
 * TextSelector - Gets selected text from any application via clipboard
 */
class TextSelector {
    constructor() {
    }

    /**
     * Get currently selected text by simulating Ctrl+C and reading clipboard
     * @returns {Promise<string>} Selected text or empty string
     */
    async getSelectedText() {
        try {
            // Save current clipboard content
            const savedClipboard = clipboard.readText();
            const savedClipboardLength = savedClipboard.length;

            // Clear clipboard to detect if copy actually happened
            clipboard.writeText('');

            // Wait a bit to ensure clipboard is cleared
            await this.delay(100);

            // Simulate Ctrl+C to copy selected text
            await this.simulateCopy();

            // Wait longer for clipboard to update (some apps are slower)
            await this.delay(200);

            // Read clipboard - try multiple times if needed
            let selectedText = clipboard.readText();
            let attempts = 0;
            const maxAttempts = 3;

            // If clipboard is still empty, try reading again (some apps need more time)
            while ((!selectedText || selectedText.length === 0) && attempts < maxAttempts) {
                await this.delay(100);
                selectedText = clipboard.readText();
                attempts++;
            }

            // Check if clipboard actually changed (meaning copy worked)
            const clipboardChanged = selectedText !== savedClipboard;
            const hasNewContent = selectedText && selectedText.length > 0 && selectedText !== savedClipboard;

            // Restore original clipboard if we had saved content
            if (savedClipboard && clipboardChanged) {
                // Small delay before restoring
                await this.delay(50);
                clipboard.writeText(savedClipboard);
            } else if (!hasNewContent) {
                // If no text was selected, restore empty clipboard
                clipboard.writeText(savedClipboard || '');
            }

            // Return selected text only if it's different from what we saved
            if (hasNewContent) {
                console.log(`Selected text detected: "${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}"`);
                return selectedText;
            } else {
                console.log('No text selected (clipboard unchanged)');
                return '';
            }
        } catch (error) {
            console.error('Error getting selected text:', error);
            return '';
        }
    }

    /**
     * Simulate Ctrl+C keyboard shortcut
     * @returns {Promise<void>}
     */
    async simulateCopy() {
        if (isLinux) {
            await this.simulateCopyLinux();
        } else {
            // Windows: use nut.js
            // Press Ctrl, then C, then release both
            await keyboard.pressKey(Key.LeftControl);
            await this.delay(20);
            await keyboard.pressKey(Key.C);
            await this.delay(30);
            await keyboard.releaseKey(Key.C);
            await keyboard.releaseKey(Key.LeftControl);
            await this.delay(50); // Extra delay for Windows
        }
    }

    /**
     * Simulate Ctrl+C on Linux using xdotool or ydotool
     * @returns {Promise<void>}
     */
    async simulateCopyLinux() {
        const isWayland = process.env.XDG_SESSION_TYPE === 'wayland';

        if (isWayland) {
            // Try ydotool first, fallback to nut.js if it fails
            try {
                // ydotool: Ctrl (29) + C (46)
                // Press Ctrl down, press C, release C, release Ctrl
                const command = 'ydotool key 29:1 46:1 46:0 29:0';
                await this.executeLinuxCommand(command);
            } catch (error) {
                console.warn('[TextSelector] ydotool failed, trying fallback method with nut.js');
                // Fallback to nut.js
                try {
                    await keyboard.pressKey(Key.LeftControl);
                    await this.delay(20);
                    await keyboard.pressKey(Key.C);
                    await this.delay(30);
                    await keyboard.releaseKey(Key.C);
                    await keyboard.releaseKey(Key.LeftControl);
                } catch (fallbackError) {
                    console.error('[TextSelector] Both ydotool and fallback methods failed:', fallbackError);
                    throw new Error('Unable to simulate Ctrl+C on Wayland. Please run: sudo ./fix-ydotool.sh');
                }
            }
        } else {
            // xdotool - use --clearmodifiers to ensure clean state
            const command = 'xdotool key --clearmodifiers ctrl+c';
            await this.executeLinuxCommand(command);
        }

        // Additional small delay for Linux systems
        await this.delay(50);
    }

    /**
     * Execute Linux command
     * @param {string} command - Command to execute
     * @returns {Promise<void>}
     */
    async executeLinuxCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('[TextSelector] Error executing copy command:', error);

                    // Check for specific ydotool errors
                    if (error.message.includes('ydotoold backend unavailable')) {
                        console.error('[TextSelector] ydotoold daemon is not running');
                        console.error('[TextSelector] Please run: sudo ./fix-ydotool.sh');
                        reject(new Error('ydotoold daemon not running'));
                        return;
                    }

                    if (error.message.includes('failed to open uinput device')) {
                        console.error('[TextSelector] Insufficient permissions for /dev/uinput');
                        console.error('[TextSelector] Please run: sudo ./fix-ydotool.sh');
                        reject(new Error('uinput device permission denied'));
                        return;
                    }

                    reject(error);
                    return;
                }

                if (stderr && stderr.trim()) {
                    console.warn('[TextSelector] Command stderr:', stderr);
                }

                resolve();
            });
        });
    }

    /**
     * Delay helper
     * @param {number} ms - Milliseconds
     * @returns {Promise}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = TextSelector;

