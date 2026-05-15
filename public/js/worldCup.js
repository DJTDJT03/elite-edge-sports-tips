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
  var _myNation = null;
  var _nationRankings = [];

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
      ]);
      _tournament = results[0] && results[0].tournament;
      _fixtures = (results[1] && results[1].fixtures) || [];
      _groups = (results[2] && results[2].groups) || [];
      _leaderboard = (results[3] && results[3].leaderboard) || [];

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

      return '<div class="' + cls + '" data-fixture-id="' + f.id + '">' + meta + teams + venue + predictForm + '</div>';
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

  function renderTabContent() {
    switch (_tab) {
      case 'fixtures': return renderFixtures();
      case 'groups': return renderGroups();
      case 'bracket': return renderBracket();
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
          ['fixtures', 'groups', 'bracket', 'predictions', 'leaderboard', 'nations'].map(function(t) {
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
    cleanup: cleanup,
    _countdownInterval: null,
  };
})();
