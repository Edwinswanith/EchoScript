const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const isLinux = process.platform === 'linux';
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

/**
 * AudioPlayer - Cross-platform audio playback for TTS
 */
class AudioPlayer {
    constructor() {
        this.currentProcess = null;
        this.tempDir = os.tmpdir();
    }

    /**
     * Play audio buffer
     * @param {Buffer} audioBuffer - Audio buffer (MP3 format)
     * @returns {Promise<void>}
     */
    async play(audioBuffer) {
        return new Promise((resolve, reject) => {
            if (!audioBuffer || audioBuffer.length === 0) {
                reject(new Error('Audio buffer is empty'));
                return;
            }

            // Save audio buffer to temporary file
            const tempFile = path.join(this.tempDir, `tts_${Date.now()}.mp3`);

            fs.writeFile(tempFile, audioBuffer, (writeError) => {
                if (writeError) {
                    reject(new Error(`Failed to write temp file: ${writeError.message}`));
                    return;
                }

                // Play audio file using platform-specific command
                this.playFile(tempFile)
                    .then(() => {
                        // Clean up temp file
                        fs.unlink(tempFile, () => {});
                        resolve();
                    })
                    .catch((error) => {
                        // Clean up temp file even on error
                        fs.unlink(tempFile, () => {});
                        reject(error);
                    });
            });
        });
    }

    /**
     * Play audio file using platform-specific command
     * @param {string} filePath - Path to audio file
     * @returns {Promise<void>}
     */
    async playFile(filePath) {
        // Log audio file info
        const stats = fs.statSync(filePath);
        console.log(`[AudioPlayer] Playing audio file: ${filePath} (${(stats.size / 1024).toFixed(2)} KB)`);

        if (isWindows) {
            return this.playFileWindows(filePath);
        } else if (isMac) {
            return this.playFileMac(filePath);
        } else {
            // Linux: try MP3-capable players first
            return this.playFileLinux(filePath);
        }
    }

