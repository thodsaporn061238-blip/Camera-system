#!/usr/bin/env bash
# รวม bootloader + ตารางพาร์ทิชัน + โปรแกรม เป็นไฟล์เดียว ลงที่ตำแหน่ง 0x0 ได้ทันที (ปุ่มในขั้นที่ 9 ของหน้าเว็บ)
# ใช้หลัง pio run -d firmware/tpms   ผลลัพธ์: build/snp-tpms.bin
set -euo pipefail
cd "$(dirname "$0")/.."

B=firmware/tpms/.pio/build/cyd
BOOT_APP0="$HOME/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin"
mkdir -p build
python -m esptool --chip esp32 merge_bin -o build/snp-tpms.bin \
  --flash_mode dio --flash_freq 40m --flash_size 4MB \
  0x1000 "$B/bootloader.bin" 0x8000 "$B/partitions.bin" 0xe000 "$BOOT_APP0" 0x10000 "$B/firmware.bin"
ls -l build/snp-tpms.bin
