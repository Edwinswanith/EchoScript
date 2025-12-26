const Groq = require('groq-sdk');
const tokenTracker = require('./TokenTracker');

/**
 * Extracts a JSON object from text that may contain extra content
 * @param {string} text - The text containing JSON
 * @returns {string} The extracted JSON string
 * @throws {Error} If no valid JSON object is found
 */
function extractJsonObject(text) {
    if (!text) {
        throw new Error('Empty response text from LLM');
    }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) {
        throw new Error('No JSON object found in LLM response');
    }

    return text.slice(start, end + 1);
}

const CREWAI_SYSTEM_PROMPT = `
You are an intelligent text parser that analyzes transcribed speech and understands natural language flow to extract:
1. The actual text content that should be typed (ONLY the text, remove ALL command phrases)
2. ALL keyboard commands mentioned or implied in the speech (in order of appearance)

Output format:
- You must respond with ONLY a single JSON object.
- No additional text, no explanations, no markdown.
- Schema:
  {
    "text": string,
    "commands": string[]
  }

Rules:
1) Text vs commands
   - "text" contains ONLY natural language content that should be typed.
   - Any command phrase must NOT appear in "text".
   - All command phrases must be added to "commands" in the order they appear.

2) Command mapping to canonical values
   - Map the following phrases to commands:

     To "enter":
       - "sent", "send", "send it", "send the message",
         "send this", "send this message",
         "post", "post this",
         "submit", "submit this",
         "enter"

     To "tab":
       - "tab", "next field", "move to next"

     To "ctrl+a":
       - "select all", "select everything"

     To "ctrl+c":
       - "copy", "copy it"

     To "ctrl+v":
       - "paste", "paste it"

     To "ctrl+x":
       - "cut", "cut it"

     To "backspace":
       - "delete", "remove", "backspace"

     To "enter" for a new line:
       - "next line", "new line"

3) When to treat phrases as commands
   - Treat a phrase as a command when it is a short, clear instruction on its own, usually at the end of a sentence.
   - If the phrase appears as part of a normal sentence about future or past actions, keep it as text.

   Example where it should NOT be a command:
   Input: "I will send this message later today"
   Output:
   {"text": "I will send this message later today", "commands": []}

4) Punctuation and capitalization
   - Preserve punctuation and capitalization in "text".
   - "commands" must be lowercase canonical strings like "enter", "tab", "ctrl+a".

Examples:

Input:
"Yeah. TypeScript. Send this message."
Output:
{"text": "Yeah. TypeScript.", "commands": ["enter"]}

Input:
"Can you schedule your meeting tomorrow 10AM? Send the message."
Output:
{"text": "Can you schedule your meeting tomorrow 10AM?", "commands": ["enter"]}

Input:
"Hello. Send this message. Tab"
Output:
{"text": "Hello.", "commands": ["enter", "tab"]}

Input:
"Meeting will start in 10:00 so all are ready to this meeting. sent this message"
Output:
{"text": "Meeting will start in 10:00 so all are ready to this meeting.", "commands": ["enter"]}

Input:
"Hello world. send it. tab"
Output:
{"text": "Hello world.", "commands": ["enter", "tab"]}

Input:
"This is just regular text"
Output:
{"text": "This is just regular text", "commands": []}

Input:
"Meeting schedule in tomorrow at 10AM. can you send this message"
Output:
{"text": "Meeting schedule in tomorrow at 10AM.", "commands": ["enter"]}

Negative examples:

Input:
"I will send this message later today"
Output:
{"text": "I will send this message later today", "commands": []}

Input:
"Please do not delete this message"
Output:
{"text": "Please do not delete this message", "commands": []}
`;

/**
 * CrewAIAgent - Analyzes transcribed speech to extract text content and keyboard commands
 * Uses Groq API to understand natural language and identify commands
 */
class CrewAIAgent {
    constructor(config) {
        this.config = config;
        this.enabled = config.get('crewaiEnabled') || false;
        this.apiKey = config.get('groqApiKey') || '';
        this.model = config.get('crewaiModel') || 'llama-3.3-70b-versatile';
        this.debug = config.get('crewaiDebug') || false;

        // Initialize Groq client if enabled and API key is provided
        if (this.enabled && this.apiKey) {
            try {
                this.groqClient = new Groq({ apiKey: this.apiKey });
            } catch (error) {
                console.error('Error initializing Groq client:', error);
                this.enabled = false;
            }
        } else {
            this.enabled = false;
            if (!this.apiKey) {
                console.warn('CrewAI enabled but Groq API key not provided');
            }
        }

        // Supported keyboard commands mapping (conservative, exact matches only)
        this.commandMapping = {
            enter: 'enter',
            return: 'enter',
            sent: 'enter',
            send: 'enter',
            'new line': 'enter',
            tab: 'tab',
            'select all': 'ctrl+a',
            'select everything': 'ctrl+a',
            copy: 'ctrl+c',
            paste: 'ctrl+v',
            cut: 'ctrl+x',
            undo: 'ctrl+z',
            redo: 'ctrl+y',
            save: 'ctrl+s',
        };
    }

