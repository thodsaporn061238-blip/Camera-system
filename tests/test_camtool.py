"""ทดสอบด้วยโมดูลจำลอง (ไม่ต้องต่อกล้องจริง)"""
import json
import re
import tempfile
import unittest
from pathlib import Path

from camtool.at import ATClient, ATError, quectel_checksum
from camtool.backup import backup, restore
from camtool.console import readable_score
from camtool.device import gps_fix, parse_gpsloc, read_info


class FakeModule:
    """จำลอง Quectel EC200U: ตอบคำสั่ง AT, มีไฟล์ในหน่วยความจำ, รับ/ส่งไฟล์ได้"""

    def __init__(self, files=None, gps_after=0):
        self.files = dict(files or {})
        self.out = bytearray()
        self.uploading = None
        self.gps_after = gps_after
        self.log = []

    def read(self, size):
        chunk, self.out = bytes(self.out[:size]), self.out[size:]
        return chunk

    def reply(self, *lines):
        for line in lines:
            self.out += line if isinstance(line, bytes) else f"\r\n{line}\r\n".encode()

    def write(self, data):
        if self.uploading:
            name, size, buf = self.uploading
            buf += data
            if len(buf) >= size:
                self.files[name] = bytes(buf[:size])
                self.uploading = None
                self.reply(f"+QFUPL: {size},{quectel_checksum(self.files[name]):x}", "OK")
            return
        cmd = data.decode().strip()
        self.log.append(cmd)
        self.out += data  # echo
        if cmd == "AT+CGSN":
            self.reply("866123456789012", "OK")
        elif cmd == "AT+CGMM":
            self.reply("EC200U", "OK")
        elif cmd == "AT+QICSGP=1":
            self.reply('+QICSGP: 1,"internet","","",0', "OK")
        elif cmd == "AT+CIMI":
            self.reply("+CME ERROR: 10", )
        elif cmd.startswith("AT+QFLST"):
            self.reply(*[f'+QFLST: "{n}",{len(d)}' for n, d in self.files.items()], "OK")
        elif m := re.match(r'AT\+QFDWL="(.+)"', cmd):
            data = self.files.get(m.group(1))
            if data is None:
                return self.reply("+CME ERROR: 405")
            self.reply("CONNECT")
            self.out += data  # ข้อมูลไฟล์ตามหลัง CONNECT\r\n ทันที
            self.reply(f"+QFDWL: {len(data)},{quectel_checksum(data):x}", "OK")
        elif m := re.match(r'AT\+QFUPL="(.+)",(\d+),\d+', cmd):
            self.uploading = (m.group(1), int(m.group(2)), bytearray())
            self.reply("CONNECT")
        elif m := re.match(r'AT\+QFDEL="(.+)"', cmd):
            self.reply("OK" if self.files.pop(m.group(1), None) is not None else "+CME ERROR: 405")
        elif cmd == "AT+QGPS=1":
            self.reply("OK")
        elif cmd == "AT+QGPSLOC=2":
            if self.gps_after > 0:
                self.gps_after -= 1
                return self.reply("+CME ERROR: 516")
            self.reply("+QGPSLOC: 061951.000,13.75633,100.50177,1.1,12.3,3,0.00,25.4,13.7,251026,08", "OK")
        else:
            self.reply("ERROR")


class ATClientTest(unittest.TestCase):
    def test_query_strips_echo_and_prefix(self):
        at = ATClient(FakeModule(), timeout=1)
        self.assertEqual(at.query("AT+CGSN"), "866123456789012")
        self.assertEqual(at.query("AT+QICSGP=1"), '1,"internet","","",0')

    def test_error_raises(self):
        with self.assertRaises(ATError) as ctx:
            ATClient(FakeModule(), timeout=1).command("AT+CIMI")
        self.assertIn("CME ERROR: 10", ctx.exception.reply)

    def test_download_binary_file_containing_ok_text(self):
        data = bytes(range(256)) + b"\r\nOK\r\n+QFDWL: 1,0\r\nx"
        at = ATClient(FakeModule({"UFS:cfg.bin": data}), timeout=1)
        # ข้อมูลที่บังเอิญมีคำว่า +QFDWL อยู่ข้างในต้องไม่ทำให้ตัดไฟล์ผิด ถ้าตัดผิด checksum/ขนาดจะไม่ตรง
        try:
            self.assertEqual(at.download_file("UFS:cfg.bin", timeout=1), data)
        except ATError:
            self.fail("อ่านไฟล์ที่มีข้อความคล้ายคำตอบผิด")

    def test_upload_then_download_roundtrip(self):
        module = FakeModule()
        at = ATClient(module, timeout=1)
        at.upload_file("UFS:new.cfg", b"server=1.2.3.4:6808\n", timeout=1)
        self.assertEqual(module.files["UFS:new.cfg"], b"server=1.2.3.4:6808\n")
        self.assertEqual(at.download_file("UFS:new.cfg", timeout=1), b"server=1.2.3.4:6808\n")

    def test_checksum_odd_length(self):
        self.assertEqual(quectel_checksum(b"\x12\x34\x56"), 0x1234 ^ 0x5600)


class DeviceTest(unittest.TestCase):
    def test_read_info_keeps_going_after_errors(self):
        info = read_info(ATClient(FakeModule(), timeout=1))
        self.assertEqual(info["imei"], "866123456789012")
        self.assertEqual(info["model"], "EC200U")
        self.assertEqual(info["imsi"], {"error": "+CME ERROR: 10"})

    def test_gps_waits_for_fix(self):
        fix = gps_fix(ATClient(FakeModule(gps_after=2), timeout=1), wait=5, interval=0)
        self.assertAlmostEqual(fix["lat"], 13.75633)
        self.assertEqual(fix["satellites"], 8)
        self.assertEqual(fix["fix"], "3D")

    def test_parse_gpsloc_short_reply(self):
        self.assertIsNone(parse_gpsloc("1,2,3"))


class BackupTest(unittest.TestCase):
    def test_backup_and_restore(self):
        files = {"UFS:app.cfg": b"ip=old.example.com\n", "UFS:cert.pem": b"-----BEGIN-----"}
        module = FakeModule(files)
        at = ATClient(module, timeout=1)
        with tempfile.TemporaryDirectory() as tmp:
            folder = backup(at, tmp, log=lambda *_: None)
            self.assertTrue(folder.name.startswith("866123456789012_"))
            manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(len(manifest["files"]), 2)

            module.files.clear()
            restore(at, folder, log=lambda *_: None)
            self.assertEqual(module.files, files)

            # ไฟล์สำรองถูกแก้ ต้องไม่ยอมเขียนลงเครื่อง
            (folder / manifest["files"][0]["local"]).write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                restore(at, folder, log=lambda *_: None)


class ConsoleTest(unittest.TestCase):
    def test_readable_score(self):
        self.assertEqual(readable_score(b"U-Boot 2016\r\n"), 1.0)
        self.assertLess(readable_score(bytes(range(128, 256))), 0.1)


if __name__ == "__main__":
    unittest.main()
