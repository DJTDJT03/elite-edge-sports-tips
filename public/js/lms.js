/**
 * Elite Edge Sports Tips — Last Man Standing (frontend module)
 *
 * Self-contained, pluggable. Rendered via App.route() -> LMS.render() when the
 * ENABLE_LMS feature flag is on. Reads the JWT from localStorage('ee_token'),
 * same as the rest of the SPA. Uses the site design tokens.
 */
window.LMS = {
  _comp: null,        // current competition detail payload
  _selectedTeam: '',

  token: function () { return localStorage.getItem('ee_token') || ''; },
  loggedIn: function () { return !!this.token(); },

  async api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    var t = this.token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    var res = await fetch('/api/lms' + path, Object.assign({ headers: headers }, opts));
    var data = null;
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data: data });
    return data;
  },

  esc: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  },

  toast: function (msg, type) {
    if (window.App && App.showToast) { App.showToast(msg, type || 'info'); }
    else { console.log('[LMS]', msg); }
  },

  // ---- entry point ----------------------------------------------------------
  async render() {
    var app = document.getElementById('app');
    if (!app) return;

    if (!this.loggedIn()) {
      app.innerHTML = this._shell(
        '<div style="text-align:center;padding:40px 20px;">' +
        '<p style="color:var(--text-secondary);font-size:15px;">Log in to join Last Man Standing.</p>' +
        '<a href="#/" class="btn btn-gold" style="margin-top:16px;">Log In</a></div>'
      );
      return;
    }

    // Handle Stripe redirect flags
    this._handleQueryFlags();

    app.innerHTML = this._shell('<div style="text-align:center;padding:40px;color:var(--text-secondary);">Loading…</div>');

    try {
      var list = await this.api('/competitions');
      var comps = (list.competitions || []).filter(function (c) { return c.status !== 'completed'; });
      if (!comps.length) {
        // also show recently completed for the roll of honour
        var all = await this.api('/competitions?includeCompleted=1');
        var done = (all.competitions || []).filter(function (c) { return c.status === 'completed'; });
        app.innerHTML = this._shell(this._emptyState(done));
        return;
      }
      // Prefer an active competition, else the first open one
      var primary = comps.find(function (c) { return c.status === 'active'; }) || comps[0];
      var detail = await this.api('/competitions/' + primary.id);
      this._comp = detail;
      var standings = await this.api('/competitions/' + primary.id + '/standings');
      app.innerHTML = this._shell(this._competitionView(detail, standings));
    } catch (e) {
      app.innerHTML = this._shell('<div style="text-align:center;padding:40px;color:var(--red);">' + this.esc(e.message) + '</div>');
    }
  },

  _shell: function (inner) {
    return '<div class="container" style="max-width:920px;margin:0 auto;padding:20px 16px 60px;">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">' +
        '<span style="font-size:30px;">&#127942;</span>' +
        '<h1 style="margin:0;font-size:26px;color:var(--text-primary);">Last Man Standing</h1>' +
      '</div>' +
      '<p style="color:var(--text-secondary);font-size:14px;margin:0 0 20px;">Pick one team a round. They win, you go through. They draw or lose, you\'re out. Last one standing takes the pot.</p>' +
      inner + '</div>';
  },

  _emptyState: function (completed) {
    var html = '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:30px;text-align:center;">' +
      '<p style="color:var(--text-secondary);font-size:15px;margin:0;">No competition running right now. Check back soon — the next one will be announced here and on Telegram.</p></div>';
    if (completed && completed.length) {
      html += '<h3 style="color:var(--gold);margin:24px 0 10px;font-size:16px;">Roll of Honour</h3>';
      completed.forEach(function (c) {
        html += '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:8px;color:var(--text-primary);">' +
          LMS.esc(c.name) + ' — pot &pound;' + (c.prizePot || 0).toFixed(0) + '</div>';
      });
    }
    return html;
  },

  // ---- main competition view ------------------------------------------------
  _competitionView: function (d, standings) {
    var c = d.competition;
    var me = d.me || {};
    var pot = (c.prizePot || 0).toFixed(0);
    var roundsInfo = c.totalRounds ? ('Round ' + c.currentRound + ' of ' + c.totalRounds) : c.roundLabel;

    var head =
      '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:18px;">' +
        this._statCard('Prize Pot', '&pound;' + pot, 'var(--gold)') +
        this._statCard('Still In', String(d.aliveCount), 'var(--green, #22c55e)') +
        this._statCard('This Round', c.roundLabel, 'var(--text-primary)') +
        this._statCard('Status', c.status === 'open' ? 'Open to join' : (c.status === 'completed' ? 'Finished' : roundsInfo), 'var(--text-secondary)') +
      '</div>';

    if ((c.rollovers || []).length) {
      head += '<div style="background:rgba(212,168,67,0.12);border:1px solid var(--gold);border-radius:8px;padding:10px 14px;margin-bottom:16px;color:var(--gold);font-size:13px;">' +
        '&#8635; This competition has rolled over ' + c.rollovers.length + ' time' + (c.rollovers.length > 1 ? 's' : '') + ' — everyone was knocked out the same round and reinstated.</div>';
    }

    var body;
    if (!me.joined) {
      body = this._joinPanel(d);
    } else if (me.status === 'out') {
      body = '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:24px;text-align:center;">' +
        '<p style="color:var(--red);font-weight:700;font-size:16px;margin:0 0 6px;">You\'re out' + (me.picks.length ? ' — knocked out in ' + this.esc(me.picks[me.picks.length - 1].roundLabel) : '') + '.</p>' +
        '<p style="color:var(--text-secondary);font-size:14px;margin:0;">Bad luck. Watch how the rest plays out below.</p></div>' +
        this._myPicksList(me);
    } else if (me.status === 'winner') {
      body = '<div style="background:rgba(34,197,94,0.12);border:1px solid var(--green,#22c55e);border-radius:12px;padding:24px;text-align:center;">' +
        '<p style="color:var(--green,#22c55e);font-weight:800;font-size:20px;margin:0 0 6px;">&#127881; You won! &pound;' + pot + '</p>' +
        '<p style="color:var(--text-secondary);font-size:14px;margin:0;">Last man standing. We\'ll be in touch about your prize.</p></div>' +
        this._myPicksList(me);
    } else {
      body = this._pickPanel(d);
    }

    var fixturesHtml = this._fixturesPanel(d.fixtures || [], me);
    var standingsHtml = this._standings(standings);

    return head + body + fixturesHtml + standingsHtml + this._rulesAccordion(c);
  },

  _fixturesPanel: function (fixtures, me) {
    if (!fixtures || !fixtures.length) return '';
    var pickTeam = (me && me.currentPick && me.currentPick.team) || null;
    var used = (me && me.usedTeams) || [];

    // Group by calendar date
    var groups = {};
    var order = [];
    fixtures.forEach(function (f) {
      var d = new Date(f.kickoff);
      var key = d.toISOString().slice(0, 10);
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(f);
    });

    var teamCell = function (name) {
      var isPick = pickTeam && name === pickTeam;
      var isUsed = used.indexOf(name) !== -1;
      var style = isPick ? 'color:var(--gold);font-weight:800;'
        : isUsed ? 'color:var(--text-secondary);text-decoration:line-through;'
        : 'color:var(--text-primary);';
      return '<span style="' + style + '">' + LMS.esc(name) + (isPick ? ' &#9733;' : '') + '</span>';
    };

    var sections = order.map(function (key) {
      var dateLabel = new Date(key + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      var rows = groups[key].map(function (f) {
        var t = new Date(f.kickoff).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        var stageLabel = f.group ? ('Group ' + f.group) : (f.stage ? String(f.stage).replace(/-/g, ' ') : '');
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.05);">' +
          '<span style="color:var(--text-secondary);font-size:12px;width:48px;flex-shrink:0;">' + t + '</span>' +
          '<span style="flex:1;text-align:right;font-size:13px;">' + teamCell(f.homeTeam) + '</span>' +
          '<span style="color:var(--text-secondary);font-size:11px;">v</span>' +
          '<span style="flex:1;font-size:13px;">' + teamCell(f.awayTeam) + '</span>' +
          '<span style="color:var(--text-secondary);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;width:84px;text-align:right;flex-shrink:0;">' + LMS.esc(stageLabel) + '</span>' +
        '</div>';
      }).join('');
      return '<div style="margin-bottom:12px;"><div style="color:var(--gold);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:8px 4px 4px;">' + dateLabel + '</div>' + rows + '</div>';
    }).join('');

    return '<div style="margin-top:18px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:16px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px;">' +
        '<h3 style="margin:0;color:var(--text-primary);font-size:16px;">Upcoming Fixtures</h3>' +
        '<span style="color:var(--text-secondary);font-size:12px;">Plan ahead — your pick &#9733; · struck-through = already used</span>' +
      '</div>' + sections + '</div>';
  },

  _statCard: function (label, value, color) {
    return '<div style="flex:1;min-width:140px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">' +
      '<div style="color:var(--text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">' + label + '</div>' +
      '<div style="color:' + color + ';font-size:20px;font-weight:800;">' + value + '</div></div>';
  },

  _joinPanel: function (d) {
    var c = d.competition;
    if (!d.canAccess) {
      return '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:24px;text-align:center;">' +
        '<p style="color:var(--text-primary);font-size:15px;margin:0 0 12px;">This competition is free for subscribers.</p>' +
        '<a href="#/pricing" class="btn btn-gold">Start a Subscription</a></div>';
    }
    return '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:24px;text-align:center;">' +
      '<p style="color:var(--text-primary);font-size:15px;margin:0 0 4px;">Free to enter. ' + this.esc(c.roundLabel) + ' is up next.</p>' +
      '<p style="color:var(--text-secondary);font-size:13px;margin:0 0 16px;">Join now, then pick your first team.</p>' +
      '<button class="btn btn-gold" onclick="LMS.join(' + c.id + ')">Join Competition</button></div>';
  },

  _pickPanel: function (d) {
    var c = d.competition;
    var me = d.me;
    var used = me.usedTeams || [];
    var allowancesLeft = me.allowancesLeft || 0;
    var teams = d.teams || [];

    var current = me.currentPick;
    var locked = current && current.result !== 'pending';

    var roundFixtures = d.roundFixtures || [];
    var picker;
    if (locked) {
      picker = '<p style="color:var(--text-secondary);font-size:14px;">This round is locked. Your pick: <strong style="color:var(--text-primary);">' + this.esc(current.team) + '</strong></p>';
    } else if (roundFixtures.length) {
      // Round-by-round: tap the team you back in each of this round's fixtures
      var teamBtn = function (team) {
        var isUsed = used.indexOf(team) !== -1 && allowancesLeft <= 0;
        var isPicked = current && current.team === team;
        var style = isPicked ? 'background:linear-gradient(135deg,#d4a843,#b8902f);color:#0a0e1a;border-color:#d4a843;font-weight:800;'
          : isUsed ? 'background:var(--bg);color:var(--text-secondary);opacity:0.45;text-decoration:line-through;cursor:not-allowed;'
          : 'background:var(--bg);color:var(--text-primary);';
        var onclick = isUsed ? '' : ' onclick="LMS.pickTeam(' + c.id + ',' + JSON.stringify(team).replace(/"/g, '&quot;') + ')"';
        return '<button' + onclick + ' style="flex:1;min-width:0;padding:12px 8px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;' + style + '">' + LMS.esc(team) + (isPicked ? ' &#10003;' : '') + '</button>';
      };
      var cards = roundFixtures.map(function (fx) {
        var ko = fx.kickoff ? new Date(fx.kickoff).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'TBC';
        return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;">' +
          '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">' + (fx.group ? 'Group ' + fx.group + ' &middot; ' : '') + ko + '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' + teamBtn(fx.homeTeam) + '<span style="color:var(--text-secondary);font-size:11px;">v</span>' + teamBtn(fx.awayTeam) + '</div>' +
        '</div>';
      }).join('');
      picker = '<p style="color:var(--text-secondary);font-size:13px;margin:0 0 10px;">Tap the team you back to win their game this round' + (current ? ' (tap a different team to change)' : '') + ':</p>' + cards;
    } else {
      // Fallback dropdown (e.g. knockout teams not decided yet)
      var options = teams.map(function (t) {
        var isUsed = used.indexOf(t) !== -1;
        var label = LMS.esc(t) + (isUsed ? (allowancesLeft > 0 ? ' (used — needs extra team)' : ' (already used)') : '');
        var disabled = isUsed && allowancesLeft <= 0 ? ' disabled' : '';
        var sel = current && current.team === t ? ' selected' : '';
        return '<option value="' + LMS.esc(t) + '"' + disabled + sel + '>' + label + '</option>';
      }).join('');
      picker = '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">' +
          '<select id="lms-team" style="flex:1;min-width:200px;padding:11px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:14px;">' +
            '<option value="">— Choose your team —</option>' + options +
          '</select>' +
          '<button class="btn btn-gold" onclick="LMS.submitPick(' + c.id + ')">' + (current ? 'Change Pick' : 'Confirm Pick') + '</button>' +
        '</div>';
    }

    var currentLine = current
      ? '<p style="color:var(--green,#22c55e);font-size:13px;margin:10px 0 0;">Current pick for ' + this.esc(c.roundLabel) + ': <strong>' + this.esc(current.team) + '</strong>' + (current.isReuse ? ' (extra team)' : '') + '</p>'
      : '<p style="color:var(--gold);font-size:13px;margin:10px 0 0;">You haven\'t picked for ' + this.esc(c.roundLabel) + ' yet — don\'t get caught out.</p>';

    var extra;
    if (!me.extraTeamsAllowed) {
      // Extra teams only unlock in a rollover situation. Stay quiet until then.
      extra = (allowancesLeft > 0)
        ? '<p style="color:var(--text-secondary);font-size:12px;margin-top:14px;">Extra team allowances left: ' + allowancesLeft + '</p>'
        : '';
    } else if (me.canBuyExtra) {
      extra = '<div style="margin-top:16px;border-top:1px dashed var(--border);padding-top:14px;">' +
          '<p style="color:var(--gold);font-size:13px;margin:0 0 4px;font-weight:700;">&#8635; Rollover — extra teams unlocked</p>' +
          '<p style="color:var(--text-secondary);font-size:13px;margin:0 0 8px;">Teams are getting tight. Buy an extra team for &pound;10 (max 2) to pick one you\'ve already used. It also adds to the prize pot.</p>' +
          '<button class="btn btn-outline btn-sm" onclick="LMS.buyExtraTeam(' + c.id + ')">Buy Extra Team — &pound;10</button>' +
          '<span style="color:var(--text-secondary);font-size:12px;margin-left:10px;">Allowances left: ' + allowancesLeft + '</span>' +
        '</div>';
    } else {
      extra = '<p style="color:var(--text-secondary);font-size:12px;margin-top:14px;">You\'ve bought the maximum of 2 extra teams. Allowances left: ' + allowancesLeft + '</p>';
    }

    var usedChips = used.length
      ? '<div style="margin-top:14px;"><span style="color:var(--text-secondary);font-size:12px;">Teams used: </span>' +
        used.map(function (t) { return '<span style="display:inline-block;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:3px 10px;margin:3px;font-size:12px;color:var(--text-primary);">' + LMS.esc(t) + '</span>'; }).join('') + '</div>'
      : '';

    return '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:22px;">' +
      '<h3 style="margin:0 0 12px;color:var(--text-primary);font-size:17px;">Your pick — ' + this.esc(c.roundLabel) + '</h3>' +
      picker + currentLine + usedChips + extra +
    '</div>' + this._myPicksList(me);
  },

  _myPicksList: function (me) {
    if (!me.picks || !me.picks.length) return '';
    var rows = me.picks.map(function (p) {
      var color = p.result === 'won' ? 'var(--green,#22c55e)' : p.result === 'lost' ? 'var(--red)' : 'var(--text-secondary)';
      var icon = p.result === 'won' ? '&#10003;' : p.result === 'lost' ? '&#10007;' : '&#8230;';
      return '<tr><td style="padding:8px 10px;color:var(--text-secondary);font-size:13px;">' + LMS.esc(p.roundLabel) + '</td>' +
        '<td style="padding:8px 10px;color:var(--text-primary);font-size:13px;font-weight:600;">' + LMS.esc(p.team) + (p.isReuse ? ' <span style="color:var(--gold);font-size:11px;">(extra)</span>' : '') + '</td>' +
        '<td style="padding:8px 10px;color:' + color + ';font-size:13px;text-align:right;">' + icon + ' ' + LMS.esc(p.result) + '</td></tr>';
    }).join('');
    return '<div style="margin-top:18px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:8px 8px 4px;">' +
      '<h3 style="margin:8px 10px;color:var(--text-primary);font-size:15px;">Your run</h3>' +
      '<table style="width:100%;border-collapse:collapse;">' + rows + '</table></div>';
  },

  _standings: function (standings) {
    if (!standings || !standings.standings || !standings.standings.length) return '';
    var rows = standings.standings.slice(0, 50).map(function (r) {
      var color = r.status === 'out' ? 'var(--text-secondary)' : r.status === 'winner' ? 'var(--gold)' : 'var(--green,#22c55e)';
      var badge = r.status === 'winner' ? '&#127942; Winner' : r.status === 'out' ? 'Out (R' + (r.eliminatedRound || '-') + ')' : 'Still in';
      return '<tr style="' + (r.isMe ? 'background:rgba(212,168,67,0.08);' : '') + '">' +
        '<td style="padding:8px 10px;color:var(--text-primary);font-size:13px;">' + LMS.esc(r.name) + (r.isMe ? ' <span style="color:var(--gold);font-size:11px;">(you)</span>' : '') + '</td>' +
        '<td style="padding:8px 10px;color:var(--text-secondary);font-size:13px;text-align:center;">' + r.roundsSurvived + '</td>' +
        '<td style="padding:8px 10px;color:' + color + ';font-size:13px;text-align:right;font-weight:600;">' + badge + '</td></tr>';
    }).join('');
    return '<div style="margin-top:22px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:8px 8px 4px;">' +
      '<h3 style="margin:8px 10px;color:var(--text-primary);font-size:16px;">Standings</h3>' +
      '<table style="width:100%;border-collapse:collapse;">' +
      '<tr><th style="text-align:left;padding:6px 10px;color:var(--text-secondary);font-size:11px;text-transform:uppercase;">Player</th>' +
      '<th style="text-align:center;padding:6px 10px;color:var(--text-secondary);font-size:11px;text-transform:uppercase;">Rounds</th>' +
      '<th style="text-align:right;padding:6px 10px;color:var(--text-secondary);font-size:11px;text-transform:uppercase;">Status</th></tr>' +
      rows + '</table></div>';
  },

  _rulesAccordion: function (c) {
    var wc = c.phase === 'world_cup';
    var rules = wc
      ? ['Free to enter for subscribers. One pick per matchday/round.',
         'You can\'t pick the same team twice.',
         'Group stage: 90 minutes only — a draw means you\'re out.',
         'Knockouts: extra time and penalties count — your team just has to go through.',
         'No pick made = you\'re out. Don\'t forget.',
         'If everyone left is knocked out the same round, you all go back in and it rolls over.',
         'On a rollover you can buy up to 2 extra teams (£10 each) to reuse a team — that money goes into the pot.',
         'Last one standing wins the pot.']
      : ['Free entry for everyone. World Cup survivors carry on. Pot carries over.',
         'One pick per gameweek. 90 minutes only — a draw or loss puts you out.',
         'No pick = out. Rollover applies if everyone goes the same week.',
         'Buy up to 2 extra teams (£10 each) to reuse a team — adds to the pot.'];
    return '<details style="margin-top:18px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:12px 16px;">' +
      '<summary style="cursor:pointer;color:var(--gold);font-weight:700;font-size:14px;">How it works</summary>' +
      '<ul style="margin:12px 0 4px;padding-left:20px;color:var(--text-secondary);font-size:13px;line-height:1.7;">' +
      rules.map(function (r) { return '<li>' + LMS.esc(r) + '</li>'; }).join('') + '</ul>' +
      '<p style="color:var(--text-secondary);font-size:11px;margin:8px 0 0;">18+ | Entertainment only | BeGambleAware.org</p></details>';
  },

  // ---- actions --------------------------------------------------------------
  async join(id) {
    try {
      await this.api('/competitions/' + id + '/join', { method: 'POST' });
      this.toast('You\'re in. Now make your pick.', 'success');
      this.render();
    } catch (e) {
      if (e.data && e.data.upgrade) { this.toast(e.message, 'error'); window.location.hash = '#/pricing'; }
      else this.toast(e.message, 'error');
    }
  },

  async submitPick(id) {
    var sel = document.getElementById('lms-team');
    var team = sel ? sel.value : '';
    if (!team) { this.toast('Pick a team first.', 'error'); return; }
    return this.pickTeam(id, team);
  },

  // Tap-to-pick a specific team from a round fixture card
  async pickTeam(id, team) {
    if (!team) return;
    try {
      var r = await this.api('/competitions/' + id + '/pick', { method: 'POST', body: JSON.stringify({ team: team }) });
      this.toast(r.changed ? 'Pick changed to ' + team + '.' : team + ' locked in. Good luck.', 'success');
      this.render();
    } catch (e) { this.toast(e.message, 'error'); }
  },

  async buyExtraTeam(id) {
    try {
      var r = await this.api('/competitions/' + id + '/buy-team', { method: 'POST' });
      if (r.url) window.location.href = r.url;
    } catch (e) { this.toast(e.message, 'error'); }
  },

  _handleQueryFlags: function () {
    var hash = window.location.hash || '';
    var qIdx = hash.indexOf('?');
    if (qIdx === -1) return;
    var params = new URLSearchParams(hash.slice(qIdx + 1));
    if (params.get('extra_team') === 'added') this.toast('Extra team added and £10 into the pot. Nice one.', 'success');
    else if (params.get('extra_team') === 'already') this.toast('That purchase was already applied.', 'info');
    else if (params.get('error')) this.toast('Something went wrong with that purchase. You weren\'t charged twice.', 'error');
    // clean the query off the hash
    window.history.replaceState(null, '', '#/last-man-standing');
  },
};
