"""หาพอร์ตที่ต่อกับกล้อง และบอกว่าเป็นอุปกรณ์อะไรจากรหัส USB (VID:PID)"""

# (VID, PID) -> คำอธิบาย  เพิ่มรุ่นใหม่ได้ที่นี่
KNOWN_USB = {
    (0x2C7C, 0x0901): "Quectel EC200U/EG915U (โหมดปกติ ใช้คำสั่ง AT ได้)",
    (0x2C7C, 0x6002): "Quectel EC200N/EC200S/EC600N",
    (0x2C7C, 0x0125): "Quectel EC25/EG25",
    (0x1782, 0x4D00): "Unisoc/Spreadtrum โหมดลงเฟิร์มแวร์ (download mode)",
    (0x1E0E, 0x9001): "SIMCom SIM7600",
    (0x1E0E, 0x9011): "SIMCom A7600",
    (0x1A86, 0x7523): "สาย USB-TTL ชิป CH340",
    (0x1A86, 0x55D4): "สาย USB-TTL ชิป CH9102",
    (0x10C4, 0xEA60): "สาย USB-TTL ชิป CP210x",
    (0x0403, 0x6001): "สาย USB-TTL ชิป FTDI",
    (0x067B, 0x2303): "สาย USB-TTL ชิป PL2303",
}


def identify(vid, pid):
    if vid is None:
        return "ไม่ใช่อุปกรณ์ USB"
    return KNOWN_USB.get((vid, pid), "ไม่รู้จัก (ส่ง VID:PID ให้ผู้พัฒนาเพิ่มในรายการ)")


def scan():
    """คืนรายการพอร์ตทั้งหมด [(พอร์ต, VID:PID, ชื่อจากระบบ, คำอธิบาย)]"""
    from serial.tools import list_ports

    result = []
    for p in sorted(list_ports.comports(), key=lambda p: p.device):
        ids = f"{p.vid:04X}:{p.pid:04X}" if p.vid is not None else "-"
        result.append((p.device, ids, p.description or "", identify(p.vid, p.pid)))
    return result


class SerialTransport:
    """ห่อ pyserial ให้มี read/write แบบที่ ATClient ต้องการ"""

    def __init__(self, port, baud=115200):
        import serial

        self.serial = serial.Serial(port, baud, timeout=0.2)

    def read(self, size):
        return self.serial.read(size)

    def write(self, data):
        self.serial.write(data)
        self.serial.flush()

    def close(self):
        self.serial.close()
