// Configuration - IMPORTANT: This MUST match your live backend URL
const API_BASE_URL = "https://api-gateway-96c7cdb8.kiaraoct34.workers.dev/api/v1";

// --- State and Data Store ---
let allPlatformsData = [];
let allTiersData = {};
let currentContentData = null;
let currentFilterState = { view: 'All', type: 'All', query: '' };
let searchScope = 'platforms'; // Tracks search scope: 'platforms', 'tiers', or 'content'
let userInfo = null;
let userSubscriptions = [];

// --- NEW: Active Video Players Registry ---
const activePlayers = new Map(); // playerId -> {player, modal}

// --- Theme Manager ---
class ThemeManager {
    constructor() {
        this.themeKey = 'theme_preference';
        this.themes = ['light', 'dark', 'auto'];
        this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.init();
    }

    init() {
        this.applyTheme(this.getPreferredTheme());
        this.setupEventListeners();
    }

    getPreferredTheme() {
        const storedTheme = localStorage.getItem(this.themeKey);
        if (storedTheme && this.themes.includes(storedTheme)) {
            return storedTheme;
        }
        return 'auto';
    }

    detectSystemTheme() {
        return this.mediaQuery.matches ? 'dark' : 'light';
    }

    applyTheme(theme) {
        const effectiveTheme = theme === 'auto' ? this.detectSystemTheme() : theme;
        document.body.classList.remove('theme-light', 'theme-dark');
        document.body.classList.add(`theme-${effectiveTheme}`);
        localStorage.setItem(this.themeKey, theme);
        
        const toggle = document.getElementById('themeToggle');
        if (toggle) {
            toggle.checked = effectiveTheme === 'dark';
            toggle.setAttribute('aria-label', `Switch to ${effectiveTheme === 'dark' ? 'light' : 'dark'} mode`);
        }
    }

    toggleTheme() {
        const currentTheme = this.getPreferredTheme();
        const newTheme = currentTheme === 'auto' ? (this.detectSystemTheme() === 'dark' ? 'light' : 'dark') :
                        currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(newTheme);
    }

    setupEventListeners() {
        const toggle = document.getElementById('themeToggle');
        if (toggle) {
            toggle.addEventListener('change', () => this.toggleTheme());
        }
        this.mediaQuery.addEventListener('change', () => {
            if (this.getPreferredTheme() === 'auto') {
                this.applyTheme('auto');
            }
        });
    }
}

// --- Video Token Refresh Manager ---
class VideoTokenRefreshManager {
    constructor() {
        this.activeVideos = new Map(); // videoId -> { player, tierId, libraryId, timer }
        this.refreshInterval = 90000; // 90 seconds (refresh before 120s expiry)
    }

    registerVideo(videoId, player, tierId, libraryId) {
        // Clear existing timer if any
        if (this.activeVideos.has(videoId)) {
            clearInterval(this.activeVideos.get(videoId).timer);
        }

        // Start refresh timer
        const timer = setInterval(() => {
            this.refreshVideoToken(videoId, tierId, libraryId, player);
        }, this.refreshInterval);

        this.activeVideos.set(videoId, { player, tierId, libraryId, timer });
    }

