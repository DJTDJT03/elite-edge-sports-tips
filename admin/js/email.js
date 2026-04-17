/* =========================================================================
   ELITE EDGE SPORTS TIPS — Admin Email Module
   Renders into #admin-content
   Depends on: AdminAPI, AdminApp.toast(), AdminApp.confirm(), AdminApp.modal()
   ========================================================================= */

window.EmailPage = {
  _tips: [],
  _sentHistory: [],
  _diagnostic: null,
  _previewHTML: '',

  // ---------------------------------------------------------------------------
  // RENDER — main entry point
  // ---------------------------------------------------------------------------
  async render() {
    var container = document.getElementById('admin-content');
    if (!container) return;

    container.innerHTML = '<div class="admin-loading"><div class="spinner"></div> Loading email tools...</div>';

    try {
      var results = await Promise.all([
        AdminAPI.get('/tips'),
        AdminAPI.get('/email/sent').catch(function () { return []; }),
        AdminAPI.get('/email/diagnostic').catch(function () { return null; })
      ]);
      this._tips = results[0] || [];
      this._sentHistory = results[1] || [];
      this._diagnostic = results[2];
    } catch (err) {
      container.innerHTML = '<div class="admin-error">Failed to load email data: ' + (err.message || err) + '</div>';
      return;
    }

    this._previewHTML = '';
    this._renderPage(container);
  },

  // ---------------------------------------------------------------------------
  // PAGE LAYOUT
  // ---------------------------------------------------------------------------
  _renderPage(container) {
    var self = this;

    container.innerHTML = ''
      + '<div class="admin-page-header">'
      +   '<h2>Email Bulletin</h2>'
      +   '<p class="admin-page-sub">Compose, preview, and send email bulletins to your users</p>'
      + '</div>'

      // ---- Compose section ----
      + '<div class="admin-section">'
      +   '<h3 class="admin-section-title">Compose</h3>'
      +   '<form id="email-compose-form" class="admin-form">'

      +     '<div class="form-group">'
      +       '<label for="email-subject">Subject</label>'
      +       '<input type="text" id="email-subject" placeholder="e.g. Weekend Tips Bulletin" required>'
      +     '</div>'

      +     '<div class="form-group">'
      +       '<label for="email-summary">Summary / Intro</label>'
      +       '<textarea id="email-summary" rows="4" placeholder="Brief introduction for the bulletin..."></textarea>'
      +     '</div>'

      +     '<div class="form-group">'
      +       '<label>Target Audience</label>'
      +       '<div class="radio-group">'
      +         '<label class="radio-label"><input type="radio" name="email-audience" value="all" checked> All Users</label>'
      +         '<label class="radio-label"><input type="radio" name="email-audience" value="premium"> Premium Only</label>'
      +         '<label class="radio-label"><input type="radio" name="email-audience" value="free"> Free Only</label>'
      +       '</div>'
      +     '</div>'

      +     '<div class="form-group">'
      +       '<label>Include Tips</label>'
      +       '<div class="tip-checkboxes" id="tip-checkboxes">'
      +         this._buildTipCheckboxes()
      +       '</div>'
      +     '</div>'

      +     '<div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap;">'
      +       '<button type="button" class="btn btn-outline" id="btn-preview">Preview</button>'
      +       '<button type="button" class="btn btn-gold" id="btn-send-now">Send Now</button>'
      +       '<button type="button" class="btn btn-outline" id="btn-schedule">Schedule</button>'
      +     '</div>'

      +   '</form>'
      + '</div>'

      // ---- Preview area ----
      + '<div class="admin-section" id="preview-section" style="display:none;">'
      +   '<h3 class="admin-section-title">Preview</h3>'
      +   '<div id="email-preview" style="border:1px solid var(--border-color,#333);border-radius:8px;padding:16px;background:var(--bg-card,#1a1e2e);max-height:500px;overflow-y:auto;"></div>'
      + '</div>'

      // ---- Schedule picker (hidden by default) ----
      + '<div class="admin-section" id="schedule-section" style="display:none;">'
      +   '<h3 class="admin-section-title">Schedule Send</h3>'
      +   '<div class="form-row" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">'
      +     '<div class="form-group">'
      +       '<label for="schedule-date">Date</label>'
      +       '<input type="date" id="schedule-date">'
      +     '</div>'
      +     '<div class="form-group">'
      +       '<label for="schedule-time">Time</label>'
      +       '<input type="time" id="schedule-time" value="09:00">'
      +     '</div>'
      +     '<button class="btn btn-gold" id="btn-confirm-schedule">Confirm Schedule</button>'
      +   '</div>'
      + '</div>'

      // ---- Sent History ----
      + '<div class="admin-section">'
      +   '<h3 class="admin-section-title">Sent History</h3>'
      +   '<div class="admin-table-wrap">'
      +     this._buildSentTable()
      +   '</div>'
      + '</div>'

      // ---- Email Diagnostics ----
      + '<div class="admin-section">'
      +   '<h3 class="admin-section-title">Email Diagnostics</h3>'
      +   this._buildDiagnostics()
      + '</div>';

    this._bindEvents(container);
  },

  // ---------------------------------------------------------------------------
  // TIP CHECKBOXES
  // ---------------------------------------------------------------------------
  _buildTipCheckboxes() {
    var activeTips = this._tips.filter(function (t) {
      return t.status === 'active' || !t.status;
    });

    if (!activeTips.length) {
      return '<p class="admin-empty" style="margin:0;">No active tips available.</p>';
    }

    var html = '';
    for (var i = 0; i < activeTips.length; i++) {
      var t = activeTips[i];
      var label = (t.selection || 'Unnamed') + ' — ' + (t.event || 'Unknown event')
        + ' (' + (t.odds || '-') + ')';
      html += '<label class="checkbox-label" style="display:block;margin-bottom:6px;">'
        + '<input type="checkbox" class="tip-include" value="' + t.id + '"> '
        + this._esc(label)
        + '</label>';
    }
    return html;
  },

  // ---------------------------------------------------------------------------
  // SENT HISTORY TABLE
  // ---------------------------------------------------------------------------
  _buildSentTable() {
    var history = this._sentHistory;

    if (!history || !history.length) {
      return '<p class="admin-empty">No emails sent yet</p>';
    }

    var html = '<table class="admin-table">'
      + '<thead><tr>'
      +   '<th>Date</th>'
      +   '<th>Subject</th>'
      +   '<th>Recipients</th>'
      +   '<th>Status</th>'
      + '</tr></thead><tbody>';

    for (var i = 0; i < history.length; i++) {
      var e = history[i];
      var statusClass = e.status === 'sent' ? 'status-connected' : 'status-disconnected';
      html += '<tr>'
        + '<td>' + AdminApp.formatDate(e.date || e.sentAt) + '</td>'
        + '<td>' + this._esc(e.subject || '-') + '</td>'
        + '<td>' + (e.recipients || e.recipientCount || '-') + '</td>'
        + '<td><span class="status-dot ' + statusClass + '" style="display:inline-block;margin-right:6px;"></span>' + this._esc(e.status || 'unknown') + '</td>'
        + '</tr>';
    }

    html += '</tbody></table>';
    return html;
  },

  // ---------------------------------------------------------------------------
  // DIAGNOSTICS
  // ---------------------------------------------------------------------------
  _buildDiagnostics() {
    var d = this._diagnostic;

    if (!d) {
      return '<p class="admin-empty">Unable to load email diagnostics.</p>';
    }

    var transport = d.transport || d.transportType || 'Unknown';
    var html = '<div class="api-status-grid" style="margin-bottom:16px;">'
      + '<div class="api-status-item">'
      +   '<span class="api-status-label">Transport</span>'
      +   '<span class="api-status-text" style="font-weight:600;">' + this._esc(transport) + '</span>'
      + '</div>'
      + '</div>'
      + '<button class="btn btn-outline" id="btn-test-email">Send Test Email</button>';

    return html;
  },

  // ---------------------------------------------------------------------------
  // COLLECT FORM DATA
  // ---------------------------------------------------------------------------
  _collectFormData() {
    var subject = document.getElementById('email-subject').value.trim();
    var summary = document.getElementById('email-summary').value.trim();

    var audienceRadios = document.querySelectorAll('input[name="email-audience"]');
    var audience = 'all';
    for (var i = 0; i < audienceRadios.length; i++) {
      if (audienceRadios[i].checked) {
        audience = audienceRadios[i].value;
        break;
      }
    }

    var tipCheckboxes = document.querySelectorAll('.tip-include:checked');
    var tipIds = [];
    for (var j = 0; j < tipCheckboxes.length; j++) {
      tipIds.push(tipCheckboxes[j].value);
    }

    return {
      subject: subject,
      summary: summary,
      audience: audience,
      tipIds: tipIds
    };
  },

  // ---------------------------------------------------------------------------
  // EVENT BINDINGS
  // ---------------------------------------------------------------------------
  _bindEvents(container) {
    var self = this;

    // Preview button
    var previewBtn = document.getElementById('btn-preview');
    if (previewBtn) {
      previewBtn.addEventListener('click', function () {
        self._doPreview();
      });
    }

    // Send Now button
    var sendBtn = document.getElementById('btn-send-now');
    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        self._doSendNow();
      });
    }

    // Schedule button — toggle schedule picker
    var scheduleBtn = document.getElementById('btn-schedule');
    if (scheduleBtn) {
      scheduleBtn.addEventListener('click', function () {
        var section = document.getElementById('schedule-section');
        if (section) {
          section.style.display = section.style.display === 'none' ? '' : 'none';
        }
      });
    }

    // Confirm schedule
    var confirmScheduleBtn = document.getElementById('btn-confirm-schedule');
    if (confirmScheduleBtn) {
      confirmScheduleBtn.addEventListener('click', function () {
        self._doSchedule();
      });
    }

    // Test email button
    var testBtn = document.getElementById('btn-test-email');
    if (testBtn) {
      testBtn.addEventListener('click', function () {
        self._doTestEmail();
      });
    }
  },

  // ---------------------------------------------------------------------------
  // PREVIEW
  // ---------------------------------------------------------------------------
  async _doPreview() {
    var data = this._collectFormData();

    if (!data.subject) {
      AdminApp.toast('Please enter a subject line.', 'error');
      return;
    }

    try {
      AdminApp.toast('Generating preview...', 'info');
      var result = await AdminAPI.post('/email/compose', data);
      this._previewHTML = result.html || result.preview || '';

      var previewSection = document.getElementById('preview-section');
      var previewDiv = document.getElementById('email-preview');
      if (previewSection && previewDiv) {
        previewDiv.innerHTML = this._previewHTML;
        previewSection.style.display = '';
      }
    } catch (err) {
      AdminApp.toast('Preview failed: ' + (err.message || err), 'error');
    }
  },

  // ---------------------------------------------------------------------------
  // SEND NOW
  // ---------------------------------------------------------------------------
  _doSendNow() {
    var self = this;
    var data = this._collectFormData();

    if (!data.subject) {
      AdminApp.toast('Please enter a subject line.', 'error');
      return;
    }

    AdminApp.confirm(
      'Send this bulletin to <strong>' + this._audienceLabel(data.audience) + '</strong> now?',
      function () {
        AdminApp.toast('Sending bulletin...', 'info');
        AdminAPI.post('/email/send', data)
          .then(function (result) {
            var count = result.sent || result.recipientCount || 0;
            AdminApp.toast('Bulletin sent to ' + count + ' recipient(s).', 'success');
            self.render();
          })
          .catch(function (err) {
            AdminApp.toast('Send failed: ' + (err.message || err), 'error');
          });
      }
    );
  },

  // ---------------------------------------------------------------------------
  // SCHEDULE
  // ---------------------------------------------------------------------------
  async _doSchedule() {
    var data = this._collectFormData();

    if (!data.subject) {
      AdminApp.toast('Please enter a subject line.', 'error');
      return;
    }

    var dateVal = document.getElementById('schedule-date').value;
    var timeVal = document.getElementById('schedule-time').value;

    if (!dateVal || !timeVal) {
      AdminApp.toast('Please select a date and time.', 'error');
      return;
    }

    data.scheduledAt = dateVal + 'T' + timeVal;

    try {
      AdminApp.toast('Scheduling bulletin...', 'info');
      var result = await AdminAPI.post('/email/schedule', data);
      AdminApp.toast(result.message || 'Bulletin scheduled successfully.', 'success');

      // Hide schedule picker
      var section = document.getElementById('schedule-section');
      if (section) section.style.display = 'none';

      this.render();
    } catch (err) {
      AdminApp.toast('Schedule failed: ' + (err.message || err), 'error');
    }
  },

  // ---------------------------------------------------------------------------
  // TEST EMAIL
  // ---------------------------------------------------------------------------
  async _doTestEmail() {
    try {
      AdminApp.toast('Sending test email...', 'info');
      var result = await AdminAPI.post('/email/test', {});
      AdminApp.toast(result.message || 'Test email sent successfully.', 'success');
    } catch (err) {
      AdminApp.toast('Test email failed: ' + (err.message || err), 'error');
    }
  },

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  _audienceLabel(audience) {
    if (audience === 'premium') return 'Premium Users';
    if (audience === 'free') return 'Free Users';
    return 'All Users';
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
