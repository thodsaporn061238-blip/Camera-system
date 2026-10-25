// หน้าจอโปรแกรม: ต่อกล้องผ่าน Web Serial (Chrome/Edge) แล้วเรียกใช้ camtool.js
import {
  ATClient, ATError, ATTimeout, INFO_COMMANDS, backup, gpsFix, readInfo, readableScore, restore,
} from './camtool.js';
import { AT_QUICK, CONSOLE_QUICK, renderQuick } from './commands.js';
import { identify } from './devices.js';
import { initDesigner } from './designer.js';
import { initTpms, lineSplitter } from './tpms.js';
import { createZip, readZip } from './zip.js';

const $ = (id) => document.getElementById(id);
const status = $('status');

let port = null;
let reader = null;
let client = null;
let rawListener = null; // ใช้ตอนบันทึก log ตอนบูต
let busy = false;
let espActive = false; // ระหว่างคุยกับ bootloader ของ ESP32 พอร์ตถูกยืมไป ห้ามเชื่อมต่ออัตโนมัติแทรก

function setStatus(text, kind = '') {
  status.textContent = text;
  status.className = `status ${kind}`;
}

function setConnected(on) {
  $('connect').disabled = on;
  $('disconnect').disabled = !on;
  $('baud').disabled = on;
  $('tools').classList.toggle('locked', !on);
}

async function readLoop() {
  while (port?.readable) {
    reader = port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        client.feed(value);
        rawListener?.(value);
        tpmsLines(value);
      }
    } catch {
      // สายหลุดหรือปิดพอร์ต
    } finally {
      reader.releaseLock();
    }
    if (!port) break;
  }
}

// เปิดพอร์ตแล้วเดาว่าเป็นอุปกรณ์อะไร: ตอบคำสั่ง AT = โมดูล 4G, ไม่ตอบ = เปิดดูข้อความดิบในขั้นที่ 7 ให้อัตโนมัติ
async function openPort(p) {
  if (port || espActive) return;
  try {
    await p.open({ baudRate: Number($('baud').value), bufferSize: 65536 });
  } catch (e) {
    setStatus(`เปิดพอร์ตไม่ได้: ${e.message} (โปรแกรมอื่นอาจเปิดพอร์ตนี้อยู่ เช่น Arduino IDE)`, 'err');
    return;
  }
  port = p;
  const writer = port.writable.getWriter();
  client = new ATClient({ write: (data) => writer.write(data) });
  client.writer = writer;
  readLoop();
  setConnected(true);
  const dev = identify(port.getInfo());
  const label = `เชื่อมต่อแล้ว: ${dev.name}${dev.ids ? ` (USB ${dev.ids})` : ''}`;
  if (dev.kind === 'download') {
    setStatus(`${label} ใช้โปรแกรมนี้ไม่ได้ ต้องใช้โปรแกรมลงเฟิร์มแวร์ของผู้ผลิต`, 'warn');
    return;
  }
  setStatus(`${label} กำลังทดสอบ...`, 'warn');
  try {
    await client.command('AT', 2000);
    setStatus(`${label} ตอบคำสั่ง AT ใช้ขั้นที่ 2–6 ได้`, 'ok');
  } catch {
    startLog();
    if ($('auto-reset').checked) await resetBoard();
    else sendJsonLine({ hello: true }); // ถามโปรแกรม SNP TPMS ที่ทำงานอยู่แล้วโดยไม่รีเซ็ต
    setStatus(`${label} ไม่ตอบคำสั่ง AT จึงเปิดดูข้อความจากบอร์ดในขั้นที่ 7 ให้แล้ว`, 'warn');
    $('console-section').scrollIntoView({ behavior: 'smooth' });
  }
}

// สั่งรีเซ็ตบอร์ดผ่านขา RTS/DTR (บอร์ด ESP32 ที่มีวงจรรีเซ็ตอัตโนมัติ) บอร์ดจะเริ่มทำงานใหม่และพิมพ์ log ตอนบูตออกมา
async function resetBoard() {
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await new Promise((r) => setTimeout(r, 120));
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch {
    // บางพอร์ตไม่รองรับการสั่งขา RTS/DTR
  }
}

