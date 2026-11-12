// SmartMenu usage statistics (2026-11-12). Nothing is sent and no id is stored until the visitor taps "ยอมรับ".
// What is sent: which pages, categories, products and prices are looked at, cart steps, search words, language,
// phone type and where the visit came from, with a random visitor id. Never a name, phone, address or shop code.
// Goes to Petch's own Apps Script (backend/analytics/Analytics.gs) → a Google Sheet only his account can open.
// Details for visitors: privacy.html. config.json → analytics_endpoint empty = no banner, nothing sent.
// app.js calls window.SM_TRACK.start(...) once config.json is loaded, and SM_TRACK.event(name, props) on actions.
'use strict';

(function (root) {
  const POLICY = '2026-11-12';         // change it when privacy.html changes: everyone is asked again
  const K_CONSENT = 'sm-consent';
  const K_VISITOR = 'sm-vid';
  const K_SESSION = 'sm-sid';
  const IDLE_MS = 30 * 60 * 1000;      // a new session after 30 minutes without activity
  const FLUSH_MS = 5000;
  const MAX_BATCH = 40;
  const SEEN_MS = 1000;                // a tile counts as "seen" after 1 s at least 60% on screen

  /** The part that decides what is sent. No DOM here, so tests can run it in Node. */
  function createCore(io) {
    const s = { endpoint: '', ctx: {}, queue: [], seen: new Set(), timer: 0, started: false };

    const read = (k) => { try { return io.storage.get(k); } catch (_) { return null; } };
    const write = (k, v) => { try { if (v == null) io.storage.remove(k); else io.storage.set(k, v); } catch (_) { /* private mode */ } };

    function choice() {
      try {
        const c = JSON.parse(read(K_CONSENT) || 'null');
        return c && c.v === POLICY && (c.choice === 'yes' || c.choice === 'no') ? c.choice : null;
      } catch (_) { return null; }
    }
    const on = () => choice() === 'yes' && Boolean(s.endpoint);

    function newId(prefix) {
      const b = io.random(16);
      return prefix + Array.from(b, (x) => (x & 0xff).toString(16).padStart(2, '0')).join('');
    }
    function visitor() {
      let v = read(K_VISITOR);
      if (!/^v[0-9a-f]{32}$/.test(v || '')) { v = newId('v'); write(K_VISITOR, v); }
      return v;
    }
    function session() {
      let x = null;
      try { x = JSON.parse(read(K_SESSION) || 'null'); } catch (_) { x = null; }
      const t = io.now();
      if (!x || !/^s[0-9a-f]{32}$/.test(x.id || '') || t - x.last > IDLE_MS) x = { id: newId('s'), last: t };
      x.last = t;
      write(K_SESSION, JSON.stringify(x));
      return x.id;
    }

    function schedule() {
      if (s.timer) return;
      s.timer = io.setTimer(() => { s.timer = 0; flush(); }, FLUSH_MS);
    }

    function event(name, props) {
      if (choice() !== 'yes') return;              // undecided or declined: dropped, never kept for later
      s.queue.push({ ...(props || {}), e: name });
      if (s.queue.length > 200) s.queue.shift();
      if (s.endpoint) schedule();
    }

    function sawSku(sku) { if (on()) { s.seen.add(sku); schedule(); } }

    function flush() {
      if (!on()) { s.queue = []; s.seen.clear(); return; }
      if (s.seen.size) { s.queue.push({ e: 'tiles_seen', skus: [...s.seen] }); s.seen.clear(); }
      while (s.queue.length) {
        const events = s.queue.splice(0, MAX_BATCH);
        io.send(s.endpoint, JSON.stringify({ v: 1, visitor: visitor(), session: session(), ...s.ctx, events }));
      }
    }

    /** endpoint: Apps Script /exec URL; ctx: { page, lang, member, device, source }. Returns true = ask the visitor. */
    function start(endpoint, ctx) {
      s.endpoint = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(String(endpoint || '')) ? endpoint : '';
      s.ctx = { ...ctx };
      s.started = true;
      if (!s.endpoint) { s.queue = []; return false; }
      if (choice() === 'yes') { event('page_view', {}); flush(); }
      return choice() === null;
    }

    function setCtx(more) { Object.assign(s.ctx, more); }

    /** The visitor's answer. Declining after accepting deletes what this phone sent and its ids. */
    function decide(yes) {
      const before = choice();
      write(K_CONSENT, JSON.stringify({ v: POLICY, choice: yes ? 'yes' : 'no', at: new Date(io.now()).toISOString() }));
      if (yes) {
        if (before !== 'yes') { event('consent', { detail: POLICY }); event('page_view', {}); }
        flush();
        return;
      }
      s.queue = [];
      s.seen.clear();
      const v = read(K_VISITOR);
      if (before === 'yes' && s.endpoint && /^v[0-9a-f]{32}$/.test(v || '')) {
        io.send(s.endpoint, JSON.stringify({ action: 'forget', visitor: v, lang: s.ctx.lang, device: s.ctx.device }));
      }
      write(K_VISITOR, null);
      write(K_SESSION, null);
    }

    return { event, sawSku, flush, start, setCtx, decide, choice, enabled: () => Boolean(s.endpoint), _state: s };
  }

  // ---------- browser ----------
  const TEXT = {
    th: { title: 'ขออนุญาตเก็บข้อมูลการใช้งาน', body: 'เพื่อดูว่ามีคนเข้ากี่คน และสนใจสินค้าหรือราคาไหน เราไม่เก็บชื่อ เบอร์โทร หรือที่อยู่',
      yes: 'ยอมรับ', no: 'ไม่ยอมรับ', more: 'อ่านรายละเอียด', settings: 'ตั้งค่าการเก็บข้อมูล' },
    en: { title: 'May we count how this page is used?', body: "So we know how many people visit and which products and prices they look at. We don't collect your name, phone or address.",
      yes: 'Accept', no: 'Decline', more: 'Details', settings: 'Usage data settings' },
    ja: { title: '利用状況の記録について', body: '訪問者数や、よく見られている商品・価格を知るためです。お名前・電話番号・住所は記録しません。',
      yes: '同意する', no: '同意しない', more: '詳細', settings: 'データ設定' },
    zh: { title: '关于记录使用情况', body: '用于了解访问人数以及大家关注哪些商品和价格。我们不收集您的姓名、电话或地址。',
      yes: '同意', no: '不同意', more: '详情', settings: '数据设置' },
    ko: { title: '이용 기록 수집 안내', body: '방문자 수와 많이 보는 상품·가격을 알기 위해 사용합니다. 이름, 전화번호, 주소는 수집하지 않습니다.',
      yes: '동의', no: '동의 안 함', more: '자세히', settings: '데이터 설정' },
    hi: { title: 'उपयोग की जानकारी के बारे में', body: 'यह जानने के लिए कि कितने लोग आते हैं और कौन से उत्पाद व दाम देखते हैं। हम आपका नाम, फ़ोन या पता नहीं रखते।',
      yes: 'स्वीकार करें', no: 'अस्वीकार करें', more: 'विवरण', settings: 'डेटा सेटिंग' },
  };

  function device() {
    const ua = navigator.userAgent || '';
    if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
    if (/iPhone|iPod/.test(ua)) return 'mobile-ios';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'mobile-android' : 'tablet';
    if (/Mobi/i.test(ua)) return 'mobile-other';
    return 'desktop';
  }
  function source(shopQr) {
    if (shopQr) return 'shop_qr';
    const ua = navigator.userAgent || '';
    const ref = document.referrer || '';
    if (/\bLine\//.test(ua) || /line\.me/.test(ref)) return 'line';
    if (!ref || ref.startsWith(location.origin)) return 'direct';   // a QR scan arrives with no referrer
    if (/google\.|bing\.|yahoo\./.test(ref)) return 'search';
    if (/facebook\.|instagram\.|tiktok\.|t\.co\b|x\.com/.test(ref)) return 'social';
    return 'other';
  }

  function browser() {
    const core = createCore({
      storage: { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) },
      random: (n) => crypto.getRandomValues(new Uint8Array(n)),
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      send(url, body) {
        try {
          if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
        } catch (_) { /* fall through */ }
        try { fetch(url, { method: 'POST', body, mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(() => {}); } catch (_) { /* give up quietly */ }
      },
    });

    const lang = () => (TEXT[document.documentElement.lang] ? document.documentElement.lang : 'en');
    let banner = null;

    function build() {
      banner = document.createElement('section');
      banner.className = 'consent';
      banner.id = 'consent';
      banner.setAttribute('role', 'region');
      banner.setAttribute('aria-labelledby', 'consent-title');
      banner.hidden = true;
      const h = document.createElement('p'); h.className = 'consent__title'; h.id = 'consent-title';
      const p = document.createElement('p'); p.className = 'consent__body';
      const a = document.createElement('a'); a.className = 'consent__more'; a.href = 'privacy.html';
      const row = document.createElement('div'); row.className = 'consent__row';
      const no = document.createElement('button'); no.type = 'button'; no.className = 'consent__btn';
      const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'consent__btn';
      no.addEventListener('click', () => answer(false));
      yes.addEventListener('click', () => answer(true));
      row.append(no, yes);
      banner.append(h, p, a, row);
      document.body.appendChild(banner);
      banner._parts = { h, p, a, yes, no };
      label();
    }
    function label() {
      const t = TEXT[lang()];
      const btn = document.getElementById('track-settings');
      if (btn) btn.textContent = t.settings;
      if (!banner) return;
      const { h, p, a, yes, no } = banner._parts;
      h.textContent = t.title; p.textContent = t.body; a.textContent = t.more; yes.textContent = t.yes; no.textContent = t.no;
    }
    function show() { if (!banner) build(); label(); banner.hidden = false; document.body.classList.add('has-consent'); }
    function hide() { if (banner) banner.hidden = true; document.body.classList.remove('has-consent'); }
    function answer(yes) { core.decide(yes); hide(); }

    // Tiles on screen long enough to read (the grid is re-drawn on every tab change, so new tiles are watched).
    const timers = new WeakMap();
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((list) => {
      list.forEach((en) => {
        const sku = en.target.dataset.sku;
        if (en.isIntersecting) timers.set(en.target, setTimeout(() => core.sawSku(sku), SEEN_MS));
        else clearTimeout(timers.get(en.target));
      });
    }, { threshold: 0.6 }) : null;
    function watchGrid() {
      const grid = document.getElementById('grid');
      if (!grid || !io) return;
      const add = () => grid.querySelectorAll('li[data-sku]').forEach((li) => { if (!li._seenWatch) { li._seenWatch = 1; io.observe(li); } });
      new MutationObserver(add).observe(grid, { childList: true });
      add();
    }

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') core.flush(); });
    window.addEventListener('pagehide', () => core.flush());
    new MutationObserver(label).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    document.addEventListener('click', (e) => {
      const link = e.target.closest && e.target.closest('#line-cta, #sheet-order, #done-line');
      if (link) { core.event('line_click', { detail: link.id }); core.flush(); }
      if (e.target.closest && e.target.closest('#track-settings')) show();
    });

    return {
      start({ endpoint, page = 'menu', member = false, shopQr = false } = {}) {
        const ask = core.start(endpoint, { page, lang: lang(), member: Boolean(member), device: device(), source: source(shopQr) });
        const btn = document.getElementById('track-settings');
        if (btn) btn.hidden = !core.enabled();
        label();
        watchGrid();
        if (ask) show();
      },
      event(name, props) { core.setCtx({ lang: lang() }); core.event(name, props); },
      setMember(member) { core.setCtx({ member: Boolean(member) }); },
      flush: () => core.flush(),
    };
  }

  root.SM_TRACK_CORE = createCore;
  if (typeof document !== 'undefined' && typeof localStorage !== 'undefined') {
    try { root.SM_TRACK = browser(); } catch (_) { root.SM_TRACK = null; }   // statistics must never break the menu
  }
})(typeof window !== 'undefined' ? window : globalThis);
