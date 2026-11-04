// Order History (Phase 4) + Analytics (Phase 5): the logged-in shop's own web orders from the last 90 days
// (Member.gs 'history'), with a summary worked out here from the same orders: totals, spend per week, by category, top products.
// Needs the session saved by member.html (localStorage 'menu-member'); a shop QR never opens this page.
// Complaints (2026-11-03): a delivered order can get "report a problem" for 7 days: reason, products, note, 1–3 photos
// (shrunk here to ≤1600 px JPEG) → Member.gs 'complain' → DIFOT Exception rows + order status Issue.
// "Order again" hands [sku, qty] pairs to app.js through localStorage 'menu-reorder'; the menu puts them in the cart
// at this week's prices and skips what is no longer sold. Everything shown is set with textContent.
'use strict';

(function () {
  const TIMEOUT_MS = 30000;   // an Apps Script cold start plus reading the Order sheet
  const UPLOAD_TIMEOUT_MS = 90000;   // a complaint carries photos: give a slow phone connection time
  const PHOTO_MAX = 3;
  const PHOTO_B64_MAX = 780000;      // ≈ 585 KB, under Member.gs PHOTO_MAX_BYTES (600 KB)
  const REASONS = ['RD-01', 'RD-02', 'RD-03', 'RD-04', 'RD-05', 'RD-06'];   // DIFOT Master, Type Reason_Delivery
  const REASON_OTHER = 'RD-06';      // "other" needs a note (Member.gs: a reason whose name says other)
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
      complain: 'แจ้งปัญหาสินค้า',
      complainMore: 'แจ้งปัญหาเพิ่ม',
      complainUntil: (d) => `แจ้งได้ถึง ${d}`,
      complained: (n) => `แจ้งปัญหาแล้ว ${n} เรื่อง · ร้านจะติดต่อกลับ`,
      cpTitle: 'แจ้งปัญหาออเดอร์',
      cpOrder: (id, d) => `${id} · สั่งเมื่อ ${d}`,
      cpWhy: 'ปัญหาที่พบ',
      reasons: { 'RD-01': 'ของขาด / ได้ไม่ครบ', 'RD-02': 'ได้ของผิด', 'RD-03': 'ของเสียหาย', 'RD-04': 'ของไม่เย็น', 'RD-05': 'ส่งช้า', 'RD-06': 'อื่นๆ' },
      cpWhat: 'สินค้าที่มีปัญหา',
      cpWhatHint: 'ไม่ต้องเลือก ถ้าเป็นปัญหาทั้งออเดอร์ เช่น ส่งช้า',
      cpPhotos: 'รูปถ่าย 1–3 รูป',
      cpPhotosHint: 'ถ่ายให้เห็นสินค้าและถุงหรือฉลาก ร้านจะตรวจได้เร็วขึ้น',
      cpAddPhoto: 'ถ่ายรูป / เลือกรูป',
      cpRemove: (n) => `ลบรูปที่ ${n}`,
      cpNote: 'รายละเอียดเพิ่มเติม (ไม่บังคับ)',
      cpNoteReq: 'รายละเอียด (จำเป็น)',
      cpSend: 'ส่งเรื่องให้ร้าน',
      cpSending: 'กำลังส่ง…',
      cpPreparing: 'กำลังเตรียมรูป…',
      cpPrivacy: 'รูปและข้อความเห็นเฉพาะพนักงานร้าน ใช้เพื่อแก้ปัญหาออเดอร์นี้เท่านั้น',
      cpNeedReason: 'เลือกปัญหาที่พบ',
      cpNeedNote: 'เขียนรายละเอียดสั้นๆ ว่าเกิดอะไรขึ้น',
      cpNeedPhoto: 'แนบรูปอย่างน้อย 1 รูป',
      cpPhotoBad: 'ใช้รูปนี้ไม่ได้ ลองถ่ายใหม่หรือเลือกรูปอื่น',
      cpTooMany: 'แนบได้สูงสุด 3 รูป',
      cpClosed: 'ออเดอร์นี้แจ้งปัญหาทางเว็บไม่ได้แล้ว ทักร้านทาง LINE ได้เลย',
      cpRate: 'แจ้งปัญหาครบจำนวนแล้ว ทักร้านทาง LINE ได้เลย',
      cpDoneTitle: 'ส่งเรื่องให้ร้านแล้ว',
      cpDoneBody: (id) => `เลขที่เรื่อง ${id} · ร้านจะตรวจสอบและติดต่อกลับ`,
      cpOk: 'ตกลง',
      cpClose: 'ปิด',
      unit: (u) => ({ kg: 'กก.', tray: 'แผง', pack: 'แพ็ก' }[u] || u),
      status: {
        New: 'รอร้านยืนยัน', Received: 'รับออเดอร์แล้ว', Accepted: 'รับออเดอร์แล้ว', Rejected: 'ร้านรับออเดอร์ไม่ได้ ร้านจะติดต่อกลับ',
        Packed: 'จัดของแล้ว', Out: 'กำลังไปส่ง',
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
      complain: 'Report a problem',
      complainMore: 'Report another problem',
      complainUntil: (d) => `until ${d}`,
      complained: (n) => `${n === 1 ? '1 problem' : `${n} problems`} reported · the shop will contact you`,
      cpTitle: 'Report a problem',
      cpOrder: (id, d) => `${id} · ordered ${d}`,
      cpWhy: 'What went wrong?',
      reasons: { 'RD-01': 'Missing / short', 'RD-02': 'Wrong item', 'RD-03': 'Damaged', 'RD-04': 'Not cold', 'RD-05': 'Late delivery', 'RD-06': 'Other' },
      cpWhat: 'Which products?',
      cpWhatHint: 'Leave empty if it is about the whole order, e.g. late delivery.',
      cpPhotos: '1–3 photos',
      cpPhotosHint: 'Show the product and its bag or label, so the shop can check quickly.',
      cpAddPhoto: 'Take / choose photo',
      cpRemove: (n) => `Remove photo ${n}`,
      cpNote: 'More details (optional)',
      cpNoteReq: 'Details (needed)',
      cpSend: 'Send to the shop',
      cpSending: 'Sending…',
      cpPreparing: 'Preparing photos…',
      cpPrivacy: 'Only shop staff see the photos and text, and only to sort out this order.',
      cpNeedReason: 'Choose what went wrong.',
      cpNeedNote: 'Write a few words about what happened.',
      cpNeedPhoto: 'Add at least 1 photo.',
      cpPhotoBad: "This photo can't be used. Take it again or choose another one.",
      cpTooMany: 'Up to 3 photos.',
      cpClosed: "This order can't take a problem report on the web any more. Message the shop on LINE.",
      cpRate: 'This order already has the most reports allowed. Message the shop on LINE.',
      cpDoneTitle: 'Sent to the shop',
      cpDoneBody: (id) => `Reference ${id} · the shop will check and contact you.`,
      cpOk: 'OK',
      cpClose: 'Close',
      unit: (u, n) => ({ kg: 'kg', tray: n === 1 ? 'tray' : 'trays', pack: n === 1 ? 'pack' : 'packs' }[u] || u),
      status: {
        New: 'Waiting for the shop', Received: 'Received', Accepted: 'Received', Rejected: "Can't be filled, we'll contact you",
        Packed: 'Packed', Out: 'On the way',
        Delivered: 'Delivered', Issue: "Problem — we'll contact you",
      },
    },
  };
  // Pill look per DIFOT status (styles.css .pill--*); anything else gets the plain look.
  // Accepted / Rejected: the real DIFOT app's names (2026-11-04); Received: orders from the old sandbox.
  const STATUS_LOOK = { New: 'wait', Received: 'wait', Accepted: 'wait', Packed: 'wait', Out: 'out', Delivered: 'done', Issue: 'issue', Rejected: 'issue' };

  // Japanese, Chinese, Korean and Hindi from i18n.js, over English so a missing text shows in English.
  const I18N = window.SM_I18N || null;
  if (I18N) Object.keys(I18N.history).forEach((l) => {
    const x = I18N.history[l];
    TEXT[l] = { ...TEXT.en, ...x, status: { ...TEXT.en.status, ...x.status }, catName: { ...TEXT.en.catName, ...x.catName },
      reasons: { ...TEXT.en.reasons, ...x.reasons } };
  });

  const state = { lang: pickLanguage(), config: {}, member: loadMember(), catalog: new Map(), result: null, error: '', loading: true, week: null, cp: null };
  const $ = (id) => document.getElementById(id);

  function storageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }
  function tabGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
  function tabSet(k, v) { try { sessionStorage.setItem(k, v); } catch (_) { /* private mode */ } }

  function pickLanguage() {
    const q = new URLSearchParams(location.search).get('lang');
    const saved = storageGet('menu-lang');
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    const lang = window.SM_I18N ? window.SM_I18N.pick(q, saved, nav) : [q, saved].find((l) => l === 'th' || l === 'en');
    return lang || (nav.toLowerCase().startsWith('th') ? 'th' : 'en');
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
  async function post(body, timeout = TIMEOUT_MS) {
    const url = String(state.config.order_endpoint || '').trim();
    if (!url) return { ok: false, error: 'off' };
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : 0;
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
    const end = start + 6 * DAY;
    // ja / zh write their own (Intl gives 10/19～10/25); they take local dates, so rebuild them from the UTC day.
    const local = (ms) => { const d = new Date(ms); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
    if (t.dayRange) return t.dayRange(local(start), local(end));
    const f = new Intl.DateTimeFormat(t.locale, { timeZone: 'UTC', day: 'numeric', month: t.dateMonth || 'short' });
    if (typeof f.formatRange === 'function') return f.formatRange(new Date(start), new Date(end));
    return `${f.format(new Date(start))} – ${f.format(new Date(end))}`;
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
      text.append(...productName(c, p.name_th || p.sku),
        el('span', 'hist__each', t.topQty(money(p.qty, t), t.unit(p.unit, p.qty))));
      li.append(img, text, el('span', 'hist__amount', `฿${money(Math.round(p.total), t)}`));
      return li;
    }));
    $('stats-note').textContent = t.note + (s.capped ? t.capped(orders.length) : '');
  }

  // Product name in the chosen language from the catalog (the order line only keeps Thai). In Japanese, Chinese,
  // Korean and Hindi the English name goes under it, as on the menu.
  function productName(p, thai) {
    if (state.lang === 'th' || !p) return [el('span', null, thai)];
    const main = el('span', null, p['name_' + state.lang] || p.name_en || thai);
    if (state.lang === 'en' || !p['name_' + state.lang] || !p.name_en) return [main];
    const alt = el('span', 'hist__alt', p.name_en);
    alt.lang = 'en';
    return [main, alt];
  }

  // ---------- render ----------
  function render() {
    const t = TEXT[state.lang];
    document.documentElement.lang = state.lang;
    document.title = `${t.title} · Betagro Shop`;
    $('lang-select').value = state.lang;
    $('lang-now').textContent = (I18N && I18N.short[state.lang]) || (state.lang === 'th' ? 'ไทย' : 'EN');
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
    renderComplaint();
  }

  function orderCard(o, t) {
    const li = el('li', 'hist');
    const top = el('div', 'hist__top');
    top.append(el('span', 'hist__date', when(o.ordered_at, t)));
    // Status on the right; the red "report a problem" button sits right beside it so the shop sees it at once
    // (delivered, within 7 days, fewer than 3 reports: the server decides via complain_until).
    const state_ = el('div', 'hist__state');
    const until = Date.parse(o.complain_until || '');
    const canComplain = until > Date.now();
    if (canComplain) {
      const btn = el('button', 'complain-btn', o.complaints > 0 ? t.complainMore : t.complain);
      btn.type = 'button';
      btn.addEventListener('click', () => openComplaint(o));
      state_.append(btn);
    }
    if (o.status) state_.append(el('span', `pill pill--${STATUS_LOOK[o.status] || 'plain'}`, t.status[o.status] || o.status));
    top.append(state_);
    const notes = [];
    if (canComplain) {
      const day = new Intl.DateTimeFormat(t.locale, { timeZone: TZ, day: 'numeric', month: 'short' }).format(new Date(until));
      notes.push(el('p', 'hist__until', t.complainUntil(day)));
    }
    if (o.complaints > 0) notes.push(el('p', 'hist__issue', t.complained(o.complaints)));
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
      text.append(...productName(p, it.name_th || it.sku),
        el('span', 'hist__each', t.each(money(it.qty, t), t.unit(it.qty_unit, it.qty), money(it.unit_price, t))));
      row.append(img, text, el('span', 'hist__amount', `฿${money(it.line_total, t)}`));
      lines.append(row);
    });
    details.append(lines);

    const again = el('button', 'add-btn hist__again', t.again);
    again.type = 'button';
    again.addEventListener('click', () => orderAgain(o));
    li.append(top, ...notes, sum, meta, details, again);
    return li;
  }

  // ---------- report a problem (2026-11-03) ----------
  // state.cp: { order, reason, skus:Set, note, photos:[{ mime, base64, url }], clientId, busy, done }
  function newId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  function openComplaint(o) {
    state.cp = { order: o, reason: '', skus: new Set(), note: '', photos: [], clientId: newId(), busy: '', done: '', error: '' };
    $('cp-note').value = '';
    $('cp-file').value = '';
    renderComplaint();
    $('cp').showModal();
  }

  // Anything changed after a failed send is a new report: a new id, so the server never answers with the old one.
  function cpChanged() {
    if (!state.cp || state.cp.busy) return;
    state.cp.clientId = newId();
    state.cp.error = '';
  }

  function renderComplaint() {
    const cp = state.cp;
    if (!cp) return;
    const t = TEXT[state.lang];
    const o = cp.order;
    $('cp-form').hidden = Boolean(cp.done);
    $('cp-done').hidden = !cp.done;
    if (cp.done) {
      $('cp-done-body').textContent = t.cpDoneBody(cp.done);
      return;
    }
    $('cp-order').textContent = t.cpOrder(o.id, when(o.ordered_at, t));

    $('cp-reasons').replaceChildren(...REASONS.map((code) => {
      const label = el('label', 'cp__reason');
      const input = el('input');
      input.type = 'radio';
      input.name = 'cp-reason';
      input.value = code;
      input.checked = cp.reason === code;
      input.disabled = Boolean(cp.busy);
      input.addEventListener('change', () => { cp.reason = code; cpChanged(); renderComplaint(); });
      label.append(input, el('span', null, t.reasons[code] || code));
      return label;
    }));

    $('cp-items').replaceChildren(...o.items.map((it) => {
      const p = state.catalog.get(it.sku);
      const li = el('li');
      const label = el('label', 'cp__item');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = cp.skus.has(it.sku);
      input.disabled = Boolean(cp.busy);
      input.addEventListener('change', () => {
        if (input.checked) cp.skus.add(it.sku); else cp.skus.delete(it.sku);
        cpChanged();
      });
      const img = el('img', 'hist__img');
      img.alt = '';
      if (p && /^assets\/products\/[A-Z]{2}-\d{3}\.webp$/.test(p.image || '')) img.src = p.image;
      const text = el('span', 'hist__name');
      text.append(...productName(p, it.name_th || it.sku),
        el('span', 'hist__each', t.each(money(it.qty, t), t.unit(it.qty_unit, it.qty), money(it.unit_price, t))));
      label.append(input, img, text);
      li.append(label);
      return li;
    }));

    $('cp-photos').replaceChildren(...cp.photos.map((ph, i) => {
      const li = el('li', 'cp__photo');
      const img = el('img');
      img.src = ph.url;
      img.alt = '';
      const del = el('button', 'cp__del');
      del.type = 'button';
      del.disabled = Boolean(cp.busy);
      del.setAttribute('aria-label', t.cpRemove(i + 1));
      del.textContent = '×';
      del.addEventListener('click', () => { cp.photos.splice(i, 1); cpChanged(); renderComplaint(); });
      li.append(img, del);
      return li;
    }));
    $('cp-add').hidden = cp.photos.length >= PHOTO_MAX;
    $('cp-file').disabled = Boolean(cp.busy);

    const needNote = cp.reason === REASON_OTHER;
    $('cp-note-label').textContent = needNote ? t.cpNoteReq : t.cpNote;
    $('cp-note').required = needNote;
    $('cp-note').disabled = Boolean(cp.busy);
    $('cp-error').textContent = cp.error;
    $('cp-error').hidden = !cp.error;
    const send = $('cp-send');
    send.disabled = Boolean(cp.busy);
    send.replaceChildren();
    if (cp.busy) send.append(el('span', 'spinner', null), el('span', null, cp.busy === 'photos' ? t.cpPreparing : t.cpSending));
    else send.textContent = t.cpSend;
  }

  // A phone photo (often 3–12 MP) → JPEG of at most 1600 px on the long side, smaller steps until it fits the limit.
  // FileReader + data: URL, not blob:, because the page's CSP allows img-src data: only.
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image'));
      img.src = src;
    });
  }
  async function shrinkPhoto(file) {
    const img = await loadImage(await readAsDataUrl(file));
    for (const [side, q] of [[1600, 0.82], [1280, 0.72], [1024, 0.62]]) {
      const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', q);
      const base64 = url.slice(url.indexOf(',') + 1);
      if (url.startsWith('data:image/jpeg;base64,') && base64.length <= PHOTO_B64_MAX) return { mime: 'image/jpeg', base64, url };
    }
    throw new Error('too big');
  }

  async function addPhotos(files) {
    const cp = state.cp;
    const t = TEXT[state.lang];
    if (!cp || !files.length) return;
    const room = PHOTO_MAX - cp.photos.length;
    cp.error = files.length > room ? t.cpTooMany : '';
    cp.busy = 'photos';
    renderComplaint();
    let bad = false;
    for (const file of files.slice(0, room)) {
      try { cp.photos.push(await shrinkPhoto(file)); } catch (_) { bad = true; }
    }
    cp.busy = '';
    cpChanged();   // new photos = a new report id (and clears the old message)
    if (bad) cp.error = t.cpPhotoBad; else if (files.length > room) cp.error = t.cpTooMany;
    $('cp-file').value = '';
    if (state.cp === cp) renderComplaint();
  }

  // Busy, server hiccups and lost connections are tried again with the same id (the server writes it once).
  async function sendComplaint(ev) {
    ev.preventDefault();
    const cp = state.cp;
    const t = TEXT[state.lang];
    if (!cp || cp.busy) return;
    cp.note = $('cp-note').value.trim();
    cp.error = !cp.reason ? t.cpNeedReason
      : cp.reason === REASON_OTHER && !cp.note ? t.cpNeedNote
        : !cp.photos.length ? t.cpNeedPhoto : '';
    if (cp.error) { renderComplaint(); return; }
    cp.busy = 'send';
    renderComplaint();
    const body = { contract: 'order.v1', action: 'complain', token: state.member.token, order_id: cp.order.id,
      reason: cp.reason, skus: cp.order.items.map((it) => it.sku).filter((k) => cp.skus.has(k)), note: cp.note,
      photos: cp.photos.map((p) => ({ mime: p.mime, base64: p.base64 })), client_id: cp.clientId };
    let res;
    for (const wait of [0, 2000, 5000]) {
      if (wait) await new Promise((r) => { setTimeout(r, wait); });
      res = await post(body, UPLOAD_TIMEOUT_MS);
      if (res.ok || !['busy', 'server', 'network'].includes(res.error)) break;
    }
    cp.busy = '';
    if (res.ok) {
      cp.done = res.complaint_id || '—';
    } else if (res.error === 'session') {
      $('cp').close();
      loggedOut();
      return;
    } else {
      cp.error = { not_found: t.cpClosed, not_delivered: t.cpClosed, too_late: t.cpClosed, rate: t.cpRate,
        photo: t.cpNeedPhoto, photo_type: t.cpPhotoBad, photo_size: t.cpPhotoBad, note: t.cpNeedNote,
        reason: t.cpNeedReason, network: t.network }[res.error] || t.server;
    }
    if (state.cp === cp) renderComplaint();
  }

  function closeComplaint() {
    const sent = state.cp && state.cp.done;
    if (state.cp && state.cp.busy === 'send') return;   // the request is on its way: wait for the answer
    $('cp').close();
    state.cp = null;
    if (sent) load();   // status is now Issue and the report count changed
  }

  function loggedOut() {
    storageSet(STORE, '');   // reset, closed or expired: the menu shows the shop as logged out too
    tabSet(STORE, '');
    state.member = null;
    state.result = null;
    state.error = 'session';
    render();
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
      loggedOut();
      return;
    } else {
      state.error = res.error === 'network' || res.error === 'off' ? res.error : 'server';
    }
    render();
  }

  async function boot() {
    // Language picker: a native select under a pill; languages without texts (i18n.js did not load) are taken out.
    [...$('lang-select').options].forEach((o) => { if (!TEXT[o.value]) o.remove(); });
    $('lang-select').addEventListener('change', () => {
      state.lang = $('lang-select').value;
      storageSet('menu-lang', state.lang);
      render();
    });
    $('h-retry').addEventListener('click', load);
    $('cp-form').addEventListener('submit', sendComplaint);
    $('cp-file').addEventListener('change', () => addPhotos(Array.from($('cp-file').files || [])));
    $('cp-note').addEventListener('input', cpChanged);
    $('cp-close').addEventListener('click', closeComplaint);
    $('cp-ok').addEventListener('click', closeComplaint);
    $('cp').addEventListener('cancel', (ev) => { ev.preventDefault(); closeComplaint(); });   // Esc / back gesture
    $('cp').addEventListener('click', (ev) => { if (ev.target === $('cp')) closeComplaint(); });   // tap outside
    state.loading = Boolean(state.member);
    render();
    const [config, catalog] = await Promise.all([getJson('config.json'), getJson('data/catalog.json')]);
    state.config = config || {};
    ((catalog && catalog.products) || []).forEach((p) => state.catalog.set(p.sku, p));
    if (state.member) await load(); else render();
  }

  boot();
})();
