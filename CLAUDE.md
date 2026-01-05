# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**EchoScript** is an Electron-based desktop application for speech-to-text voice typing with AI-powered features. It provides hands-free typing using ElevenLabs STT and Gemini LLM, with optional trigger word activation, translation, and natural language command extraction.

## Development Commands

### Running the Application
```bash
npm start                    # Start the app in development mode
```

### Building
```bash
npm run rebuild              # Rebuild native dependencies (@nut-tree-fork/nut-js)
npm run build               # Build for current platform
npm run build:win           # Build for Windows (NSIS + portable)
npm run build:linux         # Build for Linux (AppImage + deb)
```

**Important**: On Windows, building requires Developer Mode enabled or running terminal as Administrator (needed for symlink permissions during electron-builder extraction). The `prebuild` script checks this automatically.

### Testing Native Modules
Test files in root (`test-electron-simple.js`, `test-minimal.js`, etc.) are for debugging Electron and native module issues.

## Configuration

### config.js Setup
- **Development**: Copy [config.js.example](config.js.example) to `config.js` (gitignored)
- **Production**: `config.js` is packaged into `app.asar.unpacked/config.js`
- The `prebuild` script auto-creates `config.js` if missing before builds

### Key Configuration Options
See [config.js.example](config.js.example) for full schema. Critical settings:
- `sttProvider`: `'elevenlabs'` - STT provider (ElevenLabs only)
- `elevenlabsApiKey`, `geminiApiKey`: API credentials
- `triggerWordEnabled`/`triggerWord`: Voice activation (e.g., "sana" to start)
- `crewaiEnabled`: Enable AI command extraction from speech
- `translation.enabled`: Auto-translate non-English speech to English
- `indicator`: Visual feedback overlay settings

## Architecture

### Electron Process Structure

**Main Process** ([src/main/index.js](src/main/index.js)):
- Entry point orchestrating application lifecycle
- Manages singleton instances: `IPCManager`, `TrayManager`, `ShortcutManager`, `AppInitializer`
- Coordinates all services and handles cleanup

**Renderer Processes**:
- **Dashboard** ([src/renderer/dashboard/](src/renderer/dashboard/)): Settings UI and status display
- **Indicator** ([src/renderer/indicator/](src/renderer/indicator/)): Visual overlay showing recording/processing state

### Core Module Organization

All main process modules are in [src/main/modules/](src/main/modules/). The architecture follows a modular, event-driven design:

#### Central Orchestrator
- **SpeechRecognitionController** ([SpeechRecognitionController.js](src/main/modules/SpeechRecognitionController.js)): Core orchestrator managing the entire STT workflow. Coordinates all speech-related services and handles state machine (`idle` → `listening` → `processing` → `idle`).

#### Speech-to-Text Pipeline
1. **MicrophoneManager**: Captures audio input, handles device availability
2. **ElevenLabsSTTClient**: Streaming STT provider
3. **TriggerWordDetector**: Detects activation/deactivation phrases
4. **BackgroundListener**: Manages always-on trigger word listening mode
5. **TranscriptionProcessor**: Post-processes transcriptions (translation, command extraction)

#### AI Processing Layer
- **TranslationService** ([TranslationService.js](src/main/modules/TranslationService.js)): Uses Google Gemini to detect language and translate non-English speech to English
- **CrewAIAgent** ([CrewAIAgent.js](src/main/modules/CrewAIAgent.js)): Parses transcriptions using Gemini to extract:
  - Pure text content (with command phrases removed)
  - Keyboard commands in natural language (e.g., "send it" → `enter`, "select all" → `ctrl+a`)

#### Command Execution
- **CommandParser**: Maps text commands to keyboard actions (legacy, superseded by CrewAI)
- **CommandExecutor**: Executes parsed commands
- **TextInjector** ([TextInjector.js](src/main/modules/TextInjector.js)): Platform-aware keyboard simulation
  - **Windows**: Uses `@nut-tree-fork/nut-js` (requires rebuild with `electron-rebuild`)
  - **Linux**: Uses `xdotool` (X11) or `ydotool` (Wayland) via shell commands

