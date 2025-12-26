const EventEmitter = require('events');
const ElevenLabsTTSClient = require('./ElevenLabsTTSClient');
const TextSelector = require('./TextSelector');
const AudioPlayer = require('./AudioPlayer');

/**
 * TTSService - Orchestrates text-to-speech workflow
 */
class TTSService extends EventEmitter {
    constructor(config) {
        super();

        this.config = config;
        this.enabled = config.get('ttsEnabled') !== false;

        // Initialize components
        const ttsConfig = config.getTTSSettings();
        this.ttsClient = new ElevenLabsTTSClient({
            apiKey: config.get('elevenlabsApiKey'),
            voice: ttsConfig.voice,
            model: ttsConfig.model
        });
        
        this.textSelector = new TextSelector();
        this.audioPlayer = new AudioPlayer();

        this.isProcessing = false;
    }

    /**
     * Read selected text aloud
     * @returns {Promise<void>}
     */
    async readSelectedText() {
        if (this.isProcessing) {
            console.warn('TTS already processing');
            return;
        }

        if (!this.enabled) {
            throw new Error('TTS is disabled');
        }

        if (!this.config.hasApiKey()) {
            throw new Error('ElevenLabs API key is required for TTS');
        }

        this.isProcessing = true;
        this.emit('started');

        try {
            // Step 1: Get selected text
            console.log('Getting selected text...');
            const selectedText = await this.textSelector.getSelectedText();

            if (!selectedText || selectedText.trim().length === 0) {
                // No text selected - use TTS to tell user to select text
                console.log('No text selected, providing voice feedback...');
                await this.speakMessage('Please select the text you want me to read');
                return;
            }

            console.log(`Selected text: "${selectedText}"`);

            // Step 2: Convert to speech
            console.log('Converting text to speech...');
            this.emit('synthesizing', { text: selectedText });
            
            const audioBuffer = await this.ttsClient.synthesize(selectedText);

            if (!audioBuffer || audioBuffer.length === 0) {
                throw new Error('Failed to generate audio');
            }

            console.log(`Audio generated: ${audioBuffer.length} bytes`);

            // Step 3: Play audio
            console.log('Playing audio...');
            this.emit('speaking', { text: selectedText });
            
            await this.audioPlayer.play(audioBuffer);

            console.log('TTS completed successfully');
            this.emit('completed', { text: selectedText });

        } catch (error) {
            console.error('TTS error:', error);
            this.emit('error', error);
            
            // If it's a "No text selected" error, we already handled it above
            if (error.message && error.message.includes('No text selected')) {
                return; // Don't throw, we already spoke the message
            }
            
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Stop current TTS playback
     */
    stop() {
        if (this.audioPlayer.isPlaying()) {
            this.audioPlayer.stop();
            this.emit('stopped');
        }
        this.isProcessing = false;
    }

    /**
     * Check if TTS is currently processing
     * @returns {boolean}
     */
    isCurrentlyProcessing() {
        return this.isProcessing || this.audioPlayer.isPlaying();
    }

    /**
     * Update configuration
     * @param {Object} newConfig - New configuration
     */
    updateConfig(newConfig) {
        this.config = newConfig;
        this.enabled = newConfig.get('ttsEnabled') !== false;

        const ttsConfig = newConfig.getTTSSettings();
        this.ttsClient.updateConfig({
            apiKey: newConfig.get('elevenlabsApiKey'),
            voice: ttsConfig.voice,
            model: ttsConfig.model
        });
    }

    /**
     * Enable TTS
     */
    enable() {
        this.enabled = true;
    }

    /**
     * Disable TTS
     */
    disable() {
        this.enabled = false;
        this.stop();
    }

    /**
     * Check if TTS is enabled
     * @returns {boolean}
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Speak a message using TTS
     * @param {string} message - Message to speak
     * @returns {Promise<void>}
     */
    async speakMessage(message) {
        try {
            console.log(`Speaking message: "${message}"`);
            this.emit('synthesizing', { text: message });
            
            const audioBuffer = await this.ttsClient.synthesize(message);

            if (!audioBuffer || audioBuffer.length === 0) {
                throw new Error('Failed to generate audio for message');
            }

            this.emit('speaking', { text: message });
            await this.audioPlayer.play(audioBuffer);
            this.emit('completed', { text: message });
        } catch (error) {
            console.error('Error speaking message:', error);
            this.emit('error', error);
            throw error;
        }
    }
}

module.exports = TTSService;

