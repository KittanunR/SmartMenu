// Shop login page (Phase 3): phone + password → a session token kept in this browser ('menu-member': localStorage
// when 'remember me' is ticked, else sessionStorage = this tab only), which app.js sends with orders. The first login uses the temporary password from the admin
// page and must set the shop's own password. Talks only to the order endpoint in config.json (Member.gs).
// Everything shown is set with textContent.
'use strict';

(function () {
  const TIMEOUT_MS = 30000;   // bcrypt (~0.5 s) + an Apps Script cold start
  const STORE = 'menu-member';

  const TEXT = {
    th: {
      backToMenu: 'กลับไปหน้าเมนู',
      loginTitle: 'เข้าสู่ระบบร้านค้า',
      loginIntro: 'สำหรับร้านที่มีบัญชีกับ Betagro Shop แล้ว เข้าระบบครั้งเดียว สั่งของได้โดยไม่ต้องกรอกข้อมูลร้านอีก',
      phone: 'เบอร์โทรร้าน',
      password: 'รหัสผ่าน',
      show: 'แสดง',
      hide: 'ซ่อน',
      tempHint: 'เข้าครั้งแรก ใช้รหัสชั่วคราวที่ได้จากร้าน (เช่น ABCDE-FGHJK)',
      remember: 'จดจำการเข้าสู่ระบบในเครื่องนี้',
      rememberHint: 'ไม่ต้องเข้าระบบใหม่ 90 วัน ถ้าใช้เครื่องร่วมกับคนอื่น ไม่ต้องติ๊ก',
      loginBtn: 'เข้าสู่ระบบ',
      forgot: 'ลืมรหัสผ่าน หรือยังไม่มีบัญชี? ทักร้านทาง LINE ร้านจะส่งรหัสชั่วคราวให้ใหม่',
      askLine: 'ทักร้านทาง LINE',
      newTitle: 'ตั้งรหัสผ่านของร้าน',
      newIntro: 'รหัสชั่วคราวใช้ได้ครั้งเดียว ตั้งรหัสผ่านใหม่ที่ร้านจำได้ ครั้งต่อไปใช้รหัสนี้เข้าระบบ',
      newPassword: 'รหัสผ่านใหม่',
      confirmPassword: 'พิมพ์รหัสผ่านใหม่อีกครั้ง',
      rules: 'อย่างน้อย 8 ตัวอักษร ใช้ภาษาไทยหรือเว้นวรรคได้ ห้ามใช้เบอร์โทร และห้ามใช้รหัสที่เดาง่าย เช่น 12345678',
      newBtn: 'บันทึกรหัสผ่านและเข้าสู่ระบบ',
      inTitle: 'เข้าสู่ระบบแล้ว',
      inName: (n) => n,
      toMenu: 'ไปหน้าเมนู',
      logout: 'ออกจากระบบ',
      logoutAsk: 'ออกจากระบบร้านจากเครื่องนี้? ครั้งหน้าต้องใส่เบอร์และรหัสผ่านใหม่',
      cancel: 'ยกเลิก',
      loggedOut: 'ออกจากระบบแล้ว',
      busyLogin: 'กำลังเข้าสู่ระบบ…',
      busySave: 'กำลังบันทึก…',
      err: {
        phone: 'เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0',
        password: 'กรอกรหัสผ่าน',
        mismatch: 'รหัสผ่านสองช่องไม่ตรงกัน',
        bad_login: 'เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง',
        locked: 'ใส่รหัสผิดหลายครั้ง ลองใหม่ในอีก 15 นาที หรือทักร้านทาง LINE',
        rate: 'ระบบหยุดรับการเข้าสู่ระบบชั่วคราว ลองใหม่ภายหลัง',
        temp_expired: 'รหัสชั่วคราวหมดอายุแล้ว ทักร้านทาง LINE เพื่อขอรหัสใหม่',
        change_expired: 'หมดเวลาตั้งรหัสผ่าน เข้าสู่ระบบด้วยรหัสชั่วคราวอีกครั้ง',
        password_short: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
        password_long: 'รหัสผ่านยาวเกินไป',
        password_phone: 'ห้ามใช้เบอร์โทรเป็นรหัสผ่าน',
        password_common: 'รหัสนี้เดาง่ายเกินไป ลองใช้คำที่ร้านจำได้ เช่น ชื่อเมนูกับตัวเลข',
        password_same: 'ใช้รหัสชั่วคราวเป็นรหัสผ่านไม่ได้ ตั้งรหัสใหม่',
        network: 'เชื่อมต่อไม่ได้ ตรวจเน็ตแล้วลองใหม่',
        server: 'ระบบขัดข้อง ลองใหม่อีกครั้ง',
        off: 'ระบบสมาชิกยังไม่เปิดใช้ สั่งของจากหน้าเมนูได้ตามปกติ',
      },
    },
    en: {
      backToMenu: 'Back to menu',
      loginTitle: 'Shop login',
      loginIntro: 'For shops with a Betagro Shop account. Log in once and order without typing your shop details again.',
      phone: "Shop's phone number",
      password: 'Password',
      show: 'Show',
      hide: 'Hide',
      tempHint: 'First time? Use the temporary password the shop gave you (e.g. ABCDE-FGHJK).',
      remember: 'Keep me logged in on this phone',
      rememberHint: "Stay logged in for 90 days. Untick on a phone you share.",
      loginBtn: 'Log in',
      forgot: "Forgot your password, or no account yet? Message us on LINE and we'll send a new temporary password.",
      askLine: 'Message us on LINE',
      newTitle: "Set your shop's password",
      newIntro: 'The temporary password works once. Choose a password your shop will remember and use it from now on.',
      newPassword: 'New password',
      confirmPassword: 'New password again',
      rules: 'At least 8 characters. Thai and spaces are fine. Not your phone number, and nothing easy to guess like 12345678.',
      newBtn: 'Save password and log in',
      inTitle: "You're logged in",
      inName: (n) => n,
      toMenu: 'Go to the menu',
      logout: 'Log out',
      logoutAsk: 'Log your shop out on this phone? You will need your phone number and password next time.',
      cancel: 'Cancel',
      loggedOut: 'Logged out',
      busyLogin: 'Logging in…',
      busySave: 'Saving…',
      err: {
        phone: 'Phone needs 9–10 digits starting with 0',
        password: 'Enter your password',
        mismatch: "The two passwords don't match",
        bad_login: 'Wrong phone number or password',
        locked: 'Too many wrong tries. Try again in 15 minutes, or message us on LINE.',
        rate: 'Login is paused for a while. Please try again later.',
        temp_expired: 'This temporary password has expired. Message us on LINE for a new one.',
        change_expired: 'Time ran out. Log in with the temporary password again.',
        password_short: 'Use at least 8 characters',
        password_long: 'That password is too long',
        password_phone: "Don't use your phone number as the password",
        password_common: 'Too easy to guess. Try something your shop will remember, like a dish name and a number.',
        password_same: "You can't keep the temporary password. Choose a new one.",
        network: "Can't connect. Check your internet and try again.",
        server: 'Something went wrong. Please try again.',
        off: 'Shop accounts are not open yet. You can still order from the menu as usual.',
      },
    },
  };

  const state = { lang: pickLanguage(), config: {}, view: 'login', change: '', phone: '', remember: true, busy: false, error: {} };
  const $ = (id) => document.getElementById(id);

  function storageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }
  function tabGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
  function tabSet(k, v) { try { sessionStorage.setItem(k, v); } catch (_) { /* private mode */ } }
  function forgetMember() { storageSet(STORE, ''); tabSet(STORE, ''); }

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
    try { m = JSON.parse(storageGet(STORE) || tabGet(STORE) || 'null'); } catch (_) { m = null; }
    return m && /^[0-9a-f]{64}$/.test(m.token || '') && typeof m.name === 'string' ? m : null;
  }

  function saveMember(res) {
    const s = res.shop || {};
    forgetMember();
    (state.remember ? storageSet : tabSet)(STORE, JSON.stringify({
      keep: state.remember,
      token: res.token,
      name: String(s.name || ''),
      phone_masked: String(s.phone_masked || ''),
      address_masked: String(s.address_masked || ''),
      logo_id: String(s.logo_id || ''),
      logo: /^data:image\/(png|jpeg|webp);base64,/.test(s.logo_data_url || '') ? s.logo_data_url : '',
    }));
  }

  async function getConfig() {
    for (const wait of [0, 800, 2000]) {
      if (wait) await new Promise((r) => { setTimeout(r, wait); });
      try {
        const res = await fetch('config.json', { cache: 'no-cache' });
        if (res.ok) return res.json();
        if (res.status === 404) break;
      } catch (_) { /* try again */ }
    }
    return {};
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

  // ---------- render ----------
  function render() {
    const t = TEXT[state.lang];
    document.documentElement.lang = state.lang;
    document.title = `${t.loginTitle} · Betagro Shop`;
    document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
    document.querySelectorAll('[data-t]').forEach((n) => { if (typeof t[n.dataset.t] === 'string') n.textContent = t[n.dataset.t]; });
    document.querySelectorAll('.pw__toggle').forEach((b) => { b.textContent = $(b.dataset.for).type === 'password' ? t.show : t.hide; });
    const branch = String(state.config.shop_name_en || '').replace(/^\s*Betagro Shop\s*/i, '');
    $('shop-branch').textContent = state.lang === 'th' ? String(state.config.shop_name_th || '').replace(/^\s*Betagro Shop\s*/i, '') : branch;
    $('m-line').href = state.config.line_oa_url || '#';
    $('m-line').hidden = !state.config.line_oa_url;

    $('v-login').hidden = state.view !== 'login';
    $('v-new').hidden = state.view !== 'new';
    $('v-in').hidden = state.view !== 'in';
    const m = loadMember();
    $('in-name').textContent = m ? t.inName(m.name) : '';
    showError('login-error', state.error.login);
    showError('new-error', state.error.new);
    setBusy(state.busy);
  }

  function showError(id, code) {
    const box = $(id);
    const t = TEXT[state.lang];
    box.textContent = code ? (t.err[code] || t.err.server) : '';
    box.hidden = !code;
  }

  function setBusy(on) {
    state.busy = on;
    [['login-submit', 'loginBtn', 'busyLogin'], ['new-submit', 'newBtn', 'busySave']].forEach(([id, idle, busy]) => {
      const btn = $(id);
      btn.disabled = on;
      btn.setAttribute('aria-busy', String(on));
      btn.querySelector('.spinner').hidden = !on;
      btn.querySelector('[data-t]').textContent = TEXT[state.lang][on ? busy : idle];
    });
  }

  function go(view) {
    state.view = view;
    state.error = {};
    render();
    const focus = { login: 'l-phone', new: 'n-password', in: 'v-in' }[view];
    if (focus) $(focus).focus();
  }

  // ---------- actions ----------
  async function onLogin(e) {
    e.preventDefault();
    if (state.busy) return;
    const phone = $('l-phone').value.replace(/\D/g, '');
    const password = $('l-password').value;
    state.error = {};
    if (!/^0\d{8,9}$/.test(phone)) { state.error.login = 'phone'; render(); $('l-phone').focus(); return; }
    if (!password) { state.error.login = 'password'; render(); $('l-password').focus(); return; }
    setBusy(true);
    state.remember = $('l-remember').checked;
    const res = await post({ action: 'login', phone, password, remember: state.remember });
    state.busy = false;
    if (res.ok && res.must_change && /^[0-9a-f]{64}$/.test(res.change_token || '')) {
      state.change = res.change_token;
      state.phone = phone;
      $('n-user').value = phone;
      $('l-password').value = '';
      go('new');
    } else if (res.ok && res.token) {
      saveMember(res);
      location.replace('./');
    } else {
      state.error.login = res.error || 'server';
      render();
    }
  }

  async function onNewPassword(e) {
    e.preventDefault();
    if (state.busy) return;
    const pw = $('n-password').value;
    state.error = {};
    if (Array.from(pw).length < 8) { state.error.new = 'password_short'; render(); $('n-password').focus(); return; }
    if (pw !== $('n-confirm').value) { state.error.new = 'mismatch'; render(); $('n-confirm').focus(); return; }
    setBusy(true);
    const res = await post({ action: 'set_password', change_token: state.change, new_password: pw, remember: state.remember });
    state.busy = false;
    if (res.ok && res.token) {
      saveMember(res);
      location.replace('./');
    } else if (res.error === 'change_expired') {
      state.change = '';
      go('login');
      state.error.login = 'change_expired';
      render();
    } else {
      state.error.new = res.error || 'server';
      render();
    }
  }

  async function logout() {
    const m = loadMember();
    forgetMember();
    $('logout-confirm').hidden = true;
    go('login');
    if (m) post({ action: 'logout', token: m.token });   // the phone forgets it at once; the server is told in the background
  }

  // ---------- boot ----------
  async function boot() {
    document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
      state.lang = b.dataset.lang;
      storageSet('menu-lang', state.lang);
      render();
    }));
    document.querySelectorAll('.pw__toggle').forEach((b) => b.addEventListener('click', () => {
      const input = $(b.dataset.for);
      input.type = input.type === 'password' ? 'text' : 'password';
      render();
    }));
    $('login-form').addEventListener('submit', onLogin);
    $('new-form').addEventListener('submit', onNewPassword);
    // Logging out needs a second tap (2026-10-24): the button is easy to hit by mistake.
    $('logout').addEventListener('click', () => { $('logout').hidden = true; $('logout-confirm').hidden = false; $('logout-no').focus(); });
    $('logout-no').addEventListener('click', () => { $('logout-confirm').hidden = true; $('logout').hidden = false; $('logout').focus(); });
    $('logout-yes').addEventListener('click', () => { $('logout').hidden = false; logout(); });
    state.view = loadMember() ? 'in' : 'login';
    render();
    state.config = await getConfig();
    render();
  }

  boot();
})();
