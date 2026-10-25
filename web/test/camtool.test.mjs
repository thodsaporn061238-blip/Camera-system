// ทดสอบด้วยโมดูลจำลอง (ไม่ต้องต่อกล้องจริง)  รัน: node --test web/test
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ATClient, ATError, backup, gpsFix, parseGpsloc, quectelChecksum, readInfo, readableScore, restore,
} from '../camtool.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

// จำลอง Quectel EC200U เหมือน tests/test_camtool.py
class FakeModule {
  constructor(files = {}, gpsAfter = 0) {
    this.files = new Map(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? enc.encode(v) : v]));
    this.gpsAfter = gpsAfter;
    this.uploading = null;
    this.client = null;
  }

  emit(...parts) {
    const chunks = parts.map((p) => (typeof p === 'string' ? enc.encode(`\r\n${p}\r\n`) : p));
    // ส่งทีละก้อนแบบ async เหมือนข้อมูลที่ทยอยเข้ามาจาก USB
    for (const c of chunks) setTimeout(() => this.client.feed(c), 0);
  }

  async write(data) {
    if (this.uploading) {
      const u = this.uploading;
      u.buf = new Uint8Array([...u.buf, ...data]);
      if (u.buf.length >= u.size) {
        this.files.set(u.name, u.buf.slice(0, u.size));
        this.uploading = null;
        this.emit(`+QFUPL: ${u.size},${quectelChecksum(this.files.get(u.name)).toString(16)}`, 'OK');
      }
      return;
    }
    const cmd = dec.decode(data).trim();
    this.emit(data); // echo
    let m;
    if (cmd === 'AT+CGSN') this.emit('866123456789012', 'OK');
    else if (cmd === 'AT+CGMM') this.emit('EC200U', 'OK');
    else if (cmd === 'AT+QICSGP=1') this.emit('+QICSGP: 1,"internet","","",0', 'OK');
    else if (cmd === 'AT+CIMI') this.emit('+CME ERROR: 10');
    else if (cmd.startsWith('AT+QFLST')) {
      this.emit(...[...this.files].map(([n, d]) => `+QFLST: "${n}",${d.length}`), 'OK');
    } else if ((m = cmd.match(/^AT\+QFDWL="(.+)"$/))) {
      const d = this.files.get(m[1]);
      if (!d) return this.emit('+CME ERROR: 405');
      this.emit('CONNECT', d, `+QFDWL: ${d.length},${quectelChecksum(d).toString(16)}`, 'OK');
    } else if ((m = cmd.match(/^AT\+QFUPL="(.+)",(\d+),\d+$/))) {
      this.uploading = { name: m[1], size: Number(m[2]), buf: new Uint8Array() };
      this.emit('CONNECT');
    } else if ((m = cmd.match(/^AT\+QFDEL="(.+)"$/))) {
      this.emit(this.files.delete(m[1]) ? 'OK' : '+CME ERROR: 405');
    } else if (cmd === 'AT+QGPS=1') this.emit('OK');
    else if (cmd === 'AT+QGPSLOC=2') {
      if (this.gpsAfter-- > 0) return this.emit('+CME ERROR: 516');
      this.emit('+QGPSLOC: 061951.000,13.75633,100.50177,1.1,12.3,3,0.00,25.4,13.7,251026,08', 'OK');
    } else this.emit('ERROR');
  }
}

function connect(module) {
  const at = new ATClient(module, 1000);
  module.client = at;
  return at;
}

test('query ตัด echo และหัวคำตอบ', async () => {
  const at = connect(new FakeModule());
  assert.equal(await at.query('AT+CGSN'), '866123456789012');
  assert.equal(await at.query('AT+QICSGP=1'), '1,"internet","","",0');
});

test('ERROR กลายเป็น ATError', async () => {
  const at = connect(new FakeModule());
  await assert.rejects(at.command('AT+CIMI'), (e) => e instanceof ATError && e.reply === '+CME ERROR: 10');
});

test('อ่านไฟล์ไบนารีที่มีข้อความคล้ายคำตอบอยู่ข้างใน', async () => {
  const data = new Uint8Array([...Array(256).keys(), ...enc.encode('\r\nOK\r\n+QFDWL: 1,0\r\nx')]);
  const at = connect(new FakeModule({ 'UFS:cfg.bin': data }));
  assert.deepEqual(await at.downloadFile('UFS:cfg.bin', 1000), data);
});

