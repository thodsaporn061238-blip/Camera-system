// ตัวแปลคำสั่งภาษาไทยเป็นการแก้ไฟล์ออกแบบหน้าจอ (ขั้นที่ 10) ไม่ใช้ AI ทำงานในเบราว์เซอร์ทันที
// รับคำสั่งหลายข้อในครั้งเดียวได้ คั่นด้วยขึ้นบรรทัดใหม่ เครื่องหมาย , หรือคำว่า "แล้ว"

export const THAI_COLORS = {
  แดง: '#FF3B30', เขียว: '#34C759', น้ำเงิน: '#1E5BFF', ฟ้า: '#00AEEF', เหลือง: '#FFD60A', ส้ม: '#FF9500',
  ชมพู: '#FF5FA2', ม่วง: '#AF52DE', ขาว: '#FFFFFF', ดำ: '#000000', เทา: '#8E8E93', น้ำตาล: '#A2845E', ทอง: '#D4AF37',
};

// ยาวก่อนสั้น เพื่อให้ "ล้อหน้าซ้าย" ถูกจับก่อน "ล้อหน้า"
const WHEEL_WORDS = [
  ['ล้อหน้าซ้าย', ['fl']], ['ล้อหน้าขวา', ['fr']], ['ล้อหลังซ้าย', ['rl']], ['ล้อหลังขวา', ['rr']],
  ['หน้าซ้าย', ['fl']], ['หน้าขวา', ['fr']], ['หลังซ้าย', ['rl']], ['หลังขวา', ['rr']],
  ['ล้อหน้า', ['fl', 'fr']], ['ล้อหลัง', ['rl', 'rr']],
  ['ทุกล้อ', ['fl', 'fr', 'rl', 'rr']], ['ทุกช่อง', ['fl', 'fr', 'rl', 'rr']], ['ทั้งหมด', ['fl', 'fr', 'rl', 'rr']],
];
const ALL_WHEELS = ['fl', 'fr', 'rl', 'rr'];
const WHEEL_TH = { fl: 'ล้อหน้าซ้าย', fr: 'ล้อหน้าขวา', rl: 'ล้อหลังซ้าย', rr: 'ล้อหลังขวา' };

// ส่วนของหน้าจอ: คำที่ผู้ใช้พิมพ์ -> วิธีหาชิ้นส่วนในไฟล์ออกแบบ
const PARTS = [
  { key: 'bg', words: ['พื้นหลัง', 'พื้นจอ', 'สีพื้น'], th: 'พื้นหลังจอ' },
  { key: 'border', words: ['ขอบ', 'กรอบ'], th: 'ขอบช่อง', wheel: true },
  { key: 'number', words: ['ตัวเลข', 'ค่าลม', 'แรงดัน', 'ลมยาง'], th: 'ตัวเลขลมยาง', wheel: true },
  { key: 'name', words: ['ชื่อล้อ', 'ชื่อ'], th: 'ชื่อ', wheel: true },
  { key: 'info', words: ['อุณหภูมิ', 'แบต', 'ข้อมูล', 'รายละเอียด'], th: 'ข้อมูลอุณหภูมิ/แบต', wheel: true },
  { key: 'box', words: ['ช่อง', 'กล่อง'], th: 'ช่อง', wheel: true },
  { key: 'title', words: ['หัวข้อ', 'หัวเรื่อง'], th: 'หัวข้อ' },
  { key: 'status', words: ['สถานะ'], th: 'ข้อความสถานะ' },
];

const has = (s, w) => s.includes(w);

function findWheels(text) {
  let rest = text;
  const found = new Set();
  for (const [word, keys] of WHEEL_WORDS) {
    if (rest.includes(word)) {
      keys.forEach((k) => found.add(k));
      rest = rest.split(word).join(' ');
    }
  }
  return { wheels: [...found], rest };
}

function findPart(text) {
  for (const p of PARTS) if (p.words.some((w) => has(text, w))) return p;
  return null;
}

