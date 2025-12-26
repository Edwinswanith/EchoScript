const WebSocket = require('ws');
const EventEmitter = require('events');
const jwt = require('jsonwebtoken');

class WebSocketServer extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.clients = new Map(); // userId -> Set of WebSocket connections
    this.config = null;
    this.authService = null;
    this.heartbeatInterval = null;
    this.jwtSecret = null;
  }

  initialize(config, authService) {
    this.config = config;
    this.authService = authService;
    this.jwtSecret = config.websocket?.jwtSecret || 'echoscripts-default-secret-change-in-production';

    if (!config.websocket?.enabled) {
      console.log('[WebSocketServer] WebSocket is disabled in config');
      return;
    }

    const port = config.websocket?.port || 8080;

    try {
      this.wss = new WebSocket.Server({
        port,
        clientTracking: true
      });

      this.setupConnectionHandler();
      this.startHeartbeat();

      console.log(`[WebSocketServer] WebSocket server listening on port ${port}`);
      this.emit('initialized');
    } catch (error) {
      console.error('[WebSocketServer] Failed to start WebSocket server:', error);
      this.emit('error', error);
    }
  }

  setupConnectionHandler() {
    this.wss.on('connection', (ws, request) => {
      console.log('[WebSocketServer] New connection attempt');

      // Extract token from query string or headers
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get('token') || request.headers['authorization']?.replace('Bearer ', '');

      if (!token) {
        console.log('[WebSocketServer] Connection rejected: No authentication token');
        ws.close(4001, 'Authentication required');
        return;
      }

      // Verify token and extract user info
      let userData;
      try {
        userData = jwt.verify(token, this.jwtSecret);
        console.log('[WebSocketServer] Token verified for user:', userData.user_email);
      } catch (error) {
        console.log('[WebSocketServer] Connection rejected: Invalid token');
        ws.close(4002, 'Invalid authentication token');
        return;
      }

      // Setup client metadata
      ws.userId = userData.user_id;
      ws.userEmail = userData.user_email;
      ws.isAdmin = userData.is_admin || false;
      ws.isAlive = true;

      // Add to clients map
      if (!this.clients.has(ws.userId)) {
        this.clients.set(ws.userId, new Set());
      }
      this.clients.get(ws.userId).add(ws);

      console.log(`[WebSocketServer] Client authenticated: ${ws.userEmail} (Total connections: ${this.wss.clients.size})`);

      // Send welcome message
      this.sendToClient(ws, {
        type: 'connection:established',
        data: {
          userId: ws.userId,
          timestamp: Date.now()
        }
      });

      // Setup message handler
      ws.on('message', (message) => {
        this.handleClientMessage(ws, message);
      });

      // Setup pong handler for heartbeat
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // Setup close handler
      ws.on('close', () => {
        this.handleClientDisconnect(ws);
      });

      // Setup error handler
      ws.on('error', (error) => {
        console.error('[WebSocketServer] Client error:', error);
      });

      this.emit('client:connected', { userId: ws.userId, userEmail: ws.userEmail });
    });

    this.wss.on('error', (error) => {
      console.error('[WebSocketServer] Server error:', error);
      this.emit('error', error);
    });
  }

  handleClientMessage(ws, message) {
    try {
      const data = JSON.parse(message.toString());
      console.log(`[WebSocketServer] Message from ${ws.userEmail}:`, data.type);

      // Emit event for other modules to handle
      this.emit('client:message', {
        userId: ws.userId,
        userEmail: ws.userEmail,
        isAdmin: ws.isAdmin,
        message: data
      });

      // Handle specific message types
      switch (data.type) {
        case 'ping':
          this.sendToClient(ws, { type: 'pong', timestamp: Date.now() });
          break;

        case 'subscribe':
          // Client wants to subscribe to specific event channels
          ws.subscriptions = ws.subscriptions || new Set();
          if (data.channels && Array.isArray(data.channels)) {
            data.channels.forEach(channel => ws.subscriptions.add(channel));
            this.sendToClient(ws, {
              type: 'subscribed',
              data: { channels: Array.from(ws.subscriptions) }
            });
          }
          break;

        case 'unsubscribe':
          // Client wants to unsubscribe from specific event channels
          if (ws.subscriptions && data.channels && Array.isArray(data.channels)) {
            data.channels.forEach(channel => ws.subscriptions.delete(channel));
            this.sendToClient(ws, {
              type: 'unsubscribed',
              data: { channels: Array.from(ws.subscriptions) }
            });
          }
          break;

        default:
          // Forward to application logic via event
          this.emit(`message:${data.type}`, {
            userId: ws.userId,
            userEmail: ws.userEmail,
            isAdmin: ws.isAdmin,
            data: data.data
          });
      }
    } catch (error) {
      console.error('[WebSocketServer] Error handling client message:', error);
      this.sendToClient(ws, {
        type: 'error',
        data: { message: 'Invalid message format' }
      });
    }
  }

  handleClientDisconnect(ws) {
    console.log(`[WebSocketServer] Client disconnected: ${ws.userEmail}`);

    // Remove from clients map
    if (this.clients.has(ws.userId)) {
      this.clients.get(ws.userId).delete(ws);
      if (this.clients.get(ws.userId).size === 0) {
        this.clients.delete(ws.userId);
      }
    }

    this.emit('client:disconnected', { userId: ws.userId, userEmail: ws.userEmail });
  }

  startHeartbeat() {
    const interval = this.config.websocket?.heartbeatInterval || 30000;

    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          console.log(`[WebSocketServer] Terminating inactive client: ${ws.userEmail}`);
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, interval);

    console.log(`[WebSocketServer] Heartbeat started (interval: ${interval}ms)`);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('[WebSocketServer] Heartbeat stopped');
    }
  }

  // Send message to specific client
  sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // Send message to specific user (all their connections)
  sendToUser(userId, message) {
    const userConnections = this.clients.get(userId);
    if (!userConnections) {
      return 0;
    }

    let sentCount = 0;
    userConnections.forEach((ws) => {
      if (this.sendToClient(ws, message)) {
        sentCount++;
      }
    });

    return sentCount;
  }

  // Broadcast to all connected clients
  broadcast(message, filter = null) {
    let sentCount = 0;

    this.wss.clients.forEach((ws) => {
      // Apply filter if provided
      if (filter && !filter(ws)) {
        return;
      }

      // Check if client is subscribed to this message type (if subscriptions enabled)
      if (ws.subscriptions && ws.subscriptions.size > 0) {
        if (!ws.subscriptions.has(message.type)) {
          return;
        }
      }

      if (this.sendToClient(ws, message)) {
        sentCount++;
      }
    });

    return sentCount;
  }

  // Broadcast to all admins
  broadcastToAdmins(message) {
    return this.broadcast(message, (ws) => ws.isAdmin === true);
  }

  // Generate JWT token for WebSocket authentication
  generateToken(userData) {
    const payload = {
      user_id: userData.user_id,
      user_email: userData.user_email,
      user_name: userData.user_name,
      is_admin: userData.is_admin || false
    };

    return jwt.sign(payload, this.jwtSecret, { expiresIn: '24h' });
  }

  // Verify JWT token
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      return null;
    }
  }

  // Get connection statistics
  getStats() {
    return {
      totalConnections: this.wss ? this.wss.clients.size : 0,
      uniqueUsers: this.clients.size,
      clients: Array.from(this.clients.entries()).map(([userId, connections]) => ({
        userId,
        connectionCount: connections.size,
        connections: Array.from(connections).map(ws => ({
          userEmail: ws.userEmail,
          isAdmin: ws.isAdmin,
          isAlive: ws.isAlive,
          subscriptions: ws.subscriptions ? Array.from(ws.subscriptions) : []
        }))
      }))
    };
  }

  // Shutdown WebSocket server
  async shutdown() {
    console.log('[WebSocketServer] Shutting down...');

    this.stopHeartbeat();

    if (this.wss) {
      // Notify all clients about shutdown
      this.broadcast({
        type: 'server:shutdown',
        data: { message: 'Server is shutting down' }
      });

      // Close all client connections
      this.wss.clients.forEach((ws) => {
        ws.close(1001, 'Server shutting down');
      });

      // Close server
      return new Promise((resolve) => {
        this.wss.close(() => {
          console.log('[WebSocketServer] Server closed');
          this.wss = null;
          this.clients.clear();
          resolve();
        });
      });
    }
  }
}

module.exports = new WebSocketServer();
