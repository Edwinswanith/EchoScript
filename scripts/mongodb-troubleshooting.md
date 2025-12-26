# MongoDB Connection Troubleshooting Guide

## SSL/TLS Connection Error

If you're seeing `TLSV1_ALERT_INTERNAL_ERROR` or `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`, follow these steps:

### 1. Check MongoDB Atlas IP Whitelist (Most Common Issue)

**This is the #1 cause of connection errors!**

1. Go to [MongoDB Atlas](https://cloud.mongodb.com/)
2. Sign in to your account
3. Navigate to **Network Access** (left sidebar under "Security")
4. Click **"ADD IP ADDRESS"**
5. Choose one:
   - **Add Current IP Address** (recommended for development)
   - **Allow Access from Anywhere** (0.0.0.0/0) - for testing only
6. **Wait 1-2 minutes** for changes to propagate
7. Try running the app again

### 2. Check if Cluster is Paused (Free Tier)

MongoDB Atlas free tier clusters pause after 60 days of inactivity:

1. Go to [MongoDB Atlas](https://cloud.mongodb.com/)
2. Navigate to **Clusters** (left sidebar under "Deployment")
3. Check if your cluster shows **"PAUSED"** status
4. Click **"Resume"** button if paused
5. Wait for cluster to become active
6. Try running the app again

### 3. Verify Connection String

Check your connection string in `config.js`:

```javascript
mongodb: {
    connectionString: 'mongodb+srv://USERNAME:PASSWORD@cluster.mongodb.net/?retryWrites=true&w=majority',
    databaseName: 'EchoScript'
}
```

**Common Issues:**
- Incorrect username or password
- Special characters in password not URL-encoded
  - Example: `p@ssw0rd!` should be `p%40ssw0rd%21`
  - Use this tool: https://www.urlencoder.org/
- Wrong cluster name
- Missing `?retryWrites=true&w=majority` parameters

### 4. Network/Firewall Issues

**Try these:**
- Temporarily disable VPN
- Connect using mobile hotspot (to test if corporate firewall is blocking)
- Check if firewall is blocking port 27017
- If on corporate network, contact IT about MongoDB Atlas access

### 5. Corporate Proxy/SSL Inspection

If you're behind a corporate proxy that intercepts SSL connections:

**Solution:** Enable `tlsAllowInvalidCertificates` in `config.js`:

```javascript
mongodb: {
    connectionString: 'your-connection-string-here',
    databaseName: 'EchoScript',
    tlsAllowInvalidCertificates: true  // ⚠️ Not recommended for production
}
```

**⚠️ Warning:** Only use this in development. Never use in production.

### 6. Test Connection with MongoDB Compass

Download [MongoDB Compass](https://www.mongodb.com/products/compass) (official GUI):

1. Install MongoDB Compass
2. Use your connection string from `config.js`
3. Try to connect
4. If Compass can connect but your app cannot, it's likely an Electron/Node.js specific issue

### 7. Check MongoDB Driver Version

The app uses `mongodb` driver v6.3.0. If issues persist:

```bash
npm ls mongodb
```

Ensure it shows `mongodb@6.3.0` or later.

## Quick Fix Checklist

- [ ] IP address whitelisted in MongoDB Atlas Network Access
- [ ] Cluster is not paused (check Atlas dashboard)
- [ ] Connection string is correct (username, password, cluster name)
- [ ] No special characters in password (or properly URL-encoded)
- [ ] VPN is disabled (temporarily for testing)
- [ ] Tried from different network (mobile hotspot)
- [ ] Waited 1-2 minutes after changing IP whitelist
- [ ] Cluster shows "ACTIVE" status in Atlas

## Still Having Issues?

### Option 1: Use Local MongoDB (Development Only)

1. Install [MongoDB Community Edition](https://www.mongodb.com/try/download/community)
2. Start MongoDB locally: `mongod`
3. Update `config.js`:

```javascript
mongodb: {
    connectionString: 'mongodb://localhost:27017',
    databaseName: 'EchoScript'
}
```

### Option 2: Disable MongoDB Features

If you don't need user management features, the app can run without MongoDB:

1. Comment out the MongoDB section in `config.js`:

```javascript
// mongodb: {
//     connectionString: '...',
//     databaseName: 'EchoScript'
// },
```

2. The app will start without database features

## Contact Support

If none of these solutions work:

1. Check the MongoDB Atlas [status page](https://status.mongodb.com/)
2. Review [MongoDB Atlas documentation](https://docs.atlas.mongodb.com/)
3. Contact MongoDB Atlas support (if using paid tier)

## Technical Details

**Error Code:** `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`
**Cause:** TLS handshake failed between Electron/Node.js and MongoDB Atlas
**Most Common Fix:** IP whitelist configuration
