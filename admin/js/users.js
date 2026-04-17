/* =========================================================================
   ELITE EDGE SPORTS TIPS — Admin Users Management Module
   Renders into #admin-content
   Depends on: AdminAPI, AdminApp.toast(), AdminApp.modal(), AdminApp.formatDate()
   ========================================================================= */

window.UsersPage = {
  _users: [],
  _searchTerm: '',

  // ---------------------------------------------------------------------------
  // RENDER — main entry point
  // ---------------------------------------------------------------------------
  async render() {
    var container = document.getElementById('admin-content');
    if (!container) return;

    container.innerHTML = '<div class="admin-loading"><div class="spinner"></div> Loading users...</div>';

    try {
      this._users = await AdminAPI.get('/admin/users');
    } catch (err) {
      container.innerHTML = '<div class="admin-error">Failed to load users: ' + (err.message || err) + '</div>';
      return;
    }

    this._renderPage(container);
  },

  // ---------------------------------------------------------------------------
  // PAGE LAYOUT
  // ---------------------------------------------------------------------------
  _renderPage(container) {
    var filtered = this._filteredUsers();

    container.innerHTML = ''
      // Header
      + '<div class="admin-header-bar">'
      +   '<h2 class="admin-page-title">User Management '
      +     '<span class="badge badge-count">' + this._users.length + '</span>'
      +   '</h2>'
      + '</div>'

      // Search bar
      + '<div class="admin-filter-bar">'
      +   '<div class="filter-group filter-group-wide">'
      +     '<label for="user-search">Search</label>'
      +     '<input type="text" id="user-search" placeholder="Filter by name or email..." value="' + this._esc(this._searchTerm) + '">'
      +   '</div>'
      + '</div>'

      // Users table
      + '<div class="admin-table-wrap">'
      +   this._buildTable(filtered)
      + '</div>';

    this._bindEvents(container);
  },

  // ---------------------------------------------------------------------------
  // TABLE
  // ---------------------------------------------------------------------------
  _buildTable(users) {
    if (!users.length) {
      return '<div class="admin-empty">No users match the current search.</div>';
    }

    var rows = '';
    for (var i = 0; i < users.length; i++) {
      rows += this._buildRow(users[i]);
    }

    return '<table class="admin-table users-table">'
      + '<thead><tr>'
      +   '<th>Name</th>'
      +   '<th>Email</th>'
      +   '<th>Role</th>'
      +   '<th>Subscription</th>'
      +   '<th>Sub Expiry</th>'
      +   '<th>Joined</th>'
      +   '<th>Status</th>'
      +   '<th>Actions</th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table>';
  },

  _buildRow(u) {
    // Role badge
    var roleClass = 'badge-role-free';
    if (u.role === 'admin') roleClass = 'badge-role-admin';
    else if (u.role === 'premium') roleClass = 'badge-role-premium';
    var roleBadge = '<span class="badge ' + roleClass + '">' + this._ucFirst(u.role || 'free') + '</span>';

    // Subscription
    var subLabel = this._ucFirst(u.subscription || u.role || 'free');

    // Subscription expiry
    var expiryLabel = u.subscriptionExpiry ? AdminApp.formatDate(u.subscriptionExpiry) : '-';

    // Joined date
    var joinedLabel = u.createdAt ? AdminApp.formatDate(u.createdAt) : (u.joined ? AdminApp.formatDate(u.joined) : '-');

    // Status indicators
    var statusHTML = '';
    if (u.isLocked || u.locked) {
      statusHTML += '<span class="badge badge-locked" title="Account locked">Locked</span> ';
    }
    if (u.isFlagged || u.flagged) {
      statusHTML += '<span class="badge badge-flagged" title="Account flagged">Flagged</span> ';
    }
    if (!statusHTML) {
      statusHTML = '<span class="badge badge-active">Active</span>';
    }

    // Actions
    var isLocked = u.isLocked || u.locked;
    var lockBtn = isLocked
      ? '<button class="btn btn-sm btn-green btn-unlock" data-id="' + u.id + '">Unlock</button>'
      : '<button class="btn btn-sm btn-red btn-lock" data-id="' + u.id + '">Lock</button>';

    var forceLogoutBtn = '<button class="btn btn-sm btn-outline btn-force-logout" data-id="' + u.id + '">Force Logout</button>';

    // Change subscription dropdown + expiry picker
    var currentSub = u.subscription || u.role || 'free';
    var changeSub = ''
      + '<div class="inline-sub-change">'
      +   '<select class="sub-select" data-id="' + u.id + '">'
      +     '<option value="free"' + (currentSub === 'free' ? ' selected' : '') + '>Free</option>'
      +     '<option value="premium"' + (currentSub === 'premium' ? ' selected' : '') + '>Premium</option>'
      +   '</select>'
      +   '<input type="date" class="sub-expiry" data-id="' + u.id + '" value="' + (u.subscriptionExpiry ? u.subscriptionExpiry.substring(0, 10) : '') + '" title="Subscription expiry">'
      +   '<button class="btn btn-sm btn-outline btn-save-sub" data-id="' + u.id + '" title="Save subscription change">Save</button>'
      + '</div>';

    return '<tr class="user-row" data-id="' + u.id + '">'
      + '<td class="user-name-cell">' + this._esc(u.name || '-') + '</td>'
      + '<td>' + this._esc(u.email || '-') + '</td>'
      + '<td>' + roleBadge + '</td>'
      + '<td>' + subLabel + '</td>'
      + '<td>' + expiryLabel + '</td>'
      + '<td>' + joinedLabel + '</td>'
      + '<td>' + statusHTML + '</td>'
      + '<td class="col-actions col-actions-wide">'
      +   lockBtn + ' '
      +   forceLogoutBtn
      +   changeSub
      + '</td>'
      + '</tr>';
  },

  // ---------------------------------------------------------------------------
  // FILTER
  // ---------------------------------------------------------------------------
  _filteredUsers() {
    var term = this._searchTerm.toLowerCase().trim();
    if (!term) return this._users;

    return this._users.filter(function (u) {
      var name = (u.name || '').toLowerCase();
      var email = (u.email || '').toLowerCase();
      return name.indexOf(term) !== -1 || email.indexOf(term) !== -1;
    });
  },

  // ---------------------------------------------------------------------------
  // EVENT BINDINGS
  // ---------------------------------------------------------------------------
  _bindEvents(container) {
    var self = this;

    // Real-time search
    var searchInput = document.getElementById('user-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        self._searchTerm = this.value;
        self._renderPage(container);
        // Refocus and restore cursor position
        var input = document.getElementById('user-search');
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      });
    }

    // Lock buttons
    var lockBtns = container.querySelectorAll('.btn-lock');
    for (var i = 0; i < lockBtns.length; i++) {
      lockBtns[i].addEventListener('click', function (e) {
        e.stopPropagation();
        self._lockUser(this.getAttribute('data-id'));
      });
    }

    // Unlock buttons
    var unlockBtns = container.querySelectorAll('.btn-unlock');
    for (var j = 0; j < unlockBtns.length; j++) {
      unlockBtns[j].addEventListener('click', function (e) {
        e.stopPropagation();
        self._unlockUser(this.getAttribute('data-id'));
      });
    }

    // Force logout buttons
    var logoutBtns = container.querySelectorAll('.btn-force-logout');
    for (var k = 0; k < logoutBtns.length; k++) {
      logoutBtns[k].addEventListener('click', function (e) {
        e.stopPropagation();
        self._forceLogout(this.getAttribute('data-id'));
      });
    }

    // Save subscription buttons
    var saveBtns = container.querySelectorAll('.btn-save-sub');
    for (var s = 0; s < saveBtns.length; s++) {
      saveBtns[s].addEventListener('click', function (e) {
        e.stopPropagation();
        self._changeSubscription(this.getAttribute('data-id'));
      });
    }

    // Row click -> detail modal (but not on action elements)
    var rows = container.querySelectorAll('.user-row .user-name-cell');
    for (var r = 0; r < rows.length; r++) {
      rows[r].addEventListener('click', function () {
        var id = this.parentNode.getAttribute('data-id');
        self._showUserDetail(id);
      });
      rows[r].style.cursor = 'pointer';
      rows[r].title = 'Click to view details';
    }
  },

  // ---------------------------------------------------------------------------
  // ACTIONS
  // ---------------------------------------------------------------------------
  async _lockUser(id) {
    try {
      await AdminAPI.post('/admin/users/' + id + '/lock');
      AdminApp.toast('User account locked.', 'success');
      await this.render();
    } catch (err) {
      AdminApp.toast('Lock failed: ' + (err.message || err), 'error');
    }
  },

  async _unlockUser(id) {
    try {
      await AdminAPI.post('/admin/users/' + id + '/unlock');
      AdminApp.toast('User account unlocked.', 'success');
      await this.render();
    } catch (err) {
      AdminApp.toast('Unlock failed: ' + (err.message || err), 'error');
    }
  },

  async _forceLogout(id) {
    try {
      await AdminAPI.post('/admin/users/' + id + '/force-logout');
      AdminApp.toast('User has been forcefully logged out.', 'success');
    } catch (err) {
      AdminApp.toast('Force logout failed: ' + (err.message || err), 'error');
    }
  },

  async _changeSubscription(id) {
    var selectEl = document.querySelector('.sub-select[data-id="' + id + '"]');
    var expiryEl = document.querySelector('.sub-expiry[data-id="' + id + '"]');

    if (!selectEl) return;

    var subscription = selectEl.value;
    var expiry = expiryEl ? expiryEl.value : null;

    var payload = { subscription: subscription };
    if (expiry) payload.subscriptionExpiry = expiry;

    try {
      await AdminAPI.put('/admin/users/' + id + '/subscription', payload);
      AdminApp.toast('Subscription updated to ' + this._ucFirst(subscription) + '.', 'success');
      await this.render();
    } catch (err) {
      AdminApp.toast('Subscription update failed: ' + (err.message || err), 'error');
    }
  },

  // ---------------------------------------------------------------------------
  // USER DETAIL MODAL
  // ---------------------------------------------------------------------------
  async _showUserDetail(id) {
    var user = this._users.find(function (u) { return u.id === id; });
    if (!user) return;

    var bodyHTML = ''
      + '<div class="user-detail">'

      // Basic info
      + '<div class="detail-section">'
      +   '<h4 class="detail-section-title">Account Information</h4>'
      +   '<div class="detail-grid">'
      +     '<div class="detail-item"><span class="detail-label">Name</span><span class="detail-value">' + this._esc(user.name || '-') + '</span></div>'
      +     '<div class="detail-item"><span class="detail-label">Email</span><span class="detail-value">' + this._esc(user.email || '-') + '</span></div>'
      +     '<div class="detail-item"><span class="detail-label">Role</span><span class="detail-value">' + this._ucFirst(user.role || 'free') + '</span></div>'
      +     '<div class="detail-item"><span class="detail-label">Subscription</span><span class="detail-value">' + this._ucFirst(user.subscription || user.role || 'free') + '</span></div>'
      +     '<div class="detail-item"><span class="detail-label">Subscription Expiry</span><span class="detail-value">' + (user.subscriptionExpiry ? AdminApp.formatDate(user.subscriptionExpiry) : '-') + '</span></div>'
      +     '<div class="detail-item"><span class="detail-label">Joined</span><span class="detail-value">' + AdminApp.formatDate(user.createdAt || user.joined) + '</span></div>'
      +     '<div class="detail-item"><span class="detail-label">Locked</span><span class="detail-value">' + (user.isLocked || user.locked ? 'Yes' : 'No') + '</span></div>'
      +     '<div class="detail-item"><span class="detail-label">Flagged</span><span class="detail-value">' + (user.isFlagged || user.flagged ? 'Yes' : 'No') + '</span></div>'
      +   '</div>'
      + '</div>'

      // Login history
      + '<div class="detail-section">'
      +   '<h4 class="detail-section-title">Login History</h4>'
      +   this._renderLoginHistory(user.loginHistory)
      + '</div>'

      // Trusted devices
      + '<div class="detail-section">'
      +   '<h4 class="detail-section-title">Trusted Devices</h4>'
      +   this._renderTrustedDevices(user.trustedDevices)
      + '</div>'

      // Email preferences
      + '<div class="detail-section">'
      +   '<h4 class="detail-section-title">Email Preferences</h4>'
      +   this._renderEmailPrefs(user.emailPreferences)
      + '</div>'

      + '</div>';

    AdminApp.modal(this._esc(user.name || user.email || 'User Details'), bodyHTML);
  },

  _renderLoginHistory(history) {
    if (!history || !history.length) {
      return '<p class="detail-empty">No login history available.</p>';
    }

    var html = '<table class="admin-table admin-table-compact">'
      + '<thead><tr><th>Date</th><th>IP Address</th><th>Device</th></tr></thead>'
      + '<tbody>';

    var entries = history.slice(-10).reverse();
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      html += '<tr>'
        + '<td>' + AdminApp.formatDate(e.date || e.timestamp) + '</td>'
        + '<td>' + this._esc(e.ip || '-') + '</td>'
        + '<td>' + this._esc(e.device || e.userAgent || '-') + '</td>'
        + '</tr>';
    }

    html += '</tbody></table>';
    return html;
  },

  _renderTrustedDevices(devices) {
    if (!devices || !devices.length) {
      return '<p class="detail-empty">No trusted devices registered.</p>';
    }

    var html = '<ul class="detail-list">';
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      var label = d.name || d.userAgent || d.device || 'Unknown device';
      var added = d.addedAt || d.trustedAt || d.date;
      html += '<li>'
        + '<span class="detail-device-name">' + this._esc(label) + '</span>'
        + (added ? '<span class="detail-device-date"> &mdash; added ' + AdminApp.formatDate(added) + '</span>' : '')
        + '</li>';
    }
    html += '</ul>';
    return html;
  },

  _renderEmailPrefs(prefs) {
    if (!prefs) {
      return '<p class="detail-empty">No email preferences set.</p>';
    }

    var html = '<ul class="detail-list">';
    var keys = Object.keys(prefs);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = prefs[key];
      var icon = val ? '&#10003;' : '&#10007;';
      var cls = val ? 'pref-on' : 'pref-off';
      html += '<li class="' + cls + '">'
        + '<span class="pref-icon">' + icon + '</span> '
        + this._formatPrefLabel(key)
        + '</li>';
    }
    html += '</ul>';
    return html;
  },

  _formatPrefLabel(key) {
    // Convert camelCase or snake_case to readable label
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^\s/, '')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
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
  }
};
