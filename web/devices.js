// รู้จักอุปกรณ์จากรหัส USB (VID:PID)  ตรงกับ camtool/ports.py ฝั่ง Python  เพิ่มรุ่นใหม่ได้ที่นี่
// kind: 'at' = โมดูล 4G คุยด้วยคำสั่ง AT, 'serial' = สาย/ชิปแปลง USB เป็นพอร์ตอนุกรม (บอร์ด ESP32, จุด TX/RX)
//       'download' = โมดูลอยู่ในโหมดลงเฟิร์มแวร์

export const KNOWN_USB = {
  '2C7C:0901': { name: 'Quectel EC200U/EG915U', kind: 'at' },
  '2C7C:6002': { name: 'Quectel EC200N/EC200S/EC600N', kind: 'at' },
  '2C7C:0125': { name: 'Quectel EC25/EG25', kind: 'at' },
  '1E0E:9001': { name: 'SIMCom SIM7600', kind: 'at' },
  '1E0E:9011': { name: 'SIMCom A7600', kind: 'at' },
  '1782:4D00': { name: 'Unisoc/Spreadtrum โหมดลงเฟิร์มแวร์', kind: 'download' },
  '1A86:7523': { name: 'ชิป CH340 (บอร์ด ESP32 ส่วนใหญ่ หรือสาย USB-TTL)', kind: 'serial' },
  '1A86:55D4': { name: 'ชิป CH9102 (บอร์ด ESP32 หรือสาย USB-TTL)', kind: 'serial' },
  '10C4:EA60': { name: 'ชิป CP210x (บอร์ด ESP32 หรือสาย USB-TTL)', kind: 'serial' },
  '0403:6001': { name: 'ชิป FTDI (สาย USB-TTL)', kind: 'serial' },
  '067B:2303': { name: 'ชิป PL2303 (สาย USB-TTL)', kind: 'serial' },
  '303A:1001': { name: 'ESP32-S3/C3 (USB ในตัวชิป)', kind: 'serial' },
};

const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');

// info = port.getInfo()  คืน { ids, name, kind }
export function identify(info) {
  if (!info?.usbVendorId) return { ids: '', name: 'พอร์ตอนุกรม', kind: 'unknown' };
  const ids = `${hex(info.usbVendorId)}:${hex(info.usbProductId)}`;
  return { ids, ...(KNOWN_USB[ids] ?? { name: 'อุปกรณ์ที่ยังไม่รู้จัก', kind: 'unknown' }) };
}
