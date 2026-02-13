// Configuration - IMPORTANT: This MUST match your live backend URL
const API_BASE_URL = "https://api-gateway-96c7cdb8.kiaraoct34.workers.dev/api/v1";

// ============================================================================
// PHASE 1: MODULAR ARCHITECTURE
// ============================================================================

class AppState {
    constructor() {
        this.platforms = [];
        this.tiers = {};
        this.currentContent = null;
        this.filterState = { view: 'All', type: 'All', query: '' };
        this.searchScope = 'platforms';
        this.userInfo = null;
        this.subscriptions = [];
    }
    
    reset() {
        this.platforms = [];
        this.tiers = {};
        this.currentContent = null;
        this.filterState = { view: 'All', type: 'All', query: '' };
        this.userInfo = null;
        this.subscriptions = [];
    }
}

class AuthManager {
    constructor() {
        this.tokenKey = 'lustroom_jwt';
        this.expiresInKey = 'lustroom_jwt_expires_in';
        this.obtainedAtKey = 'lustroom_jwt_obtained_at';
    }
    
    isValid() {
        const token = localStorage.getItem(this.tokenKey);
        const obtainedAt = parseInt(localStorage.getItem(this.obtainedAtKey), 10);
        const expiresIn = parseInt(localStorage.getItem(this.expiresInKey), 10);
        
        if (!token || isNaN(obtainedAt) || isNaN(expiresIn)) return false;
        
        const nowInSeconds = Math.floor(Date.now() / 1000);
        return (obtainedAt + expiresIn - 60) > nowInSeconds;
    }
    
    logout() {
        localStorage.clear();
        if (window.cacheManager) {
            window.cacheManager.clearAll(); // ✅ Clear session cache
        }
        window.location.href = 'index.html';
    }
    
    getToken() {
        return localStorage.getItem(this.tokenKey);
    }
}

// ============================================================================
// CACHE MANAGER - Prevents Duplicate API Calls
// ============================================================================

class CacheManager {
    constructor() {
        this.cachePrefix = 'lustroom_cache_';
        this.profileCacheKey = this.cachePrefix + 'profile';
        this.profileFetchPromise = null; // For deduplication
        this.isFetchingProfile = false;
    }
    
    // ✅ Cache get_patron_links results per tier
    getCachedLinks(tierId) {
        const cacheKey = `${this.cachePrefix}links_tier_${tierId}`;
        const cached = sessionStorage.getItem(cacheKey);
        
        if (!cached) return null;
        
        try {
            const data = JSON.parse(cached);
            // Check if cache is still valid (5 minutes TTL)
            const age = Date.now() - (data.timestamp || 0);
            const FIVE_MINUTES = 5 * 60 * 1000;
            
            if (age < FIVE_MINUTES) {
                console.log(`✅ Cache HIT for tier ${tierId} (age: ${Math.round(age/1000)}s)`);
                return data.content;
            } else {
                console.log(`⏰ Cache EXPIRED for tier ${tierId}`);
                sessionStorage.removeItem(cacheKey);
                return null;
            }
        } catch (e) {
            console.error('Cache parse error:', e);
            sessionStorage.removeItem(cacheKey);
            return null;
        }
    }
    
    setCachedLinks(tierId, content) {
        const cacheKey = `${this.cachePrefix}links_tier_${tierId}`;
        try {
            const data = {
                content: content,
                timestamp: Date.now()
            };
            sessionStorage.setItem(cacheKey, JSON.stringify(data));
            console.log(`💾 Cached links for tier ${tierId}`);
        } catch (e) {
            console.error('Cache set error:', e);
        }
    }
    
    // ✅ Deduplicated profile fetcher (singleton pattern)
    async fetchProfile(token) {
        // If already fetching, return the existing promise
        if (this.isFetchingProfile && this.profileFetchPromise) {
            console.log('⚡ Profile fetch in progress, reusing promise...');
            return this.profileFetchPromise;
        }
        
        // Check cache first
        const cached = sessionStorage.getItem(this.profileCacheKey);
        if (cached) {
            try {
                const data = JSON.parse(cached);
                const age = Date.now() - (data.timestamp || 0);
                const TWO_MINUTES = 2 * 60 * 1000;
                
                if (age < TWO_MINUTES) {
                    console.log(`✅ Profile cache HIT (age: ${Math.round(age/1000)}s)`);
                    return data.profile;
                }
            } catch (e) {
                sessionStorage.removeItem(this.profileCacheKey);
            }
        }
        
        // Fetch fresh data
        console.log('🌐 Fetching fresh profile data...');
        this.isFetchingProfile = true;
        
        this.profileFetchPromise = fetch(`${API_BASE_URL}/profile`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                // Cache the result
                try {
                    sessionStorage.setItem(this.profileCacheKey, JSON.stringify({
                        profile: data,
                        timestamp: Date.now()
                    }));
                    console.log('💾 Profile cached');
                } catch (e) {
                    console.error('Profile cache error:', e);
                }
            }
            return data;
        })
        .finally(() => {
            this.isFetchingProfile = false;
            this.profileFetchPromise = null;
        });
        
        return this.profileFetchPromise;
    }
    
    // Clear all caches (call on logout)
    clearAll() {
        const keys = Object.keys(sessionStorage);
        keys.forEach(key => {
            if (key.startsWith(this.cachePrefix)) {
                sessionStorage.removeItem(key);
            }
        });
        console.log('🗑️ All caches cleared');
    }
}

// Global instances (initialized after DOM ready)
let appState = null;
let authManager = null;
let cacheManager = null; // ✅ NEW: Cache manager

// ✅ FIX #5: Make appState accessible via window for debugging and global scope fixes
if (typeof window !== 'undefined') {
    window.appState = null;
}

