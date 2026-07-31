#!/usr/bin/env node
/**
 * Elite Edge — post-deploy smoke check.
 *
 * A 60-second net under the money-facing surface. Run it after every deploy
 * (Railway auto-deploys on push to main) to catch the class of bug that let a
 * broken pricing modal sit live: wrong checkout slugs, a dead API, a funnel that
 * silently stopped converting.
 *
 * Usage:
 *   npm run smoke                 # checks the live site
 *   BASE_URL=http://localhost:3000 npm run smoke   # checks a local/staging boot
 *
 * Exits 0 if every check passes, 1 if any fail (so it can gate CI or alert you).
 * No dependencies — plain https, safe to run anywhere Node is installed.
 */

const https = require('https');
const http = require('http');

const BASE_URL = (process.env.BASE_URL || 'https://eliteedgesports.co.uk').replace(/\/$/, '');
// The ONLY plan slugs the checkout endpoint accepts (server/routes/stripe.js).
// If the frontend ever ships anything else to startCheckout(), payment breaks.
const VALID_PLAN_SLUGS = ['starter-monthly', 'starter-annual', 'premium-monthly', 'premium-annual', 'vip-monthly', 'vip-annual'];
// Slugs that were live and BROKEN once (rejected by the server) — must never return.
const FORBIDDEN_SLUGS = ["startCheckout('monthly')", "startCheckout('annual')", 'startCheckout("monthly")', 'startCheckout("annual")'];

let failures = 0;
let passes = 0;

function fetch(path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const lib = url.protocol === 'http:' ? http : https;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname + url.search,
      headers: Object.assign({ 'User-Agent': 'elite-edge-smoke/1.0', 'Accept': '*/*' }, headers),
      timeout: 15000,
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout after 15s')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function check(name, condition, detail) {
  if (condition) {
    passes++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } else {
    failures++;
    console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (detail ? '  — ' + detail : ''));
  }
}

async function run() {
  console.log('\nElite Edge smoke check → ' + BASE_URL + '\n');

  // --- 1. Core availability -------------------------------------------------
  console.log('Availability:');
  try {
    const home = await fetch('/');
    check('GET / returns 200', home.status === 200, 'got ' + home.status);
    check('Home page is the app (has root mount or app.js)', /app\.js|id="app"|Elite Edge/i.test(home.body));
  } catch (e) { check('GET / reachable', false, e.message); }

  for (const ep of ['/api/status', '/api/tips', '/api/results']) {
    try {
      const r = await fetch(ep);
      check('GET ' + ep + ' returns 200', r.status === 200, 'got ' + r.status);
      check('GET ' + ep + ' returns JSON', /^[\[{]/.test(r.body.trim()), 'not JSON: ' + r.body.slice(0, 60));
    } catch (e) { check('GET ' + ep + ' reachable', false, e.message); }
  }

  // --- 2. Money path: checkout endpoint alive & guarded ---------------------
  console.log('\nCheckout / billing:');
  try {
    // No auth token → must be 401 (endpoint mounted + auth enforced), NOT 404/500.
    const noAuth = await fetch('/api/stripe/create-checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'premium-monthly' }),
    });
    check('POST /api/stripe/create-checkout rejects unauthenticated (401)', noAuth.status === 401, 'got ' + noAuth.status);
  } catch (e) { check('checkout endpoint reachable', false, e.message); }

  // --- 3. Frontend integrity: pricing + checkout slugs ----------------------
  console.log('\nFrontend integrity (pricing + checkout wiring):');
  let indexHtml = '', appJs = '';
  try { indexHtml = (await fetch('/')).body; } catch (e) {}
  try {
    // app.js is cache-busted; the index references the current version, so pull it fresh.
    const m = indexHtml.match(/\/js\/app\.js\?v=[\w.-]+/);
    appJs = (await fetch(m ? m[0] : '/js/app.js')).body;
  } catch (e) { check('app.js fetched', false, e.message); }

  const combined = indexHtml + '\n' + appJs;
  for (const bad of FORBIDDEN_SLUGS) {
    check('No broken checkout slug: ' + bad, !combined.includes(bad), 'found the slug the server rejects');
  }
  check('At least one valid tier slug present', VALID_PLAN_SLUGS.some((s) => combined.includes(s)),
    'none of ' + VALID_PLAN_SLUGS.join(', ') + ' found — pricing may be unwired');
  check('Current tier prices shown (£9.99 / £19.99 / £39.99)',
    indexHtml.includes('9.99') && indexHtml.includes('19.99') && indexHtml.includes('39.99'),
    'a tier price is missing from the page');
  check('Trial length is consistent (no stray "7 Days" unlock CTA)', !/Unlock Free for 7 Days/i.test(appJs),
    'the 7-vs-14-day trial inconsistency is back');

  // --- Result ---------------------------------------------------------------
  console.log('\n' + '─'.repeat(48));
  const total = passes + failures;
  if (failures === 0) {
    console.log('\x1b[32m✓ All ' + total + ' checks passed.\x1b[0m The money paths are live.\n');
    process.exit(0);
  } else {
    console.log('\x1b[31m✗ ' + failures + ' of ' + total + ' checks FAILED.\x1b[0m Investigate before trusting this deploy.\n');
    process.exit(1);
  }
}

run().catch((e) => { console.error('Smoke check crashed:', e.message); process.exit(1); });
