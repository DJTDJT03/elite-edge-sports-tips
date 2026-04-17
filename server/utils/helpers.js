/**
 * Elite Edge Sports Tips — Utility Helpers
 */
const crypto = require('crypto');

function generateSessionId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters long';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least 1 uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least 1 lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least 1 number';
  return null;
}

function hashDeviceFingerprint(ip, userAgent) {
  return crypto.createHash('sha256').update((ip || '') + '|' + (userAgent || '')).digest('hex').slice(0, 16);
}

function checkSuspiciousActivity(user) {
  if (!user.loginHistory || user.loginHistory.length < 3) return false;
  const now = Date.now();
  const last24h = user.loginHistory.filter(l => now - new Date(l.timestamp).getTime() < 24 * 60 * 60 * 1000);
  const uniqueIPs = new Set(last24h.map(l => l.ip));
  return uniqueIPs.size >= 3;
}

function formatOddsFrac(dec) {
  if (!dec || dec <= 1) return 'EVS';
  var n = dec - 1;
  var fracs = [
    [1,10],[1,8],[1,7],[1,6],[1,5],[2,9],[1,4],[2,7],[3,10],[1,3],[4,11],
    [2,5],[4,9],[1,2],[8,15],[4,7],[8,13],[4,6],[8,11],[4,5],[5,6],
    [10,11],[1,1],[11,10],[6,5],[5,4],[11,8],[6,4],[13,8],[7,4],[15,8],
    [2,1],[9,4],[5,2],[11,4],[3,1],[10,3],[7,2],[4,1],[9,2],[5,1],[6,1],
    [7,1],[8,1],[9,1],[10,1],[12,1],[14,1],[16,1],[20,1],[25,1],[33,1],
    [40,1],[50,1],[66,1],[100,1]
  ];
  var best = fracs[0];
  var bestDist = 999;
  for (var i = 0; i < fracs.length; i++) {
    var val = fracs[i][0] / fracs[i][1];
    var dist = Math.abs(val - n);
    if (dist < bestDist) { bestDist = dist; best = fracs[i]; }
  }
  return best[0] + '/' + best[1];
}

module.exports = {
  generateSessionId,
  validatePassword,
  hashDeviceFingerprint,
  checkSuspiciousActivity,
  formatOddsFrac,
};
