const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const GroqSTTClient = require('./GroqSTTClient');
const ElevenLabsSTTClient = require('./ElevenLabsSTTClient');
const MicrophoneManager = require('./MicrophoneManager');
const CommandParser = require('./CommandParser');
const TextInjector = require('./TextInjector');
const IndicatorManager = require('./IndicatorManager');
const TriggerWordDetector = require('./TriggerWordDetector');
const CrewAIAgent = require('./CrewAIAgent');
const TranslationService = require('./TranslationService');
const authService = require('./AuthService');
const tokenTracker = require('./TokenTracker');
const mongoDBService = require('./MongoDBService');

/**
 * SpeechRecognitionController - Orchestrates the entire speech-to-text workflow
 */
class SpeechRecognitionController extends EventEmitter {
    constructor(config, indicatorManager = null) {
        super();

        this.config = config;
        this.state = 'idle'; // idle, listening, background_listening, processing, error
        this.backgroundListening = false;

        // Initialize STT client based on provider
        const sttConfig = config.getSTTConfig();
        if (sttConfig.provider === 'elevenlabs') {
            console.log('[SpeechRecognitionController] Using ElevenLabs for STT');
            this.sttClient = new ElevenLabsSTTClient(sttConfig);
        } else {
            console.log('[SpeechRecognitionController] Using Groq Whisper for STT');
            this.sttClient = new GroqSTTClient(config.getGroqSTTConfig());
        }
        this.microphoneManager = new MicrophoneManager();
        this.commandParser = new CommandParser();
        this.textInjector = new TextInjector(config.get('typingSpeed'));
        this.triggerWordDetector = new TriggerWordDetector(config);
        this.crewAIAgent = new CrewAIAgent(config);
        this.translationService = new TranslationService(config);

        // Use provided indicator manager or create new one
        if (indicatorManager) {
            this.indicatorManager = indicatorManager;
            this.isSharedIndicator = true;
        } else {
            this.indicatorManager = new IndicatorManager(config);
            this.indicatorManager.createWindow();
            this.isSharedIndicator = false;
        }

        // Transcription buffer for interim results
        this.lastInterimText = '';
        this.finalTextBuffer = '';

        // Log file path
        this.logFilePath = this.getLogFilePath();

        // Setup event listeners
        this.setupEventListeners();

        // Start background listening if enabled
        if (config.get('backgroundListening')) {
            this.startBackgroundListening();
        }
    }

    /**
     * Setup event listeners for all modules
     */
    setupEventListeners() {
        // Microphone events
        this.microphoneManager.on('audioData', (audioData) => {
            this.handleAudioData(audioData);
        });

        this.microphoneManager.on('audioLevel', (level) => {
            this.handleAudioLevel(level);
        });

        this.microphoneManager.on('error', (error) => {
            console.error('Microphone error:', error);
            
            // Check if it's a device not found error
            if (error.message && error.message.includes('device not found')) {
                console.warn('Microphone device not found - speech recognition features will be unavailable');
                console.warn('TTS and other features will still work');
                
                // If in background listening, gracefully stop it
                if (this.backgroundListening) {
                    this.stopBackgroundListening().catch(err => {
                        console.error('Error stopping background listening:', err);
                    });
                }
                
                // Set state to idle instead of error
                this.setState('idle');
                this.indicatorManager.idle();
                
                // Emit a specific event for missing microphone
                this.emit('microphoneUnavailable', error);
            } else {
                // For other errors, use standard error handling
                this.handleError(error);
            }
        });

        // Deepgram events
        this.sttClient.on('transcription', (data) => {
            this.handleTranscription(data);
        });

        this.sttClient.on('error', (error) => {
            console.error('Deepgram error:', error);
            this.handleError(error);
        });

        this.sttClient.on('close', () => {
            console.log('Deepgram connection closed');
        });
    }

