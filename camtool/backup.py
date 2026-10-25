"""สำรองข้อมูลเดิมจากโมดูล และเขียนกลับ (restore)"""
import hashlib
import json
import time
from pathlib import Path

from .at import ATError
from .device import read_info, safe_name


def backup(at, out_dir, pattern="*", log=print):
    """อ่านข้อมูลเครื่อง + ไฟล์ทั้งหมดในโมดูล เก็บลงโฟลเดอร์ใหม่ คืน path ของโฟลเดอร์"""
    info = read_info(at)
    imei = info.get("imei") if isinstance(info.get("imei"), str) else "noimei"
    folder = Path(out_dir) / f"{safe_name(imei)}_{time.strftime('%Y%m%d-%H%M%S')}"
    (folder / "files").mkdir(parents=True)
    (folder / "info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"บันทึกข้อมูลเครื่องแล้ว: {folder / 'info.json'}")

    manifest = {"info": info, "files": [], "failed": []}
    try:
        files = at.list_files(pattern)
    except ATError as e:
        log(f"รุ่นนี้ไม่รองรับการอ่านรายชื่อไฟล์ ({e.reply}) ข้ามขั้นนี้")
        files = []
    for name, size in files:
        log(f"  กำลังอ่าน {name} ({size} ไบต์)")
        try:
            data = at.download_file(name)
        except ATError as e:
            log(f"    อ่านไม่ได้: {e.reply}")
            manifest["failed"].append({"name": name, "size": size, "error": e.reply})
            continue
        local = folder / "files" / safe_name(name)
        local.write_bytes(data)
        manifest["files"].append({
            "name": name,
            "local": f"files/{local.name}",
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        })
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"สำรองเสร็จ: {len(manifest['files'])} ไฟล์, อ่านไม่ได้ {len(manifest['failed'])} ไฟล์ -> {folder}")
    return folder


def restore(at, folder, only=None, log=print):
    """เขียนไฟล์จากโฟลเดอร์สำรองกลับลงโมดูล (ตรวจ sha256 ก่อนเขียน)"""
    folder = Path(folder)
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["files"]:
        if only and entry["name"] not in only:
            continue
        data = (folder / entry["local"]).read_bytes()
        if hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise ValueError(f"ไฟล์สำรอง {entry['local']} ถูกแก้หรือเสีย ไม่เขียนลงเครื่อง")
        try:
            at.command(f'AT+QFDEL="{entry["name"]}"')
        except ATError:
            pass  # ไม่มีไฟล์เดิมอยู่
        at.upload_file(entry["name"], data)
        log(f"  เขียน {entry['name']} แล้ว ({len(data)} ไบต์)")
