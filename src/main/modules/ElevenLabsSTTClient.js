const EventEmitter = require('events');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const ffmpegPath = require('ffmpeg-static');

/**
 * ElevenLabsSTTClient - Handles ElevenLabs Speech-to-Text API
 * Uses buffered approach with periodic transcription
 */
class ElevenLabsSTTClient extends EventEmitter {
    constructor(config) {
        super();

        this.apiKey = config.apiKey;
        this.model = config.model || 'eleven_multilingual_v2';
        this.language = config.language || 'auto';
        this.bufferDuration = config.bufferDuration || 3000; // 3 seconds

        this.isConnected = false;
        this.sessionStartTime = null;

        // Audio buffering
        this.audioBuffer = [];
        this.bufferStartTime = null;
        this.isProcessing = false;

        // Track temporary files for cleanup
        this.tempFiles = new Set();
    }

    /**
     * Initialize client
     */
    initialize() {
        if (!this.apiKey) {
            const error = new Error('ElevenLabs API key is required for STT');
            console.error('[ElevenLabsSTTClient] Initialization failed:', error.message);
            throw error;
        }

        console.log('[ElevenLabsSTTClient] Client initialized successfully');
    }

    /**
     * Start STT session
     */
    async startSession() {
        try {
            console.log('[ElevenLabsSTTClient] Starting session...');

            if (this.isConnected) {
                console.warn('[ElevenLabsSTTClient] Session already active');
                return;
            }

            this.audioBuffer = [];
            this.bufferStartTime = Date.now();
            this.isConnected = true;
            this.sessionStartTime = Date.now();

            console.log('[ElevenLabsSTTClient] Session started successfully');
            this.emit('open');
        } catch (error) {
            console.error('[ElevenLabsSTTClient] Error starting session:', error);
            this.isConnected = false;
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Send audio data (buffer it)
     * @param {Buffer} audioData - Audio buffer (PCM 16-bit, 16kHz)
     */
    sendAudio(audioData) {
        if (!this.isConnected) {
            console.warn('[ElevenLabsSTTClient] Cannot send audio: not connected');
            return false;
        }

        if (!audioData || !Buffer.isBuffer(audioData) || audioData.length === 0) {
            return false;
        }

        // Add to buffer
        this.audioBuffer.push(audioData);

        // Check if buffer duration exceeded
        const now = Date.now();
        const duration = now - this.bufferStartTime;

        if (duration >= this.bufferDuration && !this.isProcessing) {
            this.processBuffer();
        }

        return true;
    }

    /**
     * Process buffered audio and transcribe
     */
    async processBuffer() {
        if (this.audioBuffer.length === 0 || this.isProcessing) {
            return;
        }

        this.isProcessing = true;

        try {
            // Concatenate audio buffers
            const audioData = Buffer.concat(this.audioBuffer);
            this.audioBuffer = [];
            this.bufferStartTime = Date.now();

            // Convert PCM to MP3 (ElevenLabs prefers MP3)
            const mp3Buffer = await this.convertPCMtoMP3(audioData);

            // Transcribe with ElevenLabs
            const transcription = await this.transcribeAudio(mp3Buffer);

            if (transcription && transcription.text && transcription.text.trim().length > 0) {
                console.log(`[ElevenLabsSTTClient] Transcription: "${transcription.text}"`);

                this.emit('transcription', {
                    text: transcription.text.trim(),
                    isFinal: true,
                    confidence: transcription.confidence || 1.0,
                    language: transcription.language
                });

                // Emit language detection if available
                if (transcription.language) {
                    this.emit('languageDetected', {
                        language: transcription.language,
                        confidence: transcription.confidence || 1.0
                    });
                }
            }
        } catch (error) {
            console.error('[ElevenLabsSTTClient] Error processing buffer:', error);
            this.emit('error', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Convert PCM to MP3 using ffmpeg
     * @param {Buffer} pcmData - PCM audio data
     * @returns {Promise<Buffer>} MP3 file buffer
     */
    async convertPCMtoMP3(pcmData) {
        return new Promise((resolve, reject) => {
            const { execFile } = require('child_process');
            const tempDir = app.getPath('temp');
            const timestamp = Date.now();
            const pcmFile = path.join(tempDir, `elevenlabs-stt-${timestamp}.pcm`);
            const mp3File = path.join(tempDir, `elevenlabs-stt-${timestamp}.mp3`);

            // Track temp files for cleanup
            this.tempFiles.add(pcmFile);
            this.tempFiles.add(mp3File);

            // Write PCM data to temp file
            fs.writeFileSync(pcmFile, pcmData);

            // Build FFmpeg arguments array (works cross-platform)
            const ffmpegArgs = [
                '-f', 's16le',
                '-ar', '16000',
                '-ac', '1',
                '-i', pcmFile,
                '-codec:a', 'libmp3lame',
                '-b:a', '128k',
                mp3File,
                '-y'
            ];

            // Use execFile for better cross-platform compatibility and security
            execFile(ffmpegPath, ffmpegArgs, (error, _stdout, stderr) => {
                // Clean up PCM file immediately
                this.cleanupTempFile(pcmFile);

                if (error) {
                    console.error('[ElevenLabsSTTClient] FFmpeg error:', error.message);
                    if (stderr) {
                        console.error('[ElevenLabsSTTClient] FFmpeg stderr:', stderr);
                    }

                    // Clean up MP3 file if it exists
                    this.cleanupTempFile(mp3File);
                    reject(new Error(`FFmpeg conversion failed: ${error.message}. Ensure FFmpeg is installed and available in your system PATH.`));
                    return;
                }

                // Read MP3 file
                const mp3Buffer = fs.readFileSync(mp3File);

                // Clean up MP3 file immediately after reading
                this.cleanupTempFile(mp3File);

                resolve(mp3Buffer);
            });
        });
    }

    /**
     * Transcribe audio using ElevenLabs API
     * @param {Buffer} audioBuffer - Audio buffer (MP3 format)
     * @returns {Promise<Object>} Transcription result
     */
    async transcribeAudio(audioBuffer) {
        return new Promise((resolve, reject) => {
            const boundary = `----ElevenLabsSTT${Date.now()}`;
            const languageParam = this.language === 'auto' ? '' : this.language;

            // Create multipart form data
            const formData = [];

            // Add model_id field
            formData.push(`--${boundary}\r\n`);
            formData.push(`Content-Disposition: form-data; name="model_id"\r\n\r\n`);
            formData.push(`${this.model}\r\n`);

            // Add file part (ElevenLabs expects "file" not "audio")
            formData.push(`--${boundary}\r\n`);
            formData.push(`Content-Disposition: form-data; name="file"; filename="audio.mp3"\r\n`);
            formData.push(`Content-Type: audio/mpeg\r\n\r\n`);
            const fileHeader = Buffer.from(formData.join(''));

            const fileFooter = Buffer.from(`\r\n--${boundary}--\r\n`);

            // Combine all parts
            const postData = Buffer.concat([fileHeader, audioBuffer, fileFooter]);

            const options = {
                hostname: 'api.elevenlabs.io',
                path: '/v1/speech-to-text',
                method: 'POST',
                headers: {
                    'xi-api-key': this.apiKey,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': postData.length
                }
            };

            const req = https.request(options, (res) => {
                const chunks = [];

                res.on('data', (chunk) => {
                    chunks.push(chunk);
                });

                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString();

                    if (res.statusCode === 200) {
                        try {
                            const result = JSON.parse(body);
                            resolve({
                                text: result.text || '',
                                language: result.language || languageParam,
                                confidence: result.confidence || 1.0
                            });
                        } catch (parseError) {
                            reject(new Error(`Failed to parse response: ${parseError.message}`));
                        }
                    } else {
                        reject(new Error(`ElevenLabs STT API error: ${res.statusCode} - ${body}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Network error: ${error.message}`));
            });

            req.write(postData);
            req.end();
        });
    }

    /**
     * Stop session
     */
    async stopSession() {
        if (!this.isConnected) {
            console.log('[ElevenLabsSTTClient] Session already stopped');
            return;
        }

        try {
            console.log('[ElevenLabsSTTClient] Stopping session...');

            // Process any remaining buffered audio
            if (this.audioBuffer.length > 0) {
                await this.processBuffer();
            }

            this.isConnected = false;
            this.audioBuffer = [];
            this.bufferStartTime = null;
            this.sessionStartTime = null;

            // Clean up any remaining temp files
            this.cleanupAllTempFiles();

            console.log('[ElevenLabsSTTClient] Session stopped successfully');
            this.emit('close');
        } catch (error) {
            console.error('[ElevenLabsSTTClient] Error stopping session:', error);
            this.emit('error', error);
        }
    }

    /**
     * Check if session is active
     */
    isSessionActive() {
        return this.isConnected;
    }

    /**
     * Clean up a temporary file
     * @param {string} filePath - Path to the temporary file
     */
    cleanupTempFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            this.tempFiles.delete(filePath);
        } catch (error) {
            console.error('[ElevenLabsSTTClient] Error cleaning up temp file:', error);
        }
    }

    /**
     * Clean up all temporary files
     */
    cleanupAllTempFiles() {
        console.log('[ElevenLabsSTTClient] Cleaning up all temporary files...');
        for (const filePath of this.tempFiles) {
            this.cleanupTempFile(filePath);
        }
        this.tempFiles.clear();
    }

    /**
     * Update configuration
     */
    updateConfig(config) {
        if (config.apiKey) this.apiKey = config.apiKey;
        if (config.model) this.model = config.model;
        if (config.language) this.language = config.language;
        if (config.bufferDuration) this.bufferDuration = config.bufferDuration;
    }
}

module.exports = ElevenLabsSTTClient;
