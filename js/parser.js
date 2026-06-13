/**
 * M3U Playlist Parser for OmniPlay IPTV
 */
const M3UParser = {
  /**
   * Parses raw M3U playlist content into a structured array of channel objects.
   * @param {string} rawContent - Raw M3U file text content.
   * @returns {Array<Object>} List of channels.
   */
  parse(rawContent) {
    if (!rawContent) return [];

    const lines = rawContent.split(/\r?\n/);
    const channels = [];
    let currentChannel = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        // Start of a channel item
        currentChannel = this.parseExtInf(line);
      } else if (line.startsWith('#EXTVLCOPT:')) {
        // Option parameters
        if (currentChannel) {
          const opt = this.parseVlcOption(line);
          if (opt) {
            currentChannel.headers = currentChannel.headers || {};
            currentChannel.headers[opt.key] = opt.value;
          }
        }
      } else if (line && !line.startsWith('#')) {
        // Streaming URL (non-empty line not starting with #)
        if (currentChannel) {
          currentChannel.url = line;
          channels.push(currentChannel);
          currentChannel = null; // Reset for next channel
        }
      }
    }

    return channels;
  },

  /**
   * Helper to parse attributes from #EXTINF line
   * Example: #EXTINF:-1 tvg-id="3ABNKids.us@SD" tvg-logo="https://i.imgur.com/z3npqO1.png" group-title="Animation;Kids",3ABN Kids Network
   */
  parseExtInf(line) {
    const channel = {
      id: '',
      name: 'Unknown Channel',
      logo: '',
      groups: [],
      url: '',
      headers: null
    };

    // Extract everything before the last comma (attributes) and after (name)
    const lastCommaIndex = line.lastIndexOf(',');
    if (lastCommaIndex !== -1) {
      channel.name = line.substring(lastCommaIndex + 1).trim();
      
      // Remove the display resolution suffix from name if present (e.g. " (1080p)")
      channel.name = channel.name.replace(/\s*\(\d+p\)\s*/gi, '').trim();
    }

    const attrPart = line.substring(0, lastCommaIndex !== -1 ? lastCommaIndex : line.length);

    // Extract attributes using regex
    channel.id = this.extractAttribute(attrPart, 'tvg-id') || this.extractAttribute(attrPart, 'channel-id') || this.generateFallbackId(channel.name);
    channel.logo = this.extractAttribute(attrPart, 'tvg-logo') || this.extractAttribute(attrPart, 'logo');
    
    // Extract group/categories
    const groupTitle = this.extractAttribute(attrPart, 'group-title') || this.extractAttribute(attrPart, 'category') || '';
    if (groupTitle) {
      // Split groups by semicolon or comma and clean them up
      channel.groups = groupTitle.split(/[;,]/).map(g => g.trim()).filter(Boolean);
    } else {
      channel.groups = ['Uncategorized'];
    }

    // Extract HTTP headers embedded directly in the #EXTINF (some formats do this)
    const referrer = this.extractAttribute(attrPart, 'http-referrer') || this.extractAttribute(attrPart, 'referrer');
    const userAgent = this.extractAttribute(attrPart, 'http-user-agent') || this.extractAttribute(attrPart, 'user-agent');
    
    if (referrer || userAgent) {
      channel.headers = {};
      if (referrer) channel.headers['Referer'] = referrer;
      if (userAgent) channel.headers['User-Agent'] = userAgent;
    }

    return channel;
  },

  /**
   * Extracts a specific attribute by key from M3U line part
   */
  extractAttribute(text, key) {
    // Matches key="value" or key=value
    const regex = new RegExp(`${key}\\s*=\\s*["']([^"']*)["']`, 'i');
    const match = text.match(regex);
    if (match) return match[1];

    // Fallback: match without quotes (e.g. key=value)
    const regexNoQuotes = new RegExp(`${key}\\s*=\\s*([^\\s]*)`, 'i');
    const matchNoQuotes = text.match(regexNoQuotes);
    if (matchNoQuotes) return matchNoQuotes[1];

    return null;
  },

  /**
   * Helper to parse VLC options like: #EXTVLCOPT:http-user-agent=Mozilla/5.0
   */
  parseVlcOption(line) {
    const cleanLine = line.replace('#EXTVLCOPT:', '').trim();
    const equalsIndex = cleanLine.indexOf('=');
    if (equalsIndex !== -1) {
      const key = cleanLine.substring(0, equalsIndex).trim().toLowerCase();
      const value = cleanLine.substring(equalsIndex + 1).trim();

      // We map VLC keys to HTTP Header keys if possible
      if (key === 'http-user-agent') {
        return { key: 'User-Agent', value };
      } else if (key === 'http-referrer') {
        return { key: 'Referer', value };
      }
    }
    return null;
  },

  /**
   * Utility to generate a clean, safe ID from channel name
   */
  generateFallbackId(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
};
