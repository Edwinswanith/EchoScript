const fs = require('fs');
const os = require('os');
const path = require('path');

function ensureConfigJs() {
  const root = process.cwd();
  const configPath = path.join(root, 'config.js');
  const examplePath = path.join(root, 'config.js.example');

  if (fs.existsSync(configPath)) return;

  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, configPath);
    console.log('[prebuild] Created config.js from config.js.example');
    return;
  }

  // Fallback: minimal config so packaging doesn't warn/error.
  fs.writeFileSync(
    configPath,
    "module.exports = {\n  groqApiKey: '',\n  elevenlabsApiKey: ''\n};\n",
    'utf8'
  );
  console.log('[prebuild] Created minimal config.js');
}

function checkSymlinkPrivilege() {
  // electron-builder extracts winCodeSign using symlinks; on Windows this requires
  // Developer Mode or an elevated terminal.
  if (process.platform !== 'win32') return;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echoscripts-symlink-test-'));
  const targetFile = path.join(tmpDir, 'target.txt');
  const linkFile = path.join(tmpDir, 'link.txt');

  try {
    fs.writeFileSync(targetFile, 'test', 'utf8');
    fs.symlinkSync(targetFile, linkFile, 'file');
  } catch (err) {
    const code = err && err.code;
    if (code === 'EPERM' || code === 'EACCES') {
      console.error('\n[prebuild] Windows symlink permission is missing.');
      console.error(
        '[prebuild] electron-builder will fail extracting winCodeSign with:\n' +
          '          "Cannot create symbolic link : A required privilege is not held by the client."\n'
      );
      console.error('Fix (pick one):');
      console.error('- Enable Windows Developer Mode (recommended): run `start ms-settings:developers` and turn ON Developer Mode');
      console.error('- Or run your terminal as Administrator and retry');
      console.error('\nThen re-run: `npm run build`\n');
      process.exit(1);
    }

    // Unexpected error: surface it but don't guess.
    console.error('[prebuild] Symlink test failed with unexpected error:', err);
    process.exit(1);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      // ignore cleanup failures
    }
  }
}

ensureConfigJs();
checkSymlinkPrivilege();



