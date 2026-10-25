// คุยกับโมดูล 4G ของกล้องด้วยคำสั่ง AT (ตรงกับ camtool/at.py, device.py, backup.py ฝั่ง Python)
// ไฟล์นี้ไม่แตะหน้าเว็บ จึงทดสอบด้วย node ได้

export class ATError extends Error {
  constructor(command, reply) {
    super(`${command} -> ${reply}`);
    this.command = command;
    this.reply = reply;
  }
}

export class ATTimeout extends Error {
  constructor() {
    super('กล้องไม่ตอบ');
  }
}

const FINAL_ERROR = /^(ERROR|\+CME ERROR:.*|\+CMS ERROR:.*)$/;
const QFDWL_END = /\r\n\+QFDWL: (\d+),([0-9A-Fa-f]+)\r\n/g;
const QFUPL_END = /\+QFUPL: (\d+),([0-9A-Fa-f]+)\r\n/g;

// ข้อมูลเก็บเป็นสตริงที่ 1 ตัวอักษร = 1 ไบต์ จะได้ใช้ regex กับข้อมูลไบนารีได้
const toBinary = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');
const fromBinary = (str) => Uint8Array.from(str, (c) => c.charCodeAt(0));
const utf8 = new TextDecoder();

export function quectelChecksum(data) {
  let value = 0;
  for (let i = 0; i < data.length; i += 2) {
    value ^= (data[i] << 8) | (i + 1 < data.length ? data[i + 1] : 0);
  }
  return value;
}

export class ATClient {
  // transport ต้องมี write(Uint8Array) และเรียก client.feed(bytes) เมื่อมีข้อมูลเข้า
  constructor(transport, timeout = 5000) {
    this.transport = transport;
    this.timeout = timeout;
    this.buf = '';
    this.waiter = null;
  }

  feed(bytes) {
    this.buf += toBinary(bytes);
    if (this.waiter) this.waiter();
  }

  async fill(deadline) {
    const ms = deadline - Date.now();
    if (ms <= 0) throw new ATTimeout();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new ATTimeout());
      }, ms);
      this.waiter = () => {
        clearTimeout(timer);
        this.waiter = null;
        resolve();
      };
    });
  }

  async readline(deadline) {
    while (!this.buf.includes('\n')) await this.fill(deadline);
    const i = this.buf.indexOf('\n');
    const line = this.buf.slice(0, i);
    this.buf = this.buf.slice(i + 1);
    return utf8.decode(fromBinary(line)).trim();
  }

  async readUntil(pattern, deadline, accept = () => true) {
    for (;;) {
      pattern.lastIndex = 0;
      for (const match of this.buf.matchAll(pattern)) {
        if (accept(match)) return match;
      }
      await this.fill(deadline);
    }
  }

  async send(text) {
    this.buf = '';
    await this.transport.write(new TextEncoder().encode(text));
  }

  async waitConnect(label, deadline) {
    for (;;) {
      const line = await this.readline(deadline);
      if (line === 'CONNECT') return;
      if (FINAL_ERROR.test(line)) throw new ATError(label, line);
    }
  }

  async waitOk(deadline) {
    while ((await this.readline(deadline)) !== 'OK');
  }

  // ส่งคำสั่งแล้วคืนบรรทัดคำตอบ (ไม่รวม echo และ OK)
  async command(cmd, timeout) {
    const deadline = Date.now() + (timeout ?? this.timeout);
    await this.send(cmd + '\r');
    const lines = [];
    for (;;) {
      const line = await this.readline(deadline);
      if (!line || line === cmd) continue;
      if (line === 'OK') return lines;
      if (FINAL_ERROR.test(line)) throw new ATError(cmd, line);
      lines.push(line);
    }
  }

  // เหมือน command แต่คืนข้อความเดียว และตัดหัว +XXX: ออก
  async query(cmd, timeout) {
    const lines = await this.command(cmd, timeout);
    const prefix = cmd.slice(2).split('=')[0].replace(/\?$/, '') + ':';
    return lines.map((l) => (l.startsWith(prefix) ? l.slice(prefix.length).trim() : l)).join('\n');
  }

  async listFiles(pattern = '*') {
    const files = [];
    for (const line of await this.command(`AT+QFLST="${pattern}"`, 15000)) {
      const m = line.match(/^\+QFLST: "([^"]+)",(\d+)/);
      if (m) files.push({ name: m[1], size: Number(m[2]) });
    }
    return files;
  }

  async downloadFile(name, timeout = 120000) {
    const deadline = Date.now() + timeout;
    const label = `QFDWL ${name}`;
    await this.send(`AT+QFDWL="${name}"\r`);
    await this.waitConnect(label, deadline);
    // ข้อมูลไฟล์อาจมีข้อความหน้าตาเหมือน +QFDWL อยู่ข้างใน จึงรับเฉพาะตัวที่ขนาดตรงกับตำแหน่ง
    const m = await this.readUntil(QFDWL_END, deadline, (m) => Number(m[1]) === m.index);
    const data = fromBinary(this.buf.slice(0, m.index));
    this.buf = this.buf.slice(m.index + m[0].length);
    await this.waitOk(deadline);
    if (data.length !== Number(m[1])) throw new ATError(label, `ได้ ${data.length} ไบต์ แต่โมดูลบอก ${m[1]}`);
    if (quectelChecksum(data) !== parseInt(m[2], 16)) throw new ATError(label, 'checksum ไม่ตรง');
    return data;
  }

  async uploadFile(name, data, timeout = 120000) {
    const deadline = Date.now() + timeout;
    const label = `QFUPL ${name}`;
    await this.send(`AT+QFUPL="${name}",${data.length},${Math.round(timeout / 1000)}\r`);
    await this.waitConnect(label, deadline);
    await this.transport.write(data);
    const m = await this.readUntil(QFUPL_END, deadline);
    this.buf = this.buf.slice(m.index + m[0].length);
    await this.waitOk(deadline);
    if (Number(m[1]) !== data.length || parseInt(m[2], 16) !== quectelChecksum(data)) {
      throw new ATError(label, 'โมดูลรับข้อมูลไม่ครบหรือ checksum ไม่ตรง');
    }
  }
}

