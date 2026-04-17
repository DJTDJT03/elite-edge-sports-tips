/**
 * Elite Edge Sports Tips — Rate Limiting Middleware
 */

// Auth rate limiting — 5 login attempts per IP per 15 minutes
const authRateLimitStore = {};
const AUTH_RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 5;

function checkAuthRateLimit(ip) {
  const now = Date.now();
  if (!authRateLimitStore[ip] || now - authRateLimitStore[ip].start > AUTH_RATE_LIMIT_WINDOW) {
    authRateLimitStore[ip] = { start: now, count: 0 };
  }
  return authRateLimitStore[ip].count >= AUTH_RATE_LIMIT_MAX;
}

function recordAuthAttempt(ip) {
  const now = Date.now();
  if (!authRateLimitStore[ip] || now - authRateLimitStore[ip].start > AUTH_RATE_LIMIT_WINDOW) {
    authRateLimitStore[ip] = { start: now, count: 1 };
  } else {
    authRateLimitStore[ip].count++;
  }
}

function resetAuthRateLimit(ip) {
  delete authRateLimitStore[ip];
}

// Clean up auth rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const ip in authRateLimitStore) {
    if (now - authRateLimitStore[ip].start > AUTH_RATE_LIMIT_WINDOW) {
      delete authRateLimitStore[ip];
    }
  }
}, 5 * 60 * 1000);

// API rate limiting — 100 requests per minute per IP
const rateLimitStore = {};
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 100;

function rateLimiter(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const now = Date.now();
  if (!rateLimitStore[ip] || now - rateLimitStore[ip].start > RATE_LIMIT_WINDOW) {
    rateLimitStore[ip] = { start: now, count: 1 };
  } else {
    rateLimitStore[ip].count++;
  }
  if (rateLimitStore[ip].count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too Many Requests. Please try again later.' });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const ip in rateLimitStore) {
    if (now - rateLimitStore[ip].start > RATE_LIMIT_WINDOW) {
      delete rateLimitStore[ip];
    }
  }
}, 5 * 60 * 1000);

module.exports = {
  rateLimiter,
  checkAuthRateLimit,
  recordAuthAttempt,
  resetAuthRateLimit,
};
