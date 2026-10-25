"""คำสั่งหลัก: python -m camtool <คำสั่ง>"""
import argparse
import json
import sys
import time

from . import backup as backup_mod
from . import console, device, ports
from .at import ATClient, ATError, ATTimeout


def _client(args):
    return ATClient(ports.SerialTransport(args.port, args.baud))


def cmd_scan(args):
    found = ports.scan()
    if not found:
        print("ไม่เจอพอร์ตเลย ตรวจสายและไดรเวอร์ USB")
        return
    for dev, ids, desc, what in found:
        print(f"{dev:<14} {ids:<10} {what}\n{'':<25}{desc}")


def cmd_info(args):
    info = device.read_info(_client(args))
    print(json.dumps(info, ensure_ascii=False, indent=2))


def cmd_at(args):
    at = _client(args)
    for cmd in args.commands:
        try:
            print("\n".join(at.command(cmd, timeout=args.timeout)) or "OK")
        except ATError as e:
            print(f"ERROR: {e.reply}")


def cmd_backup(args):
    backup_mod.backup(_client(args), args.out, args.pattern)


def cmd_restore(args):
    if not args.yes:
        answer = input(f"จะเขียนไฟล์จาก {args.folder} ลงกล้อง ทับของเดิม พิมพ์ yes เพื่อยืนยัน: ")
        if answer.strip().lower() != "yes":
            print("ยกเลิก")
            return
    backup_mod.restore(_client(args), args.folder, args.only)
    print("เขียนเสร็จ ให้รีสตาร์ทกล้อง (AT+CFUN=1,1) แล้วตรวจด้วยคำสั่ง info")


def cmd_gps(args):
    print("เปิด GPS แล้ว กำลังรอสัญญาณ (ควรวางกล้องให้เห็นท้องฟ้า)...")
    fix = device.gps_fix(_client(args), wait=args.wait,
                         on_wait=lambda left: print(f"  ยังไม่ได้ตำแหน่ง เหลือ {left} วินาที"))
    if fix:
        print(json.dumps(fix, ensure_ascii=False, indent=2))
        print(f"แผนที่: https://maps.google.com/?q={fix['lat']},{fix['lon']}")
    else:
        print("หมดเวลา ยังไม่ได้ตำแหน่ง ตรวจเสาอากาศ GPS")


def cmd_console(args):
    def open_port(baud):
        return ports.SerialTransport(args.port, baud).serial

    baud = args.baud
    if args.auto:
        print("กำลังเดาความเร็ว ให้ถอดไฟแล้วเสียบไฟกล้องใหม่ตอนนี้...")
        baud = console.guess_baud(open_port)
        if not baud:
            print("เดาไม่ได้ ตรวจว่าต่อ TX/RX/GND ถูก (TX กล้อง -> RX สาย) และไฟเลี้ยงสาย 3.3V")
            return
        print(f"ใช้ความเร็ว {baud}")
    log_path = args.log or f"console_{time.strftime('%Y%m%d-%H%M%S')}.log"
    print(f"บันทึกลง {log_path} กด Ctrl+C เพื่อหยุด")
    port = open_port(baud)
    try:
        console.capture(port, log_path, args.seconds)
    finally:
        port.close()


def build_parser():
    p = argparse.ArgumentParser(prog="camtool", description="สำรองและลงข้อมูลกล้องติดรถ 4G")
    sub = p.add_subparsers(dest="command", required=True)

    def with_port(sp, baud=115200):
        sp.add_argument("--port", required=True, help="พอร์ต เช่น COM5 หรือ /dev/ttyUSB2")
        sp.add_argument("--baud", type=int, default=baud)
        return sp

    sub.add_parser("scan", help="หาพอร์ตที่ต่อกับกล้อง").set_defaults(func=cmd_scan)
    with_port(sub.add_parser("info", help="อ่านข้อมูลเครื่อง (IMEI, รุ่น, เฟิร์มแวร์, ซิม, APN)")).set_defaults(func=cmd_info)

    sp = with_port(sub.add_parser("at", help="ส่งคำสั่ง AT เอง"))
    sp.add_argument("commands", nargs="+")
    sp.add_argument("--timeout", type=float, default=10)
    sp.set_defaults(func=cmd_at)

    sp = with_port(sub.add_parser("backup", help="สำรองข้อมูลเครื่องและไฟล์ทั้งหมดในโมดูล"))
    sp.add_argument("--out", default="backups")
    sp.add_argument("--pattern", default="*", help='เช่น "*" หรือ "UFS:*"')
    sp.set_defaults(func=cmd_backup)

    sp = with_port(sub.add_parser("restore", help="เขียนไฟล์จากโฟลเดอร์สำรองกลับลงกล้อง"))
    sp.add_argument("folder")
    sp.add_argument("--only", nargs="*", help="เขียนเฉพาะชื่อไฟล์เหล่านี้")
    sp.add_argument("--yes", action="store_true", help="ไม่ต้องถามยืนยัน")
    sp.set_defaults(func=cmd_restore)

    sp = with_port(sub.add_parser("gps", help="ทดสอบ GPS ในตัว"))
    sp.add_argument("--wait", type=int, default=180)
    sp.set_defaults(func=cmd_gps)

    sp = with_port(sub.add_parser("console", help="บันทึก log ตอนบูตจากจุด TX/RX บนบอร์ด"))
    sp.add_argument("--auto", action="store_true", help="เดาความเร็ว baud ให้อัตโนมัติ")
    sp.add_argument("--log")
    sp.add_argument("--seconds", type=float)
    sp.set_defaults(func=cmd_console)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        args.func(args)
    except ATTimeout:
        sys.exit("กล้องไม่ตอบ: ตรวจว่าเลือกพอร์ต AT ถูก (โมดูลมีหลายพอร์ต ลองพอร์ตอื่น) และกล้องเปิดอยู่")
    except ImportError:
        sys.exit("ยังไม่ได้ติดตั้ง pyserial: pip install -r requirements.txt")
