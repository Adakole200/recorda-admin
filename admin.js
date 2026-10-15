/* Recorda Developer Console. Every data call goes through admin_* database
   functions that re-check on the server that you are a platform admin. */
(function () {
  const sb = window.supabase.createClient(ADMIN_CONFIG.SUPABASE_URL, ADMIN_CONFIG.SUPABASE_ANON_KEY);
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const naira = n => '₦' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
  const num = n => Number(n || 0).toLocaleString('en-NG');
  const dt = d => d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const dtt = d => d ? new Date(d).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  function ago(d) {
    if (!d) return 'never';
    const m = Math.floor((Date.now() - new Date(d)) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    const dd = Math.floor(h / 24); return dd < 30 ? dd + 'd ago' : dt(d);
  }
  function bytes(b) {
    b = Number(b || 0);
    if (b > 1e9) return (b / 1e9).toFixed(2) + ' GB';
    if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB';
    return Math.round(b / 1e3) + ' KB';
  }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800); }
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error(error.message);
    return data;
  }
  function csv(filename, rows) {
    if (!rows.length) return toast('Nothing to export');
    const cols = Object.keys(rows[0]), q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const text = [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = filename; a.click();
  }

  const state = { tab: 'overview', businesses: [], users: [], me: null, timer: null };
  const TITLES = {
    overview: ['Overview', 'How Recorda is doing right now'],
    businesses: ['Businesses', 'Every business on the platform'],
    users: ['Users', 'Everyone who has signed up'],
    errors: ['Errors', 'Problems reported by the app in users\' browsers'],
    audit: ['Audit log', 'Actions taken from this console'],
  };

  /* ---------- auth ---------- */
  async function enter(user) {
    let ok = false;
    try { ok = await rpc('is_platform_admin'); } catch (_) {}
    if (!ok) {
      await sb.auth.signOut();
      $('loginErr').textContent = 'This account is not a platform admin.';
      $('loginView').classList.remove('hidden'); $('appView').classList.add('hidden');
      return;
    }
    state.me = user;
    $('who').textContent = user.email;
    $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden');
    route();
    startTimer();
  }
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('loginBtn'); btn.disabled = true; $('loginErr').textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pw').value });
    btn.disabled = false;
    if (error) { $('loginErr').textContent = error.message; return; }
    enter(data.user);
  });
  $('logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut(); clearInterval(state.timer); location.reload();
  });

  /* ---------- routing ---------- */
  function route() {
    const tab = (location.hash || '#overview').slice(1);
    state.tab = TITLES[tab] ? tab : 'overview';
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === state.tab));
    document.querySelectorAll('main section').forEach(s => s.classList.toggle('hidden', s.id !== 'tab-' + state.tab));
    $('title').textContent = TITLES[state.tab][0]; $('subtitle').textContent = TITLES[state.tab][1];
    load();
  }
  window.addEventListener('hashchange', () => { if (state.me) route(); });
  $('refreshBtn').addEventListener('click', load);
  function startTimer() {
    clearInterval(state.timer);
    state.timer = setInterval(() => { if ($('auto').checked && !document.hidden) load(true); }, 60000);
  }

  async function load(silent) {
    try {
      if (state.tab === 'overview') await loadOverview();
      else if (state.tab === 'businesses') await loadBusinesses();
      else if (state.tab === 'users') await loadUsers();
      else if (state.tab === 'errors') await loadErrors();
      else if (state.tab === 'audit') await loadAudit();
      $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (err) { if (!silent) toast(err.message); $('updated').textContent = 'Update failed'; }
  }

  /* ---------- overview ---------- */
  function kpi(label, value, detail, warn) {
    return `<div class="kpi ${warn ? 'warn' : ''}"><div class="l">${label}</div><div class="v num">${value}</div><div class="d">${detail || '&nbsp;'}</div></div>`;
  }
  function bars(el, axisEl, rows, key, alt, fmt) {
    const max = Math.max(1, ...rows.map(r => Number(r[key])));
    $(el).innerHTML = rows.map(r => `<div class="b ${alt ? 'alt' : ''}" style="height:${Math.max(1.5, Number(r[key]) / max * 100)}%" title="${dt(r.day)}: ${fmt(r[key])}"></div>`).join('');
    $(axisEl).innerHTML = `<span>${dt(rows[0]?.day)}</span><span>${dt(rows[rows.length - 1]?.day)}</span>`;
  }
  async function loadOverview() {
    const t0 = performance.now();
    const days = Number($('range').value);
    const [o, daily, feed] = await Promise.all([rpc('admin_overview'), rpc('admin_daily', { p_days: days }), rpc('admin_activity', { p_limit: 25 })]);
    const latency = Math.round(performance.now() - t0);
    $('kpis').innerHTML = [
      kpi('Users', num(o.users), `+${num(o.users_7d)} this week`),
      kpi('Businesses', num(o.businesses), `+${num(o.businesses_7d)} this week`),
      kpi('Active businesses (30d)', num(o.active_30d), `${o.businesses ? Math.round(o.active_30d / o.businesses * 100) : 0}% of all`),
      kpi('Sales volume (30d)', naira(o.sales_30d_volume), `${num(o.sales_30d_count)} sales`),
      kpi('Total sales volume', naira(o.sales_volume), `${num(o.sales_count)} sales all-time`),
      kpi('Outstanding debt', naira(o.outstanding_debt), 'owed by customers'),
      kpi('Expenses recorded', naira(o.expenses_volume), ''),
      kpi('Customers / Products', `${num(o.customers)} / ${num(o.products)}`, 'across all businesses'),
      kpi('Errors (24h)', num(o.errors_24h), o.errors_24h ? 'check the Errors tab' : 'all quiet', o.errors_24h > 0),
      kpi('Unconfirmed emails', num(o.users_unconfirmed), 'signed up, not verified', o.users_unconfirmed > 5),
      kpi('Suspended businesses', num(o.suspended), ''),
      kpi('Database size', bytes(o.db_size_bytes), 'Free plan limit: 500 MB'),
      kpi('File storage', bytes(o.storage_bytes), `${num(o.storage_files)} files · limit 1 GB`),
    ].join('');
    bars('chartSales', 'axisSales', daily, 'sales_volume', false, naira);
    const tot = daily.reduce((t, r) => t + Number(r.sales_volume), 0), cnt = daily.reduce((t, r) => t + Number(r.sales_count), 0);
    $('salesNote').textContent = `${naira(tot)} across ${num(cnt)} sales in the last ${days} days`;
    bars('chartSignups', 'axisSignups', daily, 'signups', true, v => v + ' signups');

    const colors = { free: '#8A9490', pro: '#0B6E5C', business: '#2B5A8C' };
    const plans = o.plans || {}, totalB = Object.values(plans).reduce((a, b) => a + Number(b), 0) || 1;
    $('planbar').innerHTML = Object.entries(plans).map(([p, c]) => `<span style="width:${c / totalB * 100}%;background:${colors[p] || '#ccc'}"></span>`).join('');
    $('planLegend').innerHTML = Object.entries(plans).map(([p, c]) => `<span><i style="background:${colors[p] || '#ccc'}"></i>${esc(p)} · ${c}</span>`).join('') || '<span>No businesses yet</span>';

    $('health').innerHTML = [
      ['Database', `<span class="badge b-green">Reachable</span>`],
      ['API round-trip', `<span class="badge ${latency < 800 ? 'b-green' : latency < 2000 ? 'b-amber' : 'b-red'}">${latency} ms</span>`],
      ['Errors in last 24h', `<span class="badge ${o.errors_24h ? 'b-red' : 'b-green'}">${num(o.errors_24h)}</span>`],
      ['Database usage', `<span class="badge ${o.db_size_bytes > 4e8 ? 'b-red' : o.db_size_bytes > 3e8 ? 'b-amber' : 'b-green'}">${Math.round(o.db_size_bytes / 5e6)}% of 500 MB</span>`],
      ['Storage usage', `<span class="badge ${o.storage_bytes > 8e8 ? 'b-red' : o.storage_bytes > 6e8 ? 'b-amber' : 'b-green'}">${Math.round(o.storage_bytes / 1e7)}% of 1 GB</span>`],
    ].map(([k, v]) => `<div class="feed"><div class="it"><span>${k}</span><span class="t" style="margin-left:auto">${v}</span></div></div>`).join('');

    const icon = { signup: ['👤', 'var(--blue-tint)'], business: ['🏪', 'var(--accent-tint)'], sale: ['🧾', 'var(--amber-tint)'] };
    $('feed').innerHTML = feed.length ? feed.map(f => `<div class="it"><div class="dot" style="background:${(icon[f.kind] || icon.sale)[1]}">${(icon[f.kind] || icon.sale)[0]}</div>
      <div class="lb"><b>${f.kind === 'signup' ? 'New signup' : f.kind === 'business' ? 'New business' : 'Sale'}</b> · ${esc(f.label)}</div><div class="t">${ago(f.at)}</div></div>`).join('') : '<div class="empty">No activity yet</div>';
    setErrPill(o.errors_24h);
  }
  $('range').addEventListener('change', loadOverview);
  function setErrPill(n) { const p = $('errPill'); p.textContent = n; p.classList.toggle('hidden', !n); }

  /* ---------- businesses ---------- */
  async function loadBusinesses() { state.businesses = await rpc('admin_businesses'); renderBusinesses(); }
  function renderBusinesses() {
    const q = $('bizSearch').value.toLowerCase().trim(), f = $('bizFilter').value, cutoff = Date.now() - 30 * 864e5;
    const rows = state.businesses.filter(b => {
      const hay = [b.name, b.owner_name, b.owner_email, b.type].join(' ').toLowerCase();
      const active = b.last_sale && new Date(b.last_sale) > cutoff;
      return (!q || hay.includes(q)) && (f === 'all' || (f === 'active' && active) || (f === 'inactive' && !active) || (f === 'suspended' && b.suspended) || b.plan === f);
    });
    $('bizBody').innerHTML = rows.length ? rows.map(b => `<tr>
      <td><b>${esc(b.name)}</b><div class="sub2">${esc(b.type || '')}</div></td>
      <td>${esc(b.owner_name || '—')}<div class="sub2">${esc(b.owner_email || '')}</div></td>
      <td><select data-plan="${b.id}" style="width:auto;padding:5px 8px;font-size:12.5px">${['free', 'pro', 'business'].map(p => `<option ${p === b.plan ? 'selected' : ''}>${p}</option>`).join('')}</select></td>
      <td class="num">${num(b.members)}</td><td class="num">${num(b.customers)}</td><td class="num">${num(b.products)}</td>
      <td class="num">${num(b.sales_count)}</td><td class="num">${naira(b.sales_volume)}</td>
      <td>${b.last_sale ? ago(b.last_sale) : '<span class="sub2">never</span>'}</td><td>${dt(b.created_at)}</td>
      <td>${b.suspended ? `<span class="badge b-red" title="${esc(b.suspended_reason || '')}">Suspended</span>` : '<span class="badge b-green">Active</span>'}</td>
      <td style="white-space:nowrap"><button class="btn ${b.suspended ? 'sec' : 'danger'} sm" data-susp="${b.id}">${b.suspended ? 'Unsuspend' : 'Suspend'}</button></td></tr>`).join('')
      : '<tr><td colspan="12" class="empty">No businesses match</td></tr>';
  }
  ['bizSearch', 'bizFilter'].forEach(id => $(id).addEventListener('input', renderBusinesses));
  $('bizBody').addEventListener('change', async e => {
    const id = e.target.dataset.plan; if (!id) return;
    try { await rpc('admin_set_plan', { p_business: id, p_plan: e.target.value }); toast('Plan updated'); loadBusinesses(); }
    catch (err) { toast(err.message); loadBusinesses(); }
  });
  $('bizBody').addEventListener('click', async e => {
    const id = e.target.dataset.susp; if (!id) return;
    const b = state.businesses.find(x => x.id === id);
    try {
      if (b.suspended) { if (!confirm(`Unsuspend ${b.name}?`)) return; await rpc('admin_set_suspended', { p_business: id, p_suspended: false }); }
      else {
        const reason = prompt(`Suspend ${b.name}? They will become read-only.\n\nReason (shown to them):`, 'Policy violation');
        if (reason === null) return;
        await rpc('admin_set_suspended', { p_business: id, p_suspended: true, p_reason: reason });
      }
      toast('Done'); loadBusinesses();
    } catch (err) { toast(err.message); }
  });
  $('bizCsv').addEventListener('click', () => csv('recorda_businesses.csv', state.businesses.map(b => ({
    name: b.name, type: b.type, plan: b.plan, owner: b.owner_name, owner_email: b.owner_email, members: b.members, customers: b.customers,
    products: b.products, sales: b.sales_count, volume: b.sales_volume, last_sale: b.last_sale, created: b.created_at, suspended: b.suspended }))));

  /* ---------- users ---------- */
  async function loadUsers() { state.users = await rpc('admin_users'); renderUsers(); }
  function renderUsers() {
    const q = $('userSearch').value.toLowerCase().trim(), f = $('userFilter').value;
    const rows = state.users.filter(u => {
      const hay = [u.full_name, u.email, u.phone].join(' ').toLowerCase();
      return (!q || hay.includes(q)) && (f === 'all' || (f === 'unconfirmed' && !u.confirmed) || (f === 'nobiz' && !Number(u.businesses)) || (f === 'admins' && u.is_admin));
    });
    $('userBody').innerHTML = rows.length ? rows.map(u => `<tr>
      <td><b>${esc(u.full_name || '—')}</b> ${u.is_admin ? '<span class="badge b-blue">admin</span>' : ''}<div class="sub2">${esc(u.email)}</div></td>
      <td>${esc(u.phone || '—')}</td><td class="num">${num(u.businesses)}</td>
      <td>${u.confirmed ? '<span class="badge b-green">Confirmed</span>' : '<span class="badge b-amber">Unconfirmed</span>'}</td>
      <td>${u.last_sign_in_at ? ago(u.last_sign_in_at) : '<span class="sub2">never</span>'}</td><td>${dt(u.created_at)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No users match</td></tr>';
  }
  ['userSearch', 'userFilter'].forEach(id => $(id).addEventListener('input', renderUsers));
  $('userCsv').addEventListener('click', () => csv('recorda_users.csv', state.users.map(u => ({
    name: u.full_name, email: u.email, phone: u.phone, businesses: u.businesses, confirmed: u.confirmed, last_sign_in: u.last_sign_in_at, joined: u.created_at }))));

  /* ---------- errors ---------- */
  async function loadErrors() {
    const rows = await rpc('admin_errors', { p_limit: 100 });
    setErrPill(rows.filter(r => Date.now() - new Date(r.created_at) < 864e5).length);
    $('errList').innerHTML = rows.length ? `<table><thead><tr><th>When</th><th>Error</th><th>Page</th><th>User</th></tr></thead><tbody>` + rows.map(r => `<tr>
      <td style="white-space:nowrap">${dtt(r.created_at)}<div class="sub2">${ago(r.created_at)}</div></td>
      <td><div class="errmsg">${esc(r.message)}</div>${r.stack ? `<details><summary>Stack trace</summary><pre>${esc(r.stack)}</pre></details>` : ''}</td>
      <td>${esc(r.page || '')}</td><td>${esc(r.user_email || '—')}<div class="sub2">${esc((r.user_agent || '').slice(0, 60))}</div></td></tr>`).join('') + '</tbody></table>'
      : '<div class="empty">No errors reported. 🎉</div>';
  }
  $('clearErrors').addEventListener('click', async () => {
    if (!confirm('Delete all error reports?')) return;
    try { await rpc('admin_clear_errors'); toast('Cleared'); loadErrors(); } catch (err) { toast(err.message); }
  });

  /* ---------- audit ---------- */
  async function loadAudit() {
    const { data, error } = await sb.from('admin_audit').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    $('auditBody').innerHTML = data.length ? data.map(a => `<tr><td style="white-space:nowrap">${dtt(a.created_at)}</td><td>${esc(a.admin_email || '')}</td>
      <td><span class="badge b-gray">${esc(a.action)}</span></td><td class="sub2">${esc(a.target || '')}</td><td class="sub2">${esc(a.details ? JSON.stringify(a.details) : '')}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">No admin actions yet</td></tr>';
  }

  /* ---------- boot ---------- */
  (async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) enter(session.user);
  })();
})();