    /**
     * Start speech recognition
     */
    async start() {
        try {
            console.log('[SpeechRecognitionController] Start requested, current state:', this.state);

            if (this.state === 'listening') {
                console.warn('[SpeechRecognitionController] Already listening, ignoring start request');
                return;
            }

            // Check authentication and activation
            if (!authService.isUserAuthenticated()) {
                const error = new Error('User not authenticated. Please login to use speech recognition.');
                console.error('[SpeechRecognitionController] Authentication check failed');
                this.emit('authenticationRequired');
                throw error;
            }

            const hasPermission = await authService.checkPermission('stt');
            if (!hasPermission) {
                const error = new Error('STT feature not activated. Please activate STT in the dashboard.');
                console.error('[SpeechRecognitionController] STT not activated for user');
                this.emit('activationRequired', 'stt');
                throw error;
            }

            // Check token limits before starting
            const limitCheck = await tokenTracker.trackDeepgramUsage();
            if (!limitCheck.allowed) {
                const error = new Error(`Token limit exceeded: ${limitCheck.reason}`);
                console.error('[SpeechRecognitionController] Token limit exceeded:', limitCheck);
                this.emit('tokenLimitExceeded', limitCheck);
                throw error;
            }

            // Stop background listening if active (when manually starting)
            if (this.backgroundListening) {
                console.log('[SpeechRecognitionController] Stopping background listening first...');
                await this.stopBackgroundListening();
            }

            console.log('[SpeechRecognitionController] Starting speech recognition...');
            this.setState('listening');

            // Update indicator to listening state
            this.indicatorManager.listening();

            // Reset buffers
            this.lastInterimText = '';
            this.finalTextBuffer = '';
            console.log('[SpeechRecognitionController] Buffers reset');

            // Start Deepgram session
            console.log('[SpeechRecognitionController] Starting Deepgram session...');
            await this.sttClient.startSession();
            console.log('[SpeechRecognitionController] Deepgram session started');

            // Start microphone
            console.log('[SpeechRecognitionController] Starting microphone...');
            this.microphoneManager.start();

            this.emit('started');
            console.log('[SpeechRecognitionController] Speech recognition started successfully');
        } catch (error) {
            console.error('[SpeechRecognitionController] Error starting speech recognition:', error);
            console.error('[SpeechRecognitionController] Error stack:', error.stack);
            this.handleError(error);
            throw error;
        }
    }

    /**
     * Stop speech recognition
     */
    async stop() {
        try {
            console.log('[SpeechRecognitionController] Stop requested, current state:', this.state);

            if (this.state === 'idle') {
                console.warn('[SpeechRecognitionController] Not currently listening, ignoring stop request');
                return;
            }

            console.log('[SpeechRecognitionController] Stopping speech recognition...');

            // Stop microphone
            console.log('[SpeechRecognitionController] Stopping microphone...');
            this.microphoneManager.stop();

            // Stop Deepgram session
            console.log('[SpeechRecognitionController] Stopping Deepgram session...');
            await this.sttClient.stopSession();

            this.setState('idle');

            // Update indicator to idle state
            this.indicatorManager.idle();

            this.emit('stopped');

            console.log('[SpeechRecognitionController] Speech recognition stopped successfully');
        } catch (error) {
            console.error('[SpeechRecognitionController] Error stopping speech recognition:', error);
            console.error('[SpeechRecognitionController] Error stack:', error.stack);
            this.handleError(error);
        }
    }

    /**
     * Handle audio data from microphone
     * @param {Buffer} audioData - Audio buffer
     */
    handleAudioData(audioData) {
        if (this.state !== 'listening' && this.state !== 'background_listening') {
            console.warn('[SpeechRecognitionController] Received audio data but not in listening state:', this.state);
            return;
        }

        if (!this.sttClient.isSessionActive()) {
            console.warn('[SpeechRecognitionController] Received audio data but Deepgram session is not active');
            return;
        }

        // Send audio to Deepgram
        const success = this.sttClient.sendAudio(audioData);
        if (!success) {
            console.error('[SpeechRecognitionController] Failed to send audio data to Deepgram');
        }
    }

    /**
     * Handle audio level from microphone
     * @param {number} level - Audio level (0.0 to 1.0)
     */
    handleAudioLevel(level) {
        if (this.state === 'listening') {
            // Update indicator with audio level for visualization
            this.indicatorManager.detecting(level);
        }
    }

    /**
     * Get log file path
     * @returns {string} Path to log.txt file
     */
    getLogFilePath() {
        if (app.isPackaged) {
            // Production: use user data directory
            return path.join(app.getPath('userData'), 'log.txt');
        } else {
            // Development: use project root
            return path.join(__dirname, '../../../log.txt');
        }
    }

