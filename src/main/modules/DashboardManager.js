const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const authService = require('./AuthService');
const mongoDBService = require('./MongoDBService');

class DashboardManager {
  constructor() {
    this.dashboardWindow = null;
    this.currentPage = 'login';
  }

  initialize() {
    this.setupIpcHandlers();
    console.log('DashboardManager initialized');
  }

  createWindow() {
    if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
      this.dashboardWindow.focus();
      return this.dashboardWindow;
    }

    try {
      this.dashboardWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, '../preload-dashboard.js'),
          devTools: true
        },
        autoHideMenuBar: false,
        show: true,
        // __dirname = src/main/modules (dev). Prefer icon.png; print-*.png in assets is actually WebP.
        icon: path.join(__dirname, '../../../assets/icon.png')
      });

      // Open DevTools for debugging
      this.dashboardWindow.webContents.openDevTools();

      const isAuthenticated = authService.isUserAuthenticated();
      if (isAuthenticated) {
        this.showDashboard();
      } else {
        this.showLogin();
      }

      this.dashboardWindow.on('close', () => {
        // On Windows/Linux, closing the dashboard should quit the entire app
        if (process.platform !== 'darwin') {
          console.log('[DashboardManager] Dashboard window closing - triggering app shutdown...');
          const { app } = require('electron');

          // Trigger cleanup and quit
          // Use setImmediate to let the close event complete first
          setImmediate(() => {
            app.quit();
          });
        }
      });

      this.dashboardWindow.on('closed', () => {
        this.dashboardWindow = null;
      });

      console.log('Dashboard window created successfully');
      return this.dashboardWindow;
    } catch (error) {
      console.error('Error creating dashboard window:', error);
      throw error;
    }
  }

  showLogin() {
    if (!this.dashboardWindow || this.dashboardWindow.isDestroyed()) {
      this.createWindow();
      return;
    }

    const loginPath = path.join(__dirname, '../../renderer/dashboard/login.html');
    this.dashboardWindow.loadFile(loginPath);
    this.currentPage = 'login';
    console.log('Showing login page');
  }

  showDashboard() {
    if (!this.dashboardWindow || this.dashboardWindow.isDestroyed()) {
      this.createWindow();
      return;
    }

    const dashboardPath = path.join(__dirname, '../../renderer/dashboard/dashboard.html');
    this.dashboardWindow.loadFile(dashboardPath);
    this.currentPage = 'dashboard';
    console.log('Showing dashboard');
  }

  showActivation() {
    // Activation is now integrated into dashboard.html
    // Just show the dashboard and let the client-side handle view switching
    if (!this.dashboardWindow || this.dashboardWindow.isDestroyed()) {
      this.createWindow();
      return;
    }

    // Check if we need to load dashboard.html or just focus
    if (this.currentPage !== 'dashboard') {
      this.showDashboard();
    } else {
      // Just focus the window, client-side JS will handle showing activation view
      this.dashboardWindow.focus();
    }
    console.log('Showing dashboard (activation view handled client-side)');
  }

  async showAdmin() {
    if (!this.dashboardWindow || this.dashboardWindow.isDestroyed()) {
      this.createWindow();
      return;
    }

    // Check if current user is admin using the centralized helper
    const isAdmin = await authService.isCurrentUserAdmin();

    if (!isAdmin) {
      console.log('[DashboardManager] Access denied: User is not an admin');
      return;
    }

    const adminPath = path.join(__dirname, '../../renderer/dashboard/admin.html');
    this.dashboardWindow.loadFile(adminPath);
    this.currentPage = 'admin';
    console.log('[DashboardManager] Showing admin page');
  }

  closeWindow() {
    if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
      this.dashboardWindow.close();
    }
  }

  setupIpcHandlers() {
    ipcMain.handle('auth:login', async () => {
      try {
        // Avoid sending the user through OAuth just to fail after callback when DB is down.
        // Auth features are DB-backed (profile/access/limits).
        if (!mongoDBService.isConnected) {
          return {
            success: false,
            error: 'MongoDB is not connected. Please fix MongoDB connection (Atlas Network Access / cluster state) and try again.'
          };
        }
        const userData = await authService.authenticate();
        return { success: true, user: userData };
      } catch (error) {
        console.error('Login error:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('auth:logout', async () => {
      try {
        await authService.logout();
        this.showLogin();
        return { success: true };
      } catch (error) {
        console.error('Logout error:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('auth:getCurrentUser', async () => {
      try {
        const user = authService.getCurrentUser();
        if (!user) {
          return { success: false, error: 'Not authenticated' };
        }

        // If MongoDB is down, return a safe fallback profile so the renderer doesn't crash.
        if (!mongoDBService.isConnected) {
          const fallbackProfile = {
            user_name: user.user_name || 'User',
            user_email: user.user_email || '',
            deepgram: 0,
            agent: 0,
            is_admin: !!user.is_admin
          };
          return {
            success: true,
            user,
            profile: fallbackProfile,
            access: null,
            degraded: { reason: 'no-database', message: 'MongoDB is not connected' }
          };
        }

        const profile = await authService.getUserProfile();
        const access = await authService.getUserAccess();
        return { success: true, user, profile, access };
      } catch (error) {
        console.error('Get current user error:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('auth:checkPermission', async (event, feature) => {
      try {
        const hasPermission = await authService.checkPermission(feature);
        return { success: true, hasPermission };
      } catch (error) {
        console.error('Check permission error:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('auth:updateActivation', async (event, feature, enabled) => {
      try {
        await authService.updateActivation(feature, enabled);
        return { success: true };
      } catch (error) {
        console.error('Update activation error:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('dashboard:navigate', async (event, page) => {
      try {
        switch (page) {
          case 'login':
            this.showLogin();
            break;
          case 'dashboard':
            this.showDashboard();
            break;
          case 'activation':
            this.showActivation();
            break;
          case 'admin':
            this.showAdmin();
            break;
          default:
            return { success: false, error: 'Invalid page' };
        }
        return { success: true };
      } catch (error) {
        console.error('Navigation error:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('admin:getAllUsers', async () => {
      try {
        // Guard: Check if current user is admin
        const isAdmin = await authService.isCurrentUserAdmin();
        if (!isAdmin) {
          console.error('[DashboardManager] admin:getAllUsers - Access denied');
          return { success: false, error: 'Access denied: Admin privileges required' };
        }

        const profiles = await mongoDBService.getAllProfiles();
        const usersWithAccess = await Promise.all(
          profiles.map(async (profile) => {
            // Normalize IDs to strings for renderer safety
            const profileId = profile._id?.toString ? profile._id.toString() : profile._id;
            const access = await mongoDBService.getAccessByUserId(profile._id);
            const limit = await mongoDBService.getLimitByUserId(profile._id);
            return {
              ...profile,
              _id: profileId,
              access,
              limit
            };
          })
        );
        return { success: true, users: usersWithAccess };
      } catch (error) {
        console.error('Get all users error:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('admin:updateUserPermission', async (event, userId, permission) => {
      try {
        // Guard: Check if current user is admin
        const isAdmin = await authService.isCurrentUserAdmin();
        if (!isAdmin) {
          console.error('[DashboardManager] admin:updateUserPermission - Access denied');
          return { success: false, error: 'Access denied: Admin privileges required' };
        }

        const access = await mongoDBService.getAccessByUserId(userId);
        if (!access) {
          return { success: false, error: 'Access record not found' };
        }

        // Normalize incoming permission to boolean; accept legacy strings
        const normalizedPermission = typeof permission === 'boolean'
          ? permission
          : permission === 'yes' || permission === 'true';

        await mongoDBService.updateAccess(access._id, { permission: normalizedPermission });
        return { success: true };
      } catch (error) {
        console.error('Update user permission error:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('admin:updateUserLimits', async (event, userId, deepgramLimits, agentLimits) => {
      try {
        // Guard: Check if current user is admin
        const isAdmin = await authService.isCurrentUserAdmin();
        if (!isAdmin) {
          console.error('[DashboardManager] admin:updateUserLimits - Access denied');
          return { success: false, error: 'Access denied: Admin privileges required' };
        }

        const limit = await mongoDBService.getLimitByUserId(userId);
        if (!limit) {
          return { success: false, error: 'Limit record not found' };
        }
        await mongoDBService.updateLimit(limit._id, {
          deepgram_token_list: deepgramLimits,
          agent_token_list: agentLimits
        });
        return { success: true };
      } catch (error) {
        console.error('Update user limits error:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('admin:updateUserActivation', async (event, userId, feature, enabled) => {
      try {
        console.log('[DashboardManager] admin:updateUserActivation called:', { userId, feature, enabled });

        // Guard: Check if current user is admin
        const isAdmin = await authService.isCurrentUserAdmin();
        if (!isAdmin) {
          console.error('[DashboardManager] admin:updateUserActivation - Access denied');
          return { success: false, error: 'Access denied: Admin privileges required' };
        }

        const access = await mongoDBService.getAccessByUserId(userId);
        if (!access) {
          console.error('[DashboardManager] Access record not found for user:', userId);
          return { success: false, error: 'Access record not found' };
        }

        // Update the appropriate feature
        const updates = {};
        if (feature === 'stt') {
          updates.stt_enabled = enabled;
        } else if (feature === 'tts') {
          updates.tts_enabled = enabled;
        } else {
          return { success: false, error: 'Invalid feature type' };
        }

        console.log('[DashboardManager] Updating access:', { accessId: access._id, updates });
        await mongoDBService.updateAccess(access._id, updates);
        console.log('[DashboardManager] Access updated successfully');

        return { success: true };
      } catch (error) {
        console.error('[DashboardManager] Update user activation error:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('token:getUsage', async (event, userId, startDate, endDate) => {
      try {
        const usage = await mongoDBService.getTokenUsageByDate(userId, startDate, endDate);
        return { success: true, usage };
      } catch (error) {
        console.error('Get token usage error:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('token:getTodayUsage', async (event, userId) => {
      try {
        const usage = await mongoDBService.getTodayTokenUsage(userId);
        return { success: true, usage };
      } catch (error) {
        console.error('Get today token usage error:', error);
        return { success: false, error: error.message };
      }
    });

    // WebSocket IPC Handlers
    ipcMain.handle('websocket:getToken', async () => {
      try {
        // Check if WebSocket is enabled in config
        const config = require('../../../config');
        if (!config.websocket?.enabled) {
          return { success: false, reason: 'disabled', message: 'WebSocket is disabled in configuration' };
        }

        // Check if user is authenticated
        if (!authService.isUserAuthenticated()) {
          return { success: false, reason: 'not-authenticated', message: 'User is not authenticated' };
        }

        const token = authService.generateWebSocketToken();
        return { success: true, token };
      } catch (error) {
        console.error('[DashboardManager] WebSocket token generation failed:', error.message);
        return { success: false, reason: 'error', message: error.message };
      }
    });

    ipcMain.handle('websocket:getServerUrl', async () => {
      try {
        // Check if WebSocket is enabled in config
        const config = require('../../../config');
        if (!config.websocket?.enabled) {
          return { success: false, reason: 'disabled', message: 'WebSocket is disabled in configuration' };
        }

        const port = config.websocket?.port || 8080;
        return { success: true, url: `ws://localhost:${port}` };
      } catch (error) {
        console.error('[DashboardManager] WebSocket server URL retrieval failed:', error.message);
        return { success: false, reason: 'error', message: error.message };
      }
    });
  }

  setWebSocketServer(webSocketServer) {
    this.webSocketServer = webSocketServer;
  }
}

module.exports = new DashboardManager();
