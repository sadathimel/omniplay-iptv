/**
 * DOM Rendering and Interface Management for OmniPlay IPTV
 */
const IPTVUI = {
  pageSize: 50,
  currentPage: 1,
  activeChannelsList: [],

  init() {
    this.registerGlobalEvents();
  },

  registerGlobalEvents() {
    // Mobile Sidebar collapse toggle
    const menuToggle = document.getElementById('mobile-menu-toggle');
    const sidebar = document.getElementById('sidebar');
    if (menuToggle && sidebar) {
      menuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('active');
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#sidebar') && !e.target.closest('#mobile-menu-toggle')) {
          sidebar.classList.remove('active');
        }
      });
    }

    // Modal Events
    this.setupModalTrigger('btn-open-custom', 'custom-playlist-modal', 'close-custom-modal', 'btn-cancel-custom');
    this.setupModalTrigger('btn-open-settings', 'settings-modal', 'close-settings-modal', 'btn-close-settings');
    this.setupModalTrigger(null, 'troubleshoot-modal', 'close-modal', 'modal-ok-btn');

    // Theme Toggle
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => this.toggleTheme());
    }

    // Load More Button
    const loadMoreBtn = document.getElementById('sidebar-load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => this.loadNextPage());
    }

    // Clear active filter button in sidebar
    const clearFiltersBtn = document.getElementById('clear-active-filters');
    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener('click', () => {
        app.resetFilters();
      });
    }

    // Brand logo click goes to dashboard
    const brand = document.getElementById('brand-logo-btn');
    if (brand) {
      brand.addEventListener('click', () => {
        app.switchView('dashboard');
      });
    }
  },

  /**
   * Configures click events to open and close a modal card
   */
  setupModalTrigger(openBtnId, modalId, closeBtnId, cancelBtnId) {
    const modal = document.getElementById(modalId);
    
    if (openBtnId) {
      const openBtn = document.getElementById(openBtnId);
      if (openBtn) {
        openBtn.addEventListener('click', () => {
          modal.classList.add('active');
          if (modalId === 'custom-playlist-modal') {
            app.renderSavedPlaylists();
          }
        });
      }
    }
    
    const closeBtn = document.getElementById(closeBtnId);
    if (closeBtn) {
      closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    }

    if (cancelBtnId) {
      const cancelBtn = document.getElementById(cancelBtnId);
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => modal.classList.remove('active'));
      }
    }
  },

  /**
   * Switches the active pane on the right side
   * @param {string} viewId - dashboard/welcome or player
   */
  switchView(viewId) {
    const welcomeStage = document.getElementById('stage-welcome');
    const playerStage = document.getElementById('stage-player');

    if (viewId === 'dashboard' || viewId === 'welcome') {
      welcomeStage.classList.add('active');
      playerStage.classList.remove('active');
    } else if (viewId === 'player') {
      welcomeStage.classList.remove('active');
      playerStage.classList.add('active');
    }
  },

  /**
   * Renders the channels list inside the left sidebar.
   * Supports pagination to maintain extreme smoothness.
   */
  renderChannels(channels, title = 'Channels', append = false) {
    const container = document.getElementById('sidebar-channel-container');
    const countText = document.getElementById('channels-count-text');
    const loadMoreContainer = document.getElementById('sidebar-load-more');
    const clearFiltersBtn = document.getElementById('clear-active-filters');

    if (!container) return;

    if (!append) {
      container.innerHTML = '';
      this.currentPage = 1;
      this.activeChannelsList = channels;
      countText.textContent = `${channels.length} channels loaded`;
      
      // Show clear filter button if we are filtered
      const isFiltered = app.state.activeCountryFilter !== 'all' || 
                         app.state.activeCategoryFilter !== 'all' || 
                         document.getElementById('sidebar-search-input').value.trim() !== '';
      clearFiltersBtn.style.display = isFiltered ? 'inline-block' : 'none';
    }

    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    const pageItems = this.activeChannelsList.slice(start, end);

    if (pageItems.length === 0 && !append) {
      container.innerHTML = `
        <div style="text-align: center; padding: 30px 10px; color: var(--text-dimmed); font-size: 13px;">
          <i data-lucide="video-off" style="width: 32px; height: 32px; margin-bottom: 10px; opacity: 0.5;"></i>
          <p>No Channels Found</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      loadMoreContainer.style.display = 'none';
      return;
    }

    pageItems.forEach(channel => {
      const card = this.createChannelCard(channel);
      container.appendChild(card);
    });

    if (end < this.activeChannelsList.length) {
      loadMoreContainer.style.display = 'block';
    } else {
      loadMoreContainer.style.display = 'none';
    }

    if (window.lucide) {
      window.lucide.createIcons();
    }
  },

  loadNextPage() {
    this.currentPage++;
    this.renderChannels(this.activeChannelsList, '', true);
  },

  /**
   * DOM builder for vertical sidebar channel card
   */
  createChannelCard(channel) {
    const isFav = app.isFavorite(channel.id);
    const isActive = IPTVPlayer.currentChannel && IPTVPlayer.currentChannel.id === channel.id;
    
    const card = document.createElement('div');
    card.className = `sidebar-channel-card ${isActive ? 'active' : ''}`;
    card.setAttribute('data-channel-id', channel.id);

    card.addEventListener('click', (e) => {
      if (e.target.closest('.sidebar-fav-btn')) return;
      
      // Update active selection visual border
      document.querySelectorAll('.sidebar-channel-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      
      app.playChannel(channel);
    });

    // Fallbacks
    const initLetters = channel.name.substring(0, 2).toUpperCase();
    const logoHtml = channel.logo 
      ? `<img src="${channel.logo}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`
      : '';
    const placeholderStyle = this.getGradientStyleForName(channel.name);

    card.innerHTML = `
      <div class="card-logo-box">
        ${logoHtml}
        <div class="logo-fallback" style="display: ${channel.logo ? 'none' : 'flex'}; ${placeholderStyle}; font-size: 10px; font-weight: 700; width: 100%; height: 100%; border-radius: 4px;">
          ${initLetters}
        </div>
      </div>
      <div class="card-info">
        <span class="card-name" title="${channel.name}">${channel.name}</span>
        <span class="card-meta">${channel.groups[0] || 'Live TV'}</span>
      </div>
      <div class="card-actions">
        <button class="sidebar-fav-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Remove Favorite' : 'Add Favorite'}">
          <i data-lucide="heart"></i>
        </button>
      </div>
    `;

    // Heart toggle trigger
    const favButton = card.querySelector('.sidebar-fav-btn');
    favButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const active = app.toggleFavorite(channel);
      favButton.classList.toggle('active', active);
      favButton.setAttribute('title', active ? 'Remove Favorite' : 'Add Favorite');
      
      // If we are currently in Favorites view pill, we filter out immediately
      if (app.state.activePillFilter === 'favs') {
        app.applyFiltersAndSort();
      }
    });

    return card;
  },

  /**
   * Renders the grid selectors for categories on welcome screen and player footer
   */
  renderCategories(categories) {
    const welcomeGrid = document.getElementById('welcome-categories-grid');
    const playerGrid = document.getElementById('player-categories-grid');

    const buildCards = (container) => {
      if (!container) return;
      container.innerHTML = '';

      categories.forEach(cat => {
        const card = document.createElement('div');
        card.className = 'selector-card';
        const iconName = this.getIconForCategory(cat.id);

        card.innerHTML = `
          <div class="selector-card-icon">
            <i data-lucide="${iconName}"></i>
          </div>
          <span class="selector-card-name">${cat.name}</span>
        `;

        card.addEventListener('click', () => {
          app.loadCategoryPlaylist(cat.id, cat.name);
          // Scroll list to top
          document.getElementById('sidebar-channel-container').scrollTop = 0;
        });

        container.appendChild(card);
      });
    };

    buildCards(welcomeGrid);
    buildCards(playerGrid);

    if (window.lucide) window.lucide.createIcons();
  },

  /**
   * Renders the grid selectors for countries
   */
  renderCountries(countries) {
    const grid = document.getElementById('welcome-countries-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Filter to top countries to avoid layout clutter
    const popularCodes = ['US', 'UK', 'CA', 'FR', 'DE', 'IN', 'ES', 'BR', 'IT', 'BD'];
    const filtered = countries.filter(c => popularCodes.includes(c.code));

    filtered.forEach(country => {
      const card = document.createElement('div');
      card.className = 'selector-card';

      card.innerHTML = `
        <div class="selector-card-flag">
          ${country.flag || '🏳️'}
        </div>
        <span class="selector-card-name">${country.name}</span>
      `;

      card.addEventListener('click', () => {
        app.loadCountryPlaylist(country.code.toLowerCase(), country.name);
        document.getElementById('sidebar-channel-container').scrollTop = 0;
      });

      grid.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
  },

  /**
   * Updates details in the right-pane stream info panel
   */
  updateActivePlayerInfo(channel) {
    const nameEl = document.getElementById('info-channel-name');
    const groupEl = document.getElementById('info-channel-group');
    const logoImg = document.getElementById('info-channel-logo');
    const logoFallback = document.getElementById('info-logo-fallback');
    const favIcon = document.getElementById('info-fav-icon');

    if (!channel) return;

    nameEl.textContent = channel.name;
    groupEl.textContent = channel.groups[0] || 'General';

    // Logo setup
    if (channel.logo) {
      logoImg.src = channel.logo;
      logoImg.style.display = 'block';
      logoFallback.style.display = 'none';
    } else {
      logoImg.style.display = 'none';
      logoFallback.style.display = 'flex';
      logoFallback.textContent = channel.name.substring(0, 2).toUpperCase();
      logoFallback.setAttribute('style', this.getGradientStyleForName(channel.name) + ' font-size:14px; width:100%; height:100%; border-radius:8px;');
    }

    // Resolution badge guessing based on name
    const resBadge = document.getElementById('info-channel-resolution');
    const matches = channel.name.match(/\((\d+p)\)/i);
    resBadge.textContent = matches ? matches[1] : '720p';

    // Update favorite heart button in main panel
    const isFav = app.isFavorite(channel.id);
    favIcon.setAttribute('data-lucide', isFav ? 'heart-off' : 'heart');
    const favButton = document.getElementById('btn-fav-toggle');
    favButton.className = `btn ${isFav ? 'btn-danger' : 'btn-secondary'} btn-sm`;
    
    if (isFav) {
      favButton.innerHTML = `<i data-lucide="heart-off"></i> Unfavorite`;
    } else {
      favButton.innerHTML = `<i data-lucide="heart"></i> Favorite`;
    }

    if (window.lucide) window.lucide.createIcons();
  },

  updateConnectionStatus(state, text = '') {
    // Only update indicator on mobile header
    const indicator = document.querySelector('.mobile-header .status-indicator');
    if (indicator) {
      indicator.className = `status-indicator ${state}`;
    }
  },

  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    
    const themeBtn = document.getElementById('theme-toggle').querySelector('i');
    themeBtn.setAttribute('data-lucide', newTheme === 'dark' ? 'moon' : 'sun');
    if (window.lucide) window.lucide.createIcons();
    
    localStorage.setItem('theme', newTheme);
  },

  getIconForCategory(id) {
    const iconMap = {
      news: 'globe-2',
      sports: 'trophy',
      movies: 'clapperboard',
      animation: 'smile',
      kids: 'baby',
      music: 'music-4',
      documentary: 'camera',
      culture: 'palette',
      education: 'graduation-cap',
      general: 'tv',
      cooking: 'utensils',
      comedy: 'laugh',
      classic: 'archive',
      business: 'briefcase',
      auto: 'car'
    };
    return iconMap[id] || 'tv';
  },

  getGradientStyleForName(name) {
    const gradients = [
      'linear-gradient(135deg, #6366f1 0%, #ec4899 100%)',
      'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
      'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
      'linear-gradient(135deg, #ec4899 0%, #be185d 100%)'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % gradients.length;
    return `background: ${gradients[index]}; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 700;`;
  }
};
