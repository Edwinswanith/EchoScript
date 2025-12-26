const { BrowserWindow, ipcMain } = require('electron');
const EventEmitter = require('events');
const path = require('path');

/**
 * MicrophoneManager - Captures microphone audio using Electron's native getUserMedia
 * Works on Windows without requiring Sox or any external dependencies
 */
class MicrophoneManager extends EventEmitter {
    constructor() {
        super();

        this.audioWindow = null;
        this.isRecording = false;
        this.invalidDataCount = 0;
        this.lastInvalidDataLog = 0;
    }

    /**
     * Create hidden window for audio capture
     */
    createAudioWindow() {
        if (this.audioWindow) {
            console.log('[MicrophoneManager] Audio window already exists');
            return;
        }

        console.log('[MicrophoneManager] Creating audio capture window...');

        try {
            this.audioWindow = new BrowserWindow({
                show: false,
                width: 1,
                height: 1,
                focusable: false, // Prevent window from receiving focus
                skipTaskbar: true,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                    backgroundThrottling: false // Prevent throttling when not focused
                }
            });

            const audioCapturePath = path.join(__dirname, '../audio-capture.html');
            console.log('[MicrophoneManager] Loading audio capture HTML from:', audioCapturePath);

            this.audioWindow.loadFile(audioCapturePath);

            // Hide from taskbar and ensure it can't intercept input
            this.audioWindow.setSkipTaskbar(true);
            this.audioWindow.setIgnoreMouseEvents(true, { forward: true }); // Pass mouse events through

            // Setup IPC listeners
            ipcMain.on('audio-data', (event, audioData) => {
                if (this.isRecording) {
                    // Validate audio data
                    if (!audioData) {
                        console.error('[MicrophoneManager] Received null audio data');
                        return;
                    }

                    let audioBuffer;

                    // Convert to Buffer if needed (IPC serialization may convert Buffer to ArrayBuffer)
                    if (Buffer.isBuffer(audioData)) {
                        audioBuffer = audioData;
                    } else if (audioData instanceof ArrayBuffer) {
                        audioBuffer = Buffer.from(audioData);
                    } else if (audioData.buffer instanceof ArrayBuffer) {
                        // Handle TypedArray (Uint8Array, Int16Array, etc.)
                        audioBuffer = Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength);
                    } else if (typeof audioData === 'object' && audioData.data) {
                        // Handle serialized Buffer object
                        audioBuffer = Buffer.from(audioData.data);
                    } else {
                        // Try to create Buffer from the data
                        try {
                            audioBuffer = Buffer.from(audioData);
                        } catch (error) {
                            this.invalidDataCount++;
                            // Only log every 100 invalid data packets to avoid spam
                            if (this.invalidDataCount - this.lastInvalidDataLog >= 100) {
                                console.error(`[MicrophoneManager] Failed to convert audio data to Buffer (${this.invalidDataCount} total failures):`, error);
                                console.error('[MicrophoneManager] Audio data type:', typeof audioData);
                                console.error('[MicrophoneManager] Audio data constructor:', audioData?.constructor?.name);
                                this.lastInvalidDataLog = this.invalidDataCount;
                            }
                            return;
                        }
                    }

                    if (audioBuffer.length === 0) {
                        console.warn('[MicrophoneManager] Received empty audio buffer');
                        return;
                    }

                    // Validate audio format (should be 16-bit PCM = 2 bytes per sample)
                    if (audioBuffer.length % 2 !== 0) {
                        console.warn('[MicrophoneManager] Audio buffer length is not a multiple of 2 (invalid 16-bit PCM)');
                    }

                    this.emit('audioData', audioBuffer);
                }
            });

            ipcMain.on('audio-level', (event, level) => {
                if (this.isRecording) {
                    // Validate audio level
                    if (typeof level !== 'number' || isNaN(level)) {
                        console.warn('[MicrophoneManager] Invalid audio level received:', level);
                        return;
                    }

                    if (level < 0 || level > 1) {
                        console.warn('[MicrophoneManager] Audio level out of range [0-1]:', level);
                        return;
                    }

                    this.emit('audioLevel', level);
                }
            });

