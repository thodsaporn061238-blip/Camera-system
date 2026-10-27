// ขั้นที่ 10: ออกแบบหน้าจอ (แก้แล้วเห็นผลบนจอจริงทันที) และขั้นที่ 11: ไฟล์ในบอร์ด
// คุยกับโปรแกรม SNP TPMS ผ่าน request(cmd, match) ที่ app.js ส่งมา
import { FONT_WEIGHT, SAMPLE_READINGS, SCREEN, checkLayout, itemBounds, makeLookup, renderPreview } from './layout.js';
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
  let check = { errors: [], warnings: [], problems: new Set() };
  let touched = false;  // แก้ไปแล้วหลังโหลดจากจอ (โหลดอัตโนมัติจะไม่ทับงานที่แก้อยู่)
  let testing = false;  // จอแสดงแบบทดลองที่ยังไม่บันทึก
  let testedText = '';  // แบบที่ทดลองบนจอล่าสุด

  // วัดความกว้างข้อความด้วยฟอนต์เดียวกับภาพตัวอย่าง
  const measureCtx = document.createElement('canvas').getContext('2d');
  const measure = (text, size) => {
    measureCtx.font = `${FONT_WEIGHT[size]} ${size}px Sarabun, sans-serif`;
    return measureCtx.measureText(text).width;
  };

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

  const currentLookup = () => {
    const live = readings.some(Boolean);
    return makeLookup({ cfg, readings: !live && $('layout-sample').checked ? SAMPLE_READINGS : readings });
  };

  function redraw() {
    if (!layout) return;
    const lookup = currentLookup();
    renderPreview(ctx, layout, lookup);
    // กรอบแดงรอบชิ้นที่มีปัญหา
    ctx.save();
    ctx.strokeStyle = '#FF2D2D';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    for (const i of check.problems) {
      const b = itemBounds(layout.items[i], lookup, measure);
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    }
    ctx.restore();
  }

  function showCheck(lines) {
    const box = $('layout-check');
    box.innerHTML = '';
    for (const [kind, text] of lines) {
      const div = document.createElement('div');
      div.className = kind;
      div.textContent = `${{ ok: '✓', warn: '⚠', err: '✗' }[kind]} ${text}`;
      box.append(div);
    }
  }

  function runCheck() {
    check = checkLayout(layout, currentLookup(), measure);
    const lines = [
      ...check.errors.map((t) => ['err', t]),
      ...check.warnings.map((t) => ['warn', t]),
    ];
    if (!lines.length) lines.push(['ok', `ตรวจแล้ว ไม่พบปัญหา (${layout.items.length} ชิ้น) ส่งเข้าจอได้`]);
    else lines.unshift([check.errors.length ? 'err' : 'warn', check.errors.length
      ? `พบข้อผิดพลาด ${check.errors.length} ข้อ ต้องแก้ก่อนส่งเข้าจอ`
      : `ส่งได้ แต่มีคำเตือน ${check.warnings.length} ข้อ`]);
    showCheck(lines);
  }

  // อ่านข้อความในช่องแก้ไข ตรวจ วาดภาพตัวอย่าง แล้วทดลองบนจอ (ถ้าเปิด "ทดลองบนจอทุกครั้งที่แก้")
  function onEdit() {
    let obj;
    try {
      obj = JSON.parse($('layout-json').value);
    } catch (e) {
      check = { errors: ['ยังไม่ถูกรูปแบบ JSON'], warnings: [], problems: new Set() };
      showCheck([['err', `ยังไม่ถูกรูปแบบ JSON: ${e.message}`]]);
      return;
    }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.items)) {
      layout = null;
      check = checkLayout(obj, currentLookup(), measure);
      showCheck(check.errors.map((t) => ['err', t]));
      return;
    }
    layout = obj;
    runCheck();
    try {
      redraw();
    } catch {
      // ชิ้นที่ผิดรูปแบบมาก (เช่น ไม่ใช่ { ... }) วาดไม่ได้ รายการ ✗ บอกแล้วว่าต้องแก้อะไร
    }
    if ($('layout-live').checked && isReady() && !check.errors.length) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => sendLayout(false), 400);
    }
  }

  async function sendLayout(save) {
    if (!layout) return msg('แก้ไฟล์ออกแบบให้ถูกต้องก่อน', 'err');
    if (!isReady()) return msg('ยังไม่พบโปรแกรม SNP TPMS บนจอ (เชื่อมต่อก่อน)', 'warn');
    runCheck();
    if (check.errors.length) {
      msg(`ยังส่งเข้าจอไม่ได้: มีข้อผิดพลาด ${check.errors.length} ข้อ (ดูรายการ ✗ ใต้ภาพตัวอย่าง)`, 'err');
      return;
    }
    if (save && check.warnings.length
      && !confirm(`มีคำเตือน ${check.warnings.length} ข้อ:\n\n${check.warnings.slice(0, 6).join('\n')}\n\nบันทึกลงจอทั้งอย่างนี้?`)) return;
    const text = JSON.stringify(layout);
    if (save && text !== testedText && !confirm('แบบนี้ยังไม่ได้ทดลองบนจอ บันทึกเลยไหม?\n(กด "ยกเลิก" แล้วกด "ทดลองบนจอ" เพื่อดูของจริงก่อน)')) return;
    if (!save && text === lastSent) return;
    lastSent = text;
    msg(save ? 'กำลังบันทึกลงจอ...' : 'กำลังส่งไปทดลองบนจอ...', 'warn');
    try {
      const res = await request({ layout, save }, (o) => o.layout_ok || o.layout_err, 8000);
      if (res.layout_err) {
        lastSent = '';
        return msg(`จอไม่รับ: ${res.layout_err}`, 'err');
      }
      if (res.layout_ok.saved) {
        testing = false;
        testedText = '';
        touched = false;
        msg('บันทึกลงจอแล้ว ดับไฟแล้วยังอยู่', 'ok');
      } else {
        testing = true;
        testedText = text;
        msg(`จอแสดงแบบทดลองแล้ว (${res.layout_ok.items} ชิ้น) ยังไม่ได้บันทึก ดูที่จอจริงแล้วกด "บันทึกลงจอ" หรือ "ยกเลิกการทดลอง"`, 'ok');
      }
      $('layout-cancel').disabled = !testing;
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

  // ดึงหน้าจอที่จอใช้อยู่ตอนนี้ (และค่าตั้ง) มาแก้ต่อ
  async function loadFromDevice(auto = false) {
    if (!isReady()) return msg('ยังไม่พบโปรแกรม SNP TPMS บนจอ (เชื่อมต่อก่อน)', 'warn');
    if (auto && touched) {
      return msg('พบจอแล้ว ยังไม่ได้โหลดหน้าจอจากจอเพราะกำลังแก้อยู่ กด "โหลดหน้าจอจากจอ" ถ้าต้องการแก้ต่อจากของในจอ', 'warn');
    }
    if (!auto && touched && !confirm('แทนที่สิ่งที่แก้อยู่ด้วยหน้าจอที่อยู่ในจอ? (กด "เลิกทำ" ย้อนกลับได้)')) return;
    try {
      const res = await request({ get: 'layout' }, (o) => o.layout, 8000);
      if ($('layout-json').value) remember();
      setLayoutText(res.layout);
      touched = false;
      lastSent = JSON.stringify(layout);
      msg(`${auto ? 'พบจอแล้ว ' : ''}โหลดหน้าจอที่จอใช้อยู่แล้ว แก้ต่อได้เลย`, 'ok');
    } catch (e) {
      msg(`โหลดจากจอไม่ได้: ${e.message}`, 'err');
    }
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
    touched = true;
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

  $('layout-json').addEventListener('input', () => {
    touched = true;
    onEdit();
  });
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
  $('layout-from-device').onclick = () => loadFromDevice(false);
  // เลิกแบบทดลอง จอกลับไปใช้แบบที่บันทึกไว้ (ช่องแก้ไขยังเก็บงานไว้ให้แก้ต่อ)
  $('layout-cancel').onclick = async () => {
    if (!isReady()) return msg('ยังไม่พบโปรแกรม SNP TPMS บนจอ (เชื่อมต่อก่อน)', 'warn');
    try {
      const res = await request({ reload: 'layout' }, (o) => o.layout_ok || o.layout_err, 8000);
      if (res.layout_err) return msg(`จอไม่รับ: ${res.layout_err}`, 'err');
      testing = false;
      testedText = '';
      lastSent = '';
      $('layout-cancel').disabled = true;
      msg('ยกเลิกการทดลองแล้ว จอกลับไปใช้แบบที่บันทึกไว้ งานในช่องแก้ไขยังอยู่', 'ok');
    } catch (e) {
      msg(`จอไม่ตอบ: ${e.message}`, 'err');
    }
  };
  $('layout-reset').onclick = async () => {
    if (!confirm('คืนหน้าจอเป็นแบบเริ่มต้น (ลบหน้าจอที่บันทึกไว้ในจอ)?')) return;
    try {
      await request({ reset: 'layout' }, (o) => o.layout_ok || o.layout_err, 8000);
      testing = false;
      testedText = '';
      $('layout-cancel').disabled = true;
      msg('คืนหน้าจอเริ่มต้นแล้ว', 'ok');
    } catch (e) {
      msg(`จอไม่ตอบ: ${e.message}`, 'err');
    }
  };
  $('layout-download').onclick = () => download('layout.json', $('layout-json').value, 'application/json');
  $('layout-open').onchange = async () => {
    const f = $('layout-open').files[0];
    if (f) {
      if ($('layout-json').value) remember();
      $('layout-json').value = await f.text();
      touched = true;
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
      // เสียบจอแล้วพบโปรแกรม SNP TPMS: ดึงหน้าจอที่ใช้อยู่มาแก้ต่อ (รอให้ app.js ตั้งค่าว่าพร้อมก่อน)
      if (obj.hello?.app === 'snp-tpms' && obj.hello.layout) {
        testing = false;
        testedText = '';
        $('layout-cancel').disabled = true;
        setTimeout(() => loadFromDevice(true), 0);
      }
      if (obj.cfg) {
        cfg = { ...DEFAULT_CFG, ...obj.cfg, colors: { ...DEFAULT_CFG.colors, ...obj.cfg.colors } };
        if (layout) runCheck();  // สีและชื่อจากจอจริงเปลี่ยนผลตรวจได้ (เช่น สีกลืนกับพื้น)
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
