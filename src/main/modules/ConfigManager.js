const path = require('path');
const { app } = require('electron');

/**
 * ConfigManager - Manages application configuration using config.js file
 */
class ConfigManager {
  constructor() {
    // Load configuration from config.js in the application root
    const configPath = this.getConfigPath();

    try {
      // Clear require cache to get fresh config
      delete require.cache[require.resolve(configPath)];
      this.config = require(configPath);
      console.log('Configuration loaded from:', configPath);
    } catch (error) {
      console.error('Error loading config.js:', error);
      console.error('Please ensure config.js exists in the application directory');

      // Use default configuration if config.js is not found
      this.config = this.getDefaultConfig();
    }
  }

  /**
   * Get the path to config.js
   * @returns {string} Absolute path to config.js
   */
  getConfigPath() {
    // In production, config.js should be in the app root directory
    // In development, it's in the project root
    if (app.isPackaged) {
      // Production: look in the app.asar.unpacked or installation directory
      return path.join(process.resourcesPath, 'config.js');
    } else {
      // Development: look in project root
      return path.join(__dirname, '../../../config.js');
    }
  }

  /**
   * Get default configuration
   * @returns {Object} Default configuration object
   */
  getDefaultConfig() {
    return {
      groqApiKey: '',
      elevenlabsApiKey: '',
      hotkey: 'CommandOrControl+Shift+S',
      autoLaunch: false,
      language: 'auto',
      voiceCommands: true,
      typingSpeed: 50,
      showFloatingUI: false,
      sttModel: 'whisper-large-v3',
      bufferDuration: 3000,
      customCommands: {},
      tts: {
        enabled: true,
        hotkey: 'CommandOrControl+Shift+T',
        voice: 'EXAVITQu4vr4xnSDxMaL',
        model: 'eleven_multilingual_v2'
      }
    };
  }

  /**
   * Get a configuration value
   * @param {string} key - Configuration key
   * @returns {*} Configuration value
   */
  get(key) {
    return this.config[key];
  }

  /**
   * Set a configuration value (in-memory only)
   * Note: Changes are not persisted to config.js file
   * @param {string} key - Configuration key
   * @param {*} value - Configuration value
   */
  set(key, value) {
    this.config[key] = value;
    console.log(`Configuration updated: ${key} = ${value}`);
  }

  /**
   * Get all configuration
   * @returns {Object} All configuration
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * Reset configuration to defaults (in-memory only)
   */
  reset() {
    this.config = this.getDefaultConfig();
  }

  /**
   * Reload configuration from config.js file
   */
  reload() {
    const configPath = this.getConfigPath();

    try {
      // Clear require cache to get fresh config
      delete require.cache[require.resolve(configPath)];
      this.config = require(configPath);
      console.log('Configuration reloaded from:', configPath);
    } catch (error) {
      console.error('Error reloading config.js:', error);
    }
  }

  /**
   * Check if API key is configured
   * @returns {boolean}
   */
  hasApiKey() {
    const groqApiKey = this.get('groqApiKey');
    const elevenlabsApiKey = this.get('elevenlabsApiKey');
    return (groqApiKey && groqApiKey.length > 0) || (elevenlabsApiKey && elevenlabsApiKey.length > 0);
  }

  /**
   * Validate configuration
   * @returns {Object} Validation result
   */
  validate() {
    const errors = [];

    const groqApiKey = this.get('groqApiKey');
    const elevenlabsApiKey = this.get('elevenlabsApiKey');

    if (!groqApiKey || groqApiKey.length === 0) {
      errors.push('Groq API key is not configured in config.js (required for STT)');
    }

    if (!elevenlabsApiKey || elevenlabsApiKey.length === 0) {
      errors.push('ElevenLabs API key is not configured in config.js (required for TTS)');
    }

    const typingSpeed = this.get('typingSpeed');
    if (typingSpeed < 0 || typingSpeed > 1000) {
      errors.push('Typing speed must be between 0-1000ms');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get STT configuration (supports both ElevenLabs and Groq)
   * @returns {Object} STT settings
   */
  getSTTConfig() {
    const provider = this.get('sttProvider') || 'elevenlabs';

    if (provider === 'elevenlabs') {
      return {
        provider: 'elevenlabs',
        apiKey: this.get('elevenlabsApiKey'),
        model: this.get('sttModel') || 'eleven_multilingual_v2',
        language: this.get('language') || 'auto',
        bufferDuration: this.get('bufferDuration') || 3000
      };
    } else {
      return {
        provider: 'groq',
        apiKey: this.get('groqApiKey'),
        model: this.get('sttModel') || 'whisper-large-v3',
        language: this.get('language') || 'auto',
        bufferDuration: this.get('bufferDuration') || 3000
      };
    }
  }

  /**
   * Get Groq STT configuration (backward compatibility)
   * @returns {Object} Groq Whisper STT settings
   */
  getGroqSTTConfig() {
    return {
      apiKey: this.get('groqApiKey'),
      model: 'whisper-large-v3',
      language: this.get('language') || 'auto',
      bufferDuration: this.get('bufferDuration') || 3000
    };
  }

  /**
   * Get TTS configuration
   * @returns {Object} TTS settings
   */
  getTTSSettings() {
    const ttsConfig = this.get('tts') || {};
    return {
      hotkey: ttsConfig.hotkey || 'CommandOrControl+Shift+T',
      voice: ttsConfig.voice || 'EXAVITQu4vr4xnSDxMaL',
      model: ttsConfig.model || 'eleven_multilingual_v2',
      enabled: ttsConfig.enabled !== false
    };
  }
}

module.exports = ConfigManager;
