"""อ่าน log ตอนบูตจากจุด TX/RX บนบอร์ด เพื่อดูว่าชิปหลักและระบบข้างในเป็นอะไร"""
import time

COMMON_BAUDS = [115200, 921600, 1500000, 57600, 38400, 19200, 9600]


def readable_score(data):
    """สัดส่วนตัวอักษรที่อ่านออก ใช้เดาความเร็ว baud ที่ถูกต้อง"""
    if not data:
        return 0.0
    ok = sum(1 for b in data if 32 <= b < 127 or b in (9, 10, 13))
    return ok / len(data)


def guess_baud(open_port, seconds=3, bauds=COMMON_BAUDS, log=print):
    """ลองทีละความเร็ว คืนความเร็วที่อ่านออกมากที่สุด (ต้องเปิดเครื่องกล้องระหว่างลอง)"""
    best = (0.0, None)
    for baud in bauds:
        port = open_port(baud)
        try:
            data = bytearray()
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                data += port.read(4096)
        finally:
            port.close()
        score = readable_score(data)
        log(f"  {baud:>8}: ได้ {len(data)} ไบต์ อ่านออก {score:.0%}")
        if len(data) >= 32 and score > best[0]:
            best = (score, baud)
    return best[1]


def capture(port, log_path, seconds=None, echo=print):
    """บันทึกทุกอย่างที่กล้องพิมพ์ออกมาลงไฟล์ จนครบเวลาหรือกด Ctrl+C"""
    end = time.monotonic() + seconds if seconds else None
    with open(log_path, "ab") as f:
        try:
            while end is None or time.monotonic() < end:
                data = port.read(4096)
                if data:
                    f.write(data)
                    f.flush()
                    echo(data.decode("utf-8", "replace"), end="")
        except KeyboardInterrupt:
            pass
