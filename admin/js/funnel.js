/* =========================================================================
   ELITE EDGE SPORTS TIPS — Admin Conversion Funnel Module
   Renders into #admin-content
   Depends on: AdminAPI, AdminApp.toast()

   Two SEPARATE funnels on purpose:
     • Traffic (beacons)  — visits → signup opened → checkout started.
       Consent-gated, so it UNDERcounts; use it for relative shape, not absolutes.
     • Accounts (DB truth) — accounts created → trials → paid. Exact counts.
   We never divide one source by the other (it would exceed 100% and mislead).
   ========================================================================= */

window.FunnelPage = {
  _days: 30,
  _data: null,

  async render() {
    var container = document.getElementById('admin-content');
    if (!container) return;
    container.innerHTML = '<div class="admin-loading"><div class="spinner"></div> Loading funnel...</div>';
    await this._load();
    this._renderPage(container);
  },

  async _load() {
    try {
      this._data = await AdminAPI.get('/analytics/funnel?days=' + this._days);
    } catch (err) {
      this._data = null;
      AdminApp.toast('Failed to load funnel: ' + (err.message || err), 'error');
    }
  },

  setDays(d) {
    this._days = parseInt(d, 10) || 30;
    this.render();
  },

  _renderPage(container) {
    var d = this._data;
    var ranges = [7, 30, 90];
    var rangeBtns = ranges.map((r) => (
      '<button class="btn ' + (this._days === r ? 'btn-gold' : 'btn-outline') + ' btn-sm" ' +
      'onclick="FunnelPage.setDays(' + r + ')">' + r + 'd</button>'
    )).join(' ');

    if (!d || d.available === false) {
      container.innerHTML =
        '<div class="card"><div class="card-header"><h3>Conversion Funnel</h3><div>' + rangeBtns + '</div></div>' +
        '<div style="padding:24px;color:#9aa3b2;">No funnel data yet. Accounts, trials and paid conversions populate from ' +
        'real activity; the traffic funnel starts filling as visitors who accept analytics cookies browse the live site. ' +
        'Check back after some traffic.</div></div>';
      return;
    }

    var k = d.kpis || {};
    var kpiRow =
      '<div style="display:flex;gap:16px;margin-bottom:22px;flex-wrap:wrap;">' +
        this._kpi('New accounts', this._fmt(k.newAccounts), '#2563eb') +
        this._kpi('New paid subs', this._fmt(k.newPaid), '#16a34a') +
        this._kpi('Signup → Paid', this._rate(k.signupToPaid), '#d4a843') +
        this._kpi('Trial → Paid', this._rate(k.trialToPaid), '#d4a843') +
      '</div>';

    container.innerHTML =
      '<div class="card">' +
        '<div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">' +
          '<h3 style="margin:0;">Conversion Funnel <span style="color:#6b7280;font-size:13px;font-weight:400;">last ' + d.days + ' days</span></h3>' +
          '<div>' + rangeBtns + '</div>' +
        '</div>' +
        '<div style="padding:8px 20px 20px;">' +
          kpiRow +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:28px;">' +
            this._funnelBlock('Accounts (exact)', d.accountFunnel, 'Everyone who signs up — exact database counts.') +
            this._funnelBlock('Traffic (beacons)', d.trafficFunnel, 'Cookie-accepting visitors only, so real traffic is higher. Use the shape, not the absolute numbers.') +
          '</div>' +
          '<div style="margin-top:18px;color:#6b7280;font-size:12px;line-height:1.6;">' +
            '"% of prev" is the pass-through to the next stage within the same funnel — the biggest drop is where to focus. ' +
            'The two funnels use different data sources (exact DB vs consent-gated beacons) and are intentionally not divided into each other.' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  _funnelBlock(title, stages, note) {
    stages = stages || [];
    var maxCount = Math.max.apply(null, stages.map((s) => s.count).concat([1]));
    var bars = stages.map((s, i) => {
      var widthPct = Math.max(4, Math.round((s.count / maxCount) * 100));
      var step = s.stepRate === null
        ? ''
        : '<span style="font-weight:700;color:' + this._rateColour(s.stepRate) + ';">' + s.stepRate + '%</span>' +
          '<span style="color:#6b7280;font-size:11px;"> of prev</span>';
      return (
        '<div style="margin-bottom:12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">' +
            '<span style="font-weight:600;color:#e5e9f0;font-size:13px;">' + s.label + '</span>' +
            '<span>' + step + '</span>' +
          '</div>' +
          '<div style="background:#1a2233;border-radius:6px;overflow:hidden;height:34px;">' +
            '<div style="width:' + widthPct + '%;height:100%;background:linear-gradient(90deg,#d4a843,#b8902f);' +
              'display:flex;align-items:center;padding:0 12px;box-sizing:border-box;min-width:52px;">' +
              '<span style="font-weight:800;color:#0a0e1a;font-size:14px;">' + this._fmt(s.count) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    return (
      '<div>' +
        '<div style="font-weight:700;color:#e5e9f0;margin-bottom:10px;">' + title + '</div>' +
        bars +
        '<div style="color:#6b7280;font-size:11px;line-height:1.5;margin-top:6px;">' + note + '</div>' +
      '</div>'
    );
  },

  _kpi(label, value, colour) {
    return (
      '<div style="background:#141a28;border:1px solid #232c40;border-radius:10px;padding:14px 18px;min-width:140px;">' +
        '<div style="color:#9aa3b2;font-size:12px;margin-bottom:4px;">' + label + '</div>' +
        '<div style="font-size:24px;font-weight:800;color:' + colour + ';">' + value + '</div>' +
      '</div>'
    );
  },

  _fmt(n) { return (typeof n === 'number' ? n : 0).toLocaleString(); },
  _rate(r) { return (r === null || r === undefined) ? '—' : r + '%'; },
  _rateColour(rate) {
    if (rate >= 60) return '#16a34a';
    if (rate >= 25) return '#d4a843';
    return '#ef4444';
  },
};
