// ทดสอบไฟล์ออกแบบหน้าจอ  รัน: node --test web/test/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SAMPLE_READINGS, expandTemplate, makeLookup, validateLayout } from '../layout.js';

const cfg = {
  title: 'TPMS',
  names: ['ล้อหน้าซ้าย', 'ล้อหน้าขวา', 'ล้อหลังซ้าย', 'ล้อหลังขวา'],
  macs: ['aa', '', '', ''],
  unit: 'psi',
  low: 28,
  high: 45,
  hot: 75,
  colors: { bg: '#000000', tile: '#1A1D24', text: '#FFFFFF', ok: '#35D05A', low: '#FF4040', high: '#FFA000', stale: '#6B7280' },
};

test('expandTemplate ตรงกับฝั่งบอร์ด', () => {
  const lookup = (k) => ({ 'fl.p': '34.2', unit: 'PSI' })[k];
  assert.equal(expandTemplate('{fl.p} {unit}', lookup), '34.2 PSI');
  assert.equal(expandTemplate('{พิมพ์ผิด} {unit}', lookup), '{พิมพ์ผิด} PSI');
  assert.equal(expandTemplate('ค้าง {unit', lookup), 'ค้าง {unit');
  assert.equal(expandTemplate('{}{unit}', lookup), '{}PSI');
});

test('makeLookup ให้ค่าและสีตามสถานะ', () => {
  const look = makeLookup({ cfg, readings: SAMPLE_READINGS, status: 'พร้อม' });
  assert.equal(look('fl.p'), '34.2');
  assert.equal(look('fl.color'), '#35D05A');
  assert.equal(look('fl.border'), '#1A1D24');
  assert.equal(look('fl.info'), '33°C | 91%');
  assert.equal(look('fr.status'), 'ลมต่ำ');
  assert.equal(look('fr.color'), '#FF4040');
  assert.equal(look('fr.batt'), '2.8V');
  assert.equal(look('rl.status'), 'ลมสูง/ร้อน');
  assert.equal(look('rr.p'), '--');
  assert.equal(look('rr.info'), 'กดค้างเพื่อจับคู่');
  assert.equal(look('fl.name'), 'ล้อหน้าซ้าย');
  assert.equal(look('c.tile'), '#1A1D24');
  assert.equal(look('unit'), 'PSI');
  assert.equal(look('status'), 'พร้อม');
  assert.equal(look('fl.nope'), undefined);
  assert.equal(makeLookup({ cfg: { ...cfg, unit: 'bar' }, readings: SAMPLE_READINGS })('fl.p'), '2.36');
});

test('validateLayout จับปัญหาที่พบบ่อย', () => {
  assert.deepEqual(validateLayout({ items: [] }), []);
  assert.match(validateLayout([])[0], /\{ \.\.\. \}/);
  assert.match(validateLayout({})[0], /items/);
  const errs = validateLayout({ items: [{ type: 'circle' }, { x: '5' }, { x: 400 }, { type: 'box', pair: 'xx' }] });
  assert.equal(errs.length, 4);
});

test('แม่แบบทุกไฟล์ใน firmware/tpms/layouts ใช้ได้ และมีในรายการ', () => {
  const dir = new URL('../../firmware/tpms/layouts/', import.meta.url);
  const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  assert.ok(index.some((t) => t.file === 'default.json'));
  for (const t of index) {
    const layout = JSON.parse(readFileSync(new URL(t.file, dir), 'utf8'));
    assert.deepEqual(validateLayout(layout), [], t.file);
    const look = makeLookup({ cfg, readings: SAMPLE_READINGS });
    for (const it of layout.items) {
      for (const k of ['text', 'color', 'bg', 'border']) {
        if (it[k]) assert.doesNotMatch(expandTemplate(it[k], look), /\{/, `${t.file}: ${it[k]}`);
      }
    }
  }
});
