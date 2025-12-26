const EventEmitter = require('events');

/**
 * TriggerWordDetector - Detects trigger words in transcribed text
 * Allows voice activation/deactivation of the application
 */
class TriggerWordDetector extends EventEmitter {
    constructor(config) {
        super();

        this.config = config;
        this.triggerWord = config.get('triggerWord') || 'sana';
        this.deactivatePhrase = config.get('deactivatePhrase') || 'sana close';
        this.enabled = config.get('triggerWordEnabled') !== false;
        this.caseSensitive = config.get('triggerWordCaseSensitive') || false;

        console.log(`TriggerWordDetector initialized:`);
        console.log(`  Trigger word: "${this.triggerWord}"`);
        console.log(`  Deactivate phrase: "${this.deactivatePhrase}"`);
        console.log(`  Enabled: ${this.enabled}`);
    }

    /**
     * Detect trigger words in transcribed text
     * @param {string} text - Transcribed text to analyze
     * @returns {Object|null} Detection result or null
     */
    detect(text) {
        if (!this.enabled || !text) {
            return null;
        }

        // Normalize text for comparison
        const normalizedText = this.caseSensitive ? text.trim() : text.trim().toLowerCase();
        const normalizedTrigger = this.caseSensitive ? this.triggerWord : this.triggerWord.toLowerCase();
        const normalizedDeactivate = this.caseSensitive ? this.deactivatePhrase : this.deactivatePhrase.toLowerCase();

        // Check for deactivate phrase first (more specific)
        if (this.containsPhrase(normalizedText, normalizedDeactivate)) {
            return {
                type: 'deactivate',
                phrase: this.deactivatePhrase,
                originalText: text,
                confidence: 1.0
            };
        }

        // Check for activation trigger word
        if (this.containsWord(normalizedText, normalizedTrigger)) {
            return {
                type: 'activate',
                word: this.triggerWord,
                originalText: text,
                confidence: 1.0
            };
        }

        return null;
    }

    /**
     * Check if text contains a specific word
     * @param {string} text - Text to search
     * @param {string} word - Word to find
     * @returns {boolean}
     */
    containsWord(text, word) {
        // Use word boundaries to match whole words
        const wordRegex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'i');
        return wordRegex.test(text);
    }

    /**
     * Check if text contains a specific phrase
     * @param {string} text - Text to search
     * @param {string} phrase - Phrase to find
     * @returns {boolean}
     */
    containsPhrase(text, phrase) {
        return text.includes(phrase);
    }

    /**
     * Escape special regex characters
     * @param {string} str - String to escape
     * @returns {string}
     */
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Update trigger word configuration
     * @param {Object} newConfig - New configuration
     */
    updateConfig(newConfig) {
        if (newConfig.triggerWord) {
            this.triggerWord = newConfig.triggerWord;
        }
        if (newConfig.deactivatePhrase) {
            this.deactivatePhrase = newConfig.deactivatePhrase;
        }
        if (newConfig.triggerWordEnabled !== undefined) {
            this.enabled = newConfig.triggerWordEnabled;
        }
        if (newConfig.triggerWordCaseSensitive !== undefined) {
            this.caseSensitive = newConfig.triggerWordCaseSensitive;
        }

        console.log('TriggerWordDetector config updated');
    }

    /**
     * Enable trigger word detection
     */
    enable() {
        this.enabled = true;
        console.log('TriggerWordDetector enabled');
    }

    /**
     * Disable trigger word detection
     */
    disable() {
        this.enabled = false;
        console.log('TriggerWordDetector disabled');
    }

    /**
     * Check if trigger word detection is enabled
     * @returns {boolean}
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Get current trigger word
     * @returns {string}
     */
    getTriggerWord() {
        return this.triggerWord;
    }

    /**
     * Get current deactivate phrase
     * @returns {string}
     */
    getDeactivatePhrase() {
        return this.deactivatePhrase;
    }
}

module.exports = TriggerWordDetector;