async function connect() {
  let p;
  try {
    p = await navigator.serial.requestPort();
  } catch {
    return; // ผู้ใช้กดยกเลิก
  }
  await openPort(p);
}

async function disconnect() {
  const p = port;
  port = null;
  try {
    await reader?.cancel();
    client?.writer.releaseLock();
    await p?.close();
  } catch {
    // ปิดไปแล้ว
  }
  tpmsReady = false;
  setConnected(false);
  setStatus('ยังไม่ได้เชื่อมต่อ');
}

// กันกดหลายปุ่มพร้อมกัน และแปลง error เป็นข้อความที่อ่านเข้าใจ
async function run(out, task) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('.needs-port button').forEach((b) => b.setAttribute('data-was', b.disabled));
  document.querySelectorAll('.needs-port button:not(#gps-stop)').forEach((b) => (b.disabled = true));
  try {
    await task();
  } catch (e) {
    const msg = e instanceof ATTimeout
      ? 'กล้องไม่ตอบ: ตรวจว่าเลือกพอร์ต AT ถูก และกล้องเปิดอยู่'
      : e instanceof ATError ? `กล้องตอบว่าผิดพลาด: ${e.reply}` : `ผิดพลาด: ${e.message}`;
    if (out) out.textContent += `\n${msg}`;
    else setStatus(msg, 'err');
  } finally {
    document.querySelectorAll('.needs-port button').forEach((b) => (b.disabled = b.getAttribute('data-was') === 'true'));
    busy = false;
  }
}

const logger = (out) => (line) => {
  out.textContent += (out.textContent ? '\n' : '') + line;
  out.scrollTop = out.scrollHeight;
};

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('connect').onclick = connect;
$('disconnect').onclick = disconnect;

$('info').onclick = () => run(null, async () => {
  const table = $('info-table');
  table.innerHTML = '';
  await readInfo(client, (key, value) => {
    const tr = table.insertRow();
    tr.insertCell().textContent = INFO_COMMANDS[key][0];
    const td = tr.insertCell();
    td.className = 'v';
    if (typeof value === 'string') td.textContent = value || '(ว่าง)';
    else {
      td.textContent = `ไม่รองรับ (${value.error})`;
      td.classList.add('err');
    }
  });
});

$('backup').onclick = () => {
  const out = $('backup-log');
  out.textContent = '';
  run(out, async () => {
    const { folder, entries } = await backup(client, { log: logger(out) });
    const zipped = Object.fromEntries(Object.entries(entries).map(([p, d]) => [`${folder}/${p}`, d]));
    download(`${folder}.zip`, new Blob([createZip(zipped)], { type: 'application/zip' }));
    logger(out)(`ดาวน์โหลดไฟล์ ${folder}.zip แล้ว เก็บไว้ให้ดี`);
  });
};

$('restore').onclick = () => {
  const out = $('restore-log');
  const file = $('restore-file').files[0];
  out.textContent = '';
  if (!file) return logger(out)('เลือกไฟล์ .zip ก่อน');
  if (!confirm(`จะเขียนข้อมูลจาก ${file.name} ทับของเดิมในกล้อง ยืนยันไหม?`)) return;
  run(out, async () => {
    const zip = readZip(new Uint8Array(await file.arrayBuffer()));
    const manifestPath = Object.keys(zip).find((p) => p.endsWith('manifest.json'));
    if (!manifestPath) throw new Error('ไม่ใช่ไฟล์สำรองของโปรแกรมนี้ (ไม่มี manifest.json)');
    const base = manifestPath.slice(0, -'manifest.json'.length);
    const readEntry = async (p) => {
      const f = zip[base + p] ?? zip[base + p.replaceAll('/', '\\')];
      if (!f) throw new Error(`ไม่มีไฟล์ ${p} ใน zip`);
      return f();
    };
    await restore(client, readEntry, { log: logger(out) });
    logger(out)('เขียนเสร็จ ให้รีสตาร์ทกล้อง (คำสั่ง AT+CFUN=1,1) แล้วอ่านข้อมูลเครื่องตรวจอีกครั้ง');
  });
};

