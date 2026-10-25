// ทดสอบตัวแปลงข้อมูลเซนเซอร์บนคอมพิวเตอร์:
//   g++ -std=c++17 -Isrc test/test_decode.cpp src/tpms_decode.cpp -o /tmp/t && /tmp/t
#include <assert.h>
#include <math.h>
#include <stdio.h>

#include "tpms_decode.h"

static bool near(float a, float b) { return fabsf(a - b) < 0.01f; }

int main() {
  // ตัวอย่างจริงจากเซนเซอร์แบบ TPMS1_: 0001 80eaca108a78 e36d0000 e60a0000 5b 00
  const uint8_t sample[18] = {0x00, 0x01, 0x80, 0xea, 0xca, 0x10, 0x8a, 0x78, 0xe3,
                              0x6d, 0x00, 0x00, 0xe6, 0x0a, 0x00, 0x00, 0x5b, 0x00};
  TpmsReading r = decodeTpms("TPMS1_108A78", sample, sizeof sample);
  assert(r.ok);
  assert(near(r.kpa, 28.131f));
  assert(near(r.tempC, 27.90f));
  assert(r.batteryPct == 91);
  assert(!r.alarm);
  assert(r.wheelHint == 0);
  assert(looksLikeTpms("TPMS1_108A78", sample, sizeof sample));

  // ล้อที่ 3 + แจ้งเตือน + อุณหภูมิติดลบ (-5.00 °C)
  uint8_t s2[18];
  for (int i = 0; i < 18; i++) s2[i] = sample[i];
  s2[2] = 0x82;
  s2[17] = 1;
  s2[12] = 0x0c; s2[13] = 0xfe; s2[14] = 0xff; s2[15] = 0xff;  // -500
  r = decodeTpms("", s2, sizeof s2);
  assert(r.ok && r.wheelHint == 2 && r.alarm && near(r.tempC, -5.0f));

  // รูปแบบที่ไม่รู้จัก ต้องไม่แปลงมั่ว
  const uint8_t other[7] = {0x01, 0x02, 0x1c, 0x21, 0x01, 0x5c, 0x00};
  assert(!decodeTpms("BR", other, sizeof other).ok);
  assert(looksLikeTpms("BR", other, sizeof other));
  assert(!looksLikeTpms("Mi Band", other, sizeof other));

  assert(near(kpaToPsi(235.0f), 34.08f));
  puts("tpms_decode: ผ่านทั้งหมด");
  return 0;
}
