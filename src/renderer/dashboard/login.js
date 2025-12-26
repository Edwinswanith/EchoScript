const googleLoginBtn = document.getElementById('googleLoginBtn');
const errorMessage = document.getElementById('errorMessage');
const loadingMessage = document.getElementById('loadingMessage');

googleLoginBtn.addEventListener('click', async () => {
  try {
    googleLoginBtn.disabled = true;
    errorMessage.classList.remove('show');
    loadingMessage.classList.add('show');

    const result = await window.electronAPI.auth.login();

    loadingMessage.classList.remove('show');

    if (result.success) {
      console.log('Login successful:', result.user);
      await window.electronAPI.dashboard.navigate('activation');
    } else {
      const msg = result.error || 'Authentication failed';
      if (msg.includes('Google sign-in is not configured')) {
        showError('Google sign-in is not configured. Open config.js and set oauth.clientId and oauth.clientSecret, then restart the app.');
      } else {
        showError(msg);
      }
      googleLoginBtn.disabled = false;
    }
  } catch (error) {
    console.error('Login error:', error);
    const errorMsg = error.message || error.toString();
    
    // Show user-friendly error messages
    if (errorMsg.includes('MongoDB is not connected')) {
      showError('MongoDB connection is required for authentication. Please configure MongoDB in config.js and ensure the connection is working.');
    } else if (errorMsg.includes('Authentication window was closed')) {
      showError('Authentication was cancelled. Please try again.');
    } else if (errorMsg.includes('Google sign-in is not configured')) {
      showError('Google sign-in is not configured. Open config.js and set oauth.clientId and oauth.clientSecret, then restart the app.');
    } else {
      showError(errorMsg || 'An unexpected error occurred. Please try again.');
    }
    
    loadingMessage.classList.remove('show');
    googleLoginBtn.disabled = false;
  }
});

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
}
