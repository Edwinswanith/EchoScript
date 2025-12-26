# EchoScripts (VocalKey)

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Electron](https://img.shields.io/badge/Electron-28.0.0-47848F?logo=electron)
![Node](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js)

A powerful cross-platform desktop application that enables **voice-to-text typing** in any application using Deepgram's live streaming AI. Turn your voice into text anywhere with a simple keyboard shortcut.

## 🎯 Overview

EchoScripts is a background utility that runs in your system tray, allowing you to activate voice typing globally across any application. Simply press `Ctrl+Shift+S`, speak, and watch your words appear wherever your cursor is focused. The application uses Deepgram's advanced speech recognition API to provide real-time, accurate transcription with support for voice commands.

### Key Highlights

- 🎤 **Global Voice Activation** - Works in any application (browsers, editors, chat apps, etc.)
- ⚡ **Real-Time Transcription** - Instant speech-to-text using Deepgram's live streaming API
- 🎯 **Voice Commands** - Execute keyboard actions like Enter, Copy, Paste through voice
- 🌍 **Cross-Platform** - Supports Windows 10/11 and Linux (Ubuntu/Debian)
- 🔇 **Background Utility** - Runs silently in system tray with minimal resource usage
- ⚙️ **Highly Configurable** - Customize hotkeys, language, typing speed, and more

## 📋 Table of Contents

- [Features](#-features)
- [System Requirements](#-system-requirements)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Usage](#-usage)
- [Voice Commands](#-voice-commands)
- [Architecture](#-architecture)
- [Development](#-development)
- [Building](#-building)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

## ✨ Features

### Core Functionality

- **Global Hotkey Activation** - Press `Ctrl+Shift+S` from anywhere to start/stop voice typing
- **Universal Text Injection** - Types recognized text into any focused application
- **Real-Time Transcription** - Uses Deepgram's Nova-2 model for instant, accurate results
- **Voice Command Recognition** - 20+ built-in commands with fuzzy matching (85% threshold)
- **System Tray Integration** - Unobtrusive background operation with context menu
- **Auto-Launch on Startup** - Optional automatic launch when your system boots
- **Multi-Language Support** - Configurable language detection (default: English US)
- **Configurable Typing Speed** - Adjust text injection speed to match your needs

### Advanced Features

- **Fuzzy Command Matching** - Tolerates speech variations in command recognition
- **Interim Results** - See transcription in progress (configurable)
- **Automatic Punctuation** - Smart punctuation insertion based on speech patterns
- **Smart Endpointing** - Automatic pause detection (300ms default)
- **Custom Commands** - Extend with your own voice command definitions
- **Cross-Platform Text Injection** - Platform-specific strategies for Windows, X11, and Wayland
- **🆕 Automatic Language Detection** - Parallel language detection using Groq's Whisper API (65+ languages supported)
  - See [GROQ_LANGUAGE_DETECTION.md](GROQ_LANGUAGE_DETECTION.md) for details

## 💻 System Requirements

### Windows
- Windows 10 or Windows 11
- Node.js 20.x or higher
- 4GB RAM minimum
- Active internet connection for Deepgram API

### Linux
- Ubuntu 20.04+ or Debian-based distribution
- Node.js 20.x or higher
- X11 or Wayland display server
- Required packages: `xdotool` (X11) or `ydotool` (Wayland)
- 4GB RAM minimum
- Active internet connection for Deepgram API

### General Requirements
- Valid Deepgram API key (free tier available at [deepgram.com](https://deepgram.com))
- Valid Groq API key for language detection (optional, free tier available at [console.groq.com](https://console.groq.com))
- Working microphone
- Audio input permissions

## 🚀 Installation

### Prerequisites

1. **Install Node.js 20.x+**
   ```bash
   # Verify installation
   node --version
   npm --version
   ```

2. **Get Deepgram API Key**
   - Sign up at [deepgram.com](https://console.deepgram.com/signup)
   - Navigate to API Keys section
   - Create a new API key

3. **Linux-Specific Prerequisites**

   **For X11:**
   ```bash
   sudo apt-get install xdotool
   ```

   **For Wayland:**
   ```bash
   sudo apt-get install ydotool
   # Start ydotool daemon
   sudo systemctl enable ydotool
   sudo systemctl start ydotool
   # Or run manually
   sudo ydotoold
   ```

### Install from Source

1. **Clone the Repository**
   ```bash
   git clone <repository-url>
   cd EchoScripts
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Application**

   Edit [config.js](config.js) with your settings:
   ```javascript
   module.exports = {
       deepgramApiKey: 'YOUR_DEEPGRAM_API_KEY_HERE',
       hotkey: 'CommandOrControl+Shift+S',
       autoLaunch: false,
       language: 'en-US',
       voiceCommands: true,
       typingSpeed: 50,
       showFloatingUI: false,
       deepgramModel: 'nova-2',
       punctuate: true,
       interimResults: true,
       endpointing: 300,
       customCommands: {}
   };
   ```

4. **Rebuild Native Modules** (Windows only)
   ```bash
   npm run rebuild
   ```

5. **Run the Application**
   ```bash
   npm start
   ```

### Install from Binary (Production)

1. **Build the Application**
   ```bash
   npm run build
   ```

2. **Install from dist/ folder**
   - **Windows**: Run `dist/VocalKey Setup X.X.X.exe`
   - **Linux**: Install `dist/VocalKey-X.X.X.AppImage` or `dist/vocalkey_X.X.X_amd64.deb`

## ⚙️ Configuration

All configuration is managed through [config.js](config.js) in the root directory.

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `deepgramApiKey` | String | Required | Your Deepgram API key |
| `hotkey` | String | `CommandOrControl+Shift+S` | Global keyboard shortcut to activate voice typing |
| `autoLaunch` | Boolean | `false` | Launch application on system startup |
| `language` | String | `en-US` | Speech recognition language code |
| `voiceCommands` | Boolean | `true` | Enable voice command recognition |
| `typingSpeed` | Number | `50` | Milliseconds between each character typed (lower = faster) |
| `showFloatingUI` | Boolean | `false` | Show floating status window (future feature) |
| `deepgramModel` | String | `nova-2` | Deepgram AI model to use |
| `punctuate` | Boolean | `true` | Automatically add punctuation |
| `interimResults` | Boolean | `true` | Show transcription in progress |
| `endpointing` | Number | `300` | Milliseconds of silence before finalizing transcription |
| `customCommands` | Object | `{}` | Define custom voice commands |

### Supported Languages

The application supports all languages offered by Deepgram. Common options:
- `en-US` - English (United States)
- `en-GB` - English (United Kingdom)
- `es` - Spanish
- `fr` - French
- `de` - German
- `it` - Italian
- `pt` - Portuguese
- `ja` - Japanese
- `ko` - Korean
- `zh` - Chinese

[See full list in Deepgram documentation](https://developers.deepgram.com/docs/language)

### Custom Commands Example

```javascript
customCommands: {
    'open terminal': 'ctrl+alt+t',
    'close window': 'alt+f4',
    'switch window': 'alt+tab'
}
```

## 🎮 Usage

### Basic Workflow

1. **Launch Application**
   - Run via `npm start` or launch the installed binary
   - Application icon appears in system tray

2. **Activate Voice Typing**
   - Position cursor in any application where you want to type
   - Press `Ctrl+Shift+S` (or your configured hotkey)
   - Microphone starts listening (tray icon may change)

3. **Speak Your Text**
   - Speak clearly into your microphone
   - Text appears in real-time where your cursor is focused
   - Use voice commands for actions (see [Voice Commands](#-voice-commands))

4. **Stop Voice Typing**
   - Press the hotkey again (`Ctrl+Shift+S`)
   - Or say a stop command if configured

### System Tray Menu

Right-click the system tray icon to access:
- **Start/Stop Listening** - Toggle voice typing
- **Settings** - Open configuration (future feature)
- **Auto-Launch** - Enable/disable startup with system
- **Quit** - Exit the application

### Typical Use Cases

- **Writing Emails** - Dictate emails in Gmail, Outlook, or any email client
- **Coding** - Dictate code comments, documentation, or variable names
- **Note-Taking** - Quickly capture notes in any text editor
- **Chat Applications** - Respond to messages via voice
- **Document Editing** - Draft documents in Word, Google Docs, LibreOffice, etc.
- **Form Filling** - Fill out web forms hands-free
- **Terminal Commands** - Dictate command-line instructions

## 🗣️ Voice Commands

Voice commands allow you to execute keyboard actions through speech. The application uses fuzzy matching with 85% similarity threshold to handle variations in pronunciation.

### Built-in Commands

| Voice Command | Action | Keyboard Equivalent |
|--------------|--------|---------------------|
| "press enter" | New line | `Enter` |
| "new line" | New line | `Enter` |
| "press backspace" | Delete previous character | `Backspace` |
| "backspace" | Delete previous character | `Backspace` |
| "delete" | Delete previous character | `Backspace` |
| "press tab" | Tab indentation | `Tab` |
| "tab" | Tab indentation | `Tab` |
| "select all" | Select all text | `Ctrl+A` |
| "copy" | Copy selected text | `Ctrl+C` |
| "paste" | Paste clipboard | `Ctrl+V` |
| "cut" | Cut selected text | `Ctrl+X` |
| "undo" | Undo last action | `Ctrl+Z` |
| "redo" | Redo last action | `Ctrl+Y` |
| "save" | Save document | `Ctrl+S` |
| "period" | Insert period | `.` |
| "comma" | Insert comma | `,` |
| "question mark" | Insert question mark | `Shift+/` |
| "exclamation mark" | Insert exclamation | `Shift+1` |
| "exclamation point" | Insert exclamation | `Shift+1` |

### Fuzzy Matching

The CommandParser uses Levenshtein distance algorithm to match voice commands with 85% similarity threshold. This means:
- ✅ "press enter" matches "press enter"
- ✅ "press enter" matches "press entr" (typo tolerance)
- ✅ "copy" matches "copy" or "coppy"
- ❌ "copy" does not match "paste" (too different)

### Adding Custom Commands

Edit `customCommands` in [config.js](config.js):

```javascript
customCommands: {
    'bold text': 'ctrl+b',
    'italic text': 'ctrl+i',
    'underline text': 'ctrl+u',
    'zoom in': 'ctrl+plus',
    'zoom out': 'ctrl+minus',
    'find': 'ctrl+f'
}
```

## 🏗️ Architecture

### Project Structure

```
EchoScripts/
├── src/
│   ├── main/                          # Electron Main Process
│   │   ├── index.js                   # Entry point & app lifecycle
│   │   ├── audio-capture.html         # Hidden window for audio capture
│   │   └── modules/                   # Core modules
│   │       ├── DeepgramClient.js      # Deepgram API integration
│   │       ├── SpeechRecognitionController.js  # Main orchestrator
│   │       ├── MicrophoneManager.js   # Audio capture & processing
│   │       ├── TextInjector.js        # Cross-platform keyboard injection
│   │       ├── CommandParser.js       # Voice command parser with fuzzy matching
│   │       ├── ConfigManager.js       # Configuration management
│   │       └── AutoLauncher.js        # System startup integration
│   └── renderer/                      # Future UI components
│       └── settings.js                # Settings interface
├── assets/
│   ├── icon.png                       # Application icon (PNG)
│   └── icon.ico                       # Application icon (Windows)
├── config.js                          # User configuration file
├── package.json                       # Dependencies & build config
└── README.md                          # This file
```

### Core Modules

#### 1. [index.js](src/main/index.js)
**Main application entry point**
- Initializes Electron app lifecycle
- Creates system tray with context menu
- Registers global hotkey listener
- Coordinates module initialization
- Manages application state

#### 2. [SpeechRecognitionController.js](src/main/modules/SpeechRecognitionController.js)
**Main orchestrator that coordinates all modules**
- State management (idle, listening, processing, error)
- Event-driven architecture with EventEmitter
- Coordinates DeepgramClient, MicrophoneManager, TextInjector, CommandParser
- Handles transcription workflow from start to finish
- Error handling and recovery

#### 3. [DeepgramClient.js](src/main/modules/DeepgramClient.js)
**Deepgram API integration**
- Manages WebSocket connection to Deepgram live transcription API
- Configures Deepgram with model, language, punctuation settings
- Sends audio data to Deepgram for processing
- Receives and emits interim and final transcription results
- Handles connection lifecycle and errors

#### 4. [MicrophoneManager.js](src/main/modules/MicrophoneManager.js)
**Audio capture and processing**
- Creates hidden Electron BrowserWindow with HTML5 Audio API
- Captures microphone stream at 16kHz mono PCM format
- Converts Float32 audio samples to Int16 (PCM) for Deepgram
- Communicates with main process via IPC (Inter-Process Communication)
- Manages audio stream lifecycle

#### 5. [TextInjector.js](src/main/modules/TextInjector.js)
**Cross-platform text and command injection**
- **Windows**: Uses `@nut-tree-fork/nut-js` library for keyboard simulation
- **Linux X11**: Uses `xdotool` command-line utility
- **Linux Wayland**: Uses `ydotool` with daemon management
- Handles both text typing and keyboard command execution
- Configurable typing speed for natural text appearance

#### 6. [CommandParser.js](src/main/modules/CommandParser.js)
**Voice command recognition**
- Distinguishes between text and voice commands
- Uses Levenshtein distance algorithm for fuzzy matching (85% threshold)
- Supports 20+ predefined commands
- Extensible for custom command definitions
- Returns parsed result with type (text/command) and value

#### 7. [ConfigManager.js](src/main/modules/ConfigManager.js)
**Configuration management**
- Loads configuration from [config.js](config.js)
- Validates configuration values
- Provides default fallback configuration
- Manages API keys, hotkey, language, typing speed, etc.

#### 8. [AutoLauncher.js](src/main/modules/AutoLauncher.js)
**System startup integration**
- Cross-platform auto-launch functionality using `auto-launch` library
- Enables/disables launch on system startup
- Integrated with system tray menu

### Technology Stack

#### Core Technologies
- **Electron 28.0.0** - Cross-platform desktop framework
- **Node.js 20.x+** - JavaScript runtime
- **Deepgram SDK v3.4.0** - Speech-to-text AI API
- **HTML5 Audio API** - Microphone access and audio processing

#### Platform-Specific Dependencies
- **@nut-tree-fork/nut-js 4.2.0** - Keyboard automation (Windows)
- **xdotool** - Keyboard automation (Linux X11)
- **ydotool** - Keyboard automation (Linux Wayland)
- **auto-launch 5.0.6** - System startup integration

#### Build Tools
- **electron-builder 24.9.1** - Application packaging & distribution
- **electron-rebuild 3.2.9** - Native module compilation for Electron

### Application Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                    User Presses Hotkey                      │
│                   (Ctrl+Shift+S)                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         SpeechRecognitionController                         │
│         toggleSpeechRecognition()                           │
│         State: idle → listening                             │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│ DeepgramClient   │    │ MicrophoneManager│
│ Start Session    │    │ Start Capture    │
│ (WebSocket)      │    │ (16kHz Mono PCM) │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         │     Audio Stream      │
         │◄──────────────────────┘
         │
         │ Process with AI
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│              Deepgram Cloud API                             │
│              Real-time Transcription                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Final Transcript
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              CommandParser                                  │
│              parse(transcript)                              │
│              Fuzzy match commands (85% threshold)           │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│   Command Found  │    │  Regular Text    │
│   Execute Action │    │   Type Character │
│   (e.g., Enter)  │    │   by Character   │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              TextInjector                                   │
│              inject(text/command)                           │
│              Platform-specific keyboard simulation          │
│              (nut.js / xdotool / ydotool)                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Focused Application                            │
│              (Browser, Editor, Chat, etc.)                  │
│              Receives typed text or keyboard command        │
└─────────────────────────────────────────────────────────────┘
```

## 🛠️ Development

### Prerequisites

- Node.js 20.x or higher
- npm or yarn
- Git
- Code editor (VS Code recommended)

### Setup Development Environment

1. **Clone Repository**
   ```bash
   git clone <repository-url>
   cd EchoScripts
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure API Key**
   - Edit [config.js](config.js)
   - Add your Deepgram API key

4. **Run in Development Mode**
   ```bash
   npm start
   ```

### Development Scripts

```bash
# Start application in development mode
npm start

# Rebuild native modules (Windows - after npm install)
npm run rebuild

# Build production binary
npm run build

# Install app dependencies
npm run postinstall
```

### Project Guidelines

- **Modular Architecture** - Each module has a single responsibility
- **Event-Driven Design** - Use EventEmitter for module communication
- **Error Handling** - Always handle errors gracefully
- **Cross-Platform** - Test on both Windows and Linux
- **Configuration** - Use [config.js](config.js) for all user settings
- **Logging** - Use console.log with clear prefixes (e.g., `[DeepgramClient]`)

### Adding New Features

1. **Create Module** in `src/main/modules/`
2. **Export Class** with EventEmitter inheritance
3. **Register in SpeechRecognitionController**
4. **Add Configuration** to [config.js](config.js)
5. **Update Documentation** in this README

### Debugging

#### Enable Electron DevTools
Edit [src/main/index.js](src/main/index.js):
```javascript
// Uncomment to enable DevTools
// mainWindow.webContents.openDevTools();
```

#### Check Logs
- **Windows**: Check console output in terminal
- **Linux**: Check console output or system logs
- **Deepgram**: Monitor API usage at [console.deepgram.com](https://console.deepgram.com)

#### Common Issues
See [Troubleshooting](#-troubleshooting) section

## 📦 Building

### Build for Production

```bash
npm run build
```

### Windows Build (IMPORTANT)

> **⚠️ If keyboard keys are not working on Windows**, you need to rebuild native modules for Electron before building.

**Quick Fix on Windows:**
```bash
# Run the automated build script
rebuild-for-windows.bat
```

**Manual Build:**
```bash
# Step 1: Rebuild native modules for Electron
npm run rebuild

# Step 2: Build for Windows
npm run build:win
```

**Cross-platform build from Linux/Mac:**
```bash
# Requires wine to be installed
./rebuild-for-windows.sh
```

For detailed instructions, see [WINDOWS_BUILD.md](WINDOWS_BUILD.md).

### Build Output

The build process creates platform-specific installers in the `dist/` directory:

#### Windows
- `VocalKey Setup X.X.X.exe` - NSIS installer
- `VocalKey X.X.X.exe` - Portable executable
- Includes all dependencies and native modules

#### Linux
- `VocalKey-X.X.X.AppImage` - Portable application bundle
- `vocalkey_X.X.X_amd64.deb` - Debian package for APT installation

### Build Configuration

Build settings are defined in [package.json](package.json) under the `build` section:

```json
{
  "build": {
    "appId": "com.vocalkey.app",
    "productName": "VocalKey",
    "files": ["src/**/*", "assets/**/*", "config.js"],
    "win": {
      "target": ["nsis"],
      "icon": "assets/icon.ico"
    },
    "linux": {
      "target": ["AppImage", "deb"],
      "category": "Utility"
    }
  }
}
```

### Customizing Build

To modify build targets or configuration:

1. Edit `build` section in [package.json](package.json)
2. See [electron-builder documentation](https://www.electron.build/)
3. Run `npm run build`

## 🔧 Troubleshooting

### General Issues

#### Application Won't Start
```bash
# Check Node.js version
node --version  # Should be 20.x or higher

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Check for errors
npm start
```

#### Microphone Not Working
- **Check Permissions**: Ensure application has microphone access
- **Check Device**: Test microphone in other applications
- **Browser Permissions**: Electron uses Chromium - check audio settings
- **Linux**: Check PulseAudio/PipeWire configuration

#### Deepgram API Errors
- **Invalid API Key**: Verify key in [config.js](config.js)
- **Quota Exceeded**: Check usage at [console.deepgram.com](https://console.deepgram.com)
- **Network Issues**: Verify internet connection
- **Model Not Found**: Use valid model name (e.g., `nova-2`)

### Windows-Specific Issues

#### ⚠️ Keyboard Keys Not Working After Installation

**Symptoms:**
- Voice recognition works fine
- Text is transcribed correctly
- But keyboard keys/commands don't execute
- Nothing is typed into applications

**Solution:**
This happens when native modules aren't properly compiled for Electron. Follow these steps:

**On Windows:**
```bash
# Method 1: Use the automated fix script
rebuild-for-windows.bat

# Method 2: Manual rebuild
npm run rebuild
npm run build:win
```

**Prerequisites** (if rebuild fails):
- Install Visual Studio Build Tools: https://visualstudio.microsoft.com/downloads/
- Select "Desktop development with C++" workload
- Or run: `npm install --global windows-build-tools`

See [WINDOWS_BUILD.md](WINDOWS_BUILD.md) for detailed troubleshooting.

#### Native Module Build Errors
```bash
# Rebuild native modules
npm run rebuild

# If still failing, try:
npm install --save-dev electron-rebuild
npx electron-rebuild
```

#### Hotkey Not Working
- Check if another application is using the same hotkey
- Try changing hotkey in [config.js](config.js)
- Run as administrator (if required)

#### Text Not Injecting (General)
- Verify nut.js is properly installed
- Check antivirus/security software (may block keyboard automation)
- Try running as administrator
- Rebuild native modules: `npm run rebuild`

### Linux-Specific Issues

#### xdotool Not Found (X11)
```bash
# Ubuntu/Debian
sudo apt-get install xdotool

# Fedora
sudo dnf install xdotool

# Arch
sudo pacman -S xdotool
```

#### ydotool Not Working (Wayland)
```bash
# Install ydotool
sudo apt-get install ydotool

# Start daemon
sudo systemctl enable ydotool
sudo systemctl start ydotool

# Or run manually
sudo ydotoold &

# Add user to input group
sudo usermod -aG input $USER
# Log out and back in
```

#### Permission Denied Errors
```bash
# For ydotool
sudo chmod 666 /dev/uinput

# For microphone
# Add user to audio group
sudo usermod -aG audio $USER
```

#### AppImage Won't Run
```bash
# Make executable
chmod +x VocalKey-X.X.X.AppImage

# Run
./VocalKey-X.X.X.AppImage
```

### Deepgram-Specific Issues

#### Poor Transcription Accuracy
- **Speak Clearly**: Enunciate words clearly
- **Reduce Background Noise**: Use in quiet environment
- **Better Microphone**: Use higher quality microphone
- **Adjust Model**: Try different Deepgram models in [config.js](config.js)
- **Language Setting**: Ensure correct language in [config.js](config.js)

#### Lag or Delay
- **Check Internet Speed**: Requires stable connection
- **Reduce Endpointing**: Lower value in [config.js](config.js)
- **Disable Interim Results**: Set to false in [config.js](config.js)

### Getting Help

If you encounter issues not covered here:

1. **Check Configuration**: Verify all settings in [config.js](config.js)
2. **Review Logs**: Check console output for error messages
3. **Test Components**: Test microphone, internet, API key separately
4. **Report Issues**: Open an issue on GitHub with:
   - Operating system and version
   - Node.js and Electron versions
   - Error messages from console
   - Steps to reproduce

## 📄 License

This project is licensed under the **MIT License**.

```
MIT License

Copyright (c) 2024 VocalKey Developer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 Acknowledgments

- **Deepgram** - For providing the powerful speech recognition API
- **Electron** - For the cross-platform desktop framework
- **nut.js** - For Windows keyboard automation
- **xdotool/ydotool** - For Linux keyboard automation

## 📞 Support

For questions, issues, or feature requests:
- **GitHub Issues**: [Create an issue](https://github.com/yourusername/EchoScripts/issues)
- **Email**: developer@vocalkey.app
- **Deepgram Support**: [Deepgram Documentation](https://developers.deepgram.com/)

---

**Made with ❤️ by the VocalKey Team**
