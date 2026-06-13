/**
 * OmniPlay IPTV - Local Dev Server with HLS-Aware CORS Proxy
 * 
 * Endpoints:
 *   GET /              -> serves index.html
 *   GET /static/*      -> serves static files
 *   GET /proxy?url=URL -> full CORS proxy with M3U8 URL-rewriting for HLS
 */
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

// ─── CORS headers added to every proxy response ─────────────────────────────
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers','Content-Length, Content-Type');
}

// ─── Rewrite M3U8 content so every URL routes through our local proxy ────────
function rewriteM3U8(content, baseUrl) {
  const base = new URL(baseUrl);

  return content.split('\n').map(line => {
    const trimmed = line.trim();

    // Skip empty lines and pure tag lines that have no URL value
    if (!trimmed || (trimmed.startsWith('#') && !trimmed.includes('URI="'))) {
      // Handle URI="..." inside tags (e.g. #EXT-X-KEY URI="...")
      if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
          const absolute = resolveUrl(uri, base);
          return `URI="/proxy?url=${encodeURIComponent(absolute)}"`;
        });
      }
      return line;
    }

    // Non-comment lines that look like URLs or relative paths
    if (!trimmed.startsWith('#')) {
      const absolute = resolveUrl(trimmed, base);
      return `/proxy?url=${encodeURIComponent(absolute)}`;
    }

    return line;
  }).join('\n');
}

function resolveUrl(uri, base) {
  try {
    // Already absolute
    if (/^https?:\/\//i.test(uri)) return uri;
    // Absolute path (starts with /)
    if (uri.startsWith('/')) return `${base.protocol}//${base.host}${uri}`;
    // Relative path
    const baseDir = base.href.substring(0, base.href.lastIndexOf('/') + 1);
    return baseDir + uri;
  } catch (_) {
    return uri;
  }
}

// ─── Fetch a remote URL and stream / rewrite it ──────────────────────────────
function proxyRequest(targetUrl, req, res) {
  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch (e) {
    res.statusCode = 400;
    res.end('Invalid proxy target URL');
    return;
  }

  const lib = parsedTarget.protocol === 'https:' ? https : http;

  const options = {
    hostname: parsedTarget.hostname,
    port:     parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80),
    path:     parsedTarget.pathname + parsedTarget.search,
    method:   'GET',
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept':          '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer':         `${parsedTarget.protocol}//${parsedTarget.host}/`,
      'Origin':          `${parsedTarget.protocol}//${parsedTarget.host}`,
    },
    timeout: 15000,
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    setCorsHeaders(res);

    // Follow 301/302 redirects (up to 3 hops)
    if ([301, 302, 307, 308].includes(proxyRes.statusCode)) {
      const location = proxyRes.headers['location'];
      if (location) {
        const redirectUrl = /^https?:\/\//i.test(location)
          ? location
          : resolveUrl(location, parsedTarget);
        proxyRequest(redirectUrl, req, res);
        proxyRes.resume(); // drain original response
        return;
      }
    }

    const contentType = proxyRes.headers['content-type'] || '';
    const isM3U8 = contentType.includes('mpegurl') ||
                   contentType.includes('x-mpegurl') ||
                   targetUrl.includes('.m3u8') ||
                   targetUrl.includes('.m3u');

    res.statusCode = proxyRes.statusCode;
    res.setHeader('Content-Type', isM3U8 ? 'application/vnd.apple.mpegurl' : contentType);

    if (isM3U8) {
      // Buffer the whole manifest, rewrite URLs, then send
      let body = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', chunk => { body += chunk; });
      proxyRes.on('end', () => {
        const rewritten = rewriteM3U8(body, targetUrl);
        res.setHeader('Content-Length', Buffer.byteLength(rewritten, 'utf8'));
        res.end(rewritten);
        console.log(`[PROXY M3U8] ${targetUrl.substring(0, 80)}...`);
      });
    } else {
      // Binary content (TS segments, keys, etc.) — pipe directly
      res.setHeader('Content-Length', proxyRes.headers['content-length'] || '');
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      setCorsHeaders(res);
      res.statusCode = 504;
      res.end('Proxy timeout');
    }
  });

  proxyReq.on('error', (err) => {
    console.error('[PROXY ERROR]', err.message);
    if (!res.headersSent) {
      setCorsHeaders(res);
      res.statusCode = 502;
      res.end(`Proxy error: ${err.message}`);
    }
  });

  proxyReq.end();
}

// ─── Main HTTP Server ────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname  = parsedUrl.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  // ── /proxy?url=... endpoint ──────────────────────────────────────────────
  if (pathname === '/proxy') {
    const targetUrl = parsedUrl.query.url;
    if (!targetUrl) {
      res.statusCode = 400;
      res.end('Missing ?url= parameter');
      return;
    }
    console.log(`[PROXY] ${req.method} ${targetUrl.substring(0, 100)}`);
    proxyRequest(targetUrl, req, res);
    return;
  }

  // ── Static file serving ──────────────────────────────────────────────────
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const absolutePath = path.join(__dirname, filePath);

  // Security: prevent path traversal
  if (!absolutePath.startsWith(__dirname)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.stat(absolutePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`
        <div style="font-family:sans-serif;text-align:center;padding:50px;background:#0b0b14;color:#f3f4f6;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <h1 style="font-size:48px;color:#ef4444;margin-bottom:20px;">404</h1>
          <p style="color:#9ca3af;margin-bottom:30px;">Not found: ${filePath}</p>
          <a href="/" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">← Back to Dashboard</a>
        </div>
      `);
      return;
    }

    const ext         = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);

    const stream = fs.createReadStream(absolutePath);
    stream.on('error', () => { res.statusCode = 500; res.end('Read error'); });
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('\n==================================================');
  console.log(`🚀 OmniPlay IPTV Server running!`);
  console.log(`📺 App:   http://localhost:${PORT}`);
  console.log(`🛡️  Proxy: http://localhost:${PORT}/proxy?url=<STREAM_URL>`);
  console.log('==================================================\n');
});
