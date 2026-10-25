// ไฟล์ออกแบบหน้าจอของ SNP TPMS: แทนค่าตัวแปร และวาดภาพตัวอย่างจอบนหน้าเว็บ
// หลักการเดียวกับ firmware/tpms/src/layout_bind.cpp และ main.cpp (wheelValue/lookupValue)

export const WHEEL_KEYS = ['fl', 'fr', 'rl', 'rr'];
export const SCREEN = { w: 320, h: 240 };

export function wheelIndex(key) {
  return WHEEL_KEYS.indexOf(key);
}

// "{fl.p} {unit}" -> "34.2 PSI"  key ที่ไม่รู้จักคง {key} ไว้ให้เห็นว่าพิมพ์ผิด
export function expandTemplate(tpl, lookup) {
  return String(tpl ?? '').replace(/\{([^{}]*)\}/g, (whole, key) => {
    const v = lookup(key);
    return v === undefined ? whole : v;
  });
}

const kpaToPsi = (kpa) => kpa * 0.1450377;

// state = { cfg, readings: [ {kpa, temp, battery, volt, alarm} | null x4 ], status }
export function makeLookup({ cfg, readings = [], status = '' }) {
  const c = cfg.colors;
  const unit = cfg.unit === 'kpa' ? 'kPa' : cfg.unit === 'bar' ? 'bar' : 'PSI';
  const fmtP = (kpa) => (cfg.unit === 'kpa' ? kpa.toFixed(0) : cfg.unit === 'bar' ? (kpa / 100).toFixed(2) : kpaToPsi(kpa).toFixed(1));
  const statusOf = (i) => {
    const r = readings[i];
    if (!r) return 'none';
    const psi = kpaToPsi(r.kpa);
    if (psi < cfg.low || r.alarm) return 'low';
    if (psi > cfg.high || r.temp > cfg.hot) return 'high';
    return 'ok';
  };
  const colorOf = (st) => ({ ok: c.ok, low: c.low, high: c.high })[st] ?? c.stale;
  const batt = (r) => (r.volt > 0 ? `${Number(r.volt).toFixed(1)}V` : r.battery >= 0 ? `${r.battery}%` : '--');

  function wheel(i, field) {
    const r = readings[i];
    const st = statusOf(i);
    switch (field) {
      case 'name': return cfg.names[i];
      case 'p': return r ? fmtP(r.kpa) : '--';
      case 'psi': return r ? kpaToPsi(r.kpa).toFixed(1) : '--';
      case 'kpa': return r ? r.kpa.toFixed(0) : '--';
      case 'bar': return r ? (r.kpa / 100).toFixed(2) : '--';
      case 'temp': return r ? r.temp.toFixed(0) : '--';
      case 'batt': return r ? batt(r) : '--';
      case 'info':
        if (!r) return cfg.macs?.[i] ? 'รอสัญญาณ...' : 'กดค้างเพื่อจับคู่';
        return `${r.temp.toFixed(0)}°C | ${batt(r)}`;
      case 'status':
        return { ok: 'ปกติ', low: 'ลมต่ำ', high: 'ลมสูง/ร้อน' }[st] ?? (cfg.macs?.[i] ? 'รอสัญญาณ' : 'ยังไม่จับคู่');
      case 'color': return colorOf(st);
      case 'border': return st === 'low' || st === 'high' ? colorOf(st) : c.tile;
      default: return undefined;
    }
  }

  return (key) => {
    const [head, field] = key.split('.');
    const wi = wheelIndex(head);
    if (wi >= 0 && field !== undefined) return wheel(wi, field);
    if (head === 'c' && field) return c[field];
    if (key === 'unit') return unit;
    if (key === 'title') return cfg.title;
    if (key === 'status') return status;
    return undefined;
  };
}

