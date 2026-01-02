<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>Mobile Video Player Application</title>
    
    <!-- Video.js CSS -->
    <link href="https://vjs.zencdn.net/8.6.1/video-js.css" rel="stylesheet" />
    
    <!-- Basic Application Styles -->
    <style>
        :root {
            --primary-color: #e50914;
            --bg-dark: #141414;
            --text-light: #ffffff;
            --overlay-bg: rgba(0, 0, 0, 0.7);
        }

        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-dark);
            color: var(--text-light);
            overflow-x: hidden;
            -webkit-font-smoothing: antialiased;
        }

        /* App Structure */
        #app-loader {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: #000;
            z-index: 9999;
            display: flex;
            justify-content: center;
            align-items: center;
            flex-direction: column;
            transition: opacity 0.4s ease;
        }
        
        #app-container { display: none; }

        /* Video Player Specifics */
        .premium-player-modal {
            position: fixed;
            top: 0; left: 0;
            width: 100vw;
            height: 100vh;
            background: #000;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .premium-player-content {
            position: relative;
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            background: #000;
        }

        .premium-video-wrapper {
            position: relative;
            flex: 1;
            width: 100%;
            height: 100%;
            background: #000;
            overflow: hidden;
        }

        .video-js {
            width: 100%;
            height: 100%;
        }
        
        .video-js .vjs-tech {
            object-fit: contain;
        }

        /* Controls */
        .premium-controls-wrapper {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0));
            padding: 20px 20px 40px 20px; /* Safe area for mobile */
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
        }

        .premium-controls-wrapper.visible {
            opacity: 1;
            pointer-events: auto;
        }

        .premium-progress-bar {
            width: 100%;
            height: 6px;
            background: rgba(255,255,255,0.2);
            border-radius: 3px;
            position: relative;
            cursor: pointer;
            touch-action: none; /* Prevent scroll while seeking */
        }

        .premium-progress-played {
            height: 100%;
            background: var(--primary-color);
            border-radius: 3px;
            width: 0%;
        }

        .premium-progress-handle {
            position: absolute;
            top: 50%;
            width: 14px;
            height: 14px;
            background: #fff;
            border-radius: 50%;
            transform: translate(-50%, -50%);
            margin-top: -1px; /* Visual adjustment */
            box-shadow: 0 2px 4px rgba(0,0,0,0.5);
            left: 0%;
            pointer-events: none;
        }

        /* Buttons */
        .premium-control-btn {
            background: none;
            border: none;
            color: white;
            padding: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: background 0.2s;
        }

        .premium-control-btn:active {
            background: rgba(255,255,255,0.2);
        }

        /* Overlays */
        .premium-center-overlay {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            pointer-events: none;
        }

        .premium-center-play-btn {
            width: 80px;
            height: 80px;
            background: rgba(0,0,0,0.6);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            opacity: 0;
            transition: opacity 0.3s, transform 0.2s;
            pointer-events: auto; /* Must be clickable */
        }

        .premium-center-play-btn.show {
            opacity: 1;
            transform: scale(1);
        }

        /* Loading/Error */
        .player-loading-overlay, .player-error-overlay {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 20;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s;
        }

        .player-loading-overlay.active, .player-error-overlay.active {
            opacity: 1;
            pointer-events: auto;
        }

        .player-spinner {
            width: 40px;
            height: 40px;
            border: 4px solid rgba(255,255,255,0.3);
            border-top-color: var(--primary-color);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        /* Gesture Indicator */
        .premium-gesture-indicator {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0,0,0,0.7);
            padding: 20px 30px;
            border-radius: 8px;
            font-size: 24px;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s;
            z-index: 15;
        }

        .premium-gesture-indicator.show { opacity: 1; }

        /* Skeletons */
        .skeleton {
            background: linear-gradient(90deg, #1f1f1f 25%, #2a2a2a 50%, #1f1f1f 75%);
            background-size: 200% 100%;
            animation: loading 1.5s infinite;
            border-radius: 4px;
        }
        @keyframes loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        /* Utility */
        .hidden { display: none !important; }
    </style>
</head>
<body>

    <!-- App Loader -->
    <div id="app-loader">
        <div class="player-spinner" style="width: 60px; height: 60px;"></div>
        <div style="margin-top: 20px; font-weight: 500;">Loading Experience...</div>
    </div>

    <!-- Main App Container -->
    <div id="appContainer">
        <header style="padding: 15px; display: flex; justify-content: space-between; align-items: center; background: #000;">
            <div id="logo" style="font-weight: bold; font-size: 1.2rem;">STREAMER</div>
            <div id="headerActions">
                <button id="logoutButton" class="premium-control-btn" style="width: 32px; height: 32px;">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
                </button>
            </div>
        </header>

        <div id="announcementSliderContainer" style="margin-bottom: 20px; display: none;"></div>
        <div id="subscriptionStatus" style="padding: 0 15px; display: none;"></div>
        
        <main id="mainContent" style="padding: 20px; padding-bottom: 80px;">
            <!-- Dynamic Content Injected Here -->
        </main>
        
        <div id="searchContainer" style="padding: 0 20px 20px 20px; display: none;">
            <input type="text" id="searchInput" placeholder="Search..." style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #333; background: #1a1a1a; color: #fff; box-sizing: border-box;">
        </div>
    </div>

    <!-- Modals -->
    <div id="platformModal" class="modal">
        <div class="modal-content" style="background: #1a1a1a; padding: 20px; border-radius: 8px; max-width: 500px; margin: 50px auto; position: relative;">
            <span class="modal-close-btn" style="position: absolute; top: 10px; right: 15px; font-size: 24px; cursor: pointer;">&times;</span>
            <div id="modalContent"></div>
        </div>
    </div>

    <!-- Scripts -->
    <script src="https://vjs.zencdn.net/8.6.1/video.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/swiper@10/swiper-bundle.min.js"></script>
    
    <script type="module">
        import PhotoSwipeLightbox from 'https://unpkg.com/photoswipe@5.4.3/dist/photoswipe-lightbox.esm.js';
        import PhotoSwipe from 'https://unpkg.com/photoswipe@5.4.3/dist/photoswipe.esm.js';
        
        window.PhotoSwipe = PhotoSwipe;
        window.PhotoSwipeLightbox = PhotoSwipeLightbox;
    </script>

    <script>
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
            // ✅ NEW: Check if player is still valid before refreshing
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
                // ✅ FIXED: Double-check player validity before updating source
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
                    // ✅ FIXED: Verify player still exists before restoring state
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
        this.sessionIdCache = new Map();  // ✅ NEW: Track session IDs
        this.startBatchTimer();
    }

    // ✅ NEW: Generate unique session ID for each viewing session
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // ✅ NEW: Get or create session ID for a video
    getSessionId(videoId) {
        if (!this.sessionIdCache.has(videoId)) {
            this.sessionIdCache.set(videoId, this.generateSessionId());
        }
        return this.sessionIdCache.get(videoId);
    }

    // ✅ NEW: Clear session ID when video is closed
    clearSession(videoId) {
        this.sessionIdCache.delete(videoId);
    }

    // ✅ NEW: Store tier ID mapping when video is opened
    setVideoTierMapping(videoId, numericTierId) {
        this.tierIdCache.set(videoId, numericTierId);
    }

    trackEvent(videoId, event, player, tierName) {
        // ✅ FIX: Get numeric tier ID from cache or use default
        const numericTierId = this.tierIdCache.get(videoId) || 1;
        const sessionId = this.getSessionId(videoId);  // ✅ NEW: Get session ID
        
        const eventData = {
            event: event,
            video_id: videoId,
            session_id: sessionId,  // ✅ NEW: Include session ID
            tier_id: numericTierId,  // ✅ NOW: Numeric tier ID
            current_time: player ? player.currentTime() : 0,
            duration: player ? player.duration() : 0,
            quality: player ? this.getCurrentQuality(player) : 'auto'
        };

        this.batchQueue.push(eventData);

        // Send immediately for critical events
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

            // Send each event
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
            // Use Video.js built-in quality levels (HLS support)
            if (typeof this.player.qualityLevels === 'function') {
                this.qualityLevels = this.player.qualityLevels();
                
                if (this.qualityLevels) {
                    this.qualityLevels.on('addqualitylevel', () => {
                        this.updateAvailableQualities();
                    });
                }
            } else {
                // Fallback: detect from tech
                this.detectQualitiesFromTech();
            }
        } catch (error) {
            // Quality detection failed, only show Auto
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
            // Enable auto quality switching
            for (let i = 0; i < this.qualityLevels.length; i++) {
                this.qualityLevels[i].enabled = true;
            }
        } else {
            // Disable all except selected quality
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
        // ✅ FIXED: Better mobile detection
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        // Allow hiding even when paused in fullscreen mode
        if (this.state.isSeeking) return;
        
        // ✅ NEW: On mobile, only hide if video is playing
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
        
        // ✅ NEW: Mobile-specific timeout duration
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const hideDelay = isMobile ? 3000 : 4000; // Shorter on mobile
        
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

// --- NEW: Announcement Slider for Multiple Announcements ---
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

        // Build the HTML for the slider
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

        // Initialize Swiper
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

        // Handle dismiss buttons
        this.container.querySelectorAll('[data-slide-dismiss]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (this.swiper && announcements.length > 1) {
                    // If multiple slides, just remove this one
                    const slideIndex = this.swiper.activeIndex;
                    this.swiper.removeSlide(slideIndex);
                    
                    // If no slides left, hide container
                    if (this.swiper.slides.length === 0) {
                        this.container.style.display = 'none';
                    }
                } else {
                    // Single announcement - hide entire container
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

// --- NEW: Load user data from localStorage ---
function loadUserData() {
    try {
        userInfo = JSON.parse(localStorage.getItem('user_info') || 'null');
        userSubscriptions = JSON.parse(localStorage.getItem('user_subscriptions') || '[]');
        return true;
    } catch (error) {
        // Silently handle error without logging to console
        userInfo = null;
        userSubscriptions = [];
        return false;
    }
}

// --- Subscription Status Renderer ---
// --- Subscription Status Renderer (V3 MULTI-SUBSCRIPTION) ---
function renderSubscriptionStatus() {
    const subscriptionStatusDiv = document.getElementById('subscriptionStatus');
    if (!subscriptionStatusDiv) return;

    if (!userSubscriptions || userSubscriptions.length === 0) {
        subscriptionStatusDiv.style.display = 'none';
        return;
    }

    try {
        // Clear previous content
        subscriptionStatusDiv.innerHTML = '';
        subscriptionStatusDiv.style.display = 'flex';
        subscriptionStatusDiv.style.flexWrap = 'wrap';
        subscriptionStatusDiv.style.gap = '10px';
        subscriptionStatusDiv.style.alignItems = 'center';

        // Render each subscription as a badge
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

            // Create subscription badge
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
        // Silently handle error without logging to console
        subscriptionStatusDiv.style.display = 'none';
    }
}

// --- NEW RENEWAL AND SUPPORT RENDERERS ---
function renderRenewalBanner() {
    const existingBanner = document.getElementById('renewalBanner');
    if (existingBanner) {
        existingBanner.remove();
    }

    if (!userSubscriptions || userSubscriptions.length === 0) return;

    // Find ALL expiring subscriptions first
    const expiringSubscriptions = userSubscriptions.filter(sub => {
        if (!sub.end_date) return false;
        const expiryDate = new Date(sub.end_date);
        const now = new Date();
        const diffTime = expiryDate - now;
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return days <= 7 && days > 0;
    });

    // ✅ PRIORITY LOGIC: Prioritize Echo Chamber renewal link
    let expiringSubscription = expiringSubscriptions.find(sub => sub.platform_name === 'Echo Chamber' && sub.renewal_url);

    // If no Echo Chamber link, fall back to the first available one
    if (!expiringSubscription) {
        expiringSubscription = expiringSubscriptions.find(sub => sub.renewal_url);
    }

    if (expiringSubscription) {
        const expiryDate = new Date(expiringSubscription.end_date);
        const now = new Date();
        const diffTime = expiryDate - now;
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const renewalUrl = expiringSubscription.renewal_url;
        
        if (!renewalUrl) return; // Don't show if renewal URL is missing
        
        const banner = document.createElement('div');
        banner.id = 'renewalBanner';
        banner.className = 'renewal-banner';
        banner.innerHTML = `
            <span>Your access expires in ${days} day${days !== 1 ? 's' : ''}. Please renew to maintain access.</span>
            <a href="${renewalUrl}" target="_blank" class="renew-button">Renew Now</a>
        `;
        
        const appContainer = document.getElementById('appContainer');
        if (appContainer) {
            // Prepend banner inside the container but after the header
            appContainer.querySelector('header').after(banner);
        }
    }
}

async function renderHeaderActions() {
    // --- 1. Handle Support Link with Priority Logic ---
    let supportUrl = null;
    if (userSubscriptions.length > 0) {
        // ✅ PRIORITY LOGIC: Try to find Echo Chamber support URL first
        const echoChamberSub = userSubscriptions.find(sub => sub.platform_name === 'Echo Chamber' && sub.support_url);
        if (echoChamberSub) {
            supportUrl = echoChamberSub.support_url;
        } else {
            // Fallback: find the first subscription that has a support URL
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

    // --- 2. ✅ FIXED: Fetch Fresh System Config from Backend ---
    const downloadAppButton = document.getElementById('downloadAppButton');
    if (downloadAppButton) {
        try {
            // Fetch live system settings from backend
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
                // ✅ Use fresh data from backend, not stale localStorage
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
            // Silently handle error
            downloadAppButton.style.display = 'none';
        }
    }
}

// --- Logic for login.html ---
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
                // Save token and basic user info
                localStorage.setItem('lustroom_jwt', data.access_token);
                localStorage.setItem('lustroom_jwt_expires_in', data.expires_in);
                localStorage.setItem('lustroom_jwt_obtained_at', Math.floor(Date.now() / 1000));
                localStorage.setItem('user_info', JSON.stringify(data.user_info));
                
                // Make second call to get profile data with subscriptions
                try {
                    const profileResponse = await fetch(`${API_BASE_URL}/profile`, {
                        headers: { 'Authorization': `Bearer ${data.access_token}` }
                    });
                    
                    const profileData = await profileResponse.json();
                    
                    if (profileResponse.ok && profileData.status === 'success') {
                        // Save subscriptions data
                        localStorage.setItem('user_subscriptions', JSON.stringify(profileData.subscriptions));
                        
                        // ✅ NEW: Save announcement data if present
                        if (profileData.announcements) {
                            localStorage.setItem('global_announcements', JSON.stringify(profileData.announcements));
                        } else {
                            localStorage.removeItem('global_announcements');
                        }
                        
                        // ✅ NEW: Save system_config data if present
                        if (profileData.system_config) {
                            localStorage.setItem('system_config', JSON.stringify(profileData.system_config));
                        } else {
                            localStorage.removeItem('system_config');
                        }
                        
                        // Load user data into global variables
                        loadUserData();
                        
                        // Redirect to main page
                        window.location.href = 'links.html';
                    } else {
                        displayError("Failed to load user profile. Please try logging in again.");
                        showLoading(false);
                    }
                } catch (profileError) {
                    // Silently handle error without logging to console
                    displayError("An error occurred while loading your profile. Please try again.");
                    showLoading(false);
                }
            } else {
                displayError(data.message || "Login failed. Please check your credentials.");
                showLoading(false);
            }
        } catch (error) {
            showLoading(false);
            // Silently handle error without logging to console
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

    // --- Utility Functions ---
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
            // Silently handle error without logging to console
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
            // Silently handle error without logging to console
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

    // --- Event Delegation for Copy Buttons ---
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
                    }).catch(err => {
                        // Silently handle error without logging to console
                    });
                }
            }
        });
    }

    // --- Debounce function for search input ---
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

    // --- Handle search input ---
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

    // --- Tier-level search ---
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

    // --- Async Guard Functions for Data Caching ---
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

    // --- Skeleton Loaders ---
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

    // --- Gallery Skeleton ---
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

    // --- Modal Logic ---
    const platformModal = document.getElementById('platformModal');

    function showPlatformModal(platform) {
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
                document.getElementById('modalTeaserVideo').pause();
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

    // --- Simplified View-Rendering Functions ---
    function renderPlatforms(platforms) {
        let platformsHTML = '<div class="platforms-grid">';
        platforms.forEach(platform => {
            // Check if user has any subscription to this platform
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
        // Use is_accessible from backend instead of checking userSubscriptions
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
            // Silently handle error without logging to console
            displayError("Unable to load tiers for this platform.");
            return;
        }

        renderTiers(tiersData, platformId, platformName);
    }

    // --- Content View Logic ---
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
            // Silently handle error without logging to console
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
                // Removed console.log that was exposing backend details

                const card = document.createElement('div');
                card.className = 'link-card';
                if (link.locked) card.classList.add('locked');
                if (isRecentContent) {
                    card.classList.add('is-new');
                    // Removed console.log that was exposing backend details
                }
                card.dataset.contentType = link.content_type || 'Video';
                card.dataset.recentStatus = isRecentContent ? 'true' : 'false';
                card.dataset.searchText = generateSearchableText(link);
                card.dataset.tierName = tierName;
                card.dataset.platformId = platformId;
                card.dataset.tierId = link.tier_id; // ✅ FIX: Use numeric ID from API

                // Handle Gallery content type differently
                const isGallery = link.content_type === 'Gallery';

                // Thumbnail section (if present)
                if (link.thumbnail_url) {
                    const thumbnailContainer = document.createElement('div');
                    thumbnailContainer.className = 'thumbnail-container';
                    
                    // NEW: Add play button overlay for videos
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
                        // Removed console.log that was exposing backend details
                    }
                    const thumbnailImage = document.createElement('img');
                    thumbnailImage.src = link.thumbnail_url;
                    thumbnailImage.alt = `Thumbnail for ${link.title}`;
                    thumbnailImage.loading = 'lazy';
                    thumbnailContainer.appendChild(thumbnailImage);
                    
                    // NEW: Add click handler for video playback
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

                // Title section with text-based badge for recent items without thumbnails
                const title = document.createElement('h3');
                const titleText = document.createTextNode(link.title || "Untitled Link");
                title.appendChild(titleText);
                
                // Add icon for Gallery content type
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
                    // Removed console.log that was exposing backend details
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
                        // --- NEW: Add a "View Gallery" button ---
                        const viewButton = document.createElement('a');
                        viewButton.className = 'view-gallery-btn';
                        viewButton.textContent = '🖼️ View Gallery';
                        viewButton.href = `links.html?view=gallery&slug=${link.url}`;
                        actionsContainer.appendChild(viewButton);
                    } else {
                        // NEW: Watch Video button
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

    // --- Setup filters with Recently Added support ---
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

    // --- Filter handling with search support ---
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

    // --- Apply filters with search support ---
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
                const badge = card.querySelector('.new-badge') || card.querySelector('.new-badge-text');
                // Removed console.log that was exposing backend details
            } else {
                card.classList.remove('recent-highlight');
            }

            if (shouldShow) hasVisibleContent = true;
            // Removed console.log that was exposing backend details
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

    // --- Navigation Handlers ---
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
                // Use history.back() for gallery view
                history.back();
            }
        };
    }

    // --- Gallery Functions ---
    async function fetchAndDisplayGallery(slug) {
        renderGallerySkeleton();
        try {
            const token = localStorage.getItem('lustroom_jwt');
            const response = await fetch(`${API_BASE_URL}/gallery/${slug}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            
            // Removed console.log that was exposing backend details
            
            if (response.ok && data.status === 'success' && data.gallery) {
                renderGallery(data.gallery);
            } else if (response.status === 401 || response.status === 403) {
                localStorage.clear();
                window.location.href = 'login.html';
            } else {
                displayError(data.message || "Failed to fetch gallery.");
            }
        } catch (error) {
            // Silently handle error without logging to console
            displayError("An error occurred while fetching the gallery.");
        }
    }

    function renderGallery(galleryData) {
        // Removed console.log that was exposing backend details
        
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
        
        // Removed console.log that was exposing backend details
        
        galleryData.images.forEach((image, index) => {
            // Removed console.log that was exposing backend details
            
            const item = document.createElement('div');
            item.className = 'gallery-item';
            
            // Create a temporary image to get actual dimensions
            const tempImg = new Image();
            const linkElement = document.createElement('a');
            linkElement.href = image.url;
            linkElement.setAttribute('data-pswp-width', '1920');
            linkElement.setAttribute('data-pswp-height', '1080');
            linkElement.target = '_blank';
            
            // Load actual dimensions when image loads
            tempImg.onload = function() {
                linkElement.setAttribute('data-pswp-width', this.naturalWidth.toString());
                linkElement.setAttribute('data-pswp-height', this.naturalHeight.toString());
                // Removed console.log that was exposing backend details
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
        
        // Initialize PhotoSwipe after DOM is ready and images have dimensions
        setTimeout(() => {
            initPhotoSwipe();
        }, 500);
        
        // Add back button listener using history.back()
        addBackButtonListener('history');
    }

    function initPhotoSwipe() {
    // Removed console.log that was exposing backend details
    
    // Check if PhotoSwipe is loaded
    if (typeof PhotoSwipeLightbox === 'undefined') {
        // Silently handle error without logging to console
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
        
        // --- 🎯 NEW TRACKING LOGIC ---
        let viewedImageIndexes = new Set();
        let gallerySlugForTracking = null;
        
        // Get slug from URL
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('view') === 'gallery') {
            gallerySlugForTracking = urlParams.get('slug');
        }

        // Track which images are viewed as user navigates
        lightbox.on('change', () => {
            if (lightbox.pswp) {
                const currentIndex = lightbox.pswp.currIndex;
                viewedImageIndexes.add(currentIndex);
                // Removed console.log that was exposing backend details
            }
        });

        // Send tracking data when gallery is closed
        lightbox.on('close', () => {
            const totalUniqueViews = viewedImageIndexes.size;
            // Removed console.log that was exposing backend details

            if (totalUniqueViews > 0 && gallerySlugForTracking) {
                const token = localStorage.getItem('lustroom_jwt');
                if (token) {
                    const payload = {
                        gallery_slug: gallerySlugForTracking,
                        images_viewed_count: totalUniqueViews
                    };

                    // Fire-and-forget tracking request
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
                            // Removed console.log that was exposing backend details
                        } else {
                            // Removed console.log that was exposing backend details
                        }
                    })
                    .catch(error => {
                        // Silently handle error without logging to console
                    });
                }
            }
            
            // Clear the tracking data for next session
            viewedImageIndexes.clear();
            gallerySlugForTracking = null;
        });
        // --- END TRACKING LOGIC ---
        
        // Auto-hide UI on mouse idle
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
            // Removed console.log that was exposing backend details
            
            // Fullscreen button
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
            
            // Download button
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
        
        // Slideshow functionality
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
        // Removed console.log that was exposing backend details
    } catch (error) {
        // Silently handle error without logging to console
    }
}

    // --- PREMIUM VIDEO PLAYER (PRODUCTION v2.1 MOBILE FIX) ---
    function openVideoPlayer(link, tierId) {
        // Extract video ID and library ID
        const videoIdMatch = link.url.match(/\/([a-f0-9-]{36})\//);
        if (!videoIdMatch) return;
        
        const videoId = videoIdMatch[1];
        const libraryIdMatch = link.url.match(/library_id=(\d+)/);
        const libraryId = libraryIdMatch ? libraryIdMatch[1] : '555806';
        
        // ✅ FIX 1: Detect mobile device
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        
        const numericTierId = link.tier_id || 1;
        analyticsTracker.setVideoTierMapping(videoId, numericTierId);
        
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'premium-player-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', 'Video player');
        modal.setAttribute('aria-modal', 'true');
        
        // ✅ FIX 2: Add mobile-specific class
        if (isMobile) {
            modal.classList.add('mobile-player');
        }
        
        // Build HTML structure (same as before)
        modal.innerHTML = `
            <div class="premium-player-content">
                <!-- Loading Overlay -->
                <div class="player-loading-overlay">
                    <div class="player-spinner"></div>
                    <div class="player-loading-text">Loading video...</div>
                </div>
                
                <!-- Error Overlay -->
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
                
                <!-- Top Header -->
                <div class="premium-player-header">
                    <button class="premium-close-btn" aria-label="Close video player">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                    <div class="premium-video-title">${link.title}</div>
                    <div class="premium-header-spacer"></div>
                </div>
                
                <!-- Video Container -->
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
                    
                    <!-- Center Play Button Overlay -->
                    <div class="premium-center-overlay">
                        <button class="premium-center-play-btn show" aria-label="Play video">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                        </button>
                    </div>
                    
                    <!-- Gesture Indicator (for mobile) -->
                    <div class="premium-gesture-indicator"></div>
                    
                    <!-- Quality/Speed Change Indicator -->
                    <div class="premium-change-indicator"></div>
                </div>
                
                <!-- Custom Controls -->
                <div class="premium-controls-wrapper">
                    <div class="premium-controls-bg"></div>
                    
                    <!-- Progress Bar -->
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
                    
                    <!-- Bottom Controls Row -->
                    <div class="premium-controls-row">
                        <!-- Play/Pause -->
                        <button class="premium-control-btn premium-play-btn" aria-label="Play">
                            <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                            <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                            </svg>
                        </button>
                        
                        <!-- Skip Backward 10s -->
                        <button class="premium-control-btn premium-skip-backward premium-skip-btn" aria-label="Rewind 10 seconds">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 5V2.21c0-.45-.54-.67-.85-.35l-3.8 3.79c-.2.2-.2.51 0 .71l3.79 3.79c.32.31.86.09.86-.36V7c3.73 0 6.68 3.42 5.86 7.29-.47 2.27-2.31 4.1-4.57 4.57-3.57.75-6.75-1.7-7.23-5.01-.07-.48-.49-.85-.98-.85-.6 0-1.08.53-1 1.13.62 4.39 4.8 7.64 9.53 6.72 3.12-.61 5.63-3.12 6.24-6.24C20.84 9.48 16.94 5 12 5z"/>
                                <text x="12" y="16" text-anchor="middle" font-size="8" font-weight="bold" fill="currentColor">10</text>
                            </svg>
                        </button>
                        
                        <!-- Skip Forward 10s -->
                        <button class="premium-control-btn premium-skip-forward premium-skip-btn" aria-label="Forward 10 seconds">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 5V2.21c0-.45.54-.67.85-.35l3.8 3.79c.2.2.2.51 0 .71l-3.79 3.79c-.32.31-.86.09-.86-.36V7c-3.73 0-6.68 3.42-5.86 7.29.47 2.27 2.31 4.1 4.57 4.57 3.57.75 6.75-1.7 7.23-5.01.07-.48.49-.85.98-.85.6 0 1.08.53-1 1.13-.62 4.39-4.8 7.64-9.53 6.72-3.12-.61-5.63-3.12-6.24-6.24C3.16 9.48 7.06 5 12 5z"/>
                                <text x="12" y="16" text-anchor="middle" font-size="8" font-weight="bold" fill="currentColor">10</text>
                            </svg>
                        </button>
                        
                        <!-- Volume Control -->
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
                        
                        <!-- Time Display -->
                        <div class="premium-time-display">0:00 / 0:00</div>
                        
                        <!-- Spacer -->
                        <div class="premium-controls-spacer"></div>
                        
                        <!-- Settings Button -->
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
                
                <!-- Keyboard Shortcuts Tooltip (hidden by default) -->
                <div class="premium-shortcuts-tooltip">
                    <div class="premium-shortcuts-title">Keyboard Shortcuts</div>
                    <div class="premium-shortcuts-list">
                        <div class="premium-shortcut-item">
                            <span class="premium-shortcut-key">Space</span>
                            <span class="premium-shortcut-desc">Play/Pause</span>
                        </div>
                        <div class="premium-shortcut-item">
                            <span class="premium-shortcut-key">←</span>
                            <span class="premium-shortcut-desc">Rewind 10s</span>
                        </div>
                        <div class="premium-shortcut-item">
                            <span class="premium-shortcut-key">→</span>
                            <span class="premium-shortcut-desc">Forward 10s</span>
                        </div>
                        <div class="premium-shortcut-item">
                            <span class="premium-shortcut-key">M</span>
                            <span class="premium-shortcut-desc">Mute/Unmute</span>
                        </div>
                        <div class="premium-shortcut-item">
                            <span class="premium-shortcut-key">F</span>
                            <span class="premium-shortcut-desc">Fullscreen</span>
                        </div>
                        <div class="premium-shortcut-item">
                            <span class="premium-shortcut-key">?</span>
                            <span class="premium-shortcut-desc">Show shortcuts</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        const playerId = `premiumPlayer_${videoId}`;
        
        // ✅ FIX 3: Smart Fullscreen Request (Desktop only)
        const requestFullscreen = () => {
            // Skip fullscreen on mobile - let native controls handle it
            if (isMobile) {
                // ✅ NEW: On iOS, try to enter fullscreen for video element instead
                if (isIOS) {
                    const videoElement = player.el().querySelector('video');
                    if (videoElement && videoElement.webkitEnterFullscreen) {
                        try {
                            // iOS Safari native fullscreen
                            videoElement.webkitEnterFullscreen();
                        } catch (err) {
                            // Fullscreen not supported or blocked
                        }
                    }
                }
                return;
            }
            
            const elem = modal;
            if (elem.requestFullscreen) {
                elem.requestFullscreen().catch(() => {
                    // Fullscreen failed - continue anyway
                });
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            } else if (elem.mozRequestFullScreen) {
                elem.mozRequestFullScreen();
            } else if (elem.msRequestFullscreen) {
                elem.msRequestFullscreen();
            }
        };
        
        setTimeout(requestFullscreen, 50);
        
        // ✅ FIX 2: Initialize Video.js with mobile optimizations (Issue 2)
        const player = videojs(playerId, {
            controls: false,
            autoplay: false,
            preload: 'auto',
            playsinline: true,
            responsive: true,
            fluid: true,
            // ✅ FIXED: Mobile-optimized configuration
            nativeControlsForTouch: false,
            html5: {
                vhs: {
                    enableLowInitialPlaylist: true,
                    smoothQualityChange: true,
                    overrideNative: !isIOS, // iOS uses native HLS
                    bandwidth: isMobile ? 1500000 : 5000000,
                    // ✅ NEW: Better mobile buffering
                    maxMaxBufferLength: isMobile ? 30 : 60,
                    maxBufferLength: isMobile ? 20 : 30,
                    maxBufferSize: isMobile ? 30 * 1000 * 1000 : 60 * 1000 * 1000
                },
                nativeVideoTracks: isIOS,
                nativeAudioTracks: isIOS,
                // ✅ NEW: Android-specific fixes
                nativeTextTracks: false // Prevent subtitle rendering issues
            }
        });
        
        modal._player = player;
        modal._playerId = playerId;
        
        activePlayers.set(playerId, { player, modal });
        
        // Initialize managers (same as before)
        const stateManager = new PremiumPlayerStateManager();
        const qualityManager = new PremiumQualityManager(player);
        const speedManager = new PremiumSpeedManager(player);
        const controlsManager = new PremiumControlsManager(modal, player, stateManager, qualityManager, speedManager);
        
        // Get all DOM elements
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
        
        // ✅ FIX 5: Mobile-specific touch improvements
        if (isMobile) {
            // Disable default touch actions on video element
            const videoElement = player.el().querySelector('video');
            if (videoElement) {
                videoElement.style.touchAction = 'none';
                
                // Prevent context menu on long press
                videoElement.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    return false;
                });
                
                // ✅ NEW: Prevent iOS Safari bottom bar from appearing
                videoElement.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                }, { passive: false });
            }
            
            // ✅ NEW: Enhanced touch controls visibility for mobile
            let touchTimer;
            let lastTouchTime = 0;
            
            const handleTouchInteraction = (e) => {
                const now = Date.now();
                const timeSinceLastTouch = now - lastTouchTime;
                lastTouchTime = now;
                
                // Skip if touching controls directly
                const controlElements = [
                    '.premium-control-btn',
                    '.premium-progress-bar',
                    '.premium-settings-menu'
                ];
                
                if (controlElements.some(selector => e.target.closest(selector))) {
                    return;
                }
                
                // ✅ NEW: Toggle controls visibility on quick tap (not swipe)
                if (e.type === 'touchend' && timeSinceLastTouch < 200 && !touchMoved) {
                    if (controlsManager.state.showingControls) {
                        controlsManager.hideControls();
                    } else {
                        controlsManager.showControls();
                    }
                    return;
                }
                
                // Show controls on any touch movement
                controlsManager.showControls();
                clearTimeout(touchTimer);
                
                // Auto-hide after delay
                touchTimer = setTimeout(() => {
                    if (!player.paused()) {
                        controlsManager.hideControls();
                    }
                }, 3000);
            };
            
            modal.addEventListener('touchstart', handleTouchInteraction, { passive: true });
            modal.addEventListener('touchmove', handleTouchInteraction, { passive: true });
            modal.addEventListener('touchend', handleTouchInteraction, { passive: true });
        }
        
        // ✅ FIX 7: Handle iOS video fullscreen properly
        if (isIOS) {
            const videoElement = player.el().querySelector('video');
            if (videoElement) {
                // Ensure all iOS-specific attributes are set
                videoElement.setAttribute('playsinline', '');
                videoElement.setAttribute('webkit-playsinline', '');
                videoElement.setAttribute('x-webkit-airplay', 'allow');
                
                videoElement.addEventListener('webkitbeginfullscreen', () => {
                    stateManager.isFullscreen = true;
                });
                
                videoElement.addEventListener('webkitendfullscreen', () => {
                    stateManager.isFullscreen = false;
                    // Don't auto-close on iOS - user might want to continue watching
                });
                
                // Handle iOS playback initialization
                videoElement.addEventListener('loadedmetadata', () => {
                    // Force load on iOS to enable playback
                    videoElement.load();
                });
            }
        }

        // ✅ FIX 5: Android-specific video handling (Issue 5)
        if (!isIOS && isMobile) {
            player.ready(() => {
                const videoElement = player.el().querySelector('video');
                if (!videoElement) return;
                
                // ✅ FIXED: Set attributes in ready callback
                videoElement.setAttribute('controlslist', 'nodownload nofullscreen');
                videoElement.setAttribute('disablepictureinpicture', '');
                videoElement.setAttribute('preload', 'metadata'); // Better Android performance
                
                // Handle Android fullscreen events
                const fullscreenHandler = () => {
                    if (document.fullscreenElement === videoElement) {
                        stateManager.isFullscreen = true;
                    } else {
                        stateManager.isFullscreen = false;
                    }
                };
                
                videoElement.addEventListener('fullscreenchange', fullscreenHandler);
                videoElement.addEventListener('webkitfullscreenchange', fullscreenHandler);
                
                // ✅ NEW: Better WebView detection and handling
                const isWebView = navigator.userAgent.includes('wv') || 
                                 window.navigator.standalone ||
                                 window.matchMedia('(display-mode: standalone)').matches;
                
                if (isWebView) {
                    // Running in Android WebView or PWA
                    videoElement.setAttribute('x5-video-player-type', 'h5');
                    videoElement.setAttribute('x5-video-player-fullscreen', 'true');
                    videoElement.setAttribute('x5-video-orientation', 'landscape');
                    
                    // ✅ NEW: Force load in WebView
                    videoElement.load();
                }
                
                // ✅ NEW: Android-specific error recovery
                videoElement.addEventListener('error', (e) => {
                    console.error('Android video error:', e);
                    // Attempt recovery by reloading source
                    if (player && !player.isDisposed()) {
                        setTimeout(() => {
                            player.src(player.currentSrc());
                        }, 1000);
                    }
                });
            });
        }

        // ✅ FIX 6: Handle orientation changes on mobile (Issue 6)
        if (isMobile) {
            let orientationTimeout;
            let lastOrientation = window.orientation;
            let isChangingOrientation = false;
            
            const handleOrientationChange = () => {
                // ✅ NEW: Clear previous timeout
                if (orientationTimeout) {
                    clearTimeout(orientationTimeout);
                }
                
                // ✅ NEW: Only trigger if orientation actually changed
                const currentOrientation = window.orientation;
                if (currentOrientation === lastOrientation) return;
                lastOrientation = currentOrientation;
                isChangingOrientation = true;
                
                // ✅ NEW: Pause interactions during rotation
                modal.style.pointerEvents = 'none';
                
                // ✅ NEW: Show loading indicator
                if (controlsManager.elements.loadingOverlay) {
                    controlsManager.elements.loadingOverlay.classList.add('active');
                }
                
                // ✅ FIXED: Debounced resize with player validation
                orientationTimeout = setTimeout(() => {
                    if (player && !player.isDisposed() && player.el()) {
                        try {
                            player.trigger('resize');
                            
                            // ✅ NEW: Force video element dimensions update
                            const videoElement = player.el().querySelector('video');
                            if (videoElement) {
                                videoElement.style.width = '100%';
                                videoElement.style.height = '100%';
                                
                                // ✅ NEW: Force repaint
                                videoElement.offsetHeight;
                            }
                            
                            // ✅ NEW: Re-enable interactions
                            modal.style.pointerEvents = '';
                            isChangingOrientation = false;
                            
                            // ✅ NEW: Hide loading indicator
                            if (controlsManager.elements.loadingOverlay) {
                                controlsManager.elements.loadingOverlay.classList.remove('active');
                            }
                            
                            // ✅ NEW: Show controls briefly
                            controlsManager.showControls();
                        } catch (error) {
                            // Player disposed during orientation change
                        }
                    }
                }, 300); // Increased delay for stability
            };
            
            window.addEventListener('orientationchange', handleOrientationChange);
            window.addEventListener('resize', handleOrientationChange);
            
             // ✅ NEW: Prevent touches during orientation change
            modal.addEventListener('touchstart', (e) => {
                if (isChangingOrientation) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }, { passive: false, capture: true });
            
            // Cleanup on modal removal
            modal.addEventListener('remove', () => {
                if (orientationTimeout) {
                    clearTimeout(orientationTimeout);
                }
                window.removeEventListener('orientationchange', handleOrientationChange);
                window.removeEventListener('resize', handleOrientationChange);
            });
        }
        
        // Set video source
        player.src({
            src: link.url,
            type: 'application/x-mpegURL'
        });
        
        // ✅ FIX 3 Part 2: iOS-specific initialization sequence (Issue 3)
        if (isIOS) {
            player.ready(() => {
                // Unmute after iOS allows playback
                player.muted(false);
                player.volume(1);
                
                // Force load on iOS
                const videoElement = player.el().querySelector('video');
                if (videoElement) {
                    videoElement.load();
                }
            });
        }

        // ✅ OPTIMIZATION 2: Add Network State Monitoring (Opt 2)
        if (isMobile && navigator.connection) {
            const updateNetworkState = () => {
                const connection = navigator.connection;
                const effectiveType = connection.effectiveType;
                
                // Adjust quality based on network
                if (effectiveType === 'slow-2g' || effectiveType === '2g') {
                    // Force lowest quality
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
            
            // Cleanup
            modal.addEventListener('remove', () => {
                navigator.connection.removeEventListener('change', updateNetworkState);
            });
        }
        
        // Initialize quality manager after source is set
        player.ready(() => {
            qualityManager.initialize();
            
            // Wait for quality levels to load
            setTimeout(() => {
                renderSettingsMenu();
            }, 2000);
            
            // Also re-render when quality levels change
            const checkQualityLevels = setInterval(() => {
                if (qualityManager.getAvailableQualities().length > 1) {
                    renderSettingsMenu();
                    clearInterval(checkQualityLevels);
                }
            }, 500);
            
            // Stop checking after 10 seconds
            setTimeout(() => clearInterval(checkQualityLevels), 10000);
        });
        
        // --- NEW: Helper function to safely get player ---
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
        
        // --- NEW: Player health check function ---
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
        
        // --- NEW: Cleanup function ---
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
                } catch (e) {
                    // Already cleaned up
                }
                activePlayers.delete(id);
            }
        };
        
        // --- Event Handlers ---
        
        // ✅ NEW: Haptic feedback utility for iOS
        function triggerHapticFeedback(style = 'medium') {
            if ('vibrate' in navigator) {
                // Simple vibration for Android
                navigator.vibrate(10);
            }
            
            // iOS haptic feedback
            if (window.Taptic && window.Taptic.impact) {
                window.Taptic.impact(style);
            } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.haptic) {
                window.webkit.messageHandlers.haptic.postMessage({ style: style });
            }
        }
        
        // Play/Pause
        const togglePlayPause = () => {
            if (!isPlayerHealthy(playerId)) {
                cleanupPlayer(playerId);
                return;
            }
            
            const activePlayer = activePlayers.get(playerId).player;
            try {
                if (activePlayer.paused()) {
                    activePlayer.play().catch(() => {});
                    triggerHapticFeedback('light'); // ✅ NEW
                } else {
                    activePlayer.pause();
                    triggerHapticFeedback('light'); // ✅ NEW
                }
            } catch (error) {
                cleanupPlayer(playerId);
            }
        };
        
        controlsManager.elements.playBtn.addEventListener('click', togglePlayPause);
        
        // ✅ NEW: Fixed Center Play Button Handling
        const centerPlayBtnClickHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePlayPause();
        };

        // Use both click and touchend for reliability
        controlsManager.elements.centerPlayBtn.addEventListener('click', centerPlayBtnClickHandler);

        // ✅ NEW: Add touchend listener for iOS reliability
        if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            controlsManager.elements.centerPlayBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Only trigger if touch didn't move (not a swipe)
                if (!touchMoved) {
                    togglePlayPause();
                }
            }, { passive: false });
        }
        
        // Skip buttons
        controlsManager.elements.skipBackward.addEventListener('click', () => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            activePlayer.currentTime(Math.max(0, activePlayer.currentTime() - 10));
            controlsManager.showGestureIndicator('⏪');
            triggerHapticFeedback('medium'); // ✅ NEW
        });
        
        controlsManager.elements.skipForward.addEventListener('click', () => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            activePlayer.currentTime(Math.min(activePlayer.duration(), activePlayer.currentTime() + 10));
            controlsManager.showGestureIndicator('⏩');
            triggerHapticFeedback('medium'); // ✅ NEW
        });
        
        // Volume controls
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
        
        // ✅ FIXED: Progress bar seeking with better mobile support
        // Progress bar seeking
        let isSeeking = false;
        let seekStartTime = 0; // ✅ NEW: Track seek start time

        const handleProgressClick = (e) => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            // ✅ FIXED: Better touch coordinate handling
            const clientX = e.type.includes('touch') ? 
                (e.touches && e.touches[0] ? e.touches[0].clientX : e.changedTouches[0].clientX) : 
                e.clientX;
            
            const rect = controlsManager.elements.progressBar.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const newTime = percent * activePlayer.duration();
            
            // ✅ NEW: Validate seek time
            if (isFinite(newTime) && newTime >= 0) {
                activePlayer.currentTime(newTime);
                
                // ✅ NEW: Visual feedback for mobile
                if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
                    controlsManager.elements.progressBar.style.setProperty('--touch-x', `${percent * 100}%`);
                }
            }
        };

        // ✅ NEW: Unified touch/mouse event handling
        const startSeeking = (e) => {
            isSeeking = true;
            seekStartTime = Date.now();
            stateManager.isSeeking = true;
            controlsManager.elements.progressBar.classList.add('seeking');
            
            // ✅ NEW: Prevent text selection on mobile
            e.preventDefault();
            
            // Update position immediately
            handleProgressClick(e);
        };

        const continueSeeking = (e) => {
            if (!isSeeking) return;
            
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            const clientX = e.type.includes('touch') ? 
                (e.touches && e.touches[0] ? e.touches[0].clientX : e.changedTouches[0].clientX) : 
                e.clientX;
            
            const rect = controlsManager.elements.progressBar.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            
            controlsManager.elements.progressPlayed.style.width = `${percent * 100}%`;
            controlsManager.elements.progressHandle.style.left = `${percent * 100}%`;
            
            // ✅ NEW: Show time preview on mobile
            if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
                const time = percent * activePlayer.duration();
                if (controlsManager.elements.timeDisplay) {
                    controlsManager.elements.timeDisplay.textContent = 
                        `${controlsManager.formatTime(time)} / ${controlsManager.formatTime(activePlayer.duration())}`;
                }
            }
        };

        const endSeeking = (e) => {
            if (!isSeeking) return;
            
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            // ✅ NEW: Only seek if it was an intentional drag (not a quick tap)
            const seekDuration = Date.now() - seekStartTime;
            
            const clientX = e.type.includes('touch') ? 
                (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : e.clientX) : 
                e.clientX;
            
            const rect = controlsManager.elements.progressBar.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const newTime = percent * activePlayer.duration();
            
            if (isFinite(newTime) && newTime >= 0) {
                activePlayer.currentTime(newTime);
            }
            
            isSeeking = false;
            stateManager.isSeeking = false;
            controlsManager.elements.progressBar.classList.remove('seeking');
        };

        // ✅ NEW: Single click/tap handler for progress bar
        controlsManager.elements.progressBar.addEventListener('click', (e) => {
            // Only handle direct clicks, not drags
            if (!isSeeking) {
                handleProgressClick(e);
            }
        });

        // Mouse events (desktop)
        controlsManager.elements.progressBar.addEventListener('mousedown', startSeeking);
        document.addEventListener('mousemove', continueSeeking);
        document.addEventListener('mouseup', endSeeking);

        // ✅ NEW: Touch events (mobile)
        if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
            controlsManager.elements.progressBar.addEventListener('touchstart', startSeeking, { passive: false });
            document.addEventListener('touchmove', continueSeeking, { passive: false });
            document.addEventListener('touchend', endSeeking, { passive: false });
        }
        
        // Progress bar hover - show thumbnail preview
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
        
        // Settings menu
        controlsManager.elements.settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = controlsManager.elements.settingsMenu.classList.toggle('active');
            controlsManager.elements.settingsBtn.setAttribute('aria-expanded', isActive);
        });
        
        // Close settings menu when clicking outside
        const closeSettingsMenu = (e) => {
            if (controlsManager.elements.settingsMenu && 
                !controlsManager.elements.settingsMenu.contains(e.target) && 
                !controlsManager.elements.settingsBtn.contains(e.target)) {
                controlsManager.elements.settingsMenu.classList.remove('active');
                controlsManager.elements.settingsBtn.setAttribute('aria-expanded', 'false');
            }
        };
        
        document.addEventListener('click', closeSettingsMenu);
        
        // Render settings menu options
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
                    
                    option.addEventListener('click', () => {
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
                    });
                    
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
                    
                    option.addEventListener('click', () => {
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
                    });
                    
                    controlsManager.elements.speedOptions.appendChild(option);
                });
            }
        }
        
        // ✅ FIX 8: Smart fullscreen handling for mobile (Issue 8)
        const handleFullscreenChange = () => {
            const wasFullscreen = stateManager.isFullscreen;
            stateManager.isFullscreen = !!document.fullscreenElement;
            
            // ✅ NEW: Don't close on mobile fullscreen changes
            if (!isMobile) {
                // Desktop: close when exiting fullscreen
                if (!document.fullscreenElement && wasFullscreen) {
                    closePlayer();
                }
            } else {
                // ✅ NEW: Mobile: handle iOS native fullscreen separately
                if (isIOS) {
                    const videoElement = player.el().querySelector('video');
                    if (videoElement) {
                        // Check iOS-specific fullscreen state
                        const isIOSFullscreen = document.webkitFullscreenElement === videoElement;
                        stateManager.isFullscreen = isIOSFullscreen || stateManager.isFullscreen;
                    }
                }
                // Mobile devices should stay open when fullscreen changes
            }
        };
        
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        // ✅ NEW: iOS-specific fullscreen handler
        if (isIOS) {
            document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        }
        
        // Close button and ESC key
        const closePlayer = () => {
            // ✅ NEW: Clear session tracking
            analyticsTracker.clearSession(videoId);
            
            // Stop token refresh
            tokenRefreshManager.stopRefresh(videoId);
            
            // ✅ NEW: Clean up player events first
            if (modal && modal._cleanupPlayerEvents) {
                modal._cleanupPlayerEvents();
            }
            
            // Remove from global registry
            activePlayers.delete(playerId);
            
            // Remove event listeners
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('click', closeSettingsMenu);
            document.removeEventListener('keydown', handleKeyDown);
            
            // ✅ NEW: Clear all intervals/timeouts
            if (hideControlsInterval) {
                clearInterval(hideControlsInterval);
            }
            
            // Exit fullscreen if active
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
            
            // ✅ FIXED: More thorough player disposal
            if (player && !player.isDisposed()) {
                try {
                    // Pause first to stop any ongoing operations
                    player.pause();
                    
                    // Clear source to stop any network requests
                    player.src('');
                    
                    // Then dispose
                    player.dispose();
                } catch (e) {
                    // Player already disposed or in invalid state
                }
            }
            
            // Remove modal
            if (modal && modal.parentNode) {
                modal.remove();
            }
            
            // Restore body overflow
            document.body.style.overflow = '';
        };
        
        controlsManager.elements.closeBtn.addEventListener('click', closePlayer);
        controlsManager.elements.closeErrorBtn.addEventListener('click', closePlayer);
        
        // Keyboard handler
        const handleKeyDown = (e) => {
            // Don't handle if settings menu is open
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
                    // F key does nothing since we auto-enter fullscreen
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
        
        // Error handling
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
        
        // --- Video.js Event Listeners ---
        
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
        
        // Updated timeupdate handler with defensive programming
        player.on('timeupdate', () => {
            try {
                // Check if player still exists and is valid
                const playerData = activePlayers.get(playerId);
                if (!playerData || !playerData.player) {
                    return;
                }
                
                const activePlayer = playerData.player;
                
                // Multiple safety checks
                if (!activePlayer || 
                    !activePlayer.el() || 
                    activePlayer.isDisposed() ||
                    typeof activePlayer.currentTime !== 'function') {
                    return;
                }
                
                if (!isSeeking) {
                    const current = activePlayer.currentTime();
                    const duration = activePlayer.duration();
                    
                    // Check if values are valid
                    if (!isFinite(current) || !isFinite(duration) || duration <= 0) {
                        return;
                    }
                    
                    // Get buffered time safely
                    let buffered = 0;
                    try {
                        if (activePlayer.buffered && 
                            activePlayer.buffered().length > 0) {
                            buffered = activePlayer.buffered().end(activePlayer.buffered().length - 1);
                        }
                    } catch (e) {
                        // Silently handle buffered error
                    }
                    
                    if (controlsManager && 
                        controlsManager.updateProgress && 
                        controlsManager.updateTimeDisplay) {
                        controlsManager.updateProgress(current, duration, buffered);
                        controlsManager.updateTimeDisplay(current, duration);
                    }
                }
            } catch (error) {
                // Player disposed or not ready - clean up
                activePlayers.delete(playerId);
            }
        });
        
        // Updated volumechange handler with defensive programming
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
                // Silently handle
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

        // ✅ NEW: Store event cleanup function (Issue 7)
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
                } catch (error) {
                    // Player already disposed
                }
            }
        };
        
        // --- Controls Visibility Logic ---
        
        // Show controls on mouse movement (non-mobile)
        if (!isMobile) {
            modal.addEventListener('mousemove', () => {
                controlsManager.showControls();
            });
        }
        
        // Click on video area to toggle play/pause
        const videoArea = controlsManager.elements.progressBar.parentElement.parentElement;
        if (videoArea) {
            videoArea.addEventListener('click', (e) => {
                // Only toggle if clicking on video area, not on controls
                if (e.target.closest('.premium-controls-row') || 
                    e.target.closest('.premium-progress-container') ||
                    e.target.closest('.premium-settings-menu')) {
                    return;
                }
                togglePlayPause();
            });
        }
        
        // --- Mobile Touch Gestures (Issue 1 & 2 Fixes) ---

        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        let isSwiping = false;
        let touchMoved = false; // ✅ NEW: Track if touch moved significantly
        let preventNextClick = false; // ✅ NEW: Flag to prevent ghost clicks

        modal.addEventListener('touchstart', (e) => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            const controlElements = [
                '.premium-controls-wrapper',
                '.premium-player-header',
                '.premium-progress-bar',
                '.premium-control-btn',
                '.premium-settings-menu',
                '.premium-volume-slider'
            ];
            
            if (controlElements.some(selector => e.target.closest(selector))) {
                return;
            }
            
            const touchCount = e.touches.length;
            if (touchCount === 1) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                touchStartTime = activePlayer.currentTime();
                isSwiping = false;
                touchMoved = false; // ✅ NEW: Reset movement flag
                preventNextClick = false; // ✅ NEW: Reset click prevention flag
            }
        }, { passive: true });
        
        // Replace touchmove handler
        modal.addEventListener('touchmove', (e) => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            const controlElements = [
                '.premium-controls-wrapper',
                '.premium-player-header',
                '.premium-progress-bar',
                '.premium-control-btn',
                '.premium-settings-menu',
                '.premium-volume-slider'
            ];
            
            if (controlElements.some(selector => e.target.closest(selector))) {
                return;
            }
            
            if (e.touches.length !== 1) return;
            
            const touchCurrentX = e.touches[0].clientX;
            const touchCurrentY = e.touches[0].clientY;
            
            const deltaX = touchCurrentX - touchStartX;
            const deltaY = touchCurrentY - touchStartY;
            
            // ✅ NEW: Mark as moved if threshold exceeded
            if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
                touchMoved = true;
            }
            
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
                isSwiping = true;
                preventNextClick = true; // ✅ NEW: Prevent click after swipe
                e.preventDefault();
                
                const seekAmount = (deltaX / window.innerWidth) * 30;
                const newTime = Math.max(0, Math.min(activePlayer.duration(), touchStartTime + seekAmount));
                
                if (controlsManager.elements.gestureIndicator) {
                    const direction = deltaX > 0 ? '⏩' : '⏪';
                    const seconds = Math.abs(Math.round(seekAmount));
                    controlsManager.elements.gestureIndicator.textContent = `${direction} ${seconds}s`;
                    controlsManager.elements.gestureIndicator.classList.add('show');
                }
            }
        }, { passive: false });
        
        // Replace touchend handler
        modal.addEventListener('touchend', (e) => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            if (controlsManager.elements.gestureIndicator) {
                controlsManager.elements.gestureIndicator.classList.remove('show');
            }
            
            const controlElements = [
                '.premium-controls-wrapper',
                '.premium-player-header',
                '.premium-progress-bar',
                '.premium-control-btn',
                '.premium-settings-menu',
                '.premium-volume-slider'
            ];
            
            if (controlElements.some(selector => e.target.closest(selector))) {
                return;
            }
            
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            
            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;
            
            if (isSwiping && Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
                const seekAmount = (deltaX / window.innerWidth) * 30;
                const newTime = Math.max(0, Math.min(activePlayer.duration(), touchStartTime + seekAmount));
                activePlayer.currentTime(newTime);
                
                if (seekAmount > 0) {
                    controlsManager.showGestureIndicator('⏩');
                } else {
                    controlsManager.showGestureIndicator('⏪');
                }
            }
            
            // ✅ NEW: Prevent click events after gesture
            if (preventNextClick) {
                const preventClickHandler = (clickEvent) => {
                    clickEvent.preventDefault();
                    clickEvent.stopPropagation();
                    modal.removeEventListener('click', preventClickHandler, true);
                };
                modal.addEventListener('click', preventClickHandler, true);
                
                // Clear flag after short delay
                setTimeout(() => {
                    preventNextClick = false;
                    modal.removeEventListener('click', preventClickHandler, true);
                }, 300);
            }
            
            isSwiping = false;
            touchMoved = false; // ✅ NEW: Reset movement flag
        }, { passive: true });
        
        // --- Enhanced Double-tap with Clear Zone Detection ---

        let lastTapTime = 0;
        let lastTapX = 0;
        const doubleTapThreshold = 300;
        const centerTapZoneWidth = 0.4; // 40% of screen width in center

        modal.addEventListener('touchend', (e) => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            // ✅ NEW: Don't process taps if user was swiping
            if (touchMoved || isSwiping) {
                return;
            }
            
            // Skip if touching controls
            const controlElements = [
                '.premium-controls-wrapper',
                '.premium-player-header',
                '.premium-progress-bar',
                '.premium-control-btn',
                '.premium-settings-menu'
            ];
            
            if (controlElements.some(selector => e.target.closest(selector))) {
                return;
            }
            
            const currentTime = Date.now();
            const tapLength = currentTime - lastTapTime;
            const tapX = e.changedTouches[0].clientX;
            const screenWidth = window.innerWidth;
            
            // Calculate tap zones
            const leftZoneEnd = screenWidth * 0.3;
            const rightZoneStart = screenWidth * 0.7;
            const centerZoneStart = screenWidth * ((1 - centerTapZoneWidth) / 2);
            const centerZoneEnd = screenWidth * ((1 + centerTapZoneWidth) / 2);
            
            // ✅ NEW: Check if tap is in same general area as last tap
            const isSameArea = Math.abs(tapX - lastTapX) < screenWidth * 0.15;
            
            if (tapLength < doubleTapThreshold && tapLength > 0 && isSameArea) {
                // Double tap detected
                e.preventDefault(); // ✅ NEW: Prevent any default behavior
                
                if (tapX < leftZoneEnd) {
                    // Left side - rewind
                    activePlayer.currentTime(Math.max(0, activePlayer.currentTime() - 10));
                    controlsManager.showGestureIndicator('⏪ 10s');
                    triggerHapticFeedback('medium');
                } else if (tapX > rightZoneStart) {
                    // Right side - forward
                    activePlayer.currentTime(Math.min(activePlayer.duration(), activePlayer.currentTime() + 10));
                    controlsManager.showGestureIndicator('⏩ 10s');
                    triggerHapticFeedback('medium');
                } else if (tapX >= centerZoneStart && tapX <= centerZoneEnd) {
                    // Center - toggle play/pause
                    togglePlayPause();
                }
                
                lastTapTime = 0; // Reset to prevent triple-tap
                lastTapX = 0;
            } else {
                // Potential first tap of double-tap sequence
                lastTapTime = currentTime;
                lastTapX = tapX;
                
                // ✅ NEW: Immediate single-tap feedback for center zone only
                if (tapX >= centerZoneStart && tapX <= centerZoneEnd) {
                    // Delay to allow for double-tap detection
                    setTimeout(() => {
                        // Only execute if no double-tap occurred
                        if (Date.now() - lastTapTime >= doubleTapThreshold) {
                            togglePlayPause();
                        }
                    }, doubleTapThreshold);
                }
            }
        });
        
        // --- Initialize Controls Visibility ---
        
        controlsManager.showControls();
        
        // Start auto-hide timer (desktop only, mobile handled by touchstart above)
        let hideControlsInterval;
        if (!isMobile) {
            hideControlsInterval = setInterval(() => {
                if (stateManager.shouldHideControls()) {
                    controlsManager.hideControls();
                }
            }, 1000);
        }
        
        // --- Token Refresh Integration ---
        
        tokenRefreshManager.registerVideo(videoId, player, tierId, libraryId);
        
        // --- Analytics Integration ---
        
        // Track timeupdate every 5 seconds (throttled)
        let lastTrackedTime = 0;
        player.on('timeupdate', () => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;

            const currentTime = activePlayer.currentTime();
            
            // Only track every 5 seconds to avoid spam
            if (currentTime - lastTrackedTime >= 5) {
                analyticsTracker.trackEvent(videoId, 'timeupdate', activePlayer, tierId);
                lastTrackedTime = currentTime;
            }
        });
        
        // Cleanup on close
        modal.addEventListener('remove', () => {
            clearInterval(hideControlsInterval);
            // Note: player.dispose() will remove event listeners automatically
            closePlayer();
        });
    }

    // --- Global cleanup function for video players ---
    function cleanupAllVideoPlayers() {
        activePlayers.forEach((playerData, playerId) => {
            try {
                if (playerData.player && !playerData.player.isDisposed()) {
                    playerData.player.dispose();
                }
                if (playerData.modal && playerData.modal.parentNode) {
                    playerData.modal.remove();
                }
            } catch (error) {
                // Silently handle cleanup errors
            }
        });
        activePlayers.clear();
        tokenRefreshManager.stopAll();
    }

    // --- Main Application Router ---
    async function router() {
        // Clean up any existing video players before loading new content
        cleanupAllVideoPlayers();
        
        // Load user data at the start of router
        loadUserData();
        
        // 🎯 NEW: Hide app loader after first successful load
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
        
        // ⚡ NEW: Start session refresh manager
        if (!sessionRefreshManager.refreshTimer) {
            sessionRefreshManager.start();
        }
        
        // NEW (V2): Load and display multiple announcements
        const announcementsData = JSON.parse(localStorage.getItem('global_announcements') || '[]');
        announcementSlider.showAnnouncements(announcementsData);
        
        // Render renewal banner and header actions
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

            // Handle gallery view
            if (view === 'gallery' && slug) {
                await fetchAndDisplayGallery(slug);
                renderSubscriptionStatus();
                
                // 🎯 NEW: Hide loader after content is ready
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
            
            // 🎯 NEW: Hide loader after content is ready
            hideAppLoader();
        } catch (error) {
            // Silently handle error without logging to console
            displayError("An error occurred while loading the page. Please try again.");
            hideAppLoader(); // Hide loader even on error
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
    
    // Add cleanup on page unload
    window.addEventListener('beforeunload', () => {
        cleanupAllVideoPlayers();
    });
}
    </script>
</body>
</html>