/* =========================================================================
   ELITE EDGE SPORTS TIPS — Admin Support Tickets Module
   Renders into #admin-content
   Depends on: AdminAPI, AdminApp.toast(), AdminApp.formatDate()
   ========================================================================= */

window.SupportPage = {
  _tickets: [],
  _expandedId: null,

  // ---------------------------------------------------------------------------
  // RENDER — main entry point
  // ---------------------------------------------------------------------------
  async render() {
    var container = document.getElementById('admin-content');
    if (!container) return;

    container.innerHTML = '<div class="admin-loading"><div class="spinner"></div> Loading support tickets...</div>';

    try {
      var data = await AdminAPI.get('/support');
      this._tickets = Array.isArray(data) ? data : (data.tickets || []);
    } catch (err) {
      container.innerHTML = '<div class="admin-error">Failed to load tickets: ' + (err.message || err) + '</div>';
      return;
    }

    this._renderPage(container);
  },

  // ---------------------------------------------------------------------------
  // PAGE LAYOUT
  // ---------------------------------------------------------------------------
  _renderPage(container) {
    var openCount = this._tickets.filter(function (t) { return t.status === 'open'; }).length;

    container.innerHTML = ''
      // Header
      + '<div class="admin-header-bar">'
      +   '<h2 class="admin-page-title">Support Tickets '
      +     '<span class="badge badge-count">' + openCount + ' open</span>'
      +   '</h2>'
      + '</div>'

      // Ticket groups
      + this._renderGroup('open', 'Open')
      + this._renderGroup('in-progress', 'In Progress')
      + this._renderGroup('resolved', 'Resolved');

    this._bindEvents(container);
  },

  // ---------------------------------------------------------------------------
  // TICKET GROUP
  // ---------------------------------------------------------------------------
  _renderGroup(status, label) {
    var tickets = this._tickets.filter(function (t) {
      return t.status === status;
    });

    if (!tickets.length && status === 'open') {
      return ''
        + '<div class="admin-section">'
        +   '<h3 class="admin-section-title">' + label + '</h3>'
        +   '<div class="admin-empty">No open tickets — great work keeping up!</div>'
        + '</div>';
    }

    if (!tickets.length) {
      return '';
    }

    var cards = '';
    for (var i = 0; i < tickets.length; i++) {
      cards += this._renderTicketCard(tickets[i]);
    }

    return ''
      + '<div class="admin-section">'
      +   '<h3 class="admin-section-title">' + label + ' <span class="badge badge-count">' + tickets.length + '</span></h3>'
      +   '<div class="ticket-list">' + cards + '</div>'
      + '</div>';
  },

  // ---------------------------------------------------------------------------
  // TICKET CARD
  // ---------------------------------------------------------------------------
  _renderTicketCard(ticket) {
    var isExpanded = this._expandedId === ticket.id;

    // Priority badge
    var priorityClass = 'badge-priority-normal';
    if (ticket.priority === 'high' || ticket.priority === 'urgent') priorityClass = 'badge-priority-high';
    else if (ticket.priority === 'low') priorityClass = 'badge-priority-low';
    var priorityBadge = ticket.priority
      ? '<span class="badge ' + priorityClass + '">' + this._ucFirst(ticket.priority) + '</span> '
      : '';

    // Status badge
    var statusClass = 'badge-status-' + (ticket.status || 'open').replace(/\s+/g, '-');
    var statusBadge = '<span class="badge ' + statusClass + '">' + this._ucFirst(ticket.status || 'open') + '</span>';

    // Date
    var dateStr = AdminApp.formatDate(ticket.createdAt || ticket.date);

    // Expanded content
    var expandedHTML = '';
    if (isExpanded) {
      expandedHTML = this._renderExpandedContent(ticket);
    }

    return ''
      + '<div class="ticket-card' + (isExpanded ? ' ticket-expanded' : '') + '" data-id="' + ticket.id + '">'
      +   '<div class="ticket-header" data-id="' + ticket.id + '">'
      +     '<div class="ticket-header-left">'
      +       '<div class="ticket-subject">' + this._esc(ticket.subject || 'No subject') + '</div>'
      +       '<div class="ticket-meta">'
      +         '<span class="ticket-from">' + this._esc(ticket.name || ticket.from || '-') + '</span>'
      +         ' &lt;' + this._esc(ticket.email || '-') + '&gt; '
      +         '<span class="ticket-date">&mdash; ' + dateStr + '</span>'
      +       '</div>'
      +     '</div>'
      +     '<div class="ticket-header-right">'
      +       priorityBadge
      +       statusBadge
      +       '<span class="ticket-toggle">' + (isExpanded ? '&#9650;' : '&#9660;') + '</span>'
      +     '</div>'
      +   '</div>'
      +   expandedHTML
      + '</div>';
  },

  // ---------------------------------------------------------------------------
  // EXPANDED CONTENT — message, thread, reply form
  // ---------------------------------------------------------------------------
  _renderExpandedContent(ticket) {
    // Original message
    var html = ''
      + '<div class="ticket-body">'
      +   '<div class="ticket-message">'
      +     '<div class="ticket-message-label">Original Message</div>'
      +     '<div class="ticket-message-text">' + this._esc(ticket.message || ticket.body || 'No message content.') + '</div>'
      +   '</div>';

    // Reply thread
    var replies = ticket.replies || ticket.thread || [];
    if (replies.length) {
      html += '<div class="ticket-thread">';
      for (var i = 0; i < replies.length; i++) {
        var r = replies[i];
        var isAdmin = r.isAdmin || r.role === 'admin' || r.from === 'admin';
        var senderLabel = isAdmin ? 'Admin' : (r.name || r.from || 'User');
        var replyDate = AdminApp.formatDate(r.createdAt || r.date);

        html += ''
          + '<div class="ticket-reply' + (isAdmin ? ' ticket-reply-admin' : '') + '">'
          +   '<div class="ticket-reply-header">'
          +     '<span class="ticket-reply-sender">' + this._esc(senderLabel) + '</span>'
          +     '<span class="ticket-reply-date">' + replyDate + '</span>'
          +   '</div>'
          +   '<div class="ticket-reply-text">' + this._esc(r.message || r.body || r.text || '') + '</div>'
          + '</div>';
      }
      html += '</div>';
    }

    // Reply form
    html += ''
      + '<div class="ticket-reply-form">'
      +   '<textarea class="ticket-reply-input" data-id="' + ticket.id + '" placeholder="Type your reply..." rows="3"></textarea>'
      +   '<div class="ticket-reply-actions">'
      +     '<select class="ticket-status-select" data-id="' + ticket.id + '">'
      +       '<option value="open"' + (ticket.status === 'open' ? ' selected' : '') + '>Open</option>'
      +       '<option value="in-progress"' + (ticket.status === 'in-progress' ? ' selected' : '') + '>In Progress</option>'
      +       '<option value="resolved"' + (ticket.status === 'resolved' ? ' selected' : '') + '>Resolved</option>'
      +     '</select>'
      +     '<button class="btn btn-gold btn-send-reply" data-id="' + ticket.id + '">Send Reply</button>'
      +   '</div>'
      + '</div>';

    html += '</div>';
    return html;
  },

  // ---------------------------------------------------------------------------
  // EVENT BINDINGS
  // ---------------------------------------------------------------------------
  _bindEvents(container) {
    var self = this;

    // Toggle expand/collapse on header click
    var headers = container.querySelectorAll('.ticket-header');
    for (var i = 0; i < headers.length; i++) {
      headers[i].addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        if (self._expandedId === id) {
          self._expandedId = null;
        } else {
          self._expandedId = id;
        }
        self._renderPage(container);
      });
    }

    // Send reply buttons
    var replyBtns = container.querySelectorAll('.btn-send-reply');
    for (var j = 0; j < replyBtns.length; j++) {
      replyBtns[j].addEventListener('click', function (e) {
        e.stopPropagation();
        self._sendReply(this.getAttribute('data-id'), container);
      });
    }
  },

  // ---------------------------------------------------------------------------
  // SEND REPLY
  // ---------------------------------------------------------------------------
  async _sendReply(ticketId, container) {
    var textarea = document.querySelector('.ticket-reply-input[data-id="' + ticketId + '"]');
    var statusSelect = document.querySelector('.ticket-status-select[data-id="' + ticketId + '"]');
    var sendBtn = document.querySelector('.btn-send-reply[data-id="' + ticketId + '"]');

    var message = textarea ? textarea.value.trim() : '';
    var newStatus = statusSelect ? statusSelect.value : null;

    if (!message) {
      AdminApp.toast('Please enter a reply message.', 'error');
      return;
    }

    // Disable button while sending
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending...';
    }

    var payload = { message: message };
    if (newStatus) payload.status = newStatus;

    try {
      await AdminAPI.post('/support/' + ticketId + '/reply', payload);
      AdminApp.toast('Reply sent successfully.', 'success');
      // Keep expanded on same ticket after re-render
      this._expandedId = ticketId;
      await this.render();
    } catch (err) {
      AdminApp.toast('Reply failed: ' + (err.message || err), 'error');
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Reply';
      }
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
  }
};
