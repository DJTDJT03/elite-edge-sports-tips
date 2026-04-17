/**
 * Elite Edge Sports Tips — UK Geo-Restriction Middleware
 * Set GEO_RESTRICT=true in env to enforce (disabled in dev by default)
 */
module.exports = function applyGeoRestriction(app) {
  const GEO_RESTRICT = process.env.GEO_RESTRICT === 'true';
  const ALLOWED_COUNTRIES = ['GB', 'UK', 'IE'];

  if (GEO_RESTRICT) {
    app.use(async (req, res, next) => {
      if (!req.path.startsWith('/api/')) return next();
      try {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
        if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
        const https = require('https');
        const geoData = await new Promise((resolve) => {
          https.get(`https://ipapi.co/${ip}/json/`, (resp) => {
            let data = '';
            resp.on('data', chunk => data += chunk);
            resp.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({}); } });
          }).on('error', () => resolve({}));
        });
        if (geoData.country_code && !ALLOWED_COUNTRIES.includes(geoData.country_code)) {
          return res.status(403).json({ error: 'This service is only available in the United Kingdom. Your location: ' + (geoData.country_name || 'Unknown') });
        }
        next();
      } catch(e) { next(); }
    });
    console.log('  Geo-restriction: ENABLED (UK only)');
  } else {
    console.log('  Geo-restriction: Disabled (set GEO_RESTRICT=true to enable)');
  }
};