    async refreshVideoToken(videoId, tierId, libraryId, player) {
        try {
            // Check if player is still valid before refreshing
            if (!player || !player.el() || player.isDisposed()) {
                this.stopRefresh(videoId);
                return;
            }

            const token = localStorage.getItem('lustroom_jwt');
            if (!token) {
                this.stopRefresh(videoId);
                return;
            }

            const response = await fetch(`${API_BASE_URL}/refresh-video-token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    video_id: videoId,
                    library_id: libraryId
                })
            });

            const data = await response.json();

            if (response.ok && data.status === 'success') {
                // Double-check player validity before updating source
                if (!player || !player.el() || player.isDisposed()) {
                    this.stopRefresh(videoId);
                    return;
                }

                // Update player source with new URL
                const currentTime = player.currentTime();
                const wasPaused = player.paused();
                
                player.src({
                    src: data.url,
                    type: 'application/x-mpegURL'
                });

                // Restore playback state
                player.one('loadedmetadata', () => {
                    // Verify player still exists before restoring state
                    if (!player || !player.el() || player.isDisposed()) return;
                    
                    player.currentTime(currentTime);
                    if (!wasPaused) {
                        player.play().catch(() => {
                            // Autoplay might be blocked - ignore error
                        });
                    }
                });

            } else if (response.status === 403) {
                // Subscription expired
                this.stopRefresh(videoId);
                player.pause();
                player.error({
                    code: 4,
                    message: 'Your subscription has expired. Please renew to continue.'
                });
            }
        } catch (error) {
            // Silently handle refresh errors
        }
    }

    stopRefresh(videoId) {
        const videoData = this.activeVideos.get(videoId);
        if (videoData) {
            clearInterval(videoData.timer);
            this.activeVideos.delete(videoId);
        }
    }

    stopAll() {
        this.activeVideos.forEach((data, videoId) => {
            clearInterval(data.timer);
        });
        this.activeVideos.clear();
    }
}

// Global instance
const tokenRefreshManager = new VideoTokenRefreshManager();

// --- Session Token Refresh Manager ---
class SessionRefreshManager {
    constructor() {
        this.refreshTimer = null;
        this.checkInterval = 300000; // 5 minutes
    }

    start() {
        // Check immediately
        this.checkAndRefresh();
        
        // Then check every 5 minutes
        this.refreshTimer = setInterval(() => {
            this.checkAndRefresh();
        }, this.checkInterval);
    }

    async checkAndRefresh() {
        const token = localStorage.getItem('lustroom_jwt');
        const obtainedAt = parseInt(localStorage.getItem('lustroom_jwt_obtained_at'), 10);
        const expiresIn = parseInt(localStorage.getItem('lustroom_jwt_expires_in'), 10);

        if (!token || isNaN(obtainedAt) || isNaN(expiresIn)) {
            this.stop();
            return;
        }

        const nowInSeconds = Math.floor(Date.now() / 1000);
        const expiryTime = obtainedAt + expiresIn;
        const timeUntilExpiry = expiryTime - nowInSeconds;

        // Refresh if less than 10 minutes remaining
        if (timeUntilExpiry < 600 && timeUntilExpiry > 0) {
            await this.refreshSession();
        }
    }

    async refreshSession() {
        try {
            const token = localStorage.getItem('lustroom_jwt');
            if (!token) return;

            const response = await fetch(`${API_BASE_URL}/refresh-session`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (response.ok && data.status === 'success') {
                // Update stored token
                localStorage.setItem('lustroom_jwt', data.access_token);
                localStorage.setItem('lustroom_jwt_expires_in', data.expires_in);
                localStorage.setItem('lustroom_jwt_obtained_at', Math.floor(Date.now() / 1000));
            } else if (response.status === 403) {
                // Subscription expired - redirect to login
                this.stop();
                localStorage.clear();
                window.location.href = 'login.html';
            }
        } catch (error) {
            // Silently handle errors
        }
    }

    stop() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
}

// Global instance
const sessionRefreshManager = new SessionRefreshManager();

// --- Video Analytics Tracker ---
class VideoAnalyticsTracker {
    constructor() {
        this.trackedVideos = new Map(); // videoId -> analytics state
        this.batchQueue = [];
        this.batchInterval = 10000; // Send batch every 10 seconds
        this.tierIdCache = new Map(); // Cache videoId -> numeric tierId
        this.sessionIdCache = new Map();  // Track session IDs
        this.startBatchTimer();
    }

    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    getSessionId(videoId) {
        if (!this.sessionIdCache.has(videoId)) {
            this.sessionIdCache.set(videoId, this.generateSessionId());
        }
        return this.sessionIdCache.get(videoId);
    }

    clearSession(videoId) {
        this.sessionIdCache.delete(videoId);
    }

    setVideoTierMapping(videoId, numericTierId) {
        this.tierIdCache.set(videoId, numericTierId);
    }

    trackEvent(videoId, event, player, tierName) {
        const numericTierId = this.tierIdCache.get(videoId) || 1;
        const sessionId = this.getSessionId(videoId);
        
        const eventData = {
            event: event,
            video_id: videoId,
            session_id: sessionId,
            tier_id: numericTierId,
            current_time: player ? player.currentTime() : 0,
            duration: player ? player.duration() : 0,
            quality: player ? this.getCurrentQuality(player) : 'auto'
        };

        this.batchQueue.push(eventData);

        if (event === 'play' || event === 'ended' || event === 'error') {
            this.sendBatch();
        }
    }

    getCurrentQuality(player) {
        try {
            const qualityLevels = player.qualityLevels();
            if (qualityLevels && qualityLevels.selectedIndex >= 0) {
                const selected = qualityLevels[qualityLevels.selectedIndex];
                return selected.height ? `${selected.height}p` : 'auto';
            }
        } catch (e) {
            // Silently handle
        }
        return 'auto';
    }

    async sendBatch() {
        if (this.batchQueue.length === 0) return;

        const batch = [...this.batchQueue];
        this.batchQueue = [];

        try {
            const token = localStorage.getItem('lustroom_jwt');
            if (!token) return;

            for (const event of batch) {
                await fetch(`${API_BASE_URL}/analytics/track`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(event)
                });
            }
        } catch (error) {
            // Silently handle errors
        }
    }

    startBatchTimer() {
        setInterval(() => {
            this.sendBatch();
        }, this.batchInterval);
    }
}

// Global instance
const analyticsTracker = new VideoAnalyticsTracker();

// --- Premium Video Player State Manager ---
class PremiumPlayerStateManager {
    constructor() {
        this.isPlaying = false;
        this.isBuffering = false;
        this.isError = false;
        this.isSeeking = false;
        this.currentQuality = 'auto';
        this.currentSpeed = 1;
        this.volume = 1;
        this.isMuted = false;
        this.isFullscreen = false;
        this.showingControls = true;
        this.controlsTimeout = null;
        this.lastActivity = Date.now();
    }

    updateActivity() {
        this.lastActivity = Date.now();
    }

    shouldHideControls() {
        return this.isPlaying && !this.isSeeking && (Date.now() - this.lastActivity > 4000);
    }
}

// --- Premium Video Quality Manager ---
class PremiumQualityManager {
    constructor(player) {
        this.player = player;
        this.qualityLevels = null;
        this.availableQualities = [];
        this.currentQuality = 'auto';
    }

    initialize() {
        try {
            if (typeof this.player.qualityLevels === 'function') {
                this.qualityLevels = this.player.qualityLevels();
                
                if (this.qualityLevels) {
                    this.qualityLevels.on('addqualitylevel', () => {
                        this.updateAvailableQualities();
                    });
                }
            } else {
                this.detectQualitiesFromTech();
            }
        } catch (error) {
            this.availableQualities = ['auto'];
        }
    }

    updateAvailableQualities() {
        if (!this.qualityLevels) return;

        const qualities = new Set();
        for (let i = 0; i < this.qualityLevels.length; i++) {
            const level = this.qualityLevels[i];
            if (level.height) {
                qualities.add(level.height);
            }
        }

        this.availableQualities = ['auto', ...Array.from(qualities).sort((a, b) => b - a)];
    }

    setQuality(quality) {
        if (!this.qualityLevels) return;

        this.currentQuality = quality;

        if (quality === 'auto') {
            for (let i = 0; i < this.qualityLevels.length; i++) {
                this.qualityLevels[i].enabled = true;
            }
        } else {
            for (let i = 0; i < this.qualityLevels.length; i++) {
                const level = this.qualityLevels[i];
                level.enabled = level.height === parseInt(quality);
            }
        }
    }

    getCurrentQualityLabel() {
        if (this.currentQuality === 'auto') {
            return 'Auto';
        }
        return `${this.currentQuality}p`;
    }

    getAvailableQualities() {
        return this.availableQualities;
    }

    detectQualitiesFromTech() {
        const tech = this.player.tech({ IWillNotUseThisInPlugins: true });
        
        if (tech && tech.vhs && tech.vhs.playlists && tech.vhs.playlists.master) {
            const playlists = tech.vhs.playlists.master.playlists;
            const qualities = new Set();
            
            playlists.forEach(playlist => {
                if (playlist.attributes && playlist.attributes.RESOLUTION) {
                    qualities.add(playlist.attributes.RESOLUTION.height);
                }
            });
            
            this.availableQualities = ['auto', ...Array.from(qualities).sort((a, b) => b - a)];
        }
    }
}

// --- Premium Video Speed Manager ---
class PremiumSpeedManager {
    constructor(player) {
        this.player = player;
        this.speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
        this.currentSpeed = 1;
    }

    setSpeed(speed) {
        this.currentSpeed = speed;
        this.player.playbackRate(speed);
    }

    getCurrentSpeedLabel() {
        return this.currentSpeed === 1 ? 'Normal' : `${this.currentSpeed}x`;
    }

    getAvailableSpeeds() {
        return this.speeds;
    }
}

// ==============================================================================
// REPLACEMENT 1: Enhanced Touch Coordinator (Complete Replacement)
// ==============================================================================
// --- Premium Video Touch Coordinator V2 (Production-Ready) ---
class PremiumTouchCoordinator {
    constructor(modal, player, controlsManager) {
        this.modal = modal;
        this.player = player;
        this.controlsManager = controlsManager;
        
        // Touch state tracking
        this.touchState = {
            startX: 0,
            startY: 0,
            startTime: 0,
            moved: false,
            isActive: false,
            target: null,
            identifier: null // Track specific touch
        };
        
        // Tap detection state
        this.tapState = {
            lastTapTime: 0,
            lastTapX: 0,
            pendingSingleTap: null // Timer for single tap delay
        };
        
        // Gesture state
        this.gestureState = {
            isSwipeSeeking: false,
            initialPlayerTime: 0
        };
        
        // Configuration
        this.config = {
            tapThreshold: 20, // Pixels - higher for Android
            doubleTapWindow: 400, // ms - more forgiving
            doubleTapDistance: 100, // Pixels - allow more distance
            swipeThreshold: 60, // Pixels
            swipeAngleThreshold: 30 // Degrees - must be mostly horizontal
        };
        
        // Click prevention tracking
        this.syntheticClickPrevention = {
            active: false,
            timeout: null
        };
        
        this.init();
    }
    
    init() {
        // Passive listeners for performance, except where we need to prevent
        this.modal.addEventListener('touchstart', this.handleTouchStart.bind(this), { 
            passive: true, // Passive - we don't prevent here
            capture: false 
        });
        
        this.modal.addEventListener('touchmove', this.handleTouchMove.bind(this), { 
            passive: true // Passive - only prevent in specific handlers
        });
        
        this.modal.addEventListener('touchend', this.handleTouchEnd.bind(this), { 
            passive: true 
        });
        
        this.modal.addEventListener('touchcancel', this.handleTouchCancel.bind(this), {
            passive: true
        });
        
        // Capture phase click handler to prevent synthetic clicks
        this.modal.addEventListener('click', this.handleClick.bind(this), { 
            capture: true 
        });
    }
    
    handleTouchStart(e) {
        // Only track first touch (ignore multi-touch)
        if (e.touches.length > 1) {
            this.resetTouchState();
            return;
        }
        
        const touch = e.touches[0];
        const target = e.target;
        
        // Reset touch state
        this.touchState = {
            startX: touch.clientX,
            startY: touch.clientY,
            startTime: Date.now(),
            moved: false,
            isActive: true,
            target: target,
            identifier: touch.identifier
        };
        
        // Always show controls on touch
        this.controlsManager.showControls();
        
        // Check if touching an interactive control
        if (this.isInteractiveControl(target)) {
            // Let the control handle it entirely
            this.touchState.isActive = false;
            return;
        }
        
        // Check if touching video area (non-control)
        if (this.isVideoArea(target)) {
            // Prepare for gesture detection
            this.gestureState.isSwipeSeeking = false;
            if (this.player && !this.player.isDisposed()) {
                this.gestureState.initialPlayerTime = this.player.currentTime();
            }
        }
    }
    
    handleTouchMove(e) {
        if (!this.touchState.isActive) return;
        
        // Find our tracked touch
        const touch = Array.from(e.touches).find(t => t.identifier === this.touchState.identifier);
        if (!touch) return;
        
        const deltaX = touch.clientX - this.touchState.startX;
        const deltaY = touch.clientY - this.touchState.startY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Mark as moved if beyond threshold
        if (distance > this.config.tapThreshold) {
            this.touchState.moved = true;
            
            // Cancel any pending single tap
            if (this.tapState.pendingSingleTap) {
                clearTimeout(this.tapState.pendingSingleTap);
                this.tapState.pendingSingleTap = null;
            }
            
            // Check if this is a horizontal swipe (seek gesture)
            if (Math.abs(deltaX) > this.config.swipeThreshold) {
                const angle = Math.abs(Math.atan2(deltaY, deltaX) * 180 / Math.PI);
                
                // Must be mostly horizontal (angle close to 0 or 180)
                if (angle < this.config.swipeAngleThreshold || angle > (180 - this.config.swipeAngleThreshold)) {
                    this.gestureState.isSwipeSeeking = true;
                    this.showSeekFeedback(deltaX);
                }
            }
        }
    }
    
    handleTouchEnd(e) {
        if (!this.touchState.isActive) return;
        
        // Find our tracked touch
        const touch = Array.from(e.changedTouches).find(t => t.identifier === this.touchState.identifier);
        if (!touch) {
            this.resetTouchState();
            return;
        }
        
        const duration = Date.now() - this.touchState.startTime;
        const deltaX = touch.clientX - this.touchState.startX;
        
        // Handle swipe gesture completion
        if (this.gestureState.isSwipeSeeking) {
            this.commitSeekGesture(deltaX);
            this.hideSeekFeedback();
            this.preventSyntheticClick();
            this.resetTouchState();
            return;
        }
        
        // Ignore if touch moved (but wasn't a swipe)
        if (this.touchState.moved) {
            this.resetTouchState();
            return;
        }
        
        // This is a tap - process it
        this.processTap(touch.clientX, touch.clientY, duration);
        
        // Prevent synthetic click for taps
        this.preventSyntheticClick();
        
        this.resetTouchState();
    }
    
    handleTouchCancel(e) {
        this.hideSeekFeedback();
        this.resetTouchState();
    }
    
    processTap(tapX, tapY, duration) {
        const now = Date.now();
        const timeSinceLastTap = now - this.tapState.lastTapTime;
        const distanceFromLastTap = Math.abs(tapX - this.tapState.lastTapX);
        
        // Check for double-tap
        const isDoubleTap = 
            timeSinceLastTap < this.config.doubleTapWindow && 
            timeSinceLastTap > 50 && // Minimum time to avoid touch jitter
            distanceFromLastTap < this.config.doubleTapDistance;
        
        if (isDoubleTap) {
            // Cancel any pending single tap
            if (this.tapState.pendingSingleTap) {
                clearTimeout(this.tapState.pendingSingleTap);
                this.tapState.pendingSingleTap = null;
            }
            
            // Execute double-tap action immediately
            this.executeDoubleTap(tapX);
            
            // Don't reset lastTapTime to 0 - just set it far enough back
            this.tapState.lastTapTime = now - this.config.doubleTapWindow - 100;
            this.tapState.lastTapX = tapX;
        } else {
            // This might be first tap of double-tap, so delay single-tap action
            this.tapState.lastTapTime = now;
            this.tapState.lastTapX = tapX;
            
            // Clear any existing pending tap
            if (this.tapState.pendingSingleTap) {
                clearTimeout(this.tapState.pendingSingleTap);
            }
            
            // Wait for potential double-tap before executing single-tap
            this.tapState.pendingSingleTap = setTimeout(() => {
                this.executeSingleTap(tapX);
                this.tapState.pendingSingleTap = null;
            }, this.config.doubleTapWindow);
        }
    }
    
    executeSingleTap(tapX) {
        const screenWidth = window.innerWidth;
        const centerZoneStart = screenWidth * 0.25;
        const centerZoneEnd = screenWidth * 0.75;
        
        // Only center taps toggle play/pause on single tap
        if (tapX >= centerZoneStart && tapX <= centerZoneEnd) {
            this.togglePlayPause();
        }
        // Side taps just show controls (already done)
    }
    
    executeDoubleTap(tapX) {
        const screenWidth = window.innerWidth;
        const leftZone = screenWidth * 0.33;
        const rightZone = screenWidth * 0.67;
        
        if (tapX < leftZone) {
            // Left zone - skip backward
            this.skipBackward();
        } else if (tapX > rightZone) {
            // Right zone - skip forward
            this.skipForward();
        } else {
            // Center zone - toggle play/pause
            this.togglePlayPause();
        }
    }
    
    showSeekFeedback(deltaX) {
        if (!this.player || this.player.isDisposed()) return;
        
        const screenWidth = window.innerWidth;
        const seekAmount = (deltaX / screenWidth) * 30; // 30 seconds per full swipe
        const direction = deltaX > 0 ? '⏩' : '⏪';
        const seconds = Math.abs(Math.round(seekAmount));
        
        if (this.controlsManager.elements.gestureIndicator) {
            this.controlsManager.elements.gestureIndicator.textContent = `${direction} ${seconds}s`;
            this.controlsManager.elements.gestureIndicator.classList.add('show');
        }
    }
    
    commitSeekGesture(deltaX) {
        if (!this.player || this.player.isDisposed()) return;
        
        const screenWidth = window.innerWidth;
        const seekAmount = (deltaX / screenWidth) * 30;
        
        const newTime = Math.max(0, Math.min(
            this.player.duration(), 
            this.gestureState.initialPlayerTime + seekAmount
        ));
        
        this.player.currentTime(newTime);
        this.vibrate([10, 50, 10]);
    }
    
    hideSeekFeedback() {
        if (this.controlsManager.elements.gestureIndicator) {
            setTimeout(() => {
                this.controlsManager.elements.gestureIndicator.classList.remove('show');
            }, 500);
        }
    }
    
    togglePlayPause() {
        if (!this.player || this.player.isDisposed()) return;
        
        try {
            if (this.player.paused()) {
                this.player.play().catch(() => {});
            } else {
                this.player.pause();
            }
            this.vibrate(10);
        } catch (error) {
            // Player disposed
        }
    }
    
    skipBackward() {
        if (!this.player || this.player.isDisposed()) return;
        
        this.player.currentTime(Math.max(0, this.player.currentTime() - 10));
        this.controlsManager.showGestureIndicator('⏪ 10s');
        this.vibrate([10, 50, 10]);
    }
    
    skipForward() {
        if (!this.player || this.player.isDisposed()) return;
        
        const duration = this.player.duration();
        this.player.currentTime(Math.min(duration, this.player.currentTime() + 10));
        this.controlsManager.showGestureIndicator('⏩ 10s');
        this.vibrate([10, 50, 10]);
    }
    
    isInteractiveControl(target) {
        // Elements that should handle their own touches completely
        const controlSelectors = [
            '.premium-control-btn',
            '.premium-close-btn',
            '.premium-progress-bar',
            '.premium-settings-menu',
            '.premium-settings-item',
            '.premium-volume-slider',
            'button',
            'input'
        ];
        
        return controlSelectors.some(selector => target.closest(selector));
    }
    
    isVideoArea(target) {
        // Check if touching the video viewing area (not controls)
        const nonVideoSelectors = [
            '.premium-controls-wrapper',
            '.premium-player-header'
        ];
        
        return !nonVideoSelectors.some(selector => target.closest(selector));
    }
    
    preventSyntheticClick() {
        this.syntheticClickPrevention.active = true;
        
        if (this.syntheticClickPrevention.timeout) {
            clearTimeout(this.syntheticClickPrevention.timeout);
        }
        
        this.syntheticClickPrevention.timeout = setTimeout(() => {
            this.syntheticClickPrevention.active = false;
        }, 500); // 500ms should cover the 300ms delay + safety margin
    }
    
    handleClick(e) {
        // Only block synthetic clicks following our touches
        if (this.syntheticClickPrevention.active) {
            // Check if this is clicking a control that should work
            if (!this.isInteractiveControl(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        }
    }
    
    vibrate(pattern) {
        if (navigator.vibrate) {
            try {
                navigator.vibrate(pattern);
            } catch (e) {
                // Vibration not supported or failed
            }
        }
    }
    
    resetTouchState() {
        this.touchState = {
            startX: 0,
            startY: 0,
            startTime: 0,
            moved: false,
            isActive: false,
            target: null,
            identifier: null
        };
        
        this.gestureState.isSwipeSeeking = false;
    }
    
    destroy() {
        if (this.tapState.pendingSingleTap) {
            clearTimeout(this.tapState.pendingSingleTap);
        }
        if (this.syntheticClickPrevention.timeout) {
            clearTimeout(this.syntheticClickPrevention.timeout);
        }
        this.resetTouchState();
    }
}
// ==============================================================================
// END REPLACEMENT 1
// ==============================================================================

// --- Premium Video Controls UI Manager ---
class PremiumControlsManager {
    constructor(container, player, state, quality, speed) {
        this.container = container;
        this.player = player;
        this.state = state;
        this.quality = quality;
        this.speed = speed;
        this.elements = {};
    }

    showControls() {
        this.state.showingControls = true;
        this.state.updateActivity();
        
        if (this.elements.header) {
            this.elements.header.classList.add('visible');
        }
        if (this.elements.controls) {
            this.elements.controls.classList.add('visible');
        }
        
        this.resetControlsTimeout();
    }

    hideControls() {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        if (this.state.isSeeking) return;
        
        if (isMobile && this.player && this.player.paused && !this.player.isDisposed()) {
            return;
        }
        
        this.state.showingControls = false;
        
        if (this.elements.header) {
            this.elements.header.classList.remove('visible');
        }
        if (this.elements.controls) {
            this.elements.controls.classList.remove('visible');
        }
    }

    resetControlsTimeout() {
        if (this.state.controlsTimeout) {
            clearTimeout(this.state.controlsTimeout);
        }
        
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const hideDelay = isMobile ? 3000 : 4000; 
        
        this.state.controlsTimeout = setTimeout(() => {
            if (this.state.shouldHideControls()) {
                this.hideControls();
            }
        }, hideDelay);
    }

    updatePlayButton(isPlaying) {
        try {
            if (this.elements.playBtn) {
                if (isPlaying) {
                    this.elements.playBtn.classList.add('playing');
                    this.elements.playBtn.setAttribute('aria-label', 'Pause');
                } else {
                    this.elements.playBtn.classList.remove('playing');
                    this.elements.playBtn.setAttribute('aria-label', 'Play');
                }
            }
            
            if (this.elements.centerPlayBtn) {
                if (!isPlaying) {
                    this.elements.centerPlayBtn.classList.add('show');
                } else {
                    this.elements.centerPlayBtn.classList.remove('show');
                }
            }
        } catch (error) {
            // Silently handle errors
        }
    }

    updateVolumeButton(volume, muted) {
        if (!this.elements.volumeBtn) return;
        
        this.elements.volumeBtn.classList.remove('low', 'mute');
        
        if (muted || volume === 0) {
            this.elements.volumeBtn.classList.add('mute');
            this.elements.volumeBtn.setAttribute('aria-label', 'Unmute');
        } else if (volume < 0.5) {
            this.elements.volumeBtn.classList.add('low');
            this.elements.volumeBtn.setAttribute('aria-label', 'Mute');
        } else {
            this.elements.volumeBtn.setAttribute('aria-label', 'Mute');
        }
    }

    updateTimeDisplay(current, duration) {
        if (!this.elements.timeDisplay) return;
        
        const currentFormatted = this.formatTime(current);
        const durationFormatted = this.formatTime(duration);
        
        this.elements.timeDisplay.textContent = `${currentFormatted} / ${durationFormatted}`;
    }

    updateProgress(current, duration, buffered) {
        if (!this.elements.progressPlayed || !duration) return;
        
        const playedPercent = (current / duration) * 100;
        this.elements.progressPlayed.style.width = `${playedPercent}%`;
        
        if (this.elements.progressHandle) {
            this.elements.progressHandle.style.left = `${playedPercent}%`;
        }
        
        // Update buffered progress
        if (this.elements.progressBuffered && buffered > 0) {
            const bufferedPercent = (buffered / duration) * 100;
            this.elements.progressBuffered.style.width = `${bufferedPercent}%`;
        }
    }

    formatTime(seconds) {
        if (!isFinite(seconds)) return '0:00';
        
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    showLoadingOverlay(show) {
        if (this.elements.loadingOverlay) {
            if (show) {
                this.elements.loadingOverlay.classList.add('active');
            } else {
                this.elements.loadingOverlay.classList.remove('active');
            }
        }
    }

    showErrorOverlay(show, message = '') {
        if (this.elements.errorOverlay) {
            if (show) {
                this.elements.errorOverlay.classList.add('active');
                if (this.elements.errorMessage) {
                    this.elements.errorMessage.textContent = message;
                }
            } else {
                this.elements.errorOverlay.classList.remove('active');
            }
        }
    }

    showChangeIndicator(text) {
        if (this.elements.changeIndicator) {
            this.elements.changeIndicator.textContent = text;
            this.elements.changeIndicator.classList.add('show');
            
            setTimeout(() => {
                this.elements.changeIndicator.classList.remove('show');
            }, 1500);
        }
    }

    showGestureIndicator(icon) {
        if (this.elements.gestureIndicator) {
            this.elements.gestureIndicator.textContent = icon;
            this.elements.gestureIndicator.classList.add('show');
            
            setTimeout(() => {
                this.elements.gestureIndicator.classList.remove('show');
            }, 800);
        }
    }
}

// --- Announcement Slider for Multiple Announcements ---
class AnnouncementSlider {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        this.swiper = null;
    }

    showAnnouncements(announcements) {
        if (!this.container || !announcements || announcements.length === 0) {
            if (this.container) this.container.style.display = 'none';
            return;
        }

        let slidesHTML = '';
        announcements.forEach(ann => {
            const hasButton = ann.button_text && ann.button_url;
            
            slidesHTML += `
                <div class="swiper-slide announcement-slide announcement-${ann.style}">
                    <div class="announcement-header">
                        <strong class="announcement-title">${ann.title}</strong>
                        <button class="announcement-dismiss" data-slide-dismiss="true" aria-label="Dismiss">×</button>
                    </div>
                    <div class="announcement-content">
                        <p>${ann.message_html}</p>
                    </div>
                    ${hasButton ? `<a href="${ann.button_url}" target="_blank" class="announcement-button">${ann.button_text}</a>` : ''}
                </div>
            `;
        });

        this.container.innerHTML = `
            <div class="swiper announcement-swiper">
                <div class="swiper-wrapper">${slidesHTML}</div>
                ${announcements.length > 1 ? '<div class="swiper-pagination"></div>' : ''}
                ${announcements.length > 1 ? '<div class="swiper-button-next"></div>' : ''}
                ${announcements.length > 1 ? '<div class="swiper-button-prev"></div>' : ''}
            </div>
        `;
        
        this.container.style.display = 'block';

        this.swiper = new Swiper('.announcement-swiper', {
            loop: announcements.length > 1,
            autoplay: announcements.length > 1 ? {
                delay: 6000,
                disableOnInteraction: false,
                pauseOnMouseEnter: true
            } : false,
            speed: 600,
            effect: 'slide',
            pagination: announcements.length > 1 ? {
                el: '.swiper-pagination',
                clickable: true,
                dynamicBullets: announcements.length > 5
            } : false,
            navigation: announcements.length > 1 ? {
                nextEl: '.swiper-button-next',
                prevEl: '.swiper-button-prev',
            } : false,
            keyboard: {
                enabled: true,
            },
            a11y: {
                prevSlideMessage: 'Previous announcement',
                nextSlideMessage: 'Next announcement',
            }
        });

        this.container.querySelectorAll('[data-slide-dismiss]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (this.swiper && announcements.length > 1) {
                    const slideIndex = this.swiper.activeIndex;
                    this.swiper.removeSlide(slideIndex);
                    
                    if (this.swiper.slides.length === 0) {
                        this.container.style.display = 'none';
                    }
                } else {
                    this.container.style.display = 'none';
                }
            });
        });
    }

    destroy() {
        if (this.swiper) {
            this.swiper.destroy(true, true);
            this.swiper = null;
        }
    }
}

// --- Load user data from localStorage ---
function loadUserData() {
    try {
        userInfo = JSON.parse(localStorage.getItem('user_info') || 'null');
        userSubscriptions = JSON.parse(localStorage.getItem('user_subscriptions') || '[]');
        return true;
    } catch (error) {
        userInfo = null;
        userSubscriptions = [];
        return false;
    }
}

// --- Subscription Status Renderer ---
function renderSubscriptionStatus() {
    const subscriptionStatusDiv = document.getElementById('subscriptionStatus');
    if (!subscriptionStatusDiv) return;

    if (!userSubscriptions || userSubscriptions.length === 0) {
        subscriptionStatusDiv.style.display = 'none';
        return;
    }

    try {
        subscriptionStatusDiv.innerHTML = '';
        subscriptionStatusDiv.style.display = 'flex';
        subscriptionStatusDiv.style.flexWrap = 'wrap';
        subscriptionStatusDiv.style.gap = '10px';
        subscriptionStatusDiv.style.alignItems = 'center';

        userSubscriptions.forEach(sub => {
            const daysRemaining = sub.days_remaining;
            let statusText, statusClass;
            
            if (daysRemaining > 7) {
                statusText = `Active: ${daysRemaining} days left`;
                statusClass = 'status-active';
            } else if (daysRemaining > 0) {
                statusText = `Expires in ${daysRemaining} days`;
                statusClass = 'status-warning';
            } else {
                statusText = 'Membership Expired';
                statusClass = 'status-expired';
            }

            const badge = document.createElement('div');
            badge.className = `subscription-status-badge ${statusClass}`;
            badge.innerHTML = `
                <span class="badge-tier-name">${sub.tier_name}</span>
                <span class="badge-divider">|</span>
                <span class="badge-status-text">${statusText}</span>
            `;
            
            subscriptionStatusDiv.appendChild(badge);
        });

    } catch (error) {
        subscriptionStatusDiv.style.display = 'none';
    }
}

// --- RENEWAL AND SUPPORT RENDERERS ---
function renderRenewalBanner() {
    const existingBanner = document.getElementById('renewalBanner');
    if (existingBanner) {
        existingBanner.remove();
    }

    if (!userSubscriptions || userSubscriptions.length === 0) return;

    const expiringSubscriptions = userSubscriptions.filter(sub => {
        if (!sub.end_date) return false;
        const expiryDate = new Date(sub.end_date);
        const now = new Date();
        const diffTime = expiryDate - now;
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return days <= 7 && days > 0;
    });

    let expiringSubscription = expiringSubscriptions.find(sub => sub.platform_name === 'Echo Chamber' && sub.renewal_url);

    if (!expiringSubscription) {
        expiringSubscription = expiringSubscriptions.find(sub => sub.renewal_url);
    }

    if (expiringSubscription) {
        const expiryDate = new Date(expiringSubscription.end_date);
        const now = new Date();
        const diffTime = expiryDate - now;
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const renewalUrl = expiringSubscription.renewal_url;
        
        if (!renewalUrl) return;
        
        const banner = document.createElement('div');
        banner.id = 'renewalBanner';
        banner.className = 'renewal-banner';
        banner.innerHTML = `
            <span>Your access expires in ${days} day${days !== 1 ? 's' : ''}. Please renew to maintain access.</span>
            <a href="${renewalUrl}" target="_blank" class="renew-button">Renew Now</a>
        `;
        
        const appContainer = document.getElementById('appContainer');
        if (appContainer) {
            appContainer.querySelector('header').after(banner);
        }
    }
}

async function renderHeaderActions() {
    let supportUrl = null;
    if (userSubscriptions.length > 0) {
        const echoChamberSub = userSubscriptions.find(sub => sub.platform_name === 'Echo Chamber' && sub.support_url);
        if (echoChamberSub) {
            supportUrl = echoChamberSub.support_url;
        } else {
            const fallbackSub = userSubscriptions.find(sub => sub.support_url);
            if (fallbackSub) {
                supportUrl = fallbackSub.support_url;
            }
        }
    }
    
    const supportLink = document.getElementById('supportLink');

    if (supportLink && supportUrl) {
        supportLink.href = supportUrl;
        supportLink.style.display = 'inline-block';
    } else if (supportLink) {
        supportLink.style.display = 'none';
    }

    const downloadAppButton = document.getElementById('downloadAppButton');
    if (downloadAppButton) {
        try {
            const token = localStorage.getItem('lustroom_jwt');
            if (!token) {
                downloadAppButton.style.display = 'none';
                return;
            }

            const response = await fetch(`${API_BASE_URL}/profile`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const data = await response.json();
            
            if (response.ok && data.status === 'success' && data.system_config) {
                const systemConfig = data.system_config;
                const showButton = systemConfig.show_download_button === 'true';
                const downloadUrl = systemConfig.download_app_url || '';
                
                if (showButton && downloadUrl) {
                    downloadAppButton.href = downloadUrl;
                    downloadAppButton.style.display = 'inline-block';
                } else {
                    downloadAppButton.style.display = 'none';
                }
            } else {
                downloadAppButton.style.display = 'none';
            }
        } catch (error) {
            downloadAppButton.style.display = 'none';
        }
    }
}

// --- Logic for login.html ---
if (document.getElementById('loginForm')) {
    const loginForm = document.getElementById('loginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const errorMessageDiv = document.getElementById('errorMessage');
    const loadingMessageDiv = document.getElementById('loadingMessage');

    const themeManager = new ThemeManager();

    loginForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();

        if (!email || !password) {
            displayError("Please enter both email and password.");
            return;
        }

        showLoading(true);
        displayError("");

        try {
            const response = await fetch(`${API_BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, password: password }),
            });