    /**
     * Write transcription to log file
     * @param {string} text - Transcribed text
     * @param {boolean} isFinal - Whether this is a final transcription
     */
    writeToLog(text, isFinal) {
        try {
            if (!text || text.trim().length === 0) {
                return;
            }

            const timestamp = new Date().toISOString();
            const type = isFinal ? 'FINAL' : 'INTERIM';
            const logEntry = `[${timestamp}] [${type}] ${text}\n`;

            // Append to log file (create if doesn't exist)
            fs.appendFileSync(this.logFilePath, logEntry, 'utf8');
        } catch (error) {
            console.error('[SpeechRecognitionController] Error writing to log file:', error);
            // Don't throw - logging failure shouldn't break transcription
        }
    }

    /**
     * Write command execution to log file
     * @param {string|string[]} commands - Command(s) executed
     * @param {string} originalText - Original transcription that triggered the command(s)
     */
    writeCommandToLog(commands, originalText = '') {
        try {
            if (!commands) {
                return;
            }

            const timestamp = new Date().toISOString();
            const commandArray = Array.isArray(commands) ? commands : [commands];
            
            // Log each command in order
            for (const command of commandArray) {
                if (command && command.trim().length > 0) {
                    const logEntry = `[${timestamp}] [COMMAND] ${command}${originalText ? ` (from: "${originalText}")` : ''}\n`;
                    fs.appendFileSync(this.logFilePath, logEntry, 'utf8');
                }
            }
        } catch (error) {
            console.error('[SpeechRecognitionController] Error writing command to log file:', error);
            // Don't throw - logging failure shouldn't break command execution
        }
    }

    /**
     * Handle transcription from Deepgram
     * @param {Object} data - Transcription data
     */
    async handleTranscription(data) {
        try {
            const { text, isFinal, confidence } = data;

            console.log(`Transcription [${isFinal ? 'FINAL' : 'INTERIM'}]: "${text}" (confidence: ${confidence})`);

            // Write to log file in real-time
            this.writeToLog(text, isFinal);

            if (isFinal) {
                // Process final transcription - Only FINAL results reach processFinalTranscription
                // This ensures the agent only receives complete sentences/phrases after user pauses
                await this.processFinalTranscription(text, true);
                this.lastInterimText = '';

                // Also write final text to MongoDB log collection (best-effort)
                try {
                    const currentUser = authService.getCurrentUser();
                    if (currentUser && text && text.trim().length > 0) {
                        await mongoDBService.createLog(currentUser.user_id, `[STT FINAL] ${text}`);
                    }
                } catch (dbErr) {
                    console.error('[SpeechRecognitionController] Error writing final text to DB log:', dbErr);
                }
            } else {
                // Update interim transcription - These are NEVER sent to the agent
                // INTERIM results are partial, in-progress text while user is still speaking
                this.lastInterimText = text;
                this.emit('interim', text);
            }
        } catch (error) {
            console.error('Error handling transcription:', error);
            this.handleError(error);
        }
    }

