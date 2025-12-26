const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Authentication methods
  auth: {
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getCurrentUser: () => ipcRenderer.invoke('auth:getCurrentUser'),
    checkPermission: (feature) => ipcRenderer.invoke('auth:checkPermission', feature),
    updateActivation: (feature, enabled) => ipcRenderer.invoke('auth:updateActivation', feature, enabled)
  },

  // Dashboard navigation
  dashboard: {
    navigate: (page) => ipcRenderer.invoke('dashboard:navigate', page)
  },

  // Admin methods
  admin: {
    getAllUsers: () => ipcRenderer.invoke('admin:getAllUsers'),
    updateUserPermission: (userId, permission) => ipcRenderer.invoke('admin:updateUserPermission', userId, permission),
    updateUserLimits: (userId, deepgramLimits, agentLimits) => ipcRenderer.invoke('admin:updateUserLimits', userId, deepgramLimits, agentLimits),
    updateUserActivation: (userId, feature, enabled) => ipcRenderer.invoke('admin:updateUserActivation', userId, feature, enabled)
  },

  // STT microphone control (no DB changes)
  stt: {
    start: () => ipcRenderer.invoke('stt:start'),
    stop: () => ipcRenderer.invoke('stt:stop')
  },

  // TTS control (no DB changes)
  tts: {
    setEnabled: (enabled) => ipcRenderer.invoke('tts:setEnabled', enabled)
  },

  // Token usage methods
  token: {
    getUsage: (userId, startDate, endDate) => ipcRenderer.invoke('token:getUsage', userId, startDate, endDate),
    getTodayUsage: (userId) => ipcRenderer.invoke('token:getTodayUsage', userId)
  },

  // WebSocket methods
  websocket: {
    getToken: () => ipcRenderer.invoke('websocket:getToken'),
    getServerUrl: () => ipcRenderer.invoke('websocket:getServerUrl')
  }
});