            const data = await response.json();
            
            if (response.ok && data.status === 'success' && data.access_token) {
                localStorage.setItem('lustroom_jwt', data.access_token);
                localStorage.setItem('lustroom_jwt_expires_in', data.expires_in);
                localStorage.setItem('lustroom_jwt_obtained_at', Math.floor(Date.now() / 1000));
                localStorage.setItem('user_info', JSON.stringify(data.user_info));
                
                try {
                    const profileResponse = await fetch(`${API_BASE_URL}/profile`, {
                        headers: { 'Authorization': `Bearer ${data.access_token}` }
                    });
                    
                    const profileData = await profileResponse.json();
                    
                    if (profileResponse.ok && profileData.status === 'success') {
                        localStorage.setItem('user_subscriptions', JSON.stringify(profileData.subscriptions));
                        
                        if (profileData.announcements) {
                            localStorage.setItem('global_announcements', JSON.stringify(profileData.announcements));
                        } else {
                            localStorage.removeItem('global_announcements');
                        }
                        
                        if (profileData.system_config) {
                            localStorage.setItem('system_config', JSON.stringify(profileData.system_config));
                        } else {
                            localStorage.removeItem('system_config');
                        }
                        
                        loadUserData();
                        window.location.href = 'links.html';
                    } else {
                        displayError("Failed to load user profile. Please try logging in again.");
                        showLoading(false);
                    }
                } catch (profileError) {
                    displayError("An error occurred while loading your profile. Please try again.");
                    showLoading(false);
                }
            } else {
                displayError(data.message || "Login failed. Please check your credentials.");
                showLoading(false);
            }
        } catch (error) {
            showLoading(false);
            displayError("An error occurred while trying to log in. Please check your internet connection or try again later.");
        }
    });

    function displayError(message) {
        if (errorMessageDiv) {
            errorMessageDiv.textContent = message;
            errorMessageDiv.style.display = message ? 'block' : 'none';
        }
    }

    function showLoading(isLoading) {
        if (loadingMessageDiv) {
            loadingMessageDiv.style.display = isLoading ? 'block' : 'none';
        }
        if (loginForm) {
            const submitButton = loginForm.querySelector('button[type="submit"]');
            if (submitButton) {
                submitButton.disabled = isLoading;
            }
        }
    }
}