let gpsAbort = null;
$('gps').onclick = () => {
  const out = $('gps-log');
  out.textContent = 'เปิด GPS แล้ว กำลังรอสัญญาณ...';
  gpsAbort = new AbortController();
  $('gps-stop').disabled = false;
  run(out, async () => {
    const fix = await gpsFix(client, {
      signal: gpsAbort.signal,
      onWait: (left) => logger(out)(`ยังไม่ได้ตำแหน่ง เหลือ ${left} วินาที`),
    });
    if (fix) {
      out.textContent = `ได้ตำแหน่งแล้ว (${fix.fix}, ดาวเทียม ${fix.satellites} ดวง)\n`
        + `ละติจูด ${fix.lat}  ลองจิจูด ${fix.lon}\nความสูง ${fix.altitude_m} ม.  ความเร็ว ${fix.speed_kmh} กม./ชม.\n`
        + `https://maps.google.com/?q=${fix.lat},${fix.lon}`;
    } else {
      logger(out)(gpsAbort.signal.aborted ? 'หยุดแล้ว' : 'หมดเวลา ยังไม่ได้ตำแหน่ง ตรวจเสาอากาศ GPS');
    }
  }).finally(() => ($('gps-stop').disabled = true));
};
$('gps-stop').onclick = () => gpsAbort?.abort();

$('at-send').onclick = () => {
  const out = $('at-log');
  const cmd = $('at-cmd').value.trim();
  if (!cmd) return;
  run(out, async () => {
    logger(out)(`> ${cmd}`);
    try {
      const lines = await client.command(cmd, 10000);
      logger(out)(lines.length ? lines.join('\n') : 'OK');
    } catch (e) {
      if (!(e instanceof ATError)) throw e;
      logger(out)(e.reply);
    }
  });
};
$('at-cmd').addEventListener('keydown', (e) => e.key === 'Enter' && $('at-send').click());
renderQuick($('at-quick'), AT_QUICK, (item) => {
  $('at-cmd').value = item.cmd;
  if (item.danger) {
    $('at-cmd').focus();
    logger($('at-log'))(`ใส่คำสั่ง ${item.cmd} ในช่องแล้ว ตรวจหรือแก้ค่า แล้วกด "ส่ง" เอง`);
  } else {
    $('at-send').click();
  }
});

let logBytes = [];
let logTail = new Uint8Array();
function startLog() {
  logBytes = [];
  logTail = new Uint8Array();
  $('log-view').textContent = '';
  const decoder = new TextDecoder();
  rawListener = (bytes) => {
    logBytes.push(bytes);
    const view = $('log-view');
    view.textContent += decoder.decode(bytes, { stream: true });
    view.scrollTop = view.scrollHeight;
    logTail = new Uint8Array([...logTail, ...bytes].slice(-4096));
    $('log-score').textContent = `อ่านออก ${Math.round(readableScore(logTail) * 100)}%`;
  };
  $('log-start').disabled = true;
  $('log-stop').disabled = false;
}
$('log-start').onclick = startLog;
$('log-stop').onclick = () => {
  rawListener = null;
  $('log-start').disabled = false;
  $('log-stop').disabled = true;
  $('log-save').disabled = logBytes.length === 0;
};
$('log-save').onclick = () => download(`console_${stamp()}.log`, new Blob(logBytes));

// ส่งข้อความเข้าชิปหลักผ่านจุด TX/RX (เริ่มบันทึก log ให้เองถ้ายังไม่ได้เริ่ม จะได้เห็นคำตอบ)
async function sendConsole(text) {
  if (!port || busy) return;
  if (!rawListener) startLog();
  await client.transport.write(new TextEncoder().encode(text));
}

const EOL = { cr: '\r', lf: '\n', crlf: '\r\n' };
const eol = () => EOL[$('console-eol').value];

$('console-send').onclick = () => {
  sendConsole($('console-cmd').value + eol());
  $('console-cmd').select();
};
$('console-cmd').addEventListener('keydown', (e) => e.key === 'Enter' && $('console-send').click());

