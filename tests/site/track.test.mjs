// track.js (2026-11-12): nothing leaves the phone before "ยอมรับ"; declining after accepting asks the server to delete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, Script } from 'node:vm';
import { ROOT } from '../../scripts/lib/checks.mjs';

const URL = 'https://script.google.com/macros/s/AKfyc-test_123/exec';

function load() {
  const ctx = createContext({});
  new Script(readFileSync(join(ROOT, 'track.js'), 'utf8'), { filename: 'track.js' }).runInContext(ctx);
  const store = new Map();
  const sent = [];
  const timers = [];
  let t = Date.parse('2026-11-12T08:00:00Z');
  let n = 0;
  const core = ctx.SM_TRACK_CORE({
    storage: { get: k => (store.has(k) ? store.get(k) : null), set: (k, v) => store.set(k, v), remove: k => store.delete(k) },
    random: len => Array.from({ length: len }, () => (n++ * 37) & 0xff),
    now: () => t,
    setTimer: fn => { timers.push(fn); return timers.length; },
    send: (url, body) => sent.push({ url, body: JSON.parse(body) }),
  });
  const tick = () => { while (timers.length) timers.shift()(); };
  return { core, store, sent, tick, later: ms => { t += ms; }, ctx };
}
const CTX = { page: 'menu', lang: 'th', member: false, device: 'mobile-ios', source: 'direct' };
const names = sent => sent.flatMap(s => (s.body.events || []).map(e => e.e));

test('the page does not try to run the browser part in Node', () => {
  const { ctx } = load();
  assert.equal(ctx.SM_TRACK, undefined);
});

test('undecided: the banner is asked for, nothing is sent and no id is stored', () => {
  const b = load();
  assert.equal(b.core.start(URL, CTX), true);
  b.core.event('product_open', { sku: 'PK-001' });
  b.tick(); b.core.flush();
  assert.deepEqual(b.sent, []);
  assert.equal(b.store.has('sm-vid'), false);
});

test('declined: nothing is sent, and the banner is not asked again', () => {
  const b = load();
  b.core.start(URL, CTX);
  b.core.decide(false);
  b.core.event('product_open', { sku: 'PK-001' });
  b.tick(); b.core.flush();
  assert.deepEqual(b.sent, []);
  assert.equal(load().core.start(URL, CTX), true);           // a fresh phone is asked
  assert.equal(b.core.start(URL, CTX), false);               // this one is not
});

test('accepted: consent + page view, then events in batches with a random visitor and session id', () => {
  const b = load();
  b.core.start(URL, CTX);
  b.core.decide(true);
  assert.deepEqual(names(b.sent), ['consent', 'page_view']);
  b.core.event('product_open', { sku: 'PK-001', price: 80 });
  b.core.sawSku('PK-001'); b.core.sawSku('EG-001'); b.core.sawSku('PK-001');
  b.tick();
  assert.deepEqual(names(b.sent), ['consent', 'page_view', 'product_open', 'tiles_seen']);
  const last = b.sent[b.sent.length - 1].body;
  assert.match(last.visitor, /^v[0-9a-f]{32}$/);
  assert.match(last.session, /^s[0-9a-f]{32}$/);
  assert.equal(last.lang, 'th');
  assert.deepEqual(last.events[1].skus, ['PK-001', 'EG-001']);
  assert.equal(b.sent.every(s => s.url === URL), true);
});

test('same visitor next time; a new session after 30 minutes away', () => {
  const b = load();
  b.core.start(URL, CTX);
  b.core.decide(true);
  const first = b.sent[0].body;
  b.later(10 * 60 * 1000); b.core.event('search', { detail: 'wing' }); b.tick();
  b.later(31 * 60 * 1000); b.core.event('search', { detail: 'egg' }); b.tick();
  const [, mid, late] = b.sent.map(s => s.body);
  assert.equal(mid.visitor, first.visitor); assert.equal(mid.session, first.session);
  assert.equal(late.visitor, first.visitor); assert.notEqual(late.session, first.session);
});

test('declining after accepting: the server is asked to delete, ids are removed', () => {
  const b = load();
  b.core.start(URL, CTX);
  b.core.decide(true);
  const vid = b.store.get('sm-vid');
  b.core.event('cart_add', { sku: 'PK-001' });
  b.core.decide(false);
  b.tick();
  const last = b.sent[b.sent.length - 1].body;
  assert.deepEqual(last, { action: 'forget', visitor: vid, lang: 'th', device: 'mobile-ios' });
  assert.equal(names(b.sent).includes('cart_add'), false);   // queued event was dropped, not sent
  assert.equal(b.store.has('sm-vid'), false);
  assert.equal(b.store.has('sm-sid'), false);
});

test('no or wrong endpoint: no banner, nothing sent even after an old "yes"', () => {
  const b = load();
  b.core.start(URL, CTX); b.core.decide(true);
  const before = b.sent.length;
  const c = load();
  c.store.set('sm-consent', b.store.get('sm-consent'));
  assert.equal(c.core.start('', CTX), false);
  assert.equal(c.core.start('https://evil.example/collect', CTX), false);
  c.core.event('page_view', {}); c.tick(); c.core.flush();
  assert.deepEqual(c.sent, []);
  assert.ok(before > 0);
});

test('a new privacy version asks everyone again', () => {
  const b = load();
  b.store.set('sm-consent', JSON.stringify({ v: '2025-01-01', choice: 'yes' }));
  assert.equal(b.core.start(URL, CTX), true);
  b.core.event('page_view', {}); b.tick();
  assert.deepEqual(b.sent, []);
});
