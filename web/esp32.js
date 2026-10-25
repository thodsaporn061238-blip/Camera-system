// อ่านและลงโปรแกรมของบอร์ด ESP32 ผ่าน bootloader ในชิป ใช้ไลบรารี esptool-js ของ Espressif (web/vendor)
import { ESPLoader, Transport } from './vendor/esptool-js-0.7.0.js';

// port = SerialPort ที่ยังไม่ได้เปิด  log(text) รับข้อความความคืบหน้า
// task(loader, chip) ทำงานกับชิป แล้วรีเซ็ตบอร์ดให้กลับไปทำงานปกติเสมอ
export async function withEsp32(port, { baudrate = 460800, log = () => {} }, task) {
  const transport = new Transport(port, false);
  const terminal = { clean() {}, writeLine: (s) => log(s), write: (s) => log(s) };
  const loader = new ESPLoader({ transport, baudrate, romBaudrate: 115200, terminal });
  try {
    const chip = await loader.main('default_reset');
    return await task(loader, chip);
  } finally {
    try {
      await loader.after('hard_reset');
    } catch {
      // ต่อไม่ติดตั้งแต่แรก
    }
    await transport.disconnect();
  }
}

export async function readChipInfo(loader, chip) {
  const rom = loader.chip;
  const flashSize = await loader.detectFlashSize();
  return {
    chip,
    features: (await rom.getChipFeatures(loader)).join(', '),
    crystal: `${await rom.getCrystalFreq(loader)} MHz`,
    mac: await rom.readMac(loader),
    flashSize: flashSize ?? 'ไม่ทราบ',
    flashBytes: flashSize ? loader.flashSizeBytes(flashSize) : 0,
  };
}

// อ่านหน่วยความจำแฟลชทั้งก้อน = สำรองโปรแกรมเดิมทั้งหมด (bootloader, ตารางพาร์ทิชัน, โปรแกรม, ค่าที่ตั้งไว้)
export async function readWholeFlash(loader, flashBytes, onProgress) {
  return loader.readFlash(0, flashBytes, (_packet, done, total) => onProgress?.(done, total));
}

// เขียนไฟล์ .bin ลงแฟลชที่ตำแหน่ง address (ไฟล์สำรองทั้งก้อนใช้ 0x0, ไฟล์โปรแกรมอย่างเดียวมักใช้ 0x10000)
export async function writeImage(loader, data, address, onProgress) {
  await loader.writeFlash({
    fileArray: [{ data, address }],
    flashMode: 'keep',
    flashFreq: 'keep',
    flashSize: 'keep',
    eraseAll: false,
    compress: true,
    reportProgress: (_i, written, total) => onProgress?.(written, total),
  });
}
