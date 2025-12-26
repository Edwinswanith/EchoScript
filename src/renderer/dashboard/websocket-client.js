/**
 * WebSocket Client for Real-Time Dashboard Updates
 * Connects to the WebSocket server in the main process
 * Handles authentication, reconnection, and event subscriptions
 */

class WebSocketClient extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.token = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectInterval = 5000;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.isConnecting = false;
    this.isIntentionalClose = false;
    this.subscriptions = new Set();
    this.messageQueue = []; // Queue messages while offline
  }

  /**
   * Connect to WebSocket server with authentication token
   * @param {string} token - JWT authentication token
   * @param {string} serverUrl - WebSocket server URL (default: ws://localhost:8080)
   */
  async connect(token, serverUrl = 'ws://localhost:8080') {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      console.log('[WebSocketClient] Already connected or connecting');
      return;
    }

    this.token = token;
    this.isConnecting = true;
    this.isIntentionalClose = false;

    try {
      console.log('[WebSocketClient] Connecting to:', serverUrl);

      // Add token to URL query string
      const wsUrl = `${serverUrl}?token=${encodeURIComponent(token)}`;
      this.ws = new WebSocket(wsUrl);

      this.setupEventHandlers();
    } catch (error) {
      console.error('[WebSocketClient] Connection error:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  setupEventHandlers() {
    this.ws.onopen = () => {
      console.log('[WebSocketClient] Connected to WebSocket server');
      this.isConnecting = false;
      this.reconnectAttempts = 0;

      // Update connection status in UI
      this.updateConnectionStatus('connected');

      // Send queued messages
      this.flushMessageQueue();

      // Re-subscribe to channels after reconnection
      if (this.subscriptions.size > 0) {
        this.subscribe(Array.from(this.subscriptions));
      }

      // Start heartbeat
      this.startHeartbeat();

      // Emit connection event
      this.dispatchEvent(new CustomEvent('connected'));
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[WebSocketClient] Received:', message.type);

        // Handle specific message types
        switch (message.type) {
          case 'connection:established':
            console.log('[WebSocketClient] Connection confirmed by server');
            break;

          case 'pong':
            // Heartbeat response
            break;

          case 'subscribed':
            console.log('[WebSocketClient] Subscribed to channels:', message.data.channels);
            break;

          case 'unsubscribed':
            console.log('[WebSocketClient] Unsubscribed from channels:', message.data.channels);
            break;

          case 'server:shutdown':
            console.log('[WebSocketClient] Server is shutting down');
            this.isIntentionalClose = true;
            break;

          case 'error':
            console.error('[WebSocketClient] Server error:', message.data.message);
            this.dispatchEvent(new CustomEvent('error', { detail: message.data }));
            break;

          default:
            // Emit custom event for this message type
            this.dispatchEvent(new CustomEvent(message.type, { detail: message.data }));
            this.dispatchEvent(new CustomEvent('message', { detail: message }));
        }
      } catch (error) {
        console.error('[WebSocketClient] Error parsing message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocketClient] WebSocket error:', error);
      this.updateConnectionStatus('error');
      this.dispatchEvent(new CustomEvent('error', { detail: error }));
    };

    this.ws.onclose = (event) => {
      console.log('[WebSocketClient] Disconnected. Code:', event.code, 'Reason:', event.reason);
      this.isConnecting = false;

      this.stopHeartbeat();
      this.updateConnectionStatus('disconnected');

      this.dispatchEvent(new CustomEvent('disconnected', {
        detail: { code: event.code, reason: event.reason }
      }));

      // Reconnect unless it was intentional or authentication failed
      if (!this.isIntentionalClose && event.code !== 4001 && event.code !== 4002) {
        this.scheduleReconnect();
      } else if (event.code === 4001 || event.code === 4002) {
        console.error('[WebSocketClient] Authentication failed. Please log in again.');
        this.dispatchEvent(new CustomEvent('auth-failed'));
      }
    };
  }

  /**
   * Subscribe to specific event channels
   * @param {string|string[]} channels - Channel name(s) to subscribe to
   */
  subscribe(channels) {
    const channelArray = Array.isArray(channels) ? channels : [channels];
    channelArray.forEach(channel => this.subscriptions.add(channel));

    if (this.isConnected()) {
      this.send({
        type: 'subscribe',
        channels: channelArray
      });
    }
  }

  /**
   * Unsubscribe from specific event channels
   * @param {string|string[]} channels - Channel name(s) to unsubscribe from
   */
  unsubscribe(channels) {
    const channelArray = Array.isArray(channels) ? channels : [channels];
    channelArray.forEach(channel => this.subscriptions.delete(channel));

    if (this.isConnected()) {
      this.send({
        type: 'unsubscribe',
        channels: channelArray
      });
    }
  }

  /**
   * Send message to server
   * @param {object} message - Message object to send
   */
  send(message) {
    if (this.isConnected()) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for later
      console.log('[WebSocketClient] Queuing message (offline):', message.type);
      this.messageQueue.push(message);
    }
  }

  /**
   * Send queued messages after reconnection
   */
  flushMessageQueue() {
    if (this.messageQueue.length > 0) {
      console.log(`[WebSocketClient] Flushing ${this.messageQueue.length} queued messages`);
      this.messageQueue.forEach(message => this.send(message));
      this.messageQueue = [];
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: 'ping', timestamp: Date.now() });
      }
    }, 25000); // Send ping every 25 seconds
  }

  /**
   * Stop heartbeat timer
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Schedule automatic reconnection
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocketClient] Max reconnection attempts reached');
      this.updateConnectionStatus('failed');
      this.dispatchEvent(new CustomEvent('reconnect-failed'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.min(this.reconnectAttempts, 3); // Exponential backoff (max 3x)

    console.log(`[WebSocketClient] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.updateConnectionStatus('reconnecting', this.reconnectAttempts);

    this.reconnectTimer = setTimeout(() => {
      if (this.token) {
        this.connect(this.token);
      }
    }, delay);
  }

  /**
   * Update connection status indicator in UI
   */
  updateConnectionStatus(status, reconnectAttempt = 0) {
    const statusElement = document.getElementById('ws-status');
    if (!statusElement) return;

    statusElement.className = 'ws-status ws-' + status;

    let statusText = '';
    let statusColor = '';

    switch (status) {
      case 'connected':
        statusText = '● Connected';
        statusColor = '#10b981';
        break;
      case 'disconnected':
        statusText = '● Disconnected';
        statusColor = '#ef4444';
        break;
      case 'reconnecting':
        statusText = `● Reconnecting (${reconnectAttempt}/${this.maxReconnectAttempts})`;
        statusColor = '#f59e0b';
        break;
      case 'error':
        statusText = '● Connection Error';
        statusColor = '#ef4444';
        break;
      case 'failed':
        statusText = '● Connection Failed';
        statusColor = '#991b1b';
        break;
      default:
        statusText = '● Unknown';
        statusColor = '#6b7280';
    }

    statusElement.textContent = statusText;
    statusElement.style.color = statusColor;
  }

  /**
   * Check if WebSocket is connected
   * @returns {boolean}
   */
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    this.isIntentionalClose = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.updateConnectionStatus('disconnected');
  }

  /**
   * Helper method to listen to specific event types
   * @param {string} eventType - Event type to listen for
   * @param {function} callback - Callback function
   */
  on(eventType, callback) {
    this.addEventListener(eventType, (event) => {
      callback(event.detail);
    });
  }

  /**
   * Remove event listener
   * @param {string} eventType - Event type
   * @param {function} callback - Callback function
   */
  off(eventType, callback) {
    this.removeEventListener(eventType, callback);
  }
}

// Export singleton instance
window.wsClient = new WebSocketClient();
