#!/usr/bin/env bash
# สร้างฟอนต์ภาษาไทยสำหรับจอ (LVGL) จากฟอนต์ Sarabun (สัญญาอนุญาต SIL OFL)
# ผลลัพธ์: firmware/tpms/src/fonts/*.c  ต้องรันก่อน pio run (CI รันให้เอง)
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=firmware/tpms/src/fonts
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

npm install --prefix "$WORK" --no-save --silent lv_font_conv@1.5.2 @fontsource/sarabun@5.1.0
CONV="$WORK/node_modules/.bin/lv_font_conv"
F="$WORK/node_modules/@fontsource/sarabun/files"
mkdir -p "$OUT"

# ตัวอักษรอังกฤษ ตัวเลข สัญลักษณ์ + ภาษาไทยทั้งหมด + องศา
text_font() {  # $1 = ชื่อฟอนต์  $2 = ขนาด  $3 = น้ำหนัก
  "$CONV" --no-compress --bpp 4 --size "$2" --format lvgl --lv-include lvgl.h \
    --font "$F/sarabun-latin-$3-normal.woff" --range 0x20-0x7E,0xB0 \
    --font "$F/sarabun-thai-$3-normal.woff" --range 0x0E01-0x0E5B \
    -o "$OUT/$1.c"
}
text_font snp_th_16 16 500
text_font snp_th_24 24 600

# ตัวเลขใหญ่สำหรับค่าลมยาง
"$CONV" --no-compress --bpp 4 --size 48 --format lvgl --lv-include lvgl.h \
  --font "$F/sarabun-latin-600-normal.woff" --symbols "0123456789.-" \
  -o "$OUT/snp_num_48.c"

echo "สร้างฟอนต์แล้วที่ $OUT"
