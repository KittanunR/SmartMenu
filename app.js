// Betagro Shop price menu (v2). Reads three JSON files and renders; never writes anything.
// The site does not know or care who produced the prices (claude, benny, manual).
'use strict';

(function () {
  const CATEGORIES = ['pork', 'chicken', 'egg', 'fish'];

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

  async function getJson(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
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
  }

  function renderNotice(t, from, to) {
    const box = document.getElementById('notice');
    let msg = '';
    if (state.products === null) msg = t.loadError;
    else if (!from) msg = t.noPrices;
    else {
      const end = to || from;
      const endOfDay = end.getTime() + 86400000;
      const grace = to ? 0 : (state.config.stale_after_days || 9) * 86400000;
      if (Date.now() > endOfDay + grace) msg = t.stale(dateFormat(t, 'long').format(end));
    }
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

    const [config, catalog, prices] = await Promise.allSettled([
      getJson('config.json'),
      getJson('data/catalog.json'),
      getJson('data/prices/latest.json'),
    ]);

    if (config.status === 'fulfilled') state.config = config.value || {};
    if (catalog.status === 'fulfilled' && Array.isArray(catalog.value.products)) {
      state.products = catalog.value.products;
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

    if (state.config.line_oa_url) {
      document.getElementById('line-cta').href = state.config.line_oa_url;
      document.getElementById('sheet-order').href = state.config.line_oa_url;
    }

    render();
  }

  boot();
})();
