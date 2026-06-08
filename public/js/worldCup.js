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

  function getFlag(team) {
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

          var citationHtml = '';
          if (preview.citations && preview.citations.length > 0) {
            citationHtml = '<div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:8px;border-top:1px solid rgba(255,255,255,0.05);padding-top:6px;">Sources: ' +
              preview.citations.slice(0, 5).map(function(c, i) { return '<a href="' + c + '" target="_blank" rel="noopener" style="color:rgba(212,168,67,0.5);">[' + (i+1) + ']</a>'; }).join(' ') +
            '</div>';
          }

          expandedHtml = '<div style="margin-top:8px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;">' +
            verdictDetail + signalCards + citationHtml +
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

  function renderGroups() {
    if (_groups.length === 0) return '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:40px 0;">Groups not yet drawn.</p>';

    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;">' +
      _groups.map(function(g) {
        var standings = g.standings || [];
        var rows = standings.map(function(t) {
          return '<tr>' +
            '<td>' + getFlag(t.team) + ' ' + t.team + '</td>' +
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
  }

  function renderBracket() {
    var knockout = _fixtures.filter(function(f) { return f.stage !== 'group'; });
    if (knockout.length === 0) return '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:40px 0;">Knockout stage not yet underway.</p>';

    var stages = ['round-of-16', 'quarter-final', 'semi-final', 'third-place', 'final'];
    var stageLabels = { 'round-of-16': 'Round of 16', 'quarter-final': 'Quarter-Finals', 'semi-final': 'Semi-Finals', 'third-place': '3rd Place', 'final': 'Final' };

    return '<div class="wc-bracket">' +
      stages.map(function(stage) {
        var matches = knockout.filter(function(f) { return f.stage === stage; });
        if (matches.length === 0) return '';
        return '<div class="wc-bracket-round">' +
          '<h4>' + stageLabels[stage] + '</h4>' +
          matches.map(function(m) {
            var homeWin = m.result === 'home';
            var awayWin = m.result === 'away';
            return '<div class="wc-bracket-match">' +
              '<div class="wc-bracket-team' + (homeWin ? ' winner' : '') + '">' +
                '<span>' + getFlag(m.homeTeam) + ' ' + (m.homeTeam || 'TBD') + '</span>' +
                '<span>' + (m.homeGoals !== null ? m.homeGoals : '-') + '</span>' +
              '</div>' +
              '<div class="wc-bracket-team' + (awayWin ? ' winner' : '') + '">' +
                '<span>' + getFlag(m.awayTeam) + ' ' + (m.awayTeam || 'TBD') + '</span>' +
                '<span>' + (m.awayGoals !== null ? m.awayGoals : '-') + '</span>' +
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

  function renderOurPicks() {
    var groupPicks = {
      A: { winner: 'Mexico', runnerUp: 'South Korea', reasoning: 'Home advantage at Estadio Azteca gives Mexico the edge. Son Heung-min carries South Korea through.' },
      B: { winner: 'Switzerland', runnerUp: 'Canada', reasoning: 'Swiss tactical discipline wins the group. Canada benefit from home soil in Toronto.' },
      C: { winner: 'Brazil', runnerUp: 'Morocco', reasoning: 'Brazilian talent overcomes Ancelotti\'s limited prep time. Morocco are genuine — 2022 semi-finalists.' },
      D: { winner: 'USA', runnerUp: 'Turkey', reasoning: 'Home crowd across 11 venues. Pulisic, McKennie, Reyna. Turkey are dark horses with Calhanoglu + Yildiz.' },
      E: { winner: 'Germany', runnerUp: 'Ecuador', reasoning: 'Musiala + Wirtz make Germany genuine contenders. Ecuador\'s South American quality underrated.' },
      F: { winner: 'Netherlands', runnerUp: 'Japan', reasoning: 'Dutch class tells. Japan are genuine dark horses — beat Germany and Spain in 2022.' },
      G: { winner: 'Belgium', runnerUp: 'Egypt', reasoning: 'Golden generation\'s last shot. De Bruyne, Doku. Salah carries Egypt.' },
      H: { winner: 'Spain', runnerUp: 'Uruguay', reasoning: 'Euro 2024 champions. Best squad in tournament. Rodri + Pedri + Yamal.' },
      I: { winner: 'France', runnerUp: 'Senegal', reasoning: 'Mbapp\u00e9 era. Deepest talent pool in Europe. Senegal\'s AFCON quality.' },
      J: { winner: 'Argentina', runnerUp: 'Austria', reasoning: 'Defending champions. Messi\'s farewell. Rangnick\'s Austria will push them.' },
      K: { winner: 'Portugal', runnerUp: 'Colombia', reasoning: 'Ronaldo\'s farewell tournament. Squad depth beyond CR7. Colombia\'s D\u00edaz electric.' },
      L: { winner: 'England', runnerUp: 'Croatia', reasoning: 'Most talented squad in decades. Bellingham, Saka, Foden. Modric\'s last dance for Croatia.' },
    };

    var knockoutPicks = [
      { stage: 'Quarter-Finals', matches: [
        { home: 'France', away: 'Netherlands', pick: 'France', conf: 7 },
        { home: 'Brazil', away: 'England', pick: 'England', conf: 7 },
        { home: 'Spain', away: 'USA', pick: 'Spain', conf: 9 },
        { home: 'Argentina', away: 'Portugal', pick: 'Argentina', conf: 7 },
      ]},
      { stage: 'Semi-Finals', matches: [
        { home: 'France', away: 'England', pick: 'England', conf: 6 },
        { home: 'Spain', away: 'Argentina', pick: 'Spain', conf: 7 },
      ]},
      { stage: 'THE FINAL', matches: [
        { home: 'Spain', away: 'England', pick: 'Spain', conf: 8, score: '2-1' },
      ]},
    ];

    var html = '<div style="margin-bottom:24px;">' +
      '<div style="display:inline-block;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);padding:6px 14px;border-radius:6px;font-size:12px;color:#22c55e;font-weight:700;margin-bottom:16px;">MULTI-AGENT CONSENSUS \u2014 The Tactician + The Professor + The Scout + GPT Arbiter</div>' +
      '<h3 style="font-size:20px;font-weight:900;color:#d4a843;margin-bottom:4px;">Predicted Group Winners</h3>' +
      '<p style="font-size:13px;color:rgba(255,255,255,0.4);margin-bottom:16px;">Our AI analysts predict who tops each group and qualifies for the knockouts</p>' +
    '</div>';

    // Group predictions grid
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;margin-bottom:28px;">';
    for (var letter in groupPicks) {
      var gp = groupPicks[letter];
      html += '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px;">' +
        '<div style="font-size:11px;font-weight:800;color:#d4a843;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">Group ' + letter + '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
          '<span style="background:rgba(34,197,94,0.15);color:#22c55e;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;">WINNER</span>' +
          '<span style="font-size:14px;font-weight:700;color:#fff;">' + getFlag(gp.winner) + ' ' + gp.winner + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
          '<span style="background:rgba(212,168,67,0.15);color:#d4a843;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;">QUALIFY</span>' +
          '<span style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.7);">' + getFlag(gp.runnerUp) + ' ' + gp.runnerUp + '</span>' +
        '</div>' +
        '<div style="font-size:11px;color:rgba(255,255,255,0.4);line-height:1.4;">' + gp.reasoning + '</div>' +
      '</div>';
    }
    html += '</div>';

    // Knockout predictions
    knockoutPicks.forEach(function(round) {
      var isFinal = round.stage === 'THE FINAL';
      html += '<div style="margin-bottom:20px;">' +
        '<div style="font-size:12px;font-weight:800;color:#d4a843;text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid rgba(212,168,67,0.15);">' + round.stage + '</div>';

      round.matches.forEach(function(m) {
        var pickIsHome = m.pick === m.home;
        html += '<div style="' + (isFinal ? 'background:linear-gradient(135deg,rgba(212,168,67,0.1),rgba(212,168,67,0.04));border:2px solid rgba(212,168,67,0.3);' : 'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);') + 'border-radius:10px;padding:14px 18px;margin-bottom:8px;display:flex;align-items:center;gap:14px;">' +
          '<div style="flex:1;display:flex;align-items:center;gap:8px;">' +
            '<span style="font-size:15px;font-weight:' + (pickIsHome ? '900;color:#22c55e' : '600;color:rgba(255,255,255,0.5)') + ';">' + getFlag(m.home) + ' ' + m.home + '</span>' +
            '<span style="color:rgba(255,255,255,0.2);font-size:12px;">vs</span>' +
            '<span style="font-size:15px;font-weight:' + (!pickIsHome ? '900;color:#22c55e' : '600;color:rgba(255,255,255,0.5)') + ';">' + m.away + ' ' + getFlag(m.away) + '</span>' +
          '</div>' +
          (m.score ? '<div style="font-size:24px;font-weight:900;color:#d4a843;">' + m.score + '</div>' : '') +
          '<div style="text-align:right;">' +
            '<div style="font-size:12px;font-weight:800;color:#22c55e;background:rgba(34,197,94,0.1);padding:3px 10px;border-radius:4px;">' + m.pick + '</div>' +
            '<div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px;">Conf: ' + m.conf + '/10</div>' +
          '</div>' +
        '</div>';
      });

      if (isFinal) {
        html += '<div style="text-align:center;margin-top:12px;font-size:16px;font-weight:900;color:#d4a843;">SPAIN \u2014 WORLD CHAMPIONS 2026</div>' +
          '<div style="text-align:center;font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px;">Yamal 23\' | Bellingham 58\' | Pedri 76\'</div>';
      }
      html += '</div>';
    });

    html += '<div style="text-align:center;padding:16px;background:rgba(255,255,255,0.02);border-radius:10px;margin-top:12px;">' +
      '<div style="font-size:13px;color:rgba(255,255,255,0.4);font-style:italic;">Emotion says France or England. Data says Spain.</div>' +
      '<div style="font-size:11px;color:rgba(255,255,255,0.25);margin-top:4px;">Full analysis: eliteedgesports.co.uk | 18+ | BeGambleAware.org</div>' +
    '</div>';

    return html;
  }

  function renderTabContent() {
    switch (_tab) {
      case 'fixtures': return renderFixtures();
      case 'groups': return renderGroups();
      case 'bracket': return renderBracket();
      case 'our-picks': return renderOurPicks();
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
      var html = '<div style="padding:0 4px;">' +
        '<div class="wc-hub-header">' +
          '<h1>\u26bd ' + tournamentName + '</h1>' +
          '<div class="wc-subtitle">Predict. Compete. Represent Your Nation.</div>' +
          renderCountdown() +
        '</div>' +
        '<div class="wc-tabs">' +
          ['fixtures', 'groups', 'bracket', 'our-picks', 'predictions', 'leaderboard', 'nations'].map(function(t) {
            var label = t.charAt(0).toUpperCase() + t.slice(1);
            if (t === 'nations') label = 'Nation Wars';
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
      el.classList.toggle('active', el.textContent.toLowerCase().replace(' wars', 's').replace('nation', 'nations') === tab || el.textContent.toLowerCase() === tab);
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

  return {
    render: render,
    switchTab: switchTab,
    submitPrediction: submitPrediction,
    setNation: setNation,
    togglePreview: togglePreview,
    cleanup: cleanup,
    _countdownInterval: null,
  };
})();
