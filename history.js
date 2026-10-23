// Order History (Phase 4): the logged-in shop's own web orders from the last 90 days (Member.gs 'history').
// Needs the session saved by member.html (localStorage 'menu-member'); a shop QR never opens this page.
// "Order again" hands [sku, qty] pairs to app.js through localStorage 'menu-reorder'; the menu puts them in the cart
// at this week's prices and skips what is no longer sold. Everything shown is set with textContent.
'use strict';

(function () {
  const TIMEOUT_MS = 30000;   // an Apps Script cold start plus reading the Order sheet
  const STORE = 'menu-member';
  const REORDER = 'menu-reorder';
  const TZ = 'Asia/Bangkok';

  const TEXT = {
    th: {
      locale: 'th-TH',
      backToMenu: 'กลับไปหน้าเมนู',
      title: 'ประวัติการสั่งซื้อ',
      sub: (shop, days) => `${shop} · ย้อนหลัง ${days} วัน`,
      loading: 'กำลังโหลดออเดอร์…',
      login: 'เข้าสู่ระบบร้านค้า',
      retry: 'ลองอีกครั้ง',
      notIn: 'ดูประวัติการสั่งซื้อได้เมื่อเข้าสู่ระบบร้านค้า',
      expired: 'หมดเวลาเข้าสู่ระบบของร้าน เข้าสู่ระบบอีกครั้งเพื่อดูประวัติ',
      empty: (days) => `ยังไม่มีออเดอร์ใน ${days} วันที่ผ่านมา`,
      network: 'เชื่อมต่อไม่ได้ ตรวจเน็ตแล้วลองใหม่',
      server: 'ระบบขัดข้อง ลองใหม่อีกครั้ง',
      off: 'ระบบสมาชิกยังไม่เปิดใช้',
      limit: 'แสดงเฉพาะออเดอร์ที่สั่งผ่านเว็บตอนเข้าสู่ระบบ หรือผ่าน QR ของร้าน ไม่รวมออเดอร์ทาง LINE หรือที่หน้าร้าน ราคาเป็นราคาตอนสั่ง',
      lines: (n) => `${n} รายการ`,
      deliver: (d) => `ส่ง ${d}`,
      each: (q, u, p) => `${q} ${u} × ฿${p}`,
      again: 'สั่งอีกครั้ง',
      details: 'ดูรายการ',
      unit: (u) => ({ kg: 'กก.', tray: 'แผง', pack: 'แพ็ก' }[u] || u),
      status: {
        New: 'รอร้านยืนยัน', Received: 'รับออเดอร์แล้ว', Packed: 'จัดของแล้ว', Out: 'กำลังไปส่ง',
        Delivered: 'ส่งแล้ว', Issue: 'มีปัญหา ร้านจะติดต่อกลับ',
      },
    },
    en: {
      locale: 'en-GB',
      backToMenu: 'Back to menu',
      title: 'Order history',
      sub: (shop, days) => `${shop} · last ${days} days`,
      loading: 'Loading orders…',
      login: 'Shop login',
      retry: 'Try again',
      notIn: 'Log in as a shop to see your order history.',
      expired: 'Your shop login has ended. Log in again to see your history.',
      empty: (days) => `No orders in the last ${days} days yet.`,
      network: "Can't connect. Check your internet and try again.",
      server: 'Something went wrong. Please try again.',
      off: 'Shop accounts are not open yet.',
      limit: 'Shows web orders placed while logged in or with your shop QR. LINE and counter orders are not included. Prices are what you paid at the time.',
      lines: (n) => (n === 1 ? '1 item' : `${n} items`),
      deliver: (d) => `delivery ${d}`,
      each: (q, u, p) => `${q} ${u} × ฿${p}`,
      again: 'Order again',
      details: 'Show items',
      unit: (u, n) => ({ kg: 'kg', tray: n === 1 ? 'tray' : 'trays', pack: n === 1 ? 'pack' : 'packs' }[u] || u),
      status: {
        New: 'Waiting for the shop', Received: 'Received', Packed: 'Packed', Out: 'On the way',
        Delivered: 'Delivered', Issue: "Problem — we'll contact you",
      },
    },
  };
  // Pill look per DIFOT status (styles.css .pill--*); anything else gets the plain look.
  const STATUS_LOOK = { New: 'wait', Received: 'wait', Packed: 'wait', Out: 'out', Delivered: 'done', Issue: 'issue' };

  const state = { lang: pickLanguage(), config: {}, member: loadMember(), catalog: new Map(), result: null, error: '', loading: true };
  const $ = (id) => document.getElementById(id);

  function storageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }

  function pickLanguage() {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'th' || q === 'en') return q;
    const saved = storageGet('menu-lang');
    if (saved === 'th' || saved === 'en') return saved;
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    return nav.toLowerCase().startsWith('th') ? 'th' : 'en';
  }

  function loadMember() {
    let m = null;
    try { m = JSON.parse(storageGet(STORE) || 'null'); } catch (_) { m = null; }
    return m && /^[0-9a-f]{64}$/.test(m.token || '') && typeof m.name === 'string' && m.name ? m : null;
  }

  async function getJson(path) {
    for (const wait of [0, 800, 2000]) {
      if (wait) await new Promise((r) => { setTimeout(r, wait); });
      try {
        const res = await fetch(path, { cache: 'no-cache' });
        if (res.ok) return res.json();
        if (res.status === 404) break;
      } catch (_) { /* try again */ }
    }
    return null;
  }

  // Same request shape as orders (text/plain: Apps Script cannot answer a CORS preflight).
  async function post(body) {
    const url = String(state.config.order_endpoint || '').trim();
    if (!url) return { ok: false, error: 'off' };
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : 0;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctl ? ctl.signal : undefined,
      });
      const data = await res.json();
      return data && typeof data === 'object' ? data : { ok: false, error: 'server' };
    } catch (_) {
      return { ok: false, error: 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- formatting ----------
  const money = (n, t) => new Intl.NumberFormat(t.locale, { maximumFractionDigits: 2 }).format(n);
  function when(iso, t) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const day = new Intl.DateTimeFormat(t.locale, { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
    return `${day} · ${time}`;
  }
  function deliveryDay(text, t) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '');
    if (!m) return text || '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 5));   // noon in Bangkok: no day shift in any time zone
    return new Intl.DateTimeFormat(t.locale, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  }
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  // ---------- render ----------
  function render() {
    const t = TEXT[state.lang];
    document.documentElement.lang = state.lang;
    document.title = `${t.title} · Betagro Shop`;
    document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
    document.querySelectorAll('[data-t]').forEach((n) => { if (typeof t[n.dataset.t] === 'string') n.textContent = t[n.dataset.t]; });
    const name = (k) => String(state.config[k] || '').replace(/^\s*Betagro Shop\s*/i, '');
    $('shop-branch').textContent = name(state.lang === 'th' ? 'shop_name_th' : 'shop_name_en');

    const days = (state.result && state.result.days) || 90;
    $('h-sub').textContent = state.member ? t.sub(state.member.name, days) : '';
    $('h-sub').hidden = !state.member;
    $('h-loading').hidden = !state.loading;

    const orders = state.result ? state.result.orders : null;
    let message = '';
    if (!state.member) message = state.error === 'session' ? t.expired : t.notIn;
    else if (state.error) message = t[state.error] || t.server;
    else if (orders && !orders.length) message = t.empty(days);
    $('h-message').textContent = message;
    $('h-message').hidden = !message;
    $('h-login').hidden = Boolean(state.member);
    $('h-retry').hidden = !(state.member && state.error && state.error !== 'off');

    const list = $('h-list');
    list.replaceChildren(...(orders || []).map((o) => orderCard(o, t)));
    list.hidden = !(orders && orders.length);
    $('h-limit').hidden = !state.member || state.loading;
  }

  function orderCard(o, t) {
    const li = el('li', 'hist');
    const top = el('div', 'hist__top');
    top.append(el('span', 'hist__date', when(o.ordered_at, t)));
    if (o.status) top.append(el('span', `pill pill--${STATUS_LOOK[o.status] || 'plain'}`, t.status[o.status] || o.status));
    const sum = el('p', 'hist__sum');
    sum.append(el('span', 'hist__total', `฿${money(o.total, t)}`), el('span', 'hist__count', t.lines(o.items.length)));
    const meta = el('p', 'hist__meta', [o.id, o.delivery_date ? t.deliver(deliveryDay(o.delivery_date, t)) : ''].filter(Boolean).join(' · '));

    const details = el('details', 'hist__details');
    details.append(el('summary', 'hist__toggle', t.details));
    const lines = el('ul', 'hist__lines');
    o.items.forEach((it) => {
      const p = state.catalog.get(it.sku);
      const row = el('li', 'hist__line');
      const img = el('img', 'hist__img');
      img.alt = '';
      img.loading = 'lazy';
      if (p && /^assets\/products\/[A-Z]{2}-\d{3}\.webp$/.test(p.image || '')) img.src = p.image;   // else an empty tile keeps the columns
      const text = el('div', 'hist__name');
      text.append(el('span', null, (state.lang === 'en' && p && p.name_en) || it.name_th || it.sku),
        el('span', 'hist__each', t.each(money(it.qty, t), t.unit(it.qty_unit, it.qty), money(it.unit_price, t))));
      row.append(img, text, el('span', 'hist__amount', `฿${money(it.line_total, t)}`));
      lines.append(row);
    });
    details.append(lines);

    const again = el('button', 'add-btn hist__again', t.again);
    again.type = 'button';
    again.addEventListener('click', () => orderAgain(o));
    li.append(top, sum, meta, details, again);
    return li;
  }

  function orderAgain(o) {
    const items = o.items.filter((it) => Number.isInteger(it.qty) && it.qty > 0).map((it) => [it.sku, it.qty]);
    storageSet(REORDER, JSON.stringify({ v: 1, id: o.id, items }));
    location.href = './';
  }

  // ---------- load ----------
  async function load() {
    state.loading = true;
    state.error = '';
    render();
    const res = await post({ contract: 'order.v1', action: 'history', token: state.member.token });
    state.loading = false;
    if (res.ok && Array.isArray(res.orders)) {
      state.result = res;
    } else if (res.error === 'session') {
      storageSet(STORE, '');   // reset, closed or 90 days: the menu shows the shop as logged out too
      state.member = null;
      state.error = 'session';
    } else {
      state.error = res.error === 'network' || res.error === 'off' ? res.error : 'server';
    }
    render();
  }

  async function boot() {
    document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
      state.lang = b.dataset.lang;
      storageSet('menu-lang', state.lang);
      render();
    }));
    $('h-retry').addEventListener('click', load);
    state.loading = Boolean(state.member);
    render();
    const [config, catalog] = await Promise.all([getJson('config.json'), getJson('data/catalog.json')]);
    state.config = config || {};
    ((catalog && catalog.products) || []).forEach((p) => state.catalog.set(p.sku, p));
    if (state.member) await load(); else render();
  }

  boot();
})();