function findColor(text) {
  const hex = text.match(/#[0-9a-fA-F]{6}\b/);
  if (hex) return { value: hex[0].toUpperCase(), th: hex[0].toUpperCase() };
  if (has(text, 'ตามสถานะ')) return { value: 'status', th: 'สีตามสถานะลมยาง' };
  // ยาวก่อนสั้น ("น้ำเงิน" ก่อน "เงิน" ถ้ามีในอนาคต)
  const names = Object.keys(THAI_COLORS).sort((a, b) => b.length - a.length);
  for (const n of names) if (has(text, n)) return { value: THAI_COLORS[n], th: `สี${n}` };
  return null;
}

// หาชิ้นส่วนที่ตรงกับ "ส่วน" + "ล้อ"
function matchItems(layout, part, wheels) {
  const items = layout.items ?? [];
  const textHas = (it, re) => (it.type ?? 'text') === 'text' && re.test(it.text ?? '');
  const ws = wheels.length ? wheels : ALL_WHEELS;
  const anyWheel = (fn) => items.filter((it) => ws.some((w) => fn(it, w)));
  switch (part.key) {
    case 'number': return anyWheel((it, w) => textHas(it, new RegExp(`\\{${w}\\.(p|psi|kpa|bar)\\}`)));
    case 'name': return anyWheel((it, w) => textHas(it, new RegExp(`\\{${w}\\.name\\}`)));
    case 'info': return anyWheel((it, w) => textHas(it, new RegExp(`\\{${w}\\.(info|temp|batt)\\}`)));
    case 'box':
    case 'border': return anyWheel((it, w) => it.type === 'box' && it.pair === w);
    case 'title': return items.filter((it) => textHas(it, /\{title\}/) || it.role === 'title');
    case 'status': return items.filter((it) => textHas(it, /\{status\}/));
    default: return [];
  }
}

const FONT_STEPS = [16, 24, 48];
const onlyNumberText = (it) => /^\{(fl|fr|rl|rr)\.(p|psi|kpa|bar)\}$/.test((it.text ?? '').trim());

function describe(part, wheels) {
  if (!part.wheel) return part.th;
  const ws = wheels.length ? wheels : ALL_WHEELS;
  return `${part.th}${ws.length === 4 ? 'ทุกล้อ' : ws.map((w) => WHEEL_TH[w]).join(' ')}`;
}

// คำสั่งเดียว แก้ layout ในที่ คืน { ok, message }
function applyOne(layout, raw) {
  const text = raw.trim();
  if (!text) return null;
  const { wheels, rest } = findWheels(text);

  // เพิ่มข้อความใหม่: เพิ่มข้อความ 'xxx' (ตรงกลาง|บน|ล่าง) (ใหญ่)
  if (has(text, 'เพิ่มข้อความ')) {
    const quoted = text.match(/['"“”‘’]([^'"“”‘’]+)['"“”‘’]/);
    const words = quoted ? quoted[1] : text.replace(/.*เพิ่มข้อความ/, '').replace(/(ตรงกลาง|กลางจอ|ด้านบน|บนสุด|ด้านล่าง|ล่างสุด|ตัวใหญ่|ใหญ่)/g, '').trim();
    if (!words) return { ok: false, message: `"${text}": ไม่รู้ว่าจะเพิ่มข้อความอะไร ใส่ในเครื่องหมายคำพูด เช่น เพิ่มข้อความ 'รถ 01'` };
    const font = has(text, 'ใหญ่') ? 24 : 16;
    const y = has(text, 'บน') ? 4 : has(text, 'ล่าง') ? 240 - font - 8 : 120 - font / 2;
    const color = findColor(text.replace(words, ''));
    layout.items.push({ type: 'text', x: 0, y: Math.round(y), w: 320, align: 'center', font, color: color && color.value !== 'status' ? color.value : '{c.text}', text: words, scroll: true });
    return { ok: true, message: `เพิ่มข้อความ "${words}"` };
  }

  const part = findPart(rest);
  if (!part) return { ok: false, message: `"${text}": ไม่รู้ว่าหมายถึงส่วนไหน (ตัวเลข ชื่อ ข้อมูล ช่อง ขอบ หัวข้อ สถานะ พื้นหลัง)` };

  // พื้นหลังจอ
  if (part.key === 'bg') {
    const color = findColor(rest.replace('สีพื้น', 'พื้น'));
    if (!color || color.value === 'status') return { ok: false, message: `"${text}": บอกสีด้วย เช่น พื้นหลังสีดำ` };
    layout.bg = color.value;
    return { ok: true, message: `เปลี่ยนพื้นหลังจอเป็น${color.th}` };
  }

  const items = matchItems(layout, part, wheels);
  if (!items.length) return { ok: false, message: `"${text}": ไม่พบ${describe(part, wheels)}ในหน้าจอนี้` };
  const what = describe(part, wheels);

  // ซ่อน / ลบ
  if (/(ซ่อน|ลบ|เอาออก)/.test(rest)) {
    layout.items = layout.items.filter((it) => !items.includes(it));
    return { ok: true, message: `ลบ${what}แล้ว (${items.length} ชิ้น)` };
  }

  // ย้าย ขึ้น/ลง/ซ้าย/ขวา N
  if (/(ย้าย|เลื่อน)/.test(rest)) {
    const n = Number(rest.match(/(\d+)/)?.[1] ?? 10);
    const dir = has(rest, 'ขึ้น') ? [0, -n] : has(rest, 'ลง') ? [0, n] : has(rest, 'ซ้าย') ? [-n, 0] : has(rest, 'ขวา') ? [n, 0] : null;
    if (!dir) return { ok: false, message: `"${text}": บอกทิศด้วย ขึ้น ลง ซ้าย หรือ ขวา` };
    for (const it of items) {
      it.x = Math.max(0, Math.min(319, (it.x ?? 0) + dir[0]));
      it.y = Math.max(0, Math.min(239, (it.y ?? 0) + dir[1]));
    }
    return { ok: true, message: `ย้าย${what} ${dir[0] ? `${dir[0] > 0 ? 'ขวา' : 'ซ้าย'}` : `${dir[1] > 0 ? 'ลง' : 'ขึ้น'}`} ${n} จุด` };
  }

  // ชิดซ้าย / กลาง / ขวา
  const align = has(rest, 'ชิดซ้าย') ? 'left' : has(rest, 'ชิดขวา') ? 'right' : /(ชิดกลาง|จัดกลาง|ตรงกลาง)/.test(rest) ? 'center' : null;
  if (align) {
    const texts = items.filter((it) => (it.type ?? 'text') === 'text');
    texts.forEach((it) => (it.align = align));
    return { ok: true, message: `จัด${what}${{ left: 'ชิดซ้าย', right: 'ชิดขวา', center: 'ตรงกลาง' }[align]}` };
  }

  // ใหญ่ขึ้น / เล็กลง
  const bigger = /(ใหญ่|ขยาย)/.test(rest);
  const smaller = has(rest, 'เล็ก');
  if (bigger || smaller) {
    const texts = items.filter((it) => (it.type ?? 'text') === 'text');
    if (!texts.length) return { ok: false, message: `"${text}": ปรับขนาดได้เฉพาะตัวหนังสือ` };
    let changed = 0;
    for (const it of texts) {
      const i = FONT_STEPS.indexOf(FONT_STEPS.find((f) => f >= (it.font ?? 16)) ?? 16);
      let next = FONT_STEPS[Math.max(0, Math.min(FONT_STEPS.length - 1, i + (bigger ? 1 : -1)))];
      if (next === 48 && !onlyNumberText(it)) next = 24;  // ขนาด 48 มีแค่ตัวเลข
      if (next !== it.font) {
        it.font = next;
        changed++;
      }
    }
    if (!changed) return { ok: false, message: `${what}${bigger ? 'ใหญ่สุด' : 'เล็กสุด'}แล้ว (ตัวหนังสือมี 16, 24 และ 48 เฉพาะตัวเลข)` };
    return { ok: true, message: `${bigger ? 'ขยาย' : 'ย่อ'}${what}` };
  }

  // เปลี่ยนข้อความหัวข้อ / สถานะ เป็นข้อความที่พิมพ์ (ถ้าหลัง "เป็น" ขึ้นต้นด้วย "สี" ถือว่าเปลี่ยนสี)
  const asText = text.match(/เป็น\s*(.+)$/);
  if ((part.key === 'title' || part.key === 'status') && asText && !asText[1].startsWith('สี')) {
    const value = asText[1].replace(/^['"“”‘’]|['"“”‘’]$/g, '').trim();
    items.forEach((it) => {
      it.text = value;
      if (part.key === 'title') it.role = 'title';
    });
    return { ok: true, message: `เปลี่ยน${what}เป็น "${value}"` };
  }

  // สี
  const color = findColor(rest);
  if (color) {
    let recolored = 0;
    for (const it of items) {
      if (part.key === 'border') {
        it.border = color.value === 'status' ? `{${it.pair}.color}` : color.value;
        it.bw = Math.max(it.bw ?? 0, 2);
      } else if (it.type === 'box') {
        it.bg = color.value === 'status' ? `{${it.pair}.color}` : color.value;
        // ช่องเป็นสีตามสถานะแล้ว ตัวหนังสือที่ใช้สีตามสถานะเดียวกันจะกลืนกับพื้น จึงเปลี่ยนเป็นสีดำ
        if (color.value === 'status') {
          for (const t of layout.items) {
            if ((t.type ?? 'text') === 'text' && t.color === `{${it.pair}.color}`) {
              t.color = '#000000';
              recolored++;
            }
          }
        }
      } else {
        const w = (it.text ?? '').match(/\{(fl|fr|rl|rr)\./)?.[1];
        it.color = color.value === 'status' ? (w ? `{${w}.color}` : '{c.text}') : color.value;
      }
    }
    const note = recolored ? ` (ตัวเลขในช่องเปลี่ยนเป็นสีดำ จะได้ไม่กลืนกับพื้น)` : '';
    return { ok: true, message: `เปลี่ยน${what}เป็น${color.th}${note}` };
  }

  return { ok: false, message: `"${text}": ไม่รู้ว่าจะให้ทำอะไรกับ${what} (เปลี่ยนสี ขยาย ย่อ ย้าย ซ่อน ชิดซ้าย/กลาง/ขวา)` };
}

// คืนไฟล์ออกแบบชุดใหม่ (ไม่แก้ของเดิม) พร้อมผลของแต่ละคำสั่ง
export function applyThaiCommands(layout, input) {
  const next = structuredClone(layout);
  next.items ??= [];
  const results = [];
  for (const part of String(input).split(/\n|,|，|\s+แล้ว\s*|\s+และ\s+/)) {
    const r = applyOne(next, part);
    if (r) results.push(r);
  }
  return { layout: next, results, changed: results.some((r) => r.ok) };
}

export const THAI_EXAMPLES = [
  'เปลี่ยนสีตัวเลขล้อหน้าซ้ายเป็นฟ้า',
  'ขยายชื่อทุกล้อ',
  'ช่องทุกล้อสีตามสถานะ',
  'ขอบล้อหลังสีแดง',
  'ย้ายหัวข้อลง 10',
  'หัวข้อเป็น รถ 01',
  "เพิ่มข้อความ 'ขับขี่ปลอดภัย' ด้านล่าง",
  'พื้นหลังสีน้ำเงิน',
  'ซ่อนข้อมูลล้อหลังขวา',
];