// --- Logic for links.html (The main application view) ---
if (document.getElementById('appContainer')) {
    const mainContent = document.getElementById('mainContent');
    const logoutButton = document.getElementById('logoutButton');
    const searchContainer = document.getElementById('searchContainer');
    const searchInput = document.getElementById('searchInput');

    const themeManager = new ThemeManager();
    const announcementSlider = new AnnouncementSlider('#announcementSliderContainer');

    function isTokenValid() {
        const token = localStorage.getItem('lustroom_jwt');
        const obtainedAt = parseInt(localStorage.getItem('lustroom_jwt_obtained_at'), 10);
        const expiresIn = parseInt(localStorage.getItem('lustroom_jwt_expires_in'), 10);
        if (!token || isNaN(obtainedAt) || isNaN(expiresIn)) return false;
        const nowInSeconds = Math.floor(Date.now() / 1000);
        return (obtainedAt + expiresIn - 60) > nowInSeconds;
    }

    function displayError(message, container = mainContent) {
        container.innerHTML = `<div class="error-message">${message}</div>`;
    }

    function isRecent(dateString, daysThreshold = 7) {
        if (!dateString) return false;
        try {
            const contentDate = new Date(dateString);
            const now = new Date();
            const thresholdDate = new Date(now.getTime() - (daysThreshold * 24 * 60 * 60 * 1000));
            return contentDate > thresholdDate;
        } catch (error) {
            return false;
        }
    }

    function getDaysAgo(dateString) {
        if (!dateString) return '';
        try {
            const contentDate = new Date(dateString);
            const now = new Date();
            const diffTime = now - contentDate;
            const diffDays = Math.floor(diffTime / (24 * 60 * 60 * 1000));
            return diffDays === 0 ? 'Today' : `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
        } catch (error) {
            return '';
        }
    }

    function hasRecentContent(contentData) {
        return Object.values(contentData)
            .flat()
            .some(link => isRecent(link.added_at));
    }

    function generateSearchableText(link) {
        return [
            link.title || '',
            link.description || '',
            link.category || ''
        ].join(' ').toLowerCase().trim();
    }

    function setupCopyButtonDelegation() {
        const linksContentContainer = document.getElementById('linksContentContainer');
        if (!linksContentContainer) return;

        linksContentContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('copy-btn')) {
                const linkCard = event.target.closest('.link-card');
                const linkElement = linkCard.querySelector('h3 a');
                const url = linkElement ? linkElement.href : '';

                if (url && url !== '#') {
                    navigator.clipboard.writeText(url).then(() => {
                        event.target.textContent = 'Copied! ✓';
                        event.target.classList.add('copied');
                        setTimeout(() => {
                            event.target.textContent = 'Copy Link';
                            event.target.classList.remove('copied');
                        }, 2000);
                    }).catch(err => {});
                }
            }
        });
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function handleSearchInput(event) {
        const query = event.target.value.toLowerCase().trim();
        currentFilterState.query = query;

        const emptyMessage = document.getElementById('searchEmptyMessage');
        if (emptyMessage && query === '') {
            emptyMessage.remove();
        }

        if (searchScope === 'tiers') {
            handleTierLevelSearch(query);
        } else {
            applyFilters();
        }
    }

    function handleTierLevelSearch(query) {
        const tierCards = document.querySelectorAll('.tier-card');
        let visibleCount = 0;

        tierCards.forEach(card => {
            const searchText = card.dataset.searchableText || '';
            const isMatch = query === '' || searchText.includes(query);

            card.style.display = isMatch ? 'block' : 'none';
            if (isMatch) {
                visibleCount++;
                card.classList.add('search-match');
            } else {
                card.classList.remove('search-match');
            }
        });

        updateTierSearchResults(visibleCount, query);
    }

    function updateTierSearchResults(visibleCount, query) {
        const tiersGrid = document.querySelector('.tiers-grid');
        const existingMessage = document.getElementById('tierSearchMessage');

        if (existingMessage) existingMessage.remove();

        if (query === '') {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.id = 'tierSearchMessage';
        messageDiv.className = 'search-result-message';

        if (visibleCount === 0) {
            messageDiv.textContent = `No tiers found matching "${query}"`;
            messageDiv.classList.add('no-results');
        } else {
            messageDiv.textContent = `Found ${visibleCount} tier${visibleCount === 1 ? '' : 's'} matching "${query}"`;
            messageDiv.classList.add('has-results');
        }

        tiersGrid.parentNode.insertBefore(messageDiv, tiersGrid);
    }

    async function ensurePlatformsData() {
        if (allPlatformsData.length > 0) {
            return Promise.resolve(allPlatformsData);
        }

        const response = await fetch(`${API_BASE_URL}/platforms`);
        const data = await response.json();

        if (response.ok && data.status === 'success' && data.platforms) {
            allPlatformsData = data.platforms;
            return allPlatformsData;
        } else {
            throw new Error(data.message || "Failed to fetch platforms.");
        }
    }

    async function ensureTiersData(platformId) {
        if (allTiersData[platformId]) {
            return Promise.resolve(allTiersData[platformId]);
        }

        const token = localStorage.getItem('lustroom_jwt');
        const response = await fetch(`${API_BASE_URL}/platforms/${platformId}/tiers`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (response.ok && data.status === 'success' && data.tiers) {
            allTiersData[platformId] = data.tiers;
            return allTiersData[platformId];
        } else {
            throw new Error(data.message || "Failed to fetch tiers.");
        }
    }

    function renderPlatformSkeleton() {
        let skeletonHTML = '<h2>Platforms</h2><div class="platforms-grid">';
        for (let i = 0; i < 3; i++) {
            skeletonHTML += `<div class="platform-card-skeleton"><div class="skeleton skeleton-platform-thumbnail"></div><div class="skeleton skeleton-platform-title"></div></div>`;
        }
        skeletonHTML += '</div>';
        mainContent.innerHTML = skeletonHTML;
        searchContainer.style.display = 'none';
    }

    function renderTierSkeleton(platformName) {
        let skeletonHTML = `
            <div class="view-header">
                <button id="backButton" class="back-button">← Back to Platforms</button>
                <h2>${platformName || 'Tiers'}</h2>
            </div>
            <div class="tiers-grid">`;
        for (let i = 0; i < 3; i++) {
            skeletonHTML += `<div class="tier-card-skeleton"><div class="skeleton skeleton-tier-thumbnail"></div><div class="skeleton skeleton-tier-title"></div></div>`;
        }
        skeletonHTML += '</div>';
        mainContent.innerHTML = skeletonHTML;
        searchContainer.style.display = 'block';
        searchInput.placeholder = `Search in ${platformName || 'Tiers'}`;
        addBackButtonListener('platforms');
    }

    function renderContentSkeleton(tierName, platformName) {
        let skeletonHTML = `
            <div class="view-header">
                <button id="backButton" class="back-button">← Back to Tiers</button>
                <h2>${tierName || 'Content'} <span class="header-breadcrumb">/ ${platformName}</span></h2>
            </div>`;
        for (let i = 0; i < 2; i++) {
            skeletonHTML += `<div class="tier-group"><div class="skeleton skeleton-title"></div><div class="skeleton-card"><div class="skeleton skeleton-thumbnail"></div><div class="skeleton-card-content"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text short"></div></div></div></div>`;
        }
        mainContent.innerHTML = skeletonHTML;
        searchContainer.style.display = 'block';
        searchInput.placeholder = `Search in ${tierName || 'Content'}`;
        const urlParams = new URLSearchParams(window.location.search);
        addBackButtonListener('tiers', urlParams.get('platform_id'));
    }

    function renderGallerySkeleton() {
        let skeletonHTML = `
            <div class="view-header">
                <button id="backButton" class="back-button">← Back</button>
                <h2>Gallery</h2>
            </div>
            <div class="gallery-container">
                <div class="gallery-skeleton">
                    <div class="skeleton skeleton-gallery-title"></div>
                    <div class="skeleton skeleton-gallery-description"></div>
                    <div class="gallery-grid">`;
        
        for (let i = 0; i < 6; i++) {
            skeletonHTML += `<div class="gallery-item-skeleton"><div class="skeleton skeleton-gallery-image"></div></div>`;
        }
        
        skeletonHTML += `</div></div></div>`;
        mainContent.innerHTML = skeletonHTML;
        searchContainer.style.display = 'none';
    }

    const platformModal = document.getElementById('platformModal');

    function showPlatformModal(platform) {
        if (!platformModal) return;
        document.getElementById('modalImage').src = platform.thumbnail_url || '';
        document.getElementById('modalTitle').textContent = platform.name;
        document.getElementById('modalDescription').innerHTML = platform.description;

        const teaserContainer = document.getElementById('modalTeaserContainer');
        if (platform.teaser_video_urls && platform.teaser_video_urls.length > 0) {
            const randomTeaser = platform.teaser_video_urls[Math.floor(Math.random() * platform.teaser_video_urls.length)];
            document.getElementById('modalTeaserVideo').src = randomTeaser;
            teaserContainer.style.display = 'block';
        } else {
            teaserContainer.style.display = 'none';
        }

        const socialsContainer = document.getElementById('modalSocials');
        socialsContainer.innerHTML = '';
        if (platform.social_links && Object.keys(platform.social_links).length > 0) {
            for (const [name, url] of Object.entries(platform.social_links)) {
                const link = document.createElement('a');
                link.href = url;
                link.target = '_blank';
                link.className = 'social-link';
                link.textContent = name.charAt(0).toUpperCase() + name.slice(1);
                socialsContainer.appendChild(link);
            }
        }

        document.getElementById('modalContact').innerHTML = platform.contact_info_html || '<p>Contact the provider for access details.</p>';
        platformModal.style.display = 'block';
    }

    function hideModal(modalElement) {
        if (modalElement) {
            modalElement.style.display = 'none';
            if (modalElement.id === 'platformModal') {
                const video = document.getElementById('modalTeaserVideo');
                if(video) video.pause();
            }
        }
    }

    document.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.onclick = () => hideModal(btn.closest('.modal'));
    });

    window.onclick = function(event) {
        if (event.target.classList.contains('modal')) {
            hideModal(event.target);
        }
    };

    function renderPlatforms(platforms) {
        let platformsHTML = '<div class="platforms-grid">';
        platforms.forEach(platform => {
            const hasSubscription = userSubscriptions.some(sub => sub.platform_id === platform.id);
            platformsHTML += `<div class="platform-card ${!hasSubscription ? 'locked' : ''}" data-platform-id="${platform.id}"><div class="platform-thumbnail" style="background-image: url('${platform.thumbnail_url || ''}')"></div><div class="platform-name">${platform.name}</div>${!hasSubscription ? '<div class="lock-icon">🔒</div>' : ''}</div>`;
        });
        platformsHTML += '</div>';

        let welcomeHTML = '';
        if (userInfo && userInfo.name) {
            welcomeHTML = `<div class="welcome-message">Welcome back, ${userInfo.name}!</div>`;
        }

        mainContent.innerHTML = welcomeHTML + '<h2>Platforms</h2>' + platformsHTML;
        searchContainer.style.display = 'none';
        mainContent.querySelector('.platforms-grid').addEventListener('click', handlePlatformClick);
    }

    function renderTiers(tiers, platformId, platformName) {
    if (!tiers || !Array.isArray(tiers)) {
        displayError("No tiers data available for this platform.");
        return;
    }

    let tiersHTML = `
        <div class="view-header">
            <button id="backButton" class="back-button">← Back to Platforms</button>
            <h2>${platformName} Tiers</h2>
        </div>
        <div class="tiers-grid">`;
    tiers.forEach(tier => {
        const isLocked = !tier.is_accessible;
        const lockedClass = isLocked ? 'locked' : '';
        const lockIcon = isLocked ? '<div class="lock-icon">🔒</div>' : '';
        
        tiersHTML += `<div class="tier-card ${lockedClass}" data-tier-id="${tier.id}" data-searchable-text="${(tier.name + ' ' + (tier.description || '')).toLowerCase()}"><div class="tier-thumbnail" style="background-image: url('${tier.thumbnail_url || ''}')"></div><div class="tier-name">${tier.name}</div>${lockIcon}</div>`;
    });
        tiersHTML += '</div>';
        mainContent.innerHTML = tiersHTML;
        searchContainer.style.display = 'block';
        searchInput.placeholder = `Search in ${platformName || 'Tiers'}`;
        searchInput.value = '';
        currentFilterState.query = '';
        const existingMessage = document.getElementById('tierSearchMessage');
        if (existingMessage) existingMessage.remove();
        mainContent.querySelector('.tiers-grid').addEventListener('click', (e) => handleTierClick(e, platformId));
        addBackButtonListener('platforms');
    }

    function fetchAndDisplayTiers(platformId, platformName) {
        searchScope = 'tiers';
        const tiersData = allTiersData[platformId];

        if (!tiersData || !Array.isArray(tiersData)) {
            displayError("Unable to load tiers for this platform.");
            return;
        }

        renderTiers(tiersData, platformId, platformName);
    }

    async function fetchAndDisplayContent(platformId, tierId, tierName, platformName) {
        searchScope = 'content';
        renderContentSkeleton(tierName, platformName);
        try {
            const token = localStorage.getItem('lustroom_jwt');
            const response = await fetch(`${API_BASE_URL}/get_patron_links?tier_id=${tierId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            
            if (response.ok && data.status === 'success' && data.content) {
                currentContentData = data.content;
                currentFilterState = { view: 'All', type: 'All', query: '' };

                mainContent.innerHTML = `
                    <div class="view-header">
                        <button id="backButton" class="back-button">← Back to Tiers</button>
                        <h2>${tierName} <span class="header-breadcrumb">/ ${platformName}</span></h2>
                    </div>
                    <div id="filterContainer" class="filter-container"></div>
                    <div id="linksContentContainer"></div>`;

                const linksContentContainer = document.getElementById('linksContentContainer');
                searchContainer.style.display = 'block';
                searchInput.placeholder = `Search in ${tierName || 'Content'}`;
                searchInput.value = '';
                searchInput.addEventListener('input', debounce(handleSearchInput, 300));
                addBackButtonListener('tiers', platformId);
                renderContent(data.content, platformId);
                setupFilters(data.content);
                setupCopyButtonDelegation();
            } else if (response.status === 401 || response.status === 403) {
                localStorage.clear();
                window.location.href = 'login.html';
            } else {
                displayError(data.message || "Failed to fetch content.");
            }
        } catch (error) {
            displayError("An error occurred while fetching content.");
        }
    }

    function renderContent(contentData, platformId) {
        const linksContentContainer = document.getElementById('linksContentContainer');
        if (!linksContentContainer) return;
        linksContentContainer.innerHTML = '';
        if (Object.keys(contentData).length === 0) {
            linksContentContainer.innerHTML = `<p class="empty-tier-message">This tier has no content yet. Check back soon!</p>`;
            return;
        }
        let hasVisibleContent = false;
        for (const tierName in contentData) {
            const links = contentData[tierName];
            if (links.length === 0) continue;
            const tierGroup = document.createElement('div');
            tierGroup.className = 'tier-group';
            links.forEach(link => {
                const isRecentContent = isRecent(link.added_at);

                const card = document.createElement('div');
                card.className = 'link-card';
                if (link.locked) card.classList.add('locked');
                if (isRecentContent) {
                    card.classList.add('is-new');
                }
                card.dataset.contentType = link.content_type || 'Video';
                card.dataset.recentStatus = isRecentContent ? 'true' : 'false';
                card.dataset.searchText = generateSearchableText(link);
                card.dataset.tierName = tierName;
                card.dataset.platformId = platformId;
                card.dataset.tierId = link.tier_id;

                const isGallery = link.content_type === 'Gallery';

                if (link.thumbnail_url) {
                    const thumbnailContainer = document.createElement('div');
                    thumbnailContainer.className = 'thumbnail-container';
                    
                    if (!isGallery && !link.locked) {
                        const playOverlay = document.createElement('div');
                        playOverlay.className = 'video-play-overlay';
                        playOverlay.innerHTML = `
                            <svg viewBox="0 0 24 24" fill="white" width="64" height="64">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                        `;
                        thumbnailContainer.appendChild(playOverlay);
                    }
                    
                    if (isRecentContent) {
                        const newBadge = document.createElement('div');
                        newBadge.className = 'new-badge';
                        newBadge.textContent = `New! (${getDaysAgo(link.added_at)})`;
                        thumbnailContainer.appendChild(newBadge);
                    }
                    const thumbnailImage = document.createElement('img');
                    thumbnailImage.src = link.thumbnail_url;
                    thumbnailImage.alt = `Thumbnail for ${link.title}`;
                    thumbnailImage.loading = 'lazy';
                    thumbnailContainer.appendChild(thumbnailImage);
                    
                    if (!isGallery && !link.locked) {
                        thumbnailContainer.style.cursor = 'pointer';
                        thumbnailContainer.addEventListener('click', () => {
                            openVideoPlayer(link, tierName);
                        });
                    }
                    
                    card.appendChild(thumbnailContainer);
                }

                const cardContent = document.createElement('div');
                cardContent.className = 'card-content';

                const title = document.createElement('h3');
                const titleText = document.createTextNode(link.title || "Untitled Link");
                title.appendChild(titleText);
                
                if (isGallery) {
                    const icon = document.createElement('span');
                    icon.className = 'content-type-icon gallery-icon';
                    icon.textContent = '🖼️';
                    title.prepend(icon);
                }
                
                if (isRecentContent && !link.thumbnail_url) {
                    const newBadgeText = document.createElement('span');
                    newBadgeText.className = 'new-badge-text';
                    newBadgeText.textContent = `New! (${getDaysAgo(link.added_at)})`;
                    title.appendChild(newBadgeText);
                }
                cardContent.appendChild(title);

                if (link.description) {
                    const description = document.createElement('p');
                    description.textContent = link.description;
                    cardContent.appendChild(description);
                }

                const metaInfo = document.createElement('div');
                metaInfo.className = 'meta-info';
                if (link.category) {
                    const categorySpan = document.createElement('span');
                    categorySpan.innerHTML = `<strong>Category:</strong> ${link.category}`;
                    metaInfo.appendChild(categorySpan);
                }
                cardContent.appendChild(metaInfo);

                const actionsContainer = document.createElement('div');
                actionsContainer.className = 'card-actions';

                if (!link.locked) {
                    if (isGallery) {
                        const viewButton = document.createElement('a');
                        viewButton.className = 'view-gallery-btn';
                        viewButton.textContent = '🖼️ View Gallery';
                        viewButton.href = `links.html?view=gallery&slug=${link.url}`;
                        actionsContainer.appendChild(viewButton);
                    } else {
                        const watchButton = document.createElement('button');
                        watchButton.className = 'watch-video-btn';
                        watchButton.textContent = '▶️ Watch Video';
                        watchButton.addEventListener('click', () => {
                            openVideoPlayer(link, tierName);
                        });
                        actionsContainer.appendChild(watchButton);
                    }
                    cardContent.appendChild(actionsContainer);
                }

                card.appendChild(cardContent);
                tierGroup.appendChild(card);
            });
            linksContentContainer.appendChild(tierGroup);
            hasVisibleContent = true;
        }
        if (!hasVisibleContent) {
            linksContentContainer.innerHTML = `<p class="empty-tier-message">No content matches your search/filter criteria.</p>`;
        }
    }

    function setupFilters(contentData) {
        const filterContainer = document.getElementById('filterContainer');
        if (!filterContainer) return;

        const contentTypes = new Set();
        Object.values(contentData).flat().forEach(link => contentTypes.add(link.content_type || 'Video'));

        const hasRecent = hasRecentContent(contentData);

        if (contentTypes.size <= 1 && !hasRecent) {
            filterContainer.style.display = 'none';
            return;
        }

        filterContainer.style.display = 'block';
        filterContainer.innerHTML = '';

        const viewFiltersRow = document.createElement('div');
        viewFiltersRow.className = 'filter-row view-filters';
        const typeFiltersRow = document.createElement('div');
        typeFiltersRow.className = 'filter-row type-filters';

        const allViewButton = document.createElement('button');
        allViewButton.className = 'filter-btn view-filter active';
        allViewButton.textContent = 'All Content';
        allViewButton.dataset.filter = 'All';
        allViewButton.dataset.filterType = 'view';
        viewFiltersRow.appendChild(allViewButton);

        if (hasRecent) {
            const recentButton = document.createElement('button');
            recentButton.className = 'filter-btn view-filter';
            recentButton.textContent = 'Recently Added';
            recentButton.dataset.filter = 'Recent';
            recentButton.dataset.filterType = 'view';
            viewFiltersRow.appendChild(recentButton);
        }

        if (contentTypes.size > 1) {
            const allTypeButton = document.createElement('button');
            allTypeButton.className = 'filter-btn type-filter active';
            allTypeButton.textContent = 'All Types';
            allTypeButton.dataset.filter = 'All';
            allTypeButton.dataset.filterType = 'type';
            typeFiltersRow.appendChild(allTypeButton);

            contentTypes.forEach(type => {
                const button = document.createElement('button');
                button.className = 'filter-btn type-filter';
                button.textContent = type;
                button.dataset.filter = type;
                button.dataset.filterType = 'type';
                typeFiltersRow.appendChild(button);
            });
        }

        filterContainer.appendChild(viewFiltersRow);
        if (typeFiltersRow.children.length > 0) {
            filterContainer.appendChild(typeFiltersRow);
        }

        filterContainer.addEventListener('click', handleFilterClick);
    }

    function handleFilterClick(event) {
        if (!event.target.classList.contains('filter-btn')) return;

        const filterValue = event.target.dataset.filter;
        const filterType = event.target.dataset.filterType;

        if (filterType === 'view') {
            currentFilterState.view = filterValue;
            document.querySelectorAll('.view-filter').forEach(btn => btn.classList.remove('active'));
        } else if (filterType === 'type') {
            currentFilterState.type = filterValue;
            document.querySelectorAll('.type-filter').forEach(btn => btn.classList.remove('active'));
        }

        event.target.classList.add('active');
        applyFilters();
    }

    function applyFilters() {
        const { view, type, query } = currentFilterState;

        let hasVisibleContent = false;
        const emptyMessage = document.getElementById('searchEmptyMessage');
        if (emptyMessage) {
            emptyMessage.remove();
        }

        document.querySelectorAll('.link-card').forEach(card => {
            const isRecentContent = card.dataset.recentStatus === 'true';
            const isViewMatch = view === 'All' || (view === 'Recent' && isRecentContent);
            const isTypeMatch = type === 'All' || card.dataset.contentType === type;
            const isQueryMatch = query === '' || card.dataset.searchText.includes(query);

            const shouldShow = isViewMatch && isTypeMatch && isQueryMatch;
            card.style.display = shouldShow ? 'block' : 'none';

            if (view === 'Recent' && isRecentContent) {
                card.classList.add('recent-highlight');
            } else {
                card.classList.remove('recent-highlight');
            }

            if (shouldShow) hasVisibleContent = true;
        });

        document.querySelectorAll('.tier-group').forEach(group => {
            const hasVisibleCards = group.querySelector('.link-card:not([style*="display: none"])');
            group.style.display = hasVisibleCards ? 'block' : 'none';
        });

        if (!hasVisibleContent) {
            const linksContentContainer = document.getElementById('linksContentContainer');
            if (linksContentContainer && !document.getElementById('searchEmptyMessage')) {
                const emptyMsg = document.createElement('div');
                emptyMsg.id = 'searchEmptyMessage';
                emptyMsg.className = 'empty-tier-message';
                emptyMsg.textContent = 'No content matches your search/filter criteria.';
                linksContentContainer.appendChild(emptyMsg);
            }
        }
    }

    function handlePlatformClick(event) {
        const card = event.target.closest('.platform-card');
        if (!card) return;
        const platformId = card.dataset.platformId;
        const platformData = allPlatformsData.find(p => p.id.toString() === platformId);

        if (card.classList.contains('locked')) {
            showPlatformModal(platformData);
        } else {
            history.pushState({view: 'tiers', platformId}, '', `?view=tiers&platform_id=${platformId}`);
            router();
        }
    }

    function handleTierClick(event, platformId) {
        const card = event.target.closest('.tier-card');
        if (!card) return;
        
        const tierId = card.dataset.tierId;

        history.pushState({view: 'content', platformId, tierId}, '', `?view=content&platform_id=${platformId}&tier_id=${tierId}`);
        router();
    }

    function addBackButtonListener(backTo, platformId = null) {
        const backButton = document.getElementById('backButton');
        if (!backButton) return;
        backButton.onclick = () => {
            if (backTo === 'tiers') {
                history.pushState({view: 'tiers', platformId}, '', `?view=tiers&platform_id=${platformId}`);
                router();
            } else if (backTo === 'platforms') {
                history.pushState({view: 'platforms'}, '', `links.html`);
                router();
            } else if (backTo === 'history') {
                history.back();
            }
        };
    }

    async function fetchAndDisplayGallery(slug) {
        renderGallerySkeleton();
        try {
            const token = localStorage.getItem('lustroom_jwt');
            const response = await fetch(`${API_BASE_URL}/gallery/${slug}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            
            if (response.ok && data.status === 'success' && data.gallery) {
                renderGallery(data.gallery);
            } else if (response.status === 401 || response.status === 403) {
                localStorage.clear();
                window.location.href = 'login.html';
            } else {
                displayError(data.message || "Failed to fetch gallery.");
            }
        } catch (error) {
            displayError("An error occurred while fetching the gallery.");
        }
    }

    function renderGallery(galleryData) {
        mainContent.innerHTML = `
            <div class="view-header">
                <button id="backButton" class="back-button">← Back</button>
                <h2>${galleryData.title} <span class="header-breadcrumb">/ ${galleryData.platform_name}</span></h2>
            </div>
            <div class="gallery-container">
                <div class="gallery-info">
                    <h3>${galleryData.title}</h3>
                    <p>${galleryData.description || ''}</p>
                </div>
                <div class="gallery-grid pswp-gallery" id="galleryGrid"></div>
            </div>
        `;
        
        const galleryGrid = document.getElementById('galleryGrid');
        
        galleryData.images.forEach((image, index) => {
            const item = document.createElement('div');
            item.className = 'gallery-item';
            
            const tempImg = new Image();
            const linkElement = document.createElement('a');
            linkElement.href = image.url;
            linkElement.setAttribute('data-pswp-width', '1920');
            linkElement.setAttribute('data-pswp-height', '1080');
            linkElement.target = '_blank';
            
            tempImg.onload = function() {
                linkElement.setAttribute('data-pswp-width', this.naturalWidth.toString());
                linkElement.setAttribute('data-pswp-height', this.naturalHeight.toString());
            };
            tempImg.src = image.url;
            
            const img = document.createElement('img');
            img.src = image.url;
            img.alt = image.title || `Image ${index + 1}`;
            img.loading = 'lazy';
            
            const caption = document.createElement('div');
            caption.className = 'gallery-caption';
            caption.textContent = image.title || `Image ${index + 1}`;
            
            linkElement.appendChild(img);
            linkElement.appendChild(caption);
            item.appendChild(linkElement);
            galleryGrid.appendChild(item);
        });
        
        setTimeout(() => {
            initPhotoSwipe();
        }, 500);
        
        addBackButtonListener('history');
    }

    function initPhotoSwipe() {
    if (typeof PhotoSwipeLightbox === 'undefined') {
        return;
    }
    
    try {
        const lightbox = new PhotoSwipeLightbox({
            gallery: '#galleryGrid',
            children: 'a',
            pswpModule: PhotoSwipe,
            bgOpacity: 1,
            spacing: 0.05,
            allowPanToNext: true,
            loop: true,
            pinchToClose: true,
            closeOnVerticalDrag: true,
            showHideAnimationType: 'fade',
            zoomAnimationDuration: 300,
            initialZoomLevel: 'fit',
            secondaryZoomLevel: 1.5,
            maxZoomLevel: 3,
            paddingFn: (viewportSize) => {
                return { top: 20, bottom: 20, left: 20, right: 20 };
            },
            arrowKeys: true,
            preload: [1, 2]
        });
        
        let viewedImageIndexes = new Set();
        let gallerySlugForTracking = null;
        
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('view') === 'gallery') {
            gallerySlugForTracking = urlParams.get('slug');
        }

        lightbox.on('change', () => {
            if (lightbox.pswp) {
                const currentIndex = lightbox.pswp.currIndex;
                viewedImageIndexes.add(currentIndex);
            }
        });

        lightbox.on('close', () => {
            const totalUniqueViews = viewedImageIndexes.size;

            if (totalUniqueViews > 0 && gallerySlugForTracking) {
                const token = localStorage.getItem('lustroom_jwt');
                if (token) {
                    const payload = {
                        gallery_slug: gallerySlugForTracking,
                        images_viewed_count: totalUniqueViews
                    };

                    fetch(`${API_BASE_URL}/gallery/log_view`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(payload)
                    })
                    .then(response => {
                        if (response.ok) {
                           // OK
                        }
                    })
                    .catch(error => {});
                }
            }
            
            viewedImageIndexes.clear();
            gallerySlugForTracking = null;
        });
        
        let uiHideTimeout;
        let isUIVisible = true;
        
        lightbox.on('afterInit', function() {
            const pswpElement = lightbox.pswp.element;
            
            const showUI = () => {
                isUIVisible = true;
                pswpElement.classList.add('pswp--ui-visible');
                pswpElement.classList.remove('pswp--ui-hidden');
                
                if (uiHideTimeout) {
                    clearTimeout(uiHideTimeout);
                }
                
                uiHideTimeout = setTimeout(() => {
                    isUIVisible = false;
                    pswpElement.classList.remove('pswp--ui-visible');
                    pswpElement.classList.add('pswp--ui-hidden');
                }, 3000);
            };
            
            pswpElement.addEventListener('mousemove', showUI);
            pswpElement.addEventListener('click', showUI);
            showUI();
        });
        
        lightbox.on('uiRegister', function() {
            lightbox.pswp.ui.registerElement({
                name: 'fullscreen-button',
                order: 9,
                isButton: true,
                html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
                onClick: (event, el) => {
                    if (!document.fullscreenElement) {
                        lightbox.pswp.element.requestFullscreen();
                    } else {
                        document.exitFullscreen();
                    }
                }
            });
            
            lightbox.pswp.ui.registerElement({
                name: 'download-button',
                order: 8,
                isButton: true,
                html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
                onClick: (event, el) => {
                    const currentSlide = lightbox.pswp.currSlide;
                    const link = document.createElement('a');
                    link.href = currentSlide.data.src;
                    link.download = `image-${lightbox.pswp.currIndex + 1}.jpg`;
                    link.click();
                }
            });
        });
        
        let slideshowInterval = null;
        let isPlaying = false;
        
        lightbox.on('uiRegister', function() {
            lightbox.pswp.ui.registerElement({
                name: 'play-button',
                order: 7,
                isButton: true,
                html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>',
                onClick: (event, el) => {
                    if (!isPlaying) {
                        isPlaying = true;
                        el.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>';
                        slideshowInterval = setInterval(() => {
                            lightbox.pswp.next();
                        }, 3000);
                    } else {
                        isPlaying = false;
                        el.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>';
                        clearInterval(slideshowInterval);
                    }
                }
            });
        });
        
        lightbox.on('close', function() {
            if (slideshowInterval) {
                clearInterval(slideshowInterval);
                isPlaying = false;
            }
        });
        
        lightbox.init();
    } catch (error) {}
}

    // --- PREMIUM VIDEO PLAYER (UPDATED WITH REPLACEMENTS) ---
    function openVideoPlayer(link, tierId) {
        const videoIdMatch = link.url.match(/\/([a-f0-9-]{36})\//);
        if (!videoIdMatch) return;
        
        const videoId = videoIdMatch[1];
        const libraryIdMatch = link.url.match(/library_id=(\d+)/);
        const libraryId = libraryIdMatch ? libraryIdMatch[1] : '555806';
        
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        
        const numericTierId = link.tier_id || 1;
        analyticsTracker.setVideoTierMapping(videoId, numericTierId);
        
        const modal = document.createElement('div');
        modal.className = 'premium-player-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', 'Video player');
        modal.setAttribute('aria-modal', 'true');
        
        if (isMobile) {
            modal.classList.add('mobile-player');
        }
        
        modal.innerHTML = `
            <div class="premium-player-content">
                <div class="player-loading-overlay">
                    <div class="player-spinner"></div>
                    <div class="player-loading-text">Loading video...</div>
                </div>
                
                <div class="player-error-overlay">
                    <div class="player-error-content">
                        <div class="player-error-icon">⚠️</div>
                        <div class="player-error-title">Playback Error</div>
                        <div class="player-error-message">We're having trouble playing this video. Please try again.</div>
                        <div class="player-error-actions">
                            <button class="player-error-btn player-error-btn-primary retry-btn">Retry</button>
                            <button class="player-error-btn player-error-btn-secondary close-error-btn">Close</button>
                        </div>
                    </div>
                </div>
                
                <div class="premium-player-header">
                    <button class="premium-close-btn" aria-label="Close video player">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                    <div class="premium-video-title">${link.title}</div>
                    <div class="premium-header-spacer"></div>
                </div>
                
                <div class="premium-video-wrapper">
                    <video 
                        id="premiumPlayer_${videoId}" 
                        class="video-js"
                        preload="${isMobile ? 'metadata' : 'auto'}"
                        playsinline
                        webkit-playsinline
                        x-webkit-airplay="allow"
                        x5-playsinline
                        x5-video-player-type="h5"
                        x5-video-player-fullscreen="true"
                        controlslist="nodownload nofullscreen"
                        disablepictureinpicture
                        muted
                        autoplay
                    ></video>
                    
                    <div class="premium-center-overlay">
                        <button class="premium-center-play-btn show" aria-label="Play video">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                        </button>
                    </div>
                    
                    <div class="premium-gesture-indicator"></div>
                    <div class="premium-change-indicator"></div>
                </div>
                
                <div class="premium-controls-wrapper">
                    <div class="premium-controls-bg"></div>
                    
                    <div class="premium-progress-container">
                        <div class="premium-progress-bar" role="slider" aria-label="Video progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
                            <div class="premium-progress-buffered"></div>
                            <div class="premium-progress-played"></div>
                            <div class="premium-progress-handle"></div>
                            <div class="premium-progress-thumbnail" style="display: none;">
                                <div class="premium-thumbnail-time">0:00</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="premium-controls-row">
                        <button class="premium-control-btn premium-play-btn" aria-label="Play">
                            <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                            <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                            </svg>
                        </button>
                        
                        <button class="premium-control-btn premium-skip-backward premium-skip-btn" aria-label="Rewind 10 seconds">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 5V2.21c0-.45-.54-.67-.85-.35l-3.8 3.79c-.2.2-.2.51 0 .71l3.79 3.79c.32.31.86.09.86-.36V7c3.73 0 6.68 3.42 5.86 7.29-.47 2.27-2.31 4.1-4.57 4.57-3.57.75-6.75-1.7-7.23-5.01-.07-.48-.49-.85-.98-.85-.6 0-1.08.53-1 1.13.62 4.39 4.8 7.64 9.53 6.72 3.12-.61 5.63-3.12 6.24-6.24C20.84 9.48 16.94 5 12 5z"/>
                                <text x="12" y="16" text-anchor="middle" font-size="8" font-weight="bold" fill="currentColor">10</text>
                            </svg>
                        </button>
                        
                        <button class="premium-control-btn premium-skip-forward premium-skip-btn" aria-label="Forward 10 seconds">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 5V2.21c0-.45.54-.67.85-.35l3.8 3.79c.2.2.2.51 0 .71l-3.79 3.79c-.32.31-.86.09-.86-.36V7c-3.73 0-6.68 3.42-5.86 7.29.47 2.27 2.31 4.1 4.57 4.57 3.57.75 6.75-1.7 7.23-5.01.07-.48.49-.85.98-.85.6 0 1.08.53-1 1.13-.62 4.39-4.8 7.64-9.53 6.72-3.12-.61-5.63-3.12-6.24-6.24C3.16 9.48 7.06 5 12 5z"/>
                                <text x="12" y="16" text-anchor="middle" font-size="8" font-weight="bold" fill="currentColor">10</text>
                            </svg>
                        </button>
                        
                        <div class="premium-volume-group">
                            <button class="premium-control-btn premium-volume-btn" aria-label="Mute">
                                <svg class="volume-high" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                                </svg>
                                <svg class="volume-low" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
                                </svg>
                                <svg class="volume-mute" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                                </svg>
                            </button>
                            <div class="premium-volume-slider-wrapper">
                                <input type="range" class="premium-volume-slider" min="0" max="1" step="0.01" value="1" aria-label="Volume">
                            </div>
                        </div>
                        
                        <div class="premium-time-display">0:00 / 0:00</div>
                        
                        <div class="premium-controls-spacer"></div>
                        
                        <div class="premium-settings-btn">
                            <button class="premium-control-btn" aria-label="Settings" aria-haspopup="true" aria-expanded="false">
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                                </svg>
                            </button>
                            <div class="premium-settings-menu">
                                <div class="premium-settings-section">
                                    <div class="premium-settings-header">Quality</div>
                                    <div class="premium-quality-options"></div>
                                </div>
                                <div class="premium-settings-section">
                                    <div class="premium-settings-header">Speed</div>
                                    <div class="premium-speed-options"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        const playerId = `premiumPlayer_${videoId}`;
        
        const requestFullscreen = () => {
            const elem = modal;
            if (elem.requestFullscreen) {
                elem.requestFullscreen().catch(() => {});
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            } else if (elem.mozRequestFullScreen) {
                elem.mozRequestFullScreen();
            } else if (elem.msRequestFullscreen) {
                elem.msRequestFullscreen();
            }
            
            if (isIOS) {
                setTimeout(() => {
                    const videoElement = document.querySelector(`#${playerId} video`);
                    if (videoElement && videoElement.webkitEnterFullscreen && !document.fullscreenElement) {
                        try {
                            videoElement.webkitEnterFullscreen();
                        } catch (err) {}
                    }
                }, 100);
            }
        };
        
        setTimeout(requestFullscreen, 50);
        
        const player = videojs(playerId, {
            controls: false,
            autoplay: false,
            preload: 'auto',
            playsinline: true,
            responsive: true,
            fluid: true,
            nativeControlsForTouch: false,
            html5: {
                vhs: {
                    enableLowInitialPlaylist: true,
                    smoothQualityChange: true,
                    overrideNative: !isIOS,
                    bandwidth: isMobile ? 1500000 : 5000000,
                    maxMaxBufferLength: isMobile ? 30 : 60,
                    maxBufferLength: isMobile ? 20 : 30,
                    maxBufferSize: isMobile ? 30 * 1000 * 1000 : 60 * 1000 * 1000
                },
                nativeVideoTracks: isIOS,
                nativeAudioTracks: isIOS,
                nativeTextTracks: false
            }
        });
        
        modal._player = player;
        modal._playerId = playerId;
        
        activePlayers.set(playerId, { player, modal });
        
        const stateManager = new PremiumPlayerStateManager();
        const qualityManager = new PremiumQualityManager(player);
        const speedManager = new PremiumSpeedManager(player);
        const controlsManager = new PremiumControlsManager(modal, player, stateManager, qualityManager, speedManager);
        
        const touchCoordinator = new PremiumTouchCoordinator(modal, player, controlsManager);
        
        controlsManager.elements = {
            header: modal.querySelector('.premium-player-header'),
            controls: modal.querySelector('.premium-controls-wrapper'),
            playBtn: modal.querySelector('.premium-play-btn'),
            centerPlayBtn: modal.querySelector('.premium-center-play-btn'),
            skipBackward: modal.querySelector('.premium-skip-backward'),
            skipForward: modal.querySelector('.premium-skip-forward'),
            volumeBtn: modal.querySelector('.premium-volume-btn'),
            volumeSlider: modal.querySelector('.premium-volume-slider'),
            timeDisplay: modal.querySelector('.premium-time-display'),
            progressBar: modal.querySelector('.premium-progress-bar'),
            progressPlayed: modal.querySelector('.premium-progress-played'),
            progressBuffered: modal.querySelector('.premium-progress-buffered'),
            progressHandle: modal.querySelector('.premium-progress-handle'),
            progressThumbnail: modal.querySelector('.premium-progress-thumbnail'),
            thumbnailTime: modal.querySelector('.premium-thumbnail-time'),
            settingsBtn: modal.querySelector('.premium-settings-btn .premium-control-btn'),
            settingsMenu: modal.querySelector('.premium-settings-menu'),
            qualityOptions: modal.querySelector('.premium-quality-options'),
            speedOptions: modal.querySelector('.premium-speed-options'),
            closeBtn: modal.querySelector('.premium-close-btn'),
            loadingOverlay: modal.querySelector('.player-loading-overlay'),
            errorOverlay: modal.querySelector('.player-error-overlay'),
            errorMessage: modal.querySelector('.player-error-message'),
            retryBtn: modal.querySelector('.retry-btn'),
            closeErrorBtn: modal.querySelector('.close-error-btn'),
            changeIndicator: modal.querySelector('.premium-change-indicator'),
            gestureIndicator: modal.querySelector('.premium-gesture-indicator'),
            shortcutsTooltip: modal.querySelector('.premium-shortcuts-tooltip')
        };
        
        // ==============================================================================
        // REPLACEMENT 7: Remove Conflicting Mobile Touch Handlers
        // ==============================================================================
        // NOTE: The code blocks for "FIX 5: Mobile-specific touch improvements" and 
        // "Enhanced touch controls visibility for mobile" that were previously here
        // have been REMOVED as requested. The logic is now handled by PremiumTouchCoordinator.
        // ==============================================================================
        
        // Mobile specific video handling
        if (isIOS) {
            const videoElement = document.querySelector(`#${playerId} video`);
            if (videoElement) {
                videoElement.setAttribute('playsinline', '');
                videoElement.setAttribute('webkit-playsinline', '');
                videoElement.setAttribute('x-webkit-airplay', 'allow');
                
                videoElement.addEventListener('webkitbeginfullscreen', () => {
                    stateManager.isFullscreen = true;
                });
                
                videoElement.addEventListener('webkitendfullscreen', () => {
                    stateManager.isFullscreen = false;
                });
                
                videoElement.addEventListener('loadedmetadata', () => {
                    videoElement.load();
                });
            }
        }

        if (!isIOS && isMobile) {
            player.ready(() => {
                const videoElement = document.querySelector(`#${playerId} video`);
                if (!videoElement) return;
                
                videoElement.setAttribute('controlslist', 'nodownload nofullscreen');
                videoElement.setAttribute('disablepictureinpicture', '');
                videoElement.setAttribute('preload', 'metadata');
                
                const fullscreenHandler = () => {
                    if (document.fullscreenElement === videoElement) {
                        stateManager.isFullscreen = true;
                    } else {
                        stateManager.isFullscreen = false;
                    }
                };
                
                videoElement.addEventListener('fullscreenchange', fullscreenHandler);
                videoElement.addEventListener('webkitfullscreenchange', fullscreenHandler);
                
                const isWebView = navigator.userAgent.includes('wv') || 
                                 window.navigator.standalone ||
                                 window.matchMedia('(display-mode: standalone)').matches;
                
                if (isWebView) {
                    videoElement.setAttribute('x5-video-player-type', 'h5');
                    videoElement.setAttribute('x5-video-player-fullscreen', 'true');
                    videoElement.setAttribute('x5-video-orientation', 'landscape');
                    videoElement.load();
                }
            });
        }

        if (isMobile) {
            let orientationTimeout;
            let lastOrientation = window.orientation;
            let isChangingOrientation = false;
            
            const handleOrientationChange = () => {
                if (orientationTimeout) {
                    clearTimeout(orientationTimeout);
                }
                
                const currentOrientation = window.orientation;
                if (currentOrientation === lastOrientation) return;
                lastOrientation = currentOrientation;
                isChangingOrientation = true;
                
                modal.style.pointerEvents = 'none';
                
                if (controlsManager.elements.loadingOverlay) {
                    controlsManager.elements.loadingOverlay.classList.add('active');
                }
                
                orientationTimeout = setTimeout(() => {
                    if (player && !player.isDisposed() && player.el()) {
                        try {
                            player.trigger('resize');
                            
                            const videoElement = player.el().querySelector('video');
                            if (videoElement) {
                                videoElement.style.width = '100%';
                                videoElement.style.height = '100%';
                                videoElement.offsetHeight;
                            }
                            
                            modal.style.pointerEvents = '';
                            isChangingOrientation = false;
                            
                            if (controlsManager.elements.loadingOverlay) {
                                controlsManager.elements.loadingOverlay.classList.remove('active');
                            }
                            
                            controlsManager.showControls();
                        } catch (error) {}
                    }
                }, 300);
            };
            
            window.addEventListener('orientationchange', handleOrientationChange);
            window.addEventListener('resize', handleOrientationChange);
            
            modal.addEventListener('touchstart', (e) => {
                if (isChangingOrientation) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }, { passive: false, capture: true });
            
            modal.addEventListener('remove', () => {
                if (orientationTimeout) {
                    clearTimeout(orientationTimeout);
                }
                window.removeEventListener('orientationchange', handleOrientationChange);
                window.removeEventListener('resize', handleOrientationChange);
            });
        }
        
        player.src({
            src: link.url,
            type: 'application/x-mpegURL'
        });

        player.ready(() => {
            player.muted(false);
            player.volume(1);
            
            if (isIOS) {
                const videoElement = player.el().querySelector('video');
                if (videoElement) {
                    videoElement.load();
                }
            }
        });

        if (isMobile && navigator.connection) {
            const updateNetworkState = () => {
                const connection = navigator.connection;
                const effectiveType = connection.effectiveType;
                
                if (effectiveType === 'slow-2g' || effectiveType === '2g') {
                    if (qualityManager && qualityManager.getAvailableQualities().length > 0) {
                        const qualities = qualityManager.getAvailableQualities();
                        const lowestQuality = qualities[qualities.length - 1];
                        if (lowestQuality !== 'auto') {
                            qualityManager.setQuality(lowestQuality);
                        }
                    }
                }
            };
            
            navigator.connection.addEventListener('change', updateNetworkState);
            updateNetworkState();
            
            modal.addEventListener('remove', () => {
                navigator.connection.removeEventListener('change', updateNetworkState);
            });
        }
        
        player.ready(() => {
            qualityManager.initialize();
            
            setTimeout(() => {
                renderSettingsMenu();
            }, 2000);
            
            const checkQualityLevels = setInterval(() => {
                if (qualityManager.getAvailableQualities().length > 1) {
                    renderSettingsMenu();
                    clearInterval(checkQualityLevels);
                }
            }, 500);
            
            setTimeout(() => clearInterval(checkQualityLevels), 10000);
        });
        
        const getSafePlayer = () => {
            const playerData = activePlayers.get(playerId);
            if (!playerData || !playerData.player) return null;
            
            const activePlayer = playerData.player;
            if (!activePlayer.el() || activePlayer.isDisposed()) {
                activePlayers.delete(playerId);
                return null;
            }
            
            return activePlayer;
        };
        
        const isPlayerHealthy = (id) => {
            try {
                const playerData = activePlayers.get(id);
                if (!playerData || !playerData.player) return false;
                
                const player = playerData.player;
                return player && 
                       player.el() && 
                       !player.isDisposed() && 
                       typeof player.paused === 'function';
            } catch (error) {
                return false;
            }
        };
        
        const cleanupPlayer = (id) => {
            const playerData = activePlayers.get(id);
            if (playerData) {
                try {
                    if (playerData.player && !playerData.player.isDisposed()) {
                        playerData.player.dispose();
                    }
                    if (playerData.modal && playerData.modal.parentNode) {
                        playerData.modal.remove();
                    }
                } catch (e) {}
                activePlayers.delete(id);
            }
        };
        
        function triggerHapticFeedback(style = 'medium') {
            if ('vibrate' in navigator) {
                navigator.vibrate(10);
            }
            
            if (window.Taptic && window.Taptic.impact) {
                window.Taptic.impact(style);
            } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.haptic) {
                window.webkit.messageHandlers.haptic.postMessage({ style: style });
            }
        }
        
        const togglePlayPause = () => {
            if (!isPlayerHealthy(playerId)) {
                cleanupPlayer(playerId);
                return;
            }
            
            const activePlayer = activePlayers.get(playerId).player;
            try {
                if (activePlayer.paused()) {
                    activePlayer.play().catch(() => {});
                    triggerHapticFeedback('light');
                } else {
                    activePlayer.pause();
                    triggerHapticFeedback('light');
                }
            } catch (error) {
                cleanupPlayer(playerId);
            }
        };

        // ==============================================================================
        // REPLACEMENT 6: Fix Play Button (Bottom Control Bar)
        // ==============================================================================
        const handlePlayPauseButton = (e) => {
            e.stopPropagation(); // Prevent bubble to touch coordinator
            togglePlayPause();
        };

        controlsManager.elements.playBtn.addEventListener('click', handlePlayPauseButton);

        // Touch optimization for mobile
        if (isMobile) {
            let playTouchHandled = false;
            
            controlsManager.elements.playBtn.addEventListener('touchend', (e) => {
                handlePlayPauseButton(e);
                playTouchHandled = true;
                setTimeout(() => { playTouchHandled = false; }, 500);
            }, { passive: true });
            
            // Prevent duplicate from click
            controlsManager.elements.playBtn.addEventListener('click', (e) => {
                if (playTouchHandled) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            }, { capture: true });
        }
        // ==============================================================================
        // END REPLACEMENT 6
        // ==============================================================================
        
        // ==============================================================================
        // REPLACEMENT 5: Fix Control Buttons (Skip, Volume, etc.)
        // ==============================================================================
        const handleSkipBackward = (e) => {
            e.stopPropagation();
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            activePlayer.currentTime(Math.max(0, activePlayer.currentTime() - 10));
            controlsManager.showGestureIndicator('⏪ 10s');
            
            if (navigator.vibrate) {
                navigator.vibrate([10, 50, 10]);
            }
        };

        const handleSkipForward = (e) => {
            e.stopPropagation();
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            activePlayer.currentTime(Math.min(activePlayer.duration(), activePlayer.currentTime() + 10));
            controlsManager.showGestureIndicator('⏩ 10s');
            
            if (navigator.vibrate) {
                navigator.vibrate([10, 50, 10]);
            }
        };

        controlsManager.elements.skipBackward.addEventListener('click', handleSkipBackward);
        controlsManager.elements.skipForward.addEventListener('click', handleSkipForward);

        // Touch optimization
        if (isMobile) {
            let skipTouchHandled = false;
            
            controlsManager.elements.skipBackward.addEventListener('touchend', (e) => {
                handleSkipBackward(e);
                skipTouchHandled = true;
                setTimeout(() => { skipTouchHandled = false; }, 500);
            }, { passive: true });
            
            controlsManager.elements.skipForward.addEventListener('touchend', (e) => {
                handleSkipForward(e);
                skipTouchHandled = true;
                setTimeout(() => { skipTouchHandled = false; }, 500);
            }, { passive: true });
            
            // Prevent duplicate from click
            const preventSkipDuplicate = (e) => {
                if (skipTouchHandled) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            };
            
            controlsManager.elements.skipBackward.addEventListener('click', preventSkipDuplicate, { capture: true });
            controlsManager.elements.skipForward.addEventListener('click', preventSkipDuplicate, { capture: true });
        }
        // ==============================================================================
        // END REPLACEMENT 5
        // ==============================================================================
        
        const toggleMute = () => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            activePlayer.muted(!activePlayer.muted());
        };
        
        controlsManager.elements.volumeBtn.addEventListener('click', toggleMute);
        
        controlsManager.elements.volumeSlider.addEventListener('input', (e) => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            const volume = parseFloat(e.target.value);
            activePlayer.volume(volume);
            activePlayer.muted(volume === 0);
        });
        
        // ==============================================================================
        // REPLACEMENT 4: Fix Progress Bar Handler
        // ==============================================================================
        // ===== PROGRESS BAR - UNIFIED DESKTOP & MOBILE =====

        let seekState = {
            active: false,
            startX: 0,
            touchIdentifier: null,
            mouseDown: false
        };

        const updateSeekPosition = (clientX, shouldCommit = false) => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return null;
            
            const rect = controlsManager.elements.progressBar.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            
            // Update visual position
            controlsManager.elements.progressPlayed.style.width = `${percent * 100}%`;
            controlsManager.elements.progressHandle.style.left = `${percent * 100}%`;
            
            if (shouldCommit) {
                const newTime = percent * activePlayer.duration();
                if (isFinite(newTime) && newTime >= 0) {
                    activePlayer.currentTime(newTime);
                }
            }
            
            return percent;
        };

        const startSeeking = () => {
            if (!seekState.active) {
                seekState.active = true;
                stateManager.isSeeking = true;
                controlsManager.elements.progressBar.classList.add('seeking');
            }
        };

        const stopSeeking = () => {
            seekState.active = false;
            seekState.touchIdentifier = null;
            seekState.mouseDown = false;
            stateManager.isSeeking = false;
            controlsManager.elements.progressBar.classList.remove('seeking');
        };

        // === DESKTOP: Mouse Events ===
        controlsManager.elements.progressBar.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            seekState.mouseDown = true;
            startSeeking();
            updateSeekPosition(e.clientX);
        });

        document.addEventListener('mousemove', (e) => {
            if (seekState.mouseDown && seekState.active) {
                updateSeekPosition(e.clientX);
            }
        });

        document.addEventListener('mouseup', (e) => {
            if (seekState.mouseDown) {
                updateSeekPosition(e.clientX, true);
                stopSeeking();
            }
        });

        // === MOBILE: Touch Events ===
        controlsManager.elements.progressBar.addEventListener('touchstart', (e) => {
            // Prevent coordinator from handling this
            e.stopImmediatePropagation();
            
            if (e.touches.length > 1) return; // Ignore multi-touch
            
            const touch = e.touches[0];
            seekState.touchIdentifier = touch.identifier;
            startSeeking();
            updateSeekPosition(touch.clientX);
        }, { passive: true }); // Passive - we don't need preventDefault

        controlsManager.elements.progressBar.addEventListener('touchmove', (e) => {
            if (!seekState.active) return;
            
            // Find our touch
            const touch = Array.from(e.touches).find(t => t.identifier === seekState.touchIdentifier);
            if (!touch) return;
            
            updateSeekPosition(touch.clientX);
        }, { passive: true });

        controlsManager.elements.progressBar.addEventListener('touchend', (e) => {
            if (!seekState.active) return;
            
            e.stopImmediatePropagation(); // Prevent coordinator from handling
            
            // Find our touch
            const touch = Array.from(e.changedTouches).find(t => t.identifier === seekState.touchIdentifier);
            if (!touch) {
                stopSeeking();
                return;
            }
            
            updateSeekPosition(touch.clientX, true);
            stopSeeking();
        }, { passive: true });

        controlsManager.elements.progressBar.addEventListener('touchcancel', () => {
            stopSeeking();
        }, { passive: true });

        // Prevent any clicks on progress bar from reaching coordinator
        controlsManager.elements.progressBar.addEventListener('click', (e) => {
            e.stopPropagation();
        }, { capture: true });

        // === Progress bar hover preview (desktop only) ===
        if (!isMobile) {
            controlsManager.elements.progressBar.addEventListener('mousemove', (e) => {
                const activePlayer = getSafePlayer();
                if (!activePlayer) return;
                
                const rect = controlsManager.elements.progressBar.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                const time = percent * activePlayer.duration();
                
                if (isFinite(time)) {
                    controlsManager.elements.thumbnailTime.textContent = controlsManager.formatTime(time);
                    controlsManager.elements.progressThumbnail.style.left = `${percent * 100}%`;
                    controlsManager.elements.progressThumbnail.style.display = 'block';
                }
            });
            
            controlsManager.elements.progressBar.addEventListener('mouseleave', () => {
                controlsManager.elements.progressThumbnail.style.display = 'none';
            });
        }
        // ==============================================================================
        // END REPLACEMENT 4
        // ==============================================================================
        
        // ==============================================================================
        // REPLACEMENT 2: Fix Settings Button Handler
        // ==============================================================================
        // Settings menu - unified handler
        const toggleSettingsMenu = (e) => {
            // Don't prevent default - let button work naturally
            e.stopPropagation(); // Stop event from reaching touch coordinator
            
            const isActive = controlsManager.elements.settingsMenu.classList.toggle('active');
            controlsManager.elements.settingsBtn.setAttribute('aria-expanded', isActive);
        };

        controlsManager.elements.settingsBtn.addEventListener('click', toggleSettingsMenu);

        // Touch devices: use touchend for faster response, but allow click as fallback
        if (isMobile) {
            let touchHandled = false;
            
            controlsManager.elements.settingsBtn.addEventListener('touchend', (e) => {
                e.stopPropagation();
                toggleSettingsMenu(e);
                touchHandled = true;
                
                // Reset flag after click event would fire
                setTimeout(() => {
                    touchHandled = false;
                }, 500);
            }, { passive: true }); // Passive - we don't need to prevent
            
            // Prevent duplicate action from click
            controlsManager.elements.settingsBtn.addEventListener('click', (e) => {
                if (touchHandled) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            }, { capture: true });
        }
        // ==============================================================================
        // END REPLACEMENT 2
        // ==============================================================================
        
        const closeSettingsMenu = (e) => {
            if (controlsManager.elements.settingsMenu && 
                !controlsManager.elements.settingsMenu.contains(e.target) && 
                !controlsManager.elements.settingsBtn.contains(e.target)) {
                controlsManager.elements.settingsMenu.classList.remove('active');
                controlsManager.elements.settingsBtn.setAttribute('aria-expanded', 'false');
            }
        };
        
        document.addEventListener('click', closeSettingsMenu);
        
        function renderSettingsMenu() {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            // Quality options
            const qualities = qualityManager.getAvailableQualities();
            if (controlsManager.elements.qualityOptions) {
                controlsManager.elements.qualityOptions.innerHTML = '';
                
                qualities.forEach(quality => {
                    const option = document.createElement('div');
                    option.className = 'premium-settings-item';
                    option.textContent = quality === 'auto' ? 'Auto' : `${quality}p`;
                    option.dataset.quality = quality;
                    
                    if (quality === qualityManager.currentQuality) {
                        option.classList.add('active');
                    }
                    
                    // ==============================================================================
                    // REPLACEMENT 8: Fix Settings Menu Item Selection (Quality)
                    // ==============================================================================
                    const handleQualitySelect = (e) => {
                        e.stopPropagation();
                        const player = getSafePlayer();
                        if (!player) return;
                        
                        qualityManager.setQuality(quality);
                        stateManager.currentQuality = quality;
                        
                        // Update active state
                        controlsManager.elements.qualityOptions.querySelectorAll('.premium-settings-item').forEach(item => {
                            item.classList.remove('active');
                        });
                        option.classList.add('active');
                        
                        // Show indicator
                        controlsManager.showChangeIndicator(`Quality: ${qualityManager.getCurrentQualityLabel()}`);
                        
                        // Close menu
                        controlsManager.elements.settingsMenu.classList.remove('active');
                    };

                    option.addEventListener('click', handleQualitySelect);

                    // Touch optimization
                    if (isMobile) {
                        let qualityTouchHandled = false;
                        
                        option.addEventListener('touchend', (e) => {
                            handleQualitySelect(e);
                            qualityTouchHandled = true;
                            setTimeout(() => { qualityTouchHandled = false; }, 500);
                        }, { passive: true });
                        
                        option.addEventListener('click', (e) => {
                            if (qualityTouchHandled) {
                                e.preventDefault();
                                e.stopPropagation();
                                return false;
                            }
                        }, { capture: true });
                    }
                    // ==============================================================================
                    // END REPLACEMENT 8 (Quality)
                    // ==============================================================================
                    
                    controlsManager.elements.qualityOptions.appendChild(option);
                });
            }
            
            // Speed options
            const speeds = speedManager.getAvailableSpeeds();
            if (controlsManager.elements.speedOptions) {
                controlsManager.elements.speedOptions.innerHTML = '';
                
                speeds.forEach(speed => {
                    const option = document.createElement('div');
                    option.className = 'premium-settings-item';
                    option.textContent = speed === 1 ? 'Normal' : `${speed}x`;
                    option.dataset.speed = speed;
                    
                    if (speed === speedManager.currentSpeed) {
                        option.classList.add('active');
                    }
                    
                    // ==============================================================================
                    // REPLACEMENT 8: Fix Settings Menu Item Selection (Speed)
                    // ==============================================================================
                    const handleSpeedSelect = (e) => {
                        e.stopPropagation();
                        const player = getSafePlayer();
                        if (!player) return;

                        speedManager.setSpeed(speed);
                        stateManager.currentSpeed = speed;

                        // Update active state
                        controlsManager.elements.speedOptions.querySelectorAll('.premium-settings-item').forEach(item => {
                            item.classList.remove('active');
                        });
                        option.classList.add('active');

                        // Show indicator
                        controlsManager.showChangeIndicator(`Speed: ${speedManager.getCurrentSpeedLabel()}`);

                        // Close menu
                        controlsManager.elements.settingsMenu.classList.remove('active');
                    }

                    option.addEventListener('click', handleSpeedSelect);

                    // Touch optimization
                    if (isMobile) {
                        let speedTouchHandled = false;

                        option.addEventListener('touchend', (e) => {
                            handleSpeedSelect(e);
                            speedTouchHandled = true;
                            setTimeout(() => { speedTouchHandled = false; }, 500);
                        }, { passive: true });

                        option.addEventListener('click', (e) => {
                            if (speedTouchHandled) {
                                e.preventDefault();
                                e.stopPropagation();
                                return false;
                            }
                        }, { capture: true });
                    }
                    // ==============================================================================
                    // END REPLACEMENT 8 (Speed)
                    // ==============================================================================
                    
                    controlsManager.elements.speedOptions.appendChild(option);
                });
            }
        }
        
        const handleFullscreenChange = () => {
            const wasFullscreen = stateManager.isFullscreen;
            stateManager.isFullscreen = !!document.fullscreenElement;
            
            if (isIOS) {
                const videoElement = player.el().querySelector('video');
                if (videoElement) {
                    const isIOSFullscreen = document.webkitFullscreenElement === videoElement;
                    stateManager.isFullscreen = isIOSFullscreen || stateManager.isFullscreen;
                }
            }
        };
        
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        if (isIOS) {
            document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        }
        
        const closePlayer = () => {
            if (touchCoordinator) {
                touchCoordinator.destroy();
            }

            analyticsTracker.clearSession(videoId);
            
            tokenRefreshManager.stopRefresh(videoId);
            
            if (modal && modal._cleanupPlayerEvents) {
                modal._cleanupPlayerEvents();
            }
            
            activePlayers.delete(playerId);
            
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('click', closeSettingsMenu);
            document.removeEventListener('keydown', handleKeyDown);
            
            if (hideControlsInterval) {
                clearInterval(hideControlsInterval);
            }
            
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
            
            if (player && !player.isDisposed()) {
                try {
                    player.pause();
                    player.src('');
                    player.dispose();
                } catch (e) {}
            }
            
            if (modal && modal.parentNode) {
                modal.remove();
            }
            
            document.body.style.overflow = '';
        };

        // ==============================================================================
        // REPLACEMENT 3: Fix Close Button Handler
        // ==============================================================================
        // Close button - unified handler
        const handleClose = (e) => {
            e.stopPropagation(); // Stop event from reaching touch coordinator
            closePlayer();
        };

        // Main close button
        controlsManager.elements.closeBtn.addEventListener('click', handleClose);

        // Error overlay close button
        controlsManager.elements.closeErrorBtn.addEventListener('click', handleClose);

        // Touch optimization for mobile
        if (isMobile) {
            let closeTouchHandled = false;
            
            const handleCloseTouch = (e) => {
                e.stopPropagation();
                closePlayer();
                closeTouchHandled = true;
                setTimeout(() => { closeTouchHandled = false; }, 500);
            };
            
            controlsManager.elements.closeBtn.addEventListener('touchend', handleCloseTouch, { passive: true });
            controlsManager.elements.closeErrorBtn.addEventListener('touchend', handleCloseTouch, { passive: true });
            
            // Prevent duplicate from click
            const preventDuplicateClick = (e) => {
                if (closeTouchHandled) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            };
            
            controlsManager.elements.closeBtn.addEventListener('click', preventDuplicateClick, { capture: true });
            controlsManager.elements.closeErrorBtn.addEventListener('click', preventDuplicateClick, { capture: true });
        }
        // ==============================================================================
        // END REPLACEMENT 3
        // ==============================================================================
        
        const handleKeyDown = (e) => {
            if (controlsManager.elements.settingsMenu && 
                controlsManager.elements.settingsMenu.classList.contains('active')) {
                if (e.key === 'Escape') {
                    controlsManager.elements.settingsMenu.classList.remove('active');
                    e.preventDefault();
                }
                return;
            }
            
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            switch(e.key) {
                case 'Escape':
                    e.preventDefault();
                    closePlayer();
                    break;
                case ' ':
                case 'k':
                    e.preventDefault();
                    togglePlayPause();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    activePlayer.currentTime(Math.max(0, activePlayer.currentTime() - 10));
                    controlsManager.showGestureIndicator('⏪');
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    activePlayer.currentTime(Math.min(activePlayer.duration(), activePlayer.currentTime() + 10));
                    controlsManager.showGestureIndicator('⏩');
                    break;
                case 'm':
                    e.preventDefault();
                    toggleMute();
                    break;
                case 'f':
                    e.preventDefault();
                    break;
                case '?':
                    e.preventDefault();
                    if (controlsManager.elements.shortcutsTooltip) {
                        controlsManager.elements.shortcutsTooltip.classList.toggle('active');
                        setTimeout(() => {
                            if (controlsManager.elements.shortcutsTooltip) {
                                controlsManager.elements.shortcutsTooltip.classList.remove('active');
                            }
                        }, 3000);
                    }
                    break;
            }
            
            controlsManager.showControls();
        };
        
        document.addEventListener('keydown', handleKeyDown);
        
        controlsManager.elements.retryBtn.addEventListener('click', () => {
            controlsManager.showErrorOverlay(false);
            controlsManager.showLoadingOverlay(true);
            const activePlayer = getSafePlayer();
            if (activePlayer) {
                activePlayer.src({
                    src: link.url,
                    type: 'application/x-mpegURL'
                });
                activePlayer.load();
            }
        });
        
        player.on('loadstart', () => {
            controlsManager.showLoadingOverlay(true);
        });
        
        player.on('canplay', () => {
            controlsManager.showLoadingOverlay(false);
        });
        
        player.on('waiting', () => {
            controlsManager.showLoadingOverlay(true);
        });
        
        player.on('playing', () => {
            controlsManager.showLoadingOverlay(false);
        });
        
        player.on('play', () => {
            stateManager.isPlaying = true;
            controlsManager.updatePlayButton(true);
            analyticsTracker.trackEvent(videoId, 'play', player, tierId);
        });
        
        player.on('pause', () => {
            stateManager.isPlaying = false;
            controlsManager.updatePlayButton(false);
            controlsManager.showControls();
            analyticsTracker.trackEvent(videoId, 'pause', player, tierId);
        });
        
        player.on('ended', () => {
            stateManager.isPlaying = false;
            controlsManager.updatePlayButton(false);
            analyticsTracker.trackEvent(videoId, 'ended', player, tierId);
        });
        
        player.on('timeupdate', () => {
            try {
                const playerData = activePlayers.get(playerId);
                if (!playerData || !playerData.player) {
                    return;
                }
                
                const activePlayer = playerData.player;
                
                if (!activePlayer || 
                    !activePlayer.el() || 
                    activePlayer.isDisposed() ||
                    typeof activePlayer.currentTime !== 'function') {
                    return;
                }
                
                if (!stateManager.isSeeking) {
                    const current = activePlayer.currentTime();
                    const duration = activePlayer.duration();
                    
                    if (!isFinite(current) || !isFinite(duration) || duration <= 0) {
                        return;
                    }
                    
                    let buffered = 0;
                    try {
                        if (activePlayer.buffered && 
                            activePlayer.buffered().length > 0) {
                            buffered = activePlayer.buffered().end(activePlayer.buffered().length - 1);
                        }
                    } catch (e) {}
                    
                    if (controlsManager && 
                        controlsManager.updateProgress && 
                        controlsManager.updateTimeDisplay) {
                        controlsManager.updateProgress(current, duration, buffered);
                        controlsManager.updateTimeDisplay(current, duration);
                    }
                }
            } catch (error) {
                activePlayers.delete(playerId);
            }
        });
        
        player.on('volumechange', () => {
            try {
                const playerData = activePlayers.get(playerId);
                if (!playerData || !playerData.player) return;
                
                const activePlayer = playerData.player;
                if (!activePlayer || !activePlayer.el() || activePlayer.isDisposed()) {
                    return;
                }
                
                const volume = activePlayer.volume();
                const muted = activePlayer.muted();
                
                stateManager.volume = volume;
                stateManager.isMuted = muted;
                
                if (controlsManager && controlsManager.updateVolumeButton) {
                    controlsManager.updateVolumeButton(volume, muted);
                }
                
                if (controlsManager.elements && controlsManager.elements.volumeSlider) {
                    controlsManager.elements.volumeSlider.value = muted ? 0 : volume;
                }
            } catch (error) {
                activePlayers.delete(playerId);
            }
        });
        
        player.on('error', (e) => {
            stateManager.isError = true;
            controlsManager.showLoadingOverlay(false);
            
            const error = player.error();
            let errorMessage = 'We\'re having trouble playing this video. Please try again.';
            
            if (error) {
                switch(error.code) {
                    case 1:
                        errorMessage = 'Video loading was aborted.';
                        break;
                    case 2:
                        errorMessage = 'Network error occurred while loading the video.';
                        break;
                    case 3:
                        errorMessage = 'Video format is not supported by your browser.';
                        break;
                    case 4:
                        errorMessage = 'Video source is unavailable.';
                        break;
                }
            }
            
            controlsManager.showErrorOverlay(true, errorMessage);
            analyticsTracker.trackEvent(videoId, 'error', player, tierId);
        });

        modal._cleanupPlayerEvents = () => {
            if (player && !player.isDisposed()) {
                try {
                    player.off('loadstart');
                    player.off('canplay');
                    player.off('waiting');
                    player.off('playing');
                    player.off('play');
                    player.off('pause');
                    player.off('ended');
                    player.off('timeupdate');
                    player.off('volumechange');
                    player.off('error');
                } catch (error) {}
            }
        };
        
        if (!isMobile) {
            modal.addEventListener('mousemove', () => {
                controlsManager.showControls();
            });
        }
        
        controlsManager.showControls();
        
        let hideControlsInterval;
        if (!isMobile) {
            hideControlsInterval = setInterval(() => {
                if (stateManager.shouldHideControls()) {
                    controlsManager.hideControls();
                }
            }, 1000);
        }
        
        tokenRefreshManager.registerVideo(videoId, player, tierId, libraryId);
        
        let lastTrackedTime = 0;
        player.on('timeupdate', () => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;

            const currentTime = activePlayer.currentTime();
            
            if (currentTime - lastTrackedTime >= 5) {
                analyticsTracker.trackEvent(videoId, 'timeupdate', activePlayer, tierId);
                lastTrackedTime = currentTime;
            }
        });
        
        modal.addEventListener('remove', () => {
            clearInterval(hideControlsInterval);
            closePlayer();
        });
    }

    function cleanupAllVideoPlayers() {
        activePlayers.forEach((playerData, playerId) => {
            try {
                if (playerData.player && !playerData.player.isDisposed()) {
                    playerData.player.dispose();
                }
                if (playerData.modal && playerData.modal.parentNode) {
                    playerData.modal.remove();
                }
            } catch (error) {}
        });
        activePlayers.clear();
        tokenRefreshManager.stopAll();
    }

    async function router() {
        cleanupAllVideoPlayers();
        loadUserData();
        
        const appLoader = document.getElementById('app-loader');
        const appContainer = document.getElementById('appContainer');
        
        function hideAppLoader() {
            if (appLoader && appContainer) {
                appLoader.style.opacity = '0';
                appContainer.style.display = 'block';
                setTimeout(() => {
                    appLoader.remove();
                }, 400);
            }
        }
        
        if (!sessionRefreshManager.refreshTimer) {
            sessionRefreshManager.start();
        }
        
        const announcementsData = JSON.parse(localStorage.getItem('global_announcements') || '[]');
        announcementSlider.showAnnouncements(announcementsData);
        
        renderRenewalBanner();
        await renderHeaderActions();

        if (!isTokenValid()) {
            window.location.href = 'login.html';
            return;
        }

        try {
            const urlParams = new URLSearchParams(window.location.search);
            const view = urlParams.get('view');
            const platformId = urlParams.get('platform_id');
            const tierId = urlParams.get('tier_id');
            const slug = urlParams.get('slug');

            if (view === 'gallery' && slug) {
                await fetchAndDisplayGallery(slug);
                renderSubscriptionStatus();
                hideAppLoader();
                return;
            }

            if (view === 'tiers' || view === 'content') {
                await ensurePlatformsData();
            }

            if (view === 'tiers' && platformId) {
                await ensureTiersData(platformId);
            }

            if (view === 'content') {
                await ensureTiersData(platformId);
            }

            const platformData = allPlatformsData.find(p => p.id.toString() === platformId);
            const platformName = platformData?.name;
            const tierData = allTiersData[platformId]?.find(t => t.id.toString() === tierId);
            const tierName = tierData?.name;

            if (view === 'content' && platformId && tierId) {
                searchScope = 'content';
                fetchAndDisplayContent(platformId, tierId, tierName, platformName);
            } else if (view === 'tiers' && platformId) {
                searchScope = 'tiers';
                renderTierSkeleton(platformName);
                fetchAndDisplayTiers(platformId, platformName);
            } else {
                searchScope = 'platforms';
                renderPlatformSkeleton();
                const platformsData = await ensurePlatformsData();
                renderPlatforms(platformsData);
            }

            if (searchInput) {
                searchInput.value = '';
                currentFilterState.query = '';
            }

            renderSubscriptionStatus();
            
            hideAppLoader();
        } catch (error) {
            displayError("An error occurred while loading the page. Please try again.");
            hideAppLoader();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        router();
        if (searchInput) {
            searchInput.addEventListener('input', debounce(handleSearchInput, 300));
        }
    });
    window.onpopstate = router;

    logoutButton.addEventListener('click', () => {
        cleanupAllVideoPlayers();
        localStorage.clear();
        window.location.href = 'index.html';
    });
    
    window.addEventListener('beforeunload', () => {
        cleanupAllVideoPlayers();
    });
}