    /**
     * Play audio file on Windows
     * @param {string} filePath - Path to audio file
     * @returns {Promise<void>}
     */
    async playFileWindows(filePath) {
        return new Promise((resolve, reject) => {
            // Windows: use PowerShell with Windows Media Player COM object for silent playback
            const escapedPath = filePath.replace(/'/g, "''").replace(/\\/g, '\\\\');
            const command = `powershell -Command "$player = New-Object -ComObject WMPlayer.OCX; $player.URL = '${escapedPath}'; $player.controls.play(); while ($player.playState -eq 3) { Start-Sleep -Milliseconds 100 }; $player.close()"`;
            
            console.log('Using Windows Media Player for audio playback');
            this.executePlayCommand(command, resolve, reject);
        });
    }

    /**
     * Play audio file on macOS
     * @param {string} filePath - Path to audio file
     * @returns {Promise<void>}
     */
    async playFileMac(filePath) {
        return new Promise((resolve, reject) => {
            const command = `afplay "${filePath}"`;
            console.log('Using afplay for audio playback');
            this.executePlayCommand(command, resolve, reject);
        });
    }

    /**
     * Play audio file on Linux - tries MP3-capable players first
     * @param {string} filePath - Path to audio file (MP3 format)
     * @returns {Promise<void>}
     */
    async playFileLinux(filePath) {
        // List of players to try in order (MP3-capable first)
        const players = [
            {
                name: 'mpg123',
                command: `mpg123 -q "${filePath}"`,
                checkCommand: 'command -v mpg123'
            },
            {
                name: 'ffplay',
                command: `ffplay -nodisp -autoexit -loglevel quiet "${filePath}"`,
                checkCommand: 'command -v ffplay'
            },
            {
                // Requires BOTH ffmpeg (for conversion) and paplay (for playback)
                name: 'ffmpeg + paplay (convert to WAV)',
                command: null, // Special handling
                checkCommand: 'command -v ffmpeg && command -v paplay'
            }
        ];

        // Try each player in order
        for (const player of players) {
            try {
                // Check if player is available
                const isAvailable = await this.checkCommandAvailable(player.checkCommand);

                if (!isAvailable) {
                    console.log(`[AudioPlayer] ${player.name} not available, trying next player...`);
                    continue;
                }

                // Special handling for ffmpeg: convert MP3 to WAV first
                if (player.name === 'ffmpeg + paplay (convert to WAV)') {
                    console.log(`[AudioPlayer] Attempting to play with ${player.name}...`);
                    return await this.playWithFFmpegConversion(filePath);
                }

                // Try to play with this player
                console.log(`[AudioPlayer] Attempting to play with ${player.name}...`);
                return await this.tryPlayWithPlayer(player.name, player.command, filePath);
            } catch (error) {
                console.log(`[AudioPlayer] ${player.name} failed: ${error.message}, trying next player...`);
                continue;
            }
        }

        // If all players failed
        throw new Error('No suitable audio player found. Please install one of: mpg123, ffplay, or ffmpeg');
    }

    /**
     * Check if a command is available
     * @param {string} checkCommand - Command to check
     * @returns {Promise<boolean>}
     */
    async checkCommandAvailable(checkCommand) {
        return new Promise((resolve) => {
            exec(checkCommand, (error) => {
                resolve(!error);
            });
        });
    }

    /**
     * Try to play audio with a specific player
     * @param {string} playerName - Name of the player
     * @param {string} command - Command to execute
     * @param {string} filePath - Path to audio file
     * @returns {Promise<void>}
     */
    async tryPlayWithPlayer(playerName, command, filePath) {
        return new Promise((resolve, reject) => {
            console.log(`[AudioPlayer] Using ${playerName} for audio playback`);
            console.log(`[AudioPlayer] Command: ${command}`);
            this.executePlayCommand(command, resolve, reject);
        });
    }

    /**
     * Play MP3 by converting to WAV first using ffmpeg
     * @param {string} mp3Path - Path to MP3 file
     * @returns {Promise<void>}
     */
    async playWithFFmpegConversion(mp3Path) {
        return new Promise((resolve, reject) => {
            const wavPath = mp3Path.replace('.mp3', '.wav');

            console.log('[AudioPlayer] Converting MP3 to WAV using ffmpeg...');

            // Convert MP3 to WAV
            const convertCommand = `ffmpeg -y -i "${mp3Path}" -acodec pcm_s16le -ar 22050 -ac 1 "${wavPath}"`;
            console.log('[AudioPlayer] FFmpeg command:', convertCommand);

            exec(convertCommand, (convertError, stdout, stderr) => {
                if (convertError) {
                    console.error('[AudioPlayer] FFmpeg conversion error:', convertError.message);
                    if (stderr) {
                        console.error('[AudioPlayer] FFmpeg stderr:', stderr);
                    }
                    reject(new Error(`FFmpeg conversion failed. Make sure ffmpeg can decode MP3 on your system. Original error: ${convertError.message}`));
                    return;
                }

                console.log('[AudioPlayer] Conversion successful, playing WAV with paplay...');

                // Play WAV file with paplay
                const playCommand = `paplay "${wavPath}"`;

                this.executePlayCommand(playCommand, () => {
                    // Clean up WAV file after playing
                    fs.unlink(wavPath, () => {});
                    resolve();
                }, (error) => {
                    // Clean up WAV file even on error
                    fs.unlink(wavPath, () => {});
                    reject(error);
                });
            });
        });
    }

    /**
     * Execute play command with proper error handling
     * @param {string} command - Command to execute
     * @param {Function} resolve - Resolve callback
     * @param {Function} reject - Reject callback
     */
    executePlayCommand(command, resolve, reject) {
        // Stop any currently playing audio
        this.stop();

        let settled = false; // Track if promise is already settled to avoid multiple resolve/reject

        const settleOnce = (fn, ...args) => {
            if (!settled) {
                settled = true;
                fn(...args);
            }
        };

        // Execute command
        this.currentProcess = exec(command, (error, stdout, stderr) => {
            this.currentProcess = null;

            if (error) {
                // Log error details
                console.error('[AudioPlayer] Audio playback error:', error.message);
                if (stderr) {
                    console.error('[AudioPlayer] Stderr:', stderr);
                }
                if (stdout) {
                    console.log('[AudioPlayer] Stdout:', stdout);
                }
                settleOnce(reject, new Error(`Audio playback failed: ${error.message}`));
            } else {
                console.log('[AudioPlayer] Audio playback completed successfully');
                if (stdout) {
                    console.log('[AudioPlayer] Stdout:', stdout);
                }
                settleOnce(resolve);
            }
        });

        // Handle process error (spawning error, not exit code)
        this.currentProcess.on('error', (error) => {
            this.currentProcess = null;
            console.error('Audio player process error:', error);
            settleOnce(reject, new Error(`Audio player process error: ${error.message}`));
        });
    }

    /**
     * Stop currently playing audio
     */
    stop() {
        if (this.currentProcess) {
            try {
                this.currentProcess.kill();
                this.currentProcess = null;
            } catch (error) {
                console.error('Error stopping audio:', error);
            }
        }
    }

    /**
     * Check if audio is currently playing
     * @returns {boolean}
     */
    isPlaying() {
        return this.currentProcess !== null;
    }
}

module.exports = AudioPlayer;

