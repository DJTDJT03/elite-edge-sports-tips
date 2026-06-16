/**
 * Instagram publisher — official Meta Graph API (Business/Creator accounts).
 *
 * Compliant, ban-safe publishing (no browser automation, no bot behaviour).
 * Posts a single image + caption to the connected Instagram feed.
 *
 * Required env (set in Railway):
 *   INSTAGRAM_ACCESS_TOKEN  — long-lived Page/IG access token
 *   INSTAGRAM_ACCOUNT_ID    — the Instagram Business account ID (numeric)
 * Optional:
 *   INSTAGRAM_IMAGE_URL     — default post image (must be a public JPEG)
 *   INSTAGRAM_GRAPH_VERSION — defaults to v21.0
 *
 * Pluggable — never touches the locked tipping engine.
 */
var https = require('https');

function graphRequest(method, path) {
  return new Promise(function (resolve) {
    var opts = { hostname: 'graph.facebook.com', path: path, method: method, headers: { 'Content-Length': 0 } };
    var req = https.request(opts, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { try { resolve(JSON.parse(data)); } catch (e) { resolve(null); } });
    });
    req.setTimeout(25000, function () { req.destroy(); resolve(null); });
    req.on('error', function () { resolve(null); });
    req.end();
  });
}

function InstagramPublisher() {
  this.token = process.env.INSTAGRAM_ACCESS_TOKEN || '';
  this.accountId = process.env.INSTAGRAM_ACCOUNT_ID || '';
  this.version = process.env.INSTAGRAM_GRAPH_VERSION || 'v21.0';
  this.defaultImage = process.env.INSTAGRAM_IMAGE_URL || 'https://eliteedgesports.co.uk/images/og-banner.png';
  if (this.token && this.accountId) {
    console.log('[Instagram] Publisher configured — account ' + this.accountId);
  } else {
    console.log('[Instagram] Not configured — set INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_ACCOUNT_ID to enable');
  }
}

InstagramPublisher.prototype.isAvailable = function () { return !!(this.token && this.accountId); };

// Publish a single image + caption. Captions are capped at ~2200 chars by IG.
InstagramPublisher.prototype.publish = function (caption, imageUrl) {
  var self = this;
  if (!this.isAvailable()) return Promise.resolve({ ok: false, error: 'Instagram not configured (missing token/account id)' });
  var img = imageUrl || this.defaultImage;
  var cap = String(caption || '').slice(0, 2150);
  var base = '/' + this.version + '/' + this.accountId;

  // 1) Create a media container
  var createPath = base + '/media?image_url=' + encodeURIComponent(img) + '&caption=' + encodeURIComponent(cap) + '&access_token=' + encodeURIComponent(this.token);
  return graphRequest('POST', createPath).then(function (created) {
    if (!created || !created.id) {
      return { ok: false, error: (created && created.error && created.error.message) || 'Failed to create media container (check the image URL is a public JPEG)' };
    }
    var containerId = created.id;
    // 2) Brief wait for IG to fetch/process the image, then publish
    return new Promise(function (resolve) { setTimeout(resolve, 4000); }).then(function () {
      var pubPath = base + '/media_publish?creation_id=' + encodeURIComponent(containerId) + '&access_token=' + encodeURIComponent(self.token);
      return graphRequest('POST', pubPath).then(function (published) {
        if (!published || !published.id) {
          return { ok: false, error: (published && published.error && published.error.message) || 'Container created but publish failed', containerId: containerId };
        }
        console.log('[Instagram] Published media ' + published.id);
        return { ok: true, mediaId: published.id };
      });
    });
  });
};

// Quick connectivity/permission check.
InstagramPublisher.prototype.verify = function () {
  if (!this.isAvailable()) return Promise.resolve({ ok: false, error: 'Not configured' });
  var p = '/' + this.version + '/' + this.accountId + '?fields=username,followers_count&access_token=' + encodeURIComponent(this.token);
  return graphRequest('GET', p).then(function (r) {
    if (r && r.username) return { ok: true, username: r.username, followers: r.followers_count };
    return { ok: false, error: (r && r.error && r.error.message) || 'Verify failed — check token/account id' };
  });
};

module.exports = new InstagramPublisher();