// ชื่อข้อมูล -> [คำอธิบาย, คำสั่ง AT]
export const INFO_COMMANDS = {
  manufacturer: ['ผู้ผลิตโมดูล', 'AT+CGMI'],
  model: ['รุ่นโมดูล', 'AT+CGMM'],
  revision: ['เวอร์ชันเฟิร์มแวร์', 'AT+CGMR'],
  quectel_revision: ['เวอร์ชันเฟิร์มแวร์ (ละเอียด)', 'AT+QGMR'],
  imei: ['IMEI', 'AT+CGSN'],
  imsi: ['IMSI (ซิม)', 'AT+CIMI'],
  iccid: ['ICCID (เลขซิม)', 'AT+QCCID'],
  signal: ['ความแรงสัญญาณ', 'AT+CSQ'],
  network_reg: ['ลงทะเบียนเครือข่าย', 'AT+CREG?'],
  lte_reg: ['ลงทะเบียน 4G', 'AT+CEREG?'],
  operator: ['ผู้ให้บริการเครือข่าย', 'AT+COPS?'],
  pdp_contexts: ['APN ที่ตั้งไว้', 'AT+CGDCONT?'],
  apn_config: ['APN (Quectel)', 'AT+QICSGP=1'],
  gnss_power: ['GPS เปิดอยู่ไหม', 'AT+QGPS?'],
  usb_config: ['โหมด USB', 'AT+QCFG="usbnet"'],
};

export async function readInfo(at, onEach) {
  const info = {};
  for (const [key, [, cmd]] of Object.entries(INFO_COMMANDS)) {
    try {
      info[key] = await at.query(cmd);
    } catch (e) {
      if (!(e instanceof ATError)) throw e;
      info[key] = { error: e.reply };
    }
    onEach?.(key, info[key]);
  }
  return info;
}

