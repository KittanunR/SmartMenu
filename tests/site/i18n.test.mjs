// Six languages (2026-10-24): i18n.js must give Japanese, Chinese, Korean and Hindi every text the pages have in
// English, with the same kind of value (a function where English has a function). A missing one would show English.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ROOT } from '../../scripts/lib/checks.mjs';

const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const I18N = (() => { const ctx = { window: {} }; runInNewContext(read('i18n.js'), ctx); return ctx.window.SM_I18N; })();
const NEW = ['ja', 'zh', 'ko', 'hi'];

/** The page's own TEXT object (Thai + English), cut out of its source and run on its own. */
function pageText(file) {
  const s = read(file);
  const start = s.indexOf('const TEXT = {');
  const end = s.indexOf('\n  };\n', start);
  const unit = (s.match(/const UNIT = \{[\s\S]*?\n {2}\};\n {2}const enUnit[^\n]*\n/) || [''])[0];
  return runInNewContext(`${unit}const MAX_LINES = 40;${s.slice(start, end + 5)};TEXT`);
}
// Nested groups are compared key by key; these are lookup tables or the LINE message (stays Thai), compared whole.
const WHOLE = new Set(['unit', 'msg']);
const shape = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !WHOLE.has(k)
  ? shape(v, `${p}${k}.`) : [[`${p}${k}`, typeof v]]));

for (const [file, part] of [['app.js', 'menu'], ['member.js', 'member'], ['history.js', 'history']]) {
  test(`${file}: every English text also exists in ${NEW.join(', ')}, as the same kind of value`, () => {
    const en = shape(pageText(file).en).filter(([k]) => k !== 'msg');
    for (const lang of NEW) {
      const have = new Map(shape(I18N[part][lang]));
      for (const [key, kind] of en) {
        assert.ok(have.has(key), `${lang} ${part}: missing ${key}`);
        assert.equal(have.get(key), kind, `${lang} ${part}: ${key} should be a ${kind}`);
      }
    }
  });
}

test('the language list: six codes, a name for each, and the picker in every page offers exactly those', () => {
  assert.deepEqual([...I18N.codes], ['th', 'en', ...NEW]);   // spread: the array comes from another vm realm
  I18N.codes.forEach((l) => { assert.ok(I18N.names[l] && I18N.short[l], l); });
  for (const page of ['index.html', 'member.html', 'history.html']) {
    const offered = [...read(page).matchAll(/<option value="([a-z]{2})"/g)].map((m) => m[1]);
    assert.deepEqual(offered, [...I18N.codes], page);
  }
});

test('picking a language: ?lang= first, then the saved one, then the phone; English when nothing fits', () => {
  assert.equal(I18N.pick('ko', 'ja', 'th-TH'), 'ko');
  assert.equal(I18N.pick('xx', 'ja', 'th-TH'), 'ja');
  assert.equal(I18N.pick(null, null, 'zh-CN'), 'zh');
  assert.equal(I18N.pick(null, null, 'hi-IN'), 'hi');
  assert.equal(I18N.pick(null, null, 'fr-FR'), 'en');
});

test('every active product has a name in all four new languages', () => {
  const { products } = JSON.parse(read('data/catalog.json'));
  for (const p of products.filter((x) => x.active)) {
    NEW.forEach((l) => { assert.ok(p[`name_${l}`], `${p.sku} name_${l}`); });
  }
});

test('ja / zh / ko week ranges are written out (Intl gives 2026/10/24～2026/10/30); the year only across a new year', () => {
  const r = (lang, a, b) => I18N.menu[lang].dateRange(new Date(...a), new Date(...b));
  assert.equal(r('ja', [2026, 9, 24], [2026, 9, 30]), '10月24日〜30日');
  assert.equal(r('zh', [2026, 9, 27], [2026, 10, 2]), '10月27日–11月2日');
  assert.equal(r('ko', [2026, 9, 24], [2026, 9, 30]), '10월 24일~30일');
  assert.equal(r('ko', [2026, 11, 28], [2027, 0, 3]), '2026년 12월 28일~2027년 1월 3일');
  assert.equal(r('ja', [2026, 9, 24], [2026, 9, 24]), '2026年10月24日');
});
