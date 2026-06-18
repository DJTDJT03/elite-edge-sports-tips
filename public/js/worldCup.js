/**
 * World Cup Mode — Frontend Module
 * Fully isolated. Loaded only when ENABLE_WORLD_CUP is true.
 * Removable: delete this file + worldCup.css + remove references in app.js & index.html.
 */

var WorldCup = (function() {
  var _tab = 'fixtures';
  var _fixtures = [];
  var _groups = [];
  var _tournament = null;
  var _predictions = [];
  var _leaderboard = [];
  var _previews = {};
  var _myNation = null;
  var _nationRankings = [];
  var _expandedPreview = null;

  // Country flag emoji map (FIFA 2026 qualifiers)
  var FLAGS = {
    'Argentina': '\ud83c\udde6\ud83c\uddf7', 'Brazil': '\ud83c\udde7\ud83c\uddf7', 'France': '\ud83c\uddeb\ud83c\uddf7',
    'Germany': '\ud83c\udde9\ud83c\uddea', 'Spain': '\ud83c\uddea\ud83c\uddf8', 'England': '\ud83c\udff4\udb40\udc67\udb40\udc62\udb40\udc65\udb40\udc6e\udb40\udc67\udb40\udc7f',
    'Portugal': '\ud83c\uddf5\ud83c\uddf9', 'Netherlands': '\ud83c\uddf3\ud83c\uddf1', 'Belgium': '\ud83c\udde7\ud83c\uddea',
    'Italy': '\ud83c\uddee\ud83c\uddf9', 'Croatia': '\ud83c\udded\ud83c\uddf7', 'Uruguay': '\ud83c\uddfa\ud83c\uddfe',
    'Colombia': '\ud83c\udde8\ud83c\uddf4', 'Mexico': '\ud83c\uddf2\ud83c\uddfd', 'USA': '\ud83c\uddfa\ud83c\uddf8',
    'Canada': '\ud83c\udde8\ud83c\udde6', 'Japan': '\ud83c\uddef\ud83c\uddf5', 'South Korea': '\ud83c\uddf0\ud83c\uddf7',
    'Australia': '\ud83c\udde6\ud83c\uddfa', 'Morocco': '\ud83c\uddf2\ud83c\udde6', 'Senegal': '\ud83c\uddf8\ud83c\uddf3',
    'Ghana': '\ud83c\uddec\ud83c\udded', 'Cameroon': '\ud83c\udde8\ud83c\uddf2', 'Nigeria': '\ud83c\uddf3\ud83c\uddec',
    'Tunisia': '\ud83c\uddf9\ud83c\uddf3', 'Ecuador': '\ud83c\uddea\ud83c\udde8', 'Saudi Arabia': '\ud83c\uddf8\ud83c\udde6',
    'Iran': '\ud83c\uddee\ud83c\uddf7', 'Qatar': '\ud83c\uddf6\ud83c\udde6', 'Wales': '\ud83c\udff4\udb40\udc67\udb40\udc62\udb40\udc77\udb40\udc6c\udb40\udc73\udb40\udc7f',
    'Poland': '\ud83c\uddf5\ud83c\uddf1', 'Denmark': '\ud83c\udde9\ud83c\uddf0', 'Switzerland': '\ud83c\udde8\ud83c\udded',
    'Serbia': '\ud83c\uddf7\ud83c\uddf8', 'Costa Rica': '\ud83c\udde8\ud83c\uddf7', 'Chile': '\ud83c\udde8\ud83c\uddf1',
    'Paraguay': '\ud83c\uddf5\ud83c\uddfe', 'Peru': '\ud83c\uddf5\ud83c\uddea', 'Bolivia': '\ud83c\udde7\ud83c\uddf4',
    'Venezuela': '\ud83c\uddfb\ud83c\uddea', 'Scotland': '\ud83c\udff4\udb40\udc67\udb40\udc62\udb40\udc73\udb40\udc63\udb40\udc74\udb40\udc7f',
    'Austria': '\ud83c\udde6\ud83c\uddf9', 'Czech Republic': '\ud83c\udde8\ud83c\uddff', 'Turkey': '\ud83c\uddf9\ud83c\uddf7',
    'Sweden': '\ud83c\uddf8\ud83c\uddea', 'Norway': '\ud83c\uddf3\ud83c\uddf4', 'Ukraine': '\ud83c\uddfa\ud83c\udde6',
    'Romania': '\ud83c\uddf7\ud83c\uddf4', 'Hungary': '\ud83c\udded\ud83c\uddfa', 'Slovakia': '\ud83c\uddf8\ud83c\uddf0',
    'Greece': '\ud83c\uddec\ud83c\uddf7', 'Algeria': '\ud83c\udde9\ud83c\uddff', 'Egypt': '\ud83c\uddea\ud83c\uddec',
    'DR Congo': '\ud83c\udde8\ud83c\udde9', 'Mali': '\ud83c\uddf2\ud83c\uddf1', 'Ivory Coast': '\ud83c\udde8\ud83c\uddee',
    'South Africa': '\ud83c\uddff\ud83c\udde6', 'Panama': '\ud83c\uddf5\ud83c\udde6', 'Honduras': '\ud83c\udded\ud83c\uddf3',
    'Jamaica': '\ud83c\uddef\ud83c\uddf2', 'China': '\ud83c\udde8\ud83c\uddf3', 'Indonesia': '\ud83c\uddee\ud83c\udde9',
    'New Zealand': '\ud83c\uddf3\ud83c\uddff',
  };

  // Crisp rectangular flag image (flagcdn) for any national side, reusing the
  // shared App.countryCode map; emoji flag as fallback, then a football.
  function getFlag(team) {
    var code = (window.App && App.countryCode) ? App.countryCode(team) : null;
    if (code) {
      return '<img src="/flags/' + code + '.png" alt="" ' +
        'style="height:14px;width:21px;border-radius:2px;object-fit:cover;vertical-align:-2px;' +
        'box-shadow:0 0 0 1px rgba(0,0,0,0.25);display:inline-block;" ' +
        'onerror="this.replaceWith(document.createTextNode(\'\u26bd\'))">';
    }
    return FLAGS[team] || '\u26bd';
  }

  function api(url) {
    return App.api('/world-cup' + url);
  }

  async function loadData() {
    try {
      var results = await Promise.all([
        api('/tournament'),
        api('/fixtures'),
        api('/groups'),
        api('/predictions/leaderboard'),
        api('/previews'),
      ]);
      _tournament = results[0] && results[0].tournament;
      _fixtures = (results[1] && results[1].fixtures) || [];
      _groups = (results[2] && results[2].groups) || [];
      _leaderboard = (results[3] && results[3].leaderboard) || [];
      // Index previews by fixture ID
      var previewList = (results[4] && results[4].previews) || [];
      _previews = {};
      previewList.forEach(function(p) { _previews[p.fixtureId] = p; });

      // Load user predictions if logged in
      if (App.user) {
        try {
          var myData = await api('/predictions/mine');
          _predictions = (myData && myData.predictions) || [];
        } catch(e) { _predictions = []; }
        try {
          var nationData = await api('/nation/rankings');
          _nationRankings = (nationData && nationData.rankings) || [];
        } catch(e) { _nationRankings = []; }
      }
    } catch(err) {
      console.error('[WorldCup] Failed to load data:', err);
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function formatTime(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function renderCountdown() {
    if (!_tournament || !_tournament.startDate) return '';
    var start = new Date(_tournament.startDate);
    var now = new Date();
    var diff = start - now;
    if (diff <= 0) return '<div class="wc-subtitle" style="color:#22c55e;font-weight:700;">TOURNAMENT IN PROGRESS</div>';

    var days = Math.floor(diff / (1000 * 60 * 60 * 24));
    var hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    var mins = Math.floor((diff / (1000 * 60)) % 60);
    var secs = Math.floor((diff / 1000) % 60);

    return '<div class="wc-countdown">' +
      '<div class="wc-countdown-unit"><span class="num">' + days + '</span><span class="label">Days</span></div>' +
      '<div class="wc-countdown-unit"><span class="num">' + hours + '</span><span class="label">Hours</span></div>' +
      '<div class="wc-countdown-unit"><span class="num">' + mins + '</span><span class="label">Mins</span></div>' +
      '<div class="wc-countdown-unit"><span class="num">' + secs + '</span><span class="label">Secs</span></div>' +
    '</div>';
  }

  function renderFixtures(stage) {
    var filtered = stage ? _fixtures.filter(function(f) { return f.stage === stage; }) : _fixtures;
    if (filtered.length === 0) return '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:40px 0;">No fixtures available yet. Check back closer to the tournament.</p>';

    return filtered.map(function(f) {
      var isLive = f.status === 'live';
      var isFinished = f.status === 'finished';
      var cls = 'wc-fixture-card' + (isLive ? ' live' : '');

      var meta = '<div class="wc-fixture-meta">' +
        '<span>' + (f.stage || '').replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }) +
        (f.groupLetter ? ' \u2022 Group ' + f.groupLetter : '') + '</span>' +
        '<span>' + (isLive ? '<span class="wc-live-badge">LIVE</span>' :
                    isFinished ? '\u2705 FT' :
                    formatDate(f.kickoff) + ' ' + formatTime(f.kickoff)) + '</span>' +
      '</div>';

      var scoreSection = '';
      if (isFinished || isLive) {
        scoreSection = '<div class="wc-fixture-score">' + (f.homeGoals || 0) + ' - ' + (f.awayGoals || 0) + '</div>';
      } else {
        scoreSection = '<span class="wc-vs">vs</span>';
      }

      var teams = '<div class="wc-fixture-teams">' +
        '<div class="wc-team">' + getFlag(f.homeTeam) + ' ' + f.homeTeam + '</div>' +
        scoreSection +
        '<div class="wc-team">' + f.awayTeam + ' ' + getFlag(f.awayTeam) + '</div>' +
      '</div>';

      var venue = f.venue ? '<div style="text-align:center;font-size:11px;color:rgba(255,255,255,0.3);margin-top:8px;">' + f.venue + '</div>' : '';

      // AI Preview card (generated 48 hours before kickoff)
      var previewHtml = '';
      var preview = _previews[f.id];
      if (preview) {
        var isExpanded = _expandedPreview === f.id;
        var signals = preview.signals || {};

        // Compact verdict bar (always visible)
        var verdictBar = '';
        if (preview.verdict) {
          verdictBar = '<div style="background:linear-gradient(135deg,rgba(212,168,67,0.12),rgba(212,168,67,0.04));border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:10px 14px;margin-top:10px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
              '<div style="display:flex;align-items:center;gap:8px;">' +
                '<span style="font-size:14px;">&#129504;</span>' +
                '<span style="font-size:12px;font-weight:700;color:#d4a843;">OUR PICK</span>' +
                (preview.verdictSelection ? '<span style="font-size:13px;font-weight:600;color:#fff;">' + preview.verdictSelection + '</span>' : '') +
                (preview.verdictOdds ? '<span style="background:rgba(34,197,94,0.15);color:#22c55e;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700;">' + preview.verdictOdds + '</span>' : '') +
              '</div>' +
              '<button onclick="event.stopPropagation();WorldCup.togglePreview(' + f.id + ')" style="background:none;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.6);padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;">' + (isExpanded ? 'Hide' : 'Full Analysis') + '</button>' +
            '</div>' +
            (preview.predictedScoreline ? '<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:6px;">Predicted: ' + preview.predictedScoreline + '</div>' : '') +
            (function() {
              // Hard model line (SportMonks): win% / scoreline / BTTS
              var sm = signals.sportmonks_model;
              if (!sm || !sm.winProb) return '';
              var abbr = function(name) { return (name || '').length > 3 ? name.substring(0, 3).toUpperCase() : (name || '').toUpperCase(); };
              return '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;">' +
                '<span style="color:rgba(255,255,255,0.4);">Model:</span>' +
                '<span style="color:#22c55e;font-weight:600;">' + abbr(preview.homeTeam) + ' ' + sm.winProb.home + '%</span>' +
                '<span style="color:#d4a843;font-weight:600;">Draw ' + sm.winProb.draw + '%</span>' +
                '<span style="color:#3b82f6;font-weight:600;">' + abbr(preview.awayTeam) + ' ' + sm.winProb.away + '%</span>' +
                (sm.btts != null ? '<span style="color:rgba(255,255,255,0.6);">BTTS ' + sm.btts + '%</span>' : '') +
              '</div>';
            })() +
          '</div>';
        }

        // Expanded deep analysis
        var expandedHtml = '';
        if (isExpanded) {
          var signalKeys = [
            { key: 'squad_news', icon: '&#128101;', label: 'Squad News' },
            { key: 'manager_tactics', icon: '&#128200;', label: 'Manager Tactics' },
            { key: 'group_implications', icon: '&#127942;', label: 'Group Implications' },
            { key: 'tournament_form', icon: '&#128293;', label: 'Tournament Form' },
            { key: 'key_player_battle', icon: '&#9917;', label: 'Key Player Battle' },
            { key: 'h2h_history', icon: '&#128218;', label: 'Head to Head' },
            { key: 'motivation_pressure', icon: '&#128170;', label: 'Motivation & Pressure' },
            { key: 'conditions_venue', icon: '&#127967;', label: 'Conditions & Venue' },
            { key: 'referee_profile', icon: '&#129717;', label: 'Referee Profile' },
            { key: 'betting_market', icon: '&#128176;', label: 'Market Intelligence' },
          ];

          var signalCards = signalKeys.map(function(sk) {
            var sig = signals[sk.key];
            if (!sig || !sig.value) return '';
            return '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px 12px;margin-bottom:6px;">' +
              '<div style="font-size:11px;font-weight:700;color:#d4a843;margin-bottom:4px;">' + sk.icon + ' ' + sk.label + '</div>' +
              '<div style="font-size:12px;color:rgba(255,255,255,0.75);line-height:1.5;">' + sig.value + '</div>' +
            '</div>';
          }).filter(function(s) { return s; }).join('');

          var verdictDetail = '';
          if (preview.verdict) {
            verdictDetail = '<div style="background:linear-gradient(135deg,rgba(34,197,94,0.08),rgba(212,168,67,0.08));border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:12px;margin-bottom:6px;">' +
              '<div style="font-size:11px;font-weight:700;color:#22c55e;margin-bottom:4px;">&#127919; ELITE EDGE VERDICT</div>' +
              '<div style="font-size:13px;color:#fff;line-height:1.5;font-weight:500;">' + preview.verdict + '</div>' +
            '</div>';
          }

          // Consensus debate (Phase 2 — the 5-analyst circuit)
          var consensusHtml = '';
          var cons = signals.consensus;
          if (cons && cons.debate && cons.debate.length) {
            var agreeColor = cons.agreementLevel === 3 ? '#22c55e' : cons.agreementLevel === 2 ? '#d4a843' : '#94a3b8';
            consensusHtml = '<div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:12px;margin-bottom:6px;">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
                '<div style="font-size:11px;font-weight:700;color:#3b82f6;">&#129504; ANALYST CONSENSUS</div>' +
                '<span style="font-size:10px;font-weight:700;color:' + agreeColor + ';background:rgba(255,255,255,0.05);padding:2px 8px;border-radius:4px;">' + (cons.agreementLabel || '') + ' &middot; ' + (cons.confidence || '-') + '/10</span>' +
              '</div>' +
              '<div style="font-size:13px;color:#fff;font-weight:600;margin-bottom:8px;">' + (cons.selection || '') + ' <span style="color:rgba(255,255,255,0.5);font-weight:400;">(' + (cons.market || '') + ')</span></div>' +
              cons.debate.map(function(d) {
                return '<div style="font-size:11px;color:rgba(255,255,255,0.65);line-height:1.5;margin-bottom:4px;">' +
                  '<strong style="color:#d4a843;">' + (d.agent || '') + ':</strong> ' + (d.selection || '-') + ' &mdash; ' + (d.reasoning || '') +
                '</div>';
              }).join('') +
            '</div>';
          }

          var citationHtml = '';
          if (preview.citations && preview.citations.length > 0) {
            citationHtml = '<div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:8px;border-top:1px solid rgba(255,255,255,0.05);padding-top:6px;">Sources: ' +
              preview.citations.slice(0, 5).map(function(c, i) { return '<a href="' + c + '" target="_blank" rel="noopener" style="color:rgba(212,168,67,0.5);">[' + (i+1) + ']</a>'; }).join(' ') +
            '</div>';
          }

          expandedHtml = '<div style="margin-top:8px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;">' +
            verdictDetail + consensusHtml + signalCards + citationHtml +
            '<div style="text-align:center;margin-top:6px;font-size:10px;color:rgba(255,255,255,0.25);">Generated ' + new Date(preview.generatedAt).toLocaleString('en-GB') + ' by The Tactician AI</div>' +
          '</div>';
        }

        previewHtml = verdictBar + expandedHtml;
      }

      // Prediction form for scheduled matches (logged in users)
      var predictForm = '';
      if (f.status === 'scheduled' && App.user) {
        var existing = _predictions.find(function(p) { return p.fixture_id === f.id; });
        if (existing) {
          predictForm = '<div style="text-align:center;margin-top:10px;font-size:12px;color:#d4a843;">' +
            '\ud83c\udfaf Your prediction: ' + existing.predicted_home + ' - ' + existing.predicted_away + '</div>';
        } else {
          predictForm = '<div class="wc-predict-form" style="margin-top:12px;padding:12px;border:none;">' +
            '<div class="wc-predict-scores">' +
              '<div class="wc-predict-team"><label>' + f.homeTeam + '</label>' +
                '<input type="number" min="0" max="20" value="0" id="wc-ph-' + f.id + '"></div>' +
              '<span style="color:rgba(255,255,255,0.3);font-size:20px;padding-top:20px;">-</span>' +
              '<div class="wc-predict-team"><label>' + f.awayTeam + '</label>' +
                '<input type="number" min="0" max="20" value="0" id="wc-pa-' + f.id + '"></div>' +
            '</div>' +
            '<button class="wc-predict-submit" onclick="WorldCup.submitPrediction(' + f.id + ')">Submit Prediction (1 credit)</button>' +
          '</div>';
        }
      }

      return '<div class="' + cls + '" data-fixture-id="' + f.id + '">' + meta + teams + venue + previewHtml + predictForm + '</div>';
    }).join('');
  }

  // WC 2026 qualification: 12 groups of 4 — the top 2 of each group plus the 8
  // best third-placed teams advance to the Round of 32. Computes, from the live
  // standings, which 3rd-placed teams are currently in the best-8 cut.
  function qualificationData() {
    var thirds = [];
    var playedGroups = {};
    _groups.forEach(function(g) {
      var s = g.standings || [];
      var played = s.some(function(t) { return (t.played || 0) > 0; });
      if (played) playedGroups[g.letter] = true;
      // Only groups that have actually played contribute a 3rd-placed candidate —
      // otherwise an unplayed group's 0-point team could grab a best-8 slot.
      if (played && s.length >= 3) {
        var t = s[2]; // standings arrive pre-sorted; index 2 = 3rd place
        thirds.push({ key: g.letter + '|' + t.team, points: t.points || 0, gd: t.goalDifference || 0, gf: t.goalsFor || 0 });
      }
    });
    thirds.sort(function(a, b) { return b.points - a.points || b.gd - a.gd || b.gf - a.gf; });
    var best = {};
    thirds.slice(0, 8).forEach(function(t) { best[t.key] = true; });
    return { bestThird: best, playedGroups: playedGroups, anyPlayed: Object.keys(playedGroups).length > 0 };
  }

  // Qualification status for a team at a given group position (0-based index).
  // Returns { color, badge, title } or null for no highlight.
  function qualStatus(q, groupLetter, team, idx) {
    if (idx < 2) return { color: '#22c55e', badge: 'Q', title: 'In a top-2 qualifying place' };
    if (idx === 2 && q.playedGroups[groupLetter]) {
      if (q.bestThird[groupLetter + '|' + team]) return { color: '#d4a843', badge: '3rd', title: 'Currently among the 8 best third-placed teams — advancing' };
      return { color: 'rgba(212,168,67,0.4)', badge: '3rd', title: '3rd place — outside the best-8 cut for now' };
    }
    return null;
  }

  function renderGroups() {
    if (_groups.length === 0) return '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:40px 0;">Groups not yet drawn.</p>';
    var q = qualificationData();

    var grid = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;">' +
      _groups.map(function(g) {
        var standings = g.standings || [];
        var rows = standings.map(function(t, idx) {
          var st = qualStatus(q, g.letter, t.team, idx);
          var teamStyle = st ? ' style="border-left:3px solid ' + st.color + ';padding-left:8px;"' : '';
          var badge = st ? ' <span title="' + st.title + '" style="font-size:9px;font-weight:800;color:' + st.color + ';border:1px solid ' + st.color + ';border-radius:3px;padding:0 4px;vertical-align:middle;">' + st.badge + '</span>' : '';
          return '<tr>' +
            '<td' + teamStyle + '>' + getFlag(t.team) + ' ' + t.team + badge + '</td>' +
            '<td>' + (t.played || 0) + '</td>' +
            '<td>' + (t.won || 0) + '</td>' +
            '<td>' + (t.drawn || 0) + '</td>' +
            '<td>' + (t.lost || 0) + '</td>' +
            '<td>' + (t.goalDifference >= 0 ? '+' : '') + (t.goalDifference || 0) + '</td>' +
            '<td style="font-weight:900;color:#d4a843;">' + (t.points || 0) + '</td>' +
          '</tr>';
        }).join('');

        return '<div class="wc-group-card">' +
          '<h3>Group ' + g.letter + '</h3>' +
          '<table class="wc-group-table">' +
            '<thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
      }).join('') +
    '</div>';

    var legend = '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;font-size:12px;color:rgba(255,255,255,0.55);margin-bottom:14px;">' +
      '<span><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:2px;margin-right:5px;vertical-align:middle;"></span>Top 2 — qualify</span>' +
      '<span><span style="display:inline-block;width:10px;height:10px;background:#d4a843;border-radius:2px;margin-right:5px;vertical-align:middle;"></span>Best 8 third-placed — also advance to the Round of 32</span>' +
    '</div>';

    return legend + grid;
  }

  function renderBracket() {
    var knockout = _fixtures.filter(function(f) { return f.stage !== 'group'; });
    if (knockout.length === 0) return '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:40px 0;">Knockout stage not yet underway.</p>';

    var stages = ['round-of-32', 'round-of-16', 'quarter-final', 'semi-final', 'third-place', 'final'];
    var stageLabels = { 'round-of-32': 'Round of 32', 'round-of-16': 'Round of 16', 'quarter-final': 'Quarter-Finals', 'semi-final': 'Semi-Finals', 'third-place': '3rd Place', 'final': 'Final' };

    return '<div class="wc-bracket">' +
      stages.map(function(stage) {
        var matches = knockout.filter(function(f) { return f.stage === stage; });
        if (matches.length === 0) return '';
        return '<div class="wc-bracket-round">' +
          '<h4>' + stageLabels[stage] + '</h4>' +
          matches.map(function(m) {
            // Derive the winner from the score when the result flag isn't set.
            var bothGoals = m.homeGoals != null && m.awayGoals != null;
            var homeWin = m.result === 'home' || (bothGoals && m.homeGoals > m.awayGoals);
            var awayWin = m.result === 'away' || (bothGoals && m.awayGoals > m.homeGoals);
            return '<div class="wc-bracket-match">' +
              '<div class="wc-bracket-team' + (homeWin ? ' winner' : '') + '">' +
                '<span>' + getFlag(m.homeTeam) + ' ' + (m.homeTeam || 'TBD') + '</span>' +
                '<span>' + (m.homeGoals != null ? m.homeGoals : '-') + '</span>' +
              '</div>' +
              '<div class="wc-bracket-team' + (awayWin ? ' winner' : '') + '">' +
                '<span>' + getFlag(m.awayTeam) + ' ' + (m.awayTeam || 'TBD') + '</span>' +
                '<span>' + (m.awayGoals != null ? m.awayGoals : '-') + '</span>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>';
      }).join('') +
    '</div>';
  }

  function renderLeaderboard() {
    if (_leaderboard.length === 0) return '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:40px 0;">No predictions scored yet. Be first on the board!</p>';

    return '<div style="background:rgba(255,255,255,0.02);border-radius:12px;overflow:hidden;">' +
      _leaderboard.map(function(r) {
        return '<div class="wc-leaderboard-row">' +
          '<span class="wc-rank">#' + r.rank + '</span>' +
          '<span class="wc-lb-name">' + r.name + '</span>' +
          '<span class="wc-lb-stats">' + r.exactScores + ' exact \u2022 ' + r.correctResults + ' correct</span>' +
          '<span class="wc-lb-points">' + r.totalPoints + ' pts</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function renderMyPredictions() {
    if (!App.user) return '<p style="color:rgba(255,255,255,0.5);text-align:center;padding:40px 0;">Log in to track your predictions.</p>';
    if (_predictions.length === 0) return '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:40px 0;">You haven\'t made any predictions yet. Head to Fixtures to get started!</p>';

    return _predictions.map(function(p) {
      var pts = p.scored ? (' \u2014 <span style="color:#d4a843;font-weight:900;">' + (p.points || 0) + ' pts</span>') : '';
      var statusBadge = p.match_status === 'finished' ? '\u2705' : (p.match_status === 'live' ? '\ud83d\udfe2' : '\u23f3');
      return '<div class="wc-fixture-card">' +
        '<div class="wc-fixture-meta"><span>' + (p.stage || '').replace(/-/g, ' ') + '</span><span>' + statusBadge + '</span></div>' +
        '<div class="wc-fixture-teams">' +
          '<div class="wc-team">' + getFlag(p.home_team) + ' ' + p.home_team + '</div>' +
          '<div class="wc-fixture-score" style="font-size:14px;">' + p.predicted_home + ' - ' + p.predicted_away + '</div>' +
          '<div class="wc-team">' + p.away_team + ' ' + getFlag(p.away_team) + '</div>' +
        '</div>' +
        (p.match_status === 'finished' ? '<div style="text-align:center;font-size:12px;color:rgba(255,255,255,0.4);margin-top:6px;">Actual: ' + (p.home_goals || 0) + ' - ' + (p.away_goals || 0) + pts + '</div>' : '') +
      '</div>';
    }).join('');
  }

  function renderNationWars() {
    var teams = Object.keys(FLAGS).sort();
    var picker = '<h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">Pick Your Nation</h3>';
    if (!App.user) {
      picker = '<p style="color:rgba(255,255,255,0.5);text-align:center;padding:20px 0;">Log in to pledge your nation.</p>';
    } else {
      picker += '<div class="wc-nation-picker">' +
        teams.map(function(team) {
          var sel = _myNation === team ? ' selected' : '';
          return '<div class="wc-nation-btn' + sel + '" onclick="WorldCup.setNation(\'' + team.replace(/'/g, "\\'") + '\')">' +
            '<span class="flag">' + FLAGS[team] + '</span>' + team +
          '</div>';
        }).join('') +
      '</div>';
    }

    var rankings = '';
    if (_nationRankings.length > 0) {
      rankings = '<h3 style="font-size:16px;font-weight:700;margin:24px 0 12px;">Nation Rankings</h3>' +
        '<div style="background:rgba(255,255,255,0.02);border-radius:12px;overflow:hidden;">' +
        _nationRankings.map(function(r, i) {
          return '<div class="wc-leaderboard-row">' +
            '<span class="wc-rank">#' + (i + 1) + '</span>' +
            '<span class="wc-lb-name">' + getFlag(r.country) + ' ' + r.country + '</span>' +
            '<span class="wc-lb-stats">' + r.fans + ' fans</span>' +
            '<span class="wc-lb-points">' + (r.total_points || 0) + ' pts</span>' +
          '</div>';
        }).join('') +
        '</div>';
    }

    return picker + rankings;
  }

  // Projected qualifiers — driven live off the actual group standings (top 2 of
  // each group + the 8 best third-placed teams). No hardcoded predictions.
  function renderOurPicks() {
    if (_groups.length === 0) {
      return '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:40px 0;">Projections appear once the groups and fixtures are loaded.</p>';
    }
    var q = qualificationData();

    var header = '<div style="margin-bottom:20px;">' +
      '<div style="display:inline-block;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);padding:6px 14px;border-radius:6px;font-size:12px;color:#22c55e;font-weight:700;margin-bottom:16px;">' +
        (q.anyPlayed ? 'LIVE PROJECTION · FROM CURRENT STANDINGS' : 'PROJECTED QUALIFIERS') + '</div>' +
      '<h3 style="font-size:20px;font-weight:900;color:#d4a843;margin-bottom:4px;">Road to the Round of 32</h3>' +
      '<p style="font-size:13px;color:rgba(255,255,255,0.45);margin-bottom:8px;">The top 2 from each group plus the 8 best third-placed teams advance. ' +
        (q.anyPlayed ? 'Updated live as results come in.' : 'This fills in live once the group games kick off.') + '</p>' +
    '</div>';

    if (!q.anyPlayed) {
      return header + '<div style="text-align:center;padding:30px;background:rgba(255,255,255,0.02);border-radius:10px;color:rgba(255,255,255,0.4);font-size:13px;">No group games have been played yet — projected qualifiers will appear here as soon as the standings move.</div>';
    }

    var pickRow = function(t, color, label) {
      if (!t) return '';
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
        '<span style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + ';padding:1px 6px;border-radius:3px;font-size:9px;font-weight:800;min-width:30px;text-align:center;">' + label + '</span>' +
        '<span style="font-size:14px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + getFlag(t.team) + ' ' + t.team + '</span>' +
        '<span style="margin-left:auto;font-size:12px;color:rgba(255,255,255,0.4);">' + (t.points || 0) + ' pts</span>' +
      '</div>';
    };

    var grid = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:10px;margin-bottom:24px;">' +
      _groups.map(function(g) {
        var s = g.standings || [];
        var t3 = s[2];
        var thirdIn = t3 && q.bestThird[g.letter + '|' + t3.team];
        return '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px;">' +
          '<div style="font-size:11px;font-weight:800;color:#d4a843;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">Group ' + g.letter + '</div>' +
          pickRow(s[0], '#22c55e', '1st') +
          pickRow(s[1], '#22c55e', '2nd') +
          (t3 ? pickRow(t3, thirdIn ? '#d4a843' : 'rgba(212,168,67,0.45)', thirdIn ? '3rd ✓' : '3rd') : '') +
        '</div>';
      }).join('') +
    '</div>';

    var note = '<div style="text-align:center;padding:16px;background:rgba(255,255,255,0.02);border-radius:10px;">' +
      '<div style="font-size:12px;color:rgba(255,255,255,0.4);">The knockout bracket fills in as the group stage concludes — see the <strong style="color:#d4a843;">Bracket</strong> tab. Our per-match calls live under <strong style="color:#d4a843;">Fixtures → Full Analysis</strong>.</div>' +
      '<div style="font-size:11px;color:rgba(255,255,255,0.25);margin-top:6px;">eliteedgesports.co.uk | 18+ | BeGambleAware.org</div>' +
    '</div>';

    return header + grid + note;
  }

  function renderValueFinder() {
    setTimeout(function () { WorldCup._loadValue(); }, 30);
    return '<div style="margin-bottom:16px;">' +
      '<div style="display:inline-block;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);padding:6px 14px;border-radius:6px;font-size:12px;color:#22c55e;font-weight:700;margin-bottom:12px;">ELITE EDGE QUANT MODEL vs THE MARKET</div>' +
      '<h3 style="font-size:20px;font-weight:900;color:#d4a843;margin-bottom:4px;">Value Finder</h3>' +
      '<p style="font-size:13px;color:rgba(255,255,255,0.45);margin-bottom:16px;">Where our in-house model rates a selection more likely than the bookmakers’ price implies. Bigger edge = bigger gap between our model and the market.</p>' +
      '<div id="wc-value-list"><div style="text-align:center;padding:30px;color:rgba(255,255,255,0.4);">Scanning the market…</div></div>' +
    '</div>';
  }

  function renderScorecard() {
    setTimeout(function () { WorldCup._loadScorecard(); }, 30);
    return '<div style="margin-bottom:16px;">' +
      '<div style="display:inline-block;background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);padding:6px 14px;border-radius:6px;font-size:12px;color:#d4a843;font-weight:700;margin-bottom:12px;">CONSENSUS ENGINE · TRACK RECORD</div>' +
      '<h3 style="font-size:20px;font-weight:900;color:#d4a843;margin-bottom:4px;">World Cup Scorecard</h3>' +
      '<p style="font-size:13px;color:rgba(255,255,255,0.45);margin-bottom:16px;">Every pick our engine called, against the actual result. No hindsight, no edits.</p>' +
      '<div id="wc-scorecard"><div style="text-align:center;padding:30px;color:rgba(255,255,255,0.4);">Tallying the results…</div></div>' +
    '</div>';
  }

  function renderTabContent() {
    switch (_tab) {
      case 'fixtures': return renderFixtures();
      case 'groups': return renderGroups();
      case 'bracket': return renderBracket();
      case 'our-picks': return renderOurPicks();
      case 'scorecard': return renderScorecard();
      case 'value': return renderValueFinder();
      case 'leaderboard': return renderLeaderboard();
      case 'predictions': return renderMyPredictions();
      case 'nations': return renderNationWars();
      default: return renderFixtures();
    }
  }

  function render() {
    var app = document.getElementById('app');
    app.innerHTML = '<div style="padding:0 4px;"><div style="text-align:center;padding:40px 0;color:rgba(255,255,255,0.4);">Loading World Cup Mode...</div></div>';

    loadData().then(function() {
      var tournamentName = _tournament ? _tournament.name : 'FIFA World Cup 2026';
      var html = '<div style="padding:0 4px;max-width:100%;overflow-x:hidden;">' +
        '<div class="wc-hub-header">' +
          '<h1>\u26bd ' + tournamentName + '</h1>' +
          '<div class="wc-subtitle">Predict. Compete. Represent Your Nation.</div>' +
          renderCountdown() +
        '</div>' +
        '<div class="wc-tabs">' +
          ['fixtures', 'groups', 'bracket', 'our-picks', 'scorecard', 'value', 'predictions', 'leaderboard', 'nations'].map(function(t) {
            var label = t.charAt(0).toUpperCase() + t.slice(1);
            if (t === 'nations') label = 'Nation Wars';
            if (t === 'value') label = 'Value Finder';
            if (t === 'our-picks') label = 'Our Picks';
            return '<div class="wc-tab' + (_tab === t ? ' active' : '') + '" onclick="WorldCup.switchTab(\'' + t + '\')">' + label + '</div>';
          }).join('') +
        '</div>' +
        '<div id="wc-content">' + renderTabContent() + '</div>' +
      '</div>';

      app.innerHTML = html;

      // Start countdown timer
      if (_tournament && _tournament.startDate) {
        WorldCup._countdownInterval = setInterval(function() {
          var el = document.querySelector('.wc-countdown');
          if (!el) { clearInterval(WorldCup._countdownInterval); return; }
          var start = new Date(_tournament.startDate);
          var now = new Date();
          var diff = start - now;
          if (diff <= 0) {
            el.outerHTML = '<div class="wc-subtitle" style="color:#22c55e;font-weight:700;">TOURNAMENT IN PROGRESS</div>';
            clearInterval(WorldCup._countdownInterval);
            return;
          }
          var days = Math.floor(diff / (1000 * 60 * 60 * 24));
          var hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
          var mins = Math.floor((diff / (1000 * 60)) % 60);
          var secs = Math.floor((diff / 1000) % 60);
          el.innerHTML =
            '<div class="wc-countdown-unit"><span class="num">' + days + '</span><span class="label">Days</span></div>' +
            '<div class="wc-countdown-unit"><span class="num">' + hours + '</span><span class="label">Hours</span></div>' +
            '<div class="wc-countdown-unit"><span class="num">' + mins + '</span><span class="label">Mins</span></div>' +
            '<div class="wc-countdown-unit"><span class="num">' + secs + '</span><span class="label">Secs</span></div>';
        }, 1000);
      }
    });
  }

  function switchTab(tab) {
    _tab = tab;
    // Update tab UI
    document.querySelectorAll('.wc-tab').forEach(function(el) {
      var label = el.textContent.toLowerCase();
      var key = label === 'nation wars' ? 'nations' : label === 'value finder' ? 'value' : label === 'our picks' ? 'our-picks' : label;
      el.classList.toggle('active', key === tab);
    });
    var content = document.getElementById('wc-content');
    if (content) content.innerHTML = renderTabContent();
  }

  async function submitPrediction(fixtureId) {
    var homeEl = document.getElementById('wc-ph-' + fixtureId);
    var awayEl = document.getElementById('wc-pa-' + fixtureId);
    if (!homeEl || !awayEl) return;

    var predictedHome = parseInt(homeEl.value) || 0;
    var predictedAway = parseInt(awayEl.value) || 0;

    try {
      var result = await App.api('/world-cup/predictions', {
        method: 'POST',
        body: JSON.stringify({ fixtureId: fixtureId, predictedHome: predictedHome, predictedAway: predictedAway }),
      });
      if (result.error) {
        App.showToast(result.error, 'error');
        return;
      }
      App.showToast('Prediction submitted! ' + predictedHome + ' - ' + predictedAway, 'success');
      // Refresh predictions
      try {
        var myData = await api('/predictions/mine');
        _predictions = (myData && myData.predictions) || [];
      } catch(e) {}
      // Re-render current tab
      var content = document.getElementById('wc-content');
      if (content) content.innerHTML = renderTabContent();
    } catch(err) {
      App.showToast('Failed to submit prediction', 'error');
    }
  }

  async function setNation(country) {
    try {
      var result = await App.api('/world-cup/nation', {
        method: 'POST',
        body: JSON.stringify({ country: country }),
      });
      if (result.error) {
        App.showToast(result.error, 'error');
        return;
      }
      _myNation = country;
      App.showToast('You\'re backing ' + getFlag(country) + ' ' + country + '!', 'success');
      // Refresh nation rankings
      try {
        var nationData = await api('/nation/rankings');
        _nationRankings = (nationData && nationData.rankings) || [];
      } catch(e) {}
      var content = document.getElementById('wc-content');
      if (content) content.innerHTML = renderNationWars();
    } catch(err) {
      App.showToast('Failed to set nation', 'error');
    }
  }

  function togglePreview(fixtureId) {
    _expandedPreview = _expandedPreview === fixtureId ? null : fixtureId;
    var content = document.getElementById('wc-content');
    if (content) content.innerHTML = renderTabContent();
  }

  function cleanup() {
    if (WorldCup._countdownInterval) {
      clearInterval(WorldCup._countdownInterval);
      WorldCup._countdownInterval = null;
    }
  }

  function _loadValue() {
    var el = document.getElementById('wc-value-list');
    if (!el) return;
    api('/value-scan').then(function (data) {
      el = document.getElementById('wc-value-list');
      if (!el) return;
      if (!data || !data.ready || !data.flags || !data.flags.length) {
        el.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.4);">No value flags right now — our model and the market are in line on the upcoming games. Check back as new fixtures approach.</div>';
        return;
      }
      el.innerHTML = data.flags.map(function (v) {
        var t = new Date(v.kickoff).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        var edgeCol = v.edge >= 12 ? '#22c55e' : v.edge >= 8 ? '#84cc16' : '#d4a843';
        return '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-left:3px solid ' + edgeCol + ';border-radius:10px;padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
          '<div style="flex:1;min-width:170px;"><div style="font-size:14px;font-weight:700;color:#fff;">' + App.escapeHtml(v.fixture) + '</div>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.4);">' + t + ' · ' + App.escapeHtml(v.market) + '</div></div>' +
          '<div style="text-align:center;min-width:150px;"><div style="font-size:15px;font-weight:800;color:#d4a843;">' + App.escapeHtml(v.selection) + '</div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,0.5);">Model ' + v.modelProb + '% vs Market ' + v.marketProb + '%</div></div>' +
          '<div style="text-align:right;min-width:84px;"><div style="font-size:18px;font-weight:900;color:' + edgeCol + ';">+' + v.edge + '%</div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,0.4);">edge · @ ' + v.odds + '</div></div>' +
        '</div>';
      }).join('') +
        '<p style="font-size:11px;color:rgba(255,255,255,0.25);margin-top:12px;text-align:center;">Elite Edge quant model vs de-vigged market odds. 18+ | Analysis, not betting advice | BeGambleAware.org</p>';
    }).catch(function () {
      var e = document.getElementById('wc-value-list');
      if (e) e.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.4);">Value scan unavailable right now.</div>';
    });
  }

  function _loadScorecard() {
    var el = document.getElementById('wc-scorecard');
    if (!el) return;
    api('/scorecard').then(function (data) {
      el = document.getElementById('wc-scorecard');
      if (!el) return;
      if (!data || !data.ready || !data.picks || !data.picks.length) {
        el.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.4);">No settled picks yet — the scorecard fills in as games finish.</div>';
        return;
      }
      var rate = data.hitRate;
      var rateCol = rate >= 60 ? '#22c55e' : rate >= 50 ? '#84cc16' : '#d4a843';
      var summary = '<div style="background:linear-gradient(135deg,rgba(212,168,67,0.12),rgba(212,168,67,0.02));border:1px solid rgba(212,168,67,0.25);border-radius:14px;padding:18px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;">' +
        '<div><div style="font-size:13px;color:rgba(255,255,255,0.5);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Our Record So Far</div>' +
        '<div style="font-size:30px;font-weight:900;color:#fff;line-height:1.1;">' + data.correct + ' <span style="color:rgba(255,255,255,0.4);font-size:20px;">won</span> · ' + data.wrong + ' <span style="color:rgba(255,255,255,0.4);font-size:20px;">lost</span></div></div>' +
        '<div style="text-align:center;"><div style="font-size:40px;font-weight:900;color:' + rateCol + ';line-height:1;">' + rate + '%</div>' +
        '<div style="font-size:12px;color:rgba(255,255,255,0.45);font-weight:600;">strike rate · ' + data.scored + ' picks</div></div>' +
      '</div>';
      var rows = data.picks.map(function (p) {
        var hit = p.hit === true, miss = p.hit === false;
        var col = hit ? '#22c55e' : miss ? '#ef4444' : 'rgba(255,255,255,0.3)';
        var icon = hit ? '✓' : miss ? '✗' : '–';
        return '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-left:3px solid ' + col + ';border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
          '<div style="flex:1;min-width:160px;"><div style="font-size:14px;font-weight:700;color:#fff;">' + getFlag(p.home) + ' ' + App.escapeHtml(p.home) + ' ' + p.score + ' ' + App.escapeHtml(p.away) + ' ' + getFlag(p.away) + '</div>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.4);">' + App.escapeHtml(p.market) + '</div></div>' +
          '<div style="text-align:center;min-width:130px;"><div style="font-size:14px;font-weight:800;color:#d4a843;">' + App.escapeHtml(p.pick) + '</div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,0.45);">our call</div></div>' +
          '<div style="width:34px;height:34px;border-radius:50%;background:' + col + (hit || miss ? '22' : '00') + ';display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:' + col + ';">' + icon + '</div>' +
        '</div>';
      }).join('');
      el.innerHTML = summary + rows +
        '<p style="font-size:11px;color:rgba(255,255,255,0.25);margin-top:12px;text-align:center;">Elite Edge consensus engine · picks recorded before kick-off. 18+ | Analysis, not betting advice | BeGambleAware.org</p>';
    }).catch(function () {
      var e = document.getElementById('wc-scorecard');
      if (e) e.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.4);">Scorecard unavailable right now.</div>';
    });
  }

  return {
    render: render,
    switchTab: switchTab,
    submitPrediction: submitPrediction,
    setNation: setNation,
    togglePreview: togglePreview,
    cleanup: cleanup,
    _loadValue: _loadValue,
    _loadScorecard: _loadScorecard,
    _countdownInterval: null,
  };
})();
