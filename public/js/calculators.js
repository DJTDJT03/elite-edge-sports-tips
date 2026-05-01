/**
 * Elite Edge Sports Tips — Betting Calculator Suite
 *
 * All calculations client-side. No API calls.
 * Covers: Singles, Doubles, Trebles, Accumulators (2-20 fold),
 * Trixie, Patent, Yankee, Lucky 15, Lucky 31, Lucky 63, Heinz,
 * Odds Converter, Dutching Calculator, Each-Way Calculator.
 */

'use strict';

window.BetCalc = {
  // =========================================================================
  // ODDS HELPERS
  // =========================================================================

  // Parse odds input — accepts fractional (5/2), decimal (3.5), or American (+250)
  parseOdds: function(input) {
    if (!input) return 0;
    var s = String(input).trim();
    // Fractional: 5/2, 11/4, evens
    if (s.toLowerCase() === 'evens' || s.toLowerCase() === 'evs') return 2.0;
    if (s.indexOf('/') !== -1) {
      var parts = s.split('/');
      var num = parseFloat(parts[0]);
      var den = parseFloat(parts[1]);
      if (den === 0) return 0;
      return (num / den) + 1;
    }
    // American: +250, -150
    if (s.charAt(0) === '+') return (parseFloat(s.substring(1)) / 100) + 1;
    if (s.charAt(0) === '-') {
      var am = Math.abs(parseFloat(s.substring(1)));
      return am > 0 ? (100 / am) + 1 : 0;
    }
    // Decimal
    return parseFloat(s) || 0;
  },

  // Convert decimal odds to fractional string
  toFractional: function(decimal) {
    if (!decimal || decimal <= 1) return '-';
    var n = decimal - 1;
    // Find clean fraction
    var bestN = Math.round(n * 100);
    var bestD = 100;
    var gcd = function(a, b) { return b === 0 ? a : gcd(b, a % b); };
    var g = gcd(bestN, bestD);
    return (bestN / g) + '/' + (bestD / g);
  },

  // Convert decimal to American
  toAmerican: function(decimal) {
    if (!decimal || decimal <= 1) return '-';
    if (decimal >= 2) return '+' + Math.round((decimal - 1) * 100);
    return '-' + Math.round(100 / (decimal - 1));
  },

  // Convert decimal to implied probability
  toImpliedProb: function(decimal) {
    if (!decimal || decimal <= 0) return 0;
    return (1 / decimal) * 100;
  },

  // =========================================================================
  // SINGLE/ACCA CALCULATOR
  // =========================================================================

  calcAcca: function(selections, stake, isEachWay, ewTerms) {
    if (!selections || selections.length === 0) return { returns: 0, profit: 0 };
    var winOdds = 1;
    for (var i = 0; i < selections.length; i++) {
      var dec = this.parseOdds(selections[i].odds);
      if (selections[i].result === 'void') continue;
      if (selections[i].result === 'lost') return { returns: 0, profit: -stake * (isEachWay ? 2 : 1) };
      winOdds *= dec;
    }
    var winReturn = stake * winOdds;

    if (isEachWay && ewTerms) {
      var placeOdds = 1;
      for (var j = 0; j < selections.length; j++) {
        if (selections[j].result === 'void') continue;
        var placeDec = ((this.parseOdds(selections[j].odds) - 1) * (ewTerms.fraction || 0.25)) + 1;
        if (selections[j].result === 'lost' || selections[j].result === 'unplaced') {
          placeOdds = 0;
          break;
        }
        placeOdds *= placeDec;
      }
      var placeReturn = stake * placeOdds;
      var totalReturn = winReturn + placeReturn;
      return { returns: totalReturn, profit: totalReturn - (stake * 2), winPart: winReturn, placePart: placeReturn };
    }

    return { returns: winReturn, profit: winReturn - stake };
  },

  // =========================================================================
  // COMPLEX BET TYPES — generate all combinations
  // =========================================================================

  // Get all combinations of size k from array
  _combinations: function(arr, k) {
    if (k === 0) return [[]];
    if (arr.length === 0) return [];
    var first = arr[0];
    var rest = arr.slice(1);
    var withFirst = this._combinations(rest, k - 1).map(function(c) { return [first].concat(c); });
    var withoutFirst = this._combinations(rest, k);
    return withFirst.concat(withoutFirst);
  },

  // Calculate a complex bet (Trixie, Patent, Yankee, Lucky 15, etc.)
  calcComplex: function(type, selections, unitStake) {
    var self = this;
    var n = selections.length;
    var bets = [];
    var totalStake = 0;
    var totalReturn = 0;

    var betTypes = {
      'trixie':    { min: 3, folds: [2, 3] },
      'patent':    { min: 3, folds: [1, 2, 3] },
      'yankee':    { min: 4, folds: [2, 3, 4] },
      'lucky15':   { min: 4, folds: [1, 2, 3, 4] },
      'canadian':  { min: 5, folds: [2, 3, 4, 5] },
      'lucky31':   { min: 5, folds: [1, 2, 3, 4, 5] },
      'heinz':     { min: 6, folds: [2, 3, 4, 5, 6] },
      'lucky63':   { min: 6, folds: [1, 2, 3, 4, 5, 6] },
      'superheinz':{ min: 7, folds: [2, 3, 4, 5, 6, 7] },
      'goliath':   { min: 8, folds: [2, 3, 4, 5, 6, 7, 8] },
    };

    var bt = betTypes[type];
    if (!bt || n < bt.min) return { bets: [], totalStake: 0, totalReturn: 0, profit: 0, betCount: 0 };

    for (var fi = 0; fi < bt.folds.length; fi++) {
      var foldSize = bt.folds[fi];
      var combos = self._combinations(selections, foldSize);
      for (var ci = 0; ci < combos.length; ci++) {
        var combo = combos[ci];
        var comboOdds = 1;
        var allWon = true;
        for (var si = 0; si < combo.length; si++) {
          var dec = self.parseOdds(combo[si].odds);
          if (dec <= 0) { allWon = false; break; }
          comboOdds *= dec;
        }
        var betReturn = allWon ? unitStake * comboOdds : 0;
        totalStake += unitStake;
        totalReturn += betReturn;
        bets.push({ fold: foldSize, selections: combo.map(function(s) { return s.name; }), odds: comboOdds, returns: betReturn });
      }
    }

    return { bets: bets, totalStake: totalStake, totalReturn: totalReturn, profit: totalReturn - totalStake, betCount: bets.length };
  },

  // =========================================================================
  // DUTCHING CALCULATOR
  // =========================================================================

  calcDutch: function(selections, totalStake) {
    if (!selections || selections.length === 0) return [];
    var totalImplied = 0;
    for (var i = 0; i < selections.length; i++) {
      var dec = this.parseOdds(selections[i].odds);
      if (dec > 0) totalImplied += 1 / dec;
    }
    if (totalImplied === 0) return [];

    var results = [];
    for (var j = 0; j < selections.length; j++) {
      var decJ = this.parseOdds(selections[j].odds);
      if (decJ <= 0) continue;
      var impliedJ = 1 / decJ;
      var stakeJ = (impliedJ / totalImplied) * totalStake;
      var returnJ = stakeJ * decJ;
      results.push({
        name: selections[j].name,
        odds: selections[j].odds,
        decimalOdds: decJ,
        stake: Math.round(stakeJ * 100) / 100,
        returns: Math.round(returnJ * 100) / 100,
        profit: Math.round((returnJ - totalStake) * 100) / 100,
      });
    }
    return results;
  },

  // =========================================================================
  // RENDER — Main calculator page
  // =========================================================================

  render: function() {
    var app = document.getElementById('app');
    var activeTab = this._activeTab || 'acca';

    var tabs = [
      { id: 'acca', label: 'Bet Calculator' },
      { id: 'complex', label: 'System Bets' },
      { id: 'odds', label: 'Odds Converter' },
      { id: 'dutch', label: 'Dutching' },
      { id: 'ew', label: 'Each-Way' },
    ];

    var tabHtml = tabs.map(function(t) {
      return '<button class="calc-tab' + (t.id === activeTab ? ' active' : '') + '" onclick="BetCalc._activeTab=\'' + t.id + '\';BetCalc.render();">' + t.label + '</button>';
    }).join('');

    var bodyHtml = '';
    if (activeTab === 'acca') bodyHtml = this._renderAccaCalc();
    else if (activeTab === 'complex') bodyHtml = this._renderComplexCalc();
    else if (activeTab === 'odds') bodyHtml = this._renderOddsConverter();
    else if (activeTab === 'dutch') bodyHtml = this._renderDutchCalc();
    else if (activeTab === 'ew') bodyHtml = this._renderEWCalc();

    app.innerHTML =
      '<div class="container" style="max-width:800px;padding-top:30px;">' +
        '<div class="page-header text-center">' +
          '<h1 style="color:var(--gold);">Betting Calculators</h1>' +
          '<p style="color:var(--text-secondary);">Free tools for every bet type</p>' +
        '</div>' +
        '<div style="display:flex;gap:4px;margin-bottom:24px;flex-wrap:wrap;justify-content:center;">' + tabHtml + '</div>' +
        bodyHtml +
      '</div>';
  },

  // =========================================================================
  // ACCA CALCULATOR TAB
  // =========================================================================

  _accaRows: [{odds: '', name: 'Selection 1'}, {odds: '', name: 'Selection 2'}],
  _accaStake: 10,

  _renderAccaCalc: function() {
    var self = this;
    var rows = this._accaRows;

    var rowsHtml = rows.map(function(r, i) {
      return '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">' +
        '<input type="text" placeholder="Selection ' + (i + 1) + '" value="' + (r.name || '') + '" onchange="BetCalc._accaRows[' + i + '].name=this.value" style="flex:1;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:13px;">' +
        '<input type="text" placeholder="Odds (e.g. 5/2)" value="' + (r.odds || '') + '" onchange="BetCalc._accaRows[' + i + '].odds=this.value" style="width:120px;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:13px;text-align:center;">' +
        (rows.length > 1 ? '<button onclick="BetCalc._accaRows.splice(' + i + ',1);BetCalc.render();" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:18px;padding:0 4px;">&times;</button>' : '<div style="width:22px;"></div>') +
      '</div>';
    }).join('');

    return '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;">' +
      '<h3 style="color:var(--text-primary);margin-bottom:16px;">Accumulator / Single Calculator</h3>' +
      rowsHtml +
      '<div style="display:flex;gap:8px;margin-bottom:16px;">' +
        '<button class="btn btn-outline btn-sm" onclick="BetCalc._accaRows.push({odds:\'\',name:\'Selection \'+(BetCalc._accaRows.length+1)});BetCalc.render();">+ Add Selection</button>' +
      '</div>' +
      '<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">' +
        '<label style="color:var(--text-secondary);font-size:13px;">Stake: &pound;</label>' +
        '<input type="number" value="' + this._accaStake + '" onchange="BetCalc._accaStake=parseFloat(this.value)||0" style="width:100px;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:14px;font-weight:700;">' +
      '</div>' +
      '<button class="btn btn-gold" onclick="BetCalc._calcAccaResult()">Calculate Returns</button>' +
      '<div id="acca-result" style="margin-top:16px;"></div>' +
    '</div>';
  },

  _calcAccaResult: function() {
    var selections = this._accaRows.filter(function(r) { return r.odds; });
    if (selections.length === 0) return;
    var result = this.calcAcca(selections, this._accaStake);
    var el = document.getElementById('acca-result');
    if (!el) return;

    var combinedOdds = 1;
    for (var i = 0; i < selections.length; i++) {
      combinedOdds *= this.parseOdds(selections[i].odds);
    }

    el.innerHTML =
      '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:20px;text-align:center;">' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">' +
          '<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">Combined Odds</div><div style="font-size:24px;font-weight:900;color:var(--gold);">' + this.toFractional(combinedOdds) + '</div><div style="font-size:12px;color:var(--text-muted);">(' + combinedOdds.toFixed(2) + ' decimal)</div></div>' +
          '<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">Total Returns</div><div style="font-size:24px;font-weight:900;color:var(--green);">&pound;' + result.returns.toFixed(2) + '</div></div>' +
          '<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">Profit</div><div style="font-size:24px;font-weight:900;color:var(--green);">&pound;' + result.profit.toFixed(2) + '</div></div>' +
        '</div>' +
      '</div>';
  },

  // =========================================================================
  // COMPLEX BETS TAB
  // =========================================================================

  _complexType: 'lucky15',
  _complexRows: [{odds:'',name:'Sel 1'},{odds:'',name:'Sel 2'},{odds:'',name:'Sel 3'},{odds:'',name:'Sel 4'}],
  _complexStake: 1,

  _renderComplexCalc: function() {
    var types = [
      {id:'trixie',label:'Trixie (3)',n:3},{id:'patent',label:'Patent (3)',n:3},
      {id:'yankee',label:'Yankee (4)',n:4},{id:'lucky15',label:'Lucky 15 (4)',n:4},
      {id:'canadian',label:'Canadian (5)',n:5},{id:'lucky31',label:'Lucky 31 (5)',n:5},
      {id:'heinz',label:'Heinz (6)',n:6},{id:'lucky63',label:'Lucky 63 (6)',n:6},
      {id:'superheinz',label:'Super Heinz (7)',n:7},{id:'goliath',label:'Goliath (8)',n:8},
    ];

    var typeBtns = types.map(function(t) {
      return '<button class="calc-tab' + (t.id === BetCalc._complexType ? ' active' : '') + '" style="font-size:11px;padding:6px 10px;" onclick="BetCalc._complexType=\'' + t.id + '\';BetCalc._setComplexRows(' + t.n + ');BetCalc.render();">' + t.label + '</button>';
    }).join('');

    var rows = this._complexRows;
    var rowsHtml = rows.map(function(r, i) {
      return '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
        '<input type="text" placeholder="Selection ' + (i+1) + '" value="' + (r.name||'') + '" onchange="BetCalc._complexRows[' + i + '].name=this.value" style="flex:1;padding:8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:12px;">' +
        '<input type="text" placeholder="Odds" value="' + (r.odds||'') + '" onchange="BetCalc._complexRows[' + i + '].odds=this.value" style="width:100px;padding:8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:12px;text-align:center;">' +
      '</div>';
    }).join('');

    return '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;">' +
      '<h3 style="color:var(--text-primary);margin-bottom:12px;">System Bet Calculator</h3>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px;">' + typeBtns + '</div>' +
      rowsHtml +
      '<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">' +
        '<label style="color:var(--text-secondary);font-size:13px;">Unit Stake: &pound;</label>' +
        '<input type="number" value="' + this._complexStake + '" onchange="BetCalc._complexStake=parseFloat(this.value)||0" style="width:80px;padding:8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:13px;">' +
      '</div>' +
      '<button class="btn btn-gold" onclick="BetCalc._calcComplexResult()">Calculate</button>' +
      '<div id="complex-result" style="margin-top:16px;"></div>' +
    '</div>';
  },

  _setComplexRows: function(n) {
    while (this._complexRows.length < n) this._complexRows.push({odds:'',name:'Sel '+(this._complexRows.length+1)});
    while (this._complexRows.length > n) this._complexRows.pop();
  },

  _calcComplexResult: function() {
    var result = this.calcComplex(this._complexType, this._complexRows.filter(function(r){return r.odds;}), this._complexStake);
    var el = document.getElementById('complex-result');
    if (!el) return;

    el.innerHTML =
      '<div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.2);border-radius:10px;padding:20px;">' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;text-align:center;margin-bottom:12px;">' +
          '<div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">Bets</div><div style="font-size:20px;font-weight:900;color:var(--gold);">' + result.betCount + '</div></div>' +
          '<div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">Total Stake</div><div style="font-size:20px;font-weight:900;color:var(--text-primary);">&pound;' + result.totalStake.toFixed(2) + '</div></div>' +
          '<div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">Returns</div><div style="font-size:20px;font-weight:900;color:var(--green);">&pound;' + result.totalReturn.toFixed(2) + '</div></div>' +
          '<div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">Profit</div><div style="font-size:20px;font-weight:900;color:' + (result.profit >= 0 ? 'var(--green)' : 'var(--red)') + ';">&pound;' + result.profit.toFixed(2) + '</div></div>' +
        '</div>' +
      '</div>';
  },

  // =========================================================================
  // ODDS CONVERTER TAB
  // =========================================================================

  _renderOddsConverter: function() {
    return '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;">' +
      '<h3 style="color:var(--text-primary);margin-bottom:16px;">Odds Converter</h3>' +
      '<p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px;">Enter odds in any format — all others update automatically.</p>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">' +
        '<div>' +
          '<label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:6px;">Fractional</label>' +
          '<input type="text" id="odds-frac" placeholder="5/2" oninput="BetCalc._convertOdds(\'frac\')" style="width:100%;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:16px;font-weight:700;text-align:center;">' +
        '</div>' +
        '<div>' +
          '<label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:6px;">Decimal</label>' +
          '<input type="text" id="odds-dec" placeholder="3.50" oninput="BetCalc._convertOdds(\'dec\')" style="width:100%;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:16px;font-weight:700;text-align:center;">' +
        '</div>' +
        '<div>' +
          '<label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:6px;">American</label>' +
          '<input type="text" id="odds-amer" placeholder="+250" oninput="BetCalc._convertOdds(\'amer\')" style="width:100%;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:16px;font-weight:700;text-align:center;">' +
        '</div>' +
        '<div>' +
          '<label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;display:block;margin-bottom:6px;">Implied Prob</label>' +
          '<input type="text" id="odds-prob" placeholder="28.6%" oninput="BetCalc._convertOdds(\'prob\')" style="width:100%;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:16px;font-weight:700;text-align:center;">' +
        '</div>' +
      '</div>' +
      '<div id="odds-stake-calc" style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px;">' +
        '<div style="display:flex;gap:12px;align-items:center;">' +
          '<label style="color:var(--text-secondary);font-size:13px;">Stake: &pound;</label>' +
          '<input type="number" id="odds-stake" value="10" oninput="BetCalc._updateStakeCalc()" style="width:80px;padding:8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:13px;">' +
          '<span style="color:var(--text-secondary);font-size:13px;">Returns: </span>' +
          '<span id="odds-returns" style="color:var(--green);font-weight:800;font-size:16px;">&pound;0.00</span>' +
          '<span style="color:var(--text-secondary);font-size:13px;">Profit: </span>' +
          '<span id="odds-profit" style="color:var(--green);font-weight:800;font-size:16px;">&pound;0.00</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  },

  _lastDecimal: 0,

  _convertOdds: function(source) {
    var frac = document.getElementById('odds-frac');
    var dec = document.getElementById('odds-dec');
    var amer = document.getElementById('odds-amer');
    var prob = document.getElementById('odds-prob');
    if (!frac || !dec || !amer || !prob) return;

    var decimal = 0;
    if (source === 'frac') {
      decimal = this.parseOdds(frac.value);
      if (decimal > 1) {
        dec.value = decimal.toFixed(2);
        amer.value = this.toAmerican(decimal);
        prob.value = this.toImpliedProb(decimal).toFixed(1) + '%';
      }
    } else if (source === 'dec') {
      decimal = parseFloat(dec.value) || 0;
      if (decimal > 1) {
        frac.value = this.toFractional(decimal);
        amer.value = this.toAmerican(decimal);
        prob.value = this.toImpliedProb(decimal).toFixed(1) + '%';
      }
    } else if (source === 'amer') {
      decimal = this.parseOdds(amer.value);
      if (decimal > 1) {
        frac.value = this.toFractional(decimal);
        dec.value = decimal.toFixed(2);
        prob.value = this.toImpliedProb(decimal).toFixed(1) + '%';
      }
    } else if (source === 'prob') {
      var p = parseFloat(prob.value) || 0;
      if (p > 0 && p < 100) {
        decimal = 100 / p;
        frac.value = this.toFractional(decimal);
        dec.value = decimal.toFixed(2);
        amer.value = this.toAmerican(decimal);
      }
    }
    this._lastDecimal = decimal;
    this._updateStakeCalc();
  },

  _updateStakeCalc: function() {
    var stake = parseFloat((document.getElementById('odds-stake') || {}).value) || 0;
    var returns = stake * this._lastDecimal;
    var retEl = document.getElementById('odds-returns');
    var profEl = document.getElementById('odds-profit');
    if (retEl) retEl.textContent = '£' + (returns || 0).toFixed(2);
    if (profEl) profEl.textContent = '£' + ((returns - stake) || 0).toFixed(2);
  },

  // =========================================================================
  // DUTCHING CALCULATOR TAB
  // =========================================================================

  _dutchRows: [{name:'Selection 1',odds:''},{name:'Selection 2',odds:''},{name:'Selection 3',odds:''}],
  _dutchStake: 50,

  _renderDutchCalc: function() {
    var rows = this._dutchRows;
    var rowsHtml = rows.map(function(r,i) {
      return '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">' +
        '<input type="text" placeholder="Selection ' + (i+1) + '" value="' + (r.name||'') + '" onchange="BetCalc._dutchRows[' + i + '].name=this.value" style="flex:1;padding:8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:12px;">' +
        '<input type="text" placeholder="Odds" value="' + (r.odds||'') + '" onchange="BetCalc._dutchRows[' + i + '].odds=this.value" style="width:100px;padding:8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:12px;text-align:center;">' +
        (rows.length > 2 ? '<button onclick="BetCalc._dutchRows.splice(' + i + ',1);BetCalc.render();" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:18px;">&times;</button>' : '<div style="width:18px;"></div>') +
      '</div>';
    }).join('');

    return '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;">' +
      '<h3 style="color:var(--text-primary);margin-bottom:4px;">Dutching Calculator</h3>' +
      '<p style="color:var(--text-secondary);font-size:12px;margin-bottom:16px;">Calculate stakes to guarantee the same return regardless of which selection wins.</p>' +
      rowsHtml +
      '<div style="display:flex;gap:8px;margin-bottom:16px;">' +
        '<button class="btn btn-outline btn-sm" onclick="BetCalc._dutchRows.push({name:\'Selection \'+(BetCalc._dutchRows.length+1),odds:\'\'});BetCalc.render();">+ Add Selection</button>' +
      '</div>' +
      '<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">' +
        '<label style="color:var(--text-secondary);font-size:13px;">Total Stake: &pound;</label>' +
        '<input type="number" value="' + this._dutchStake + '" onchange="BetCalc._dutchStake=parseFloat(this.value)||0" style="width:100px;padding:8px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:13px;">' +
      '</div>' +
      '<button class="btn btn-gold" onclick="BetCalc._calcDutchResult()">Calculate Stakes</button>' +
      '<div id="dutch-result" style="margin-top:16px;"></div>' +
    '</div>';
  },

  _calcDutchResult: function() {
    var results = this.calcDutch(this._dutchRows.filter(function(r){return r.odds;}), this._dutchStake);
    var el = document.getElementById('dutch-result');
    if (!el || results.length === 0) return;

    var html = '<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:10px;padding:16px;">' +
      '<table style="width:100%;font-size:13px;"><thead><tr style="color:var(--text-muted);">' +
        '<th style="text-align:left;padding:4px 8px;">Selection</th><th>Odds</th><th>Stake</th><th>Returns</th><th>Profit</th>' +
      '</tr></thead><tbody>';
    results.forEach(function(r) {
      html += '<tr><td style="padding:4px 8px;">' + r.name + '</td><td style="text-align:center;">' + r.odds + '</td>' +
        '<td style="text-align:center;font-weight:700;color:var(--gold);">&pound;' + r.stake.toFixed(2) + '</td>' +
        '<td style="text-align:center;color:var(--green);">&pound;' + r.returns.toFixed(2) + '</td>' +
        '<td style="text-align:center;color:var(--green);">&pound;' + r.profit.toFixed(2) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    el.innerHTML = html;
  },

  // =========================================================================
  // EACH-WAY CALCULATOR TAB
  // =========================================================================

  _ewOdds: '',
  _ewStake: 5,
  _ewPlaces: 3,
  _ewFraction: '1/4',

  _renderEWCalc: function() {
    return '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;">' +
      '<h3 style="color:var(--text-primary);margin-bottom:16px;">Each-Way Calculator</h3>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">' +
        '<div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Odds</label>' +
          '<input type="text" id="ew-odds" placeholder="10/1" value="' + this._ewOdds + '" oninput="BetCalc._ewOdds=this.value" style="width:100%;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:14px;"></div>' +
        '<div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Stake (per part)</label>' +
          '<input type="number" id="ew-stake" value="' + this._ewStake + '" oninput="BetCalc._ewStake=parseFloat(this.value)||0" style="width:100%;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:14px;"></div>' +
        '<div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Place Terms</label>' +
          '<select id="ew-fraction" onchange="BetCalc._ewFraction=this.value" style="width:100%;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:14px;">' +
            '<option value="1/4"' + (this._ewFraction === '1/4' ? ' selected' : '') + '>1/4 odds</option>' +
            '<option value="1/5"' + (this._ewFraction === '1/5' ? ' selected' : '') + '>1/5 odds</option>' +
            '<option value="1/3"' + (this._ewFraction === '1/3' ? ' selected' : '') + '>1/3 odds (festivals)</option>' +
          '</select></div>' +
        '<div><label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Places Paid</label>' +
          '<select id="ew-places" onchange="BetCalc._ewPlaces=parseInt(this.value)" style="width:100%;padding:10px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:14px;">' +
            '<option value="2"' + (this._ewPlaces === 2 ? ' selected' : '') + '>2 places</option>' +
            '<option value="3"' + (this._ewPlaces === 3 ? ' selected' : '') + '>3 places</option>' +
            '<option value="4"' + (this._ewPlaces === 4 ? ' selected' : '') + '>4 places</option>' +
            '<option value="5"' + (this._ewPlaces === 5 ? ' selected' : '') + '>5 places</option>' +
          '</select></div>' +
      '</div>' +
      '<button class="btn btn-gold" onclick="BetCalc._calcEWResult()">Calculate</button>' +
      '<div id="ew-result" style="margin-top:16px;"></div>' +
    '</div>';
  },

  _calcEWResult: function() {
    var dec = this.parseOdds(this._ewOdds);
    if (dec <= 1) return;
    var stake = this._ewStake;
    var fractionParts = this._ewFraction.split('/');
    var fraction = parseInt(fractionParts[0]) / parseInt(fractionParts[1]);
    var totalStake = stake * 2;

    var winReturn = stake * dec;
    var placeOdds = ((dec - 1) * fraction) + 1;
    var placeReturn = stake * placeOdds;

    var el = document.getElementById('ew-result');
    if (!el) return;

    el.innerHTML =
      '<div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.2);border-radius:10px;padding:20px;">' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">Total Stake: <strong style="color:var(--text-primary);">&pound;' + totalStake.toFixed(2) + '</strong> (&pound;' + stake.toFixed(2) + ' win + &pound;' + stake.toFixed(2) + ' place)</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;text-align:center;">' +
          '<div style="background:rgba(34,197,94,0.08);border-radius:8px;padding:14px;"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">If Wins</div><div style="font-size:22px;font-weight:900;color:var(--green);">&pound;' + (winReturn + placeReturn).toFixed(2) + '</div><div style="font-size:11px;color:var(--text-muted);">Profit: &pound;' + (winReturn + placeReturn - totalStake).toFixed(2) + '</div></div>' +
          '<div style="background:rgba(59,130,246,0.08);border-radius:8px;padding:14px;"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">If Places</div><div style="font-size:22px;font-weight:900;color:#60a5fa;">&pound;' + placeReturn.toFixed(2) + '</div><div style="font-size:11px;color:var(--text-muted);">Profit: &pound;' + (placeReturn - totalStake).toFixed(2) + '</div></div>' +
          '<div style="background:rgba(239,68,68,0.08);border-radius:8px;padding:14px;"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">If Loses</div><div style="font-size:22px;font-weight:900;color:var(--red);">-&pound;' + totalStake.toFixed(2) + '</div><div style="font-size:11px;color:var(--text-muted);">Total loss</div></div>' +
        '</div>' +
        '<div style="margin-top:12px;font-size:12px;color:var(--text-muted);text-align:center;">Place odds: ' + this.toFractional(placeOdds) + ' (' + placeOdds.toFixed(2) + ') at ' + this._ewFraction + ' of ' + this.toFractional(dec) + '</div>' +
      '</div>';
  },
};
