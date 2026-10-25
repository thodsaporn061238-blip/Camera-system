"""คุยกับโมดูล 4G ด้วยคำสั่ง AT (ทดสอบกับ Quectel EC200U แต่คำสั่งพื้นฐานใช้กับโมดูลยี่ห้ออื่นได้)"""
import re
import time


class ATError(Exception):
    """โมดูลตอบ ERROR หรือ +CME ERROR"""

    def __init__(self, command, reply):
        super().__init__(f"{command} -> {reply}")
        self.command = command
        self.reply = reply


class ATTimeout(Exception):
    """โมดูลไม่ตอบภายในเวลาที่กำหนด"""


_FINAL_ERROR = re.compile(r"^(ERROR|\+CME ERROR:.*|\+CMS ERROR:.*)$")
_QFDWL_END = re.compile(rb"\r\n\+QFDWL: (\d+),([0-9A-Fa-f]+)\r\n")
_QFUPL_END = re.compile(rb"\+QFUPL: (\d+),([0-9A-Fa-f]+)\r\n")


def quectel_checksum(data):
    """checksum ของ Quectel: XOR ทีละ 2 ไบต์ (ไบต์สุดท้ายที่เหลือเดี่ยวถือเป็นไบต์สูง)"""
    value = 0
    for i in range(0, len(data), 2):
        value ^= (data[i] << 8) | (data[i + 1] if i + 1 < len(data) else 0)
    return value


class ATClient:
    def __init__(self, transport, timeout=5.0):
        self.transport = transport
        self.timeout = timeout
        self._buf = bytearray()

    def _fill(self, deadline):
        if time.monotonic() > deadline:
            raise ATTimeout("โมดูลไม่ตอบ")
        chunk = self.transport.read(4096)
        if chunk:
            self._buf += chunk

    def _readline(self, deadline):
        while b"\n" not in self._buf:
            self._fill(deadline)
        line, _, rest = bytes(self._buf).partition(b"\n")
        self._buf = bytearray(rest)
        return line.decode("utf-8", "replace").strip()

    def _read_until(self, pattern, deadline, accept=lambda m: True):
        while True:
            for match in pattern.finditer(self._buf):
                if accept(match):
                    return match
            self._fill(deadline)

    def command(self, cmd, timeout=None):
        """ส่งคำสั่งแล้วคืนบรรทัดคำตอบ (ไม่รวม echo และ OK)"""
        deadline = time.monotonic() + (timeout or self.timeout)
        self._buf.clear()
        self.transport.write(cmd.encode() + b"\r")
        lines = []
        while True:
            line = self._readline(deadline)
            if not line or line == cmd:
                continue
            if line == "OK":
                return lines
            if _FINAL_ERROR.match(line):
                raise ATError(cmd, line)
            lines.append(line)

    def query(self, cmd, timeout=None):
        """เหมือน command แต่คืนข้อความเดียว และตัดหัว +XXX: ออก"""
        lines = self.command(cmd, timeout)
        prefix = cmd[2:].split("=")[0].rstrip("?") + ":"
        return "\n".join(l[len(prefix):].strip() if l.startswith(prefix) else l for l in lines)

    def list_files(self, pattern="*"):
        """รายชื่อไฟล์ในหน่วยความจำของโมดูล คืน [(ชื่อ, ขนาด)]"""
        files = []
        for line in self.command(f'AT+QFLST="{pattern}"', timeout=15):
            match = re.match(r'\+QFLST: "([^"]+)",(\d+)', line)
            if match:
                files.append((match.group(1), int(match.group(2))))
        return files

    def download_file(self, name, timeout=120):
        """อ่านไฟล์จากโมดูลออกมาเป็น bytes และตรวจขนาด/checksum"""
        deadline = time.monotonic() + timeout
        self._buf.clear()
        self.transport.write(f'AT+QFDWL="{name}"\r'.encode())
        while True:
            line = self._readline(deadline)
            if line == "CONNECT":
                break
            if _FINAL_ERROR.match(line):
                raise ATError(f"QFDWL {name}", line)
        # ข้อมูลไฟล์อาจมีข้อความหน้าตาเหมือน +QFDWL อยู่ข้างใน จึงรับเฉพาะตัวที่ขนาดตรงกับตำแหน่ง
        match = self._read_until(_QFDWL_END, deadline, lambda m: int(m.group(1)) == m.start())
        data = bytes(self._buf[: match.start()])
        size, checksum = int(match.group(1)), int(match.group(2), 16)
        self._buf = self._buf[match.end():]
        while self._readline(deadline) != "OK":
            pass
        if len(data) != size:
            raise ATError(f"QFDWL {name}", f"ได้ {len(data)} ไบต์ แต่โมดูลบอก {size}")
        if quectel_checksum(data) != checksum:
            raise ATError(f"QFDWL {name}", "checksum ไม่ตรง")
        return data

    def upload_file(self, name, data, timeout=120):
        """เขียนไฟล์ลงโมดูล (ถ้ามีชื่อเดิมอยู่ต้องลบก่อนด้วย AT+QFDEL)"""
        deadline = time.monotonic() + timeout
        self._buf.clear()
        self.transport.write(f'AT+QFUPL="{name}",{len(data)},{int(timeout)}\r'.encode())
        while True:
            line = self._readline(deadline)
            if line == "CONNECT":
                break
            if _FINAL_ERROR.match(line):
                raise ATError(f"QFUPL {name}", line)
        self.transport.write(data)
        match = self._read_until(_QFUPL_END, deadline)
        size, checksum = int(match.group(1)), int(match.group(2), 16)
        self._buf = self._buf[match.end():]
        while self._readline(deadline) != "OK":
            pass
        if size != len(data) or checksum != quectel_checksum(data):
            raise ATError(f"QFUPL {name}", "โมดูลรับข้อมูลไม่ครบหรือ checksum ไม่ตรง")
