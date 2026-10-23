// Betagro Shop price menu (v2). Reads three JSON files and renders. The only thing it sends anywhere
// is an order the buyer submits (docs/ORDER_CONTRACT.md); the cart lives in the buyer's own browser.
// The site does not know or care who produced the prices (claude, benny, manual).
'use strict';

(function () {
  const CATEGORIES = ['pork', 'chicken', 'egg', 'fish'];
  const MAX_QTY = 500;       // contract: qty > 0 and <= 500
  const MAX_LINES = 40;      // contract: 1–40 items
  const LINE_TEXT_MAX = 1000;
  const SUBMIT_TIMEOUT_MS = 30000;   // one attempt; Apps Script cold start + lock wait can take ~25 s
  const SUBMIT_BUDGET_MS = 75000;    // all attempts together, then the buyer gets the LINE fallback
  const RETRY_DELAYS_MS = [2000, 5000];
  // Server answers worth another try. Anything else (bad phone, rate limit, spam) will not change on retry.
  const RETRYABLE = new Set(['network', 'busy', 'server']);

  const UNIT = {
    th: { kg: 'กก.', tray: 'แผง', pack: 'แพ็ก' },
    en: { kg: 'kg', tray: 'tray', pack: 'pack' },
  };
  const enUnit = (u, n) => (n === 1 || u === 'kg' ? UNIT.en[u] : `${UNIT.en[u]}s`) || u;

  const TEXT = {
    th: {
      tabs: { pork: 'หมู', chicken: 'ไก่', egg: 'ไข่', fish: 'ปลา' },
      opener: { pork: 'เนื้อหมู', chicken: 'เนื้อไก่', egg: 'ไข่ไก่', fish: 'ปลา' },
      validLabel: 'ราคาส่งประจำสัปดาห์',
      cadence: 'ราคาใหม่ออกทุกสัปดาห์',
      order: 'สั่งซื้อทาง LINE',
      ask: 'สอบถามราคา',
      empty: 'ยังไม่มีสินค้าในหมวดนี้',
      noDate: 'รอประกาศราคา',
      noPrices: 'ราคาสัปดาห์นี้ยังไม่ขึ้นระบบ สอบถามพนักงานขาย หรือทักเราทาง LINE ได้เลย',
      stale: (d) => `ราคานี้ใช้ถึงวันที่ ${d} ราคาใหม่ออกทุกสัปดาห์ ยืนยันราคาล่าสุดทาง LINE ก่อนสั่งซื้อ`,
      loadError: 'โหลดรายการสินค้าไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้านี้',
      fineprint: 'ราคาเป็นเงินบาท ซื้อมากราคาต่อหน่วยยิ่งถูก ยืนยันราคาสุดท้ายเมื่อสั่งซื้อ',
      search: 'ค้นหาสินค้า เช่น สันใน, ปีก',
      searchLabel: 'ค้นหาสินค้า',
      noMatch: (q) => `ไม่พบ “${q}” ในหมวดนี้`,
      jump: (n, cat) => `ดู ${n} รายการในหมวด${cat}`,
      unit: UNIT.th,
      perUnit: (u) => `/${UNIT.th[u] || u}`,
      tierPill: (n) => `${n}+`,
      range: (a, b, u) => (b == null ? `${a} ${UNIT.th[u] || u} ขึ้นไป`
        : a === b ? `${a} ${UNIT.th[u] || u}` : `${a}–${b} ${UNIT.th[u] || u}`),
      colQty: 'จำนวน', colPrice: 'ราคา', colSave: 'ประหยัด',
      save: (n) => `฿${n}`,
      close: 'ปิด',
      locale: 'th-TH',
      // ordering
      add: 'ใส่ตะกร้า',
      less: 'ลดจำนวน',
      more: 'เพิ่มจำนวน',
      qtyOf: (name, u) => `จำนวน ${name} (${u})`,
      tierOn: (n, u) => `ราคาขั้น ${n} ${u}+ ใช้แล้ว`,
      tierNext: (d, u, p, per) => `อีก ${d} ${u} ได้ราคา ฿${p}${per}`,
      unitLabel: (u) => UNIT.th[u] || u,
      lineSum: (q, u, p) => `${q} ${u} × ฿${p}`,
      lines: (n) => `${n} รายการ`,
      viewCart: 'ดูตะกร้า',
      cartTitle: 'ตะกร้าสินค้า',
      cartWeek: (r) => `ราคาสัปดาห์ ${r}`,
      cartEmpty: 'ยังไม่มีสินค้าในตะกร้า เลือกจำนวนจากเมนูได้เลย',
      remove: 'ลบออก',
      removeOf: (name) => `ลบ ${name} ออกจากตะกร้า`,
      total: 'ยอดรวม',
      cartFine: 'คิดราคาตามขั้นจำนวนแล้ว ร้านจะยืนยันยอดสุดท้ายและเวลาส่งอีกครั้ง',
      cartFull: `ตะกร้าใส่ได้สูงสุด ${MAX_LINES} รายการต่อออเดอร์`,
      toForm: 'ถัดไป: ข้อมูลจัดส่ง',
      formTitle: 'ข้อมูลจัดส่ง',
      back: 'กลับไปตะกร้า',
      required: 'จำเป็น',
      optional: 'ไม่บังคับ',
      fShop: 'ชื่อร้าน',
      fContact: 'ชื่อผู้ติดต่อ',
      fPhone: 'เบอร์โทร',
      fPhoneHint: 'ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0',
      fLine: 'ชื่อ LINE',
      fDate: 'วันที่ต้องการรับของ',
      fAddress: 'ที่อยู่จัดส่ง / จุดสังเกต',
      fNote: 'หมายเหตุถึงร้าน',
      phShop: 'เช่น ร้านกาแฟสุขุมวิท 22',
      phAddress: 'เช่น ซอยสุขุมวิท 22 ตรงข้าม 7-11',
      eShop: 'กรอกชื่อร้าน',
      ePhone: 'เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0 เช่น 0812345678',
      eDate: 'เลือกวันตั้งแต่พรุ่งนี้เป็นต้นไป',
      eEmpty: 'ตะกร้ายังว่างอยู่',
      submit: (x) => `ยืนยันสั่งซื้อ · ฿${x}`,
      sending: 'กำลังส่งออเดอร์…',
      resending: (n, max) => `ระบบตอบช้า กำลังลองส่งใหม่ (${n}/${max})…`,
      okTitle: 'รับออเดอร์แล้ว ขอบคุณค่ะ',
      okBody: 'ร้านจะติดต่อกลับเพื่อยืนยันยอดและเวลาส่ง ส่งสรุปเข้า LINE ร้านไว้ด้วย จะได้คุยต่อในแชตได้เลย',
      orderNo: 'เลขที่ออเดอร์',
      pilotTitle: 'อีกขั้นเดียว',
      pilotBody: 'กดปุ่มด้านล่างเพื่อส่งออเดอร์เข้า LINE ร้าน ร้านจะยืนยันยอดและเวลาส่งในแชต',
      failTitle: 'ส่งออเดอร์เข้าระบบยังไม่สำเร็จ',
      failBody: 'ไม่ต้องกังวล ตะกร้ายังอยู่ครบ กดส่งสรุปออเดอร์ทาง LINE ได้เลย หรือลองส่งอีกครั้ง',
      failRate: 'ชั่วโมงนี้มีออเดอร์จากเบอร์นี้หลายครั้งแล้ว กดส่งสรุปออเดอร์ทาง LINE แทนได้เลย ร้านจะติดต่อกลับ',
      retry: 'ลองส่งอีกครั้ง',
      sendLine: 'ส่งสรุปออเดอร์เข้า LINE',
      clearAfterLine: 'ส่งทาง LINE แล้ว ล้างตะกร้า',
      backToMenu: 'กลับไปหน้าเมนู',
      doneSummary: (n, x, d) => `${n} รายการ · ฿${x} · รับของ ${d}`,
      orderingOff: 'การสั่งออนไลน์จะเปิดอีกครั้งเมื่อราคาสัปดาห์ใหม่ขึ้นระบบ ระหว่างนี้สั่งทาง LINE ได้เลย',
      msg: {
        head: (id) => (id ? `ออเดอร์ ${id}` : 'ออเดอร์ใหม่จากเมนูออนไลน์'),
        shop: 'ร้าน', contact: 'ผู้ติดต่อ', phone: 'โทร', line: 'LINE', date: 'รับของ',
        address: 'ที่อยู่', note: 'หมายเหตุ', total: 'รวม', more: (n) => `…และอีก ${n} รายการ`,
      },
    },
    en: {
      tabs: { pork: 'Pork', chicken: 'Chicken', egg: 'Eggs', fish: 'Fish' },
      opener: { pork: 'เนื้อหมู', chicken: 'เนื้อไก่', egg: 'ไข่ไก่', fish: 'ปลา' },
      validLabel: 'Trade prices for the week',
      cadence: 'New prices every week',
      order: 'Order via LINE',
      ask: 'Ask for price',
      empty: 'No products in this category yet.',
      noDate: 'Prices coming soon',
      noPrices: "This week's prices aren't posted yet. Ask your sales rep or message us on LINE.",
      stale: (d) => `These prices were valid until ${d}. New prices come out every week, so confirm on LINE before ordering.`,
      loadError: "The menu didn't load. Check your connection and refresh the page.",
      fineprint: 'Prices in Thai baht. Buy more, pay less per unit. Final price is confirmed when you order.',
      search: 'Search, e.g. loin, wing',
      searchLabel: 'Search products',
      noMatch: (q) => `Nothing matches “${q}” here.`,
      jump: (n, cat) => `See ${n} in ${cat}`,
      unit: UNIT.en,
      perUnit: (u) => `/${UNIT.en[u] || u}`,
      tierPill: (n) => `${n}+`,
      range: (a, b, u) => (b == null ? `${a}+ ${enUnit(u, a)}`
        : a === b ? `${a} ${enUnit(u, a)}` : `${a}–${b} ${enUnit(u, b)}`),
      colQty: 'Quantity', colPrice: 'Price', colSave: 'You save',
      save: (n) => `฿${n}`,
      close: 'Close',
      locale: 'en-GB',
      // ordering
      add: 'Add',
      less: 'Less',
      more: 'More',
      qtyOf: (name, u) => `Quantity of ${name} (${u})`,
      tierOn: (n, u) => `${n}+ ${u} price applied`,
      tierNext: (d, u, p, per) => `${d} more ${u} for ฿${p}${per}`,
      unitLabel: (u, n) => enUnit(u, n == null ? 2 : n),
      lineSum: (q, u, p) => `${q} ${u} × ฿${p}`,
      lines: (n) => (n === 1 ? '1 item' : `${n} items`),
      viewCart: 'View cart',
      cartTitle: 'Your order',
      cartWeek: (r) => `Prices for ${r}`,
      cartEmpty: 'Your cart is empty. Pick quantities from the menu.',
      remove: 'Remove',
      removeOf: (name) => `Remove ${name} from cart`,
      total: 'Total',
      cartFine: 'Quantity prices are applied. The shop confirms the final total and delivery time.',
      cartFull: `A cart holds up to ${MAX_LINES} items per order.`,
      toForm: 'Next: delivery details',
      formTitle: 'Delivery details',
      back: 'Back to cart',
      required: 'required',
      optional: 'optional',
      fShop: 'Shop name',
      fContact: 'Contact name',
      fPhone: 'Phone',
      fPhoneHint: '9–10 digits starting with 0',
      fLine: 'LINE name',
      fDate: 'Delivery date',
      fAddress: 'Delivery address / landmark',
      fNote: 'Note to the shop',
      phShop: 'e.g. Café Sukhumvit 22',
      phAddress: 'e.g. Sukhumvit Soi 22, opposite 7-Eleven',
      eShop: 'Enter your shop name',
      ePhone: 'Phone needs 9–10 digits starting with 0, e.g. 0812345678',
      eDate: 'Choose tomorrow or later',
      eEmpty: 'Your cart is empty',
      submit: (x) => `Place order · ฿${x}`,
      sending: 'Sending order…',
      resending: (n, max) => `Slow connection, trying again (${n}/${max})…`,
      okTitle: 'Order received, thank you',
      okBody: 'The shop will contact you to confirm the total and delivery time. Send the summary to our LINE too, so we can chat there.',
      orderNo: 'Order number',
      pilotTitle: 'One last step',
      pilotBody: 'Tap below to send your order to our LINE. The shop confirms the total and delivery time in the chat.',
      failTitle: "Your order didn't reach us yet",
      failBody: 'No problem, your cart is still here: send the order summary on LINE instead, or try again.',
      failRate: 'We already have several orders from this phone in the last hour. Send the summary on LINE instead and the shop will get back to you.',
      retry: 'Try again',
      sendLine: 'Send order to LINE',
      clearAfterLine: 'Sent on LINE? Clear the cart',
      backToMenu: 'Back to menu',
      doneSummary: (n, x, d) => `${n === 1 ? '1 item' : `${n} items`} · ฿${x} · delivery ${d}`,
      orderingOff: "Online ordering reopens when the new week's prices are posted. You can order on LINE meanwhile.",
      msg: {
        head: (id) => (id ? `Order ${id}` : 'New order from the online menu'),
        shop: 'Shop', contact: 'Contact', phone: 'Phone', line: 'LINE', date: 'Delivery',
        address: 'Address', note: 'Note', total: 'Total', more: (n) => `…and ${n} more items`,
      },
    },
  };
  // Opener titles are bilingual like the catalogue: thin English caps over green Thai.
  const OPENER_EN = { pork: 'Pork', chicken: 'Chicken', egg: 'Eggs', fish: 'Fish' };

  const state = {
    lang: pickLanguage(),
    category: location.hash.slice(1),
    query: '',
    config: {},
    products: null,   // null = catalog failed to load
    prices: null,     // null = no usable price file
    priceBySku: new Map(),
    firstPaint: true,
    fade: false,
    open: null,       // sku shown in the sheet
    productBySku: new Map(),
    cart: new Map(),  // sku -> whole-number qty, in the order added
    step: 'cart',     // cart dialog view: cart | form | done
    last: null,       // { order, status: ok|pilot|fail, id, error, lineSent } for the done view
    busy: false,
    attempt: 0,       // which send attempt is running (1 = first), for the button label
  };

  // ---------- helpers ----------
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

  // GitHub Pages sometimes answers 503 for a moment (e.g. while a new push deploys). Without config.json
  // the page would quietly lose the order endpoint and LINE link, so a failed load is tried again.
  // A 404 is final: retrying will not make a missing file appear.
  const LOAD_RETRY_MS = [800, 2000];
  async function getJson(path) {
    for (let attempt = 0; ; attempt += 1) {
      let res = null;
      try { res = await fetch(path, { cache: 'no-cache' }); } catch (_) { /* offline or dropped: try again */ }
      if (res && res.ok) return res.json();
      const wait = LOAD_RETRY_MS[attempt];
      if ((res && res.status === 404) || wait == null) {
        throw new Error(`${path}: ${res ? `HTTP ${res.status}` : 'network error'}`);
      }
      await sleep(wait);
    }
  }

  function parseDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  // th-TH formats in the Buddhist calendar (พ.ศ.), en-GB in Gregorian.
  function dateFormat(t, month) {
    return new Intl.DateTimeFormat(t.locale, { day: 'numeric', month: month || 'short', year: 'numeric' });
  }

  function formatRange(from, to, t) {
    const f = dateFormat(t);
    if (!to || to.getTime() === from.getTime()) return f.format(from);
    if (typeof f.formatRange === 'function') return f.formatRange(from, to);
    return `${f.format(from)} – ${f.format(to)}`;
  }

  function formatPrice(n, t) {
    const whole = Number.isInteger(n);
    return new Intl.NumberFormat(t.locale, {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n);
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function svgUse(id, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', `#${id}`);
    svg.appendChild(use);
    return svg;
  }

  function activeIn(c) {
    return (state.products || []).filter((p) => p.active && p.category === c);
  }

  function visibleCategories() {
    if (state.products === null) return CATEGORIES;
    return CATEGORIES.filter((c) => activeIn(c).length);
  }

  function matches(p, q) {
    if (!q) return true;
    return [p.name_th, p.name_en, p.description_th, p.description_en, p.sap_code, p.sku]
      .some((s) => typeof s === 'string' && s.toLowerCase().includes(q));
  }

  const other = () => (state.lang === 'th' ? 'en' : 'th');

  // ---------- render ----------
  function render() {
    const t = TEXT[state.lang];
    document.documentElement.lang = state.lang;

    document.querySelectorAll('.lang button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang));
    });

    const shop = state.lang === 'th' ? state.config.shop_name_th : state.config.shop_name_en;
    // Lockup: the brand in wide-tracked caps, the branch under it (Thai is never letter-spaced).
    const branch = (shop || '').replace(/^\s*Betagro Shop\s*/i, '');
    document.getElementById('shop-branch').textContent = branch;

    const from = state.prices && parseDate(state.prices.valid_from || state.prices.effective_date);
    const to = state.prices && parseDate(state.prices.valid_to);
    const range = from ? formatRange(from, to, t) : '';
    document.getElementById('asof-label').textContent = from ? t.validLabel : '';
    document.getElementById('asof-date').textContent = from ? range : t.noDate;
    document.getElementById('cadence').textContent = t.cadence;
    document.getElementById('cta-label').textContent = t.order;
    document.getElementById('fineprint').textContent = t.fineprint;
    const mark = document.getElementById('colophon');
    mark.replaceChildren(el('span', 'colophon__brand', 'Betagro Shop'),
      el('span', 'colophon__rest', [branch, range].filter(Boolean).join('  |  ')));
    const search = document.getElementById('search');
    search.placeholder = t.search;
    search.setAttribute('aria-label', t.searchLabel);
    document.title = shop || 'Betagro Shop';

    renderNotice(t, from, to);
    renderTabs(t);
    renderOpener(t);
    renderGrid(t);
    if (state.open) fillSheet(state.open);
    fillTexts(t);
    renderDock();
    if (isCartOpen()) renderCart();
  }

  // Prices are stale after valid_to; a file without valid_to gets config.stale_after_days of grace.
  // The same rule shows the notice and pauses online ordering, so the two never disagree.
  function isStale() {
    if (!state.prices) return true;
    const from = parseDate(state.prices.valid_from || state.prices.effective_date);
    const to = parseDate(state.prices.valid_to);
    const end = to || from;
    const grace = to ? 0 : (state.config.stale_after_days || 9) * 86400000;
    return Date.now() > end.getTime() + 86400000 + grace;
  }

  function orderingOpen() {
    return Boolean(state.products && state.prices && !isStale());
  }

  function renderNotice(t, from, to) {
    const box = document.getElementById('notice');
    let msg = '';
    if (state.products === null) msg = t.loadError;
    else if (!from) msg = t.noPrices;
    else if (isStale()) msg = `${t.stale(dateFormat(t, 'long').format(to || from))} ${t.orderingOff}`;
    box.textContent = msg;
    box.hidden = !msg;
  }

  function renderTabs(t) {
    const nav = document.getElementById('tabs');
    const cats = visibleCategories();
    if (!cats.includes(state.category)) state.category = cats[0] || 'pork';
    if (nav.children.length !== cats.length) {
      nav.replaceChildren();
      cats.forEach((c) => {
        const b = el('button', 'tab');
        b.type = 'button';
        b.id = `tab-${c}`;
        b.dataset.category = c;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-controls', 'grid');
        b.appendChild(el('span', 'tab__label'));
        b.appendChild(el('span', 'tab__count'));
        b.addEventListener('click', () => selectCategory(c));
        nav.appendChild(b);
      });
    }
    for (const b of nav.children) {
      const c = b.dataset.category;
      const on = c === state.category;
      b.firstChild.textContent = t.tabs[c];
      b.lastChild.textContent = state.products ? String(activeIn(c).length) : '';
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    document.getElementById('grid').setAttribute('aria-labelledby', `tab-${state.category}`);
  }

  function renderOpener(t) {
    const c = state.category;
    document.getElementById('opener-en').textContent = OPENER_EN[c];
    document.getElementById('opener-th').textContent = t.opener[c];
    const badge = document.getElementById('badge');
    badge.replaceChildren(svgUse(`i-${c}`));
  }

  function renderGrid(t) {
    const grid = document.getElementById('grid');
    const nomatch = document.getElementById('nomatch');
    grid.replaceChildren();
    nomatch.replaceChildren();
    nomatch.hidden = true;
    grid.classList.remove('is-first', 'is-fading');
    if (state.products === null) return;

    const inCategory = activeIn(state.category);
    if (!inCategory.length) {
      grid.appendChild(el('li', 'empty', t.empty));
      return;
    }
    const q = state.query.trim().toLowerCase();
    const items = inCategory.filter((p) => matches(p, q));
    if (!items.length) {
      renderNoMatch(t, nomatch, q);
      return;
    }

    items.forEach((p, i) => grid.appendChild(tile(p, i, t)));

    if (state.firstPaint) grid.classList.add('is-first');
    else if (state.fade) { void grid.offsetWidth; grid.classList.add('is-fading'); }
    state.firstPaint = false;
    state.fade = false;
  }

  function renderNoMatch(t, box, q) {
    box.hidden = false;
    box.appendChild(el('p', '', t.noMatch(state.query.trim())));
    // Point to the category that does have it, so a buyer on the wrong tab is not stuck.
    for (const c of visibleCategories()) {
      if (c === state.category) continue;
      const n = activeIn(c).filter((p) => matches(p, q)).length;
      if (!n) continue;
      const b = el('button', 'nomatch__jump', t.jump(n, t.tabs[c]));
      b.type = 'button';
      b.addEventListener('click', () => selectCategory(c));
      box.appendChild(b);
      box.appendChild(document.createTextNode(' '));
    }
  }

  function tile(p, i, t) {
    const li = el('li', 'cell');
    li.style.setProperty('--i', String(Math.min(i, 10)));
    const b = el('button', 'tile');
    b.type = 'button';
    b.setAttribute('aria-haspopup', 'dialog');
    b.addEventListener('click', () => openSheet(p.sku));

    const plate = el('span', 'tile__plate');
    const img = el('img', 'tile__img');
    img.src = p.image;
    img.alt = `${p.name_th} ${p.name_en}`;
    img.width = 600;
    img.height = 600;
    img.decoding = 'async';
    img.loading = i < 4 ? 'eager' : 'lazy';
    if (i < 2) img.setAttribute('fetchpriority', 'high');
    plate.appendChild(img);
    b.appendChild(plate);

    const names = el('span', 'tile__names');
    names.appendChild(el('span', 'tile__name', p[`name_${state.lang}`]));
    const alt = el('span', 'tile__alt', p[`name_${other()}`]);
    alt.lang = other();
    names.appendChild(alt);
    b.appendChild(names);

    const row = state.priceBySku.get(p.sku);
    const unit = (row && row.qty_unit) || p.unit;
    const price = el('span', row ? 'price' : 'price price--ask');
    const tiers = el('span', 'tiers');
    if (row) {
      const [base, ...more] = row.tiers;
      const amount = el('span', 'price__amount');
      amount.appendChild(el('span', 'price__baht', '฿'));
      amount.appendChild(document.createTextNode(formatPrice(base.price, t)));
      price.appendChild(amount);
      price.appendChild(el('span', 'price__unit', t.perUnit(unit)));
      for (const tier of more) {
        // Unit is shown once on the headline price; screen readers still hear it per tier.
        const pill = el('span', 'pill', t.tierPill(tier.min_qty));
        pill.dataset.min = String(tier.min_qty);
        pill.appendChild(el('span', 'sr-only', ` ${t.unit[unit] || unit}`));
        pill.appendChild(document.createTextNode(` ฿${formatPrice(tier.price, t)}`));
        tiers.appendChild(pill);
      }
    } else {
      price.appendChild(el('span', 'price__amount', t.ask));
    }
    b.appendChild(price);
    b.appendChild(tiers);
    li.appendChild(b);
    if (row && orderingOpen()) {
      const box = buyBox(p, row, t, 'tile');
      const sync = box._sync;
      // The tier the cart qty lands on is filled in, so the buyer sees which price they get.
      box._sync = () => {
        sync();
        const tier = tierFor(row, qtyOf(p.sku));
        for (const pill of tiers.children) {
          pill.classList.toggle('is-on', qtyOf(p.sku) > 0 && Number(pill.dataset.min) === tier.min_qty);
        }
      };
      box._sync();
      li.appendChild(box);
    }
    return li;
  }

  // ---------- bottom sheet ----------
  function fillSheet(sku) {
    const t = TEXT[state.lang];
    const p = (state.products || []).find((x) => x.sku === sku);
    if (!p) return;
    const img = document.getElementById('sheet-img');
    img.src = p.image;
    img.alt = `${p.name_th} ${p.name_en}`;
    document.getElementById('sheet-code').textContent = p.sku;
    document.getElementById('sheet-name').textContent = p[`name_${state.lang}`];
    const alt = document.getElementById('sheet-alt');
    alt.textContent = p[`name_${other()}`];
    alt.lang = other();
    const desc = document.getElementById('sheet-desc');
    desc.textContent = p[`description_${state.lang}`] || p[`description_${other()}`] || '';
    desc.hidden = !desc.textContent;
    document.getElementById('sheet-close-label').textContent = t.close;
    document.getElementById('sheet-order-label').textContent = t.order;

    const row = state.priceBySku.get(p.sku);
    const unit = (row && row.qty_unit) || p.unit;
    const table = document.getElementById('sheet-table');
    const body = document.getElementById('sheet-tiers');
    body.replaceChildren();
    document.getElementById('th-qty').textContent = t.colQty;
    document.getElementById('th-price').textContent = `${t.colPrice} ${t.perUnit(unit)}`;
    document.getElementById('th-save').textContent = t.colSave;
    if (!row) {
      const tr = el('tr');
      const td = el('td', 't-price', t.ask);
      td.colSpan = 3;
      td.style.textAlign = 'left';
      tr.appendChild(td);
      body.appendChild(tr);
    } else {
      const base = row.tiers[0].price;
      row.tiers.forEach((tier, i) => {
        const tr = el('tr', i === 0 ? 'is-base' : '');
        tr.dataset.min = String(tier.min_qty);
        tr.appendChild(el('td', '', t.range(tier.min_qty, tier.max_qty, unit)));
        const td = el('td');
        td.appendChild(el('span', 't-price', `฿${formatPrice(tier.price, t)}`));
        tr.appendChild(td);
        const diff = base - tier.price;
        tr.appendChild(el('td', diff > 0 ? 't-save' : 't-save is-none', diff > 0 ? t.save(formatPrice(diff, t)) : '–'));
        body.appendChild(tr);
      });
    }
    table.hidden = false;

    // Ordering: stepper under the tier table; the LINE link stays for unpriced items or when paused.
    const buy = document.getElementById('sheet-buy');
    buy.replaceChildren();
    const canBuy = Boolean(row) && orderingOpen();
    document.getElementById('sheet-order').hidden = canBuy;
    if (canBuy) {
      const box = buyBox(p, row, t, 'sheet');
      const sync = box._sync;
      box._sync = () => {
        sync();
        const q = qtyOf(p.sku);
        const tier = tierFor(row, q);
        for (const tr of body.children) tr.classList.toggle('is-on', q > 0 && Number(tr.dataset.min) === tier.min_qty);
        syncSheetCart();
      };
      box._sync();
      buy.appendChild(box);
    }
    syncSheetCart();
  }

  function syncSheetCart() {
    const t = TEXT[state.lang];
    const btn = document.getElementById('sheet-cart');
    const show = orderingOpen() && state.cart.size > 0;
    btn.hidden = !show;
    if (show) {
      document.getElementById('sheet-cart-label').textContent =
        `${t.viewCart} · ${t.lines(state.cart.size)} · ฿${formatPrice(cartTotal(), t)}`;
    }
  }

  function openSheet(sku) {
    const dlg = document.getElementById('sheet');
    state.open = sku;
    fillSheet(sku);
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
    dlg.scrollTop = 0;
  }

  function closeSheet() {
    const dlg = document.getElementById('sheet');
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }

  // ---------- ordering: prices for a quantity ----------
  const money = (n) => Math.round(n * 100) / 100;
  const qtyOf = (sku) => state.cart.get(sku) || 0;

  // The tier a quantity lands on: the one with the largest min_qty that the qty reaches.
  function tierFor(row, qty) {
    let hit = row.tiers[0];
    for (const tier of row.tiers) if (qty >= tier.min_qty) hit = tier;
    return hit;
  }
  const nextTier = (row, qty) => row.tiers.find((tier) => tier.min_qty > qty) || null;
  const unitOf = (p, row) => (row && row.qty_unit) || p.unit;

  function cartLines() {
    const out = [];
    for (const [sku, qty] of state.cart) {
      const p = state.productBySku.get(sku);
      const row = state.priceBySku.get(sku);
      if (!p || !row) continue;
      const unitPrice = tierFor(row, qty).price;
      out.push({ p, row, qty, unit: unitOf(p, row), unitPrice, lineTotal: money(unitPrice * qty) });
    }
    return out;
  }
  const cartTotal = () => money(cartLines().reduce((sum, l) => sum + l.lineTotal, 0));

  // "3+ kg price applied" / "2 more kg for ฿75/kg" under a stepper.
  function tierHints(row, unit, qty, t) {
    if (qty <= 0) return [];
    const out = [];
    const tier = tierFor(row, qty);
    if (tier !== row.tiers[0]) out.push({ on: true, text: t.tierOn(tier.min_qty, t.unitLabel(unit, tier.min_qty)) });
    const next = nextTier(row, qty);
    if (next) {
      const d = next.min_qty - qty;
      out.push({ on: false, text: t.tierNext(d, t.unitLabel(unit, d), formatPrice(next.price, t), t.perUnit(unit)) });
    }
    return out;
  }

  // ---------- ordering: cart storage (buyer's browser only) ----------
  function loadCart() {
    state.cart.clear();
    let saved = null;
    try { saved = JSON.parse(storageGet('menu-cart') || 'null'); } catch (_) { saved = null; }
    const items = saved && Array.isArray(saved.items) ? saved.items : [];
    for (const it of items) {
      if (!Array.isArray(it) || state.cart.size >= MAX_LINES) continue;
      const [sku, qty] = it;
      const p = state.productBySku.get(sku);
      // Drop anything this week's menu no longer sells; prices are always re-read from latest.json.
      if (!p || !p.active || !state.priceBySku.has(sku)) continue;
      if (!Number.isInteger(qty) || qty <= 0) continue;
      state.cart.set(sku, Math.min(qty, MAX_QTY));
    }
  }
  function saveCart() {
    storageSet('menu-cart', JSON.stringify({ v: 1, items: [...state.cart] }));
  }

  // ---------- ordering: stepper ----------
  function icon(d) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
    return svg;
  }
  const PLUS = 'M12 5v14M5 12h14';
  const MINUS = 'M5 12h14';

  // One buy box per place a product appears (tile, product sheet, cart line). Each carries
  // data-osku and a _sync() so a change anywhere updates every view of that product.
  function buyBox(p, row, t, variant) {
    const unit = unitOf(p, row);
    const name = p[`name_${state.lang}`];
    const box = el('div', `buy buy--${variant}`);
    box.dataset.osku = p.sku;

    const add = el('button', 'add-btn');
    add.type = 'button';
    add.appendChild(icon(PLUS));
    add.appendChild(el('span', '', t.add));
    add.setAttribute('aria-label', `${t.add} ${name}`);

    const ctrl = el('div', 'stepper');
    const minus = el('button', 'stepper__btn');
    minus.type = 'button';
    minus.appendChild(icon(MINUS));
    minus.setAttribute('aria-label', `${t.less} ${name}`);
    const field = el('label', 'stepper__field');
    const input = el('input', 'stepper__qty');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.maxLength = 3;
    input.setAttribute('aria-label', t.qtyOf(name, t.unitLabel(unit)));
    const unitTag = el('span', 'stepper__unit');
    field.appendChild(input);
    field.appendChild(unitTag);
    const plus = el('button', 'stepper__btn');
    plus.type = 'button';
    plus.appendChild(icon(PLUS));
    plus.setAttribute('aria-label', `${t.more} ${name}`);
    ctrl.append(minus, field, plus);

    const hints = el('div', 'buy__hints');
    hints.setAttribute('aria-live', 'polite');
    const sum = variant === 'tile' ? null : el('p', 'buy__sum');

    add.addEventListener('click', () => { if (setQty(p.sku, 1)) plus.focus(); });
    plus.addEventListener('click', () => setQty(p.sku, qtyOf(p.sku) + 1));
    minus.addEventListener('click', () => {
      setQty(p.sku, qtyOf(p.sku) - 1);
      if (!qtyOf(p.sku) && box.isConnected) add.focus();
    });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('change', () => {
      setQty(p.sku, parseInt(input.value.replace(/\D/g, ''), 10) || 0);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });

    box.append(add, ctrl);
    if (sum) box.appendChild(sum);
    box.appendChild(hints);

    box._sync = () => {
      const q = qtyOf(p.sku);
      add.hidden = q > 0;
      ctrl.hidden = q === 0;
      if (document.activeElement !== input) input.value = String(q);
      unitTag.textContent = t.unitLabel(unit, q);
      plus.disabled = q >= MAX_QTY;
      hints.replaceChildren(...tierHints(row, unit, q, t).map((h) => el('p', h.on ? 'hint hint--on' : 'hint', h.text)));
      if (sum) {
        const price = tierFor(row, q).price;
        sum.hidden = q === 0;
        sum.replaceChildren(el('span', 'buy__calc', t.lineSum(q, t.unitLabel(unit, q), formatPrice(price, t))),
          el('span', 'buy__total', `฿${formatPrice(money(price * q), t)}`));
      }
    };
    return box;
  }

  function setQty(sku, qty) {
    const q = Math.max(0, Math.min(MAX_QTY, Math.floor(Number(qty) || 0)));
    if (q > 0 && !state.cart.has(sku) && state.cart.size >= MAX_LINES) {
      flash(TEXT[state.lang].cartFull);
      syncSku(sku);
      return false;
    }
    const had = state.cart.has(sku);
    if (q > 0) state.cart.set(sku, q); else state.cart.delete(sku);
    saveCart();
    syncSku(sku);
    renderDock();
    if (isCartOpen()) {
      if (had && q === 0) renderCartLines(); else renderCartTotals();
    }
    return true;
  }

  function syncSku(sku) {
    document.querySelectorAll('[data-osku]').forEach((node) => {
      if (node.dataset.osku === sku && typeof node._sync === 'function') node._sync();
    });
    syncSheetCart();
  }

  let flashTimer = 0;
  function flash(msg) {
    const box = document.getElementById('toast');
    box.textContent = msg;
    box.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { box.hidden = true; }, 3500);
  }

  // ---------- ordering: dock (LINE button, plus the cart bar once something is in it) ----------
  function renderDock() {
    const t = TEXT[state.lang];
    const dock = document.getElementById('dock');
    const hasCart = orderingOpen() && state.cart.size > 0;
    dock.classList.toggle('has-cart', hasCart);
    document.getElementById('cart-cta').hidden = !hasCart;
    document.getElementById('cta-label').classList.toggle('sr-only', hasCart);
    if (hasCart) {
      document.getElementById('cart-count').textContent = t.lines(state.cart.size);
      document.getElementById('cart-view').textContent = t.viewCart;
      document.getElementById('cart-total').textContent = `฿${formatPrice(cartTotal(), t)}`;
    }
  }

  // ---------- ordering: cart dialog ----------
  const cartDlg = () => document.getElementById('cart');
  const isCartOpen = () => cartDlg().open;

  function openCart(step) {
    const dlg = cartDlg();
    if (state.open) closeSheet();
    state.step = step || 'cart';
    renderCart();
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    dlg.scrollTop = 0;
  }
  function closeCart() {
    const dlg = cartDlg();
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }

  function showStep(step) {
    state.step = step;
    renderCart();
    cartDlg().scrollTop = 0;
    const focus = { cart: 'cart-title', form: 'form-title', done: 'done-title' }[step];
    const h = document.getElementById(focus);
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
  }

  function fillTexts(t) {
    document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = t[n.dataset.t]; });
    document.querySelectorAll('[data-t-ph]').forEach((n) => { n.placeholder = t[n.dataset.tPh]; });
    document.querySelectorAll('[data-t-aria]').forEach((n) => { n.setAttribute('aria-label', t[n.dataset.tAria]); });
  }

  function renderCart() {
    const t = TEXT[state.lang];
    fillTexts(t);
    const dlg = cartDlg();
    document.getElementById('cart-step-cart').hidden = state.step !== 'cart';
    document.getElementById('cart-form').hidden = state.step !== 'form';
    document.getElementById('cart-done').hidden = state.step !== 'done';
    dlg.setAttribute('aria-labelledby', { cart: 'cart-title', form: 'form-title', done: 'done-title' }[state.step]);
    const from = parseDate(state.prices && state.prices.valid_from);
    const to = parseDate(state.prices && state.prices.valid_to);
    document.getElementById('cart-week').textContent = from ? t.cartWeek(formatRange(from, to, t)) : '';
    if (state.step === 'cart') renderCartLines();
    if (state.step === 'form') renderFormTotals();
    if (state.step === 'done') renderDone();
  }

  function renderCartLines() {
    const t = TEXT[state.lang];
    const list = document.getElementById('cart-lines');
    list.replaceChildren();
    const lines = cartLines();
    document.getElementById('cart-empty').hidden = lines.length > 0;
    for (const l of lines) {
      const li = el('li', 'line');
      const img = el('img', 'line__img');
      img.src = l.p.image;
      img.alt = '';
      img.width = 600;
      img.height = 600;
      img.loading = 'lazy';
      li.appendChild(img);
      const head = el('div', 'line__head');
      head.appendChild(el('p', 'line__name', l.p[`name_${state.lang}`]));
      const alt = el('p', 'line__alt', l.p[`name_${other()}`]);
      alt.lang = other();
      head.appendChild(alt);
      li.appendChild(head);
      const rm = el('button', 'line__rm');
      rm.type = 'button';
      rm.appendChild(icon('M6 6l12 12M18 6L6 18'));
      rm.setAttribute('aria-label', t.removeOf(l.p[`name_${state.lang}`]));
      rm.addEventListener('click', () => setQty(l.p.sku, 0));
      li.appendChild(rm);
      const box = buyBox(l.p, l.row, t, 'line');
      box._sync();
      li.appendChild(box);
      list.appendChild(li);
    }
    renderCartTotals();
  }

  function renderCartTotals() {
    const t = TEXT[state.lang];
    const n = state.cart.size;
    document.getElementById('cart-sum').textContent = `฿${formatPrice(cartTotal(), t)}`;
    document.getElementById('cart-count-line').textContent = t.lines(n);
    document.getElementById('cart-next').disabled = n === 0;
    document.getElementById('cart-sumrow').hidden = n === 0;
    document.getElementById('cart-empty').hidden = n > 0;
  }

  function renderFormTotals() {
    const t = TEXT[state.lang];
    document.getElementById('form-count').textContent = t.lines(state.cart.size);
    document.getElementById('form-sum').textContent = `฿${formatPrice(cartTotal(), t)}`;
    document.getElementById('form-submit-label').textContent = busyLabel(t) || t.submit(formatPrice(cartTotal(), t));
    const date = document.getElementById('f-date');
    date.min = ymd(tomorrow());
    if (!date.value || date.value < date.min) date.value = date.min;
  }

  // ---------- ordering: form ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function tomorrow() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    return d;
  }
  // "2026-10-22T20:40:00+07:00"
  function isoLocal(d) {
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const a = Math.abs(off);
    return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }
  const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const digits = (s) => String(s || '').replace(/\D/g, '');

  const CUSTOMER_FIELDS = { shop_name: 'f-shop', contact_name: 'f-contact', phone: 'f-phone', line_name: 'f-line', address_note: 'f-address' };

  function loadCustomer() {
    let saved = null;
    try { saved = JSON.parse(storageGet('menu-customer') || 'null'); } catch (_) { saved = null; }
    if (!saved || typeof saved !== 'object') return;
    for (const [k, id] of Object.entries(CUSTOMER_FIELDS)) {
      if (typeof saved[k] === 'string') document.getElementById(id).value = saved[k];
    }
  }
  function saveCustomer() {
    const out = {};
    for (const [k, id] of Object.entries(CUSTOMER_FIELDS)) out[k] = document.getElementById(id).value;
    storageSet('menu-customer', JSON.stringify(out));
  }

  function setFieldError(id, msg) {
    const input = document.getElementById(id);
    const err = document.getElementById(`${id}-err`);
    err.textContent = msg || '';
    err.hidden = !msg;
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    return !msg;
  }

  function validateForm() {
    const t = TEXT[state.lang];
    const phone = digits(document.getElementById('f-phone').value);
    const date = document.getElementById('f-date').value;
    const results = [
      setFieldError('f-shop', clean(document.getElementById('f-shop').value, 80) ? '' : t.eShop),
      setFieldError('f-phone', /^0\d{8,9}$/.test(phone) ? '' : t.ePhone),
      setFieldError('f-date', /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= ymd(tomorrow()) ? '' : t.eDate),
    ];
    const firstBad = ['f-shop', 'f-phone', 'f-date'][results.indexOf(false)];
    if (firstBad) document.getElementById(firstBad).focus();
    return !firstBad;
  }

  function buildOrder() {
    const v = (id, max) => clean(document.getElementById(id).value, max);
    const items = cartLines().map((l) => ({
      sku: l.p.sku,
      name_th: l.p.name_th,
      name_en: l.p.name_en,
      qty: l.qty,
      qty_unit: l.unit,
      unit_price: l.unitPrice,
      line_total: l.lineTotal,
    }));
    return {
      contract: 'order.v1',
      shop_id: state.config.shop_id || '',
      price_week: state.prices.valid_from || state.prices.effective_date,
      customer: {
        shop_name: v('f-shop', 80),
        contact_name: v('f-contact', 60),
        phone: digits(document.getElementById('f-phone').value),
        line_name: v('f-line', 40),
      },
      delivery: { date: document.getElementById('f-date').value, address_note: v('f-address', 200) },
      note: v('f-note', 200),
      items,
      total: money(items.reduce((sum, i) => sum + i.line_total, 0)),
      lang: state.lang,
      client_ts: isoLocal(new Date()),
      hp: document.getElementById('f-hp').value,
    };
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (state.busy) return;
    const t = TEXT[state.lang];
    const formErr = document.getElementById('form-error');
    formErr.hidden = true;
    if (!state.cart.size) { formErr.textContent = t.eEmpty; formErr.hidden = false; return; }
    if (!orderingOpen()) { formErr.textContent = t.orderingOff; formErr.hidden = false; return; }
    if (!validateForm()) return;
    saveCustomer();
    const order = buildOrder();
    order.client_order_id = clientOrderId(order);
    state.last = { order, status: 'pending', id: null, error: null, lineSent: false };
    await send();
  }

  // One id per distinct order, kept in the buyer's browser across retries and reloads. A request that
  // timed out may still have been written, so the server answers a repeated id with the first order_id
  // instead of writing it twice. Changing the cart or the form makes a new id.
  function orderKey(o) {
    return JSON.stringify([o.price_week, o.customer, o.delivery, o.note, o.items.map((i) => [i.sku, i.qty])]);
  }
  function newId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
  function clientOrderId(order) {
    const key = orderKey(order);
    let saved = null;
    try { saved = JSON.parse(storageGet('menu-pending') || 'null'); } catch (_) { saved = null; }
    if (saved && saved.key === key && typeof saved.id === 'string') return saved.id;
    const id = newId();
    storageSet('menu-pending', JSON.stringify({ key, id }));
    return id;
  }

  const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

  // One POST per docs/ORDER_CONTRACT.md → { ok, id } or { ok: false, error, retry }.
  async function postOnce(url, order, timeoutMs) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : 0;
    try {
      // text/plain keeps this a "simple" request: Apps Script cannot answer a CORS preflight.
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(order),
        signal: ctl ? ctl.signal : undefined,
      });
      const data = await res.json();
      if (data && data.ok === true && typeof data.order_id === 'string' && data.order_id) {
        return { ok: true, id: data.order_id };
      }
      const error = data && typeof data.error === 'string' ? data.error : 'server';
      return { ok: false, error, retry: RETRYABLE.has(error) };
    } catch (_) {
      // Offline, timed out, or an Apps Script error page instead of JSON.
      return { ok: false, error: 'network', retry: true };
    } finally {
      clearTimeout(timer);
    }
  }

  // Tries a few times with a pause between, within SUBMIT_BUDGET_MS. Same client_order_id every time,
  // so a retry never makes a second order. No endpoint configured = pilot: the LINE message is the order.
  async function send() {
    const url = String(state.config.order_endpoint || '').trim();
    if (!url) { state.last.status = 'pilot'; showStep('done'); return; }
    const deadline = Date.now() + SUBMIT_BUDGET_MS;
    let result = null;
    setBusy(true);
    try {
      for (let attempt = 1; ; attempt += 1) {
        state.attempt = attempt;
        setBusy(true);
        result = await postOnce(url, state.last.order, Math.max(5000, Math.min(SUBMIT_TIMEOUT_MS, deadline - Date.now())));
        const wait = RETRY_DELAYS_MS[attempt - 1];
        if (result.ok || !result.retry || wait == null || Date.now() + wait + 5000 > deadline) break;
        await sleep(wait);
      }
    } finally {
      state.attempt = 0;
      setBusy(false);
    }
    if (result.ok) {
      state.last.status = 'ok';
      state.last.id = result.id;
      clearCart();
      storageSet('menu-pending', '');
    } else {
      // The cart stays (here and in localStorage) until the order really went somewhere.
      state.last.status = 'fail';
      state.last.error = result.error;
    }
    showStep('done');
  }

  function busyLabel(t) {
    if (!state.busy) return '';
    return state.attempt > 1 ? t.resending(state.attempt, RETRY_DELAYS_MS.length + 1) : t.sending;
  }

  function setBusy(on) {
    state.busy = on;
    const t = TEXT[state.lang];
    const btn = document.getElementById('form-submit');
    btn.disabled = on;
    btn.setAttribute('aria-busy', String(on));
    document.getElementById('form-spinner').hidden = !on;
    const retry = document.getElementById('done-retry');
    retry.disabled = on;
    retry.textContent = busyLabel(t) || t.retry;
    if (state.step === 'form') renderFormTotals();
  }

  function clearCart() {
    const skus = [...state.cart.keys()];
    state.cart.clear();
    saveCart();
    skus.forEach(syncSku);
    renderDock();
  }

  // ---------- ordering: done view + LINE hand-off ----------
  function renderDone() {
    const t = TEXT[state.lang];
    const last = state.last;
    if (!last) return;
    const o = last.order;
    const title = { ok: t.okTitle, pilot: t.pilotTitle, fail: t.failTitle }[last.status] || t.pilotTitle;
    const failBody = last.error === 'rate' ? t.failRate : t.failBody;
    const body = { ok: t.okBody, pilot: t.pilotBody, fail: failBody }[last.status] || t.pilotBody;
    document.getElementById('cart-done').dataset.status = last.status;
    document.getElementById('done-title').textContent = title;
    document.getElementById('done-body').textContent = body;
    document.getElementById('done-id-wrap').hidden = !last.id;
    document.getElementById('done-id').textContent = last.id || '';
    document.getElementById('done-summary').textContent =
      t.doneSummary(o.items.length, formatPrice(o.total, t), deliveryLabel(o.delivery.date, t));
    document.getElementById('done-retry').hidden = last.status !== 'fail' || last.error === 'rate';
    document.getElementById('done-clear').hidden = !(last.status === 'fail' && last.lineSent && state.cart.size);
    document.getElementById('done-line').href = lineMessageUrl(lineText(o, last.id, t));
  }

  function deliveryLabel(iso, t) {
    const d = parseDate(iso);
    return d ? new Intl.DateTimeFormat(t.locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(d) : iso;
  }

  // Plain-text order summary for the shop's LINE chat. Item names stay Thai (the shop picks by them).
  function lineText(o, id, t) {
    const m = t.msg;
    const c = o.customer;
    const head = [m.head(id), `${m.shop}: ${c.shop_name}`];
    if (c.contact_name) head.push(`${m.contact}: ${c.contact_name}`);
    head.push(`${m.phone}: ${c.phone}`);
    if (c.line_name) head.push(`${m.line}: ${c.line_name}`);
    head.push(`${m.date}: ${deliveryLabel(o.delivery.date, t)} (${o.delivery.date})`);
    const items = o.items.map((i) => `- ${i.name_th} x ${i.qty} ${t.unitLabel(i.qty_unit, i.qty)} = ฿${formatPrice(i.line_total, t)}`);
    const tail = [`${m.total} ฿${formatPrice(o.total, t)}`];
    if (o.delivery.address_note) tail.push(`${m.address}: ${o.delivery.address_note}`);
    if (o.note) tail.push(`${m.note}: ${o.note}`);
    const build = (list, more) => [...head, '', ...list, ...(more ? [m.more(more)] : []), '', ...tail].join('\n');
    let shown = items.length;
    let text = build(items, 0);
    while (text.length > LINE_TEXT_MAX && shown > 1) {
      shown -= 1;
      text = build(items.slice(0, shown), items.length - shown);
    }
    return text.length > LINE_TEXT_MAX ? `${text.slice(0, LINE_TEXT_MAX - 1)}…` : text;
  }

  // https://line.me/R/oaMessage/{percent-encoded OA id}/?{percent-encoded text}
  function lineOaId() {
    if (state.config.line_oa_id) return String(state.config.line_oa_id);
    const m = /\/p\/([^/?#]+)/.exec(state.config.line_oa_url || '');
    return m ? decodeURIComponent(m[1]) : '';
  }
  function lineMessageUrl(text) {
    const id = lineOaId();
    if (!id) return state.config.line_oa_url || '#';
    return `https://line.me/R/oaMessage/${encodeURIComponent(id)}/?${encodeURIComponent(text)}`;
  }

  // ---------- interaction ----------
  function selectCategory(c, focus) {
    const changed = c !== state.category;
    state.category = c;
    state.fade = changed;
    history.replaceState(null, '', `${location.pathname}${location.search}#${c}`);
    render();
    // If the buyer had scrolled into the list, bring the new category's opener to the top.
    const opener = document.getElementById('opener');
    if (changed && opener.getBoundingClientRect().top < 0) opener.scrollIntoView({ block: 'start' });
    if (focus) document.getElementById(`tab-${c}`).focus();
  }

  function onTabKey(e) {
    const cats = visibleCategories();
    const i = cats.indexOf(state.category);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step && cats.length) {
      e.preventDefault();
      selectCategory(cats[(i + step + cats.length) % cats.length], true);
    }
  }

  function setLanguage(lang) {
    state.lang = lang;
    storageSet('menu-lang', lang);
    render();
  }

  // ---------- boot ----------
  async function boot() {
    document.querySelectorAll('.lang button').forEach((b) => {
      b.addEventListener('click', () => setLanguage(b.dataset.lang));
    });
    document.getElementById('tabs').addEventListener('keydown', onTabKey);
    document.getElementById('search').addEventListener('input', (e) => {
      state.query = e.target.value;
      renderGrid(TEXT[state.lang]);
    });
    const dlg = document.getElementById('sheet');
    document.getElementById('sheet-close').addEventListener('click', closeSheet);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSheet(); });   // tap on the backdrop
    dlg.addEventListener('close', () => { state.open = null; });

    const cart = cartDlg();
    document.getElementById('cart-cta').addEventListener('click', () => openCart());
    document.getElementById('sheet-cart').addEventListener('click', () => openCart());
    document.getElementById('cart-close').addEventListener('click', closeCart);
    cart.addEventListener('click', (e) => { if (e.target === cart) closeCart(); });
    cart.addEventListener('close', () => { if (state.step === 'done' && !state.busy) state.step = 'cart'; });
    document.getElementById('cart-next').addEventListener('click', () => showStep('form'));
    document.getElementById('form-back').addEventListener('click', () => showStep('cart'));
    document.getElementById('cart-form').addEventListener('submit', onSubmit);
    document.getElementById('done-retry').addEventListener('click', () => { if (state.last) send(); });
    document.getElementById('done-menu').addEventListener('click', closeCart);
    // Pilot: the LINE message is the order, so the cart is done once it is sent.
    // Failed send: keep the cart (LINE may not have opened) and offer to clear it once the buyer is back.
    document.getElementById('done-line').addEventListener('click', () => {
      if (!state.last) return;
      if (state.last.status === 'pilot') clearCart();
      if (state.last.status === 'fail') { state.last.lineSent = true; renderDone(); }
    });
    document.getElementById('done-clear').addEventListener('click', () => {
      clearCart();
      storageSet('menu-pending', '');
      closeCart();
    });
    ['f-shop', 'f-phone', 'f-date'].forEach((id) => {
      document.getElementById(id).addEventListener('input', () => setFieldError(id, ''));
    });

    const [config, catalog, prices] = await Promise.allSettled([
      getJson('config.json'),
      getJson('data/catalog.json'),
      getJson('data/prices/latest.json'),
    ]);

    if (config.status === 'fulfilled') state.config = config.value || {};
    if (catalog.status === 'fulfilled' && Array.isArray(catalog.value.products)) {
      state.products = catalog.value.products;
      for (const p of state.products) state.productBySku.set(p.sku, p);
    }
    if (prices.status === 'fulfilled' && Array.isArray(prices.value.prices)
        && parseDate(prices.value.valid_from || prices.value.effective_date)) {
      state.prices = prices.value;
      for (const r of prices.value.prices) {
        // Keep only usable tiers, smallest quantity first; the first one is the headline price.
        const tiers = (Array.isArray(r.tiers) ? r.tiers : [])
          .filter((x) => x && typeof x.price === 'number' && x.price > 0 && typeof x.min_qty === 'number')
          .sort((a, b) => a.min_qty - b.min_qty);
        if (tiers.length) state.priceBySku.set(r.sku, { ...r, tiers });
      }
    }

    loadCart();
    loadCustomer();

    if (state.config.line_oa_url) {
      document.getElementById('line-cta').href = state.config.line_oa_url;
      document.getElementById('sheet-order').href = state.config.line_oa_url;
    }

    render();
  }

  boot();
})();
