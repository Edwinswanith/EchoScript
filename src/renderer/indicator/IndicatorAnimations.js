const { ipcRenderer } = require('electron');

/**
 * IndicatorAnimationController - Controls animations and state transitions for the indicator
 */
class IndicatorAnimationController {
    constructor() {
        this.container = document.getElementById('indicator-circle');
        this.animationContainer = document.getElementById('animation-container');
        this.currentState = 'idle';
        this.currentAnimation = null;

        this.setupListeners();
        this.initializeState();
    }

    /**
     * Setup IPC listeners for state changes
     */
    setupListeners() {
        ipcRenderer.on('indicator:state-change', (event, data) => {
            console.log('Indicator state change:', data);
            this.transitionToState(data.state, data);
        });
    }

    /**
     * Initialize to idle state
     */
    initializeState() {
        this.transitionToState('idle', {});
    }

    /**
     * Transition to a new state
     * @param {string} newState - New state to transition to
     * @param {Object} metadata - Additional metadata for the state
     */
    transitionToState(newState, metadata) {
        if (this.currentState === newState && !metadata.force) {
            return;
        }

        console.log(`Transitioning from ${this.currentState} to ${newState}`);
        this.currentState = newState;

        // Clear current content
        this.clearAnimation();

        // Update circle class
        this.container.className = `state-${newState}`;

        // Render state-specific content
        switch (newState) {
            case 'idle':
                this.renderIdle();
                break;
            case 'listening':
                this.renderListening();
                break;
            case 'detecting':
                this.renderDetecting(metadata.audioLevel || 0.5);
                break;
            case 'processing':
                this.renderProcessing();
                break;
            case 'error':
                this.renderError(metadata.message);
                break;
            case 'success':
                this.renderSuccess();
                break;
            case 'speaking':
                this.renderSpeaking();
                break;
            default:
                console.warn(`Unknown state: ${newState}`);
        }
    }

    /**
     * Clear current animation/content
     */
    clearAnimation() {
        this.animationContainer.innerHTML = '';

        // Destroy Lottie animation if exists
        if (this.currentAnimation) {
            try {
                this.currentAnimation.destroy();
            } catch (error) {
                console.error('Error destroying animation:', error);
            }
            this.currentAnimation = null;
        }
    }

    /**
     * Render idle state - small gray circle with microphone
     */
    renderIdle() {
        const icon = document.createElement('div');
        icon.className = 'icon-microphone';
        icon.style.opacity = '0.6';
        this.animationContainer.appendChild(icon);

        // Add subtle heartbeat effect
        this.container.style.animation = 'heartbeat 3s ease-in-out infinite';
    }

    /**
     * Render listening state - blue circle with microphone
     */
    renderListening() {
        const icon = document.createElement('div');
        icon.className = 'icon-microphone';
        this.animationContainer.appendChild(icon);
    }

    /**
     * Render detecting state - green circle with waveform
     * @param {number} audioLevel - Audio level from 0.0 to 1.0
     */
    renderDetecting(audioLevel) {
        // Create waveform visualization
        const waveform = document.createElement('div');
        waveform.className = 'waveform-container';

        // Create 3 bars
        for (let i = 0; i < 3; i++) {
            const bar = document.createElement('div');
            bar.className = 'waveform-bar';
            waveform.appendChild(bar);
        }

        this.animationContainer.appendChild(waveform);

        // Adjust animation speed based on audio level
        const speed = 0.5 + audioLevel;
        const bars = waveform.querySelectorAll('.waveform-bar');
        bars.forEach(bar => {
            bar.style.animationDuration = `${0.8 / speed}s`;
        });
    }

    /**
     * Render processing state - orange circle with spinner
     */
    renderProcessing() {
        const spinner = document.createElement('div');
        spinner.className = 'icon-spinner';
        this.animationContainer.appendChild(spinner);
    }

    /**
     * Render error state - red circle with X icon
     * @param {string} message - Error message (optional)
     */
    renderError(message) {
        const icon = document.createElement('div');
        icon.className = 'icon-error';
        this.animationContainer.appendChild(icon);

        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            if (this.currentState === 'error') {
                this.transitionToState('idle', {});
            }
        }, 3000);
    }

    /**
     * Render success state - green circle with checkmark
     */
    renderSuccess() {
        const icon = document.createElement('div');
        icon.className = 'icon-check';
        this.animationContainer.appendChild(icon);

        // Quick transition back to listening
        setTimeout(() => {
            if (this.currentState === 'success') {
                this.transitionToState('listening', {});
            }
        }, 500);
    }

    /**
     * Render speaking state - purple circle with speaker icon
     */
    renderSpeaking() {
        const icon = document.createElement('div');
        icon.className = 'icon-speaker';
        this.animationContainer.appendChild(icon);
    }

    /**
     * Load Lottie animation (for future use with actual animation files)
     * @param {string} animationPath - Path to Lottie JSON file
     * @param {boolean} loop - Whether to loop the animation
     */
    loadLottieAnimation(animationPath, loop = true) {
        try {
            if (typeof lottie === 'undefined') {
                console.warn('Lottie not loaded, skipping animation');
                return null;
            }

            this.currentAnimation = lottie.loadAnimation({
                container: this.animationContainer,
                renderer: 'svg',
                loop: loop,
                autoplay: true,
                path: animationPath
            });

            return this.currentAnimation;
        } catch (error) {
            console.error('Error loading Lottie animation:', error);
            return null;
        }
    }

    /**
     * Update audio level for detecting state
     * @param {number} audioLevel - Audio level from 0.0 to 1.0
     */
    updateAudioLevel(audioLevel) {
        if (this.currentState !== 'detecting') {
            return;
        }

        const waveform = this.animationContainer.querySelector('.waveform-container');
        if (waveform) {
            const speed = 0.5 + audioLevel;
            const bars = waveform.querySelectorAll('.waveform-bar');
            bars.forEach(bar => {
                bar.style.animationDuration = `${0.8 / speed}s`;
            });
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Indicator Animation Controller');
    window.indicatorController = new IndicatorAnimationController();
});

// Handle graceful shutdown
window.addEventListener('beforeunload', () => {
    if (window.indicatorController) {
        window.indicatorController.clearAnimation();
    }
});
