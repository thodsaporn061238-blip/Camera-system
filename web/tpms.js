// ขั้นที่ 9: ตั้งค่าโปรแกรม SNP TPMS บนจอเหลือง (firmware/tpms) ผ่านสาย USB
// โปรแกรมบนจอรับ/ส่ง JSON ทีละบรรทัด: {"get":"cfg"}, {"set":{...}}, {"pair":0}, {"raw":true} ...

const $ = (id) => document.getElementById(id);
const WHEEL_NAMES = ['หน้าซ้าย', 'หน้าขวา', 'หลังซ้าย', 'หลังขวา'];
const COLOR_KEYS = {
  bg: 'พื้นหลัง', tile: 'ช่องล้อ', text: 'ตัวหนังสือ', ok: 'ลมปกติ', low: 'ลมต่ำ / รั่ว', high: 'ลมสูง / ร้อน', stale: 'ขาดการติดต่อ',
};

// แปลงบรรทัดข้อความที่จอส่งมา เป็น object (บรรทัดที่ไม่ใช่ JSON ของเราคืน null)
export function parseLine(line) {
  const t = line.trim();
  if (!t.startsWith('{')) return null;
  try {
    const obj = JSON.parse(t);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

// รวมข้อมูลที่ทยอยเข้ามาเป็นบรรทัด แล้วส่งบรรทัดที่เป็น JSON ให้ onMessage
export function lineSplitter(onMessage) {
  const decoder = new TextDecoder();
  let buf = '';
  return (bytes) => {
    buf += decoder.decode(bytes, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop().slice(-4096);
    for (const line of lines) {
      const obj = parseLine(line);
      if (obj) onMessage(obj);
    }
  };
}

// สร้างคำสั่ง set จากค่าในฟอร์ม
export function buildSet(form) {
  return {
    set: {
      title: form.title,
      names: form.names,
      unit: form.unit,
      low: Number(form.low),
      high: Number(form.high),
      hot: Number(form.hot),
      colors: form.colors,
      buzzer: form.buzzer,
      bright: Number(form.bright),
      rot: Number(form.rot),
      invert: form.invert,
    },
  };
}

// จับคู่เซนเซอร์กับล้อเดียว: ส่ง null ให้ล้ออื่นเพื่อไม่เปลี่ยน
export function buildAssign(wheel, mac) {
  const macs = [null, null, null, null];
  macs[wheel] = mac;
  return { set: { macs } };
}

export function initTpms(send) {
  const sensors = new Map();
  let cfg = null;

  const names = $('tpms-names');
  WHEEL_NAMES.forEach((label, i) => {
    names.insertAdjacentHTML('beforeend',
      `<label>ล้อ${label} <input id="tpms-name-${i}" type="text" maxlength="24"></label>`);
  });
  const colors = $('tpms-colors');
  for (const [key, label] of Object.entries(COLOR_KEYS)) {
    colors.insertAdjacentHTML('beforeend', `<label><input id="tpms-color-${key}" type="color"> ${label}</label>`);
  }

  function fillForm(c) {
    $('tpms-title').value = c.title ?? '';
    c.names?.forEach((n, i) => ($(`tpms-name-${i}`).value = n));
    $('tpms-unit').value = c.unit ?? 'psi';
    $('tpms-low').value = c.low;
    $('tpms-high').value = c.high;
    $('tpms-hot').value = c.hot;
    for (const key of Object.keys(COLOR_KEYS)) if (c.colors?.[key]) $(`tpms-color-${key}`).value = c.colors[key].toLowerCase();
    $('tpms-buzzer').checked = !!c.buzzer;
    $('tpms-bright').value = c.bright;
    $('tpms-rot').value = String(c.rot);
    $('tpms-invert').checked = !!c.invert;
    renderSensors();
  }

  function readForm() {
    return {
      title: $('tpms-title').value,
      names: WHEEL_NAMES.map((_, i) => $(`tpms-name-${i}`).value),
      unit: $('tpms-unit').value,
      low: $('tpms-low').value,
      high: $('tpms-high').value,
      hot: $('tpms-hot').value,
      colors: Object.fromEntries(Object.keys(COLOR_KEYS).map((k) => [k, $(`tpms-color-${k}`).value.toUpperCase()])),
      buzzer: $('tpms-buzzer').checked,
      bright: $('tpms-bright').value,
      rot: $('tpms-rot').value,
      invert: $('tpms-invert').checked,
    };
  }

  function renderSensors() {
    const table = $('tpms-sensors');
    table.innerHTML = '';
    if (!sensors.size) {
      table.insertRow().insertCell().textContent = 'ยังไม่พบเซนเซอร์ (เซนเซอร์บางรุ่นส่งสัญญาณเมื่อล้อหมุนหรือลมเปลี่ยนเท่านั้น)';
      return;
    }
    for (const s of [...sensors.values()].sort((a, b) => b.rssi - a.rssi)) {
      const tr = table.insertRow();
      const wheel = cfg?.macs?.findIndex((m) => m && m.toLowerCase() === s.mac.toLowerCase()) ?? -1;
      tr.insertCell().textContent = `${s.name || '(ไม่มีชื่อ)'}\n${s.mac}\nสัญญาณ ${s.rssi} dBm`;
      const td = tr.insertCell();
      td.className = 'v';
      td.textContent = s.format
        ? `${s.psi} PSI | ${s.temp}°C${s.battery != null ? ` | แบต ${s.battery}%` : ''}${s.volt ? ` | ${s.volt}V` : ''}${s.alarm ? ' | แจ้งเตือน' : ''}`
        : `ยังไม่รู้จักรูปแบบ ข้อมูลดิบ: ${s.mfg || '-'}`;
      const act = tr.insertCell();
      if (wheel >= 0) {
        act.textContent = `ใช้กับล้อ${WHEEL_NAMES[wheel]} `;
        const b = document.createElement('button');
        b.textContent = 'เลิกใช้';
        b.onclick = () => send({ unpair: wheel });
        act.append(b);
      } else {
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="">ใช้กับล้อ...</option>'
          + WHEEL_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('');
        sel.onchange = () => sel.value !== '' && send(buildAssign(Number(sel.value), s.mac));
        act.append(sel);
      }
    }
  }

  $('tpms-get').onclick = () => send({ get: 'cfg' });
  $('tpms-send').onclick = () => send(buildSet(readForm()));
  $('tpms-reset').onclick = () => confirm('คืนค่าตั้งทั้งหมดของจอเป็นค่าเริ่มต้น (รวมการจับคู่เซนเซอร์) ?') && send({ reset: 'cfg' });
  $('tpms-beep').onclick = () => send({ beep: true });
  $('tpms-raw').onchange = () => send({ raw: $('tpms-raw').checked });
  $('tpms-export').onclick = () => {
    const blob = new Blob([JSON.stringify([...sensors.values()], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tpms_sensors.json';
    a.click();
  };

  return {
    onMessage(obj) {
      if (obj.hello?.app === 'snp-tpms') {
        $('tpms-status').textContent = `พบโปรแกรม SNP TPMS เวอร์ชัน ${obj.hello.version} บนจอ ตั้งค่าได้เลย`;
        $('tpms-status').className = 'status ok';
        $('tpms-form').hidden = false;
      }
      if (obj.cfg) {
        cfg = obj.cfg;
        fillForm(cfg);
        $('tpms-form').hidden = false;
      }
      if (obj.sensor?.mac) {
        sensors.set(obj.sensor.mac, { ...sensors.get(obj.sensor.mac), ...obj.sensor, seen: Date.now() });
        renderSensors();
      }
    },
    reset() {
      sensors.clear();
    },
  };
}
