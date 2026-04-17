/* =========================================================================
   ELITE EDGE SPORTS TIPS — Admin Tips Management Module
   Renders into #admin-content
   Depends on: AdminAPI, AdminApp.toast(), AdminApp.confirm()
   ========================================================================= */

window.TipsPage = {
  _tips: [],
  _selectedIds: new Set(),
  _editingTip: null,

  // ---------------------------------------------------------------------------
  // RENDER — main entry point
  // ---------------------------------------------------------------------------
  async render() {
    const container = document.getElementById('admin-content');
    if (!container) return;

    container.innerHTML = '<div class="admin-loading"><div class="spinner"></div> Loading tips...</div>';

    try {
      this._tips = await AdminAPI.get('/tips');
    } catch (err) {
      container.innerHTML = '<div class="admin-error">Failed to load tips: ' + (err.message || err) + '</div>';
      return;
    }

    this._selectedIds.clear();
    this._renderPage(container);
  },

  // ---------------------------------------------------------------------------
  // PAGE LAYOUT
  // ---------------------------------------------------------------------------
  _renderPage(container) {
    const tips = this._filteredTips();

    container.innerHTML = ''
      // Header bar
      + '<div class="admin-header-bar">'
      +   '<h2 class="admin-page-title">Tips Management</h2>'
      +   '<button class="btn btn-gold" id="btn-add-tip">Add New Tip</button>'
      + '</div>'

      // Filter bar
      + '<div class="admin-filter-bar">'
      +   '<div class="filter-group">'
      +     '<label for="filter-sport">Sport</label>'
      +     '<select id="filter-sport">'
      +       '<option value="">All</option>'
      +       '<option value="racing">Racing</option>'
      +       '<option value="football">Football</option>'
      +     '</select>'
      +   '</div>'
      +   '<div class="filter-group">'
      +     '<label for="filter-status">Status</label>'
      +     '<select id="filter-status">'
      +       '<option value="">All</option>'
      +       '<option value="active">Active</option>'
      +       '<option value="settled">Settled</option>'
      +       '<option value="expired">Expired</option>'
      +     '</select>'
      +   '</div>'
      +   '<div class="filter-group">'
      +     '<label for="filter-date">Date</label>'
      +     '<input type="date" id="filter-date">'
      +   '</div>'
      + '</div>'

      // Bulk actions bar (hidden by default)
      + '<div class="admin-bulk-bar" id="bulk-bar" style="display:none;">'
      +   '<span id="bulk-count">0 selected</span>'
      +   '<span class="bulk-label">Settle as:</span>'
      +   '<button class="btn btn-sm btn-green" data-result="won">Won</button>'
      +   '<button class="btn btn-sm btn-red" data-result="lost">Lost</button>'
      +   '<button class="btn btn-sm btn-amber" data-result="placed">Placed</button>'
      +   '<button class="btn btn-sm btn-outline" data-result="void">Void</button>'
      + '</div>'

      // Tips table
      + '<div class="admin-table-wrap">'
      +   this._buildTable(tips)
      + '</div>'

      // Modal placeholder
      + '<div class="admin-modal-overlay" id="tip-modal" style="display:none;">'
      +   '<div class="admin-modal">'
      +     '<div class="admin-modal-header">'
      +       '<h3 id="modal-title">Add Tip</h3>'
      +       '<button class="modal-close" id="modal-close">&times;</button>'
      +     '</div>'
      +     '<div class="admin-modal-body" id="modal-body"></div>'
      +   '</div>'
      + '</div>';

    this._bindEvents(container);
  },

  // ---------------------------------------------------------------------------
  // TABLE
  // ---------------------------------------------------------------------------
  _buildTable(tips) {
    if (!tips.length) {
      return '<div class="admin-empty">No tips match the current filters.</div>';
    }

    var rows = '';
    for (var i = 0; i < tips.length; i++) {
      var t = tips[i];
      rows += this._buildRow(t);
    }

    return '<table class="admin-table tips-table">'
      + '<thead><tr>'
      +   '<th class="col-check"><input type="checkbox" id="check-all" title="Select all"></th>'
      +   '<th>Date</th>'
      +   '<th>Sport</th>'
      +   '<th>Event</th>'
      +   '<th>Selection</th>'
      +   '<th>Market</th>'
      +   '<th>Odds</th>'
      +   '<th>Conf.</th>'
      +   '<th>Status</th>'
      +   '<th>Result</th>'
      +   '<th>P/L</th>'
      +   '<th>Actions</th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table>';
  },

  _buildRow(t) {
    var checked = this._selectedIds.has(t.id) ? ' checked' : '';
    var sportBadge = '<span class="badge badge-' + (t.sport || 'other') + '">'
      + this._ucFirst(t.sport || 'N/A') + '</span>';

    var confColour = 'conf-low';
    if (t.confidence >= 8) confColour = 'conf-high';
    else if (t.confidence >= 5) confColour = 'conf-mid';

    var statusBadge = '<span class="badge badge-status-' + (t.status || 'active') + '">'
      + this._ucFirst(t.status || 'active') + '</span>';

    var resultText = t.result ? this._ucFirst(t.result) : '-';
    var pnl = this._calculatePnL(t);
    var pnlClass = pnl > 0 ? 'pnl-pos' : (pnl < 0 ? 'pnl-neg' : '');
    var pnlText = pnl !== null ? (pnl > 0 ? '+' : '') + pnl.toFixed(2) : '-';

    return '<tr data-id="' + t.id + '">'
      + '<td class="col-check"><input type="checkbox" class="tip-check" data-id="' + t.id + '"' + checked + '></td>'
      + '<td>' + (t.date || '-') + '</td>'
      + '<td>' + sportBadge + '</td>'
      + '<td class="col-event">' + (t.event || '-') + '</td>'
      + '<td>' + (t.locked ? '<em>Premium</em>' : (t.selection || '-')) + '</td>'
      + '<td>' + (t.market || '-') + '</td>'
      + '<td>' + (t.odds || '-') + '</td>'
      + '<td><span class="conf-badge ' + confColour + '">' + (t.confidence || '-') + '/10</span></td>'
      + '<td>' + statusBadge + '</td>'
      + '<td>' + resultText + '</td>'
      + '<td class="' + pnlClass + '">' + pnlText + '</td>'
      + '<td class="col-actions">'
      +   '<button class="btn btn-sm btn-outline btn-edit" data-id="' + t.id + '">Edit</button>'
      +   '<button class="btn btn-sm btn-red btn-delete" data-id="' + t.id + '">Delete</button>'
      + '</td>'
      + '</tr>';
  },

  _calculatePnL(t) {
    if (!t.result || t.result === 'void') return null;
    var stake = parseFloat(t.staking) || 1;
    if (t.result === 'won') return Math.round((t.odds - 1) * stake * 100) / 100;
    if (t.result === 'placed') return Math.round(((t.odds - 1) / 4) * stake * 100) / 100;
    if (t.result === 'lost') return -stake;
    return null;
  },

  // ---------------------------------------------------------------------------
  // FILTERS
  // ---------------------------------------------------------------------------
  _filteredTips() {
    var sport = this._filterSport || '';
    var status = this._filterStatus || '';
    var date = this._filterDate || '';

    return this._tips.filter(function(t) {
      if (sport && t.sport !== sport) return false;
      if (status && t.status !== status) return false;
      if (date && t.date !== date) return false;
      return true;
    });
  },

  // ---------------------------------------------------------------------------
  // EVENT BINDINGS
  // ---------------------------------------------------------------------------
  _bindEvents(container) {
    var self = this;

    // Add tip button
    var addBtn = document.getElementById('btn-add-tip');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        self._editingTip = null;
        self._showModal();
      });
    }

    // Filters
    var sportFilter = document.getElementById('filter-sport');
    var statusFilter = document.getElementById('filter-status');
    var dateFilter = document.getElementById('filter-date');

    if (sportFilter) sportFilter.addEventListener('change', function() {
      self._filterSport = this.value;
      self._renderPage(container);
    });
    if (statusFilter) statusFilter.addEventListener('change', function() {
      self._filterStatus = this.value;
      self._renderPage(container);
    });
    if (dateFilter) dateFilter.addEventListener('change', function() {
      self._filterDate = this.value;
      self._renderPage(container);
    });

    // Restore filter values
    if (sportFilter && self._filterSport) sportFilter.value = self._filterSport;
    if (statusFilter && self._filterStatus) statusFilter.value = self._filterStatus;
    if (dateFilter && self._filterDate) dateFilter.value = self._filterDate;

    // Select all checkbox
    var checkAll = document.getElementById('check-all');
    if (checkAll) {
      checkAll.addEventListener('change', function() {
        var checks = container.querySelectorAll('.tip-check');
        for (var i = 0; i < checks.length; i++) {
          checks[i].checked = this.checked;
          var id = checks[i].getAttribute('data-id');
          if (this.checked) self._selectedIds.add(id);
          else self._selectedIds.delete(id);
        }
        self._updateBulkBar();
      });
    }

    // Individual checkboxes
    var checks = container.querySelectorAll('.tip-check');
    for (var c = 0; c < checks.length; c++) {
      checks[c].addEventListener('change', function() {
        var id = this.getAttribute('data-id');
        if (this.checked) self._selectedIds.add(id);
        else self._selectedIds.delete(id);
        self._updateBulkBar();
      });
    }

    // Edit buttons
    var editBtns = container.querySelectorAll('.btn-edit');
    for (var e = 0; e < editBtns.length; e++) {
      editBtns[e].addEventListener('click', function() {
        var id = this.getAttribute('data-id');
        var tip = self._tips.find(function(t) { return t.id === id; });
        if (tip) {
          self._editingTip = tip;
          self._showModal();
        }
      });
    }

    // Delete buttons
    var delBtns = container.querySelectorAll('.btn-delete');
    for (var d = 0; d < delBtns.length; d++) {
      delBtns[d].addEventListener('click', function() {
        var id = this.getAttribute('data-id');
        self._deleteTip(id);
      });
    }

    // Bulk action buttons
    var bulkBtns = document.querySelectorAll('#bulk-bar button[data-result]');
    for (var b = 0; b < bulkBtns.length; b++) {
      bulkBtns[b].addEventListener('click', function() {
        var result = this.getAttribute('data-result');
        self._bulkSettle(result);
      });
    }

    // Modal close
    var modalClose = document.getElementById('modal-close');
    if (modalClose) {
      modalClose.addEventListener('click', function() {
        self._hideModal();
      });
    }
    var overlay = document.getElementById('tip-modal');
    if (overlay) {
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) self._hideModal();
      });
    }
  },

  // ---------------------------------------------------------------------------
  // BULK BAR
  // ---------------------------------------------------------------------------
  _updateBulkBar() {
    var bar = document.getElementById('bulk-bar');
    var count = document.getElementById('bulk-count');
    if (!bar) return;
    if (this._selectedIds.size > 0) {
      bar.style.display = 'flex';
      count.textContent = this._selectedIds.size + ' selected';
    } else {
      bar.style.display = 'none';
    }
  },

  // ---------------------------------------------------------------------------
  // BULK SETTLE
  // ---------------------------------------------------------------------------
  async _bulkSettle(result) {
    var ids = Array.from(this._selectedIds);
    if (!ids.length) return;

    var label = this._ucFirst(result);
    var proceed = await AdminApp.confirm(
      'Settle ' + ids.length + ' tip(s) as "' + label + '"?'
    );
    if (!proceed) return;

    var payload = ids.map(function(id) {
      return { tipId: id, result: result };
    });

    try {
      var response = await AdminAPI.post('/admin/results/bulk', { results: payload });
      var msg = response.settledCount + ' tip(s) settled as ' + label;
      if (response.errorCount > 0) {
        msg += ' (' + response.errorCount + ' error(s))';
      }
      AdminApp.toast(msg, response.errorCount > 0 ? 'warning' : 'success');
      this._selectedIds.clear();
      await this.render();
    } catch (err) {
      AdminApp.toast('Bulk settle failed: ' + (err.message || err), 'error');
    }
  },

  // ---------------------------------------------------------------------------
  // DELETE TIP
  // ---------------------------------------------------------------------------
  async _deleteTip(id) {
    var tip = this._tips.find(function(t) { return t.id === id; });
    var name = tip ? (tip.selection || tip.event || id) : id;

    var proceed = await AdminApp.confirm(
      'Delete tip "' + name + '"? This action cannot be undone.'
    );
    if (!proceed) return;

    try {
      await AdminAPI.delete('/admin/tips/' + id);
      AdminApp.toast('Tip deleted successfully.', 'success');
      await this.render();
    } catch (err) {
      AdminApp.toast('Delete failed: ' + (err.message || err), 'error');
    }
  },

  // ---------------------------------------------------------------------------
  // ADD / EDIT MODAL
  // ---------------------------------------------------------------------------
  _showModal() {
    var modal = document.getElementById('tip-modal');
    var title = document.getElementById('modal-title');
    var body = document.getElementById('modal-body');
    if (!modal || !body) return;

    var t = this._editingTip || {};
    var isEdit = !!this._editingTip;
    title.textContent = isEdit ? 'Edit Tip' : 'Add New Tip';

    body.innerHTML = ''
      + '<form id="tip-form" class="admin-form">'
      +   '<div class="form-row">'
      +     '<div class="form-group">'
      +       '<label for="tf-sport">Sport</label>'
      +       '<select id="tf-sport" required>'
      +         '<option value="racing"' + (t.sport === 'racing' ? ' selected' : '') + '>Racing</option>'
      +         '<option value="football"' + (t.sport === 'football' ? ' selected' : '') + '>Football</option>'
      +       '</select>'
      +     '</div>'
      +     '<div class="form-group">'
      +       '<label for="tf-event">Event</label>'
      +       '<input type="text" id="tf-event" required placeholder="e.g. Cheltenham 14:30" value="' + this._esc(t.event || '') + '">'
      +     '</div>'
      +   '</div>'
      +   '<div class="form-row">'
      +     '<div class="form-group">'
      +       '<label for="tf-selection">Selection</label>'
      +       '<input type="text" id="tf-selection" required placeholder="e.g. Desert Crown" value="' + this._esc(t.selection || '') + '">'
      +     '</div>'
      +     '<div class="form-group">'
      +       '<label for="tf-market">Market</label>'
      +       '<select id="tf-market">'
      +         this._marketOptions(t.market)
      +       '</select>'
      +     '</div>'
      +   '</div>'
      +   '<div class="form-row">'
      +     '<div class="form-group">'
      +       '<label for="tf-odds">Odds (decimal)</label>'
      +       '<input type="number" id="tf-odds" step="0.01" min="1.01" required value="' + (t.odds || '') + '">'
      +     '</div>'
      +     '<div class="form-group">'
      +       '<label for="tf-confidence">Confidence (1-10)</label>'
      +       '<input type="number" id="tf-confidence" min="1" max="10" required value="' + (t.confidence || '') + '">'
      +     '</div>'
      +   '</div>'
      +   '<div class="form-row">'
      +     '<div class="form-group">'
      +       '<label for="tf-modelprob">Model Probability (0-1)</label>'
      +       '<input type="number" id="tf-modelprob" step="0.01" min="0" max="1" value="' + (t.modelProbability || '') + '">'
      +     '</div>'
      +     '<div class="form-group">'
      +       '<label for="tf-premium">Premium Tip</label>'
      +       '<select id="tf-premium">'
      +         '<option value="false"' + (!t.isPremium ? ' selected' : '') + '>Free</option>'
      +         '<option value="true"' + (t.isPremium ? ' selected' : '') + '>Premium</option>'
      +       '</select>'
      +     '</div>'
      +   '</div>'
      +   '<div class="form-group">'
      +     '<label for="tf-staking">Staking</label>'
      +     '<input type="text" id="tf-staking" placeholder="e.g. 2 units" value="' + this._esc(t.staking || '') + '">'
      +   '</div>'
      +   '<div class="form-group">'
      +     '<label for="tf-analysis">Analysis</label>'
      +     '<textarea id="tf-analysis" rows="4" placeholder="Brief analysis or reasoning...">'
      +       this._esc(this._getAnalysisText(t))
      +     '</textarea>'
      +   '</div>'
      +   '<div class="form-actions">'
      +     '<button type="submit" class="btn btn-gold">' + (isEdit ? 'Update Tip' : 'Create Tip') + '</button>'
      +     '<button type="button" class="btn btn-outline" id="modal-cancel">Cancel</button>'
      +   '</div>'
      + '</form>';

    modal.style.display = 'flex';

    var self = this;
    var form = document.getElementById('tip-form');
    var cancelBtn = document.getElementById('modal-cancel');

    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        self._submitTip();
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        self._hideModal();
      });
    }
  },

  _hideModal() {
    var modal = document.getElementById('tip-modal');
    if (modal) modal.style.display = 'none';
    this._editingTip = null;
  },

  // ---------------------------------------------------------------------------
  // SUBMIT TIP (create or update)
  // ---------------------------------------------------------------------------
  async _submitTip() {
    var sport = document.getElementById('tf-sport').value;
    var event = document.getElementById('tf-event').value.trim();
    var selection = document.getElementById('tf-selection').value.trim();
    var market = document.getElementById('tf-market').value;
    var odds = parseFloat(document.getElementById('tf-odds').value);
    var confidence = parseInt(document.getElementById('tf-confidence').value, 10);
    var modelProbability = parseFloat(document.getElementById('tf-modelprob').value) || undefined;
    var isPremium = document.getElementById('tf-premium').value === 'true';
    var staking = document.getElementById('tf-staking').value.trim();
    var analysis = document.getElementById('tf-analysis').value.trim();

    if (!event || !selection || !odds || !confidence) {
      AdminApp.toast('Please fill in all required fields.', 'error');
      return;
    }

    var payload = {
      sport: sport,
      event: event,
      selection: selection,
      market: market,
      odds: odds,
      confidence: confidence,
      isPremium: isPremium,
      staking: staking,
      analysis: analysis ? { summary: analysis } : undefined,
    };
    if (modelProbability !== undefined && !isNaN(modelProbability)) {
      payload.modelProbability = modelProbability;
    }

    try {
      if (this._editingTip) {
        await AdminAPI.put('/admin/tips/' + this._editingTip.id, payload);
        AdminApp.toast('Tip updated successfully.', 'success');
      } else {
        await AdminAPI.post('/admin/tips', payload);
        AdminApp.toast('Tip created successfully.', 'success');
      }
      this._hideModal();
      await this.render();
    } catch (err) {
      AdminApp.toast('Save failed: ' + (err.message || err), 'error');
    }
  },

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  _ucFirst(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  },

  _esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  _getAnalysisText(tip) {
    if (!tip.analysis) return '';
    if (typeof tip.analysis === 'string') return tip.analysis;
    return tip.analysis.summary || '';
  },

  _marketOptions(selected) {
    var markets = ['Win', 'Each-Way', 'Value Outsider', 'Match Result', 'BTTS', 'Over/Under', 'Asian Handicap', 'Double Chance'];
    var html = '';
    for (var i = 0; i < markets.length; i++) {
      var sel = (selected === markets[i]) ? ' selected' : '';
      html += '<option value="' + markets[i] + '"' + sel + '>' + markets[i] + '</option>';
    }
    return html;
  },
};