export function parseGpsloc(text) {
  const p = text.split(',');
  if (p.length < 11) return null;
  const [utc, lat, lon, hdop, alt, fix, cog, spkm, , date, nsat] = p;
  return {
    utc,
    date,
    lat: Number(lat),
    lon: Number(lon),
    hdop: Number(hdop),
    altitude_m: Number(alt),
    fix: fix === '3' ? '3D' : '2D',
    course: cog ? Number(cog) : null,
    speed_kmh: Number(spkm),
    satellites: Number(nsat),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function gpsFix(at, { wait = 180000, interval = 5000, onWait, signal } = {}) {
  try {
    await at.command('AT+QGPS=1');
  } catch (e) {
    if (!(e instanceof ATError) || !e.reply.includes('504')) throw e; // 504 = เปิดอยู่แล้ว
  }
  const deadline = Date.now() + wait;
  while (Date.now() < deadline && !signal?.aborted) {
    try {
      return parseGpsloc(await at.query('AT+QGPSLOC=2'));
    } catch (e) {
      if (!(e instanceof ATError) || !e.reply.includes('516')) throw e; // 516 = ยังไม่ได้ตำแหน่ง
    }
    onWait?.(Math.round((deadline - Date.now()) / 1000));
    await sleep(interval);
  }
  return null;
}

export const safeName = (text) => text.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';

export async function sha256(data) {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

// อ่านข้อมูลเครื่อง + ไฟล์ทั้งหมด คืนชุดไฟล์ในรูปแบบเดียวกับโฟลเดอร์สำรองของ Python
// { folder, entries: {'info.json': Uint8Array, 'manifest.json': ..., 'files/x': ...} }
export async function backup(at, { pattern = '*', log = () => {} } = {}) {
  const info = await readInfo(at);
  const imei = typeof info.imei === 'string' ? info.imei : 'noimei';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const enc = new TextEncoder();
  const entries = { 'info.json': enc.encode(JSON.stringify(info, null, 2)) };
  const manifest = { info, files: [], failed: [] };
  log('อ่านข้อมูลเครื่องแล้ว');

  let files = [];
  try {
    files = await at.listFiles(pattern);
  } catch (e) {
    if (!(e instanceof ATError)) throw e;
    log(`รุ่นนี้ไม่รองรับการอ่านรายชื่อไฟล์ (${e.reply}) ข้ามขั้นนี้`);
  }
  for (const { name, size } of files) {
    log(`กำลังอ่าน ${name} (${size} ไบต์)`);
    let data;
    try {
      data = await at.downloadFile(name);
    } catch (e) {
      if (!(e instanceof ATError)) throw e;
      log(`  อ่านไม่ได้: ${e.reply}`);
      manifest.failed.push({ name, size, error: e.reply });
      continue;
    }
    const local = `files/${safeName(name)}`;
    entries[local] = data;
    manifest.files.push({ name, local, size: data.length, sha256: await sha256(data) });
  }
  entries['manifest.json'] = enc.encode(JSON.stringify(manifest, null, 2));
  log(`สำรองเสร็จ: ${manifest.files.length} ไฟล์, อ่านไม่ได้ ${manifest.failed.length} ไฟล์`);
  return { folder: `${safeName(imei)}_${stamp}`, entries };
}

// เขียนไฟล์จากชุดสำรองกลับลงโมดูล  readEntry(path) -> Promise<Uint8Array>
export async function restore(at, readEntry, { only, log = () => {} } = {}) {
  const manifest = JSON.parse(utf8.decode(await readEntry('manifest.json')));
  for (const entry of manifest.files) {
    if (only && !only.includes(entry.name)) continue;
    const data = await readEntry(entry.local);
    if ((await sha256(data)) !== entry.sha256) {
      throw new Error(`ไฟล์สำรอง ${entry.local} ถูกแก้หรือเสีย ไม่เขียนลงเครื่อง`);
    }
    try {
      await at.command(`AT+QFDEL="${entry.name}"`);
    } catch (e) {
      if (!(e instanceof ATError)) throw e; // ไม่มีไฟล์เดิมอยู่
    }
    await at.uploadFile(entry.name, data);
    log(`เขียน ${entry.name} แล้ว (${data.length} ไบต์)`);
  }
}

export function readableScore(data) {
  if (!data.length) return 0;
  let ok = 0;
  for (const b of data) if ((b >= 32 && b < 127) || b === 9 || b === 10 || b === 13) ok++;
  return ok / data.length;
}
