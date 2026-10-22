#!/usr/bin/env node
// Make a printable QR code PNG for the menu URL.
// Usage: node scripts/make-qr.mjs <url> [out.png]
//   e.g. node scripts/make-qr.mjs https://<user>.github.io/price-menu/ docs/qr/menu.png
// Tip: add ?lang=en to the URL for a QR that always opens in English.
// Needs the dev dependency `qrcode` (run `npm install` once).
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [url, out = 'docs/qr/menu-qr.png'] = process.argv.slice(2);
if (!url || !/^https?:\/\//.test(url)) {
  console.error('Usage: node scripts/make-qr.mjs <https://...> [out.png]');
  process.exit(2);
}

let QRCode;
try {
  QRCode = (await import('qrcode')).default;
} catch {
  console.error('Missing dependency: run `npm install` first.');
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
await QRCode.toFile(out, url, {
  errorCorrectionLevel: 'M', // survives a smudged or slightly folded print
  margin: 4,
  width: 1024,               // sharp when printed at ~5 cm
  color: { dark: '#0A5A32', light: '#FFFFFF' },
});
console.log(`QR for ${url} -> ${out}`);
