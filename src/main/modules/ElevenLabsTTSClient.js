const https = require('https');

/**
 * ElevenLabsTTSClient - Handles ElevenLabs Text-to-Speech API
 */
class ElevenLabsTTSClient {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.voiceId = config.voice || 'EXAVITQu4vr4xnSDxMaL'; // Default: Bella voice
        this.model = config.model || 'eleven_multilingual_v2';
        this.baseUrl = 'api.elevenlabs.io';
    }

    /**
     * Synthesize text to speech
     * @param {string} text - Text to convert to speech
     * @returns {Promise<Buffer>} Audio buffer (MP3 format)
     */
    async synthesize(text) {
        if (!this.apiKey) {
            throw new Error('ElevenLabs API key is required for TTS');
        }

        if (!text || text.trim().length === 0) {
            throw new Error('Text cannot be empty');
        }

        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                text: text.trim(),
                model_id: this.model,
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            });

            const options = {
                hostname: this.baseUrl,
                path: `/v1/text-to-speech/${this.voiceId}`,
                method: 'POST',
                headers: {
                    'xi-api-key': this.apiKey,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = https.request(options, (res) => {
                const chunks = [];

                res.on('data', (chunk) => {
                    chunks.push(chunk);
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        const audioBuffer = Buffer.concat(chunks);
                        resolve(audioBuffer);
                    } else {
                        const errorBody = Buffer.concat(chunks).toString();
                        reject(new Error(`ElevenLabs TTS API error: ${res.statusCode} - ${errorBody}`));
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
     * Update configuration
     * @param {Object} config - New configuration
     */
    updateConfig(config) {
        if (config.apiKey) this.apiKey = config.apiKey;
        if (config.voice) this.voiceId = config.voice;
        if (config.model) this.model = config.model;
    }
}

module.exports = ElevenLabsTTSClient;

