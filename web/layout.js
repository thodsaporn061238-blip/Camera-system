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

// ---------- ตรวจหน้าจอก่อนส่งเข้าจอ ----------
const hexToRgb = (s) => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(s ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const luminance = ([r, g, b]) => {
  const ch = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
export function contrastRatio(a, b) {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return 21;
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ตัวอักษรที่ฟอนต์บนจอมี (สร้างใน tools/gen_fonts.sh)
const TEXT_CHARS = /^[\x20-\x7E°ก-๛]*$/;
const NUMBER_CHARS = /^[0-9.\-]*$/;

const describeItem = (it, i) => {
  const t = (it.type ?? 'text') === 'box' ? 'กล่อง' : `ข้อความ "${String(it.text ?? '').slice(0, 20)}"`;
  return `ชิ้นที่ ${i + 1} (${t})`;
};

// ตรวจหน้าจอทั้งชุด: errors = ส่งเข้าจอไม่ได้, warnings = ส่งได้แต่ควรแก้
// lookup = makeLookup(...) สำหรับแทนค่าตัวอย่าง, measure(text, font) = ความกว้างข้อความ (ไม่ส่งมาจะข้ามการตรวจความยาว)
export function checkLayout(layout, lookup, measure) {
  const errors = validateLayout(layout);
  const warnings = [];
  const problems = new Set();  // ลำดับชิ้นที่มีปัญหา ใช้วาดกรอบเตือนบนภาพตัวอย่าง
  if (errors.length) return { errors, warnings, problems };
  if (!layout.items.length) errors.push('หน้าจอว่าง ไม่มีชิ้นส่วนเลย');
  const ex = (t) => expandTemplate(t, lookup);
  const items = layout.items;

  items.forEach((it, i) => {
    const name = describeItem(it, i);
    const fields = (it.type ?? 'text') === 'box' ? ['bg', 'border'] : ['text', 'color'];
    for (const f of fields) {
      const left = ex(it[f] ?? '').match(/\{[^{}]*\}/);
      if (it[f] !== undefined && left) {
        errors.push(`${name}: ตัวแปร ${left[0]} พิมพ์ผิดหรือไม่มีอยู่จริง`);
        problems.add(i);
      }
    }
    for (const f of fields.filter((k) => k !== 'text')) {
      if (it[f] !== undefined && !hexToRgb(ex(it[f]))) {
        errors.push(`${name}: สี "${it[f]}" ต้องเป็นแบบ #RRGGBB`);
        problems.add(i);
      }
    }
    const x = it.x ?? 0;
    const y = it.y ?? 0;
    if ((it.type ?? 'text') === 'box') {
      if (x + (it.w || 20) > SCREEN.w || y + (it.h || 20) > SCREEN.h) {
        warnings.push(`${name}: ล้นขอบจอ (กว้างได้ถึง 320 สูงได้ถึง 240)`);
        problems.add(i);
      }
      return;
    }
    const size = fontSize(it.font ?? 16);
    const shown = ex(it.text ?? '');
    if (size === 48 && !NUMBER_CHARS.test(shown)) {
      warnings.push(`${name}: ขนาด 48 แสดงได้แค่ตัวเลข จุด และขีด ตัวอื่นจะไม่ขึ้นบนจอ (ใช้ขนาด 24 แทน)`);
      problems.add(i);
    } else if (!TEXT_CHARS.test(shown)) {
      const bad = [...shown].filter((c) => !TEXT_CHARS.test(c));
      warnings.push(`${name}: จอไม่มีตัวอักษร ${[...new Set(bad)].join(' ')} จะขึ้นเป็นช่องว่าง`);
      problems.add(i);
    }
    if (y + size * 1.2 > SCREEN.h + 2) {
      warnings.push(`${name}: ตกขอบล่างของจอ`);
      problems.add(i);
    }
    if (measure && it.w && !it.scroll && measure(shown, size) > it.w + 1) {
      warnings.push(`${name}: ข้อความยาวเกินช่อง (กว้าง ${it.w}) จะขึ้นบรรทัดใหม่ ใส่ "scroll": true ถ้าอยากให้เลื่อนวิ่ง`);
      problems.add(i);
    }
    // สีตัวหนังสือเทียบกับพื้นที่อยู่ข้างใต้ (กล่องล่าสุดที่ครอบจุดเริ่มข้อความ หรือพื้นหลังจอ)
    const px = x + Math.min(it.w || 10, 10);
    const py = y + size / 2;
    const under = items.slice(0, i).reverse().find((b) => b.type === 'box'
      && px >= (b.x ?? 0) && px <= (b.x ?? 0) + (b.w || 20) && py >= (b.y ?? 0) && py <= (b.y ?? 0) + (b.h || 20));
    const bg = ex(under ? under.bg ?? '{c.tile}' : layout.bg ?? '{c.bg}');
    const ratio = contrastRatio(ex(it.color ?? '{c.text}'), bg);
    if (shown.trim() && ratio < 1.6) {
      warnings.push(`${name}: สีตัวหนังสือกลืนกับพื้น มองแทบไม่เห็น`);
      problems.add(i);
    }
  });
  return { errors, warnings, problems };
}

// กรอบของชิ้นบนจอ {x, y, w, h} ใช้วาดกรอบเตือนบนภาพตัวอย่าง
export function itemBounds(it, lookup, measure) {
  const x = it.x ?? 0;
  const y = it.y ?? 0;
  if ((it.type ?? 'text') === 'box') return { x, y, w: it.w || 20, h: it.h || 20 };
  const size = fontSize(it.font ?? 16);
  const w = it.w || (measure ? measure(expandTemplate(it.text, lookup), size) : size);
  return { x, y, w: Math.max(w, 4), h: size * 1.2 };
}

export const FONT_WEIGHT = { 16: 500, 24: 600, 48: 600 };
export const fontSize = (n) => (n >= 40 ? 48 : n >= 20 ? 24 : 16);

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