#### UI & System Integration
- **IndicatorManager**: Controls visual overlay window
- **DashboardManager**: Manages settings window lifecycle
- **TrayManager**: System tray icon and menu
- **ShortcutManager**: Global hotkey registration
- **AutoLauncher**: OS startup integration
- **TTSService**: Text-to-speech using ElevenLabs (reads selected text)

#### Infrastructure
- **ConfigManager** ([ConfigManager.js](src/main/modules/ConfigManager.js)): Loads and manages [config.js](config.js), handles dev vs production paths
- **IPCManager**: Registers all Electron IPC handlers for renderer ↔ main communication
- **AppInitializer** ([AppInitializer.js](src/main/modules/AppInitializer.js)): Bootstraps all services in correct order

### Data Flow

#### Typical Voice Typing Flow
1. User triggers STT (hotkey, trigger word, or dashboard button)
2. `SpeechRecognitionController` → `MicrophoneManager` starts audio capture
3. Audio streams to `ElevenLabsSTTClient`
4. Transcription received → `TranscriptionProcessor` handles:
   - **If translation enabled**: `TranslationService` translates to English
   - **If CrewAI enabled**: `CrewAIAgent` extracts text + commands
5. Final text → `TextInjector` types into focused app
6. Commands → `CommandExecutor` → `TextInjector` simulates keypresses

#### Background Listening Flow
1. `BackgroundListener` continuously streams audio to STT
2. `TriggerWordDetector` monitors transcriptions for trigger word
3. On detection: switches to active listening mode
4. Proceeds with normal voice typing flow
5. Deactivation phrase returns to background listening

### IPC Communication

Main ↔ Renderer communication via `IPCManager` channels:
- `config:get`, `config:update`: Settings synchronization
- `stt:start`, `stt:stop`, `stt:status`: STT control
- `tts:speak`, `tts:update-settings`: TTS control
- `dashboard:show`: Open settings window

See [src/main/modules/IPCManager.js](src/main/modules/IPCManager.js) for full channel list.

## Platform-Specific Notes

### Linux
- **Text injection requires**: `xdotool` (X11) or `ydotool` + `ydotoold` daemon (Wayland)
- **Native module rebuild**: `npm run rebuild` after `npm install`

### Windows
- **Native modules**: `@nut-tree-fork/nut-js` requires `electron-rebuild`
- **Build requirements**: Developer Mode or Admin terminal for symlinks
- **Targets**: NSIS installer + portable executable

## Important Implementation Details

### Native Module Dependencies
- **@nut-tree-fork/nut-js**: Keyboard/mouse control (Windows primary)
- Requires `electron-rebuild` to compile against Electron's Node.js version
- Packaged in `asarUnpack` to remain accessible (not packed into asar archive)

### STT Provider
The app uses ElevenLabs STT (`scribe_v2` model) for speech-to-text conversion. Configure via `elevenlabsApiKey` in config.js.

### CrewAI vs Legacy Command Parsing
- **CrewAI mode** (recommended): Uses Gemini LLM to intelligently parse natural language commands from speech context
- **Legacy mode** (`crewaiEnabled: false`): Simple regex-based command matching
- CrewAI removes command phrases from typed text (e.g., "hello send it" → types "hello", executes `enter`)

### Config File Security
- `config.js` contains API keys and is gitignored
- Never commit actual credentials
- Use `config.js.example` as template

## Troubleshooting

### Microphone Issues
- Check `MicrophoneManager` logs for device availability
- Linux: Verify ALSA/PulseAudio permissions
- Windows: Check microphone privacy settings

### Native Module Build Failures
```bash
npm run rebuild              # Rebuild @nut-tree-fork/nut-js
```
If fails, check:
- Electron version matches in `devDependencies`
- Build tools installed (Visual Studio on Windows, build-essential on Linux)

### Linux Text Injection Not Working
- X11: Install `xdotool`: `sudo apt install xdotool`
- Wayland: Install `ydotool` and start daemon: `sudo systemctl start ydotoold`

### Windows Build Symlink Errors
Enable Developer Mode: Run `start ms-settings:developers` and toggle Developer Mode ON, or run terminal as Administrator.
