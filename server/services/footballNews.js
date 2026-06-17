// ---------------------------------------------------------------------------
// Football News — free RSS aggregation (BBC / Sky / Guardian).
// Pulls headlines from reputable football feeds, parses, dedupes, caches.
// We surface headline + source + link back to the original article (standard
// aggregation) — never the full text. No API key, no quota, no cost.
// ---------------------------------------------------------------------------
const https = require('https');

const FEEDS = [
  { source: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
  { source: 'Sky Sports', url: 'https://www.skysports.com/rss/12040' },
  { source: 'The Guardian', url: 'https://www.theguardian.com/football/rss' },
  { source: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/world-cup/rss.xml' },
];

let _cache = null;
let _cacheAt = 0;
const TTL = 10 * 60 * 1000; // 10 minutes

function fetchUrl(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function (resolve, reject) {
    if (redirects > 4) return reject(new Error('too many redirects'));
    var req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EliteEdgeNews/1.0)', 'Accept': 'application/rss+xml, application/xml, text/xml' },
      timeout: 8000,
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        var next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        return resolve(fetchUrl(next, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      var data = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve(data); });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, function (_, n) { try { return String.fromCharCode(parseInt(n, 10)); } catch (e) { return ''; } })
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, n) { try { return String.fromCharCode(parseInt(n, 16)); } catch (e) { return ''; } })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

function strip(s) { return decodeEntities(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); }

function tagContent(block, name) {
  var m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i'));
  return m ? m[1] : '';
}

function findImage(block) {
  var m = block.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i) ||
          block.match(/<media:content[^>]*url=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i) ||
          block.match(/<enclosure[^>]*url=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
  return m ? m[1] : '';
}

function parseFeed(xml, source) {
  var items = [];
  var re = /<item\b[\s\S]*?<\/item>/gi;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var block = m[0];
    var title = strip(tagContent(block, 'title'));
    var link = strip(tagContent(block, 'link'));
    if (!title || !link) continue;
    if (!/^https?:\/\//i.test(link)) continue; // only safe absolute http(s) links
    var pub = strip(tagContent(block, 'pubDate'));
    var iso = '';
    if (pub) { var d = new Date(pub); if (!isNaN(d.getTime())) iso = d.toISOString(); }
    items.push({
      title: title,
      url: link,
      source: source,
      publishedAt: iso,
      image: findImage(block),
      description: strip(tagContent(block, 'description')).slice(0, 200),
    });
  }
  return items;
}

async function getNews(opts) {
  opts = opts || {};
  if (!opts.force && _cache && (Date.now() - _cacheAt) < TTL) return _cache;
  var all = [];
  await Promise.all(FEEDS.map(async function (f) {
    try {
      var xml = await fetchUrl(f.url, 0);
      all = all.concat(parseFeed(xml, f.source));
    } catch (e) { /* skip a failed feed */ }
  }));
  // newest first, then dedupe by normalised title
  all.sort(function (a, b) { return (b.publishedAt || '').localeCompare(a.publishedAt || ''); });
  var seen = {}, uniq = [];
  all.forEach(function (a) {
    var key = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
    if (key && !seen[key]) { seen[key] = 1; uniq.push(a); }
  });
  var result = uniq.slice(0, 40);
  if (result.length) { _cache = result; _cacheAt = Date.now(); }
  return result.length ? result : (_cache || []);
}

module.exports = { getNews };
