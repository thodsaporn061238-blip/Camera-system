// ขั้นที่ 10: ออกแบบหน้าจอ (แก้แล้วเห็นผลบนจอจริงทันที) และขั้นที่ 11: ไฟล์ในบอร์ด
// คุยกับโปรแกรม SNP TPMS ผ่าน request(cmd, match) ที่ app.js ส่งมา
import { SAMPLE_READINGS, SCREEN, makeLookup, renderPreview, validateLayout } from './layout.js';
import { THAI_EXAMPLES, applyThaiCommands } from './thai_commands.js';
import { createZip } from './zip.js';

const $ = (id) => document.getElementById(id);

const DEFAULT_CFG = {
  title: 'TPMS',
  names: ['ล้อหน้าซ้าย', 'ล้อหน้าขวา', 'ล้อหลังซ้าย', 'ล้อหลังขวา'],
  macs: ['', '', '', ''],
  unit: 'psi',
  low: 28,
  high: 45,
  hot: 75,
  colors: { bg: '#000000', tile: '#1A1D24', text: '#FFFFFF', ok: '#35D05A', low: '#FF4040', high: '#FFA000', stale: '#6B7280' },
};

const toB64 = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function download(name, data, type = 'application/octet-stream') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function initDesigner({ request, isReady }) {
  let cfg = DEFAULT_CFG;
  const readings = [null, null, null, null];
  let layout = null;
  let liveTimer = null;
  let lastSent = '';

  const canvas = $('layout-preview');
  const ctx = canvas.getContext('2d');
  const scale = 2;
  canvas.width = SCREEN.w * scale;
  canvas.height = SCREEN.h * scale;
  ctx.scale(scale, scale);

  const msg = (text, kind = '') => {
    $('layout-msg').textContent = text;
    $('layout-msg').className = `status ${kind}`;
  };

  function redraw() {
    if (!layout) return;
    const live = readings.some(Boolean);
    const lookup = makeLookup({ cfg, readings: !live && $('layout-sample').checked ? SAMPLE_READINGS : readings });
    renderPreview(ctx, layout, lookup);
  }

  // อ่านข้อความในช่องแก้ไข ตรวจ วาดภาพตัวอย่าง แล้วส่งเข้าจอ (ถ้าเปิด "ส่งไปที่จอทันที")
  function onEdit() {
    let obj;
    try {
      obj = JSON.parse($('layout-json').value);
    } catch (e) {
      msg(`ยังไม่ถูกรูปแบบ JSON: ${e.message}`, 'err');
      return;
    }
    const errors = validateLayout(obj);
    if (errors.length) {
      msg(errors.slice(0, 3).join(' · '), 'err');
      return;
    }
    layout = obj;
    redraw();
    if ($('layout-live').checked && isReady()) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => sendLayout(false), 400);
    } else {
      msg(`ใช้ได้ (${obj.items.length} ชิ้น)`, 'ok');
    }
  }

  async function sendLayout(save) {
    if (!layout) return;
    if (!isReady()) return msg('ยังไม่พบโปรแกรม SNP TPMS บนจอ (เชื่อมต่อก่อน)', 'warn');
    const text = JSON.stringify(layout);
    if (!save && text === lastSent) return;
    lastSent = text;
    msg(save ? 'กำลังบันทึกลงจอ...' : 'กำลังส่งไปที่จอ...', 'warn');
    try {
      const res = await request({ layout, save }, (o) => o.layout_ok || o.layout_err, 8000);
      if (res.layout_err) msg(`จอไม่รับ: ${res.layout_err}`, 'err');
      else msg(res.layout_ok.saved ? 'บันทึกลงจอแล้ว ดับไฟแล้วยังอยู่' : `จอเปลี่ยนแล้ว (${res.layout_ok.items} ชิ้น) ยังไม่ได้บันทึก`, 'ok');
    } catch (e) {
      lastSent = '';
      msg(`จอไม่ตอบ: ${e.message}`, 'err');
    }
  }

  function setLayoutText(obj) {
    $('layout-json').value = JSON.stringify(obj, null, 2);
    lastSent = '';
    onEdit();
  }

  async function loadTemplates() {
    try {
      const list = await (await fetch('layouts/index.json', { cache: 'no-store' })).json();
      $('layout-template').innerHTML = '<option value="">เลือกแม่แบบ...</option>'
        + list.map((t) => `<option value="${t.file}">${t.name}</option>`).join('');
      const first = await (await fetch(`layouts/${list[0].file}`, { cache: 'no-store' })).json();
      if (!$('layout-json').value) setLayoutText(first);
    } catch {
      $('layout-template').innerHTML = '<option value="">โหลดรายการแม่แบบไม่ได้</option>';
    }
  }

  // ---------- สั่งด้วยภาษาไทย ----------
  const history = [];
  const showResults = (lines) => {
    $('th-result').innerHTML = '';
    for (const { ok, message } of lines) {
      const div = document.createElement('div');
      div.className = ok ? 'ok' : 'err';
      div.textContent = `${ok ? '✓' : '✗'} ${message}`;
      $('th-result').append(div);
    }
  };
  function remember() {
    history.push($('layout-json').value);
    if (history.length > 50) history.shift();
    $('th-undo').disabled = false;
  }
  function undo() {
    if (!history.length) return showResults([{ ok: false, message: 'ไม่มีอะไรให้เลิกทำ' }]);
    $('layout-json').value = history.pop();
    $('th-undo').disabled = !history.length;
    lastSent = '';
    onEdit();
    showResults([{ ok: true, message: 'เลิกทำแล้ว' }]);
  }
  async function runThai(input) {
    const text = input.trim();
    if (!text) return;
    if (/^(เลิกทำ|ย้อนกลับ|undo)$/i.test(text)) return undo();
    if (/^(เริ่มใหม่|คืนค่าเริ่มต้น|หน้าจอเริ่มต้น)$/.test(text)) {
      remember();
      setLayoutText(await (await fetch('layouts/default.json', { cache: 'no-store' })).json());
      return showResults([{ ok: true, message: 'กลับไปหน้าจอเริ่มต้นแล้ว (ยังไม่ได้บันทึกลงจอ)' }]);
    }
    if (!layout) return showResults([{ ok: false, message: 'แก้ไฟล์ออกแบบให้ถูกต้องก่อน หรือเลือกแม่แบบ' }]);
    const r = applyThaiCommands(layout, text);
    showResults(r.results);
    if (r.changed) {
      remember();
      setLayoutText(r.layout);
      $('th-cmd').select();
    }
  }
  $('th-run').onclick = () => runThai($('th-cmd').value);
  $('th-cmd').addEventListener('keydown', (e) => e.key === 'Enter' && runThai($('th-cmd').value));
  $('th-undo').onclick = undo;
  for (const ex of THAI_EXAMPLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = ex;
    b.onclick = () => {
      $('th-cmd').value = ex;
      runThai(ex);
    };
    $('th-examples').append(b);
  }

  $('layout-json').addEventListener('input', onEdit);
  $('layout-sample').onchange = redraw;
  $('layout-template').onchange = async () => {
    const file = $('layout-template').value;
    if (!file) return;
    if ($('layout-json').value && !confirm('แทนที่สิ่งที่แก้อยู่ด้วยแม่แบบนี้?')) return;
    remember();
    setLayoutText(await (await fetch(`layouts/${file}`, { cache: 'no-store' })).json());
  };
  $('layout-send').onclick = () => {
    lastSent = '';
    sendLayout(false);
  };
  $('layout-save').onclick = () => sendLayout(true);
  $('layout-from-device').onclick = async () => {
    try {
      const res = await request({ get: 'layout' }, (o) => o.layout, 8000);
      setLayoutText(res.layout);
      msg('โหลดหน้าจอจากจอแล้ว', 'ok');
    } catch (e) {
      msg(`โหลดจากจอไม่ได้: ${e.message}`, 'err');
    }
  };
  $('layout-reset').onclick = async () => {
    if (!confirm('คืนหน้าจอเป็นแบบเริ่มต้น (ลบหน้าจอที่บันทึกไว้ในจอ)?')) return;
    try {
      await request({ reset: 'layout' }, (o) => o.layout_ok || o.layout_err, 8000);
      msg('คืนหน้าจอเริ่มต้นแล้ว', 'ok');
    } catch (e) {
      msg(`จอไม่ตอบ: ${e.message}`, 'err');
    }
  };
  $('layout-download').onclick = () => download('layout.json', $('layout-json').value, 'application/json');
  $('layout-open').onchange = async () => {
    const f = $('layout-open').files[0];
    if (f) {
      $('layout-json').value = await f.text();
      onEdit();
    }
  };
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * SCREEN.w);
    const y = Math.round(((e.clientY - r.top) / r.height) * SCREEN.h);
    $('layout-xy').textContent = `ตำแหน่งเมาส์ x=${x} y=${y}`;
  });

  // ---------- ขั้นที่ 11: ไฟล์ในบอร์ด ----------
  const fileMsg = (text, kind = '') => {
    $('files-msg').textContent = text;
    $('files-msg').className = `status ${kind}`;
  };
  const fsReq = (cmd, match) => request(cmd, (o) => o.fs_err || match(o), 8000).then((o) => {
    if (o.fs_err) throw new Error(o.fs_err);
    return o;
  });

  async function readFile(path) {
    const parts = [];
    let offset = 0;
    let size = Infinity;
    while (offset < size) {
      const { file } = await fsReq({ fs: 'read', path, offset, len: 3072 }, (o) => o.file?.path === path && o.file.offset === offset);
      size = file.size;
      const bytes = fromB64(file.data);
      if (!bytes.length) break;
      parts.push(bytes);
      offset += bytes.length;
      fileMsg(`กำลังอ่าน ${path} ${Math.min(100, Math.round((offset / size) * 100))}%`, 'warn');
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let i = 0;
    for (const p of parts) {
      out.set(p, i);
      i += p.length;
    }
    return out;
  }

  async function writeFile(path, bytes) {
    for (let off = 0; off === 0 || off < bytes.length; off += 2048) {
      const chunk = bytes.subarray(off, off + 2048);
      await fsReq({ fs: 'write', path, data: toB64(chunk), append: off > 0 }, (o) => o.fs_ok?.path === path);
      fileMsg(`กำลังเขียน ${path} ${Math.round((Math.min(off + 2048, bytes.length) / Math.max(bytes.length, 1)) * 100)}%`, 'warn');
      if (!bytes.length) break;
    }
  }

  async function listFiles() {
    const res = await fsReq({ fs: 'list' }, (o) => o.files);
    const table = $('files-table');
    table.innerHTML = '';
    if (!res.files.length) table.insertRow().insertCell().textContent = '(ยังไม่มีไฟล์)';
    for (const f of res.files) {
      const tr = table.insertRow();
      tr.insertCell().textContent = f.path;
      tr.insertCell().textContent = f.dir ? 'โฟลเดอร์' : `${f.size.toLocaleString()} ไบต์`;
      const act = tr.insertCell();
      const btn = (label, fn) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.onclick = () => fn().catch((e) => fileMsg(`ผิดพลาด: ${e.message}`, 'err'));
        act.append(b, ' ');
      };
      if (f.dir) continue;
      btn('ดาวน์โหลด', async () => {
        download(f.path.split('/').pop(), await readFile(f.path));
        fileMsg(`ดาวน์โหลด ${f.path} แล้ว`, 'ok');
      });
      btn('คัดลอก', async () => {
        const to = prompt('คัดลอกเป็นชื่อ', f.path.replace(/(\.[^.]*)?$/, '-copy$1'));
        if (!to) return;
        await writeFile(to.startsWith('/') ? to : `/${to}`, await readFile(f.path));
        fileMsg(`คัดลอกเป็น ${to} แล้ว`, 'ok');
        await listFiles();
      });
      if (f.path === '/layout.json') {
        btn('แก้ในขั้นที่ 10', async () => {
          setLayoutText(JSON.parse(new TextDecoder().decode(await readFile(f.path))));
          $('layout-json').scrollIntoView({ behavior: 'smooth' });
        });
      }
      btn('ลบ', async () => {
        if (!confirm(`ลบ ${f.path} ออกจากบอร์ด?`)) return;
        await fsReq({ fs: 'delete', path: f.path }, (o) => o.fs_ok);
        fileMsg(`ลบ ${f.path} แล้ว`, 'ok');
        await listFiles();
      });
    }
    fileMsg(`ใช้พื้นที่ ${Math.round(res.used / 1024)} / ${Math.round(res.total / 1024)} KB`, 'ok');
    return res.files;
  }

  const guard = (fn) => async () => {
    if (!isReady()) return fileMsg('ยังไม่พบโปรแกรม SNP TPMS บนจอ (เชื่อมต่อก่อน)', 'warn');
    try {
      await fn();
    } catch (e) {
      fileMsg(`ผิดพลาด: ${e.message}`, 'err');
    }
  };

  $('files-list').onclick = guard(listFiles);
  $('files-pull').onclick = guard(async () => {
    const files = (await listFiles()).filter((f) => !f.dir);
    const entries = {};
    for (const f of files) entries[`board-files${f.path}`] = await readFile(f.path);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    download(`board-files_${stamp}.zip`, createZip(entries), 'application/zip');
    fileMsg(`ดึงไฟล์ทั้งหมด ${files.length} ไฟล์แล้ว`, 'ok');
  });
  $('files-upload').onchange = guard(async () => {
    for (const f of $('files-upload').files) await writeFile(`/${f.name}`, new Uint8Array(await f.arrayBuffer()));
    $('files-upload').value = '';
    await listFiles();
    fileMsg('เขียนไฟล์ลงบอร์ดแล้ว ถ้าเป็น layout.json กด "ใช้ไฟล์ layout.json ในบอร์ด" เพื่อให้จอเปลี่ยน', 'ok');
  });
  $('files-reload').onclick = guard(async () => {
    const res = await request({ reload: 'layout' }, (o) => o.layout_ok || o.layout_err, 8000);
    fileMsg(res.layout_err ? `จอไม่รับ: ${res.layout_err}` : 'จอใช้ไฟล์ layout.json ในบอร์ดแล้ว', res.layout_err ? 'err' : 'ok');
  });

  loadTemplates();
  canvas.title = 'ภาพตัวอย่างจอ 320 x 240';

  return {
    onMessage(obj) {
      if (obj.cfg) {
        cfg = { ...DEFAULT_CFG, ...obj.cfg, colors: { ...DEFAULT_CFG.colors, ...obj.cfg.colors } };
        redraw();
      }
      if (obj.sensor && obj.sensor.wheel >= 0 && obj.sensor.format) {
        const s = obj.sensor;
        readings[s.wheel] = { kpa: Number(s.kpa), temp: Number(s.temp), battery: s.battery ?? -1, volt: s.volt ? Number(s.volt) : 0, alarm: s.alarm };
        redraw();
      }
    },
  };
}