test('เขียนไฟล์แล้วอ่านกลับได้เหมือนเดิม', async () => {
  const module = new FakeModule();
  const at = connect(module);
  await at.uploadFile('UFS:new.cfg', enc.encode('server=1.2.3.4:6808\n'), 1000);
  assert.equal(dec.decode(module.files.get('UFS:new.cfg')), 'server=1.2.3.4:6808\n');
  assert.equal(dec.decode(await at.downloadFile('UFS:new.cfg', 1000)), 'server=1.2.3.4:6808\n');
});

test('checksum กรณีจำนวนไบต์เป็นเลขคี่', () => {
  assert.equal(quectelChecksum(new Uint8Array([0x12, 0x34, 0x56])), 0x1234 ^ 0x5600);
});

test('readInfo อ่านต่อแม้บางคำสั่งไม่รองรับ', async () => {
  const info = await readInfo(connect(new FakeModule()));
  assert.equal(info.imei, '866123456789012');
  assert.equal(info.model, 'EC200U');
  assert.deepEqual(info.imsi, { error: '+CME ERROR: 10' });
});

test('GPS รอจนได้ตำแหน่ง', async () => {
  const fix = await gpsFix(connect(new FakeModule({}, 2)), { wait: 5000, interval: 0 });
  assert.equal(fix.lat, 13.75633);
  assert.equal(fix.satellites, 8);
  assert.equal(fix.fix, '3D');
  assert.equal(parseGpsloc('1,2,3'), null);
});

test('สำรองแล้วเขียนกลับ และไม่ยอมเขียนไฟล์สำรองที่ถูกแก้', async () => {
  const files = { 'UFS:app.cfg': 'ip=old.example.com\n', 'UFS:cert.pem': '-----BEGIN-----' };
  const module = new FakeModule(files);
  const at = connect(module);
  const { folder, entries } = await backup(at);
  assert.match(folder, /^866123456789012_\d{8}-\d{6}$/);
  const manifest = JSON.parse(dec.decode(entries['manifest.json']));
  assert.equal(manifest.files.length, 2);

  module.files.clear();
  await restore(at, async (p) => entries[p]);
  assert.deepEqual(Object.fromEntries([...module.files].map(([k, v]) => [k, dec.decode(v)])), files);

  entries[manifest.files[0].local] = enc.encode('tampered');
  await assert.rejects(restore(at, async (p) => entries[p]), /ถูกแก้หรือเสีย/);
});

test('readableScore', () => {
  assert.equal(readableScore(enc.encode('U-Boot 2016\r\n')), 1);
  assert.ok(readableScore(new Uint8Array(128).map((_, i) => 128 + i)) < 0.1);
});

test('zip: เขียนแล้วอ่านกลับ และอ่าน zip แบบบีบอัด (deflate) ได้', async () => {
  const { createZip, readZip } = await import('../zip.js');
  const entries = { 'a/info.json': enc.encode('{"imei":"1"}'), 'a/files/ไฟล์.bin': new Uint8Array([0, 255, 13, 10]) };
  const zip = readZip(createZip(entries));
  assert.deepEqual(Object.keys(zip), Object.keys(entries));
  for (const [k, v] of Object.entries(entries)) assert.deepEqual(await zip[k](), v);

  // zip ที่ Python zipfile สร้างแบบ ZIP_DEFLATED มีไฟล์ hello.txt = "hello hello hello hello"
  const deflated = Buffer.from(
    'UEsDBBQAAAAIAAAAIQDjUT2NCgAAABcAAAAJAAAAaGVsbG8udHh0y0jNyclXyEAnAVBLAQIUAxQAAAAIAAAAIQDjUT2NCgAAABcAAAAJAAAAAAAAAAAAAACAAQAAAABoZWxsby50eHRQSwUGAAAAAAEAAQA3AAAAMQAAAAAA',
    'base64');
  assert.equal(dec.decode(await readZip(new Uint8Array(deflated))['hello.txt']()), 'hello hello hello hello');
});
