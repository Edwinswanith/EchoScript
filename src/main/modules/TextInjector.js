const { exec } = require('child_process');
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

const isLinux = process.platform === 'linux';

/**
 * TextInjector - Injects text into focused application via keyboard simulation
 */
class TextInjector {
    constructor(typingSpeed = 50) {
        this.typingSpeed = typingSpeed;

        // Configure nut.js settings (for Windows)
        if (!isLinux) {
            keyboard.config.autoDelayMs = typingSpeed;
        }
    }

    /**
     * Type text character-by-character
     * @param {string} text - Text to type
     */
    async typeText(text) {
        try {
            if (!text || text.length === 0) return;

            // Add a small delay before starting to type
            await this.delay(100);

            if (isLinux) {
                // Use xdotool for Linux (works with both X11 and Wayland via XWayland)
                await this.typeTextLinux(text);
            } else {
                // Use nut.js for Windows
                await keyboard.type(text);
            }
        } catch (error) {
            console.error('Error typing text:', error);
            throw error;
        }
    }

    /**
     * Check if ydotoold daemon is running
     * @returns {Promise<boolean>}
     */
    async checkYdotooldRunning() {
        return new Promise((resolve) => {
            exec('pgrep -x ydotoold', (error) => {
                resolve(!error);
            });
        });
    }

    /**
     * Attempt to start ydotoold daemon
     * @returns {Promise<boolean>}
     */
    async startYdotoold() {
        return new Promise((resolve) => {
            // Try with sudo first (most common case)
            exec('sudo ydotoold &', (error) => {
                if (!error) {
                    // Wait a moment for daemon to start
                    setTimeout(async () => {
                        const running = await this.checkYdotooldRunning();
                        resolve(running);
                    }, 2000);
                } else {
                    // Try without sudo (if user has permissions)
                    exec('ydotoold &', (error2) => {
                        if (!error2) {
                            setTimeout(async () => {
                                const running = await this.checkYdotooldRunning();
                                resolve(running);
                            }, 2000);
                        } else {
                            resolve(false);
                        }
                    });
                }
            });
        });
    }

    /**
     * Type text on Linux using ydotool (Wayland) or xdotool (X11)
     * @param {string} text - Text to type
     */
    async typeTextLinux(text) {
        // Escape special characters for shell
        const escapedText = text
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\$/g, '\\$')
            .replace(/`/g, '\\`');

        const isWayland = process.env.XDG_SESSION_TYPE === 'wayland';

        // On Wayland, use ydotool. On X11, use xdotool.
        // Note: ydotool requires the ydotoold daemon to be running.
        const command = isWayland
            ? `ydotool type "${escapedText}"`
            : `xdotool type --clearmodifiers -- "${escapedText}"`;

        console.log(`Using ${isWayland ? 'ydotool' : 'xdotool'} for text injection`);

        return this.executeLinuxCommand(command, isWayland);
    }

    /**
     * Press a single key
     * @param {string} keyName - Key name (e.g., 'Enter', 'Backspace')
     */
    async pressKey(keyName) {
        try {
            if (isLinux) {
                await this.pressKeyLinux(keyName);
                return;
            }

            const key = this.getKey(keyName);
            if (key) {
                await keyboard.pressKey(key);
                await keyboard.releaseKey(key);
            } else {
                console.warn(`Unknown key: ${keyName}`);
            }
        } catch (error) {
            console.error(`Error pressing key ${keyName}:`, error);
            throw error;
        }
    }

