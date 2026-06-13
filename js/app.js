/**
 * Main App Controller and State Management for OmniPlay IPTV
 */

// Custom IPTV source — Bangladesh/India/Sports focused
// Always route through local proxy to avoid mixed-content & CORS issues
const LIVETV_HOST = 'http://198.195.239.50';
const LIVETV_API = '/proxy?url=' + encodeURIComponent('http://198.195.239.50/tv_channels.json');
const LIVETV_IMG_BASE = '/proxy?url=' + encodeURIComponent('http://198.195.239.50/');

const app = {
  // Application State
  state: {
    categories: [],
    countries: [],
    allChannels: [],      // Holds channels from current playlist
    filteredChannels: [], // Holds currently filtered channels
    favorites: [],        // Saved channel structures
    recents: [],          // Recently watched channels
    customPlaylists: [],  // Saved user custom playlists
    currentPlaylistName: '',
    autoplay: true,
    theme: 'dark',
    activePillFilter: 'all', // all, favs, sports, news
    activeCountryFilter: 'all',
    activeCategoryFilter: 'all',
    activeSort: 'name-asc',
    filtersBound: false,
    queryParamChecked: false
  },

  async init() {
    console.log('OmniPlay IPTV initializing...');
    
    // 1. Initialize Player & UI components
    IPTVPlayer.init();
    IPTVUI.init();

    // 2. Load settings and data from LocalStorage
    this.loadStateFromStorage();

    // 3. Register Sidebar Filter Pills (Synchronous - responsive immediately!)
    this.registerPillEvents();

    // 4. Register Search Handler
    this.registerSearchEvents();

    // 5. Register Settings / Custom Forms Events
    this.registerCustomFormEvents();

    // 6. Bind global player details actions
    this.registerDetailsEvents();

    // 6b. Wire LiveTV pill and quick-start
    const liveTVPill = document.getElementById('pill-livetv');
    if (liveTVPill) {
      liveTVPill.addEventListener('click', () => {
        // Deactivate regular pills
        document.querySelectorAll('.pill-btn[data-filter]').forEach(b => b.classList.remove('active'));
        liveTVPill.classList.add('active');
        this.loadLiveTVSource();
      });
    }

    const quickStartBtn = document.getElementById('btn-quick-start');
    if (quickStartBtn) {
      quickStartBtn.addEventListener('click', () => this.loadLiveTVSource());
    }

    // 6c. Wire BanglaIndia Channel pill
    const banglaIndiaPill = document.getElementById('pill-banglaindia');
    if (banglaIndiaPill) {
      banglaIndiaPill.addEventListener('click', () => {
        document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        banglaIndiaPill.classList.add('active');
        this.loadBanglaIndiaSource();
      });
    }

    // 7. Load default theme
    document.documentElement.setAttribute('data-theme', this.state.theme);
    const themeBtn = document.getElementById('theme-toggle').querySelector('i');
    if (themeBtn) {
      themeBtn.setAttribute('data-lucide', this.state.theme === 'dark' ? 'moon' : 'sun');
    }

    // 8. Fetch Base Data asynchronously (Non-blocking)
    this.fetchBaseMetadata();

    // 9. Load default playlist (US Channels as starter) asynchronously (Non-blocking)
    this.loadDefaultPlaylist();

    if (window.lucide) {
      window.lucide.createIcons();
    }

    console.log('OmniPlay IPTV ready!');
  },

  /**
   * Helper utility to perform fetch requests with an abortable timeout
   */
  async fetchWithTimeout(resource, options = {}) {
    const { timeout = 3500 } = options;
    
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(resource, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  },

  registerPillEvents() {
    document.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        this.state.activePillFilter = btn.getAttribute('data-filter');
        this.applyFiltersAndSort();
        
        // Scroll channel list to top
        document.getElementById('sidebar-channel-container').scrollTop = 0;
      });
    });
  },

  switchView(view) {
    if (view === 'dashboard' || view === 'welcome') {
      IPTVUI.switchView('welcome');
    } else if (view === 'player') {
      IPTVUI.switchView('player');
    }
  },

  registerSearchEvents() {
    const searchInput = document.getElementById('sidebar-search-input');
    const clearBtn = document.getElementById('sidebar-clear-search');

    // Real-Time Sidebar Search
    searchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      clearBtn.style.display = val ? 'block' : 'none';
      this.applyFiltersAndSort();
    });

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.style.display = 'none';
      this.applyFiltersAndSort();
    });
  },

  registerCustomFormEvents() {
    const loadBtn = document.getElementById('load-playlist-btn');
    const fileInput = document.getElementById('playlist-file');
    const fileLabel = document.querySelector('.file-upload-label span');
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    const settingsAspect = document.getElementById('settings-aspect-ratio');
    const settingsAutoplay = document.getElementById('settings-autoplay');

    // Handle Local File upload visual label
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        fileLabel.textContent = `Selected: ${file.name}`;
      }
    });

    // Handle playlist submitting
    loadBtn.addEventListener('click', async () => {
      const url = document.getElementById('playlist-url').value.trim();
      const file = fileInput.files[0];
      const name = document.getElementById('playlist-name').value.trim() || 'Custom Playlist';

      if (url) {
        await this.importPlaylistFromUrl(url, name);
      } else if (file) {
        await this.importPlaylistFromFile(file, name);
      } else {
        alert('Please provide a Playlist URL or choose a local .m3u file.');
      }
      
      // Hide modal
      document.getElementById('custom-playlist-modal').classList.remove('active');
    });

    // Clear Cache / Data
    clearCacheBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear your favorites, history, and custom playlists?')) {
        localStorage.clear();
        this.state.favorites = [];
        this.state.recents = [];
        this.state.customPlaylists = [];
        this.state.activePillFilter = 'all';
        document.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-filter') === 'all'));
        
        IPTVUI.renderChannels([], 'Channels');
        this.renderSavedPlaylists();
        alert('Application data reset successfully!');
      }
    });

    // Settings aspect ratio
    settingsAspect.addEventListener('change', (e) => {
      const aspect = e.target.value;
      
      const idx = IPTVPlayer.aspectRatios.indexOf(aspect);
      if (idx !== -1) {
        IPTVPlayer.currentAspectRatioIndex = idx;
        const wrapper = document.getElementById('video-wrapper');
        wrapper.className = 'video-container-wrapper';
        if (aspect !== 'auto') {
          wrapper.classList.add(`fit-${aspect}`);
        }
      }
    });

    // Settings autoplay
    settingsAutoplay.addEventListener('change', (e) => {
      IPTVPlayer.autoplay = e.target.checked;
      this.state.autoplay = e.target.checked;
      localStorage.setItem('settings-autoplay', e.target.checked);
    });

    // Settings: CORS Proxy toggle
    const useProxyToggle = document.getElementById('settings-use-proxy');
    const proxyUrlInput = document.getElementById('settings-proxy-url');
    const proxyUrlRow  = document.getElementById('proxy-url-row');

    if (useProxyToggle) {
      useProxyToggle.addEventListener('change', (e) => {
        IPTVPlayer.useProxy = e.target.checked;
        localStorage.setItem('settings-use-proxy', e.target.checked);
        proxyUrlRow.style.display = e.target.checked ? 'flex' : 'none';
      });
    }

    if (proxyUrlInput) {
      proxyUrlInput.addEventListener('change', (e) => {
        const val = e.target.value.trim();
        if (val) {
          IPTVPlayer.proxyUrl = val.endsWith('?') ? val : val + '?';
          localStorage.setItem('settings-proxy-url', IPTVPlayer.proxyUrl);
        }
      });
    }
  },

  registerDetailsEvents() {
    // Favorite Toggle Button in Right details Pane
    document.getElementById('btn-fav-toggle').addEventListener('click', () => {
      if (IPTVPlayer.currentChannel) {
        this.toggleFavorite(IPTVPlayer.currentChannel);
        
        // Update sidebar card favorite state if visible
        const card = document.querySelector(`.sidebar-channel-card[data-channel-id="${IPTVPlayer.currentChannel.id}"]`);
        if (card) {
          const favBtn = card.querySelector('.sidebar-fav-btn');
          if (favBtn) {
            favBtn.classList.toggle('active', this.isFavorite(IPTVPlayer.currentChannel.id));
          }
        }
        
        // Update main pane details button
        IPTVUI.updateActivePlayerInfo(IPTVPlayer.currentChannel);
      }
    });

    // Share Stream Link
    document.getElementById('btn-share-channel').addEventListener('click', () => {
      if (IPTVPlayer.currentChannel) {
        const shareUrl = `${window.location.origin}${window.location.pathname}?channel=${encodeURIComponent(IPTVPlayer.currentChannel.id)}`;
        
        navigator.clipboard.writeText(shareUrl).then(() => {
          alert('Stream link copied to clipboard!');
        }).catch(err => {
          navigator.clipboard.writeText(IPTVPlayer.currentChannel.url);
          alert('Stream source URL copied!');
        });
      }
    });

    // Scan for first working channel
    const scanBtn = document.getElementById('btn-scan-channels');
    if (scanBtn) {
      scanBtn.addEventListener('click', () => {
        const channels = this.state.filteredChannels;
        if (!channels || channels.length === 0) {
          alert('No channels loaded. Please select a country or category first.');
          return;
        }

        // Reset failed list for a fresh scan
        IPTVPlayer.failedChannels.clear();
        IPTVPlayer.autoAdvance = true;
        IPTVPlayer._scanMode = true;

        // Visual feedback on button
        scanBtn.classList.add('scanning');
        scanBtn.innerHTML = '<i data-lucide="loader"></i> Scanning…';
        if (window.lucide) window.lucide.createIcons();

        // Stop scan mode button after success (listen for canplay)
        const stopScan = () => {
          IPTVPlayer._scanMode = false;
          scanBtn.classList.remove('scanning');
          scanBtn.innerHTML = '<i data-lucide="radar"></i> Find Working Channel';
          if (window.lucide) window.lucide.createIcons();
          IPTVPlayer.video.removeEventListener('canplay', stopScan);
        };
        IPTVPlayer.video.addEventListener('canplay', stopScan);

        // Start scanning from the first channel
        const first = channels[0];
        IPTVPlayer.failedChannels.delete(first.id);
        this.playChannel(first);
      });
    }
  },

  async loadDefaultPlaylist() {
    if (this.state.customPlaylists.length > 0) {
      this.loadCustomPlaylist(this.state.customPlaylists[0]);
    } else {
      // Try the fast local LiveTV source first
      await this.loadLiveTVSource();
    }
  },

  /**
   * Loads channels from the built-in LiveTV server (198.195.239.50)
   * Covers: Sports, News, Bangla, Indian Bangla, Hindi, Kids, Documentary, Music
   */
  async loadLiveTVSource() {
    IPTVUI.updateConnectionStatus('loading', 'Loading LiveTV channels...');
    try {
      const res = await this.fetchWithTimeout(LIVETV_API, { timeout: 8000 });
      if (!res.ok) throw new Error(`LiveTV API failed: ${res.status}`);

      const data = await res.json();
      const channels = data.channels
        .filter(ch => ch.status !== 'hidden')
        .map((ch, i) => ({
          id: `livetv-${ch.name.replace(/\s+/g, '-').toLowerCase()}`,
          name: ch.name,
          // Always route channel stream through local proxy for CORS bypass
          url: '/proxy?url=' + encodeURIComponent(ch.url),
          logo: ch.logo ? (LIVETV_IMG_BASE + encodeURIComponent(ch.logo)) : '',
          groups: [ch.category],
          countryCode: 'BD',
          headers: {}
        }));

      if (channels.length === 0) throw new Error('No channels returned');

      this.state.allChannels = channels;
      this.state.currentPlaylistName = '🏴 LiveTV — BD/IN/Sports';
      this.setupChannelFilters('country');
      this.applyFiltersAndSort();
      IPTVUI.updateConnectionStatus('online', `${channels.length} channels loaded`);
      console.log(`✅ LiveTV source loaded: ${channels.length} channels`);
    } catch (err) {
      console.warn('LiveTV source failed, falling back to iptv-org:', err.message);
      await this.loadCountryPlaylist('us', 'United States');
    }
  },

  /**
   * Loads all channels from the BD/India server (198.195.239.50)
   * Dedicated BanglaIndia button — shows all categories from the server.
   */
  async loadBanglaIndiaSource() {
    IPTVUI.updateConnectionStatus('loading', 'Loading BanglaIndia channels...');
    try {
      const res = await this.fetchWithTimeout(LIVETV_API, { timeout: 8000 });
      if (!res.ok) throw new Error(`BanglaIndia API failed: ${res.status}`);

      const data = await res.json();
      const channels = data.channels
        .filter(ch => ch.status !== 'hidden')
        .map((ch) => ({
          id: `banglaindia-${ch.name.replace(/\s+/g, '-').toLowerCase()}`,
          name: ch.name,
          url: '/proxy?url=' + encodeURIComponent(ch.url),
          logo: ch.logo ? (LIVETV_IMG_BASE + encodeURIComponent(ch.logo)) : '',
          groups: [ch.category],
          countryCode: 'BD',
          headers: {}
        }));

      if (channels.length === 0) throw new Error('No channels returned');

      this.state.allChannels = channels;
      this.state.currentPlaylistName = '🇧🇩🇮🇳 BanglaIndia Channel';
      this.setupChannelFilters('country');
      this.applyFiltersAndSort();
      IPTVUI.updateConnectionStatus('online', `${channels.length} BanglaIndia channels loaded`);
      console.log(`✅ BanglaIndia source loaded: ${channels.length} channels`);
    } catch (err) {
      console.warn('BanglaIndia source failed:', err.message);
      IPTVUI.updateConnectionStatus('error', 'Failed to load BanglaIndia channels');
      alert('Could not load BanglaIndia channels. Make sure the server (node server.js) is running on localhost:3000.');
    }
  },

  /**
   * Check for query parameters in the address bar (e.g. ?channel=DurontoTV)
   */
  checkQueryParams() {
    if (this.state.queryParamChecked) return;
    
    const params = new URLSearchParams(window.location.search);
    const channelId = params.get('channel');
    
    if (channelId && this.state.allChannels.length > 0) {
      const channel = this.state.allChannels.find(ch => ch.id === decodeURIComponent(channelId));
      if (channel) {
        console.log(`Deep link channel found: ${channel.name}. Starting autoplay...`);
        this.playChannel(channel);
        this.state.queryParamChecked = true;
      }
    }
  },

  /**
   * Load base categories & countries metadata index from official API feeds
   */
  async fetchBaseMetadata() {
    IPTVUI.updateConnectionStatus('loading', 'Loading metadata...');
    try {
      // Fetch with timeout
      const catRes = await this.fetchWithTimeout('https://iptv-org.github.io/api/categories.json', { timeout: 3000 });
      if (catRes.ok) {
        this.state.categories = await catRes.json();
      }

      const countRes = await this.fetchWithTimeout('https://iptv-org.github.io/api/countries.json', { timeout: 3000 });
      if (countRes.ok) {
        this.state.countries = await countRes.json();
      }

      IPTVUI.renderCategories(this.state.categories);
      IPTVUI.renderCountries(this.state.countries);
      IPTVUI.updateConnectionStatus('online', 'Ready');
    } catch (err) {
      console.warn('Failed to load base metadata indices or timeout occurred. Using offline fallbacks.', err);
      IPTVUI.updateConnectionStatus('online', 'Ready (Offline mode)');
      
      // Fallback structures
      this.state.categories = [
        { id: 'news', name: 'News', description: 'World news reports' },
        { id: 'sports', name: 'Sports', description: 'Live sporting actions' },
        { id: 'animation', name: 'Animation', description: 'Cartoons and anime' },
        { id: 'movies', name: 'Movies', description: 'Cinema broadcasts' },
        { id: 'music', name: 'Music', description: 'Music television channels' },
        { id: 'entertainment', name: 'Entertainment', description: 'Entertainment feeds' },
        { id: 'documentary', name: 'Documentary', description: 'Fact-based films' },
        { id: 'kids', name: 'Kids', description: 'Programming for children' }
      ];
      this.state.countries = [
        { name: 'United States', code: 'US', flag: '🇺🇸' },
        { name: 'United Kingdom', code: 'UK', flag: '🇬🇧' },
        { name: 'Canada', code: 'CA', flag: '🇨🇦' },
        { name: 'France', code: 'FR', flag: '🇫🇷' },
        { name: 'Germany', code: 'DE', flag: '🇩🇪' },
        { name: 'India', code: 'IN', flag: '🇮🇳' },
        { name: 'Spain', code: 'ES', flag: '🇪🇸' },
        { name: 'Brazil', code: 'BR', flag: '🇧🇷' },
        { name: 'Italy', code: 'IT', flag: '🇮🇹' },
        { name: 'Bangladesh', code: 'BD', flag: '🇧🇩' }
      ];
      IPTVUI.renderCategories(this.state.categories);
      IPTVUI.renderCountries(this.state.countries);
    }
  },

  /**
   * Loads channels playlist filtered by specific category
   */
  async loadCategoryPlaylist(categoryId, categoryName) {
    IPTVUI.updateConnectionStatus('loading', `Loading ${categoryName}...`);
    try {
      const res = await this.fetchWithTimeout(`https://iptv-org.github.io/iptv/categories/${categoryId}.m3u`, { timeout: 4000 });
      if (!res.ok) throw new Error('Playlist fetch failed');

      const text = await res.text();
      this.state.allChannels = M3UParser.parse(text);
      this.state.currentPlaylistName = categoryName;

      this.setupChannelFilters('category');
      this.applyFiltersAndSort();
      IPTVUI.updateConnectionStatus('online', 'Ready');
    } catch (err) {
      console.error(err);
      IPTVUI.updateConnectionStatus('error', 'CORS / Network Error fetching playlist');
      alert(`Unable to fetch category playlist for ${categoryName}. This could be a temporary issue or CORS block.`);
    }
  },

  /**
   * Loads channels playlist filtered by specific Country Code
   */
  async loadCountryPlaylist(countryCode, countryName) {
    IPTVUI.updateConnectionStatus('loading', `Loading ${countryName}...`);
    try {
      const res = await this.fetchWithTimeout(`https://iptv-org.github.io/iptv/countries/${countryCode}.m3u`, { timeout: 4000 });
      if (!res.ok) throw new Error('Playlist fetch failed');

      const text = await res.text();
      this.state.allChannels = M3UParser.parse(text);
      this.state.currentPlaylistName = countryName;

      this.setupChannelFilters('country');
      this.applyFiltersAndSort();
      IPTVUI.updateConnectionStatus('online', 'Ready');
    } catch (err) {
      console.error(err);
      IPTVUI.updateConnectionStatus('error', 'CORS / Network Error fetching playlist');
      alert(`Unable to fetch country playlist for ${countryName}. This could be a temporary issue or CORS block.`);
    }
  },

  /**
   * Import playlist from custom M3U url
   */
  async importPlaylistFromUrl(url, name) {
    IPTVUI.updateConnectionStatus('loading', 'Importing playlist URL...');
    try {
      const res = await this.fetchWithTimeout(url, { timeout: 6000 });
      if (!res.ok) throw new Error('Failed to load URL');

      const text = await res.text();
      const parsedChannels = M3UParser.parse(text);
      
      if (parsedChannels.length === 0) {
        alert('No channels could be parsed from this URL. Make sure it is a valid M3U format.');
        return;
      }

      const playlistItem = {
        name,
        type: 'url',
        url,
        channels: parsedChannels
      };

      this.state.customPlaylists.push(playlistItem);
      this.saveStateToStorage();
      
      alert(`Successfully imported playlist: ${name} (${parsedChannels.length} channels)`);
      this.loadCustomPlaylist(playlistItem);
    } catch (err) {
      console.error(err);
      IPTVUI.updateConnectionStatus('error', 'CORS / Load error');
      alert(`Failed to load external M3U playlist. This URL may lack CORS approval headers.`);
    }
  },

  /**
   * Import playlist from local file upload
   */
  importPlaylistFromFile(file, name) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const parsedChannels = M3UParser.parse(text);
      
      if (parsedChannels.length === 0) {
        alert('No channels found. Please verify this .m3u file.');
        return;
      }

      const playlistItem = {
        name,
        type: 'file',
        channels: parsedChannels
      };

      this.state.customPlaylists.push(playlistItem);
      this.saveStateToStorage();
      
      alert(`Imported local file: ${name} (${parsedChannels.length} channels)`);
      this.loadCustomPlaylist(playlistItem);
    };

    reader.readAsText(file);
  },

  loadCustomPlaylist(playlist) {
    this.state.allChannels = playlist.channels;
    this.state.currentPlaylistName = playlist.name;
    this.setupChannelFilters('custom');
    this.applyFiltersAndSort();
    IPTVUI.updateConnectionStatus('online', 'Ready');
  },

  deleteCustomPlaylist(idx) {
    if (confirm(`Delete playlist "${this.state.customPlaylists[idx].name}"?`)) {
      this.state.customPlaylists.splice(idx, 1);
      this.saveStateToStorage();
      this.renderSavedPlaylists();
    }
  },

  renderSavedPlaylists() {
    IPTVUI.renderCustomPlaylists(this.state.customPlaylists);
  },

  playChannel(channel) {
    IPTVPlayer.loadChannel(channel);
    
    // Add to Recents
    this.addRecentChannel(channel);
    
    // Switch to playback view stage
    this.switchView('player');
    
    // Load metadata card details
    IPTVUI.updateActivePlayerInfo(channel);
  },

  addRecentChannel(channel) {
    this.state.recents = this.state.recents.filter(c => c.id !== channel.id);
    this.state.recents.unshift(channel);
    if (this.state.recents.length > 15) {
      this.state.recents.pop();
    }
    this.saveStateToStorage();
  },

  toggleFavorite(channel) {
    const isFav = this.isFavorite(channel.id);
    if (isFav) {
      this.state.favorites = this.state.favorites.filter(c => c.id !== channel.id);
    } else {
      this.state.favorites.push(channel);
    }
    this.saveStateToStorage();
    return !isFav;
  },

  isFavorite(id) {
    return this.state.favorites.some(c => c.id === id);
  },

  resetFilters() {
    document.getElementById('sidebar-search-input').value = '';
    document.getElementById('sidebar-clear-search').style.display = 'none';
    
    const countrySelect = document.getElementById('channel-country-filter');
    const categorySelect = document.getElementById('channel-category-filter');
    if (countrySelect) countrySelect.value = 'all';
    if (categorySelect) categorySelect.value = 'all';
    
    this.state.activeCountryFilter = 'all';
    this.state.activeCategoryFilter = 'all';
    
    this.applyFiltersAndSort();
  },

  setupChannelFilters(mode) {
    const countryWrapper = document.getElementById('country-filter-wrapper');
    const categoryWrapper = document.getElementById('category-filter-wrapper');
    const countrySelect = document.getElementById('channel-country-filter');
    const categorySelect = document.getElementById('channel-category-filter');

    // Reset selectors
    countrySelect.innerHTML = '<option value="all">All Countries</option>';
    categorySelect.innerHTML = '<option value="all">All Categories</option>';

    if (mode === 'category') {
      countryWrapper.style.display = 'block';
      categoryWrapper.style.display = 'none';

      const uniqueCountryCodes = new Set();
      this.state.allChannels.forEach(ch => {
        const countryMatch = ch.id.match(/\.([a-z]{2})(@|$)/i);
        const code = countryMatch ? countryMatch[1].toUpperCase() : '';
        if (code) {
          ch.countryCode = code;
          uniqueCountryCodes.add(code);
        } else {
          ch.countryCode = 'UNKNOWN';
        }
      });

      Array.from(uniqueCountryCodes)
        .sort((a, b) => a.localeCompare(b))
        .forEach(code => {
          const countryObj = this.state.countries.find(c => c.code === code);
          const flag = countryObj ? countryObj.flag : '';
          const name = countryObj ? countryObj.name : code;
          const label = flag ? `${flag} ${name}` : name;
          
          const opt = document.createElement('option');
          opt.value = code;
          opt.textContent = label;
          countrySelect.appendChild(opt);
        });

    } else if (mode === 'country') {
      countryWrapper.style.display = 'none';
      categoryWrapper.style.display = 'block';

      const uniqueCategories = new Set();
      this.state.allChannels.forEach(ch => {
        ch.groups.forEach(g => uniqueCategories.add(g));
      });

      Array.from(uniqueCategories)
        .sort((a, b) => a.localeCompare(b))
        .forEach(cat => {
          const opt = document.createElement('option');
          opt.value = cat;
          opt.textContent = cat;
          categorySelect.appendChild(opt);
        });
    } else {
      countryWrapper.style.display = 'none';
      categoryWrapper.style.display = 'none';
    }

    if (!this.state.filtersBound) {
      countrySelect.addEventListener('change', (e) => {
        this.state.activeCountryFilter = e.target.value;
        this.applyFiltersAndSort();
      });

      categorySelect.addEventListener('change', (e) => {
        this.state.activeCategoryFilter = e.target.value;
        this.applyFiltersAndSort();
      });

      document.getElementById('channel-sort').addEventListener('change', (e) => {
        this.state.activeSort = e.target.value;
        this.applyFiltersAndSort();
      });

      this.state.filtersBound = true;
    }

    this.state.activeCountryFilter = 'all';
    this.state.activeCategoryFilter = 'all';
    countrySelect.value = 'all';
    categorySelect.value = 'all';
  },

  applyFiltersAndSort() {
    let list = [];

    // 1. Determine base source list from Active Pill (All or Favorites or Group)
    if (this.state.activePillFilter === 'favs') {
      list = [...this.state.favorites];
    } else if (this.state.activePillFilter === 'sports') {
      list = this.state.allChannels.filter(ch => ch.groups.some(g => g.toLowerCase().includes('sports')));
    } else if (this.state.activePillFilter === 'news') {
      list = this.state.allChannels.filter(ch => ch.groups.some(g => g.toLowerCase().includes('news')));
    } else {
      list = [...this.state.allChannels];
    }

    // 2. Filter by search query
    const searchQuery = document.getElementById('sidebar-search-input').value.trim().toLowerCase();
    if (searchQuery) {
      list = list.filter(ch => 
        ch.name.toLowerCase().includes(searchQuery) ||
        ch.groups.some(g => g.toLowerCase().includes(searchQuery))
      );
    }

    // 3. Filter by country select dropdown
    if (this.state.activeCountryFilter !== 'all') {
      list = list.filter(ch => ch.countryCode === this.state.activeCountryFilter);
    }

    // 4. Filter by category select dropdown
    if (this.state.activeCategoryFilter !== 'all') {
      list = list.filter(ch => ch.groups.includes(this.state.activeCategoryFilter));
    }

    // 5. Apply Sort settings
    if (this.state.activeSort === 'name-asc') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (this.state.activeSort === 'name-desc') {
      list.sort((a, b) => b.name.localeCompare(a.name));
    }

    this.state.filteredChannels = list;
    
    // Render the channels inside the sidebar
    IPTVUI.renderChannels(list, '', false);

    // Deep link query param verification once playlist is loaded
    this.checkQueryParams();
  },

  loadStateFromStorage() {
    try {
      this.state.favorites = JSON.parse(localStorage.getItem('favorites')) || [];
      this.state.recents = JSON.parse(localStorage.getItem('recents')) || [];
      this.state.customPlaylists = JSON.parse(localStorage.getItem('custom-playlists')) || [];
      this.state.theme = localStorage.getItem('theme') || 'dark';
      
      const savedAutoplay = localStorage.getItem('settings-autoplay');
      if (savedAutoplay !== null) {
        this.state.autoplay = (savedAutoplay === 'true');
        IPTVPlayer.autoplay = this.state.autoplay;
      }

      // Restore proxy settings
      const savedUseProxy = localStorage.getItem('settings-use-proxy');
      if (savedUseProxy !== null) {
        IPTVPlayer.useProxy = (savedUseProxy === 'true');
        const toggle = document.getElementById('settings-use-proxy');
        const proxyRow = document.getElementById('proxy-url-row');
        if (toggle) toggle.checked = IPTVPlayer.useProxy;
        if (proxyRow) proxyRow.style.display = IPTVPlayer.useProxy ? 'flex' : 'none';
      }
      const savedProxyUrl = localStorage.getItem('settings-proxy-url');
      if (savedProxyUrl) {
        IPTVPlayer.proxyUrl = savedProxyUrl;
        const proxyInput = document.getElementById('settings-proxy-url');
        if (proxyInput) proxyInput.value = savedProxyUrl;
      }
    } catch (e) {
      console.warn('Error reading from LocalStorage:', e);
    }
  },

  saveStateToStorage() {
    try {
      localStorage.setItem('favorites', JSON.stringify(this.state.favorites));
      localStorage.setItem('recents', JSON.stringify(this.state.recents));
      localStorage.setItem('custom-playlists', JSON.stringify(this.state.customPlaylists));
    } catch(e) {
      console.warn('Error writing to LocalStorage:', e);
    }
  }
};

// Start application when DOM loads
window.addEventListener('DOMContentLoaded', () => {
  app.init();
});
