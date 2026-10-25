// ทดสอบการคุยกับโปรแกรม SNP TPMS บนจอ  รัน: node --test web/test/*.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAssign, buildSet, lineSplitter, parseLine } from '../tpms.js';

const enc = new TextEncoder();

test('parseLine รับเฉพาะบรรทัด JSON', () => {
  assert.deepEqual(parseLine('{"hello":{"app":"snp-tpms","version":"1.0.0"}}\r'), { hello: { app: 'snp-tpms', version: '1.0.0' } });
  assert.equal(parseLine('rst:0x1 (POWERON_RESET)'), null);
  assert.equal(parseLine('{ไม่ใช่ json'), null);
  assert.equal(parseLine(''), null);
});

test('lineSplitter ต่อบรรทัดที่มาเป็นท่อน ๆ และข้ามข้อความ log', () => {
  const got = [];
  const feed = lineSplitter((o) => got.push(o));
  feed(enc.encode('ets Jun  8 2016\r\n{"sensor":{"mac":"80:ea'));
  feed(enc.encode(':ca:10:8a:78","psi":34.2}}\r\n{"cfg":'));
  assert.equal(got.length, 1);
  assert.equal(got[0].sensor.psi, 34.2);
  feed(enc.encode('{"unit":"psi"}}\n'));
  assert.deepEqual(got[1], { cfg: { unit: 'psi' } });
});

test('lineSplitter แยกตัวอักษรไทยที่ถูกตัดกลางไบต์ได้ถูกต้อง', () => {
  const got = [];
  const feed = lineSplitter((o) => got.push(o));
  const bytes = enc.encode('{"cfg":{"title":"ล้อหน้า"}}\n');
  feed(bytes.slice(0, 15));
  feed(bytes.slice(15));
  assert.equal(got[0].cfg.title, 'ล้อหน้า');
});

test('buildSet แปลงตัวเลขจากฟอร์ม', () => {
  const cmd = buildSet({
    title: 'รถ 1', names: ['a', 'b', 'c', 'd'], unit: 'kpa', low: '28', high: '45.5', hot: '75',
    colors: { ok: '#00FF00' }, buzzer: true, bright: '200', rot: '3', invert: false,
  });
  assert.equal(cmd.set.high, 45.5);
  assert.equal(cmd.set.rot, 3);
  assert.equal(cmd.set.unit, 'kpa');
  assert.deepEqual(cmd.set.names, ['a', 'b', 'c', 'd']);
});

test('buildAssign เปลี่ยนแค่ล้อที่เลือก', () => {
  assert.deepEqual(buildAssign(2, '80:ea:ca:10:8a:78'), { set: { macs: [null, null, '80:ea:ca:10:8a:78', null] } });
});
