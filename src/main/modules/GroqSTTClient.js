const EventEmitter = require('events');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * GroqSTTClient - Handles Groq Whisper API for speech-to-text
 * Uses buffered approach with periodic transcription
 */
class GroqSTTClient extends EventEmitter {
    constructor(config) {
        super();

        this.apiKey = config.apiKey;
        this.model = config.model || 'whisper-large-v3';
        this.language = config.language || 'auto';
        this.bufferDuration = config.bufferDuration || 3000; // 3 seconds

        this.groqClient = null;
        this.isConnected = false;
        this.sessionStartTime = null;

        // Audio buffering
        this.audioBuffer = [];
        this.bufferStartTime = null;
        this.isProcessing = false;
    }

    /**
     * Initialize client
     */
    initialize() {
        if (!this.apiKey) {
            const error = new Error('Groq API key is required');
            console.error('[GroqSTTClient] Initialization failed:', error.message);
            throw error;
        }

        try {
            this.groqClient = new Groq({ apiKey: this.apiKey });
            console.log('[GroqSTTClient] Client initialized successfully');
        } catch (error) {
            console.error('[GroqSTTClient] Failed to create client:', error);
            throw error;
        }
    }

    /**
     * Start STT session
     */
    async startSession() {
        try {
            console.log('[GroqSTTClient] Starting session...');

            if (!this.groqClient) {
                this.initialize();
            }

            if (this.isConnected) {
                console.warn('[GroqSTTClient] Session already active');
                return;
            }

            this.audioBuffer = [];
            this.bufferStartTime = Date.now();
            this.isConnected = true;
            this.sessionStartTime = Date.now();
            
            console.log('[GroqSTTClient] Session started successfully');
            this.emit('open');
        } catch (error) {
            console.error('[GroqSTTClient] Error starting session:', error);
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
            console.warn('[GroqSTTClient] Cannot send audio: not connected');
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

            // Convert PCM to WAV
            const wavBuffer = this.createWavBuffer(audioData);

            // Create temporary file
            const tempDir = app.getPath('temp');
            const tempFile = path.join(tempDir, `groq-stt-${Date.now()}.wav`);
            fs.writeFileSync(tempFile, wavBuffer);

            try {
                // Transcribe with Groq Whisper
                const transcription = await this.groqClient.audio.transcriptions.create({
                    file: fs.createReadStream(tempFile),
                    model: this.model,
                    language: this.language === 'auto' ? undefined : this.language,
                    response_format: 'verbose_json',
                    temperature: 0.0
                });

                // Clean up temp file
                fs.unlinkSync(tempFile);

                if (transcription && transcription.text && transcription.text.trim().length > 0) {
                    console.log(`[GroqSTTClient] Transcription: "${transcription.text}"`);
                    
                    this.emit('transcription', {
                        text: transcription.text.trim(),
                        isFinal: true,
                        confidence: 1.0,
                        language: transcription.language
                    });

                    // Emit language detection if available
                    if (transcription.language) {
                        this.emit('languageDetected', {
                            language: transcription.language,
                            confidence: 1.0
                        });
                    }
                }
            } catch (transcribeError) {
                console.error('[GroqSTTClient] Transcription error:', transcribeError);
                // Clean up temp file on error
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                }
            }
        } catch (error) {
            console.error('[GroqSTTClient] Error processing buffer:', error);
            this.emit('error', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Create WAV file buffer from PCM data
     * @param {Buffer} pcmData - PCM audio data
     * @returns {Buffer} WAV file buffer
     */
    createWavBuffer(pcmData) {
        const sampleRate = 16000;
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);
        const dataSize = pcmData.length;

        const buffer = Buffer.alloc(44 + dataSize);
        let offset = 0;

        // RIFF header
        buffer.write('RIFF', offset); offset += 4;
        buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
        buffer.write('WAVE', offset); offset += 4;

        // fmt chunk
        buffer.write('fmt ', offset); offset += 4;
        buffer.writeUInt32LE(16, offset); offset += 4;
        buffer.writeUInt16LE(1, offset); offset += 2; // PCM format
        buffer.writeUInt16LE(numChannels, offset); offset += 2;
        buffer.writeUInt32LE(sampleRate, offset); offset += 4;
        buffer.writeUInt32LE(byteRate, offset); offset += 4;
        buffer.writeUInt16LE(blockAlign, offset); offset += 2;
        buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

        // data chunk
        buffer.write('data', offset); offset += 4;
        buffer.writeUInt32LE(dataSize, offset); offset += 4;
        pcmData.copy(buffer, offset);

        return buffer;
    }

    /**
     * Stop session
     */
    async stopSession() {
        if (!this.isConnected) {
            console.log('[GroqSTTClient] Session already stopped');
            return;
        }

        try {
            console.log('[GroqSTTClient] Stopping session...');

            // Process any remaining buffered audio
            if (this.audioBuffer.length > 0) {
                await this.processBuffer();
            }

            this.isConnected = false;
            this.audioBuffer = [];
            this.bufferStartTime = null;
            this.sessionStartTime = null;

            console.log('[GroqSTTClient] Session stopped successfully');
            this.emit('close');
        } catch (error) {
            console.error('[GroqSTTClient] Error stopping session:', error);
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
     * Update configuration
     */
    updateConfig(config) {
        if (config.apiKey) this.apiKey = config.apiKey;
        if (config.model) this.model = config.model;
        if (config.language) this.language = config.language;
        if (config.bufferDuration) this.bufferDuration = config.bufferDuration;

        // Reinitialize client if API key changed
        if (config.apiKey && this.groqClient) {
            this.groqClient = null;
            this.initialize();
        }
    }
}

module.exports = GroqSTTClient;

