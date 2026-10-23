// Order History (Phase 4) + Analytics (Phase 5): the logged-in shop's own web orders from the last 90 days
// (Member.gs 'history'), with a summary worked out here from the same orders: totals, spend per week, by category, top products.
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
      statsTitle: 'ภาพรวมการสั่งซื้อ',
      kTotal: 'ยอดสั่งรวม',
      kOrders: 'ออเดอร์',
      kAvg: 'เฉลี่ย/ครั้ง',
      weekly: 'ยอดสั่งรายสัปดาห์',
      weekRead: (range, amt, n) => `สัปดาห์ ${range} · ฿${amt} · ${n} ออเดอร์`,
      weekNone: (range) => `สัปดาห์ ${range} · ไม่มีออเดอร์`,
      weekBar: (range, amt) => `สัปดาห์ ${range}: ฿${amt}`,
      cats: 'แยกตามหมวด',
      catName: { pork: 'หมู', chicken: 'ไก่', egg: 'ไข่', fish: 'ปลา', other: 'อื่นๆ' },
      top: 'สินค้าที่สั่งมากที่สุด',
      topQty: (q, u) => `รวม ${q} ${u}`,
      note: 'ยอดตามราคาตอนสั่ง ไม่ใช่ยอดที่ส่งจริง',
      capped: (n) => ` · นับจาก ${n} ออเดอร์ล่าสุด`,
      ordersTitle: 'ออเดอร์ทั้งหมด',
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
      statsTitle: 'Your buying at a glance',
      kTotal: 'Total ordered',
      kOrders: 'Orders',
      kAvg: 'Average order',
      weekly: 'Spend per week',
      weekRead: (range, amt, n) => `Week ${range} · ฿${amt} · ${n === 1 ? '1 order' : `${n} orders`}`,
      weekNone: (range) => `Week ${range} · no orders`,
      weekBar: (range, amt) => `Week ${range}: ฿${amt}`,
      cats: 'By category',
      catName: { pork: 'Pork', chicken: 'Chicken', egg: 'Eggs', fish: 'Fish', other: 'Other' },
      top: 'Most ordered',
      topQty: (q, u) => `${q} ${u} in all`,
      note: 'At the price when ordered, not what was delivered.',
      capped: (n) => ` · From your latest ${n} orders.`,
      ordersTitle: 'All orders',
      unit: (u, n) => ({ kg: 'kg', tray: n === 1 ? 'tray' : 'trays', pack: n === 1 ? 'pack' : 'packs' }[u] || u),
      status: {
        New: 'Waiting for the shop', Received: 'Received', Packed: 'Packed', Out: 'On the way',
        Delivered: 'Delivered', Issue: "Problem — we'll contact you",
      },
    },
  };
  // Pill look per DIFOT status (styles.css .pill--*); anything else gets the plain look.
  const STATUS_LOOK = { New: 'wait', Received: 'wait', Packed: 'wait', Out: 'out', Delivered: 'done', Issue: 'issue' };

  const state = { lang: pickLanguage(), config: {}, member: loadMember(), catalog: new Map(), result: null, error: '', loading: true, week: null };
  const $ = (id) => document.getElementById(id);

  function storageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }
  function tabGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
  function tabSet(k, v) { try { sessionStorage.setItem(k, v); } catch (_) { /* private mode */ } }

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
    try { m = JSON.parse(storageGet(STORE) || tabGet(STORE) || 'null'); } catch (_) { m = null; }   // 'remember me' off = tab only
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

  // ---------- analytics (Phase 5) ----------
  // Weeks start on Monday, Bangkok time. A day is kept as ms at UTC midnight of its Bangkok date, so day maths
  // never shift by the phone's own time zone.
  const DAY = 24 * 3600 * 1000;
  const SKU_CATEGORY = { PK: 'pork', CK: 'chicken', EG: 'egg', FS: 'fish' };   // same rule as Code.gs categoryOf_
  const bkkDay = (ms) => Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms))}T00:00:00Z`);
  const weekOf = (day) => day - ((new Date(day).getUTCDay() + 6) % 7) * DAY;
  function weekRange(start, t) {
    const f = (ms, month) => new Intl.DateTimeFormat(t.locale, { timeZone: 'UTC', day: 'numeric', month }).format(new Date(ms));
    const end = start + 6 * DAY;
    const sameMonth = new Date(start).getUTCMonth() === new Date(end).getUTCMonth();
    return sameMonth ? `${f(start)}–${f(end, 'short')}` : `${f(start, 'short')} – ${f(end, 'short')}`;
  }

  function summarise(orders, days) {
    const today = bkkDay(Date.now());
    const dated = orders.map((o) => ({ o, day: bkkDay(Date.parse(o.ordered_at)) })).filter((x) => !Number.isNaN(x.day));
    // From the week the 90 days start in (or the oldest order shown, when the list was cut at 50) to this week.
    const capped = orders.length >= 50;
    const from = capped && dated.length ? Math.min(...dated.map((x) => x.day)) : today - (days - 1) * DAY;
    const weeks = [];
    for (let w = weekOf(from); w <= weekOf(today); w += 7 * DAY) weeks.push({ start: w, total: 0, orders: 0 });
    const cats = {};
    const products = new Map();
    let total = 0;
    dated.forEach(({ o, day }) => {
      total += o.total;
      const week = weeks.find((w) => w.start === weekOf(day));
      if (week) { week.total += o.total; week.orders += 1; }
      o.items.forEach((it) => {
        const cat = SKU_CATEGORY[String(it.sku).slice(0, 2)] || 'other';
        cats[cat] = (cats[cat] || 0) + it.line_total;
        const p = products.get(it.sku) || { sku: it.sku, name_th: it.name_th, unit: it.qty_unit, qty: 0, total: 0 };
        p.qty += it.qty;
        p.total += it.line_total;
        products.set(it.sku, p);
      });
    });
    const catTotal = Object.values(cats).reduce((a, b) => a + b, 0);
    return {
      total, count: dated.length, avg: dated.length ? total / dated.length : 0, weeks, capped,
      cats: Object.entries(cats).map(([cat, sum]) => ({ cat, sum, share: catTotal ? sum / catTotal : 0 })).sort((a, b) => b.sum - a.sum),
      top: [...products.values()].sort((a, b) => b.total - a.total).slice(0, 5),
    };
  }

  function renderStats(orders, t) {
    const box = $('h-stats');
    box.hidden = !orders || !orders.length;
    if (box.hidden) return;
    const s = summarise(orders, (state.result && state.result.days) || 90);
    $('k-total').textContent = `฿${money(Math.round(s.total), t)}`;
    $('k-orders').textContent = money(s.count, t);
    $('k-avg').textContent = `฿${money(Math.round(s.avg), t)}`;

    // One bar per week, height = that week's spend. Tap a bar to read it; this week is read first.
    const max = Math.max(...s.weeks.map((w) => w.total), 1);
    if (state.week == null || !s.weeks.some((w) => w.start === state.week)) state.week = s.weeks[s.weeks.length - 1].start;
    const read = (w) => (w.orders ? t.weekRead(weekRange(w.start, t), money(w.total, t), w.orders) : t.weekNone(weekRange(w.start, t)));
    const bars = s.weeks.map((w) => {
      const b = el('button', `wk${w.start === state.week ? ' is-on' : ''}${w.total ? '' : ' is-zero'}`);
      b.type = 'button';
      b.setAttribute('aria-label', t.weekBar(weekRange(w.start, t), money(w.total, t)));
      b.setAttribute('aria-pressed', String(w.start === state.week));
      const bar = el('span', 'wk__bar');
      bar.style.height = `${w.total ? Math.max((w.total / max) * 100, 3) : 0}%`;   // CSSOM, allowed by the page's CSP
      b.append(bar);
      b.addEventListener('click', () => {   // only the summary is redrawn, so open order cards stay open
        state.week = w.start;
        renderStats(orders, t);
        $('w-bars').querySelector('.is-on').focus();
      });
      return b;
    });
    $('w-bars').replaceChildren(...bars);
    $('w-read').textContent = read(s.weeks.find((w) => w.start === state.week));
    // Axis: first, middle and this week's dates under their bars.
    const ticks = [0, Math.floor((s.weeks.length - 1) / 2), s.weeks.length - 1];
    $('w-axis').replaceChildren(...s.weeks.map((w, i) => el('span', null, ticks.includes(i)
      ? new Intl.DateTimeFormat(t.locale, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(w.start)) : '')));

    $('cats').replaceChildren(...s.cats.map((c) => {
      const li = el('li', 'cat');
      const track = el('span', 'cat__track');
      const fill = el('span', 'cat__fill');
      fill.style.width = `${Math.max(c.share * 100, 1)}%`;
      track.append(fill);
      li.append(el('span', 'cat__name', t.catName[c.cat]), track,
        el('span', 'cat__val', `฿${money(Math.round(c.sum), t)} · ${Math.round(c.share * 100)}%`));
      return li;
    }));

    $('top').replaceChildren(...s.top.map((p) => {
      const li = el('li', 'top__item');
      const img = el('img', 'hist__img');
      img.alt = '';
      img.loading = 'lazy';
      const c = state.catalog.get(p.sku);
      if (c && /^assets\/products\/[A-Z]{2}-\d{3}\.webp$/.test(c.image || '')) img.src = c.image;
      const text = el('div', 'hist__name');
      text.append(el('span', null, (state.lang === 'en' && c && c.name_en) || p.name_th || p.sku),
        el('span', 'hist__each', t.topQty(money(p.qty, t), t.unit(p.unit, p.qty))));
      li.append(img, text, el('span', 'hist__amount', `฿${money(Math.round(p.total), t)}`));
      return li;
    }));
    $('stats-note').textContent = t.note + (s.capped ? t.capped(orders.length) : '');
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
    $('h-head').hidden = list.hidden;
    renderStats(orders, t);
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
      storageSet(STORE, '');   // reset, closed or expired: the menu shows the shop as logged out too
      tabSet(STORE, '');
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