    /**
     * Analyze transcribed text and extract text content and keyboard commands
     * @param {string} transcribedText - The transcribed speech text
     * @returns {Promise<Object>} Object with { text: string, commands: string[] }
     */
    async analyze(transcribedText) {
        if (!this.enabled || !this.groqClient) {
            // Fallback: return text as-is with no commands
            return {
                text: transcribedText,
                commands: []
            };
        }

        if (!transcribedText || transcribedText.trim().length === 0) {
            return {
                text: '',
                commands: []
            };
        }

        try {
            const userPrompt = `
Input speech:
${transcribedText}

Return ONLY JSON with "text" and "commands".
`;

            const result = await this.groqClient.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: CREWAI_SYSTEM_PROMPT
                    },
                    {
                        role: 'user',
                        content: userPrompt
                    }
                ],
                model: this.model,
                temperature: 0.2,
                max_tokens: 300,
                response_format: { type: 'json_object' }
            });

            let content = result.choices[0]?.message?.content?.trim() || '';

            // Track token usage from Groq API response
            if (result.usage) {
                await tokenTracker.recordAgentUsage(result.usage.total_tokens, {
                    model: this.model,
                    promptTokens: result.usage.prompt_tokens,
                    completionTokens: result.usage.completion_tokens,
                    inputLength: transcribedText.length
                });
            }

            if (this.debug) {
                console.log('CrewAI raw text response:', content);
            }

            // Remove markdown code blocks if present as extra safety
            if (content.startsWith('```json')) {
                content = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
            } else if (content.startsWith('```')) {
                content = content.replace(/^```\s*/i, '').replace(/\s*```$/i, '');
            }

            // Extract JSON object even if LLM prepends text like "Here is the JSON"
            const jsonText = extractJsonObject(content);
            const parsed = JSON.parse(jsonText);

            if (this.debug) {
                console.log('CrewAI raw response:', JSON.stringify(parsed, null, 2));
            }

            // Fix text fallback logic to handle empty strings correctly
            const hasTextKey = Object.prototype.hasOwnProperty.call(parsed, 'text');
            const text = hasTextKey ? parsed.text : transcribedText;
            const commands = Array.isArray(parsed.commands) ? parsed.commands : [];

            if (this.debug) {
                console.log(`CrewAI extracted text: "${text}"`);
                console.log('CrewAI extracted commands:', commands);
            }

            // Normalize command strings to match our command mapping
            const normalizedCommands = commands.map(cmd => {
                if (!cmd || typeof cmd !== 'string') {
                    return null;
                }

                const normalized = cmd.toLowerCase().trim();

                // Check for common variations (tightened, no ambiguous phrases)
                const variations = {
                    'sent': 'enter',
                    'send': 'enter',
                    'send it': 'enter',
                    'send the message': 'enter',
                    'send this': 'enter',
                    'send this message': 'enter',
                    'post': 'enter',
                    'post this': 'enter',
                    'submit': 'enter',
                    'submit this': 'enter',
                    'return': 'enter',
                    'newline': 'enter',
                    'new line': 'enter',
                    'next line': 'enter',
                    'press enter': 'enter',
                    'press tab': 'tab',
                    'hit enter': 'enter',
                    'hit tab': 'tab',
                    'select all': 'ctrl+a',
                    'select everything': 'ctrl+a',
                    'copy': 'ctrl+c',
                    'copy it': 'ctrl+c',
                    'paste': 'ctrl+v',
                    'paste it': 'ctrl+v',
                    'cut': 'ctrl+x',
                    'cut it': 'ctrl+x',
                };

                if (variations[normalized]) {
                    return variations[normalized];
                }

                // Check if it's a direct command match in our mapping (exact match only)
                for (const [key, value] of Object.entries(this.commandMapping)) {
                    if (normalized === key) {
                        return value;
                    }
                }

                // Check if it's already in the correct format (e.g., "ctrl+a", "enter", "tab")
                if (normalized.includes('ctrl+') || normalized.includes('shift+') || normalized.includes('alt+')) {
                    return normalized;
                }

                // Whitelist of valid simple keys
                const validSimpleKeys = ['enter', 'tab', 'backspace', 'delete', 'space', 'escape', 'esc'];
                if (validSimpleKeys.includes(normalized)) {
                    return normalized;
                }

                // If we can't normalize it, return null to filter it out
                if (this.debug) {
                    console.warn(`WARNING: Could not normalize command: "${cmd}"`);
                }
                return null;
            }).filter(cmd => cmd !== null); // Remove any null values

            if (this.debug) {
                console.log('CrewAI normalized commands:', normalizedCommands);

                // Warn if commands were extracted but normalized to empty
                if (commands.length > 0 && normalizedCommands.length === 0) {
                    console.warn('WARNING: CrewAI extracted commands but normalization resulted in empty array!');
                    console.warn('Original commands:', commands);
                }
            }

            // TODO: Future enhancement
            // Support "sequence" output:
            // {
            //   "sequence": [
            //     { "type": "text", "value": "Hi Vikram." },
            //     { "type": "command", "value": "enter" },
            //     ...
            //   ]
            // }
            // For now we only use aggregated "text" and "commands".

            return {
                text: text.trim(),
                commands: normalizedCommands
            };

        } catch (error) {
            console.error('Error analyzing text with CrewAI:', error);
            // Fallback: return original text with no commands
            return {
                text: transcribedText,
                commands: []
            };
        }
    }

    /**
     * Check if CrewAI is enabled and ready
     * @returns {boolean}
     */
    isEnabled() {
        return this.enabled && this.groqClient !== undefined;
    }

    /**
     * Update configuration
     * @param {Object} newConfig - New configuration object
     */
    updateConfig(newConfig) {
        this.config = newConfig;
        this.enabled = newConfig.get('crewaiEnabled') || false;
        this.apiKey = newConfig.get('groqApiKey') || '';
        this.model = newConfig.get('crewaiModel') || 'llama-3.3-70b-versatile';
        this.debug = newConfig.get('crewaiDebug') || false;

        // Reinitialize Groq client if needed
        if (this.enabled && this.apiKey) {
            try {
                this.groqClient = new Groq({ apiKey: this.apiKey });
            } catch (error) {
                console.error('Error reinitializing Groq client:', error);
                this.enabled = false;
                this.groqClient = undefined;
            }
        } else {
            this.groqClient = undefined;
        }
    }
}

module.exports = CrewAIAgent;
