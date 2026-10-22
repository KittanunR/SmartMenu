// Betagro Shop price menu. Reads three JSON files and renders; never writes anything.
// The site does not know or care who produced the prices (claude, benny, manual).
'use strict';

(function () {
  const CATEGORIES = ['pork', 'chicken', 'egg', 'fish'];

  const TEXT = {
    th: {
      tabs: { pork: 'หมู', chicken: 'ไก่', egg: 'ไข่', fish: 'ปลา' },
      validLabel: 'ราคาประจำสัปดาห์',
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
      unit: { kg: 'กก.', tray: 'แผง', pack: 'แพ็ก' },
      tierQty: (n, u) => `${n} ${{ kg: 'กก.', tray: 'แผง', pack: 'แพ็ก' }[u] || u}+`,
      locale: 'th-TH',
    },
    en: {
      tabs: { pork: 'Pork', chicken: 'Chicken', egg: 'Eggs', fish: 'Fish' },
      validLabel: 'Prices for the week',
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
      unit: { kg: 'kg', tray: 'tray', pack: 'pack' },
      tierQty: (n, u) => `${n} ${{ kg: 'kg', tray: n === 1 ? 'tray' : 'trays', pack: n === 1 ? 'pack' : 'packs' }[u] || u}+`,
      locale: 'en-GB',
    },
  };

  const state = {
    lang: pickLanguage(),
    category: location.hash.slice(1),
    query: '',
    config: {},
    products: null,   // null = catalog failed to load
    prices: null,     // null = no usable price file
    priceBySku: new Map(),
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
  function dateFormat(t) {
    return new Intl.DateTimeFormat(t.locale, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function formatDate(date, t) {
    return dateFormat(t).format(date);
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

  function visibleCategories() {
    if (state.products === null) return CATEGORIES;
    return CATEGORIES.filter((c) => state.products.some((p) => p.active && p.category === c));
  }

  function matches(p, q) {
    if (!q) return true;
    return [p.name_th, p.name_en, p.description_th, p.description_en, p.sap_code]
      .some((s) => typeof s === 'string' && s.toLowerCase().includes(q));
  }

  // ---------- render ----------
  function render() {
    const t = TEXT[state.lang];
    document.documentElement.lang = state.lang;

    document.querySelectorAll('.lang button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang));
    });

    const shop = state.lang === 'th' ? state.config.shop_name_th : state.config.shop_name_en;
    if (shop) document.getElementById('shop-name').textContent = shop;

    const from = state.prices && parseDate(state.prices.valid_from || state.prices.effective_date);
    const to = state.prices && parseDate(state.prices.valid_to);
    document.getElementById('asof-label').textContent = from ? t.validLabel : '';
    document.getElementById('asof-date').textContent = from ? formatRange(from, to, t) : t.noDate;
    document.getElementById('cadence').textContent = t.cadence;
    document.getElementById('cta-label').textContent = t.order;
    document.getElementById('fineprint').textContent = t.fineprint;
    const search = document.getElementById('search');
    search.placeholder = t.search;
    search.setAttribute('aria-label', t.searchLabel);
    document.title = shop || 'Betagro Shop';

    renderNotice(t, from, to);
    renderTabs(t);
    renderList(t);
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
      if (Date.now() > endOfDay + grace) msg = t.stale(formatDate(end, t));
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
        b.setAttribute('aria-controls', 'list');
        b.addEventListener('click', () => selectCategory(c));
        nav.appendChild(b);
      });
    }
    for (const b of nav.children) {
      const on = b.dataset.category === state.category;
      b.textContent = t.tabs[b.dataset.category];
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    document.getElementById('list').setAttribute('aria-labelledby', `tab-${state.category}`);
  }

  function renderList(t) {
    const list = document.getElementById('list');
    list.replaceChildren();
    if (state.products === null) return;

    const inCategory = state.products.filter((p) => p.active && p.category === state.category);
    if (!inCategory.length) {
      list.appendChild(el('li', 'empty', t.empty));
      return;
    }
    const q = state.query.trim().toLowerCase();
    const items = inCategory.filter((p) => matches(p, q));
    if (!items.length) {
      list.appendChild(el('li', 'empty', t.noMatch(state.query.trim())));
      return;
    }
    const other = state.lang === 'th' ? 'en' : 'th';
    for (const p of items) {
      const li = el('li', 'item');

      const img = el('img', 'item__img');
      img.src = p.image;
      img.alt = '';
      img.width = 64;
      img.height = 64;
      img.loading = 'lazy';
      img.decoding = 'async';
      li.appendChild(img);

      const text = el('div');
      text.appendChild(el('p', 'item__name', p[`name_${state.lang}`]));
      const alt = el('p', 'item__alt', p[`name_${other}`]);
      alt.lang = other;
      text.appendChild(alt);
      const desc = p[`description_${state.lang}`];
      if (desc) text.appendChild(el('p', 'item__desc', desc));
      li.appendChild(text);

      const row = state.priceBySku.get(p.sku);
      const unit = (row && row.qty_unit) || p.unit;
      const price = el('div', row ? 'price' : 'price price--ask');
      if (row) {
        const [base, ...more] = row.tiers;
        const amount = el('span', 'price__amount');
        amount.appendChild(el('span', 'price__baht', '฿'));
        amount.appendChild(document.createTextNode(formatPrice(base.price, t)));
        price.appendChild(amount);
        price.appendChild(el('span', 'price__unit', `/ ${t.unit[unit] || unit}`));
        li.appendChild(price);
        if (more.length) {
          const line = more.map((tier) => `${t.tierQty(tier.min_qty, unit)} ฿${formatPrice(tier.price, t)}`).join(' · ');
          li.appendChild(el('p', 'tiers', line));
        }
      } else {
        price.appendChild(el('span', 'price__amount', t.ask));
        li.appendChild(price);
      }
      list.appendChild(li);
    }
  }

  // ---------- interaction ----------
  function selectCategory(c, focus) {
    state.category = c;
    history.replaceState(null, '', `${location.pathname}${location.search}#${c}`);
    render();
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
      renderList(TEXT[state.lang]);
    });

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

    const cta = document.getElementById('line-cta');
    if (state.config.line_oa_url) cta.href = state.config.line_oa_url;

    render();
  }

  boot();
})();
