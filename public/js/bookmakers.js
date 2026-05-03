/**
 * Elite Edge Sports Tips — Bookmaker Integration
 *
 * Deeplinks to major UK bookmakers with configurable affiliate tracking IDs.
 * Set affiliate IDs when partnerships are secured — system works without them.
 *
 * Odds comparison uses data already available from The Odds API via tip.bookmakerOdds.
 */

'use strict';

window.Bookmakers = {

  // =========================================================================
  // AFFILIATE CONFIG — add tracking IDs when partnerships are secured
  // Leave empty to link without tracking (still works, just no commission)
  // =========================================================================
  affiliateIds: {
    bet365: '',       // e.g. 'afflno=12345'
    betfred: '',      // e.g. 'pid=12345'
    ladbrokes: '',    // e.g. 'aff_id=12345'
    williamhill: '',  // e.g. 'btag=a_12345'
    paddypower: '',   // e.g. 'pid=12345'
    skybet: '',       // e.g. 'aff=12345'
    betfair: '',      // e.g. 'pid=12345'
    coral: '',        // e.g. 'aff=12345'
    'sport888': '',   // e.g. 'src=12345'
    betway: '',       // e.g. 'a=12345'
  },

  // =========================================================================
  // BOOKMAKER DATA
  // =========================================================================
  bookmakers: [
    { key: 'bet365', name: 'Bet365', color: '#027b5b', url: 'https://www.bet365.com', logo: '365' },
    { key: 'betfred', name: 'Betfred', color: '#004b87', url: 'https://www.betfred.com', logo: 'BF' },
    { key: 'ladbrokes', name: 'Ladbrokes', color: '#e60000', url: 'https://www.ladbrokes.com', logo: 'LAD' },
    { key: 'williamhill', name: 'William Hill', color: '#2d3e50', url: 'https://www.williamhill.com', logo: 'WH' },
    { key: 'paddypower', name: 'Paddy Power', color: '#004833', url: 'https://www.paddypower.com', logo: 'PP' },
    { key: 'skybet', name: 'Sky Bet', color: '#0072c6', url: 'https://www.skybet.com', logo: 'SKY' },
    { key: 'coral', name: 'Coral', color: '#003d1e', url: 'https://www.coral.co.uk', logo: 'COR' },
    { key: 'betfair', name: 'Betfair', color: '#ffb80c', url: 'https://www.betfair.com', logo: 'BFR' },
  ],

  // =========================================================================
  // RENDER — odds comparison + Place Bet buttons for a tip
  // =========================================================================

  /**
   * Render bookmaker odds comparison bar for a tip.
   * @param {object} tip - Tip object with bookmakerOdds
   * @param {string} selection - Selection name for deeplink search
   * @returns {string} HTML
   */
  renderOddsBar: function(tip) {
    if (!tip || !tip.bookmakerOdds || Object.keys(tip.bookmakerOdds).length === 0) {
      // No bookmaker odds available — show generic Place Bet buttons
      return this._renderGenericButtons(tip);
    }

    var self = this;
    var odds = tip.bookmakerOdds;
    var bkNames = Object.keys(odds);
    if (bkNames.length === 0) return this._renderGenericButtons(tip);

    // Build odds entries sorted by best price
    var entries = [];
    bkNames.forEach(function(bk) {
      var price = parseFloat(odds[bk]) || 0;
      if (price <= 0) return;
      var matched = self.bookmakers.find(function(b) {
        return bk.toLowerCase().indexOf(b.key) !== -1 || b.name.toLowerCase().indexOf(bk.toLowerCase()) !== -1;
      });
      entries.push({
        name: matched ? matched.name : bk,
        key: matched ? matched.key : bk.toLowerCase().replace(/[^a-z0-9]/g, ''),
        color: matched ? matched.color : '#444',
        logo: matched ? matched.logo : bk.substring(0, 3).toUpperCase(),
        price: price,
        url: matched ? matched.url : '#',
      });
    });

    entries.sort(function(a, b) { return b.price - a.price; }); // best price first
    var bestPrice = entries.length > 0 ? entries[0].price : 0;

    var html = '<div style="margin-top:12px;">';
    html += '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px;">Best Odds Comparison</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';

    entries.slice(0, 5).forEach(function(entry) {
      var isBest = entry.price === bestPrice;
      var affId = self.affiliateIds[entry.key] || '';
      var link = entry.url + (affId ? '?' + affId : '');

      html += '<a href="' + link + '" target="_blank" rel="noopener sponsored" onclick="event.stopPropagation();" style="' +
        'display:flex;align-items:center;gap:6px;padding:6px 10px;' +
        'background:' + (isBest ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)') + ';' +
        'border:1px solid ' + (isBest ? 'rgba(34,197,94,0.3)' : 'var(--border)') + ';' +
        'border-radius:6px;text-decoration:none;transition:border-color 0.2s;' +
      '">';
      html += '<span style="font-size:10px;font-weight:800;color:' + entry.color + ';background:rgba(255,255,255,0.9);padding:2px 4px;border-radius:3px;min-width:28px;text-align:center;">' + entry.logo + '</span>';
      html += '<span style="font-size:13px;font-weight:800;color:' + (isBest ? '#22c55e' : 'var(--text-primary)') + ';">' + App.formatOdds(entry.price) + '</span>';
      if (isBest) html += '<span style="font-size:9px;color:#22c55e;font-weight:700;">BEST</span>';
      html += '</a>';
    });

    html += '</div></div>';
    return html;
  },

  /**
   * Render generic Place Bet buttons when no bookmaker odds are available.
   */
  _renderGenericButtons: function(tip) {
    var self = this;
    var html = '<div style="margin-top:12px;">';
    html += '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px;">Place Bet</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';

    // Show top 4 bookmakers
    this.bookmakers.slice(0, 4).forEach(function(bk) {
      var affId = self.affiliateIds[bk.key] || '';
      var link = bk.url + (affId ? '?' + affId : '');

      html += '<a href="' + link + '" target="_blank" rel="noopener sponsored" onclick="event.stopPropagation();" style="' +
        'display:flex;align-items:center;gap:6px;padding:6px 12px;' +
        'background:rgba(255,255,255,0.03);border:1px solid var(--border);' +
        'border-radius:6px;text-decoration:none;font-size:11px;color:var(--text-secondary);' +
        'transition:border-color 0.2s;' +
      '">';
      html += '<span style="font-size:10px;font-weight:800;color:' + bk.color + ';background:rgba(255,255,255,0.9);padding:2px 4px;border-radius:3px;">' + bk.logo + '</span>';
      html += '<span>' + bk.name + '</span>';
      html += '</a>';
    });

    html += '</div></div>';
    return html;
  },
};
