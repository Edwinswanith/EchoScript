/**
 * CommandParser - Distinguishes between text and voice commands
 */
class CommandParser {
    constructor() {
        // Define supported voice commands
        this.commands = {
            // Enter/Return key - multiple variations
            'enter': 'enter',
            'return': 'enter',
            'sent': 'enter',
            'send': 'enter',
            'new line': 'enter',

            // Backspace/Delete key
            'backspace': 'backspace',
            'delete': 'backspace',

            // Tab key
            'tab': 'tab',

            // Selection commands
            'select all': 'ctrl+a',

            // Clipboard commands
            'copy': 'ctrl+c',
            'paste': 'ctrl+v',
            'cut': 'ctrl+x',

            // Edit commands
            'undo': 'ctrl+z',
            'redo': 'ctrl+y',

            // File commands
            'save': 'ctrl+s',

            // Punctuation
            'period': '.',
            'dot': '.',
            'comma': ',',
            'question mark': 'shift+/',
            'exclamation mark': 'shift+1',
            'exclamation point': 'shift+1',
            'colon': 'shift+;',
            'semicolon': ';',
            'apostrophe': "'",
            'quote': 'shift+\'',
            'open parenthesis': 'shift+9',
            'close parenthesis': 'shift+0',
            'open bracket': '[',
            'close bracket': ']',
            'dash': '-',
            'hyphen': '-',
            'underscore': 'shift+-'
        };
    }

    /**
     * Parse transcribed text to determine if it's a command or regular text
     * @param {string} text - Transcribed text
     * @returns {Object} Parsed result with type and value
     */
    parse(text) {
        if (!text || text.trim().length === 0) {
            return { type: 'text', value: text };
        }

        const normalized = text.toLowerCase().trim();

        // Check for exact command match
        if (this.commands[normalized]) {
            return {
                type: 'command',
                value: this.commands[normalized],
                originalText: text
            };
        }

        // Check for fuzzy command match (allows slight variations)
        for (const [commandPhrase, action] of Object.entries(this.commands)) {
            if (this.fuzzyMatch(normalized, commandPhrase)) {
                return {
                    type: 'command',
                    value: action,
                    originalText: text
                };
            }
        }

        // Not a command, treat as regular text
        return { type: 'text', value: text };
    }

    /**
     * Fuzzy match for command recognition (allows slight variations)
     * @param {string} input - User input
     * @param {string} command - Command phrase
     * @returns {boolean}
     */
    fuzzyMatch(input, command) {
        // Simple fuzzy matching - can be enhanced with Levenshtein distance
        const similarity = this.calculateSimilarity(input, command);
        return similarity > 0.85; // 85% similarity threshold
    }

    /**
     * Calculate similarity between two strings
     * @param {string} s1 - First string
     * @param {string} s2 - Second string
     * @returns {number} Similarity score (0-1)
     */
    calculateSimilarity(s1, s2) {
        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;

        if (longer.length === 0) {
            return 1.0;
        }

        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance between two strings
     * @param {string} s1 - First string
     * @param {string} s2 - Second string
     * @returns {number} Edit distance
     */
    levenshteinDistance(s1, s2) {
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) {
                    costs[j] = j;
                } else if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
            if (i > 0) {
                costs[s2.length] = lastValue;
            }
        }
        return costs[s2.length];
    }

    /**
     * Add a custom command
     * @param {string} phrase - Command phrase
     * @param {string} action - Keyboard action
     */
    addCommand(phrase, action) {
        this.commands[phrase.toLowerCase()] = action;
    }

    /**
     * Remove a command
     * @param {string} phrase - Command phrase
     */
    removeCommand(phrase) {
        delete this.commands[phrase.toLowerCase()];
    }

    /**
     * Get all registered commands
     * @returns {Object} All commands
     */
    getCommands() {
        return { ...this.commands };
    }
}

module.exports = CommandParser;
