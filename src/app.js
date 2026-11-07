'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createApi } = require('./api');
const { createSessionStore } = require('./auth');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const APP_ROUTES = ['/', '/login', '/register', '/history', '/rules'];

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
}

/**
 * Cross-site request protection for the JSON API, on top of SameSite cookies:
 * every state-changing call must be JSON (forms can't send that) and, when the
 * browser says where it came from, come from this same site.
 */
function sameOriginJsonOnly(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (!req.is('application/json')) return res.status(415).json({ error: 'Expected a JSON request' });
  const origin = req.get('origin');
  if (origin) {
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {
      // fall through with host = null
    }
    if (host !== req.host) return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  next();
}

function createApp({ config, db, log = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders);

  const sessions = createSessionStore(db, config);
  app.locals.sessions = sessions;

  const ping = db.prepare('SELECT 1');
  app.get('/healthz', (req, res) => {
    ping.get();
    res.type('text').send('ok');
  });

  app.use(
    '/api',
    (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    },
    express.json({ limit: '10kb' }),
    sameOriginJsonOnly,
    sessions.load,
    createApi({ config, db, sessions, log }),
  );
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json').set('Cache-Control', 'no-cache');
    res.send(
      JSON.stringify({
        name: config.appName,
        short_name: config.appName,
        description: 'Monthly UFC scoreboard',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0b0d',
        theme_color: '#0b0b0d',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      }),
    );
  });

  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      setHeaders(res, filePath) {
        const rel = path.relative(PUBLIC_DIR, filePath);
        if (rel.startsWith('fonts')) res.set('Cache-Control', 'public, max-age=31536000, immutable');
        else if (rel.startsWith('icons')) res.set('Cache-Control', 'public, max-age=604800');
        else res.set('Cache-Control', 'no-cache'); // revalidate (ETag) so deploys show up at once
      },
    }),
  );

  const indexHtml = fs
    .readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
    .replaceAll('%APP_NAME%', escapeHtml(config.appName));
  app.get(APP_ROUTES, (req, res) => {
    res.set('Cache-Control', 'no-cache').type('html').send(indexHtml);
  });

  // Unknown page → home. Unknown file (has an extension) → plain 404.
  app.use((req, res) => {
    if (req.method === 'GET' && !path.extname(req.path)) return res.redirect(302, '/');
    res.status(404).type('text').send('Not found');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    log.error(err);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  });

  return app;
}

module.exports = { createApp };