// State now managed by AppState class (see top of file)

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
        this.activeVideos = new Map(); // videoId -> { player, tierId, libraryId, timer, playerType }
        this.refreshInterval = 90000; // 90 seconds (refresh before 120s expiry)
    }

    registerVideo(videoId, player, tierId, libraryId) {
        // Clear existing timer if any
        if (this.activeVideos.has(videoId)) {
            clearInterval(this.activeVideos.get(videoId).timer);
        }

        // ✅ FIX: Detect player type
        const isVideoJS = player && typeof player.el === 'function';
        const isNativePlayer = player && player.videoElement !== undefined;
        const playerType = isVideoJS ? 'videojs' : (isNativePlayer ? 'native' : 'unknown');

        // Start refresh timer
        const timer = setInterval(() => {
            this.refreshVideoToken(videoId, tierId, libraryId, player, playerType);
        }, this.refreshInterval);

        this.activeVideos.set(videoId, { player, tierId, libraryId, timer, playerType });
    }

    async refreshVideoToken(videoId, tierId, libraryId, player, playerType) {
        try {
            // ✅ FIX: Validate player based on type
            if (playerType === 'videojs') {
                const isDisposed = player.isDisposed();
                const hasElement = player.el() !== null;
                if (!player || isDisposed || !hasElement) {
                    this.stopRefresh(videoId);
                    return;
                }
            } else if (playerType === 'native') {
                const hasVideoElement = player.videoElement && document.body.contains(player.videoElement);
                if (!player || !hasVideoElement) {
                    this.stopRefresh(videoId);
                    return;
                }
            } else {
                // Unknown player type - stop refresh
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
                // ✅ FIX: Double-check player validity before updating source
                if (playerType === 'videojs') {
                    const isDisposed2 = player.isDisposed();
                    const hasElement2 = player.el() !== null;
                    if (!player || isDisposed2 || !hasElement2) {
                        this.stopRefresh(videoId);
                        return;
                    }

                    // Video.js Logic
                    const currentTime = player.currentTime();
                    const wasPaused = player.paused();
                    
                    player.src({
                        src: data.url,
                        type: 'application/x-mpegURL'
                    });

                    // Restore playback state
                    player.one('loadedmetadata', () => {
                        if (!player || !player.el() || player.isDisposed()) return;
                        
                        player.currentTime(currentTime);
                        if (!wasPaused) {
                            player.play().catch(() => {
                                // Autoplay might be blocked - ignore error
                            });
                        }
                    });
                } else if (playerType === 'native') {
                    // ✅ FIX: Verify native player is still valid
                    const hasVideoElement = player.videoElement && document.body.contains(player.videoElement);
                    if (!player || !hasVideoElement) {
                        this.stopRefresh(videoId);
                        return;
                    }

                    const currentTime = player.videoElement.currentTime;
                    const wasPaused = player.videoElement.paused;

                    if (DeviceDetector.isIOS()) {
                        player.videoElement.src = data.url;
                    } else if (player.hlsInstance) {
                        player.hlsInstance.loadSource(data.url);
                    } else {
                        player.videoElement.src = data.url;
                    }

                    player.videoElement.addEventListener('loadedmetadata', () => {
                        if (!player.videoElement || !document.body.contains(player.videoElement)) return;
                        player.videoElement.currentTime = currentTime;
                        if (!wasPaused) player.videoElement.play().catch(() => {});
                    }, { once: true });
                }

            } else if (response.status === 403) {
                // Subscription expired
                this.stopRefresh(videoId);
                if (playerType === 'videojs') {
                    player.pause();
                    player.error({
                        code: 4,
                        message: 'Your subscription has expired. Please renew to continue.'
                    });
                } else if (playerType === 'native') {
                    alert('Your subscription has expired. Please renew to continue.');
                    if (player.close) player.close();
                }
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
        // ✅ FIX: Validate numeric tier ID exists
        const numericTierId = this.tierIdCache.get(videoId);
        if (!numericTierId) {
            console.warn(`Analytics: No tier ID mapping found for video ${videoId}. Skipping event: ${event}`);
            return; // Don't send analytics without valid tier ID
        }
        
        const sessionId = this.getSessionId(videoId);
        
        const eventData = {
            event: event,
            video_id: videoId,
            session_id: sessionId,
            tier_id: numericTierId,
            current_time: player ? (player.currentTime ? player.currentTime() : (player.currentTime ? player.currentTime() : 0)) : 0,
            duration: player ? (player.duration ? player.duration() : 0) : 0,
            quality: player ? this.getCurrentQuality(player) : 'auto'
        };

        this.batchQueue.push(eventData);

        // Send immediately for critical events
        if (event === 'play' || event === 'ended' || event === 'error') {
            this.sendBatch();
        }
    }

    getCurrentQuality(player) {
        // If it's a native player, we can't easily detect HLS quality without Hls.js API access
        // Assuming player is video.js if it has qualityLevels
        try {
            if (typeof player.qualityLevels === 'function') {
                const qualityLevels = player.qualityLevels();
                if (qualityLevels && qualityLevels.selectedIndex >= 0) {
                    const selected = qualityLevels[qualityLevels.selectedIndex];
                    return selected.height ? `${selected.height}p` : 'auto';
                }
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

// ============================================================================
// PHASE 2: PLAYER FACTORY ARCHITECTURE (INSERTED HERE)
// ============================================================================

// --- Device Detection Utility ---
class DeviceDetector {
    static isMobile() {
        const userAgent = navigator.userAgent || navigator.vendor || window.opera;
        
        // Check for mobile devices
        const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
        const isMobileUA = mobileRegex.test(userAgent);
        
        // Check for touch capability
        const hasTouch = ('ontouchstart' in window) || 
                           (navigator.maxTouchPoints > 0) || 
                           (navigator.msMaxTouchPoints > 0);
        
        // Check screen size (tablets and phones)
        const isSmallScreen = window.innerWidth <= 1024;
        
        return isMobileUA || (hasTouch && isSmallScreen);
    }
    
    static isIOS() {
        return /iPhone|iPad|iPod/i.test(navigator.userAgent);
    }
    
    static isAndroid() {
        return /Android/i.test(navigator.userAgent);
    }
}

// --- Native Mobile Player Class ---
class NativeMobilePlayer {
    constructor(link, tierId) {
        this.link = link;
        this.tierId = tierId;
        this.videoId = this.extractVideoID(link.url);
        this.libraryId = this.extractLibraryId(link.url);
        this.modal = null;
        this.videoElement = null;
        this.hlsInstance = null;
        this.numericTierId = link.tier_id || 1;
    }
    
    extractVideoID(url) {
        const match = url.match(/\/([a-f0-9-]{36})\//);
        return match ? match[1] : null;
    }
    
    extractLibraryId(url) {
        const match = url.match(/library_id=(\d+)/);
        return match ? match[1] : '555806';
    }
    
    open() {
        if (!this.videoId) return;
        
        // Register with analytics tracker
        analyticsTracker.setVideoTierMapping(this.videoId, this.numericTierId);
        
        // Create modal
        this.createModal();
        
        // Setup video
        this.setupVideo();
        
        // ✅ FIX: Register in active players map for proper cleanup
        const playerId = `nativePlayer_${this.videoId}`;
        activePlayers.set(playerId, { 
            player: this, 
            modal: this.modal,
            playerType: 'native'
        });
        
        // Register token refresh
        tokenRefreshManager.registerVideo(
            this.videoId, 
            this, // Pass 'this' so refresh manager can access videoElement and hlsInstance
            this.tierId, 
            this.libraryId
        );
    }
    
    createModal() {
        this.modal = document.createElement('div');
        this.modal.className = 'native-player-modal';
        this.modal.innerHTML = `
            <div class="native-player-content">
                <div class="native-player-header">
                    <button class="native-close-btn" aria-label="Close video">×</button>
                    <div class="native-video-title">${this.link.title}</div>
                </div>
                <div class="native-video-wrapper">
                    <video 
                        id="nativeVideo_${this.videoId}"
                        class="native-video"
                        controls
                        playsinline
                        webkit-playsinline
                        preload="metadata"
                    ></video>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.modal);
        document.body.classList.add('player-active');
        
        this.videoElement = document.getElementById(`nativeVideo_${this.videoId}`);
        
        // Setup close button
        this.modal.querySelector('.native-close-btn').addEventListener('click', () => {
            this.close();
        });
        
        // Handle video end for native
        this.videoElement.addEventListener('ended', () => {
            this.close();
        });
    }
    
    setupVideo() {
        const isIOS = DeviceDetector.isIOS();
        
        if (isIOS) {
            // iOS supports HLS natively
            this.videoElement.src = this.link.url;
        } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            // Android: Use Hls.js
            this.hlsInstance = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 90
            });
            
            this.hlsInstance.loadSource(this.link.url);
            this.hlsInstance.attachMedia(this.videoElement);
            
            this.hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                this.videoElement.play().catch(() => {
                    // Autoplay blocked - user will manually start
                });
            });
            
            this.hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    // ✅ FIX: Check for authentication errors
                    if (data.response && data.response.code === 403) {
                        this.showError('Your subscription has expired. Please renew to continue.');
                        setTimeout(() => this.close(), 3000);
                        return;
                    }

                    switch(data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            this.hlsInstance.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            this.hlsInstance.recoverMediaError();
                            break;
                        default:
                            this.showError('Playback error occurred');
                            break;
                    }
                }
            });
        } else {
            // Fallback: Try native playback
            this.videoElement.src = this.link.url;
        }
        
        // ✅ FIX: Add error listener for native playback too
        this.videoElement.addEventListener('error', (e) => {
            const error = this.videoElement.error;
            if (error && error.code === 4) {
                // MEDIA_ERR_SRC_NOT_SUPPORTED - could be expired token
                this.showError('Unable to load video. Your session may have expired.');
            }
        });
        
        // Attach analytics events
        this.attachAnalytics();
    }
    
    attachAnalytics() {
        // Wrap video element in an object structure compatible with tracker
        const playerWrapper = {
            currentTime: () => this.videoElement.currentTime,
            duration: () => this.videoElement.duration
        };

        const trackEvent = (eventName) => {
            analyticsTracker.trackEvent(
                this.videoId, 
                eventName, 
                playerWrapper, 
                this.tierId
            );
        };
        
        this.videoElement.addEventListener('play', () => trackEvent('play'));
        this.videoElement.addEventListener('pause', () => trackEvent('pause'));
        this.videoElement.addEventListener('ended', () => trackEvent('ended'));
        
        // Throttled timeupdate tracking
        let lastTrackedTime = 0;
        this.videoElement.addEventListener('timeupdate', () => {
            const currentTime = this.videoElement.currentTime;
            if (currentTime - lastTrackedTime >= 5) {
                trackEvent('timeupdate');
                lastTrackedTime = currentTime;
            }
        });
    }
    
    showError(message) {
        if (this.modal) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'native-player-error';
            errorDiv.style.cssText = "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 20px; border-radius: 8px; text-align: center;";
            errorDiv.textContent = message;
            this.modal.querySelector('.native-video-wrapper').appendChild(errorDiv);
        }
    }
    
    close() {
        // Clear session tracking
        analyticsTracker.clearSession(this.videoId);
        
        // Stop token refresh
        tokenRefreshManager.stopRefresh(this.videoId);
        
        // ✅ FIX: Remove from active players registry
        const playerId = `nativePlayer_${this.videoId}`;
        activePlayers.delete(playerId);
        
        // Cleanup HLS
        if (this.hlsInstance) {
            this.hlsInstance.destroy();
            this.hlsInstance = null;
        }
        
        // ✅ FIX: Remove error listeners
        if (this.videoElement) {
            this.videoElement.removeEventListener('error', null);
        }
        
        // Remove modal
        if (this.modal && this.modal.parentNode) {
            this.modal.remove();
        }
        
        document.body.classList.remove('player-active');
    }
}

// --- Desktop Player Class (Wrapper for existing openVideoPlayer logic) ---
class DesktopPlayer {
    constructor(link, tierId) {
        this.link = link;
        this.tierId = tierId;
    }
    
    open() {
        // Call the existing openVideoPlayer function
        // We'll keep it as-is for now since it works perfectly on desktop
        openVideoPlayer(this.link, this.tierId);
    }
}

// --- Player Factory ---
class PlayerFactory {
    static create(link, tierId) {
        const isMobile = DeviceDetector.isMobile();
        
        if (isMobile) {
            const player = new NativeMobilePlayer(link, tierId);
            player.open();
            return player;
        } else {
            const player = new DesktopPlayer(link, tierId);
            player.open();
            return player;
        }
    }
}

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
                const playIcon = this.elements.playBtn.querySelector('.play-icon');
                const pauseIcon = this.elements.playBtn.querySelector('.pause-icon');
                
                if (isPlaying) {
                    // Show pause icon, hide play icon
                    if (playIcon) playIcon.style.display = 'none';
                    if (pauseIcon) pauseIcon.style.display = 'block';
                    this.elements.playBtn.setAttribute('aria-label', 'Pause');
                } else {
                    // Show play icon, hide pause icon
                    if (playIcon) playIcon.style.display = 'block';
                    if (pauseIcon) pauseIcon.style.display = 'none';
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
        
        const volumeHigh = this.elements.volumeBtn.querySelector('.volume-high');
        const volumeLow = this.elements.volumeBtn.querySelector('.volume-low');
        const volumeMute = this.elements.volumeBtn.querySelector('.volume-mute');
        
        // Hide all icons first
        if (volumeHigh) volumeHigh.style.display = 'none';
        if (volumeLow) volumeLow.style.display = 'none';
        if (volumeMute) volumeMute.style.display = 'none';
        
        if (muted || volume === 0) {
            // Show mute icon
            if (volumeMute) volumeMute.style.display = 'block';
            this.elements.volumeBtn.setAttribute('aria-label', 'Unmute');
        } else if (volume < 0.5) {
            // Show low volume icon
            if (volumeLow) volumeLow.style.display = 'block';
            this.elements.volumeBtn.setAttribute('aria-label', 'Mute');
        } else {
            // Show high volume icon
            if (volumeHigh) volumeHigh.style.display = 'block';
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
        appState.userInfo = JSON.parse(localStorage.getItem('user_info') || 'null');
        appState.subscriptions = JSON.parse(localStorage.getItem('user_subscriptions') || '[]');
        return true;
    } catch (error) {
        appState.userInfo = null;
        appState.subscriptions = [];
        return false;
    }
}

// --- Subscription Status Renderer ---
// --- Subscription Status Renderer (V3 MULTI-SUBSCRIPTION) ---
// ✅ FIX #4: Fix renderSubscriptionStatus Scope
function renderSubscriptionStatus() {
    const subscriptionStatusDiv = document.getElementById('subscriptionStatus');
    if (!subscriptionStatusDiv) return;

    // ✅ FIX: Use global appState safely
    const subscriptions = (window.appState || appState || {}).subscriptions || [];

    if (subscriptions.length === 0) {
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
        subscriptions.forEach(sub => {
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
            badge.style.cssText = "background: #e3f2fd; color: #0d47a1; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem; border: 1px solid #bbdefb;";
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
// ✅ FIX #3: Fix renderRenewalBanner Scope
function renderRenewalBanner() {
    const existingBanner = document.getElementById('renewalBanner');
    if (existingBanner) {
        existingBanner.remove();
    }

    // ✅ FIX: Use global appState safely
    const subscriptions = (window.appState || appState || {}).subscriptions || [];
    
    if (subscriptions.length === 0) return;

    // Find ALL expiring subscriptions first
    const expiringSubscriptions = subscriptions.filter(sub => {
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
        banner.style.cssText = "background: #fff3cd; color: #856404; padding: 10px; border-radius: 4px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #ffeeba;";
        banner.innerHTML = `
            <span>Your access expires in ${days} day${days !== 1 ? 's' : ''}. Please renew to maintain access.</span>
            <a href="${renewalUrl}" target="_blank" class="renew-button" style="background: #ffc107; color: #000; padding: 5px 10px; border-radius: 3px; text-decoration: none; font-weight: bold;">Renew Now</a>
        `;
        
        const appContainer = document.getElementById('appContainer');
        if (appContainer) {
            // Prepend banner inside the container but after the header
            appContainer.querySelector('header').after(banner);
        }
    }
}

// ✅ FIX #2: Fix renderHeaderActions Scope
async function renderHeaderActions() {
    // --- 1. Handle Support Link with Priority Logic ---
    let supportUrl = null;
    
    // ✅ FIX: Use global appState safely
    const subscriptions = (window.appState || appState || {}).subscriptions || [];
    
    if (subscriptions.length > 0) {
        // ✅ PRIORITY LOGIC: Try to find Echo Chamber support URL first
        const echoChamberSub = subscriptions.find(sub => sub.platform_name === 'Echo Chamber' && sub.support_url);
        if (echoChamberSub) {
            supportUrl = echoChamberSub.support_url;
        } else {
            // Fallback: find the first subscription that has a support URL
            const fallbackSub = subscriptions.find(sub => sub.support_url);
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

            // ✅ USE CACHE MANAGER: Deduplicated profile fetch
            const data = await cacheManager.fetchProfile(token);
            
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
                    // ✅ USE CACHE MANAGER: Deduplicated profile fetch
                    const profileData = await cacheManager.fetchProfile(data.access_token);
                    
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

// ============================================================================
// ROUTER CLASS - Handles navigation and view rendering
// ============================================================================

class Router {
    constructor(appState, authManager, uiManager, announcementSlider) {
        this.appState = appState;
        this.authManager = authManager;
        this.uiManager = uiManager;
        this.announcementSlider = announcementSlider; // ✅ NEW
        this.mainContent = document.getElementById('mainContent');
        this.searchContainer = document.getElementById('searchContainer');
        this.searchInput = document.getElementById('searchInput');
    }
    
    async navigate() {
        // Clean up any existing video players before loading new content
        cleanupAllVideoPlayers();
        
        // Load user data at the start of navigation
        loadUserData();
        
        // ✅ FIX #6: Add Safety Check in Router.navigate
        if (!this.appState || !window.appState) {
            console.error("❌ AppState not initialized!");
            this.uiManager.showError("Application state error. Please refresh the page.");
            return;
        }

        // Handle app loader visibility
        const appLoader = document.getElementById('app-loader');
        const appContainer = document.getElementById('appContainer');
        
        const hideAppLoader = () => {
            if (appLoader && appContainer) {
                appLoader.style.opacity = '0';
                appContainer.style.display = 'block';
                setTimeout(() => {
                    appLoader.remove();
                }, 400);
            }
        };
        
        // Start session refresh manager
        if (!sessionRefreshManager.refreshTimer) {
            sessionRefreshManager.start();
        }
        
        // Load and display announcements
        const announcementsData = JSON.parse(localStorage.getItem('global_announcements') || '[]');
        if (this.announcementSlider) {
            this.announcementSlider.showAnnouncements(announcementsData);
        }
        
        // Render renewal banner and header actions
        renderRenewalBanner();
        await renderHeaderActions();

        if (!this.authManager.isValid()) {
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
                await this.fetchAndDisplayGallery(slug);
                renderSubscriptionStatus();
                hideAppLoader();
                return;
            }

            if (view === 'tiers' || view === 'content') {
                await this.ensurePlatformsData();
            }

            if (view === 'tiers' && platformId) {
                await this.ensureTiersData(platformId);
            }

            if (view === 'content') {
                await this.ensureTiersData(platformId);
            }

            const platformData = this.appState.platforms.find(p => p.id.toString() === platformId);
            const platformName = platformData?.name;
            const tierData = this.appState.tiers[platformId]?.find(t => t.id.toString() === tierId);
            const tierName = tierData?.name;

            if (view === 'content' && platformId && tierId) {
                this.appState.searchScope = 'content';
                await this.fetchAndDisplayContent(platformId, tierId, tierName, platformName);
            } else if (view === 'tiers' && platformId) {
                this.appState.searchScope = 'tiers';
                this.uiManager.renderTierSkeleton(platformName);
                this.fetchAndDisplayTiers(platformId, platformName);
            } else {
                this.appState.searchScope = 'platforms';
                this.uiManager.renderPlatformSkeleton();
                const platformsData = await this.ensurePlatformsData();
                this.uiManager.renderPlatforms(platformsData);
            }

            if (this.searchInput) {
                this.searchInput.value = '';
                this.appState.filterState.query = '';
            }

            renderSubscriptionStatus();
            hideAppLoader();
        } catch (error) {
            // ✅ FIX #1: Enable Error Logging (CRITICAL - Do This First!)
            console.error("❌ ROUTER NAVIGATION ERROR:", error);
            console.error("Stack trace:", error.stack);
            
            window.appRouter.uiManager.showError("An error occurred while loading the page. Please try again.");
            hideAppLoader();
        }
    }
    
    handlePopState() {
        this.navigate();
    }

    // ✅ NEW: Data fetching methods moved into Router class
    async ensurePlatformsData() {
        if (this.appState.platforms.length > 0) {
            return Promise.resolve(this.appState.platforms);
        }

        const response = await fetch(`${API_BASE_URL}/platforms`);
        const data = await response.json();

        if (response.ok && data.status === 'success' && data.platforms) {
            this.appState.platforms = data.platforms;
            return this.appState.platforms;
        } else {
            throw new Error(data.message || "Failed to fetch platforms.");
        }
    }

    async ensureTiersData(platformId) {
        if (this.appState.tiers[platformId]) {
            return Promise.resolve(this.appState.tiers[platformId]);
        }

        const token = this.authManager.getToken();
        const response = await fetch(`${API_BASE_URL}/platforms/${platformId}/tiers`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (response.ok && data.status === 'success' && data.tiers) {
            this.appState.tiers[platformId] = data.tiers;
            return this.appState.tiers[platformId];
        } else {
            throw new Error(data.message || "Failed to fetch tiers.");
        }
    }
    
    // ✅ NEW: Click handler methods
    handlePlatformClick(event) {
        const card = event.target.closest('.platform-card');
        if (!card) return;
        
        // Safety check
        if (!this.appState.platforms || this.appState.platforms.length === 0) {
            console.error("Platforms data not loaded");
            return;
        }

        const platformId = card.dataset.platformId;
        const platformData = this.appState.platforms.find(p => p.id.toString() === platformId);

        if (card.classList.contains('locked')) {
            // Show modal for locked platforms
            showPlatformModal(platformData);
        } else {
            // Navigate to tiers
            history.pushState({view: 'tiers', platformId}, '', `?view=tiers&platform_id=${platformId}`);
            this.navigate();
        }
    }

    handleTierClick(event, platformId) {
        const card = event.target.closest('.tier-card');
        if (!card) return;
        
        const tierId = card.dataset.tierId;
        
        // Check if tier is locked
        if (card.classList.contains('locked')) {
            // Don't navigate if locked
            return;
        }
        
        history.pushState({view: 'content', platformId, tierId}, '', `?view=content&platform_id=${platformId}&tier_id=${tierId}`);
        this.navigate();
    }

    // ✅ NEW: Content fetching method
    async fetchAndDisplayContent(platformId, tierId, tierName, platformName) {
        this.appState.searchScope = 'content';
        this.uiManager.renderContentSkeleton(tierName, platformName);
        
        try {
            const token = this.authManager.getToken();
            
            // ✅ CACHE CHECK: Try to get from cache first
            let data = null;
            const cachedContent = cacheManager.getCachedLinks(tierId);
            
            if (cachedContent) {
                // Use cached data
                data = { status: 'success', content: cachedContent };
            } else {
                // Fetch fresh data
                const response = await fetch(`${API_BASE_URL}/get_patron_links?tier_id=${tierId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                data = await response.json();
                
                // ✅ CACHE SET: Save to cache if successful
                // Only cache if we actually made a network request (response exists)
                if (data && data.status === 'success' && data.content) {
                    cacheManager.setCachedLinks(tierId, data.content);
                }
            }
            
            if (data && data.status === 'success' && data.content) {
                this.appState.currentContent = data.content;
                this.appState.filterState = { view: 'All', type: 'All', query: '' };

                // Build content HTML
                this.mainContent.innerHTML = `
                    <div class="view-header">
                        <button id="backButton" class="back-button">← Back to Tiers</button>
                        <h2>${tierName} <span class="header-breadcrumb">/ ${platformName}</span></h2>
                    </div>
                    <div id="filterContainer" class="filter-container"></div>
                    <div id="linksContentContainer"></div>`;

                this.searchContainer.style.display = 'block';
                this.searchInput.placeholder = `Search in ${tierName || 'Content'}`;
                this.searchInput.value = '';
                
                // Attach back button listener
                const backButton = document.getElementById('backButton');
                if (backButton) {
                    backButton.addEventListener('click', () => {
                        history.pushState({view: 'tiers', platformId}, '', `?view=tiers&platform_id=${platformId}`);
                        this.navigate();
                    });
                }
                
                // Render content
                renderContent(data.content, platformId);
                
                // Setup filters
                setupFilters(data.content);
                
                // Setup copy buttons
                setupCopyButtonDelegation();
                
            } else {
                // Check if we have a response object (network request was made)
                if (typeof response !== 'undefined' && (response.status === 401 || response.status === 403)) {
                    localStorage.clear();
                    window.location.href = 'login.html';
                } else {
                    this.uiManager.showError(data?.message || "Failed to fetch content.");
                }
            }
        } catch (error) {
            console.error("Content fetch error:", error);
            this.uiManager.showError("An error occurred while fetching content.");
        }
    }
    
    // ✅ NEW: Tiers display method
    fetchAndDisplayTiers(platformId, platformName) {
        this.appState.searchScope = 'tiers';
        
        // Ensure tiers are loaded
        if (!this.appState.tiers[platformId]) {
            console.error("Tiers not loaded for platform:", platformId);
            this.uiManager.showError("Unable to load tiers. Please try again.");
            return;
        }
        
        const tiersData = this.appState.tiers[platformId];

        if (!tiersData || !Array.isArray(tiersData)) {
            this.uiManager.showError("Unable to load tiers for this platform.");
            return;
        }

        this.uiManager.renderTiers(tiersData, platformId, platformName);
    }

    // ✅ NEW: Gallery fetching method
    async fetchAndDisplayGallery(slug) {
        this.uiManager.renderGallerySkeleton();
        
        try {
            const token = this.authManager.getToken();
            const response = await fetch(`${API_BASE_URL}/gallery/${slug}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            
            if (response.ok && data.status === 'success' && data.gallery) {
                this.uiManager.renderGallery(data.gallery);
            } else if (response.status === 401 || response.status === 403) {
                localStorage.clear();
                window.location.href = 'login.html';
            } else {
                this.uiManager.showError(data.message || "Failed to fetch gallery.");
            }
        } catch (error) {
            console.error("Gallery fetch error:", error);
            this.uiManager.showError("An error occurred while fetching the gallery.");
        }
    }
}  // <-- End of Router class

// ============================================================================
// UI MANAGER CLASS - Handles all rendering logic
// ============================================================================

class UIManager {
    constructor(appState, mainContent, searchContainer) {
        this.appState = appState;
        this.mainContent = mainContent;
        this.searchContainer = searchContainer;
    }
    
    showError(message, container = this.mainContent) {
        container.innerHTML = `<div class="error-message">${message}</div>`;
    }
    
    renderPlatformSkeleton() {
        let skeletonHTML = '<h2>Platforms</h2><div class="platforms-grid">';
        for (let i = 0; i < 3; i++) {
            skeletonHTML += `<div class="platform-card-skeleton"><div class="skeleton skeleton-platform-thumbnail"></div><div class="skeleton skeleton-platform-title"></div></div>`;
        }
        skeletonHTML += '</div>';
        this.mainContent.innerHTML = skeletonHTML;
        this.searchContainer.style.display = 'none';
    }
    
    renderTierSkeleton(platformName) {
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
        this.mainContent.innerHTML = skeletonHTML;
        this.searchContainer.style.display = 'block';
    }
    
    renderContentSkeleton(tierName, platformName) {
        let skeletonHTML = `
            <div class="view-header">
                <button id="backButton" class="back-button">← Back to Tiers</button>
                <h2>${tierName || 'Content'} <span class="header-breadcrumb">/ ${platformName}</span></h2>
            </div>`;
        for (let i = 0; i < 2; i++) {
            skeletonHTML += `<div class="tier-group"><div class="skeleton skeleton-title"></div><div class="skeleton-card"><div class="skeleton skeleton-thumbnail"></div><div class="skeleton-card-content"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text short"></div></div></div></div>`;
        }
        this.mainContent.innerHTML = skeletonHTML;
        this.searchContainer.style.display = 'block';
    }
    
    renderGallerySkeleton() {
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
        this.mainContent.innerHTML = skeletonHTML;
        this.searchContainer.style.display = 'none';
    }
    
    renderPlatforms(platforms) {
        let platformsHTML = '<div class="platforms-grid">';
        platforms.forEach(platform => {
            const hasSubscription = this.appState.subscriptions.some(sub => sub.platform_id === platform.id);
            platformsHTML += `<div class="platform-card ${!hasSubscription ? 'locked' : ''}" data-platform-id="${platform.id}"><div class="platform-thumbnail" style="background-image: url('${platform.thumbnail_url || ''}')"></div><div class="platform-name">${platform.name}</div>${!hasSubscription ? '<div class="lock-icon">🔒</div>' : ''}</div>`;
        });
        platformsHTML += '</div>';

        let welcomeHTML = '';
        if (this.appState.userInfo && this.appState.userInfo.name) {
            welcomeHTML = `<div class="welcome-message">Welcome back, ${this.appState.userInfo.name}!</div>`;
        }

        this.mainContent.innerHTML = welcomeHTML + '<h2>Platforms</h2>' + platformsHTML;
        this.searchContainer.style.display = 'none';
        
        // ✅ NEW: Attach click listener to platforms grid
        const platformsGrid = this.mainContent.querySelector('.platforms-grid');
        if (platformsGrid) {
            platformsGrid.addEventListener('click', (e) => {
                if (window.appRouter) {
                    window.appRouter.handlePlatformClick(e);
                }
            });
        }
    }
    
    renderTiers(tiers, platformId, platformName) {
        if (!tiers || !Array.isArray(tiers)) {
            this.showError("No tiers data available for this platform.");
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
        this.mainContent.innerHTML = tiersHTML;
        this.searchContainer.style.display = 'block';
        
        // ✅ NEW: Attach click listener to tiers grid
        const tiersGrid = this.mainContent.querySelector('.tiers-grid');
        if (tiersGrid) {
            tiersGrid.addEventListener('click', (e) => {
                if (window.appRouter) {
                    window.appRouter.handleTierClick(e, platformId);
                }
            });
        }
        
        // ✅ NEW: Attach back button listener
        const backButton = document.getElementById('backButton');
        if (backButton) {
            backButton.addEventListener('click', () => {
                history.pushState({view: 'platforms'}, '', 'links.html');
                if (window.appRouter) {
                    window.appRouter.navigate();
                }
            });
        }
    }

    // 📦 DELIVERABLE 2: Updated renderGallery() Method
    renderGallery(galleryData) {
        this.mainContent.innerHTML = `
            <div class="view-header">
                <button id="backButton" class="back-button">← Back</button>
                <h2>${galleryData.title} <span class="header-breadcrumb">/ ${galleryData.platform_name}</span></h2>
            </div>
            <div class="gallery-container">
                <div class="gallery-info" style="margin-bottom: 20px;">
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
            item.dataset.index = index;
            
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
            };
            tempImg.src = image.url;
            
            const img = document.createElement('img');
            img.src = image.url;
            img.alt = image.title || `Image ${index + 1}`;
            img.loading = index < 3 ? 'eager' : 'lazy'; // Eager load first 3 images
            
            const caption = document.createElement('div');
            caption.className = 'gallery-caption';
            caption.style.display = 'none';
            caption.textContent = image.title || `Image ${index + 1}`;
            
            linkElement.appendChild(img);
            linkElement.appendChild(caption);
            item.appendChild(linkElement);
            galleryGrid.appendChild(item);
        });
        
        // ✅ NEW: Detect mobile and use native gallery
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        if (isMobile) {
            // Initialize native mobile gallery
            setTimeout(() => {
                this.initNativeMobileGallery(galleryData);
            }, 100);
        } else {
            // Initialize PhotoSwipe for desktop
            setTimeout(() => {
                this.initPhotoSwipe(galleryData);
            }, 500);
        }
        
        // Add back button listener
        const backButton = document.getElementById('backButton');
        if (backButton) {
            backButton.addEventListener('click', () => {
                history.back();
            });
        }
    }

    // 📦 DELIVERABLE 3: New Native Mobile Gallery Method
    initNativeMobileGallery(galleryData) {
        const galleryGrid = document.getElementById('galleryGrid');
        if (!galleryGrid) return;
        
        // Show captions on mobile
        galleryGrid.querySelectorAll('.gallery-caption').forEach(caption => {
            caption.style.display = 'block';
        });
        
        // Add counter overlay
        const counter = document.createElement('div');
        counter.className = 'mobile-gallery-counter';
        counter.textContent = `1 / ${galleryData.images.length}`;
        document.body.appendChild(counter);
        
        // Add swipe hint (shows once for 3 seconds)
        const hint = document.createElement('div');
        hint.className = 'mobile-gallery-hint';
        hint.textContent = '← Swipe to browse →';
        document.body.appendChild(hint);
        
        // Remove hint after animation
        setTimeout(() => {
            if (hint.parentNode) hint.remove();
        }, 3000);
        
        // ✅ Use IntersectionObserver to track which image is visible
        const observerOptions = {
            root: galleryGrid,
            threshold: 0.5 // Image must be 50% visible to count
        };
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const index = parseInt(entry.target.dataset.index) + 1;
                    counter.textContent = `${index} / ${galleryData.images.length}`;
                }
            });
        }, observerOptions);
        
        // Observe all gallery items
        galleryGrid.querySelectorAll('.gallery-item').forEach(item => {
            observer.observe(item);
        });
        
        // ✅ Tap to enter fullscreen zoom mode
        galleryGrid.querySelectorAll('.gallery-item img').forEach((img, index) => {
            img.style.pointerEvents = 'auto'; // Re-enable pointer events for tapping
            img.addEventListener('click', (e) => {
                e.preventDefault();
                this.openMobileFullscreen(galleryData.images[index]);
            });
        });
        
        // Cleanup on navigation
        window.addEventListener('popstate', () => {
            if (counter.parentNode) counter.remove();
            observer.disconnect();
        }, { once: true });
    }

    // 📦 DELIVERABLE 3: Helper for Native Mobile Gallery
    openMobileFullscreen(image) {
        // Create fullscreen modal
        const modal = document.createElement('div');
        modal.className = 'mobile-gallery-fullscreen active';
        modal.innerHTML = `
            <button class="mobile-fullscreen-close" aria-label="Close fullscreen">×</button>
            <img src="${image.url}" alt="${image.title || 'Image'}" />
        `;
        
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        // Close button
        const closeBtn = modal.querySelector('.mobile-fullscreen-close');
        closeBtn.addEventListener('click', () => {
            modal.remove();
            document.body.style.overflow = '';
        });
        
        // Tap outside image to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                document.body.style.overflow = '';
            }
        });
    }

    // 📦 DELIVERABLE 4: Update initPhotoSwipe() - Desktop Only
    initPhotoSwipe(galleryData) {
        // ✅ SKIP PhotoSwipe on mobile - native gallery handles it
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile) return;

        // Check if PhotoSwipe is loaded
        if (typeof PhotoSwipeLightbox === 'undefined') {
            console.error('PhotoSwipe library not loaded');
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
            
            // Track which images are viewed
            let viewedImageIndexes = new Set();
            let gallerySlugForTracking = null;
            
            // Get slug from URL
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('view') === 'gallery') {
                gallerySlugForTracking = urlParams.get('slug');
            }

            // Track image views
            lightbox.on('change', () => {
                if (lightbox.pswp) {
                    const currentIndex = lightbox.pswp.currIndex;
                    viewedImageIndexes.add(currentIndex);
                }
            });

            // Send tracking data when gallery is closed
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
                        }).catch(() => {});
                    }
                }
                
                viewedImageIndexes.clear();
                gallerySlugForTracking = null;
            });
            
            // Desktop: Auto-hide on mouse idle
            let uiHideTimeout;
            
            lightbox.on('afterInit', function() {
                const pswpElement = lightbox.pswp.element;
                
                const showUI = () => {
                    pswpElement.classList.add('pswp--ui-visible');
                    pswpElement.classList.remove('pswp--ui-hidden');
                    
                    if (uiHideTimeout) clearTimeout(uiHideTimeout);
                    
                    uiHideTimeout = setTimeout(() => {
                        pswpElement.classList.remove('pswp--ui-visible');
                        pswpElement.classList.add('pswp--ui-hidden');
                    }, 3000);
                };
                
                pswpElement.addEventListener('mousemove', showUI);
                pswpElement.addEventListener('click', showUI);
                showUI();
            });
            
            lightbox.on('uiRegister', function() {
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
                
                // ✅ Only show play button on desktop
                let slideshowInterval = null;
                let isPlaying = false;
                
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
                
                lightbox.on('close', function() {
                    if (slideshowInterval) {
                        clearInterval(slideshowInterval);
                        isPlaying = false;
                    }
                });
            });
            
            lightbox.init();
        } catch (error) {
            console.error('PhotoSwipe initialization error:', error);
        }
    }
}

// Keep the old router function as a wrapper (for backward compatibility)
async function router() {
    if (window.appRouter) {
        await window.appRouter.navigate();
    }
}

// --- Logic for links.html (The main application view) ---
if (document.getElementById('appContainer')) {
    // ✅ PHASE 1: Initialize modular architecture
    appState = new AppState();
    // ✅ FIX #5: Make globally accessible
    window.appState = appState; 
    
    authManager = new AuthManager();
    cacheManager = new CacheManager(); // ✅ NEW: Initialize cache manager
    window.cacheManager = cacheManager; // Make globally accessible
    
    const mainContent = document.getElementById('mainContent');
    const searchContainer = document.getElementById('searchContainer');
    
    // ✅ Initialize Theme Manager
    const themeManager = new ThemeManager();

    // ✅ Initialize Announcement Slider
    const announcementSlider = new AnnouncementSlider('#announcementSliderContainer');
    
    // ✅ Initialize UIManager
    const uiManager = new UIManager(appState, mainContent, searchContainer);

    // ✅ Initialize Router (now with announcementSlider)
    window.appRouter = new Router(appState, authManager, uiManager, announcementSlider);

    const logoutButton = document.getElementById('logoutButton');
    const searchInput = document.getElementById('searchInput');

    // --- Utility Functions ---
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
        appState.filterState.query = query;

        const emptyMessage = document.getElementById('searchEmptyMessage');
        if (emptyMessage && query === '') {
            emptyMessage.remove();
        }

        if (appState.searchScope === 'tiers') {
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
                link.style.marginRight = '10px';
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
                    }
                    const thumbnailImage = document.createElement('img');
                    thumbnailImage.src = link.thumbnail_url;
                    thumbnailImage.alt = `Thumbnail for ${link.title}`;
                    thumbnailImage.loading = 'lazy';
                    thumbnailContainer.appendChild(thumbnailImage);
                    
                    // NEW: Add click handler for video playback
                    if (!isGallery && !link.locked) {
                        thumbnailContainer.style.cursor = 'pointer';
                        // ✅ UPDATED: Use PlayerFactory for thumbnail click
                        thumbnailContainer.addEventListener('click', () => {
                            PlayerFactory.create(link, tierName);
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
                    newBadgeText.style.cssText = "background: #ff3b30; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 8px;";
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
                        // --- NEW: Add a "View Gallery" button ---
                        const viewButton = document.createElement('a');
                        viewButton.className = 'view-gallery-btn';
                        viewButton.style.cssText = "display: block; text-align: center; background: #e3f2fd; color: #007aff; padding: 8px; border-radius: 4px; text-decoration: none; font-weight: 500;";
                        viewButton.textContent = '🖼️ View Gallery';
                        viewButton.href = `links.html?view=gallery&slug=${link.url}`;
                        actionsContainer.appendChild(viewButton);
                    } else {
                        // NEW: Watch Video button
                        const watchButton = document.createElement('button');
                        watchButton.className = 'watch-video-btn';
                        watchButton.textContent = '▶️ Watch Video';
                        // ✅ UPDATED: Use PlayerFactory for button click
                        watchButton.addEventListener('click', () => {
                            PlayerFactory.create(link, tierName);
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
            appState.filterState.view = filterValue;
            document.querySelectorAll('.view-filter').forEach(btn => btn.classList.remove('active'));
        } else if (filterType === 'type') {
            appState.filterState.type = filterValue;
            document.querySelectorAll('.type-filter').forEach(btn => btn.classList.remove('active'));
        }

        event.target.classList.add('active');
        applyFilters();
    }

    // --- Apply filters with search support ---
    function applyFilters() {
        const { view, type, query } = appState.filterState;

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

    function addBackButtonListener(backTo, platformId = null) {
        const backButton = document.getElementById('backButton');
        if (!backButton) return;
        backButton.onclick = () => {
            if (backTo === 'tiers') {
                history.pushState({view: 'tiers', platformId}, '', `?view=tiers&platform_id=${platformId}`);
                window.appRouter.navigate();
            } else if (backTo === 'platforms') {
                history.pushState({view: 'platforms'}, '', `links.html`);
                window.appRouter.navigate();
            } else if (backTo === 'history') {
                // Use history.back() for gallery view
                history.back();
            }
        };
    }

    // --- PREMIUM VIDEO PLAYER (PRODUCTION v2.1 MOBILE FIX) ---
    // Note: This function is now primarily called by DesktopPlayer via the Factory.
    function openVideoPlayer(link, tierId) {
        // Extract video ID and library ID
        const videoIdMatch = link.url.match(/\/([a-f0-9-]{36})\//);
        if (!videoIdMatch) return;
        
        const videoId = videoIdMatch[1];
        const libraryIdMatch = link.url.match(/library_id=(\d+)/);
        const libraryId = libraryIdMatch ? libraryIdMatch[1] : '555806';
        
        // ✅ FIX 1: Detect mobile device (Note: Factory handles this, but kept here for safety if called directly)
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
                <div class="player-loading-overlay" style="position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:5; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white;">
                    <div class="player-spinner" style="width:40px; height:40px; border:4px solid #f3f3f3; border-top:4px solid #3498db; border-radius:50%; animation:spin 1s linear infinite;"></div>
                    <div class="player-loading-text" style="margin-top:10px;">Loading video...</div>
                </div>
                
                <!-- Error Overlay -->
                <div class="player-error-overlay" style="position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:6; display:none; flex-direction:column; align-items:center; justify-content:center; color:white;">
                    <div class="player-error-content" style="text-align:center;">
                        <div class="player-error-icon" style="font-size:3rem; margin-bottom:10px;">⚠️</div>
                        <div class="player-error-title" style="font-size:1.5rem; font-weight:bold; margin-bottom:10px;">Playback Error</div>
                        <div class="player-error-message" style="margin-bottom:20px;">We're having trouble playing this video. Please try again.</div>
                        <div class="player-error-actions">
                            <button class="player-error-btn player-error-btn-primary retry-btn" style="background:#007aff; color:white; border:none; padding:10px 20px; border-radius:4px; cursor:pointer; margin:5px;">Retry</button>
                            <button class="player-error-btn player-error-btn-secondary close-error-btn" style="background:transparent; color:white; border:1px solid white; padding:10px 20px; border-radius:4px; cursor:pointer; margin:5px;">Close</button>
                        </div>
                    </div>
                </div>
                
                <!-- Top Header -->
                <div class="premium-player-header" style="position:absolute; top:0; left:0; width:100%; height:50px; background:linear-gradient(to bottom, rgba(0,0,0,0.8), transparent); z-index:2; display:flex; align-items:center; padding:0 15px; box-sizing:border-box; transition:opacity 0.3s;">
                    <button class="premium-close-btn" aria-label="Close video player">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                    <div class="premium-video-title" style="flex:1; margin-left:10px; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:white;">${link.title}</div>
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
                    <div class="premium-gesture-indicator" style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); font-size:3rem; color:white; opacity:0; pointer-events:none; transition:opacity 0.2s;"></div>
                    
                    <!-- Quality/Speed Change Indicator -->
                    <div class="premium-change-indicator" style="position:absolute; top:60%; left:50%; transform:translate(-50%, -50%); background:rgba(0,0,0,0.7); color:white; padding:8px 16px; border-radius:20px; font-size:14px; opacity:0; pointer-events:none; transition:opacity 0.2s;"></div>
                </div>
                
                <!-- Custom Controls -->
                <div class="premium-controls-wrapper">
                    <div class="premium-controls-bg"></div>
                    
                    <!-- Progress Bar -->
                    <div class="premium-progress-container">
                        <div class="premium-progress-bar" role="slider" aria-label="Video progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
                            <div class="premium-progress-buffered"></div>
                            <div class="premium-progress-played"></div>
                            <div class="premium-progress-handle" style="position:absolute; top:50%; width:12px; height:12px; background:#fff; border-radius:50%; transform:translate(-50%, -50%); margin-top:-1px;"></div>
                            <div class="premium-progress-thumbnail" style="display: none; position:absolute; bottom:20px; left:0; background:#000; border:2px solid #fff; padding:2px;">
                                <div class="premium-thumbnail-time" style="color:white; font-size:12px;">0:00</div>
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
                            <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor" style="display:none;">
                                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                            </svg>
                        </button>
                        
                        <!-- Skip Backward 10s -->
                        <button class="premium-control-btn premium-skip-backward premium-skip-btn" aria-label="Rewind 10 seconds">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                                <path d="M12 5V2.21c0-.45-.54-.67-.85-.35l-3.8 3.79c-.2.2-.2.51 0 .71l3.79 3.79c.32.31.86.09.86-.36V7c3.73 0 6.68 3.42 5.86 7.29-.47 2.27-2.31 4.1-4.57 4.57-3.57.75-6.75-1.7-7.23-5.01-.07-.48-.49-.85-.98-.85-.6 0-1.08.53-1 1.13.62 4.39 4.8 7.64 9.53 6.72 3.12-.61 5.63-3.12 6.24-6.24C20.84 9.48 16.94 5 12 5z"/>
                                <text x="12" y="16" text-anchor="middle" font-size="8" font-weight="bold" fill="currentColor">10</text>
                            </svg>
                        </button>
                        
                        <!-- Skip Forward 10s -->
                        <button class="premium-control-btn premium-skip-forward premium-skip-btn" aria-label="Forward 10 seconds">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                                <path d="M4 13c0 4.4 3.6 8 8 8s8-3.6 8-8h-2c0 3.3-2.7 6-6 6s-6-2.7-6-6 2.7-6 6-6v4l5-5-5-5v4c-4.4 0-8 3.6-8 8z"/>
                                <text x="13" y="15.5" text-anchor="middle" font-size="7" font-weight="bold" fill="currentColor">10</text>
                            </svg>
                        </button>
                        
                        <!-- Volume Control -->
                        <div class="premium-volume-group" style="display:flex; align-items:center;">
                            <button class="premium-control-btn premium-volume-btn" aria-label="Mute">
                                <svg class="volume-high" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                                </svg>
                                <svg class="volume-low" viewBox="0 0 24 24" fill="currentColor" width="24" height="24" style="display:none;">
                                    <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
                                </svg>
                                <svg class="volume-mute" viewBox="0 0 24 24" fill="currentColor" width="24" height="24" style="display:none;">
                                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                                </svg>
                            </button>
                            <div class="premium-volume-slider-wrapper" style="width:0; overflow:hidden; transition:width 0.3s; display:flex; align-items:center;">
                                <input type="range" class="premium-volume-slider" min="0" max="1" step="0.01" value="1" aria-label="Volume" style="width:80px; margin-left:8px;">
                            </div>
                        </div>
                        
                        <!-- Time Display -->
                        <div class="premium-time-display">0:00 / 0:00</div>
                        
                        <!-- Spacer -->
                        <div class="premium-controls-spacer" style="flex:1;"></div>
                        
                        <!-- Settings Button -->
                        <div class="premium-settings-btn" style="position:relative;">
                            <button class="premium-control-btn" aria-label="Settings" aria-haspopup="true" aria-expanded="false">
                                <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                                    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                                </svg>
                            </button>
                            <div class="premium-settings-menu" style="position:absolute; bottom:40px; right:0; background:rgba(0,0,0,0.9); border-radius:8px; padding:10px; min-width:200px; display:none; flex-direction:column;">
                                <div class="premium-settings-section">
                                    <div class="premium-settings-header" style="color:#fff; font-size:12px; text-transform:uppercase; margin-bottom:5px;">Quality</div>
                                    <div class="premium-quality-options"></div>
                                </div>
                                <div class="premium-settings-section" style="margin-top:10px;">
                                    <div class="premium-settings-header" style="color:#fff; font-size:12px; text-transform:uppercase; margin-bottom:5px;">Speed</div>
                                    <div class="premium-speed-options"></div>
                                </div>
                            </div>
                        </div>

                        <!-- ✅ NEW: Fullscreen Button -->
                        <button class="premium-control-btn premium-fullscreen-btn" aria-label="Fullscreen">
                            <svg class="enter-fullscreen" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                            </svg>
                            <svg class="exit-fullscreen" viewBox="0 0 24 24" fill="currentColor" width="24" height="24" style="display:none;">
                                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
                            </svg>
                        </button>
                    </div>
                </div>
                
                <!-- Keyboard Shortcuts Tooltip (hidden by default) -->
                <div class="premium-shortcuts-tooltip" style="position:absolute; top:60px; right:20px; background:rgba(0,0,0,0.9); color:white; padding:15px; border-radius:8px; display:none; z-index:10;">
                    <div class="premium-shortcuts-title" style="font-weight:bold; margin-bottom:10px; border-bottom:1px solid #555; padding-bottom:5px;">Keyboard Shortcuts</div>
                    <div class="premium-shortcuts-list" style="font-size:14px;">
                        <div class="premium-shortcut-item" style="display:flex; justify-content:space-between; margin-bottom:5px;">
                            <span class="premium-shortcut-key" style="background:#333; padding:2px 6px; border-radius:4px; font-family:monospace;">Space</span>
                            <span class="premium-shortcut-desc">Play/Pause</span>
                        </div>
                        <div class="premium-shortcut-item" style="display:flex; justify-content:space-between; margin-bottom:5px;">
                            <span class="premium-shortcut-key" style="background:#333; padding:2px 6px; border-radius:4px; font-family:monospace;">←</span>
                            <span class="premium-shortcut-desc">Rewind 10s</span>
                        </div>
                        <div class="premium-shortcut-item" style="display:flex; justify-content:space-between; margin-bottom:5px;">
                            <span class="premium-shortcut-key" style="background:#333; padding:2px 6px; border-radius:4px; font-family:monospace;">→</span>
                            <span class="premium-shortcut-desc">Forward 10s</span>
                        </div>
                        <div class="premium-shortcut-item" style="display:flex; justify-content:space-between; margin-bottom:5px;">
                            <span class="premium-shortcut-key" style="background:#333; padding:2px 6px; border-radius:4px; font-family:monospace;">M</span>
                            <span class="premium-shortcut-desc">Mute/Unmute</span>
                        </div>
                        <div class="premium-shortcut-item" style="display:flex; justify-content:space-between; margin-bottom:5px;">
                            <span class="premium-shortcut-key" style="background:#333; padding:2px 6px; border-radius:4px; font-family:monospace;">F</span>
                            <span class="premium-shortcut-desc">Fullscreen</span>
                        </div>
                        <div class="premium-shortcut-item" style="display:flex; justify-content:space-between; margin-bottom:5px;">
                            <span class="premium-shortcut-key" style="background:#333; padding:2px 6px; border-radius:4px; font-family:monospace;">?</span>
                            <span class="premium-shortcut-desc">Show shortcuts</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        // ✅ SAFE UX: Use CSS class instead of inline style
        document.body.classList.add('player-active');
        
        const playerId = `premiumPlayer_${videoId}`;
        
        // ✅ FIX 6: Removed Auto-Fullscreen Request
        // ✅ UX IMPROVEMENT: Removed auto-fullscreen request to comply with browser policies
        // Users can manually enter fullscreen using the F key or fullscreen button

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
                    // e.preventDefault(); // Commented out as it might block play
                }, { passive: true });
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
                    '.premium-controls-wrapper',
                    '.premium-player-header',
                    '.premium-progress-bar',
                    '.premium-control-btn',
                    '.premium-settings-menu'
                ];
                
                if (controlElements.some(selector => e.target.closest(selector))) {
                    return;
                }
                
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
                    controlsManager.elements.loadingOverlay.style.display = 'flex';
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
                                controlsManager.elements.loadingOverlay.style.display = 'none';
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

        // ✅ FIXED: Unmute video on all devices
        player.ready(() => {
            // Unmute and set full volume
            player.muted(false);
            player.volume(1);
            
            // Force load on iOS
            if (isIOS) {
                const videoElement = player.el().querySelector('video');
                if (videoElement) {
                    videoElement.load();
                }
            }
            
            // ✅ NEW: Auto-fullscreen on DESKTOP only
            if (!isMobile) {
                // Small delay to ensure modal is fully rendered
                setTimeout(() => {
                    if (modal && !modal.isDisposed) {
                        modal.requestFullscreen().catch(err => {
                            console.log('Auto-fullscreen not allowed:', err);
                            // Fallback: show message to click fullscreen button
                        });
                    }
                }, 300);
            }
        });

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
                } else {
                    activePlayer.pause();
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
        });
        
        controlsManager.elements.skipForward.addEventListener('click', () => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            activePlayer.currentTime(Math.min(activePlayer.duration(), activePlayer.currentTime() + 10));
            controlsManager.showGestureIndicator('⏩');
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
        let touchMoved = false;

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

        // ✅ FIXED: Touch events (mobile) - attach to modal to capture all touches
        if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
            controlsManager.elements.progressBar.addEventListener('touchstart', (e) => {
                e.preventDefault();
                startSeeking(e);
            }, { passive: false });
            
            modal.addEventListener('touchmove', (e) => {
                if (isSeeking) {
                    e.preventDefault();
                    continueSeeking(e);
                }
            }, { passive: false });
            
            modal.addEventListener('touchend', (e) => {
                if (isSeeking) {
                    e.preventDefault();
                    endSeeking(e);
                }
            }, { passive: false });
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
            e.preventDefault();
            e.stopPropagation();
            const isActive = controlsManager.elements.settingsMenu.classList.toggle('active');
            controlsManager.elements.settingsBtn.setAttribute('aria-expanded', isActive);
            if (isActive) {
                controlsManager.elements.settingsMenu.style.display = 'flex';
            } else {
                controlsManager.elements.settingsMenu.style.display = 'none';
            }
        });

        // ✅ NEW: Mobile-specific touch handler
        if (isMobile) {
            controlsManager.elements.settingsBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isActive = controlsManager.elements.settingsMenu.classList.toggle('active');
                controlsManager.elements.settingsBtn.setAttribute('aria-expanded', isActive);
                if (isActive) {
                    controlsManager.elements.settingsMenu.style.display = 'flex';
                } else {
                    controlsManager.elements.settingsMenu.style.display = 'none';
                }
            }, { passive: false });
        }
        
        // Close settings menu when clicking outside
        const closeSettingsMenu = (e) => {
            if (controlsManager.elements.settingsMenu && 
                !controlsManager.elements.settingsMenu.contains(e.target) && 
                !controlsManager.elements.settingsBtn.contains(e.target)) {
                controlsManager.elements.settingsMenu.classList.remove('active');
                controlsManager.elements.settingsMenu.style.display = 'none';
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
                    option.style.cssText = "padding:8px; cursor:pointer; color:white; border-radius:4px;";
                    option.textContent = quality === 'auto' ? 'Auto' : `${quality}p`;
                    option.dataset.quality = quality;
                    
                    if (quality === qualityManager.currentQuality) {
                        option.classList.add('active');
                        option.style.background = '#007aff';
                    }
                    
                    option.addEventListener('click', () => {
                        const player = getSafePlayer();
                        if (!player) return;
                        
                        qualityManager.setQuality(quality);
                        stateManager.currentQuality = quality;
                        
                        // Update active state
                        controlsManager.elements.qualityOptions.querySelectorAll('.premium-settings-item').forEach(item => {
                            item.classList.remove('active');
                            item.style.background = 'transparent';
                        });
                        option.classList.add('active');
                        option.style.background = '#007aff';
                        
                        // Show indicator
                        controlsManager.showChangeIndicator(`Quality: ${qualityManager.getCurrentQualityLabel()}`);
                        
                        // Close menu
                        controlsManager.elements.settingsMenu.classList.remove('active');
                        controlsManager.elements.settingsMenu.style.display = 'none';
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
                    option.style.cssText = "padding:8px; cursor:pointer; color:white; border-radius:4px;";
                    option.textContent = speed === 1 ? 'Normal' : `${speed}x`;
                    option.dataset.speed = speed;
                    
                    if (speed === speedManager.currentSpeed) {
                        option.classList.add('active');
                        option.style.background = '#007aff';
                    }
                    
                    option.addEventListener('click', () => {
                        const player = getSafePlayer();
                        if (!player) return;
                        
                        speedManager.setSpeed(speed);
                        stateManager.currentSpeed = speed;
                        
                        // Update active state
                        controlsManager.elements.speedOptions.querySelectorAll('.premium-settings-item').forEach(item => {
                            item.classList.remove('active');
                            item.style.background = 'transparent';
                        });
                        option.classList.add('active');
                        option.style.background = '#007aff';
                        
                        // Show indicator
                        controlsManager.showChangeIndicator(`Speed: ${speedManager.getCurrentSpeedLabel()}`);
                        
                        // Close menu
                        controlsManager.elements.settingsMenu.classList.remove('active');
                        controlsManager.elements.settingsMenu.style.display = 'none';
                    });
                    
                    controlsManager.elements.speedOptions.appendChild(option);
                });
            }
        }
        
        // ✅ FIXED: Better fullscreen handling
        const handleFullscreenChange = () => {
            const wasFullscreen = stateManager.isFullscreen;
            stateManager.isFullscreen = !!document.fullscreenElement;
            
            // Update fullscreen state but don't auto-close
            // Let user explicitly close with close button
            
            // Handle iOS-specific fullscreen
            if (isIOS) {
                const videoElement = player.el().querySelector('video');
                if (videoElement) {
                    const isIOSFullscreen = document.webkitFullscreenElement === videoElement;
                    stateManager.isFullscreen = isIOSFullscreen || stateManager.isFullscreen;
                }
            }
        };
        
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        // ✅ NEW: iOS-specific fullscreen handler
        if (isIOS) {
            document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        }
        
        // ✅ UPDATED: Fullscreen button event handler
        const fullscreenBtn = modal.querySelector('.premium-fullscreen-btn');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    // Request fullscreen on the MODAL, not just video
                    modal.requestFullscreen().catch(err => {
                        console.error('Fullscreen error:', err);
                    });
                } else {
                    document.exitFullscreen();
                }
            });
        }
        
        // Close button and ESC key
        const closePlayer = () => {
            // ✅ NEW: Clear session tracking
            analyticsTracker.clearSession(videoId);
            
            // Stop token refresh
            tokenRefreshManager.stopRefresh(videoId);
            
            // ✅ SAFE UX: Clean up ALL event listeners
            eventCleanupFunctions.forEach(cleanup => cleanup());
            
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
            document.body.classList.remove('player-active');
        };

        controlsManager.elements.closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closePlayer();
        });

        controlsManager.elements.closeErrorBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closePlayer();
        });

        // ✅ NEW: Mobile-specific touch handlers
        if (isMobile) {
            controlsManager.elements.closeBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closePlayer();
            }, { passive: false });
            
            controlsManager.elements.closeErrorBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closePlayer();
            }, { passive: false });
        }
        
        // Keyboard handler
        const handleKeyDown = (e) => {
            // Don't handle if settings menu is open
            if (controlsManager.elements.settingsMenu && 
                controlsManager.elements.settingsMenu.classList.contains('active')) {
                if (e.key === 'Escape') {
                    controlsManager.elements.settingsMenu.classList.remove('active');
                    controlsManager.elements.settingsMenu.style.display = 'none';
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
                    if (!document.fullscreenElement) {
                        modal.requestFullscreen().catch(() => {});
                    } else {
                        document.exitFullscreen();
                    }
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
            controlsManager.elements.errorOverlay.style.display = 'none';
            controlsManager.elements.loadingOverlay.style.display = 'flex';
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
            controlsManager.elements.loadingOverlay.style.display = 'flex';
        });
        
        player.on('canplay', () => {
            controlsManager.elements.loadingOverlay.style.display = 'none';
        });
        
        player.on('waiting', () => {
            controlsManager.elements.loadingOverlay.style.display = 'flex';
        });
        
        player.on('playing', () => {
            controlsManager.elements.loadingOverlay.style.display = 'none';
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
            controlsManager.elements.loadingOverlay.style.display = 'none';
            
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
            
            controlsManager.elements.errorMessage.textContent = errorMessage;
            controlsManager.elements.errorOverlay.style.display = 'flex';
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
        let preventNextClick = false; // ✅ NEW: Flag to prevent ghost clicks
        const eventCleanupFunctions = []; // ✅ NEW: Store cleanup functions

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
        
        // ✅ SAFE UX: Only prevent touchmove when actively seeking
        modal.addEventListener('touchmove', (e) => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            // CRITICAL: Only preventDefault if user is actively interacting with progress bar
            if (isSeeking) {
                e.preventDefault(); // This is safe because it's scoped to seek gesture
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
            
            if (e.touches.length !== 1) return;
            
            const touchCurrentX = e.touches[0].clientX;
            const touchCurrentY = e.touches[0].clientY;
            
            const deltaX = touchCurrentX - touchStartX;
            const deltaY = touchCurrentY - touchStartY;
            
            if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
                touchMoved = true;
            }
            
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
                isSwiping = true;
                preventNextClick = true;
                // ✅ Only prevent default for horizontal swipes (seek gesture)
                e.preventDefault();
                
                const seekAmount = (deltaX / window.innerWidth) * 30;
                const newTime = Math.max(0, Math.min(activePlayer.duration(), touchStartTime + seekAmount));
                
                if (controlsManager.elements.gestureIndicator) {
                    const direction = deltaX > 0 ? '⏩' : '⏪';
                    const seconds = Math.abs(Math.round(seekAmount));
                    controlsManager.elements.gestureIndicator.textContent = `${direction} ${seconds}s`;
                    controlsManager.elements.gestureIndicator.style.opacity = '1';
                }
            }
        }, { passive: false }); // passive: false only because we need conditional preventDefault
        
        // Replace touchend handler
        modal.addEventListener('touchend', (e) => {
            const activePlayer = getSafePlayer();
            if (!activePlayer) return;
            
            if (controlsManager.elements.gestureIndicator) {
                controlsManager.elements.gestureIndicator.style.opacity = '0';
            }
            
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
                } else if (tapX > rightZoneStart) {
                    // Right side - forward
                    activePlayer.currentTime(Math.min(activePlayer.duration(), activePlayer.currentTime() + 10));
                    controlsManager.showGestureIndicator('⏩ 10s');
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
    
    // CSS Animation for spinner + Part A Fixes
    const styleSheet = document.createElement("style");
    styleSheet.innerText = `
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        /* Part A: Fix Volume Slider Visibility in style.css */
        .premium-volume-slider-wrapper {
            width: 0;
            overflow: hidden;
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
        }

        /* ✅ DESKTOP ONLY: Show volume slider on hover */
        @media (min-width: 769px) {
            .premium-volume-group:hover .premium-volume-slider-wrapper {
                width: 100px !important;
                margin-left: 8px;
            }
            
            .premium-volume-slider {
                width: 100% !important;
                display: block !important;
            }
        }

        /* Keep hidden on mobile */
        @media (max-width: 768px) {
            .premium-volume-group {
                display: none !important;
            }
        }
    `;
    document.head.appendChild(styleSheet);

    document.addEventListener('DOMContentLoaded', () => {
        window.appRouter.navigate();
        if (searchInput) {
            searchInput.addEventListener('input', debounce(handleSearchInput, 300));
        }
    });
    window.onpopstate = () => window.appRouter.handlePopState();

    logoutButton.addEventListener('click', () => {
        cleanupAllVideoPlayers();
        authManager.logout();
    });
    
    // Add cleanup on page unload
    window.addEventListener('beforeunload', () => {
        cleanupAllVideoPlayers();
    });
}