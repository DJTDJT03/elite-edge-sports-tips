/*
   Last Man Standing — admin section (pluggable, feature-flagged ENABLE_LMS).
   Depends on: AdminAPI (get/post/put), AdminApp.toast().
   Renders into #admin-content. Registered in admin.js allHandlers.
*/
window.LMSPage = {
  _competitions: [],
  _selectedId: null,

  esc: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  },

  async render() {
    var content = document.getElementById('admin-content');
    if (!content) return;
    try {
      var list = await AdminAPI.get('/lms/competitions?includeCompleted=1');
      this._competitions = (list && list.competitions) || [];
    } catch (e) {
      content.innerHTML = '<div class="admin-card" style="color:#dc2626;">Could not load LMS: ' + this.esc(e.message) + '</div>';
      return;
    }
    content.innerHTML = this._layout();
    this._bind();
    if (this._selectedId) this._loadEntries(this._selectedId);
  },

  _layout: function () {
    var rows = this._competitions.map(function (c) {
      return '<tr style="cursor:pointer;" onclick="LMSPage.select(' + c.id + ')">' +
        '<td>' + LMSPage.esc(c.name) + '</td>' +
        '<td>' + LMSPage.esc(c.phase) + '</td>' +
        '<td>' + LMSPage.esc(c.status) + '</td>' +
        '<td>' + LMSPage.esc(c.roundLabel || ('R' + c.currentRound)) + '</td>' +
        '<td>' + (c.aliveCount != null ? c.aliveCount : '-') + '</td>' +
        '<td>&pound;' + (c.prizePot || 0).toFixed(0) + '</td>' +
        '<td><button class="btn-sm" onclick="event.stopPropagation();LMSPage.select(' + c.id + ')">Manage</button></td>' +
        '</tr>';
    }).join('');

    return '' +
      '<div class="admin-card">' +
        '<h2 style="margin-top:0;">Last Man Standing</h2>' +
        '<table class="admin-table" style="width:100%;">' +
          '<thead><tr><th>Name</th><th>Phase</th><th>Status</th><th>Round</th><th>Alive</th><th>Pot</th><th></th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="7" style="color:#888;">No competitions yet.</td></tr>') + '</tbody>' +
        '</table>' +
      '</div>' +
      '<div class="admin-card" style="margin-top:16px;">' +
        '<h3 style="margin-top:0;">Create competition</h3>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">' +
          '<label style="display:flex;flex-direction:column;font-size:12px;color:#aaa;">Name<input id="lms-new-name" placeholder="World Cup 2026 LMS" style="padding:8px;min-width:220px;"></label>' +
          '<label style="display:flex;flex-direction:column;font-size:12px;color:#aaa;">Phase<select id="lms-new-phase" style="padding:8px;"><option value="world_cup">World Cup</option><option value="pl_rollover">PL Rollover</option></select></label>' +
          '<label style="display:flex;flex-direction:column;font-size:12px;color:#aaa;">Base prize (&pound;)<input id="lms-new-prize" type="number" value="250" style="padding:8px;width:120px;"></label>' +
          '<label style="display:flex;flex-direction:column;font-size:12px;color:#aaa;">Access<select id="lms-new-access" style="padding:8px;"><option value="everyone">Any registered member (incl. Free Tier)</option><option value="subscriber">Paid subscribers only</option></select></label>' +
          '<label style="display:flex;flex-direction:column;font-size:12px;color:#aaa;">Status<select id="lms-new-status" style="padding:8px;"><option value="open">Open</option><option value="active">Active</option></select></label>' +
          '<button class="btn-primary" onclick="LMSPage.create()">Create</button>' +
        '</div>' +
      '</div>' +
      '<div id="lms-detail" style="margin-top:16px;"></div>';
  },

  _bind: function () { /* inline handlers used; nothing to bind */ },

  select: function (id) { this._selectedId = id; this._loadEntries(id); },

  async create() {
    var name = (document.getElementById('lms-new-name') || {}).value;
    var phase = (document.getElementById('lms-new-phase') || {}).value;
    var basePrize = parseFloat((document.getElementById('lms-new-prize') || {}).value) || 0;
    var access = (document.getElementById('lms-new-access') || {}).value;
    var status = (document.getElementById('lms-new-status') || {}).value;
    if (!name) { AdminApp.toast('Enter a name', 'error'); return; }
    try {
      await AdminAPI.post('/lms/admin/competitions', { name: name, phase: phase, basePrize: basePrize, access: access, status: status });
      AdminApp.toast('Competition created', 'success');
      this.render();
    } catch (e) { AdminApp.toast('Create failed: ' + e.message, 'error'); }
  },

  async _loadEntries(id) {
    var box = document.getElementById('lms-detail');
    if (box) box.innerHTML = '<div class="admin-card">Loading entries…</div>';
    try {
      var data = await AdminAPI.get('/lms/admin/competitions/' + id + '/entries');
      if (box) box.innerHTML = this._detail(data);
    } catch (e) {
      if (box) box.innerHTML = '<div class="admin-card" style="color:#dc2626;">' + this.esc(e.message) + '</div>';
    }
  },

  _detail: function (data) {
    var c = data.competition;
    var entries = data.entries || [];
    var aliveCount = entries.filter(function (e) { return e.status === 'alive'; }).length;

    var entryRows = entries.map(function (e) {
      var picks = (e.picks || []).map(function (p) {
        var color = p.result === 'won' ? '#16a34a' : p.result === 'lost' ? '#dc2626' : '#888';
        var override = p.result === 'pending'
          ? ' <button class="btn-sm" style="background:#16a34a;" onclick="LMSPage.setResult(' + p.pickId + ',\'won\',' + c.id + ')">W</button>' +
            '<button class="btn-sm" style="background:#dc2626;" onclick="LMSPage.setResult(' + p.pickId + ',\'lost\',' + c.id + ')">L</button>' +
            '<button class="btn-sm" style="background:#666;" onclick="LMSPage.setResult(' + p.pickId + ',\'void\',' + c.id + ')">V</button>'
          : '';
        return '<span style="display:inline-block;margin:2px 6px 2px 0;font-size:12px;">' +
          LMSPage.esc(p.roundLabel) + ': <strong>' + LMSPage.esc(p.team) + '</strong> ' +
          '<span style="color:' + color + ';">' + LMSPage.esc(p.result) + '</span>' + (p.isReuse ? ' <em style="color:#d4a843;">(extra)</em>' : '') + override + '</span>';
      }).join('');
      return '<tr>' +
        '<td>' + LMSPage.esc(e.name) + '<br><span style="color:#888;font-size:11px;">' + LMSPage.esc(e.email || '') + '</span></td>' +
        '<td>' + LMSPage.esc(e.status) + (e.extraTeams ? ' <span style="color:#d4a843;">+' + e.extraTeams + '</span>' : '') + '</td>' +
        '<td>' + (picks || '<span style="color:#888;">no picks</span>') + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="admin-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">' +
        '<h3 style="margin:0;">' + this.esc(c.name) + ' — ' + this.esc(c.roundLabel) + '</h3>' +
        '<div>Pot: <strong>&pound;' + (c.prizePot || 0).toFixed(0) + '</strong> &nbsp;|&nbsp; Alive: <strong>' + aliveCount + '</strong> &nbsp;|&nbsp; Status: <strong>' + this.esc(c.status) + '</strong></div>' +
      '</div>' +
      '<div style="margin:14px 0;display:flex;flex-wrap:wrap;gap:8px;">' +
        '<button class="btn-primary" onclick="LMSPage.settle(' + c.id + ',false)">Settle ' + this.esc(c.roundLabel) + '</button>' +
        '<button class="btn-sm" style="background:#b45309;" onclick="LMSPage.settle(' + c.id + ',true)" title="Force-settle: treat unresolved picks as losses">Force Settle</button>' +
        (c.status === 'open' ? '<button class="btn-sm" onclick="LMSPage.setStatus(' + c.id + ',\'active\')">Open → Active</button>' : '') +
        '<button class="btn-sm" style="background:#666;" onclick="LMSPage.advanceRound(' + c.id + ',' + c.currentRound + ')">Advance round (manual)</button>' +
      '</div>' +
      '<p style="color:#888;font-size:12px;margin:0 0 10px;">Settle resolves finished World Cup fixtures automatically. Penalty shootouts and PL fixtures show W/L/V buttons for manual confirmation, then settle again.</p>' +
      '<table class="admin-table" style="width:100%;">' +
        '<thead><tr><th>Player</th><th>Status</th><th>Picks</th></tr></thead>' +
        '<tbody>' + (entryRows || '<tr><td colspan="3" style="color:#888;">No entries yet.</td></tr>') + '</tbody>' +
      '</table>' +
    '</div>';
  },

  async settle(id, force) {
    try {
      var r = await AdminAPI.post('/lms/admin/competitions/' + id + '/settle', { force: !!force });
      var rep = r.report || {};
      AdminApp.toast(rep.message || 'Settled', rep.held ? 'info' : 'success');
      this._loadEntries(id);
      this.render();
    } catch (e) { AdminApp.toast('Settle failed: ' + e.message, 'error'); }
  },

  async setResult(pickId, result, compId) {
    try {
      await AdminAPI.post('/lms/admin/picks/' + pickId + '/result', { result: result });
      AdminApp.toast('Pick marked ' + result, 'success');
      this._loadEntries(compId);
    } catch (e) { AdminApp.toast('Failed: ' + e.message, 'error'); }
  },

  async setStatus(id, status) {
    try {
      await AdminAPI.put('/lms/admin/competitions/' + id, { status: status });
      AdminApp.toast('Status: ' + status, 'success');
      this.render();
    } catch (e) { AdminApp.toast('Failed: ' + e.message, 'error'); }
  },

  async advanceRound(id, currentRound) {
    if (!confirm('Manually advance to round ' + (currentRound + 1) + '? Only do this if you know what you are doing — normal flow is via Settle.')) return;
    try {
      await AdminAPI.put('/lms/admin/competitions/' + id, { currentRound: currentRound + 1 });
      AdminApp.toast('Advanced to round ' + (currentRound + 1), 'success');
      this._loadEntries(id);
      this.render();
    } catch (e) { AdminApp.toast('Failed: ' + e.message, 'error'); }
  },
};
