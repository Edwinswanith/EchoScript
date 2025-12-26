const EventEmitter = require('events');
const mongoDBService = require('./MongoDBService');
const authService = require('./AuthService');

class TokenTracker extends EventEmitter {
  constructor() {
    super();
    this.enabled = false;
  }

  initialize() {
    this.enabled = true;
    console.log('TokenTracker initialized');
  }

  async trackDeepgramUsage(audioData) {
    if (!this.enabled) {
      console.log('TokenTracker not enabled');
      return { allowed: true };
    }

    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        console.log('No authenticated user');
        return { allowed: false, reason: 'Not authenticated' };
      }

      const limitCheck = await mongoDBService.checkTokenLimit(currentUser.user_id, 'deepgram');

      if (!limitCheck.allowed) {
        console.log('Deepgram token limit exceeded:', limitCheck);
        this.emit('limit-exceeded', {
          type: 'deepgram',
          userId: currentUser.user_id,
          ...limitCheck
        });
        return limitCheck;
      }

      return { allowed: true };

    } catch (error) {
      console.error('Error checking Deepgram limit:', error);
      return { allowed: true, reason: 'Error checking limit' };
    }
  }

  async recordDeepgramUsage(durationSeconds, metadata = {}) {
    if (!this.enabled) return;

    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        console.log('No authenticated user for recording');
        return;
      }

      const tokensUsed = this.estimateDeepgramTokens(durationSeconds);

      await mongoDBService.recordTokenUsage(currentUser.user_id, 'deepgram', tokensUsed);

      console.log(`Recorded Deepgram usage: ${tokensUsed} tokens (${durationSeconds.toFixed(2)}s)`);

      this.emit('tokens-recorded', {
        type: 'deepgram',
        userId: currentUser.user_id,
        tokens: tokensUsed,
        duration: durationSeconds,
        metadata
      });

    } catch (error) {
      console.error('Error recording Deepgram usage:', error);
      await mongoDBService.createLog(authService.getCurrentUser()?.user_id, `Error recording Deepgram usage: ${error.message}`);
    }
  }

  estimateDeepgramTokens(durationSeconds) {
    const charactersPerSecond = 15;
    const tokensPerCharacter = 0.25;

    const estimatedCharacters = durationSeconds * charactersPerSecond;
    const estimatedTokens = Math.ceil(estimatedCharacters * tokensPerCharacter);

    return estimatedTokens;
  }

  async trackAgentUsage(requestData) {
    if (!this.enabled) {
      console.log('TokenTracker not enabled');
      return { allowed: true };
    }

    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        console.log('No authenticated user');
        return { allowed: false, reason: 'Not authenticated' };
      }

      const limitCheck = await mongoDBService.checkTokenLimit(currentUser.user_id, 'agent');

      if (!limitCheck.allowed) {
        console.log('Agent token limit exceeded:', limitCheck);
        this.emit('limit-exceeded', {
          type: 'agent',
          userId: currentUser.user_id,
          ...limitCheck
        });
        return limitCheck;
      }

      return { allowed: true };

    } catch (error) {
      console.error('Error checking Agent limit:', error);
      return { allowed: true, reason: 'Error checking limit' };
    }
  }

  async recordAgentUsage(tokensUsed, metadata = {}) {
    if (!this.enabled) return;

    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        console.log('No authenticated user for recording');
        return;
      }

      await mongoDBService.recordTokenUsage(currentUser.user_id, 'agent', tokensUsed);

      console.log(`Recorded Agent usage: ${tokensUsed} tokens`);

      this.emit('tokens-recorded', {
        type: 'agent',
        userId: currentUser.user_id,
        tokens: tokensUsed,
        metadata
      });

    } catch (error) {
      console.error('Error recording Agent usage:', error);
      await mongoDBService.createLog(authService.getCurrentUser()?.user_id, `Error recording Agent usage: ${error.message}`);
    }
  }

  extractGeminiTokens(response) {
    try {
      if (response && response.usageMetadata) {
        const promptTokens = response.usageMetadata.promptTokenCount || 0;
        const completionTokens = response.usageMetadata.candidatesTokenCount || 0;
        const totalTokens = response.usageMetadata.totalTokenCount || promptTokens + completionTokens;

        return {
          promptTokens,
          completionTokens,
          totalTokens
        };
      }

      return null;
    } catch (error) {
      console.error('Error extracting Gemini tokens:', error);
      return null;
    }
  }

  async logEvent(userId, event, details = {}) {
    try {
      const logMessage = `[${event}] ${JSON.stringify(details)}`;
      await mongoDBService.createLog(userId, logMessage);
    } catch (error) {
      console.error('Error logging event:', error);
    }
  }

  async getUserStats(userId) {
    try {
      const profile = await mongoDBService.getProfileById(userId);
      const todayUsage = await mongoDBService.getTodayTokenUsage(userId);
      const limits = await mongoDBService.getLimitByUserId(userId);

      return {
        total: {
          deepgram: profile?.deepgram || 0,
          agent: profile?.agent || 0
        },
        today: {
          deepgram: todayUsage?.deepgram || 0,
          agent: todayUsage?.agent || 0
        },
        limits: {
          deepgram: limits?.deepgram_token_list || [],
          agent: limits?.agent_token_list || []
        }
      };
    } catch (error) {
      console.error('Error getting user stats:', error);
      return null;
    }
  }

  disable() {
    this.enabled = false;
    console.log('TokenTracker disabled');
  }

  enable() {
    this.enabled = true;
    console.log('TokenTracker enabled');
  }

  isEnabled() {
    return this.enabled;
  }
}

module.exports = new TokenTracker();