    /**
     * Execute a Linux command (ydotool or xdotool) with error handling
     * @param {string} command - Command to execute
     * @param {boolean} isWayland - Whether using Wayland
     * @returns {Promise<void>}
     */
    async executeLinuxCommand(command, isWayland) {
        return new Promise((resolve, reject) => {
            const executeCommand = async () => {
                exec(command, async (error, stdout, stderr) => {
                    if (error) {
                        const errorOutput = stderr || error.message || '';
                        console.error('Command execution error:', errorOutput);

                        // Check for ydotool-specific errors
                        if (isWayland) {
                            const isBackendUnavailable = errorOutput.includes('backend unavailable') || 
                                                         errorOutput.includes('ydotoold');
                            const isUinputError = errorOutput.includes('uinput device') || 
                                                  errorOutput.includes('failed to open');

                            if (isBackendUnavailable || isUinputError) {
                                console.warn('ydotool daemon issue detected - attempting to fix...');
                                
                                // Check if daemon is running
                                const daemonRunning = await this.checkYdotooldRunning();
                                
                                if (!daemonRunning) {
                                    console.log('ydotoold daemon not running - attempting to start...');
                                    const started = await this.startYdotoold();
                                    
                                    if (started) {
                                        console.log('ydotoold daemon started - retrying command...');
                                        // Retry the command after daemon starts
                                        setTimeout(() => {
                                            exec(command, (retryError, retryStdout, retryStderr) => {
                                                if (retryError) {
                                                    const retryErrorOutput = retryStderr || retryError.message || '';
                                                    const errorMsg = `ydotool failed: ${retryErrorOutput}\n\n` +
                                                        `Please ensure:\n` +
                                                        `1. Run: ./fix-ydotool.sh\n` +
                                                        `2. Or manually: sudo ydotoold &\n` +
                                                        `3. Check permissions: sudo chmod 0666 /dev/uinput`;
                                                    reject(new Error(errorMsg));
                                                } else {
                                                    resolve();
                                                }
                                            });
                                        }, 1000);
                                        return;
                                    }
                                }

                                // If we get here, daemon might be running but permissions are wrong
                                const errorMsg = `ydotool error: ${errorOutput}\n\n` +
                                    `Possible solutions:\n` +
                                    `1. Run the setup script: ./fix-ydotool.sh\n` +
                                    `2. Fix permissions: sudo chmod 0666 /dev/uinput\n` +
                                    `3. Start daemon: sudo ydotoold &\n` +
                                    `4. Add user to input group: sudo usermod -aG input $USER (then logout/login)`;
                                reject(new Error(errorMsg));
                                return;
                            }
                        }
                        
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            };

            // For Wayland, check if daemon is running before attempting
            if (isWayland) {
                this.checkYdotooldRunning().then((running) => {
                    if (!running) {
                        console.warn('ydotoold daemon not detected - attempting to start...');
                        this.startYdotoold().then((started) => {
                            if (started) {
                                setTimeout(executeCommand, 1000);
                            } else {
                                executeCommand(); // Try anyway, might work
                            }
                        });
                    } else {
                        executeCommand();
                    }
                });
            } else {
                executeCommand();
            }
        });
    }

    /**
     * Press a single key on Linux using ydotool (Wayland) or xdotool (X11)
     * @param {string} keyName - Key name
     */
    async pressKeyLinux(keyName) {
        const isWayland = process.env.XDG_SESSION_TYPE === 'wayland';

        let command;
        if (isWayland) {
            const keyCode = this.getYdotoolKey(keyName);
            // ydotool key <code:1> <code:0> (press and release)
            command = `ydotool key ${keyCode}:1 ${keyCode}:0`;
        } else {
            const xdotoolKey = this.getXdotoolKey(keyName);
            command = `xdotool key ${xdotoolKey}`;
        }

        return this.executeLinuxCommand(command, isWayland);
    }

    /**
     * Execute keyboard shortcut (e.g., 'ctrl+a')
     * @param {string} shortcut - Shortcut string
     */
    async executeShortcut(shortcut) {
        try {
            if (isLinux) {
                await this.executeShortcutLinux(shortcut);
                return;
            }

            const keys = shortcut.split('+').map(k => this.getKey(k.trim()));

            if (keys.some(k => k === null)) {
                console.warn(`Invalid shortcut: ${shortcut}`);
                return;
            }

            // Press all keys
            for (const key of keys) {
                await keyboard.pressKey(key);
            }

            // Small delay while keys are held
            await this.delay(50);

            // Release all keys in reverse order
            for (const key of keys.reverse()) {
                await keyboard.releaseKey(key);
            }
        } catch (error) {
            console.error(`Error executing shortcut ${shortcut}:`, error);
            throw error;
        }
    }

    /**
     * Execute keyboard shortcut on Linux using ydotool (Wayland) or xdotool (X11)
     * @param {string} shortcut - Shortcut string  
     */
    async executeShortcutLinux(shortcut) {
        const isWayland = process.env.XDG_SESSION_TYPE === 'wayland';
        let command;

        if (isWayland) {
            // ydotool: press modifiers down, click key, release modifiers up
            const parts = shortcut.split('+');
            const codes = parts.map(k => this.getYdotoolKey(k.trim()));

            // Construct sequence: mods down -> last key click -> mods up
            const modifiers = codes.slice(0, -1);
            const lastKey = codes[codes.length - 1];

            const downSeq = modifiers.map(c => `${c}:1`).join(' ');
            const clickSeq = `${lastKey}:1 ${lastKey}:0`;
            const upSeq = modifiers.reverse().map(c => `${c}:0`).join(' ');

            command = `ydotool key ${downSeq} ${clickSeq} ${upSeq}`;
        } else {
            const xdotoolShortcut = shortcut.split('+').map(k => this.getXdotoolKey(k.trim())).join('+');
            command = `xdotool key ${xdotoolShortcut}`;
        }

        return this.executeLinuxCommand(command, isWayland);
    }

    /**
     * Execute a command (key press or shortcut)
     * @param {string} command - Command string
     */
    async executeCommand(command) {
        if (command.includes('+')) {
            await this.executeShortcut(command);
        } else {
            await this.pressKey(command);
        }
    }

    /**
     * Get Key object from key name (for nut.js on Windows)
     * @param {string} keyName - Key name
     * @returns {Key|null} Key object or null
     */
    getKey(keyName) {
        const keyMap = {
            'enter': Key.Enter,
            'backspace': Key.Backspace,
            'tab': Key.Tab,
            'space': Key.Space,
            'ctrl': Key.LeftControl,
            'control': Key.LeftControl,
            'shift': Key.LeftShift,
            'alt': Key.LeftAlt,
            'delete': Key.Delete,
            'home': Key.Home,
            'end': Key.End,
            'pageup': Key.PageUp,
            'pagedown': Key.PageDown,
            'escape': Key.Escape,
            'esc': Key.Escape,
            'a': Key.A,
            'c': Key.C,
            'v': Key.V,
            'x': Key.X,
            'z': Key.Z,
            'y': Key.Y,
            's': Key.S,
            'up': Key.Up,
            'down': Key.Down,
            'left': Key.Left,
            'right': Key.Right
        };

        return keyMap[keyName.toLowerCase()] || null;
    }

    /**
     * Get xdotool key name from our key name (for Linux)
     * @param {string} keyName - Key name
     * @returns {string} xdotool key name
     */
    getXdotoolKey(keyName) {
        const keyMap = {
            'enter': 'Return',
            'backspace': 'BackSpace',
            'tab': 'Tab',
            'space': 'space',
            'ctrl': 'ctrl',
            'control': 'ctrl',
            'shift': 'shift',
            'alt': 'alt',
            'delete': 'Delete',
            'home': 'Home',
            'end': 'End',
            'pageup': 'Page_Up',
            'pagedown': 'Page_Down',
            'escape': 'Escape',
            'esc': 'Escape',
            'up': 'Up',
            'down': 'Down',
            'left': 'Left',
            'right': 'Right'
        };

        return keyMap[keyName.toLowerCase()] || keyName;
    }

    /**
     * Get ydotool key code from our key name (for Wayland)
     * Uses Linux Input Event codes
     * @param {string} keyName - Key name
     * @returns {number} ydotool key code
     */
    getYdotoolKey(keyName) {
        const keyMap = {
            'enter': 28,
            'backspace': 14,
            'tab': 15,
            'space': 57,
            'ctrl': 29,
            'control': 29,
            'shift': 42,
            'alt': 56,
            'delete': 111,
            'home': 102,
            'end': 107,
            'pageup': 104,
            'pagedown': 109,
            'escape': 1,
            'esc': 1,
            'up': 103,
            'down': 108,
            'left': 105,
            'right': 106,
            'a': 30, 'b': 48, 'c': 46, 'd': 32, 'e': 18, 'f': 33, 'g': 34, 'h': 35, 'i': 23, 'j': 36,
            'k': 37, 'l': 38, 'm': 50, 'n': 49, 'o': 24, 'p': 25, 'q': 16, 'r': 19, 's': 31, 't': 20,
            'u': 22, 'v': 47, 'w': 17, 'x': 45, 'y': 21, 'z': 44,
            '.': 52, ',': 51, '/': 53, '1': 2
        };

        return keyMap[keyName.toLowerCase()] || 0;
    }

    /**
     * Set typing speed
     * @param {number} speed - Speed in milliseconds
     */
    setTypingSpeed(speed) {
        this.typingSpeed = speed;
        if (!isLinux) {
            keyboard.config.autoDelayMs = speed;
        }
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

module.exports = TextInjector;
