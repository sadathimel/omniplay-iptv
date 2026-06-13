/**
 * Custom HLS Video Player Engine and UI Controls for OmniPlay IPTV
 */
const IPTVPlayer = {
  video: null,
  hls: null,
  wrapper: null,
  loadingOverlay: null,
  errorOverlay: null,
  errorMessage: null,
  playIcon: null,
  volumeIcon: null,
  volumeSlider: null,
  channelNameText: null,

  currentChannel: null,
  aspectRatios: ['auto', '16-9', '4-3', 'fill'],
  currentAspectRatioIndex: 0,
  autoplay: true,

  // CORS Proxy support — routes through local server /proxy endpoint
  proxyUrl: '/proxy?url=',
  useProxy: false,
  _retriedWithProxy: false,

  // Auto-advance tracking
  failedChannels: new Set(),  // IDs of channels that failed
  _autoAdvanceTimer: null,
  autoAdvance: true,          // auto-skip to next on failure
  _scanMode: false,           // true when scanning for a working channel

  init() {
    this.video = document.getElementById('iptv-video-player');
    this.wrapper = document.getElementById('video-wrapper');
    this.loadingOverlay = document.getElementById('player-loading-overlay');
    this.errorOverlay = document.getElementById('player-error-overlay');
    this.errorMessage = document.getElementById('player-error-message');
    this.playIcon = document.getElementById('play-icon');
    this.volumeIcon = document.getElementById('volume-icon');
    this.volumeSlider = document.getElementById('volume-slider');

    // Register Native Event Listeners
    this.registerControls();
    
    // Init icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  },

  registerControls() {
    const playPauseBtn = document.getElementById('ctrl-play-pause');
    const muteBtn = document.getElementById('ctrl-mute');
    const aspectRatioBtn = document.getElementById('ctrl-aspect-ratio');
    const pipBtn = document.getElementById('ctrl-pip');
    const theaterBtn = document.getElementById('ctrl-theater');
    const fullscreenBtn = document.getElementById('ctrl-fullscreen');
    const closeBtn = document.getElementById('ctrl-close-panel');
    const retryBtn = document.getElementById('player-retry-btn');
    const nextBtn  = document.getElementById('player-next-btn');
    const troubleshootBtn = document.getElementById('player-troubleshoot-btn');

    // Play/Pause Playback
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', () => this.togglePlay());
    }
    if (this.video) {
      this.video.addEventListener('click', () => this.togglePlay());
      this.video.addEventListener('play', () => this.updatePlayBtn(true));
      this.video.addEventListener('pause', () => this.updatePlayBtn(false));
      this.video.addEventListener('waiting', () => this.setLoading(true));
      this.video.addEventListener('playing', () => this.setLoading(false));
      this.video.addEventListener('canplay', () => this.setLoading(false));
      this.video.addEventListener('timeupdate', () => {
        if (this.video.currentTime > 0) {
          this.setLoading(false);
        }
      });
    }

    // Volume Adjustment
    if (this.volumeSlider) {
      this.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));
    }
    if (muteBtn) {
      muteBtn.addEventListener('click', () => this.toggleMute());
    }

    // Screen Modes
    if (aspectRatioBtn) {
      aspectRatioBtn.addEventListener('click', () => this.cycleAspectRatio());
    }
    if (pipBtn) {
      pipBtn.addEventListener('click', () => this.togglePiP());
    }
    if (theaterBtn) {
      theaterBtn.addEventListener('click', () => this.toggleTheaterMode());
    }
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closePanel());
    }

    // Error Handlers
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.retry());
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.playNextChannel());
    }
    if (troubleshootBtn) {
      troubleshootBtn.addEventListener('click', () => this.showTroubleshoot());
    }

    // "Try Next Channel" inside troubleshoot modal
    const modalNextBtn = document.getElementById('modal-next-channel-btn');
    if (modalNextBtn) {
      modalNextBtn.addEventListener('click', () => {
        document.getElementById('troubleshoot-modal').classList.remove('active');
        this.playNextChannel();
      });
    }

    // Native full screen listener to reset controls style if needed
    document.addEventListener('fullscreenchange', () => {
      const isFull = !!document.fullscreenElement;
      if (fullscreenBtn) {
        const icon = fullscreenBtn.querySelector('i');
        if (icon) {
          icon.setAttribute('data-lucide', isFull ? 'minimize' : 'maximize');
        }
      }
      window.lucide.createIcons({ attrs: { class: 'lucide' } });
    });
  },

  /**
   * Primary loading entrypoint for any channel stream.
   * @param {Object} channel - Channel object containing name and url.
   */
  loadChannel(channel, forceProxy = false) {
    if (!channel || !channel.url) return;

    this.currentChannel = channel;
    this._retriedWithProxy = forceProxy;

    this.setLoading(true);
    this.clearError();

    // Check if the URL is already proxied (e.g. LiveTV channels pre-proxied in app.js)
    const alreadyProxied = channel.url.startsWith('/proxy?url=') || channel.url.includes('/proxy?url=');

    // Determine stream URL — use proxy if toggled on or forced, but don't double-proxy
    const shouldProxy = !alreadyProxied && (forceProxy || this.useProxy);
    const rawUrl = channel.url;
    // Use a simple relative path so it works on any host (localhost or deployed)
    const streamUrl = (shouldProxy && !alreadyProxied)
      ? `/proxy?url=${encodeURIComponent(rawUrl)}`
      : rawUrl;

    // Show/hide proxy status badge in controls bar
    this._updateProxyBadge(shouldProxy || alreadyProxied);

    if (shouldProxy || alreadyProxied) {
      console.log('🛡️ Routing stream through CORS proxy:', streamUrl);
    }

    // Stop any existing stream
    this.destroyHls();

    if (Hls.isSupported()) {
      this.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferSize: 30 * 1024 * 1024, // 30MB
        maxBufferLength: 20, // 20s
        xhrSetup: (xhr, url) => {
          // Custom headers (may fail CORS preflight without proxy)
          if (channel.headers && !shouldProxy) {
            Object.keys(channel.headers).forEach(h => {
              try {
                xhr.setRequestHeader(h, channel.headers[h]);
              } catch(e) {
                console.warn(`Failed to set header ${h}: `, e);
              }
            });
          }
        }
      });

      this.hls.loadSource(streamUrl);
      this.hls.attachMedia(this.video);

      // HLS Error Handling
      this.hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error('HLS Fatal Network Error:', data);
              if (!this._retriedWithProxy && !this.useProxy && !alreadyProxied) {
                // Step 1: retry once via proxy
                console.log('⚡ Auto-retrying with CORS proxy...');
                this._retriedWithProxy = true;
                this.setLoading(true);
                this.clearError();
                this.setStatusBanner('Retrying via proxy...');
                setTimeout(() => this.loadChannel(channel, true), 800);
              } else {
                // Step 2: mark channel as dead and auto-advance
                this._markChannelFailed(channel);
                if (this.autoAdvance && !this._scanMode) {
                  this._startAutoAdvanceCountdown();
                } else if (this._scanMode) {
                  // In scan mode — immediately skip
                  this.playNextChannel();
                } else {
                  this.showError(
                    `Stream is offline or geo-blocked.\nAuto-scanning is ${this.autoAdvance ? 'on' : 'off'}.`
                  );
                }
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error('HLS Fatal Media Error:', data);
              this.hls.recoverMediaError();
              break;
            default:
              this.destroyHls();
              this._markChannelFailed(channel);
              if (this.autoAdvance) {
                this._startAutoAdvanceCountdown();
              } else {
                this.showError('Stream failed to play.');
              }
              break;
          }
        }
      });

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.setLoading(false);
        this.clearStatusBanner();
        if (this.autoplay) {
          this.video.play().catch(e => {
            console.log('Autoplay blocked, showing play indicator.');
            this.updatePlayBtn(false);
          });
        }
      });

    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari support
      this.video.src = streamUrl;
      this.video.addEventListener('loadedmetadata', () => {
        this.setLoading(false);
        if (this.autoplay) {
          this.video.play().catch(() => {});
        }
      });
      this.video.addEventListener('error', (e) => {
        if (!this._retriedWithProxy && !this.useProxy) {
          this._retriedWithProxy = true;
          setTimeout(() => this.loadChannel(channel, true), 800);
        } else {
          this.showError('Native browser error: Playback failed. Stream may be offline or geo-blocked.');
        }
      });
    } else {
      this.showError('Your browser does not support HLS stream playback (.m3u8).');
    }
  },

  setStatusBanner(msg) {
    let banner = document.getElementById('player-status-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'player-status-banner';
      banner.style.cssText = `
        position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
        background: rgba(99,102,241,0.92); color: #fff; padding: 6px 18px;
        border-radius: 20px; font-size: 13px; font-weight: 600;
        z-index: 20; backdrop-filter: blur(8px); white-space: nowrap;
        box-shadow: 0 4px 16px rgba(99,102,241,0.4);
      `;
      this.wrapper && this.wrapper.appendChild(banner);
    }
    banner.textContent = msg;
    banner.style.display = 'block';
  },

  clearStatusBanner() {
    const banner = document.getElementById('player-status-banner');
    if (banner) banner.style.display = 'none';
  },

  _updateProxyBadge(show) {
    const streamInfo = document.querySelector('.stream-info-overlay');
    if (!streamInfo) return;
    let badge = streamInfo.querySelector('.proxy-badge');
    if (show) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'proxy-badge';
        badge.textContent = 'PROXY';
        streamInfo.appendChild(badge);
      }
    } else {
      if (badge) badge.remove();
    }
  },

  togglePlay() {
    if (this.video.paused) {
      this.video.play().catch(err => console.log('Playback error:', err));
    } else {
      this.video.pause();
    }
  },

  updatePlayBtn(isPlaying) {
    this.playIcon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
    window.lucide.createIcons({ attrs: { class: 'lucide' } });
  },

  setVolume(val) {
    this.video.volume = val;
    this.video.muted = (val === 0);
    this.updateVolumeIcon(val, this.video.muted);
  },

  toggleMute() {
    this.video.muted = !this.video.muted;
    this.volumeSlider.value = this.video.muted ? 0 : this.video.volume;
    this.updateVolumeIcon(this.video.muted ? 0 : this.video.volume, this.video.muted);
  },

  updateVolumeIcon(volume, isMuted) {
    let iconName = 'volume-2';
    if (isMuted || volume === 0) {
      iconName = 'volume-x';
    } else if (volume < 0.3) {
      iconName = 'volume';
    } else if (volume < 0.7) {
      iconName = 'volume-1';
    }
    this.volumeIcon.setAttribute('data-lucide', iconName);
    window.lucide.createIcons({ attrs: { class: 'lucide' } });
  },

  setLoading(isLoading) {
    this.loadingOverlay.style.display = isLoading ? 'flex' : 'none';
  },

  showError(msg) {
    this.setLoading(false);
    this.errorMessage.textContent = msg;
    this.errorOverlay.style.display = 'flex';
  },

  clearError() {
    this.errorOverlay.style.display = 'none';
  },

  retry() {
    if (this.currentChannel) {
      this._retriedWithProxy = false; // allow proxy retry again
      this.loadChannel(this.currentChannel);
    }
  },

  /**
   * Marks a channel as failed: adds to failedChannels set and dims the sidebar card.
   */
  _markChannelFailed(channel) {
    if (!channel) return;
    this.failedChannels.add(channel.id);
    const card = document.querySelector(`.sidebar-channel-card[data-channel-id="${channel.id}"]`);
    if (card) {
      card.classList.add('channel-dead');
      // Add a small dead indicator if not already there
      if (!card.querySelector('.dead-dot')) {
        const dot = document.createElement('span');
        dot.className = 'dead-dot';
        dot.title = 'Stream offline';
        card.querySelector('.card-info').appendChild(dot);
      }
    }
  },

  /**
   * Shows a countdown overlay then auto-advances to next channel.
   * The user can cancel it by clicking "Stay here".
   */
  _startAutoAdvanceCountdown() {
    this.clearError();
    clearTimeout(this._autoAdvanceTimer);

    let secs = 3;
    this.showError(`Stream offline. Trying next channel in ${secs}s…`);

    // Add cancel button to error overlay
    const actions = this.errorOverlay.querySelector('.error-actions');
    let cancelBtn = document.getElementById('player-cancel-advance');
    if (!cancelBtn) {
      cancelBtn = document.createElement('button');
      cancelBtn.id = 'player-cancel-advance';
      cancelBtn.className = 'btn btn-sm btn-text';
      cancelBtn.textContent = 'Stay here';
      cancelBtn.onclick = () => this.cancelAutoAdvance();
      actions.appendChild(cancelBtn);
    }
    cancelBtn.style.display = 'inline-flex';

    const tick = () => {
      secs--;
      if (secs <= 0) {
        cancelBtn.style.display = 'none';
        this.playNextChannel();
      } else {
        this.errorMessage.textContent = `Stream offline. Trying next channel in ${secs}s…`;
        this._autoAdvanceTimer = setTimeout(tick, 1000);
      }
    };
    this._autoAdvanceTimer = setTimeout(tick, 1000);
  },

  cancelAutoAdvance() {
    clearTimeout(this._autoAdvanceTimer);
    const cancelBtn = document.getElementById('player-cancel-advance');
    if (cancelBtn) cancelBtn.style.display = 'none';
    this.showError('Stream is offline or geo-blocked.');
  },

  /**
   * Plays the next channel in the list, skipping known-dead channels.
   * In scan mode it will keep going until it finds a live stream.
   */
  playNextChannel() {
    clearTimeout(this._autoAdvanceTimer);
    const channels = app.state.filteredChannels;
    if (!channels || channels.length === 0) return;

    let startIndex = 0;
    if (this.currentChannel) {
      const currentIndex = channels.findIndex(ch => ch.id === this.currentChannel.id);
      if (currentIndex !== -1) startIndex = currentIndex;
    }

    // Find next channel not in failedChannels (wrap around)
    const total = channels.length;
    let checked = 0;
    let nextIndex = (startIndex + 1) % total;

    while (checked < total) {
      const candidate = channels[nextIndex];
      if (!this.failedChannels.has(candidate.id)) {
        // Highlight card in sidebar
        document.querySelectorAll('.sidebar-channel-card').forEach(c => c.classList.remove('active'));
        const card = document.querySelector(`.sidebar-channel-card[data-channel-id="${candidate.id}"]`);
        if (card) {
          card.classList.add('active');
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        app.playChannel(candidate);
        return;
      }
      nextIndex = (nextIndex + 1) % total;
      checked++;
    }

    // All channels tried and failed
    this._scanMode = false;
    this.showError('No working streams found in this list. Try a different country or category.');
  },

  showTroubleshoot() {
    document.getElementById('troubleshoot-modal').classList.add('active');
  },

  cycleAspectRatio() {
    this.currentAspectRatioIndex = (this.currentAspectRatioIndex + 1) % this.aspectRatios.length;
    const activeAspect = this.aspectRatios[this.currentAspectRatioIndex];
    
    // Clean old aspects
    this.wrapper.classList.remove('fit-16-9', 'fit-4-3', 'fit-fill');
    
    if (activeAspect === '16-9') {
      this.wrapper.classList.add('fit-16-9');
    } else if (activeAspect === '4-3') {
      this.wrapper.classList.add('fit-4-3');
    } else if (activeAspect === 'fill') {
      this.wrapper.classList.add('fit-fill');
    }
    
    console.log(`Switched aspect ratio to: ${activeAspect}`);
  },

  async togglePiP() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (this.video && document.pictureInPictureEnabled) {
        await this.video.requestPictureInPicture();
      }
    } catch (err) {
      console.error('Picture in Picture failed:', err);
    }
  },

  toggleTheaterMode() {
    const panel = document.getElementById('cinema-player-panel');
    const isTheater = panel.classList.toggle('theater-mode');
    
    // Toggle label spacing
    document.body.style.paddingBottom = isTheater ? '70vh' : '100vh';
  },

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.wrapper.requestFullscreen().catch(err => {
        console.error(`Fullscreen failed: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  },

  closePanel() {
    this.destroyHls();
    app.switchView('dashboard');
  },

  destroyHls() {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }
};
