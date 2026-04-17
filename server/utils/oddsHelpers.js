/**
 * Elite Edge Sports Tips — Odds Movement Helpers
 * In-memory odds snapshot tracking for football market movement detection.
 */

var oddsHistory = {};

function storeOddsSnapshot(oddsNormalised) {
  if (!oddsNormalised || !Array.isArray(oddsNormalised)) return;
  var timestamp = new Date().toISOString();
  oddsNormalised.forEach(function(event) {
    if (!event || !event.homeTeam || !event.awayTeam || !event.bookmakerOdds) return;
    var eventKey = (event.homeTeam + ' v ' + event.awayTeam).toLowerCase();
    if (!oddsHistory[eventKey]) oddsHistory[eventKey] = [];
    oddsHistory[eventKey].push({
      timestamp: timestamp,
      odds: JSON.parse(JSON.stringify(event.bookmakerOdds))
    });
    if (oddsHistory[eventKey].length > 6) {
      oddsHistory[eventKey] = oddsHistory[eventKey].slice(-6);
    }
  });
  var cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  var keys = Object.keys(oddsHistory);
  for (var i = 0; i < keys.length; i++) {
    var snapshots = oddsHistory[keys[i]];
    if (snapshots.length > 0 && snapshots[snapshots.length - 1].timestamp < cutoff) {
      delete oddsHistory[keys[i]];
    }
  }
}

function analyseOddsMovement(eventKey, selectionName) {
  try {
    var key = (eventKey || '').toLowerCase();
    var snapshots = oddsHistory[key];
    if (!snapshots || snapshots.length < 2) return null;

    var earliest = snapshots[0];
    var latest = snapshots[snapshots.length - 1];
    var selLower = (selectionName || '').toLowerCase();

    var openingPrices = [];
    var currentPrices = [];
    var strongestMover = { bookmaker: '', change: 0 };

    var bookmakers = Object.keys(latest.odds);
    for (var i = 0; i < bookmakers.length; i++) {
      var bk = bookmakers[i];
      var latestBkOdds = latest.odds[bk] || {};
      var earliestBkOdds = (earliest.odds[bk]) || {};

      var latestPrice = 0;
      var earliestPrice = 0;
      var selKeys = Object.keys(latestBkOdds);
      for (var j = 0; j < selKeys.length; j++) {
        if (selKeys[j].toLowerCase().indexOf(selLower) !== -1 || selLower.indexOf(selKeys[j].toLowerCase()) !== -1) {
          latestPrice = latestBkOdds[selKeys[j]];
          break;
        }
      }
      var earlyKeys = Object.keys(earliestBkOdds);
      for (var k = 0; k < earlyKeys.length; k++) {
        if (earlyKeys[k].toLowerCase().indexOf(selLower) !== -1 || selLower.indexOf(earlyKeys[k].toLowerCase()) !== -1) {
          earliestPrice = earliestBkOdds[earlyKeys[k]];
          break;
        }
      }

      if (latestPrice > 0 && earliestPrice > 0) {
        openingPrices.push(earliestPrice);
        currentPrices.push(latestPrice);
        var change = ((latestPrice - earliestPrice) / earliestPrice) * 100;
        if (Math.abs(change) > Math.abs(strongestMover.change)) {
          strongestMover = { bookmaker: bk, change: Math.round(change * 10) / 10 };
        }
      }
    }

    if (openingPrices.length === 0) return null;

    var openingAvg = openingPrices.reduce(function(s, p) { return s + p; }, 0) / openingPrices.length;
    var currentAvg = currentPrices.reduce(function(s, p) { return s + p; }, 0) / currentPrices.length;
    var changePercent = ((currentAvg - openingAvg) / openingAvg) * 100;

    var direction = 'stable';
    if (changePercent < -2) direction = 'shortening';
    else if (changePercent > 2) direction = 'drifting';

    return {
      direction: direction,
      openingAvg: Math.round(openingAvg * 100) / 100,
      currentAvg: Math.round(currentAvg * 100) / 100,
      changePercent: Math.round(changePercent * 10) / 10,
      bookmakerCount: openingPrices.length,
      strongestMover: strongestMover
    };
  } catch (err) {
    return null;
  }
}

module.exports = { oddsHistory, storeOddsSnapshot, analyseOddsMovement };
