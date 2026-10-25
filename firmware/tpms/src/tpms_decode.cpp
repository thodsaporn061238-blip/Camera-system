#include "tpms_decode.h"

#include <string.h>

static uint32_t le32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static bool startsWith(const char *s, const char *prefix) {
  return s && strncmp(s, prefix, strlen(prefix)) == 0;
}

// แบบที่ 1: เซนเซอร์ชื่อ "TPMS1_xxxxxx" ... "TPMS4_xxxxxx" (ขายทั่วไป ใช้กับแอป TPMS II / ZEEPIN)
// manufacturer data 18 ไบต์:
//   [0-1] 00 01 รหัสบริษัท  [2-7] ที่อยู่เซนเซอร์ (ไบต์แรก 0x80-0x83 = ล้อที่ 1-4)
//   [8-11] ลมยาง ปาสกาล (int32 little-endian)  [12-15] อุณหภูมิ x100 °C (int32 little-endian)
//   [16] แบตเตอรี่ %  [17] แจ้งเตือน (0 = ปกติ)
static bool decodeZeepin(const uint8_t *m, size_t n, TpmsReading &r) {
  if (n != 18 || m[0] != 0x00 || m[1] != 0x01) return false;
  r.ok = true;
  r.format = "TPMS1_";
  r.kpa = le32(m + 8) / 1000.0f;
  r.tempC = (int32_t)le32(m + 12) / 100.0f;
  r.batteryPct = m[16];
  r.alarm = m[17] != 0;
  if (m[2] >= 0x80 && m[2] <= 0x83) r.wheelHint = m[2] - 0x80;
  return true;
}

TpmsReading decodeTpms(const char *name, const uint8_t *mfg, size_t mfgLen) {
  TpmsReading r;
  if (mfg && decodeZeepin(mfg, mfgLen, r)) return r;
  (void)name;
  return r;  // ยังไม่รู้จักรูปแบบนี้: หน้าเว็บจะเห็นข้อมูลดิบ ส่งให้ผู้พัฒนาเพิ่มตัวแปลงได้
}

bool looksLikeTpms(const char *name, const uint8_t *mfg, size_t mfgLen) {
  if (startsWith(name, "TPMS") || startsWith(name, "BR") || startsWith(name, "TP")) return true;
  return mfg && mfgLen == 18 && mfg[0] == 0x00 && mfg[1] == 0x01;
}
