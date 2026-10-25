"""อ่านข้อมูลเครื่องและทดสอบ GPS ผ่านคำสั่ง AT"""
import re
import time

from .at import ATError

# ชื่อข้อมูล -> คำสั่ง AT  ถ้ารุ่นไหนไม่รองรับคำสั่งใด จะบันทึกเป็น error แล้วอ่านข้อถัดไปต่อ
INFO_COMMANDS = {
    "manufacturer": "AT+CGMI",
    "model": "AT+CGMM",
    "revision": "AT+CGMR",
    "quectel_revision": "AT+QGMR",
    "imei": "AT+CGSN",
    "imsi": "AT+CIMI",
    "iccid": "AT+QCCID",
    "signal": "AT+CSQ",
    "network_reg": "AT+CREG?",
    "lte_reg": "AT+CEREG?",
    "operator": "AT+COPS?",
    "pdp_contexts": "AT+CGDCONT?",
    "apn_config": "AT+QICSGP=1",
    "gnss_power": "AT+QGPS?",
    "usb_config": 'AT+QCFG="usbnet"',
}


def read_info(at):
    info = {}
    for key, cmd in INFO_COMMANDS.items():
        try:
            info[key] = at.query(cmd)
        except ATError as e:
            info[key] = {"error": e.reply}
    return info


def parse_gpsloc(text):
    """แปลงคำตอบ AT+QGPSLOC=2 เป็น dict"""
    parts = text.split(",")
    if len(parts) < 11:
        return None
    utc, lat, lon, hdop, alt, fix, cog, spkm, _spkn, date, nsat = parts[:11]
    return {
        "utc": utc,
        "date": date,
        "lat": float(lat),
        "lon": float(lon),
        "hdop": float(hdop),
        "altitude_m": float(alt),
        "fix": "3D" if fix == "3" else "2D",
        "course": float(cog) if cog else None,
        "speed_kmh": float(spkm),
        "satellites": int(nsat),
    }


def gps_fix(at, wait=180, interval=5, on_wait=None):
    """เปิด GPS แล้วรอจนได้ตำแหน่ง คืน dict หรือ None ถ้าหมดเวลา"""
    try:
        at.command("AT+QGPS=1")
    except ATError as e:
        if "504" not in e.reply:  # 504 = เปิดอยู่แล้ว
            raise
    deadline = time.monotonic() + wait
    while time.monotonic() < deadline:
        try:
            return parse_gpsloc(at.query("AT+QGPSLOC=2"))
        except ATError as e:
            if "516" not in e.reply:  # 516 = ยังไม่ได้ตำแหน่ง
                raise
        if on_wait:
            on_wait(int(deadline - time.monotonic()))
        time.sleep(interval)
    return None


def safe_name(text):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("_") or "unknown"
