// ปุ่มคำสั่งสำเร็จรูป  { label, cmd, danger }
// danger = เปลี่ยนค่าในเครื่อง: กดแล้วแค่ใส่คำสั่งในช่องให้ตรวจ/แก้ก่อน ไม่ส่งทันที

export const AT_QUICK = {
  'ข้อมูลเครื่อง': [
    { label: 'รุ่นโมดูล', cmd: 'ATI' },
    { label: 'เวอร์ชันเฟิร์มแวร์', cmd: 'AT+QGMR' },
    { label: 'IMEI', cmd: 'AT+CGSN' },
  ],
  'ซิมและเครือข่าย': [
    { label: 'สถานะซิม', cmd: 'AT+CPIN?' },
    { label: 'เลขซิม', cmd: 'AT+QCCID' },
    { label: 'ความแรงสัญญาณ', cmd: 'AT+CSQ' },
    { label: 'เครือข่ายที่ต่อ', cmd: 'AT+COPS?' },
    { label: 'สถานะ 4G', cmd: 'AT+CEREG?' },
    { label: 'APN', cmd: 'AT+CGDCONT?' },
    { label: 'IP ที่ได้', cmd: 'AT+CGPADDR' },
  ],
  'GPS': [
    { label: 'เปิด GPS', cmd: 'AT+QGPS=1' },
    { label: 'ตำแหน่งตอนนี้', cmd: 'AT+QGPSLOC=2' },
    { label: 'ปิด GPS', cmd: 'AT+QGPSEND' },
  ],
  'ไฟล์ในโมดูล': [
    { label: 'รายชื่อไฟล์', cmd: 'AT+QFLST="*"' },
    { label: 'พื้นที่ว่าง', cmd: 'AT+QFLDS="UFS"' },
  ],
  'เปลี่ยนค่า (ตรวจก่อนส่ง)': [
    { label: 'ตั้ง APN', cmd: 'AT+CGDCONT=1,"IP","internet"', danger: true },
    { label: 'รีสตาร์ทโมดูล', cmd: 'AT+CFUN=1,1', danger: true },
  ],
};

export const CONSOLE_QUICK = {
  'ปุ่มพิเศษ': [
    { label: 'รีเซ็ตบอร์ด (ESP32)', reset: true },
    { label: 'Enter', key: '\r' },
    { label: 'Ctrl+C', key: '\x03' },
    { label: 'กด Enter รัว 10 วินาที', key: '\r', repeat: 10 },
    { label: 'กด Ctrl+C รัว 10 วินาที', key: '\x03', repeat: 10 },
  ],
  'U-Boot (ขึ้น =>)': [
    { label: 'คำสั่งทั้งหมด', cmd: 'help' },
    { label: 'ค่าที่ตั้งไว้', cmd: 'printenv' },
    { label: 'เวอร์ชัน', cmd: 'version' },
    { label: 'ข้อมูลบอร์ด', cmd: 'bdinfo' },
    { label: 'พาร์ทิชัน', cmd: 'mtdparts' },
    { label: 'บูตต่อ', cmd: 'boot', danger: true },
  ],
  'Linux (ขึ้น #)': [
    { label: 'ระบบ', cmd: 'uname -a' },
    { label: 'ชิป', cmd: 'cat /proc/cpuinfo' },
    { label: 'พาร์ทิชัน', cmd: 'cat /proc/mtd' },
    { label: 'ค่าบูต', cmd: 'cat /proc/cmdline' },
    { label: 'พื้นที่', cmd: 'df -h' },
    { label: 'โปรแกรมที่รัน', cmd: 'ps' },
    { label: 'เครือข่าย', cmd: 'ifconfig' },
    { label: 'ไฟล์ตั้งค่า', cmd: 'ls -la /etc /mnt /data' },
    { label: 'รีบูต', cmd: 'reboot', danger: true },
  ],
};

// สร้างปุ่มลงใน container  onPick(item) ถูกเรียกเมื่อกด
export function renderQuick(container, groups, onPick) {
  for (const [group, items] of Object.entries(groups)) {
    const title = document.createElement('div');
    title.className = 'group';
    title.textContent = group;
    container.append(title);
    for (const item of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.label;
      b.title = item.cmd ?? '';
      if (item.danger) b.className = 'danger';
      b.onclick = () => onPick(item, b);
      container.append(b);
    }
  }
}
