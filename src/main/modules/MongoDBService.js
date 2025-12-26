const { MongoClient, ObjectId } = require('mongodb');
const EventEmitter = require('events');

class MongoDBService extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.db = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.changeStreams = {
      profile: null,
      access: null,
      limit: null,
      token_usage: null
    };
  }

  async connect(connectionString, databaseName, options = {}) {
    try {
      if (this.isConnected) {
        console.log('MongoDB already connected');
        return true;
      }

      console.log('Connecting to MongoDB...');

      const serverSelectionTimeoutMS =
        typeof options.serverSelectionTimeoutMS === 'number'
          ? options.serverSelectionTimeoutMS
          : 15000; // Increased timeout for slower connections

      const socketTimeoutMS =
        typeof options.socketTimeoutMS === 'number'
          ? options.socketTimeoutMS
          : 45000;

      // Keep options minimal for Atlas. SRV (`mongodb+srv://`) handles TLS automatically.
      // Only allow explicit TLS overrides if the user set them in config.js.
      const clientOptions = {
        serverSelectionTimeoutMS,
        socketTimeoutMS,
        // Add retry options for better connection handling
        retryWrites: true,
        retryReads: true,
        // Add connection pool settings
        maxPoolSize: 10,
        minPoolSize: 2,
        // Force IPv4 to avoid IPv6 issues
        family: 4
      };

      if (typeof options.tlsAllowInvalidCertificates === 'boolean') {
        clientOptions.tlsAllowInvalidCertificates = options.tlsAllowInvalidCertificates;
      }

      // Allow family override if explicitly set
      if (typeof options.family === 'number') {
        clientOptions.family = options.family;
      }

      this.client = new MongoClient(connectionString, clientOptions);

      await this.client.connect();
      this.db = this.client.db(databaseName);
      this.isConnected = true;
      this.reconnectAttempts = 0;

      console.log('MongoDB connected successfully');

      // Initialize database collections and indexes
      await this.initializeDatabase();

      this.emit('connected');
      return true;
    } catch (error) {
      console.error('MongoDB connection error:', error);
      this.isConnected = false;
      this.emit('error', error);

      // Check if it's an SSL/TLS error
      const isSSLError = error.message && (
        error.message.includes('TLSV1_ALERT_INTERNAL_ERROR') ||
        error.message.includes('SSL') ||
        error.message.includes('TLS') ||
        error.message.includes('tlsv1 alert internal error') ||
        (error.cause && error.cause.code === 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR')
      );

      if (isSSLError) {
        console.error('\n=== MongoDB SSL/TLS Connection Error ===');
        console.error('Error code:', error.cause?.code || 'Unknown');
        console.error('\nMost common causes and solutions:\n');

        console.error('1. MongoDB Atlas IP Whitelist:');
        console.error('   - Go to MongoDB Atlas > Network Access');
        console.error('   - Add your current IP address OR temporarily add 0.0.0.0/0 (allow all)');
        console.error('   - Wait 1-2 minutes after adding IP for changes to take effect\n');

        console.error('2. MongoDB Atlas Cluster Paused (Free Tier):');
        console.error('   - Go to MongoDB Atlas > Clusters');
        console.error('   - Check if your cluster shows "PAUSED" status');
        console.error('   - Click "Resume" if paused\n');

        console.error('3. Network/Firewall Issues:');
        console.error('   - Try connecting from a different network (mobile hotspot)');
        console.error('   - Disable VPN temporarily');
        console.error('   - Check if corporate firewall is blocking port 27017\n');

        console.error('4. If behind corporate proxy/SSL inspection:');
        console.error('   Add to config.js mongodb section:');
        console.error('   mongodb: {');
        console.error('     connectionString: "your-connection-string",');
        console.error('     databaseName: "EchoScript",');
        console.error('     tlsAllowInvalidCertificates: true  // Not recommended for production');
        console.error('   }\n');

        console.error('5. Connection String Issues:');
        console.error('   - Ensure username/password are correct');
        console.error('   - Check for special characters that need URL encoding');
        console.error('   - Verify the connection string format\n');

        console.error('======================================\n');

        // Don't retry on SSL errors - they won't resolve automatically
        return false;
      }

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        setTimeout(() => this.connect(connectionString, databaseName, options), 5000);
      }

      return false;
    }
  }

  async initializeDatabase() {
    console.log('[MongoDB] Initializing database collections and indexes...');

    const collectionsToInit = ['profile', 'access', 'limit', 'token_usage', 'log'];
    let createdCount = 0;
    let verifiedCount = 0;

    try {
      // Get list of existing collections
      console.log('[MongoDB] Checking existing collections...');
      const collections = await this.db.listCollections().toArray();
      const existingCollections = collections.map(c => c.name);
      console.log(`[MongoDB] Found ${existingCollections.length} existing collections:`, existingCollections.join(', ') || 'none');

      // Initialize profile collection
      await this.initializeCollection('profile', existingCollections, async () => {
        await this.createIndexSafe('profile', { user_email: 1 }, { unique: true });
        await this.createIndexSafe('profile', { create_date_time: -1 }, {});
      });
      createdCount += existingCollections.includes('profile') ? 0 : 1;

      // Initialize access collection
      await this.initializeCollection('access', existingCollections, async () => {
        await this.createIndexSafe('access', { user_id: 1 }, { unique: true, sparse: true });
      });
      createdCount += existingCollections.includes('access') ? 0 : 1;

      // Initialize limit collection
      await this.initializeCollection('limit', existingCollections, async () => {
        await this.createIndexSafe('limit', { user_id: 1 }, { unique: true, sparse: true });
      });
      createdCount += existingCollections.includes('limit') ? 0 : 1;

      // Initialize token_usage collection
      await this.initializeCollection('token_usage', existingCollections, async () => {
        await this.createIndexSafe('token_usage', { user_id: 1, date: 1 }, { unique: true });
        await this.createIndexSafe('token_usage', { date: -1 }, {});
      });
      createdCount += existingCollections.includes('token_usage') ? 0 : 1;

      // Initialize log collection
      await this.initializeCollection('log', existingCollections, async () => {
        await this.createIndexSafe('log', { user_id: 1, create_time: -1 }, {});
        await this.createIndexSafe('log', { create_time: -1 }, {});
      });
      createdCount += existingCollections.includes('log') ? 0 : 1;

      // Verify all collections exist
      console.log('[MongoDB] Verifying collections...');
      const finalCollections = await this.db.listCollections().toArray();
      const finalCollectionNames = finalCollections.map(c => c.name);

      for (const collName of collectionsToInit) {
        if (finalCollectionNames.includes(collName)) {
          console.log(`[MongoDB] ✓ Collection verified: ${collName}`);
          verifiedCount++;
        } else {
          console.error(`[MongoDB] ✗ Collection missing: ${collName}`);
        }
      }

      if (verifiedCount === collectionsToInit.length) {
        console.log(`[MongoDB] ✅ Database initialization complete: ${createdCount} new collections created, ${verifiedCount} collections verified`);
      } else {
        console.warn(`[MongoDB] ⚠️  Database initialization incomplete: ${verifiedCount}/${collectionsToInit.length} collections verified`);
      }

    } catch (error) {
      console.error('[MongoDB] ❌ Critical error during database initialization:', error);
      console.error('[MongoDB] Error details:', {
        message: error.message,
        code: error.code,
        name: error.name
      });

      // Don't throw - allow app to continue even if initialization has issues
      // But log clearly that there was a problem
      console.error('[MongoDB] Database initialization failed. Some features may not work correctly.');
    }
  }

  async initializeCollection(collectionName, existingCollections, indexCallback) {
    try {
      if (!existingCollections.includes(collectionName)) {
        console.log(`[MongoDB] Creating collection: ${collectionName}...`);
        await this.db.createCollection(collectionName);
        console.log(`[MongoDB] ✓ Created collection: ${collectionName}`);
      } else {
        console.log(`[MongoDB] Collection already exists: ${collectionName}`);
      }

      // Create indexes
      if (indexCallback) {
        await indexCallback();
      }
    } catch (error) {
      console.error(`[MongoDB] Error initializing collection ${collectionName}:`, error.message);
      throw error;
    }
  }

  async createIndexSafe(collectionName, keys, options) {
    try {
      const indexName = Object.keys(keys).join('_');
      await this.db.collection(collectionName).createIndex(keys, options);
      console.log(`[MongoDB]   ✓ Index created: ${collectionName}.${indexName}${options.unique ? ' (unique)' : ''}`);
    } catch (error) {
      // Error codes 85 (IndexOptionsConflict) and 86 (IndexKeySpecsConflict) mean index already exists
      if (error.code === 85 || error.code === 86) {
        const indexName = Object.keys(keys).join('_');
        console.log(`[MongoDB]   - Index already exists: ${collectionName}.${indexName}`);
      } else {
        console.error(`[MongoDB]   ✗ Error creating index for ${collectionName}:`, error.message);
        throw error;
      }
    }
  }

  async verifyCollections() {
    try {
      if (!this.isConnected || !this.db) {
        return {
          success: false,
          error: 'Database not connected',
          collections: []
        };
      }

      const requiredCollections = ['profile', 'access', 'limit', 'token_usage', 'log'];
      const collections = await this.db.listCollections().toArray();
      const existingCollections = collections.map(c => c.name);

      const missing = requiredCollections.filter(c => !existingCollections.includes(c));
      const present = requiredCollections.filter(c => existingCollections.includes(c));

      return {
        success: missing.length === 0,
        required: requiredCollections,
        present: present,
        missing: missing,
        total: existingCollections.length,
        collections: existingCollections
      };
    } catch (error) {
      console.error('[MongoDB] Error verifying collections:', error);
      return {
        success: false,
        error: error.message,
        collections: []
      };
    }
  }

  async disconnect() {
    try {
      // Close change streams first
      await this.closeChangeStreams();

      if (this.client) {
        await this.client.close();
        this.isConnected = false;
        this.client = null;
        this.db = null;
        console.log('MongoDB disconnected');
        this.emit('disconnected');
      }
    } catch (error) {
      console.error('MongoDB disconnect error:', error);
    }
  }

  getCollection(collectionName) {
    if (!this.isConnected || !this.db) {
      throw new Error('MongoDB not connected');
    }
    return this.db.collection(collectionName);
  }

  // Profile Collection Methods
  async createProfile(userData) {
    try {
      const collection = this.getCollection('profile');

      const existingUser = await collection.findOne({ user_email: userData.user_email });
      if (existingUser) {
        console.log('User already exists:', userData.user_email);
        return existingUser;
      }

      const profileCount = await collection.countDocuments();
      const isFirstUser = profileCount === 0;

      // New users are now approved and have STT/TTS enabled by default
      const accessDoc = await this.createAccess({
        permission: true,
        stt_enabled: true,
        tts_enabled: true
      });
      const limitDoc = await this.createLimit({});

      const profile = {
        user_name: userData.user_name,
        user_email: userData.user_email,
        limit: limitDoc.insertedId,
        access: accessDoc.insertedId,
        deepgram: 0,
        agent: 0,
        create_date_time: new Date(),
        is_admin: isFirstUser
      };

      const result = await collection.insertOne(profile);
      profile._id = result.insertedId;

      await this.updateAccess(accessDoc.insertedId, { user_id: result.insertedId });
      await this.updateLimit(limitDoc.insertedId, { user_id: result.insertedId });

      console.log('Profile created:', profile.user_email, 'Is Admin:', isFirstUser);
      return profile;
    } catch (error) {
      console.error('Error creating profile:', error);
      throw error;
    }
  }

  async getProfileByEmail(email) {
    try {
      const collection = this.getCollection('profile');
      return await collection.findOne({ user_email: email });
    } catch (error) {
      console.error('Error getting profile by email:', error);
      throw error;
    }
  }

  async getProfileById(userId) {
    try {
      const collection = this.getCollection('profile');
      return await collection.findOne({ _id: new ObjectId(userId) });
    } catch (error) {
      console.error('Error getting profile by ID:', error);
      throw error;
    }
  }

  async updateProfile(userId, updates) {
    try {
      const collection = this.getCollection('profile');
      const result = await collection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: updates }
      );
      return result.modifiedCount > 0;
    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  }

  async getAllProfiles() {
    try {
      const collection = this.getCollection('profile');
      return await collection.find({}).toArray();
    } catch (error) {
      console.error('Error getting all profiles:', error);
      throw error;
    }
  }

  async incrementTokenUsage(userId, tokenType, amount) {
    try {
      const collection = this.getCollection('profile');
      const updateField = tokenType === 'deepgram' ? { deepgram: amount } : { agent: amount };
      const result = await collection.updateOne(
        { _id: new ObjectId(userId) },
        { $inc: updateField }
      );
      return result.modifiedCount > 0;
    } catch (error) {
      console.error('Error incrementing token usage:', error);
      throw error;
    }
  }

  // Access Collection Methods
  async createAccess(accessData) {
    try {
      const collection = this.getCollection('access');
      const access = {
        user_id: accessData.user_id || null,
        // Store permission as boolean; accept legacy string inputs
        permission: typeof accessData.permission === 'boolean'
          ? accessData.permission
          : accessData.permission === 'yes',
        stt_enabled: !!accessData.stt_enabled,
        tts_enabled: !!accessData.tts_enabled
      };
      return await collection.insertOne(access);
    } catch (error) {
      console.error('Error creating access:', error);
      throw error;
    }
  }

  async getAccessByUserId(userId) {
    try {
      const collection = this.getCollection('access');
      return await collection.findOne({ user_id: new ObjectId(userId) });
    } catch (error) {
      console.error('Error getting access:', error);
      throw error;
    }
  }

  async updateAccess(accessId, updates) {
    try {
      const collection = this.getCollection('access');
      if (updates.user_id) {
        updates.user_id = new ObjectId(updates.user_id);
      }
      const result = await collection.updateOne(
        { _id: new ObjectId(accessId) },
        { $set: updates }
      );
      return result.modifiedCount > 0;
    } catch (error) {
      console.error('Error updating access:', error);
      throw error;
    }
  }

  // Limit Collection Methods
  async createLimit(limitData) {
    try {
      const collection = this.getCollection('limit');
      const limit = {
        user_id: limitData.user_id || null,
        deepgram_token_list: limitData.deepgram_token_list || [],
        agent_token_list: limitData.agent_token_list || []
      };
      return await collection.insertOne(limit);
    } catch (error) {
      console.error('Error creating limit:', error);
      throw error;
    }
  }

  async getLimitByUserId(userId) {
    try {
      const collection = this.getCollection('limit');
      return await collection.findOne({ user_id: new ObjectId(userId) });
    } catch (error) {
      console.error('Error getting limit:', error);
      throw error;
    }
  }

  async updateLimit(limitId, updates) {
    try {
      const collection = this.getCollection('limit');
      if (updates.user_id) {
        updates.user_id = new ObjectId(updates.user_id);
      }
      const result = await collection.updateOne(
        { _id: new ObjectId(limitId) },
        { $set: updates }
      );
      return result.modifiedCount > 0;
    } catch (error) {
      console.error('Error updating limit:', error);
      throw error;
    }
  }

  // Token Usage Collection Methods
  async recordTokenUsage(userId, tokenType, amount) {
    try {
      const collection = this.getCollection('token_usage');
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const existingRecord = await collection.findOne({
        user_id: new ObjectId(userId),
        date: today
      });

      if (existingRecord) {
        const updateField = tokenType === 'deepgram' ? { deepgram: amount } : { agent: amount };
        await collection.updateOne(
          { _id: existingRecord._id },
          { $inc: updateField }
        );
      } else {
        const record = {
          user_id: new ObjectId(userId),
          deepgram: tokenType === 'deepgram' ? amount : 0,
          agent: tokenType === 'agent' ? amount : 0,
          date: today
        };
        await collection.insertOne(record);
      }

      await this.incrementTokenUsage(userId, tokenType, amount);
      return true;
    } catch (error) {
      console.error('Error recording token usage:', error);
      throw error;
    }
  }

  async getTokenUsageByDate(userId, startDate, endDate) {
    try {
      const collection = this.getCollection('token_usage');
      return await collection.find({
        user_id: new ObjectId(userId),
        date: { $gte: startDate, $lte: endDate }
      }).toArray();
    } catch (error) {
      console.error('Error getting token usage:', error);
      throw error;
    }
  }

  async getTodayTokenUsage(userId) {
    try {
      const collection = this.getCollection('token_usage');
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      return await collection.findOne({
        user_id: new ObjectId(userId),
        date: today
      });
    } catch (error) {
      console.error('Error getting today token usage:', error);
      throw error;
    }
  }

  // Log Collection Methods
  async createLog(userId, logMessage) {
    try {
      const collection = this.getCollection('log');
      const log = {
        user_id: new ObjectId(userId),
        logs: logMessage,
        create_time: new Date()
      };
      return await collection.insertOne(log);
    } catch (error) {
      console.error('Error creating log:', error);
      throw error;
    }
  }

  async getLogsByUserId(userId, limit = 100) {
    try {
      const collection = this.getCollection('log');
      return await collection.find({ user_id: new ObjectId(userId) })
        .sort({ create_time: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      console.error('Error getting logs:', error);
      throw error;
    }
  }

  // Helper method to check if user has exceeded token limits
  async checkTokenLimit(userId, tokenType) {
    try {
      const limit = await this.getLimitByUserId(userId);
      if (!limit) return { allowed: true, reason: 'No limits set' };

      const todayUsage = await this.getTodayTokenUsage(userId);
      const usedToday = todayUsage ? (tokenType === 'deepgram' ? todayUsage.deepgram : todayUsage.agent) : 0;

      const limitList = tokenType === 'deepgram' ? limit.deepgram_token_list : limit.agent_token_list;
      if (limitList.length === 0) return { allowed: true, reason: 'No limits configured' };

      const dayOfMonth = new Date().getDate() - 1;
      const dailyLimit = limitList[dayOfMonth] || limitList[0];

      if (usedToday >= dailyLimit) {
        return {
          allowed: false,
          reason: `Daily limit reached: ${usedToday}/${dailyLimit}`,
          used: usedToday,
          limit: dailyLimit
        };
      }

      return {
        allowed: true,
        used: usedToday,
        limit: dailyLimit,
        remaining: dailyLimit - usedToday
      };
    } catch (error) {
      console.error('Error checking token limit:', error);
      return { allowed: true, reason: 'Error checking limit' };
    }
  }

  // MongoDB Change Streams for Real-Time Updates
  watchChanges() {
    if (!this.isConnected || !this.db) {
      console.log('[MongoDB] Cannot watch changes: Database not connected');
      return;
    }

    try {
      // Watch profile collection
      this.changeStreams.profile = this.db.collection('profile').watch([], {
        fullDocument: 'updateLookup'
      });

      this.changeStreams.profile.on('change', (change) => {
        console.log('[MongoDB] Profile change detected:', change.operationType);
        this.handleProfileChange(change);
      });

      this.changeStreams.profile.on('error', (error) => {
        console.error('[MongoDB] Profile change stream error:', error);
        this.restartChangeStream('profile');
      });

      // Watch access collection
      this.changeStreams.access = this.db.collection('access').watch([], {
        fullDocument: 'updateLookup'
      });

      this.changeStreams.access.on('change', (change) => {
        console.log('[MongoDB] Access change detected:', change.operationType);
        this.handleAccessChange(change);
      });

      this.changeStreams.access.on('error', (error) => {
        console.error('[MongoDB] Access change stream error:', error);
        this.restartChangeStream('access');
      });

      // Watch limit collection
      this.changeStreams.limit = this.db.collection('limit').watch([], {
        fullDocument: 'updateLookup'
      });

      this.changeStreams.limit.on('change', (change) => {
        console.log('[MongoDB] Limit change detected:', change.operationType);
        this.handleLimitChange(change);
      });

      this.changeStreams.limit.on('error', (error) => {
        console.error('[MongoDB] Limit change stream error:', error);
        this.restartChangeStream('limit');
      });

      // Watch token_usage collection
      this.changeStreams.token_usage = this.db.collection('token_usage').watch([], {
        fullDocument: 'updateLookup'
      });

      this.changeStreams.token_usage.on('change', (change) => {
        console.log('[MongoDB] Token usage change detected:', change.operationType);
        this.handleTokenUsageChange(change);
      });

      this.changeStreams.token_usage.on('error', (error) => {
        console.error('[MongoDB] Token usage change stream error:', error);
        this.restartChangeStream('token_usage');
      });

      console.log('[MongoDB] Change streams initialized successfully');
      this.emit('change-streams:initialized');
    } catch (error) {
      console.error('[MongoDB] Error initializing change streams:', error);

      // Change streams require a replica set
      if (error.message && error.message.includes('replica set')) {
        console.log('[MongoDB] Change streams require MongoDB replica set or Atlas cluster');
        console.log('[MongoDB] Real-time updates will not be available');
      }

      this.emit('change-streams:error', error);
    }
  }

  handleProfileChange(change) {
    const eventData = {
      type: 'profile:updated',
      operation: change.operationType,
      userId: change.fullDocument?._id?.toString() || change.documentKey?._id?.toString(),
      data: change.fullDocument,
      timestamp: Date.now()
    };

    this.emit('database:change', eventData);
  }

  handleAccessChange(change) {
    const eventData = {
      type: 'access:updated',
      operation: change.operationType,
      userId: change.fullDocument?.user_id?.toString() || null,
      data: change.fullDocument,
      timestamp: Date.now()
    };

    this.emit('database:change', eventData);
  }

  handleLimitChange(change) {
    const eventData = {
      type: 'limit:updated',
      operation: change.operationType,
      userId: change.fullDocument?.user_id?.toString() || null,
      data: change.fullDocument,
      timestamp: Date.now()
    };

    this.emit('database:change', eventData);
  }

  handleTokenUsageChange(change) {
    const eventData = {
      type: 'token:usage',
      operation: change.operationType,
      userId: change.fullDocument?.user_id?.toString() || null,
      data: change.fullDocument,
      timestamp: Date.now()
    };

    this.emit('database:change', eventData);
  }

  async restartChangeStream(collectionName) {
    console.log(`[MongoDB] Restarting change stream for ${collectionName}...`);

    // Close existing stream
    if (this.changeStreams[collectionName]) {
      try {
        await this.changeStreams[collectionName].close();
      } catch (error) {
        console.error(`[MongoDB] Error closing ${collectionName} change stream:`, error);
      }
      this.changeStreams[collectionName] = null;
    }

    // Wait a bit before restarting
    setTimeout(() => {
      if (this.isConnected) {
        this.watchChanges();
      }
    }, 5000);
  }

  async closeChangeStreams() {
    console.log('[MongoDB] Closing change streams...');

    for (const [name, stream] of Object.entries(this.changeStreams)) {
      if (stream) {
        try {
          await stream.close();
          console.log(`[MongoDB] Closed ${name} change stream`);
        } catch (error) {
          console.error(`[MongoDB] Error closing ${name} change stream:`, error);
        }
      }
    }

    this.changeStreams = {
      profile: null,
      access: null,
      limit: null,
      token_usage: null
    };
  }
}

module.exports = new MongoDBService();