    /**
     * Process final transcription
     *
     * IMPORTANT: This method ONLY processes FINAL transcriptions from Deepgram.
     * - FINAL transcriptions occur when the user pauses or ends a sentence
     * - INTERIM transcriptions (partial, in-progress text) are NEVER processed here
     * - The agent receives only complete phrases/sentences, not partial chunks
     *
     * @param {string} text - Transcribed text (complete phrase/sentence)
     * @param {boolean} isFinal - Must be true; validates this is a FINAL transcription
     */
    async processFinalTranscription(text, isFinal = true) {
        // Guard: Ensure only FINAL transcriptions reach this method
        if (!isFinal) {
            console.error('ERROR: processFinalTranscription called with interim result!');
            console.error('This should NEVER happen - only FINAL transcriptions should reach this method');
            return;
        }

        if (!text || text.trim().length === 0) {
            return;
        }

        // Check for trigger words first (only if in background listening mode)
        if (this.state === 'background_listening' && this.triggerWordDetector.isEnabled()) {
            const triggerResult = this.triggerWordDetector.detect(text);

            if (triggerResult) {
                console.log(`Trigger word detected:`, triggerResult);

                if (triggerResult.type === 'activate') {
                    // Activate voice typing
                    console.log(`Activating voice typing with trigger word: "${triggerResult.word}"`);
                    await this.stopBackgroundListening();
                    await this.start();
                    this.emit('triggerActivated', triggerResult);
                    return;
                }

                if (triggerResult.type === 'deactivate') {
                    // Deactivate voice typing
                    console.log(`Deactivating voice typing with phrase: "${triggerResult.phrase}"`);
                    await this.stop();
                    this.emit('triggerDeactivated', triggerResult);
                    return;
                }
            }

            // If in background listening and no trigger word, ignore the text
            return;
        }

        // Check for deactivate phrase when actively listening
        if (this.state === 'listening' && this.triggerWordDetector.isEnabled()) {
            const triggerResult = this.triggerWordDetector.detect(text);

            if (triggerResult && triggerResult.type === 'deactivate') {
                console.log(`Deactivating voice typing with phrase: "${triggerResult.phrase}"`);
                await this.stop();
                this.emit('triggerDeactivated', triggerResult);
                return;
            }
        }

        // Update indicator to processing state
        this.indicatorManager.processing('text');

        // Translate to English if translation is enabled
        let processedText = text;
        if (this.translationService.isEnabled()) {
            try {
                console.log(`[Translation] Original text: "${text}"`);
                this.indicatorManager.processing('translation');

                const translationResult = await this.translationService.translateToEnglish(text);

                if (translationResult && !translationResult.isEnglish) {
                    processedText = translationResult.translatedText;
                    console.log(`[Translation] ${translationResult.detectedLanguage} → English: "${processedText}"`);

                    // Log translation to file
                    this.writeToLog(`[TRANSLATION] ${translationResult.detectedLanguage} → English`, true);
                    this.writeToLog(`Original: ${text}`, true);
                    this.writeToLog(`Translated: ${processedText}`, true);

                    // Emit translation event
                    this.emit('translated', {
                        original: text,
                        translated: processedText,
                        language: translationResult.detectedLanguage
                    });
                } else {
                    console.log(`[Translation] Text is already in English, no translation needed`);
                }
            } catch (error) {
                console.error('[Translation] Error during translation, using original text:', error);
                // Continue with original text on error
            }
        }

        // Use processedText (translated or original) for further processing
        text = processedText;

        // Check if CrewAI is enabled and use it for intelligent command extraction
        if (this.crewAIAgent.isEnabled()) {
            try {
                // IMPORTANT: Only FINAL transcriptions reach this point
                // The agent receives complete sentences/phrases (after user pauses)
                // INTERIM transcriptions (partial, in-progress) are NEVER sent to the agent
                console.log(`[FINAL] Processing complete transcription for agent: "${text}"`);
                this.indicatorManager.processing('crewai');

                const analysis = await this.crewAIAgent.analyze(text);
                
                console.log(`CrewAI analysis result:`, JSON.stringify(analysis, null, 2));

                // Type the extracted text content if any
                if (analysis.text && analysis.text.trim().length > 0) {
                    const textToType = this.finalTextBuffer.length > 0 ? ' ' + analysis.text : analysis.text;
                    console.log(`Typing text: "${textToType}"`);
                    await this.textInjector.typeText(textToType);
                    this.finalTextBuffer += textToType;
                }

                // Execute commands in sequence
                if (analysis.commands && analysis.commands.length > 0) {
                    console.log(`Executing ${analysis.commands.length} command(s):`, analysis.commands);
                    this.indicatorManager.processing('command');

                    // Log commands to file
                    this.writeCommandToLog(analysis.commands, text);

                    for (const command of analysis.commands) {
                        await this.textInjector.executeCommand(command);

                        // Reset buffer after newline commands to prevent extra space on next line
                        if (command === 'enter' || command.toLowerCase() === 'enter') {
                            this.finalTextBuffer = '';
                        }

                        // Small delay between commands
                        await this.delay(100);
                    }

                    this.emit('command', {
                        commands: analysis.commands,
                        originalText: text
                    });
                }

                // Show success indicator
                this.indicatorManager.success();
                this.emit('text', analysis.text || text);
                return;

            } catch (error) {
                console.error('Error processing with CrewAI, falling back to standard processing:', error);
                console.error('Error details:', error.message, error.stack);
                // Fall through to standard processing
            }
        } else {
            if (!this.crewAIAgent.isEnabled()) {
                const crewAIEnabled = this.config.get('crewaiEnabled');
                const hasApiKey = !!this.config.get('groqApiKey');
                
                if (!crewAIEnabled) {
                    console.log('CrewAI: Disabled in config, using standard command parser');
                } else if (!hasApiKey) {
                    console.log('CrewAI: Enabled but OpenAI API key not configured, using standard command parser');
                } else {
                    console.log('CrewAI: Initialization failed, using standard command parser');
                }
            }
        }

        // Standard processing (fallback or when CrewAI is disabled)
        // Check if voice commands are enabled
        const voiceCommandsEnabled = this.config.get('voiceCommands');

        if (voiceCommandsEnabled) {
            // First check if entire text is a command
            const parsed = this.commandParser.parse(text);

            if (parsed.type === 'command') {
                console.log(`Executing command: ${parsed.value}`);
                this.indicatorManager.processing('command');

                // Log command to file
                this.writeCommandToLog(parsed.value, parsed.originalText);

                await this.textInjector.executeCommand(parsed.value);

                // Reset buffer after newline commands to prevent extra space on next line
                if (parsed.value === 'enter') {
                    this.finalTextBuffer = '';
                }

                this.indicatorManager.success();
                this.emit('command', { command: parsed.value, originalText: parsed.originalText });
                return;
            }

            // Check if text ends with a command word (e.g., "hello sent" -> type "hello" then execute "enter")
            // Order matters: check multi-word commands first, then single-word commands
            const commandWords = ['new line', 'select all', 'question mark', 'exclamation mark', 'exclamation point', 
                                  'open parenthesis', 'close parenthesis', 'open bracket', 'close bracket',
                                  'sent', 'send', 'enter', 'return', 'tab', 'backspace', 'delete'];
            const normalizedText = text.toLowerCase().trim();
            
            for (const commandWord of commandWords) {
                // For multi-word commands, check if text ends with the command phrase
                // For single-word commands, use word boundary
                let regex;
                if (commandWord.includes(' ')) {
                    // Multi-word command: match phrase at end (with optional punctuation)
                    const escapedPhrase = commandWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    regex = new RegExp(`${escapedPhrase}\\s*[.!?,;:]*$`, 'i');
                } else {
                    // Single-word command: use word boundary
                    const escapedWord = commandWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    regex = new RegExp(`\\b${escapedWord}\\s*[.!?,;:]*$`, 'i');
                }
                
                if (regex.test(normalizedText)) {
                    // Extract text before command
                    // Find the command phrase in normalized text, then use same position in original text
                    const normalizedCommandWord = commandWord.toLowerCase();
                    const commandIndex = normalizedText.lastIndexOf(normalizedCommandWord);
                    if (commandIndex === -1) continue; // Should not happen if regex matched, but safety check
                    const textBeforeCommand = text.substring(0, commandIndex).trim();
                    
                    // Get command action from CommandParser
                    const commandParsed = this.commandParser.parse(commandWord);
                    if (commandParsed.type === 'command') {
                        // Type the text before command (if any)
                        if (textBeforeCommand) {
                            const textToType = this.finalTextBuffer.length > 0 ? ' ' + textBeforeCommand : textBeforeCommand;
                            console.log(`Typing text: "${textToType}"`);
                            await this.textInjector.typeText(textToType);
                            this.finalTextBuffer += textToType;
                        }
                        
                        // Execute the command
                        console.log(`Executing command: ${commandParsed.value}`);
                        this.indicatorManager.processing('command');

                        // Log command to file
                        this.writeCommandToLog(commandParsed.value, text);

                        await this.textInjector.executeCommand(commandParsed.value);

                        // Reset buffer after newline commands to prevent extra space on next line
                        if (commandParsed.value === 'enter') {
                            this.finalTextBuffer = '';
                        }

                        this.indicatorManager.success();
                        this.emit('command', { command: commandParsed.value, originalText: text });
                        return;
                    }
                }
            }
        }

        // Not a command, type the text
        console.log(`Typing text: "${text}"`);

        // Add space before new text if not first word
        const textToType = this.finalTextBuffer.length > 0 ? ' ' + text : text;

        await this.textInjector.typeText(textToType);
        this.finalTextBuffer += textToType;

        // Show success indicator
        this.indicatorManager.success();

        this.emit('text', text);
    }

