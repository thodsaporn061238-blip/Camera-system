// ทดสอบตัวแปลคำสั่งภาษาไทย  รัน: node --test web/test/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateLayout } from '../layout.js';
import { THAI_EXAMPLES, applyThaiCommands } from '../thai_commands.js';

const base = JSON.parse(readFileSync(new URL('../../firmware/tpms/layouts/default.json', import.meta.url), 'utf8'));
const run = (cmd, layout = base) => applyThaiCommands(layout, cmd);
const find = (layout, text) => layout.items.filter((it) => it.text === text);

test('เปลี่ยนสีตัวเลขล้อเดียว ไม่แตะล้ออื่น และไม่แก้ไฟล์เดิม', () => {
  const r = run('เปลี่ยนสีตัวเลขล้อหน้าซ้ายเป็นฟ้า');
  assert.ok(r.changed, r.results[0].message);
  assert.equal(find(r.layout, '{fl.p}')[0].color, '#00AEEF');
  assert.equal(find(r.layout, '{fr.p}')[0].color, '{fr.color}');
  assert.equal(find(base, '{fl.p}')[0].color, '{fl.color}');
});

test('ขยายชื่อทุกล้อ: 16 -> 24 และไม่เกิน 24 เพราะ 48 มีแค่ตัวเลข', () => {
  let r = run('ขยายชื่อทุกล้อ');
  for (const w of ['fl', 'fr', 'rl', 'rr']) assert.equal(find(r.layout, `{${w}.name} ({unit})`)[0].font, 24);
  r = run('ขยายชื่อทุกล้อ', r.layout);
  assert.equal(r.changed, false);
  assert.match(r.results[0].message, /ใหญ่สุด/);
});

test('ช่องสีตามสถานะ, ขอบสีแดง, พื้นหลังสีน้ำเงิน', () => {
  const r = run('ช่องทุกล้อสีตามสถานะ\nขอบล้อหลังสีแดง, พื้นหลังสีน้ำเงิน');
  assert.deepEqual(r.results.map((x) => x.ok), [true, true, true]);
  const boxes = r.layout.items.filter((it) => it.type === 'box' && it.pair);
  assert.equal(boxes.find((b) => b.pair === 'fl').bg, '{fl.color}');
  assert.equal(boxes.find((b) => b.pair === 'rl').border, '#FF3B30');
  assert.equal(boxes.find((b) => b.pair === 'fl').border, '{fl.border}');
  assert.equal(r.layout.bg, '#1E5BFF');
  // ตัวเลขที่เคยเป็นสีตามสถานะต้องไม่กลืนกับช่องที่เป็นสีตามสถานะ
  assert.equal(find(r.layout, '{fl.p}')[0].color, '#000000');
  assert.match(r.results[0].message, /สีดำ/);
});

test('ย้ายหัวข้อ, เปลี่ยนข้อความหัวข้อ, หัวข้อเป็นสีแดง = เปลี่ยนสี', () => {
  let r = run('ย้ายหัวข้อลง 10');
  const title = r.layout.items.find((it) => it.text === '{title}');
  assert.equal(title.y, 16);
  r = run('หัวข้อเป็น รถ 01', r.layout);
  assert.equal(find(r.layout, 'รถ 01').length, 1);
  r = run('หัวข้อเป็นสีแดง', r.layout);
  assert.equal(find(r.layout, 'รถ 01')[0].color, '#FF3B30');
});

test('เพิ่มข้อความ และซ่อนข้อมูลล้อเดียว', () => {
  let r = run("เพิ่มข้อความ 'ขับขี่ปลอดภัย' ด้านล่าง");
  const added = find(r.layout, 'ขับขี่ปลอดภัย')[0];
  assert.ok(added && added.y > 200);
  r = run('ซ่อนข้อมูลล้อหลังขวา', r.layout);
  assert.equal(find(r.layout, '{rr.info}').length, 0);
  assert.equal(find(r.layout, '{rl.info}').length, 1);
});

test('คำสั่งที่ไม่เข้าใจ บอกเหตุผลและไม่เปลี่ยนอะไร', () => {
  const r = run('ทำให้สวยขึ้น');
  assert.equal(r.changed, false);
  assert.match(r.results[0].message, /ส่วนไหน/);
  assert.match(run('ย้ายตัวเลข').results[0].message, /ทิศ/);
});

test('ตัวอย่างคำสั่งทุกข้อใช้ได้ และผลลัพธ์ยังเป็นไฟล์ออกแบบที่ถูกต้อง', () => {
  let layout = base;
  for (const cmd of THAI_EXAMPLES) {
    const r = run(cmd, layout);
    assert.ok(r.changed, `${cmd}: ${r.results.map((x) => x.message).join(' / ')}`);
    assert.deepEqual(validateLayout(r.layout), [], cmd);
    layout = r.layout;
  }
});
