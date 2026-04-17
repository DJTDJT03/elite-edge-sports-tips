/* =========================================================================
   ELITE EDGE SPORTS TIPS — Admin Audit Log Module
   Renders into #admin-content
   Depends on: AdminAPI, AdminApp.toast(), AdminApp.formatDate()
   ========================================================================= */

window.AuditPage = {
  _entries: [],
  _totalCount: 0,
  _page: 1,
  _limit: 50,
  _filterAction: '',
  _filterDateFrom: '',
  _filterDateTo: '',
  _expandedId: null,

  // ---------------------------------------------------------------------------
  // RENDER — main entry point
  // ---------------------------------------------------------------------------
  async render() {
    var container = document.getElementById('admin-content');
    if (!container) return;

    container.innerHTML = '<div class="admin-loading"><div class="spinner"></div> Loading audit log...</div>';

    await this._loadPage();
    this._renderPage(container);
  },

  // ---------------------------------------------------------------------------
  // LOAD DATA
  // ---------------------------------------------------------------------------
  async _loadPage() {
    var query = '?page=' + this._page + '&limit=' + this._limit;

    if (this._filterAction) {
      query += '&action=' + encodeURIComponent(this._filterAction);
    }
    if (this._filterDateFrom) {
      query += '&from=' + encodeURIComponent(this._filterDateFrom);
    }
    if (this._filterDateTo) {
      query += '&to=' + encodeURIComponent(this._filterDateTo);
    }

    try {
      var data = await AdminAPI.get('/admin/audit-log' + query);
      if (Array.isArray(data)) {
        this._entries = data;
        this._totalCount = data.length;
      } else {
        this._entries = data.entries || data.logs || data.items || [];
        this._totalCount = data.total || data.totalCount || this._entries.length;
      }
    } catch (err) {
      this._entries = [];
      this._totalCount = 0;
      AdminApp.toast('Failed to load audit log: ' + (err.message || err), 'error');
    }
  },

  // ---------------------------------------------------------------------------
  // PAGE LAYOUT
  // ---------------------------------------------------------------------------
  _renderPage(container) {
    container.innerHTML = ''
      // Header
      + '<div class="admin-header-bar">'
      +   '<h2 class="admin-page-title">Audit Log</h2>'
      + '</div>'

      // Filter bar
      + '<div class="admin-filter-bar">'
      +   '<div class="filter-group">'
      +     '<label for="audit-action">Action</label>'
      +     '<select id="audit-action">'
      +       '<option value="">All Actions</option>'
      +       '<option value="login"' + (this._filterAction === 'login' ? ' selected' : '') + '>Login</option>'
      +       '<option value="tip_created"' + (this._filterAction === 'tip_created' ? ' selected' : '') + '>Tip Created</option>'
      +       '<option value="tip_deleted"' + (this._filterAction === 'tip_deleted' ? ' selected' : '') + '>Tip Deleted</option>'
      +       '<option value="result_settled"' + (this._filterAction === 'result_settled' ? ' selected' : '') + '>Result Settled</option>'
      +       '<option value="subscription_changed"' + (this._filterAction === 'subscription_changed' ? ' selected' : '') + '>Subscription Changed</option>'
      +       '<option value="user_locked"' + (this._filterAction === 'user_locked' ? ' selected' : '') + '>User Locked</option>'
      +     '</select>'
      +   '</div>'
      +   '<div class="filter-group">'
      +     '<label for="audit-date-from">From</label>'
      +     '<input type="date" id="audit-date-from" value="' + this._esc(this._filterDateFrom) + '">'
      +   '</div>'
      +   '<div class="filter-group">'
      +     '<label for="audit-date-to">To</label>'
      +     '<input type="date" id="audit-date-to" value="' + this._esc(this._filterDateTo) + '">'
      +   '</div>'
      + '</div>'

      // Audit table
      + '<div class="admin-table-wrap">'
      +   this._buildTable()
      + '</div>'

      // Pagination
      + this._buildPagination();

    this._bindEvents(container);
  },

  // ---------------------------------------------------------------------------
  // TABLE
  // ---------------------------------------------------------------------------
  _buildTable() {
    if (!this._entries.length) {
      return '<div class="admin-empty">No audit entries yet &mdash; actions will be logged as they occur.</div>';
    }

    var rows = '';
    for (var i = 0; i < this._entries.length; i++) {
      rows += this._buildRow(this._entries[i], i);
    }

    return '<table class="admin-table audit-table">'
      + '<thead><tr>'
      +   '<th>Timestamp</th>'
      +   '<th>Admin User</th>'
      +   '<th>Action</th>'
      +   '<th>Entity</th>'
      +   '<th>Entity ID</th>'
      +   '<th>Details</th>'
      +   '<th>IP</th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table>';
  },

  _buildRow(entry, index) {
    // Timestamp
    var timestamp = entry.timestamp || entry.createdAt || entry.date || '-';
    var formattedTime = '-';
    if (timestamp && timestamp !== '-') {
      var d = new Date(timestamp);
      formattedTime = AdminApp.formatDate(timestamp) + ' ' + this._formatTime(d);
    }

    // Admin user
    var adminUser = entry.adminUser || entry.admin || entry.user || entry.performedBy || '-';
    if (typeof adminUser === 'object') {
      adminUser = adminUser.name || adminUser.email || '-';
    }

    // Action badge
    var actionType = entry.action || entry.type || '-';
    var actionBadge = '<span class="badge badge-action badge-action-' + this._slugify(actionType) + '">'
      + this._formatAction(actionType) + '</span>';

    // Entity
    var entity = entry.entity || entry.entityType || entry.resource || '-';
    var entityId = entry.entityId || entry.resourceId || '-';

    // Details (expandable)
    var details = entry.details || entry.description || entry.meta || null;
    var isExpanded = this._expandedId === (entry.id || index);
    var detailsHTML = '';

    if (details) {
      var detailStr = typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details);
      var truncated = detailStr.length > 50 ? detailStr.substring(0, 50) + '...' : detailStr;

      if (isExpanded) {
        detailsHTML = '<div class="audit-details-expanded"><pre class="audit-details-pre">'
          + this._esc(detailStr) + '</pre></div>';
      } else {
        detailsHTML = '<span class="audit-details-truncated">' + this._esc(truncated) + '</span>';
      }

      detailsHTML += ' <button class="btn-link btn-toggle-details" data-index="' + (entry.id || index) + '">'
        + (isExpanded ? 'collapse' : 'expand') + '</button>';
    } else {
      detailsHTML = '<span class="text-muted">-</span>';
    }

    // IP
    var ip = entry.ip || entry.ipAddress || '-';

    return '<tr>'
      + '<td class="col-timestamp">' + formattedTime + '</td>'
      + '<td>' + this._esc(String(adminUser)) + '</td>'
      + '<td>' + actionBadge + '</td>'
      + '<td>' + this._esc(String(entity)) + '</td>'
      + '<td class="col-mono">' + this._esc(String(entityId)) + '</td>'
      + '<td class="col-details">' + detailsHTML + '</td>'
      + '<td class="col-mono">' + this._esc(String(ip)) + '</td>'
      + '</tr>';
  },

  // ---------------------------------------------------------------------------
  // PAGINATION
  // ---------------------------------------------------------------------------
  _buildPagination() {
    var totalPages = Math.max(1, Math.ceil(this._totalCount / this._limit));

    if (totalPages <= 1) return '';

    var hasPrev = this._page > 1;
    var hasNext = this._page < totalPages;

    return ''
      + '<div class="admin-pagination">'
      +   '<button class="btn btn-outline btn-prev"' + (hasPrev ? '' : ' disabled') + '>&#8592; Previous</button>'
      +   '<span class="pagination-info">Page ' + this._page + ' of ' + totalPages
      +     ' (' + this._totalCount + ' entries)</span>'
      +   '<button class="btn btn-outline btn-next"' + (hasNext ? '' : ' disabled') + '>Next &#8594;</button>'
      + '</div>';
  },

  // ---------------------------------------------------------------------------
  // EVENT BINDINGS
  // ---------------------------------------------------------------------------
  _bindEvents(container) {
    var self = this;

    // Action filter
    var actionFilter = document.getElementById('audit-action');
    if (actionFilter) {
      actionFilter.addEventListener('change', function () {
        self._filterAction = this.value;
        self._page = 1;
        self._expandedId = null;
        self.render();
      });
    }

    // Date range filters
    var dateFrom = document.getElementById('audit-date-from');
    var dateTo = document.getElementById('audit-date-to');

    if (dateFrom) {
      dateFrom.addEventListener('change', function () {
        self._filterDateFrom = this.value;
        self._page = 1;
        self._expandedId = null;
        self.render();
      });
    }
    if (dateTo) {
      dateTo.addEventListener('change', function () {
        self._filterDateTo = this.value;
        self._page = 1;
        self._expandedId = null;
        self.render();
      });
    }

    // Pagination
    var prevBtn = container.querySelector('.btn-prev');
    var nextBtn = container.querySelector('.btn-next');

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (self._page > 1) {
          self._page--;
          self._expandedId = null;
          self.render();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.ceil(self._totalCount / self._limit);
        if (self._page < totalPages) {
          self._page++;
          self._expandedId = null;
          self.render();
        }
      });
    }

    // Detail expand/collapse toggles
    var toggleBtns = container.querySelectorAll('.btn-toggle-details');
    for (var i = 0; i < toggleBtns.length; i++) {
      toggleBtns[i].addEventListener('click', function () {
        var idx = this.getAttribute('data-index');
        if (self._expandedId === idx) {
          self._expandedId = null;
        } else {
          self._expandedId = idx;
        }
        self._renderPage(container);
      });
    }
  },

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  _formatTime(d) {
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  },

  _formatAction(action) {
    if (!action || action === '-') return '-';
    return action
      .replace(/_/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  },

  _slugify(s) {
    if (!s) return '';
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  },

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
  }
};
