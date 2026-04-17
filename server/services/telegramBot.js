// ---------------------------------------------------------------------------
// Telegram Bot Service
// Sends tips, results, and alerts to a Telegram channel via Bot API
// ---------------------------------------------------------------------------

const https = require('https');

class TelegramBot {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.channelId = process.env.TELEGRAM_CHANNEL_ID || '@EliteEdgeTips';
    if (this.botToken) {
      console.log('[Telegram] Bot configured — channel: ' + this.channelId);
    } else {
      console.log('[Telegram] No TELEGRAM_BOT_TOKEN — bot disabled');
    }
  }

  isAvailable() { return !!this.botToken; }

  /**
   * Send a message to the configured Telegram channel
   */
  sendMessage(text, parseMode) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        if (!self.botToken) {
          return resolve({ ok: false, description: 'Bot token not configured' });
        }

        var body = JSON.stringify({
          chat_id: self.channelId,
          text: text,
          parse_mode: parseMode || 'HTML',
          disable_web_page_preview: true,
        });

        var options = {
          hostname: 'api.telegram.org',
          port: 443,
          path: '/bot' + self.botToken + '/sendMessage',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        };

        var req = https.request(options, function(res) {
          var data = '';
          res.on('data', function(chunk) { data += chunk; });
          res.on('end', function() {
            try {
              var parsed = JSON.parse(data);
              if (parsed.ok) {
                console.log('[Telegram] Message sent successfully');
              } else {
                console.error('[Telegram] API error:', parsed.description);
              }
              resolve(parsed);
            } catch (e) {
              console.error('[Telegram] Parse error:', e.message);
              resolve({ ok: false, description: e.message });
            }
          });
        });

        req.on('error', function(err) {
          console.error('[Telegram] Request error:', err.message);
          resolve({ ok: false, description: err.message });
        });

        req.write(body);
        req.end();
      } catch (err) {
        console.error('[Telegram] sendMessage error:', err.message);
        resolve({ ok: false, description: err.message });
      }
    });
  }

  /**
   * Format and send a single tip to the channel
   */
  async sendTip(tip) {
    try {
      if (!this.isAvailable()) return;

      var sportEmoji = tip.sport === 'racing' ? '\uD83C\uDFC7' : '\u26BD';
      var sportLabel = tip.sport === 'racing' ? 'RACING TIP' : 'FOOTBALL TIP';
      var fractional = this._decimalToFractional(tip.odds);
      var confidence = tip.confidence || '-';
      var edge = tip.edge ? (tip.edge * 100).toFixed(1) : '-';
      var staking = tip.staking || '-';
      var summary = (tip.analysis && tip.analysis.summary) ? tip.analysis.summary : '';

      var text = sportEmoji + ' <b>' + sportLabel + '</b>\n\n' +
        '<b>' + (tip.selection || '') + '</b>\n' +
        (tip.event || '') + '\n' +
        'Market: ' + (tip.market || '-') + '\n' +
        'Odds: ' + (tip.odds || '-') + ' (' + fractional + ')\n' +
        'Confidence: ' + confidence + '/10 | Edge: ' + edge + '%\n' +
        'Staking: ' + staking + '\n';

      if (summary) {
        text += '\n' + summary + '\n';
      }

      text += '\n\uD83D\uDCCA Powered by Elite Edge Sports Tips\n' +
        '\uD83C\uDF10 eliteedgesports.co.uk';

      if (tip.isNap) {
        text = '\u2B50 <b>NAP OF THE DAY</b> \u2B50\n\n' + text;
      }

      return await this.sendMessage(text);
    } catch (err) {
      console.error('[Telegram] sendTip error:', err.message);
    }
  }

  /**
   * Send a result notification
   */
  async sendResult(result) {
    try {
      if (!this.isAvailable()) return;

      var won = result.result === 'won' || result.result === 'placed';
      var emoji = won ? '\u2705' : '\u274C';
      var label = won ? 'WINNER' : 'LOST';
      var pnl = result.pnl || 0;
      var pnlStr = pnl >= 0 ? '+' + pnl.toFixed(2) : pnl.toFixed(2);

      var text = emoji + ' <b>' + label + ':</b> ' + (result.selection || '') + ' @ ' + (result.odds || '-') + '\n' +
        'P/L: ' + pnlStr + ' units\n' +
        (result.event ? result.event + '\n' : '') +
        '\n\uD83D\uDCCA Elite Edge Sports Tips';

      return await this.sendMessage(text);
    } catch (err) {
      console.error('[Telegram] sendResult error:', err.message);
    }
  }

  /**
   * Send a daily bulletin with all today's tips
   */
  async sendDailyBulletin(tips) {
    try {
      if (!this.isAvailable() || !tips || tips.length === 0) return;

      var today = new Date().toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        timeZone: 'Europe/London',
      });

      var text = '\uD83D\uDCCB <b>DAILY BULLETIN \u2014 ' + today + '</b>\n\n';
      text += tips.length + ' selection' + (tips.length === 1 ? '' : 's') + ' published today:\n\n';

      for (var i = 0; i < tips.length; i++) {
        var tip = tips[i];
        var sportEmoji = tip.sport === 'racing' ? '\uD83C\uDFC7' : '\u26BD';
        var napLabel = tip.isNap ? ' \u2B50 NAP' : '';
        var premLabel = tip.isPremium ? ' \uD83D\uDD12' : '';
        text += sportEmoji + ' <b>' + (tip.selection || '') + '</b>' + napLabel + premLabel + '\n';
        text += '   Odds: ' + (tip.odds || '-') + ' | Confidence: ' + (tip.confidence || '-') + '/10\n';
        if (tip.event) {
          text += '   ' + tip.event + '\n';
        }
        text += '\n';
      }

      text += '\u26A0\uFE0F Tips are for informational purposes only. Always gamble responsibly.\n';
      text += '\n\uD83C\uDF10 eliteedgesports.co.uk';

      return await this.sendMessage(text);
    } catch (err) {
      console.error('[Telegram] sendDailyBulletin error:', err.message);
    }
  }

  /**
   * Send a steamer alert (rapid odds shortening)
   */
  async sendSteamerAlert(data) {
    try {
      if (!this.isAvailable()) return;

      var change = data.change ? data.change.toFixed(1) : '0';
      var text = '\uD83D\uDD25 <b>STEAMER ALERT:</b> ' + (data.runner || data.selection || '') +
        ' shortening from ' + (data.open || '-') + ' to ' + (data.current || '-') +
        ' (' + change + '%)';

      if (data.event) {
        text += '\n' + data.event;
      }

      return await this.sendMessage(text);
    } catch (err) {
      console.error('[Telegram] sendSteamerAlert error:', err.message);
    }
  }

  /**
   * Convert decimal odds to fractional string
   */
  _decimalToFractional(decimal) {
    if (!decimal || decimal <= 1) return 'EVS';
    var num = decimal - 1;
    // Common fractions lookup
    var fractions = [
      [1, 10], [1, 8], [1, 6], [1, 5], [1, 4], [3, 10], [1, 3], [2, 5],
      [4, 9], [1, 2], [8, 15], [4, 7], [8, 13], [4, 6], [8, 11], [4, 5],
      [5, 6], [10, 11], [1, 1], [6, 5], [5, 4], [11, 8], [6, 4], [13, 8],
      [7, 4], [15, 8], [2, 1], [9, 4], [5, 2], [11, 4], [3, 1], [7, 2],
      [4, 1], [9, 2], [5, 1], [6, 1], [7, 1], [8, 1], [10, 1], [12, 1],
      [14, 1], [16, 1], [20, 1], [25, 1], [33, 1], [50, 1], [100, 1],
    ];

    var bestFrac = null;
    var bestDiff = Infinity;
    for (var i = 0; i < fractions.length; i++) {
      var diff = Math.abs(num - fractions[i][0] / fractions[i][1]);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestFrac = fractions[i];
      }
    }

    if (bestFrac && bestDiff < 0.05) {
      return bestFrac[0] + '/' + bestFrac[1];
    }
    // Fallback: approximate
    var approxNum = Math.round(num * 4);
    var approxDen = 4;
    // Simplify
    var gcd = this._gcd(approxNum, approxDen);
    return (approxNum / gcd) + '/' + (approxDen / gcd);
  }

  _gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) { var t = b; b = a % b; a = t; }
    return a;
  }
}

module.exports = new TelegramBot();