    /**
     * Handle errors
     * @param {Error} error - Error object
     */
    handleError(error) {
        this.setState('error');

        // Update indicator to error state
        this.indicatorManager.error(error.message);

        this.emit('error', error);

        // Attempt to stop and cleanup
        this.stop().catch(err => {
            console.error('Error during cleanup:', err);
        });
    }

    /**
     * Set state
     * @param {string} newState - New state
     */
    setState(newState) {
        const oldState = this.state;
        this.state = newState;
        this.emit('stateChange', { oldState, newState });
    }

    /**
     * Get current state
     * @returns {string}
     */
    getState() {
        return this.state;
    }

    /**
     * Toggle recognition (start if idle, stop if listening)
     */
    async toggle() {
        if (this.state === 'idle') {
            await this.start();
        } else {
            await this.stop();
        }
    }

    /**
     * Update configuration
     * @param {Object} newConfig - New configuration
     */
    updateConfig(newConfig) {
        this.config = newConfig;

        // Update modules
        this.sttClient.updateConfig(newConfig.getGroqSTTConfig());
        this.textInjector.setTypingSpeed(newConfig.get('typingSpeed'));
        this.crewAIAgent.updateConfig(newConfig);
    }

    /**
     * Start background listening for trigger words
     */
    async startBackgroundListening() {
        try {
            if (this.backgroundListening) {
                console.warn('Already in background listening mode');
                return;
            }

            console.log('Starting background listening for trigger words...');
            this.backgroundListening = true;
            this.setState('background_listening');

            // Reset buffers
            this.lastInterimText = '';
            this.finalTextBuffer = '';

            // Start Deepgram session
            await this.sttClient.startSession();

            // Start microphone (will emit error if device not found)
            this.microphoneManager.start();

            // Wait a moment to see if microphone starts successfully
            await this.delay(1000);

            // Check if we're still in background listening (microphone error handler might have stopped it)
            if (!this.backgroundListening) {
                console.log('Background listening cancelled due to microphone unavailability');
                return;
            }

            this.emit('backgroundListeningStarted');
            console.log('Background listening started');
        } catch (error) {
            console.error('Error starting background listening:', error);
            
            // Don't treat microphone errors as fatal
            if (error.message && error.message.includes('device not found')) {
                this.backgroundListening = false;
                this.setState('idle');
                this.indicatorManager.idle();
                console.warn('Background listening disabled: No microphone device found');
                this.emit('microphoneUnavailable', error);
            } else {
                this.handleError(error);
                throw error;
            }
        }
    }