let repeatTimer = null;
renderQuick($('console-quick'), CONSOLE_QUICK, (item, button) => {
  if (item.repeat) {
    if (repeatTimer) return;
    const label = button.textContent;
    const end = Date.now() + item.repeat * 1000;
    repeatTimer = setInterval(() => {
      const left = Math.ceil((end - Date.now()) / 1000);
      if (left <= 0 || !port) {
        clearInterval(repeatTimer);
        repeatTimer = null;
        button.textContent = label;
        return;
      }
      button.textContent = `กำลังกด... เหลือ ${left} วินาที`;
      sendConsole(item.key);
    }, 100);
  } else if (item.reset) {
    if (port && !busy) {
      if (!rawListener) startLog();
      resetBoard();
    }
  } else if (item.key) {
    sendConsole(item.key);
  } else if (item.danger) {
    $('console-cmd').value = item.cmd;
    $('console-cmd').focus();
  } else {
    sendConsole(item.cmd + eol());
  }
});

if (!('serial' in navigator)) {
  $('unsupported').hidden = false;
  $('connect').disabled = true;
}
navigator.serial?.addEventListener('disconnect', (e) => {
  if (e.target === port) disconnect().then(() => setStatus('สายหลุด เสียบใหม่ได้เลย จะเชื่อมต่อให้อัตโนมัติ', 'err'));
});

// ขั้นที่ 8: ยืมพอร์ตไปคุยกับ bootloader ของ ESP32 เสร็จแล้วเชื่อมต่อกลับให้เอง
function espTask(task) {
  if (!port || busy) return;
  const out = $('esp-log');
  const progress = $('esp-progress');
  out.textContent = '';
  run(out, async () => {
    const p = port;
    espActive = true;
    await disconnect();
    setStatus('กำลังคุยกับ bootloader ของ ESP32...', 'warn');
    try {
      const esp = await import('./esp32.js');
      const onProgress = (done, total) => {
        progress.hidden = false;
        progress.value = total ? done / total : 0;
      };
      await esp.withEsp32(p, { baudrate: Number($('esp-baud').value), log: logger(out) },
        (loader, chip) => task(esp, loader, chip, onProgress));
    } catch (e) {
      if (/connect|sync|timeout/i.test(e.message)) {
        e.message += ' — ต่อ bootloader ไม่ติด: กดปุ่ม BOOT ค้าง กด RST 1 ครั้ง ปล่อย BOOT แล้วลองใหม่ หรือลดความเร็วเป็น 115200';
      }
      throw e;
    } finally {
      progress.hidden = true;
      espActive = false;
      await openPort(p);
    }
  });
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

function showEspInfo(info) {
  const table = $('esp-table');
  table.innerHTML = '';
  for (const [label, value] of [['ชิป', info.chip], ['ความสามารถ', info.features], ['คริสตัล', info.crystal],
    ['MAC', info.mac], ['หน่วยความจำแฟลช', info.flashSize]]) {
    const tr = table.insertRow();
    tr.insertCell().textContent = label;
    const td = tr.insertCell();
    td.className = 'v';
    td.textContent = value;
  }
}

$('esp-info').onclick = () => espTask(async (esp, loader, chip) => {
  showEspInfo(await esp.readChipInfo(loader, chip));
});

$('esp-backup').onclick = () => espTask(async (esp, loader, chip, onProgress) => {
  const info = await esp.readChipInfo(loader, chip);
  showEspInfo(info);
  if (!info.flashBytes) throw new Error('อ่านขนาดหน่วยความจำแฟลชไม่ได้');
  logger($('esp-log'))(`กำลังอ่านแฟลชทั้งหมด ${info.flashSize} อาจใช้เวลาหลายนาที ห้ามถอดสาย`);
  const data = await esp.readWholeFlash(loader, info.flashBytes, onProgress);
  const name = `esp32_${info.mac.replaceAll(':', '')}_${stamp()}.bin`;
  download(name, new Blob([data], { type: 'application/octet-stream' }));
  logger($('esp-log'))(`ดาวน์โหลดไฟล์ ${name} (${data.length} ไบต์) แล้ว เก็บไว้ให้ดี ใช้ลงกลับที่ตำแหน่ง 0x0`);
});

$('esp-write').onclick = () => {
  const file = $('esp-file').files[0];
  const address = Number($('esp-addr').value);
  if (!file) return logger($('esp-log'))('เลือกไฟล์ .bin ก่อน');
  const where = `0x${address.toString(16)}`;
  if (!confirm(`จะลง ${file.name} ที่ตำแหน่ง ${where} ทับโปรแกรมเดิมในบอร์ด สำรองไว้แล้วใช่ไหม?`)) return;
  espTask(async (esp, loader, _chip, onProgress) => {
    const data = new Uint8Array(await file.arrayBuffer());
    logger($('esp-log'))(`กำลังลง ${file.name} (${data.length} ไบต์) ที่ ${where} ห้ามถอดสาย`);
    await esp.writeImage(loader, data, address, onProgress);
    logger($('esp-log'))('ลงโปรแกรมเสร็จ บอร์ดจะรีสตาร์ทเอง ดู log ตอนบูตได้ในขั้นที่ 7');
  });
};

// ขั้นที่ 9: โปรแกรม SNP TPMS (ไฟล์ firmware/snp-tpms.bin สร้างโดย GitHub Actions จาก firmware/tpms)
const sendJsonLine = (cmd) => port && !busy && client.transport.write(new TextEncoder().encode(`${JSON.stringify(cmd)}\n`));
const tpms = initTpms(sendJsonLine);

// ส่งคำสั่งแล้วรอคำตอบที่ match ตรง (ใช้กับไฟล์ออกแบบและไฟล์ในบอร์ด)
const waiters = new Set();
function request(cmd, match, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (!port || busy) {
      reject(new Error('ยังไม่ได้เชื่อมต่อ หรือกำลังทำงานอื่นอยู่'));
      return;
    }
    const w = { match, resolve, timer: setTimeout(() => waiters.delete(w) && reject(new Error('หมดเวลารอ')), timeout) };
    waiters.add(w);
    sendJsonLine(cmd);
  });
}