// ตรวจไฟล์ออกแบบก่อนส่งเข้าจอ คืนรายการปัญหา (ว่าง = ใช้ได้)
export function validateLayout(layout) {
  const errors = [];
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return ['ไฟล์ออกแบบต้องเป็น { ... }'];
  if (!Array.isArray(layout.items)) return ['ต้องมีรายการ "items": [ ... ]'];
  if (layout.items.length > 80) errors.push(`มีชิ้นส่วน ${layout.items.length} ชิ้น เกินที่จอรับได้ (80)`);
  layout.items.forEach((it, i) => {
    const where = `ชิ้นที่ ${i + 1}`;
    if (!it || typeof it !== 'object') return errors.push(`${where}: ต้องเป็น { ... }`);
    const type = it.type ?? 'text';
    if (type !== 'box' && type !== 'text') errors.push(`${where}: type ต้องเป็น "box" หรือ "text"`);
    for (const k of ['x', 'y', 'w', 'h', 'r', 'bw', 'font']) {
      if (it[k] !== undefined && typeof it[k] !== 'number') errors.push(`${where}: ${k} ต้องเป็นตัวเลข`);
    }
    if ((it.x ?? 0) >= SCREEN.w || (it.y ?? 0) >= SCREEN.h) errors.push(`${where}: อยู่นอกจอ (จอกว้าง 320 สูง 240)`);
    if (it.pair !== undefined && wheelIndex(it.pair) < 0) errors.push(`${where}: pair ต้องเป็น fl, fr, rl หรือ rr`);
  });
  return errors;
}

const FONT_WEIGHT = { 16: 500, 24: 600, 48: 600 };
const fontSize = (n) => (n >= 40 ? 48 : n >= 20 ? 24 : 16);

// วาดภาพตัวอย่างจอลง canvas ขนาด 320x240 (ข้อความที่เลื่อนวิ่งบนจอจริง จะถูกตัดท้ายด้วย …)
export function renderPreview(ctx, layout, lookup) {
  const ex = (t) => expandTemplate(t, lookup);
  ctx.save();
  ctx.fillStyle = ex(layout.bg ?? '{c.bg}');
  ctx.fillRect(0, 0, SCREEN.w, SCREEN.h);
  for (const it of layout.items ?? []) {
    const x = it.x ?? 0;
    const y = it.y ?? 0;
    if ((it.type ?? 'text') === 'box') {
      const w = it.w || 20;
      const h = it.h || 20;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, it.r ?? 0);
      ctx.fillStyle = ex(it.bg ?? '{c.tile}');
      ctx.fill();
      if (it.bw) {
        ctx.lineWidth = it.bw;
        ctx.strokeStyle = ex(it.border ?? '{c.text}');
        ctx.beginPath();
        ctx.roundRect(x + it.bw / 2, y + it.bw / 2, w - it.bw, h - it.bw, Math.max(0, (it.r ?? 0) - it.bw / 2));
        ctx.stroke();
      }
    } else {
      const size = fontSize(it.font ?? 16);
      ctx.font = `${FONT_WEIGHT[size]} ${size}px Sarabun, sans-serif`;
      ctx.fillStyle = ex(it.color ?? '{c.text}');
      ctx.textBaseline = 'top';
      let text = ex(it.text ?? '');
      const w = it.w || 0;
      if (w && ctx.measureText(text).width > w) {
        while (text && ctx.measureText(`${text}…`).width > w) text = text.slice(0, -1);
        text += '…';
      }
      const align = it.align ?? 'left';
      ctx.textAlign = align;
      const tx = !w || align === 'left' ? x : align === 'center' ? x + w / 2 : x + w;
      ctx.fillText(text, tx, y + size * 0.1);
    }
  }
  ctx.restore();
}

// ค่าตัวอย่างสำหรับภาพตัวอย่างเมื่อยังไม่มีเซนเซอร์จริง: ปกติ, ลมต่ำ, ร้อน, ยังไม่จับคู่
export const SAMPLE_READINGS = [
  { kpa: 236, temp: 33, battery: 91 },
  { kpa: 172, temp: 31, volt: 2.8 },
  { kpa: 241, temp: 82, battery: 75 },
  null,
];
