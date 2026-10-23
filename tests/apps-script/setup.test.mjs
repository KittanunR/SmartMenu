// setup() — the one-off, re-runnable sheet migration for shop accounts (Phase 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, guestOrder } from '../helpers/apps-script.mjs';

test('setup adds the account tabs with their columns', () => {
  const { ctx, sheet } = loadBackend();
  ctx.setup();
  assert.deepEqual(sheet('Member_Auth').header(),
    ['Customer_ID', 'Login_Phone', 'Password_Hash', 'Must_Change', 'Temp_Expires_At', 'Password_Set_At']);
  assert.deepEqual(sheet('Sessions').header(),
    ['Token_Hash', 'Customer_ID', 'Created_At', 'Expires_At', 'Last_Seen', 'Revoked_At']);
});

test('setup adds the new columns to the existing tabs', () => {
  const { ctx, sheet } = loadBackend();
  ctx.setup();
  assert.ok(sheet('Order').header().includes('Auth'));
  assert.ok(sheet('Order_Items').header().includes('Category'));
  for (const c of ['Logo_File_ID', 'Member_Status']) assert.ok(sheet('Master').header().includes(c), c);
});

test('setup adds Category to an Order_Items tab made by an earlier setup', () => {
  const { ctx, ss, sheet } = loadBackend();
  // The live sandbox already has this tab (2026-10-22), without Category.
  ss.insertSheet('Order_Items').appendRow(['Item_ID', 'Order_ID', 'SKU', 'Name_TH', 'Qty', 'Qty_Unit', 'Unit_Price', 'Line_Total']);
  ctx.setup();
  assert.deepEqual(sheet('Order_Items').header(),
    ['Item_ID', 'Order_ID', 'SKU', 'Name_TH', 'Qty', 'Qty_Unit', 'Unit_Price', 'Line_Total', 'Category']);
});

test('running setup again changes nothing and keeps the data', () => {
  const { ctx, ss, post } = loadBackend();
  ctx.setup();
  post(guestOrder());
  const before = JSON.stringify([...ss.sheets].map(([n, s]) => [n, s.cells]));
  ctx.setup();
  assert.equal(JSON.stringify([...ss.sheets].map(([n, s]) => [n, s.cells])), before);
});

test('backfillCategories fills Category on old item rows only', () => {
  const { ctx, sheet } = loadBackend();
  ctx.setup();
  const items = sheet('Order_Items');
  const head = items.header();
  const row = o => head.map(h => o[h] ?? '');
  items.appendRow(row({ Item_ID: 'W1-1', SKU: 'PK-002', Qty: 1 }));                    // from before Category existed
  items.appendRow(row({ Item_ID: 'W1-2', SKU: 'EG-001', Qty: 1 }));
  items.appendRow(row({ Item_ID: 'W1-3', SKU: 'CK-004', Qty: 1, Category: 'chicken' })); // already filled
  assert.equal(ctx.backfillCategories(), 2);
  assert.deepEqual(items.records().map(i => i.Category), ['pork', 'egg', 'chicken']);
});