let tpmsReady = false;
const designer = initDesigner({ request, isReady: () => !!port && tpmsReady });
const tpmsLines = lineSplitter((obj) => {
  if (obj.hello?.app === 'snp-tpms') tpmsReady = !!obj.hello.layout;
  tpms.onMessage(obj);
  designer.onMessage(obj);
  for (const w of waiters) {
    if (w.match(obj)) {
      clearTimeout(w.timer);
      waiters.delete(w);
      w.resolve(obj);
    }
  }
});

$('tpms-install').onclick = async () => {
  let data;
  try {
    const res = await fetch('firmware/snp-tpms.bin', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    logger($('esp-log'))(`โหลดไฟล์โปรแกรมไม่ได้ (${e.message})`);
    return;
  }
  if (!confirm(`จะลงโปรแกรม SNP TPMS (${Math.round(data.length / 1024)} KB) ทับโปรแกรมเดิมในจอ สำรองโปรแกรมเดิมแล้วใช่ไหม?`)) return;
  $('esp-log').scrollIntoView({ behavior: 'smooth' });
  espTask(async (esp, loader, _chip, onProgress) => {
    logger($('esp-log'))('กำลังลงโปรแกรม SNP TPMS ห้ามถอดสาย');
    await esp.writeImage(loader, data, 0, onProgress);
    logger($('esp-log'))('ลงเสร็จ จอจะรีสตาร์ทแล้วขึ้นหน้าลมยาง ตั้งค่าได้ในขั้นที่ 9');
  });
};

// เชื่อมต่ออัตโนมัติ: เบราว์เซอร์ให้เลือกพอร์ตเองครั้งแรกครั้งเดียว หลังจากนั้นเสียบสายเมื่อไหร่ก็เชื่อมต่อให้ทันที
const autoConnect = () => $('auto-connect').checked;
navigator.serial?.addEventListener('connect', (e) => autoConnect() && openPort(e.target));
for (const id of ['auto-connect', 'auto-reset']) {
  try {
    const saved = localStorage.getItem(id);
    if (saved !== null) $(id).checked = saved === '1';
  } catch {
    // เบราว์เซอร์ไม่ให้เก็บค่า ใช้ค่าเริ่มต้น
  }
  $(id).addEventListener('change', () => {
    try {
      localStorage.setItem(id, $(id).checked ? '1' : '0');
    } catch {
      // ไม่เป็นไร
    }
  });
}
navigator.serial?.getPorts().then((ports) => {
  if (autoConnect() && ports.length) openPort(ports[0]);
});
