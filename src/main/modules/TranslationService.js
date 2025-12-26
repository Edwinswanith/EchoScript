const EventEmitter = require('events');
const Groq = require('groq-sdk');

/**
 * TranslationService - Detects language and translates to English
 * Uses Groq API for language detection and translation
 */
class TranslationService extends EventEmitter {
    constructor(config) {
        super();

        this.config = config;
        this.enabled = false;
        this.groqClient = null;
        this.model = null;

        this.initialize();
    }

    /**
     * Initialize the translation service
     */
    initialize() {
        const translationConfig = this.config.get('translation');
        const groqApiKey = this.config.get('groqApiKey');

        // Check if translation is enabled in config
        if (!translationConfig || !translationConfig.enabled) {
            console.log('[TranslationService] Translation is disabled in configuration');
            this.enabled = false;
            return;
        }

        // Check if Groq API key is available
        if (!groqApiKey) {
            console.warn('[TranslationService] Translation enabled but Groq API key not found');
            console.warn('[TranslationService] Please set groqApiKey in config.js to enable translation');
            this.enabled = false;
            return;
        }

        try {
            this.groqClient = new Groq({ apiKey: groqApiKey });
            this.model = translationConfig.model || 'llama-3.3-70b-versatile';
            this.enabled = true;
            console.log('[TranslationService] Initialized successfully');
        } catch (error) {
            console.error('[TranslationService] Initialization error:', error);
            this.enabled = false;
        }
    }

    /**
     * Check if translation service is enabled
     * @returns {boolean}
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Detect language and translate to English
     * @param {string} text - Text to translate
     * @returns {Promise<Object>} - { originalText, detectedLanguage, translatedText, isEnglish }
     */
    async translateToEnglish(text) {
        if (!this.enabled) {
            return {
                originalText: text,
                detectedLanguage: 'unknown',
                translatedText: text,
                isEnglish: true,
                error: 'Translation service not enabled'
            };
        }

        if (!text || text.trim().length === 0) {
            return {
                originalText: text,
                detectedLanguage: 'unknown',
                translatedText: text,
                isEnglish: true
            };
        }

        try {
            console.log(`[TranslationService] Processing text: "${text}"`);

            const prompt = `You are a language detection and translation expert. Your task is to:
1. Detect the language of the input text
2. If the text is NOT in English, translate it to English
3. If the text is already in English, return it as-is

Input text: "${text}"

Respond ONLY with a valid JSON object in this exact format (no markdown, no code blocks):
{
  "detectedLanguage": "language name (e.g., Telugu, Hindi, Spanish, English)",
  "languageCode": "ISO 639-1 code (e.g., te, hi, es, en)",
  "isEnglish": true or false,
  "translatedText": "English translation or original text if already English"
}

Examples:
Input: "నేను ఇంటికి వెళ్తున్నాను"
Output: {"detectedLanguage":"Telugu","languageCode":"te","isEnglish":false,"translatedText":"I am going home"}

Input: "मैं घर जा रहा हूं"
Output: {"detectedLanguage":"Hindi","languageCode":"hi","isEnglish":false,"translatedText":"I am going home"}

Input: "I am going home"
Output: {"detectedLanguage":"English","languageCode":"en","isEnglish":true,"translatedText":"I am going home"}

Now process the input text above.`;

            const result = await this.groqClient.chat.completions.create({
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                model: this.model,
                temperature: 0.2,
                response_format: { type: 'json_object' }
            });

            const responseText = result.choices[0]?.message?.content?.trim() || '';
            console.log(`[TranslationService] Raw response: ${responseText}`);

            // Parse JSON response
            let parsedResponse;
            try {
                // Remove markdown code blocks if present
                const cleanedResponse = responseText
                    .replace(/```json\n?/g, '')
                    .replace(/```\n?/g, '')
                    .trim();

                parsedResponse = JSON.parse(cleanedResponse);
            } catch (parseError) {
                console.error('[TranslationService] JSON parse error:', parseError);
                console.error('[TranslationService] Response text:', responseText);

                // Fallback: assume text is English and return as-is
                return {
                    originalText: text,
                    detectedLanguage: 'unknown',
                    languageCode: 'unknown',
                    translatedText: text,
                    isEnglish: true,
                    error: 'Failed to parse translation response'
                };
            }

            const result_obj = {
                originalText: text,
                detectedLanguage: parsedResponse.detectedLanguage || 'unknown',
                languageCode: parsedResponse.languageCode || 'unknown',
                translatedText: parsedResponse.translatedText || text,
                isEnglish: parsedResponse.isEnglish === true
            };

            if (!result_obj.isEnglish) {
                console.log(`[TranslationService] Detected ${result_obj.detectedLanguage} → Translated to English: "${result_obj.translatedText}"`);
            } else {
                console.log(`[TranslationService] Text is already in English`);
            }

            this.emit('translated', result_obj);
            return result_obj;

        } catch (error) {
            console.error('[TranslationService] Translation error:', error);

            // Return original text on error
            return {
                originalText: text,
                detectedLanguage: 'unknown',
                languageCode: 'unknown',
                translatedText: text,
                isEnglish: true,
                error: error.message
            };
        }
    }

    /**
     * Batch translate multiple texts
     * @param {Array<string>} texts - Array of texts to translate
     * @returns {Promise<Array<Object>>} - Array of translation results
     */
    async batchTranslate(texts) {
        if (!Array.isArray(texts) || texts.length === 0) {
            return [];
        }

        const results = [];
        for (const text of texts) {
            const result = await this.translateToEnglish(text);
            results.push(result);
        }
        return results;
    }
}

module.exports = TranslationService;