            ipcMain.on('audio-started', () => {
                console.log('[MicrophoneManager] Microphone started successfully');
                this.emit('started');
            });

            ipcMain.on('audio-stopped', () => {
                console.log('[MicrophoneManager] Microphone stopped');
                this.emit('stopped');
            });

            ipcMain.on('audio-error', (event, errorMessage) => {
                console.error('[MicrophoneManager] Audio capture error:', errorMessage);

                // Parse error details
                if (errorMessage.includes('Permission denied') || errorMessage.includes('NotAllowedError')) {
                    console.error('[MicrophoneManager] Microphone permission denied by user');
                } else if (errorMessage.includes('device not found') || errorMessage.includes('NotFoundError')) {
                    console.error('[MicrophoneManager] No microphone device found');
                } else if (errorMessage.includes('NotReadableError')) {
                    console.error('[MicrophoneManager] Microphone is already in use by another application');
                }

                this.emit('error', new Error(errorMessage));
            });

            console.log('[MicrophoneManager] Audio window created successfully');
        } catch (error) {
            console.error('[MicrophoneManager] Failed to create audio window:', error);
            throw error;
        }
    }

    /**
     * Start capturing audio from microphone
     */
    start() {
        try {
            if (this.isRecording) {
                console.warn('[MicrophoneManager] Already recording, ignoring start request');
                return;
            }

            console.log('[MicrophoneManager] Starting audio capture...');

            // Create audio window if it doesn't exist
            if (!this.audioWindow) {
                console.log('[MicrophoneManager] Creating audio window...');
                this.createAudioWindow();
            }

            // Wait a bit for window to load, then start capture
            setTimeout(() => {
                if (!this.audioWindow || this.audioWindow.isDestroyed()) {
                    console.error('[MicrophoneManager] Audio window is not available');
                    this.emit('error', new Error('Audio window is not available'));
                    return;
                }

                // Reset invalid data counter when starting
                this.invalidDataCount = 0;
                this.lastInvalidDataLog = 0;

                console.log('[MicrophoneManager] Sending start-capture command to renderer...');
                this.audioWindow.webContents.send('start-capture');
                this.isRecording = true;
            }, 500);

        } catch (error) {
            console.error('[MicrophoneManager] Error starting microphone:', error);
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Stop capturing audio
     */
    stop() {
        try {
            if (!this.isRecording) {
                console.warn('[MicrophoneManager] Not recording, ignoring stop request');
                return;
            }

            console.log('[MicrophoneManager] Stopping audio capture...');

            if (this.audioWindow && !this.audioWindow.isDestroyed()) {
                this.audioWindow.webContents.send('stop-capture');
            } else {
                console.warn('[MicrophoneManager] Audio window not available for stop command');
            }

            this.isRecording = false;
            console.log('[MicrophoneManager] Audio capture stopped');

        } catch (error) {
            console.error('[MicrophoneManager] Error stopping microphone:', error);
            this.emit('error', error);
        }
    }

    /**
     * Check if currently recording
     * @returns {boolean}
     */
    isActive() {
        return this.isRecording;
    }

    /**
     * Get audio format information
     * @returns {Object}
     */
    getAudioFormat() {
        return {
            sampleRate: 16000,
            channels: 1,
            bitDepth: 16,
            encoding: 'linear16'
        };
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        console.log('[MicrophoneManager] Cleaning up resources...');

        this.stop();

        if (this.audioWindow) {
            if (!this.audioWindow.isDestroyed()) {
                this.audioWindow.close();
            }
            this.audioWindow = null;
        }

        // Remove IPC listeners
        ipcMain.removeAllListeners('audio-data');
        ipcMain.removeAllListeners('audio-level');
        ipcMain.removeAllListeners('audio-started');
        ipcMain.removeAllListeners('audio-stopped');
        ipcMain.removeAllListeners('audio-error');

        console.log('[MicrophoneManager] Cleanup complete');
    }
}

module.exports = MicrophoneManager;