    /**
     * Stop background listening
     */
    async stopBackgroundListening() {
        try {
            if (!this.backgroundListening) {
                return;
            }

            console.log('Stopping background listening...');

            // Stop microphone
            this.microphoneManager.stop();

            // Stop Deepgram session
            await this.sttClient.stopSession();

            this.backgroundListening = false;
            this.setState('idle');

            this.emit('backgroundListeningStopped');
            console.log('Background listening stopped');
        } catch (error) {
            console.error('Error stopping background listening:', error);
            this.handleError(error);
        }
    }

    /**
     * Check if in background listening mode
     * @returns {boolean}
     */
    isBackgroundListening() {
        return this.backgroundListening;
    }

    /**
     * Delay helper
     * @param {number} ms - Milliseconds
     * @returns {Promise}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        this.stop().catch(err => {
            console.error('Error during cleanup:', err);
        });

        this.stopBackgroundListening().catch(err => {
            console.error('Error stopping background listening:', err);
        });

        // Clean up STT client temp files
        if (this.sttClient && typeof this.sttClient.cleanupAllTempFiles === 'function') {
            this.sttClient.cleanupAllTempFiles();
        }

        // Cleanup indicator only if not shared
        if (this.indicatorManager && !this.isSharedIndicator) {
            this.indicatorManager.destroy();
        }

        this.removeAllListeners();
        this.sttClient.removeAllListeners();
        this.microphoneManager.removeAllListeners();
    }
}

module.exports = SpeechRecognitionController;
