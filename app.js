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
                // Update player source with new URL
                const currentTime = player.currentTime();
                const wasPaused = player.paused();
                
                player.src({
                    src: data.url,
                    type: 'application/x-mpegURL'
                });

                // Restore playback state
                player.one('loadedmetadata', () => {
                    player.currentTime(currentTime);
                    if (!wasPaused) {
                        player.play();
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
        this.startBatchTimer();
    }

    trackEvent(videoId, event, player, tierId) {
        const eventData = {
            event: event,
            video_id: videoId,
            tier_id: tierId,
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

            // Send each event (you can batch them in backend later)
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

function renderHeaderActions() {
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

    // --- 2. Handle Global Download App Button ---
    const downloadAppButton = document.getElementById('downloadAppButton');
    if (downloadAppButton) {
        // Use the new, corrected Dropbox link you provided
        downloadAppButton.href = "https://www.dropbox.com/scl/fi/n1p7i75ncesne1o62vbng/TheEchoChamber.zip?rlkey=msmiiuso5fgf2kuse0sz6amwp&st=ckcjc9fy&dl=1";
        downloadAppButton.style.display = 'inline-block';
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
                card.dataset.tierId = tierName; // NEW: Store tier ID

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

    // --- NETFLIX-STYLE VIDEO PLAYER MODAL (POLISHED VERSION) ---
    function openVideoPlayer(link, tierId) {
        // Extract video ID from URL
        const videoIdMatch = link.url.match(/\/([a-f0-9-]{36})\//);
        if (!videoIdMatch) {
            return;
        }
        
        const videoId = videoIdMatch[1];
        
        // Extract library ID from URL
        const libraryIdMatch = link.url.match(/library_id=(\d+)/);
        const libraryId = libraryIdMatch ? libraryIdMatch[1] : '555806';
        
        // Create modal with Netflix-like dark theme
        const modal = document.createElement('div');
        modal.className = 'netflix-player-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', 'Video Player');
        modal.innerHTML = `
            <div class="netflix-player-modal-content">
                <!-- Header with close button and title -->
                <div class="player-header">
                    <button class="netflix-close-btn" aria-label="Close video player">
                        <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                        <span class="sr-only">Close</span>
                    </button>
                    <div class="player-title" aria-live="polite">${link.title}</div>
                </div>
                
                <!-- Video container -->
                <div class="video-container">
                    <video 
                        id="netflixPlayer" 
                        class="video-js vjs-big-play-centered"
                        preload="auto"
                        playsinline
                        crossorigin="anonymous"
                        aria-label="${link.title}"
                    ></video>
                </div>
                
                <!-- Custom controls overlay -->
                <div class="player-controls-overlay">
                    <div class="controls-center">
                        <button class="big-play-pause-btn" aria-label="Play video">
                            <svg class="play-icon" width="80" height="80" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                            <svg class="pause-icon" width="80" height="80" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                            </svg>
                        </button>
                    </div>
                    
                    <div class="controls-bottom">
                        <!-- Progress bar -->
                        <div class="progress-container">
                            <div class="progress-bar" role="slider" aria-label="Video progress" 
                                 aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
                                 tabindex="0">
                                <div class="progress-background"></div>
                                <div class="progress-fill"></div>
                                <div class="progress-handle" aria-hidden="true"></div>
                                <div class="progress-buffer" aria-hidden="true"></div>
                            </div>
                            <div class="time-display" aria-live="polite">
                                <span class="current-time">0:00</span> / <span class="duration">0:00</span>
                            </div>
                        </div>
                        
                        <!-- Control buttons -->
                        <div class="control-buttons">
                            <button class="rewind-btn" aria-label="Rewind 10 seconds">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                                </svg>
                            </button>
                            
                            <button class="play-pause-btn" aria-label="Play">
                                <svg class="play-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M8 5v14l11-7z"/>
                                </svg>
                                <svg class="pause-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                                </svg>
                            </button>
                            
                            <button class="forward-btn" aria-label="Forward 10 seconds">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M5 4v16l7-8zm7 8l7 8V4z"/>
                                </svg>
                            </button>
                            
                            <!-- Volume control -->
                            <div class="volume-control">
                                <button class="volume-btn" aria-label="Volume">
                                    <svg class="volume-high" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                                    </svg>
                                    <svg class="volume-low" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
                                    </svg>
                                    <svg class="volume-mute" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                                    </svg>
                                </button>
                                <div class="volume-slider-container">
                                    <input type="range" class="volume-slider" min="0" max="1" step="0.01" value="1"
                                           aria-label="Volume level">
                                </div>
                            </div>
                            
                            <!-- Quality selector -->
                            <div class="quality-selector" style="display: none;">
                                <button class="quality-btn" aria-label="Video quality settings">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M19.43 12.98c.04-.32.05-.64.05-.98s-.01-.66-.04-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.03.32-.04.65-.04.98s.01.66.04.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
                                    </svg>
                                </button>
                                <div class="quality-menu">
                                    <div class="quality-menu-header">Quality</div>
                                    <div class="quality-options">
                                        <button class="quality-option active" data-quality="auto">
                                            <span class="quality-name">Auto</span>
                                            <span class="quality-check">✓</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            
                            <button class="fullscreen-btn" aria-label="Enter fullscreen">
                                <svg class="enter-fullscreen" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                                </svg>
                                <svg class="exit-fullscreen" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- Loading indicator -->
                <div class="loading-indicator" aria-hidden="true">
                    <div class="loading-spinner"></div>
                    <div class="loading-text">Loading video...</div>
                </div>
                
                <!-- Error overlay -->
                <div class="error-overlay" aria-hidden="true" style="display: none;">
                    <div class="error-content">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                        </svg>
                        <div class="error-message">Video failed to load. Please try again.</div>
                        <button class="retry-btn">Retry</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        // Prevent duplicate modals
        if (document.querySelectorAll('.netflix-player-modal').length > 1) {
            document.querySelectorAll('.netflix-player-modal').forEach((m, i) => {
                if (i > 0) m.remove();
            });
        }
        
        // Initialize video.js with proper settings
        const player = videojs('netflixPlayer', {
            controls: false,
            autoplay: false,
            preload: 'auto',
            fluid: true,
            aspectRatio: '16:9',
            playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
            html5: {
                vhs: {
                    overrideNative: true,
                    enableLowInitialPlaylist: true,
                    smoothQualityChange: true,
                    useBandwidthFromLocalStorage: false,
                    limitRenditionByPlayerDimensions: false,
                    bandwidth: 5000000
                },
                nativeAudioTracks: false,
                nativeVideoTracks: false
            },
            userActions: {
                hotkeys: true,
                doubleClick: true
            }
        });

        // Set video source
        player.src({
            src: link.url,
            type: 'application/x-mpegURL'
        });

        // Enable quality selector if plugin is available
        if (player.hlsQualitySelector) {
            player.hlsQualitySelector({
                displayCurrentQuality: true,
                vjsIconClass: 'vjs-icon-cog'
            });
        }

        // Get DOM elements
        const bigPlayBtn = modal.querySelector('.big-play-pause-btn');
        const playPauseBtn = modal.querySelector('.play-pause-btn');
        const rewindBtn = modal.querySelector('.rewind-btn');
        const forwardBtn = modal.querySelector('.forward-btn');
        const volumeBtn = modal.querySelector('.volume-btn');
        const volumeSlider = modal.querySelector('.volume-slider');
        const progressBar = modal.querySelector('.progress-bar');
        const progressFill = modal.querySelector('.progress-fill');
        const progressBuffer = modal.querySelector('.progress-buffer');
        const progressHandle = modal.querySelector('.progress-handle');
        const currentTimeEl = modal.querySelector('.current-time');
        const durationEl = modal.querySelector('.duration');
        const fullscreenBtn = modal.querySelector('.fullscreen-btn');
        const closeBtn = modal.querySelector('.netflix-close-btn');
        const qualityBtn = modal.querySelector('.quality-btn');
        const qualityMenu = modal.querySelector('.quality-menu');
        const qualityOptions = modal.querySelector('.quality-options');
        const controlsOverlay = modal.querySelector('.player-controls-overlay');
        const loadingIndicator = modal.querySelector('.loading-indicator');
        const errorOverlay = modal.querySelector('.error-overlay');
        const retryBtn = modal.querySelector('.retry-btn');
        const videoContainer = modal.querySelector('.video-container');
        
        let controlsTimeout;
        let isSeeking = false;
        let isQualityMenuOpen = false;

        // Format time to MM:SS or HH:MM:SS
        function formatTime(seconds) {
            if (!seconds || isNaN(seconds)) return '0:00';
            
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            
            if (hours > 0) {
                return `${hours}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
            }
            return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }

        // Show/hide controls
        function showControls() {
            if (player.paused()) return; // Keep controls visible when paused
            controlsOverlay.classList.add('visible');
            clearTimeout(controlsTimeout);
            controlsTimeout = setTimeout(hideControls, 3000);
        }

        function hideControls() {
            if (!player.paused() && !isSeeking && !isQualityMenuOpen) {
                controlsOverlay.classList.remove('visible');
            }
        }

        // Toggle play/pause
        function togglePlayPause() {
            if (player.paused()) {
                player.play();
            } else {
                player.pause();
            }
            updatePlayPauseButtons();
        }

        // Update play/pause button states
        function updatePlayPauseButtons() {
            const isPlaying = !player.paused();
            bigPlayBtn.classList.toggle('playing', isPlaying);
            playPauseBtn.classList.toggle('playing', isPlaying);
            bigPlayBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
            playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
        }

        // Rewind 10 seconds
        function rewind10() {
            player.currentTime(Math.max(0, player.currentTime() - 10));
            showControls();
        }

        // Forward 10 seconds
        function forward10() {
            player.currentTime(Math.min(player.duration(), player.currentTime() + 10));
            showControls();
        }

        // Toggle mute
        function toggleMute() {
            player.muted(!player.muted());
            updateVolumeUI();
            showControls();
        }

        // Update volume UI
        function updateVolumeUI() {
            if (player.muted() || player.volume() === 0) {
                volumeBtn.classList.remove('low', 'high');
                volumeBtn.classList.add('mute');
                volumeBtn.setAttribute('aria-label', 'Unmute');
            } else if (player.volume() < 0.5) {
                volumeBtn.classList.remove('mute', 'high');
                volumeBtn.classList.add('low');
                volumeBtn.setAttribute('aria-label', 'Volume low');
            } else {
                volumeBtn.classList.remove('mute', 'low');
                volumeBtn.classList.add('high');
                volumeBtn.setAttribute('aria-label', 'Volume high');
            }
            volumeSlider.value = player.muted() ? 0 : player.volume();
        }

        // Toggle fullscreen
        function toggleFullscreen() {
            if (!document.fullscreenElement) {
                modal.requestFullscreen();
                fullscreenBtn.classList.add('fullscreen');
                fullscreenBtn.setAttribute('aria-label', 'Exit fullscreen');
            } else {
                document.exitFullscreen();
                fullscreenBtn.classList.remove('fullscreen');
                fullscreenBtn.setAttribute('aria-label', 'Enter fullscreen');
            }
            showControls();
        }

        // Update progress bar
        function updateProgress() {
            if (isSeeking) return;
            
            const currentTime = player.currentTime();
            const duration = player.duration();
            
            if (!duration || duration === Infinity) return;
            
            const percentage = (currentTime / duration) * 100;
            
            progressFill.style.width = `${percentage}%`;
            progressHandle.style.left = `${percentage}%`;
            progressBar.setAttribute('aria-valuenow', percentage);
            currentTimeEl.textContent = formatTime(currentTime);
            durationEl.textContent = formatTime(duration);
        }

        // Update buffer bar
        function updateBuffer() {
            if (!player.buffered() || !player.buffered().length) return;
            
            const duration = player.duration();
            if (!duration || duration === Infinity) return;
            
            const bufferedEnd = player.buffered().end(0);
            const bufferPercentage = (bufferedEnd / duration) * 100;
            progressBuffer.style.width = `${bufferPercentage}%`;
        }

        // Show loading indicator
        function showLoading() {
            loadingIndicator.style.display = 'flex';
            controlsOverlay.style.display = 'none';
        }

        // Hide loading indicator
        function hideLoading() {
            loadingIndicator.style.display = 'none';
            controlsOverlay.style.display = 'block';
        }

        // Show error overlay
        function showError() {
            errorOverlay.style.display = 'flex';
            controlsOverlay.style.display = 'none';
        }

        // Hide error overlay
        function hideError() {
            errorOverlay.style.display = 'none';
            controlsOverlay.style.display = 'block';
        }

        // Update quality options
        function updateQualityOptions() {
            if (!player.qualityLevels || !player.qualityLevels()) return;
            
            const qualityLevels = player.qualityLevels();
            const qualitySelector = modal.querySelector('.quality-selector');
            
            if (qualityLevels.length > 1) {
                qualitySelector.style.display = 'flex';
                
                // Clear existing options
                qualityOptions.innerHTML = '';
                
                // Add Auto option
                const autoOption = document.createElement('button');
                autoOption.className = 'quality-option active';
                autoOption.dataset.quality = 'auto';
                autoOption.innerHTML = `
                    <span class="quality-name">Auto</span>
                    <span class="quality-check">✓</span>
                `;
                autoOption.addEventListener('click', () => setQuality('auto'));
                qualityOptions.appendChild(autoOption);
                
                // Add quality levels
                for (let i = 0; i < qualityLevels.length; i++) {
                    const level = qualityLevels[i];
                    const height = level.height;
                    if (!height) continue;
                    
                    const option = document.createElement('button');
                    option.className = 'quality-option';
                    option.dataset.quality = height;
                    option.innerHTML = `
                        <span class="quality-name">${height}p</span>
                        <span class="quality-check">✓</span>
                    `;
                    option.addEventListener('click', () => setQuality(height));
                    qualityOptions.appendChild(option);
                }
            } else {
                qualitySelector.style.display = 'none';
            }
        }

        // Set quality
        function setQuality(quality) {
            if (!player.qualityLevels || !player.qualityLevels()) return;
            
            const qualityLevels = player.qualityLevels();
            
            if (quality === 'auto') {
                // Enable all quality levels for auto selection
                for (let i = 0; i < qualityLevels.length; i++) {
                    qualityLevels[i].enabled = true;
                }
            } else {
                const targetHeight = parseInt(quality);
                // Select specific quality
                for (let i = 0; i < qualityLevels.length; i++) {
                    qualityLevels[i].enabled = (qualityLevels[i].height === targetHeight);
                }
            }
            
            // Update active state in UI
            modal.querySelectorAll('.quality-option').forEach(option => {
                option.classList.remove('active');
            });
            modal.querySelector(`.quality-option[data-quality="${quality}"]`).classList.add('active');
            
            closeQualityMenu();
            showControls();
        }

        // Toggle quality menu
        function toggleQualityMenu() {
            isQualityMenuOpen = !isQualityMenuOpen;
            qualityMenu.classList.toggle('open', isQualityMenuOpen);
            
            if (isQualityMenuOpen) {
                showControls(); // Keep controls visible when menu is open
            }
        }

        // Close quality menu
        function closeQualityMenu() {
            isQualityMenuOpen = false;
            qualityMenu.classList.remove('open');
        }

        // Event listeners for player
        player.on('timeupdate', updateProgress);
        player.on('progress', updateBuffer);
        player.on('durationchange', () => {
            durationEl.textContent = formatTime(player.duration());
        });
        player.on('play', () => {
            updatePlayPauseButtons();
            hideLoading();
            hideControls();
        });
        player.on('pause', () => {
            updatePlayPauseButtons();
            showControls();
        });
        player.on('volumechange', updateVolumeUI);
        player.on('waiting', showLoading);
        player.on('playing', hideLoading);
        player.on('canplay', hideLoading);
        player.on('error', (e) => {
            console.error('Player error:', e);
            showError();
        });
        player.on('loadedmetadata', () => {
            durationEl.textContent = formatTime(player.duration());
            updateQualityOptions();
        });
        player.on('qualitylevels', updateQualityOptions);

        // Control event listeners
        bigPlayBtn.addEventListener('click', togglePlayPause);
        playPauseBtn.addEventListener('click', togglePlayPause);
        rewindBtn.addEventListener('click', rewind10);
        forwardBtn.addEventListener('click', forward10);
        
        volumeBtn.addEventListener('click', toggleMute);
        volumeSlider.addEventListener('input', (e) => {
            player.volume(parseFloat(e.target.value));
            player.muted(e.target.value === 0);
            updateVolumeUI();
            showControls();
        });

        qualityBtn.addEventListener('click', toggleQualityMenu);

        // Progress bar seeking
        progressBar.addEventListener('click', (e) => {
            const rect = progressBar.getBoundingClientRect();
            const percentage = (e.clientX - rect.left) / rect.width;
            player.currentTime(percentage * player.duration());
            showControls();
        });

        progressBar.addEventListener('mousedown', (e) => {
            isSeeking = true;
            showControls();
            
            const rect = progressBar.getBoundingClientRect();
            const percentage = (e.clientX - rect.left) / rect.width;
            player.currentTime(percentage * player.duration());
        });

        document.addEventListener('mousemove', (e) => {
            if (!isSeeking) return;
            const rect = progressBar.getBoundingClientRect();
            const percentage = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            progressFill.style.width = `${percentage * 100}%`;
            progressHandle.style.left = `${percentage * 100}%`;
            progressBar.setAttribute('aria-valuenow', percentage * 100);
            currentTimeEl.textContent = formatTime(percentage * player.duration());
        });

        document.addEventListener('mouseup', () => {
            if (isSeeking) {
                isSeeking = false;
                showControls();
            }
        });

        // Keyboard support for progress bar
        progressBar.addEventListener('keydown', (e) => {
            const currentTime = player.currentTime();
            const duration = player.duration();
            
            switch(e.key) {
                case 'ArrowLeft':
                    player.currentTime(Math.max(0, currentTime - 5));
                    break;
                case 'ArrowRight':
                    player.currentTime(Math.min(duration, currentTime + 5));
                    break;
                case 'Home':
                    player.currentTime(0);
                    break;
                case 'End':
                    player.currentTime(duration);
                    break;
            }
            showControls();
        });

        fullscreenBtn.addEventListener('click', toggleFullscreen);
        
        closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        retryBtn.addEventListener('click', () => {
            hideError();
            player.src({
                src: link.url,
                type: 'application/x-mpegURL'
            });
            player.load();
            player.play();
        });

        // Mouse movement detection for controls
        modal.addEventListener('mousemove', showControls);
        
        // Hide controls when mouse leaves player area
        modal.addEventListener('mouseleave', () => {
            if (!player.paused() && !isSeeking && !isQualityMenuOpen) {
                hideControls();
            }
        });

        // Click outside quality menu to close it
        document.addEventListener('click', (e) => {
            if (isQualityMenuOpen && !qualityMenu.contains(e.target) && !qualityBtn.contains(e.target)) {
                closeQualityMenu();
            }
        });

        // Fullscreen change events
        document.addEventListener('fullscreenchange', () => {
            const isFullscreen = !!document.fullscreenElement;
            fullscreenBtn.classList.toggle('fullscreen', isFullscreen);
            fullscreenBtn.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
            
            // Force video.js to recalculate dimensions
            if (player) {
                player.trigger('fullscreenchange');
            }
        });

        // ESC key to close
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else if (isQualityMenuOpen) {
                    closeQualityMenu();
                } else {
                    closeModal();
                }
            }
            
            // Space bar to play/pause
            if (e.key === ' ' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
                togglePlayPause();
                e.preventDefault();
            }
            
            // Arrow keys for seeking when focus is on player
            if (e.target === modal || e.target === progressBar) {
                if (e.key === 'ArrowLeft') {
                    rewind10();
                    e.preventDefault();
                } else if (e.key === 'ArrowRight') {
                    forward10();
                    e.preventDefault();
                } else if (e.key === 'f' || e.key === 'F') {
                    toggleFullscreen();
                    e.preventDefault();
                } else if (e.key === 'm' || e.key === 'M') {
                    toggleMute();
                    e.preventDefault();
                }
            }
        };
        
        document.addEventListener('keydown', escHandler);

        // Close modal function
        function closeModal() {
            if (player) {
                player.dispose();
            }
            tokenRefreshManager.stopRefresh(videoId);
            modal.remove();
            document.body.style.overflow = '';
            document.removeEventListener('keydown', escHandler);
        }

        // Register for token refresh
        tokenRefreshManager.registerVideo(videoId, player, tierId, libraryId);
        
        // Track analytics
        player.on('play', () => analyticsTracker.trackEvent(videoId, 'play', player, tierId));
        player.on('pause', () => analyticsTracker.trackEvent(videoId, 'pause', player, tierId));
        player.on('ended', () => {
            analyticsTracker.trackEvent(videoId, 'ended', player, tierId);
            // Reset to beginning when video ends
            player.currentTime(0);
            player.pause();
            updatePlayPauseButtons();
            showControls();
        });
        player.on('error', () => analyticsTracker.trackEvent(videoId, 'error', player, tierId));
        
        // Track watch time every 30 seconds
        let watchTimeTracker = setInterval(() => {
            if (player && !player.paused()) {
                analyticsTracker.trackEvent(videoId, 'timeupdate', player, tierId);
            }
        }, 30000);
        
        // Cleanup on close
        const originalCloseModal = closeModal;
        closeModal = function() {
            clearInterval(watchTimeTracker);
            originalCloseModal();
        };
        
        // Initial UI setup
        updatePlayPauseButtons();
        updateVolumeUI();
        showControls();
        
        // Focus management
        modal.focus();
        
        // Auto-play on click of big play button (optional)
        bigPlayBtn.addEventListener('click', () => {
            if (player.paused()) {
                player.play();
            }
        });
    }

    // --- Main Application Router ---
    async function router() {
        // Load user data at the start of router
        loadUserData();
        
        // ⚡ NEW: Start session refresh manager
        if (!sessionRefreshManager.refreshTimer) {
            sessionRefreshManager.start();
        }
        
        // NEW (V2): Load and display multiple announcements
        const announcementsData = JSON.parse(localStorage.getItem('global_announcements') || '[]');
        announcementSlider.showAnnouncements(announcementsData);
        
        // Render renewal banner and header actions
        renderRenewalBanner();
        renderHeaderActions();

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
        } catch (error) {
            // Silently handle error without logging to console
            displayError("An error occurred while loading the page. Please try again.");
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
        localStorage.clear();
        window.location.href = 'index.html';
    });
}