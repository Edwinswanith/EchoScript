const { BrowserWindow, session } = require('electron');
const { google } = require('googleapis');
const EventEmitter = require('events');
const jwt = require('jsonwebtoken');
const mongoDBService = require('./MongoDBService');

class AuthService extends EventEmitter {
  constructor() {
    super();
    this.oauth2Client = null;
    this.authWindow = null;
    this.currentUser = null;
    this.isAuthenticated = false;
    this.config = null;
  }

  initialize(config) {
    this.config = config;

    const oauth = config?.oauth || {};

    // Always attempt to load any existing session cookie, even if OAuth is not configured.
    this.loadSession();

    // If OAuth isn't configured, keep auth disabled but avoid runtime crashes.
    if (!oauth.clientId || !oauth.clientSecret) {
      this.oauth2Client = null;
      return;
    }

    // Use http://localhost as the redirect URI - we'll intercept it in the BrowserWindow
    const redirectUri = oauth.redirectUri || 'http://localhost';

    this.oauth2Client = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret, redirectUri);
  }

  isOAuthConfigured() {
    return !!this.oauth2Client;
  }

  assertOAuthConfigured() {
    if (this.oauth2Client) return;

    throw new Error(
      'Google sign-in is not configured. Please set oauth.clientId and oauth.clientSecret in config.js, then restart the app.'
    );
  }

  loadSession() {
    try {
      const userSession = session.defaultSession.cookies;
      userSession.get({ name: 'user_session' }).then(cookies => {
        if (cookies.length > 0) {
          const userData = JSON.parse(cookies[0].value);
          this.currentUser = userData;
          this.isAuthenticated = true;
          console.log('Session loaded:', userData.user_email);
          this.emit('authenticated', userData);
        }
      }).catch(err => {
        console.error('Error loading session:', err);
      });
    } catch (error) {
      console.error('Error loading session:', error);
    }
  }

  async saveSession(userData) {
    try {
      await session.defaultSession.cookies.set({
        url: 'http://localhost',
        name: 'user_session',
        value: JSON.stringify(userData),
        expirationDate: Date.now() / 1000 + 30 * 24 * 60 * 60
      });
      console.log('Session saved:', userData.user_email);
    } catch (error) {
      console.error('Error saving session:', error);
    }
  }

  async clearSession() {
    try {
      await session.defaultSession.cookies.remove('http://localhost', 'user_session');
      this.currentUser = null;
      this.isAuthenticated = false;
      console.log('Session cleared');
      this.emit('logout');
    } catch (error) {
      console.error('Error clearing session:', error);
    }
  }

  getAuthUrl() {
    this.assertOAuthConfigured();

    const scopes = [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  async authenticate() {
    return new Promise((resolve, reject) => {
      try {
        this.assertOAuthConfigured();
        const authUrl = this.getAuthUrl();
        let codeReceived = false;

        this.authWindow = new BrowserWindow({
          width: 500,
          height: 700,
          show: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        });

        // Intercept navigation to capture the authorization code
        this.authWindow.webContents.on('will-redirect', (event, navigationUrl) => {
          codeReceived = true;
          this.handleCallback(navigationUrl, event, resolve, reject);
        });

        this.authWindow.webContents.on('did-navigate', (event, navigationUrl) => {
          codeReceived = true;
          this.handleCallback(navigationUrl, event, resolve, reject);
        });

        // Handle window close - only reject if code wasn't received
        this.authWindow.on('closed', () => {
          if (!codeReceived) {
            reject(new Error('Authentication window was closed'));
          }
          this.authWindow = null;
        });

        this.authWindow.loadURL(authUrl);

      } catch (error) {
        console.error('Authentication error:', error);
        if (this.authWindow && !this.authWindow.isDestroyed()) {
          this.authWindow.close();
        }
        reject(error);
      }
    });
  }

  async handleCallback(navigationUrl, event, resolve, reject) {
    try {
      const url = new URL(navigationUrl);

      // Check if this is the callback URL with the authorization code
      if (url.searchParams.has('code')) {
        // Prevent the navigation
        if (event && event.preventDefault) {
          event.preventDefault();
        }

        const code = url.searchParams.get('code');
        console.log('Authorization code received');

        // Exchange code for tokens
        const { tokens } = await this.oauth2Client.getToken(code);
        this.oauth2Client.setCredentials(tokens);

        // Get user info
        const oauth2 = google.oauth2({
          auth: this.oauth2Client,
          version: 'v2'
        });

        const userInfo = await oauth2.userinfo.get();
        const userData = {
          user_name: userInfo.data.name,
          user_email: userInfo.data.email,
          google_id: userInfo.data.id
        };

        // Check if MongoDB is connected before creating profile
        if (!mongoDBService.isConnected) {
          // Close the auth window
          if (this.authWindow && !this.authWindow.isDestroyed()) {
            this.authWindow.close();
          }
          this.authWindow = null;
          
          const error = new Error('MongoDB is not connected. Please configure MongoDB connection in config.js to use authentication features.');
          console.error('MongoDB not connected - cannot create profile:', error);
          this.emit('auth-error', error);
          reject(error);
          return;
        }

        // Create/get profile from database
        const profile = await mongoDBService.createProfile(userData);

        const sessionData = {
          user_id: profile._id.toString(),
          user_name: profile.user_name,
          user_email: profile.user_email,
          is_admin: profile.is_admin
        };

        await this.saveSession(sessionData);
        this.currentUser = sessionData;
        this.isAuthenticated = true;

        console.log('Authentication successful:', userData.user_email);
        this.emit('authenticated', sessionData);

        // Close the auth window after successful authentication
        if (this.authWindow && !this.authWindow.isDestroyed()) {
          this.authWindow.close();
        }
        this.authWindow = null;

        resolve(sessionData);

      } else if (url.searchParams.has('error')) {
        const error = url.searchParams.get('error');
        console.error('OAuth error:', error);

        if (this.authWindow && !this.authWindow.isDestroyed()) {
          this.authWindow.close();
        }

        reject(new Error(`OAuth error: ${error}`));
      }
    } catch (error) {
      console.error('Error handling callback:', error);

      if (this.authWindow && !this.authWindow.isDestroyed()) {
        this.authWindow.close();
      }

      this.emit('auth-error', error);
      reject(error);
    }
  }

  async logout() {
    await this.clearSession();
    this.emit('logout');
  }

  getCurrentUser() {
    return this.currentUser;
  }

  isUserAuthenticated() {
    return this.isAuthenticated;
  }

  async getUserProfile() {
    if (!this.currentUser) {
      return null;
    }

    try {
      if (!mongoDBService.isConnected) {
        return null;
      }
      const profile = await mongoDBService.getProfileById(this.currentUser.user_id);
      return profile;
    } catch (error) {
      console.error('Error getting user profile:', error);
      return null;
    }
  }

  async getUserAccess() {
    if (!this.currentUser) {
      return null;
    }

    try {
      if (!mongoDBService.isConnected) {
        return null;
      }
      const access = await mongoDBService.getAccessByUserId(this.currentUser.user_id);
      return access;
    } catch (error) {
      console.error('Error getting user access:', error);
      return null;
    }
  }

  async checkPermission(feature) {
    if (!this.currentUser) {
      return false;
    }

    try {
      const access = await this.getUserAccess();
      if (!access) {
        return false;
      }

      // Normalize permission to boolean; support legacy "yes"/"no"
      const hasPermission = typeof access.permission === 'boolean'
        ? access.permission
        : access.permission === 'yes';

      if (!hasPermission) {
        return false;
      }

      if (feature === 'stt') {
        return access.stt_enabled === true;
      } else if (feature === 'tts') {
        return access.tts_enabled === true;
      }

      return false;
    } catch (error) {
      console.error('Error checking permission:', error);
      return false;
    }
  }

  async updateActivation(feature, enabled) {
    if (!this.currentUser) {
      throw new Error('User not authenticated');
    }

    try {
      const profile = await mongoDBService.getProfileById(this.currentUser.user_id);
      const access = await mongoDBService.getAccessByUserId(this.currentUser.user_id);

      if (!access) {
        throw new Error('Access record not found');
      }

      const updates = {};
      if (feature === 'stt') {
        updates.stt_enabled = enabled;
      } else if (feature === 'tts') {
        updates.tts_enabled = enabled;
      }

      await mongoDBService.updateAccess(access._id, updates);
      console.log(`${feature.toUpperCase()} activation updated:`, enabled);

      this.emit('activation-updated', { feature, enabled });
      return true;
    } catch (error) {
      console.error('Error updating activation:', error);
      throw error;
    }
  }

  /**
   * Generate JWT token for WebSocket authentication
   * @returns {string} JWT token
   */
  generateWebSocketToken() {
    if (!this.currentUser) {
      throw new Error('User not authenticated');
    }

    const jwtSecret = this.config?.websocket?.jwtSecret || 'echoscripts-jwt-secret-change-in-production-2024';

    const payload = {
      user_id: this.currentUser.user_id,
      user_email: this.currentUser.user_email,
      user_name: this.currentUser.user_name,
      is_admin: this.currentUser.is_admin || false
    };

    return jwt.sign(payload, jwtSecret, { expiresIn: '24h' });
  }

  /**
   * Verify JWT token (for WebSocket authentication)
   * @param {string} token - JWT token to verify
   * @returns {object|null} Decoded token payload or null if invalid
   */
  verifyWebSocketToken(token) {
    const jwtSecret = this.config?.websocket?.jwtSecret || 'echoscripts-jwt-secret-change-in-production-2024';

    try {
      return jwt.verify(token, jwtSecret);
    } catch (error) {
      console.error('Token verification failed:', error);
      return null;
    }
  }

  /**
   * Check if the current user is an admin
   * Reads from the profile database as the source of truth and syncs with session
   * @returns {Promise<boolean>} True if current user is admin, false otherwise
   */
  async isCurrentUserAdmin() {
    // No user logged in
    if (!this.currentUser) {
      console.log('[AuthService] isCurrentUserAdmin: No current user');
      return false;
    }

    try {
      // Fetch latest profile from database as source of truth
      const profile = await mongoDBService.getProfileById(this.currentUser.user_id);

      if (!profile) {
        console.error('[AuthService] isCurrentUserAdmin: Profile not found for user', this.currentUser.user_id);
        // Fall back to session data but log the issue
        return !!this.currentUser.is_admin;
      }

      // Sync the in-memory session with the profile value
      const isAdmin = !!profile.is_admin;
      if (this.currentUser.is_admin !== isAdmin) {
        console.log('[AuthService] Syncing is_admin status:', {
          sessionValue: this.currentUser.is_admin,
          profileValue: isAdmin
        });
        this.currentUser.is_admin = isAdmin;

        // Update the saved session cookie to keep it in sync
        await this.saveSession(this.currentUser);
      }

      return isAdmin;
    } catch (error) {
      console.error('[AuthService] Error checking admin status:', error);
      // Fall back to session data if profile cannot be loaded
      return !!this.currentUser.is_admin;
    }
  }
}

module.exports = new AuthService();
