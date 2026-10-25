// แปลงข้อมูลที่เซนเซอร์ลมยาง (TPMS) ส่งผ่าน Bluetooth เป็นค่าลม อุณหภูมิ แบตเตอรี่
// ไม่พึ่ง Arduino จึงทดสอบบนคอมพิวเตอร์ได้ (firmware/tpms/test/test_decode.cpp)
#pragma once
#include <stddef.h>
#include <stdint.h>

struct TpmsReading {
  bool ok = false;
  const char *format = "";
  float kpa = 0;           // ลมยาง (กิโลปาสกาล)
  float tempC = 0;         // อุณหภูมิ (องศาเซลเซียส)
  int batteryPct = -1;     // แบตเตอรี่ (%), -1 = ไม่ทราบ
  float batteryV = -1;     // แบตเตอรี่ (โวลต์), -1 = ไม่ทราบ
  bool alarm = false;      // เซนเซอร์แจ้งเตือนเอง (เช่น รั่ว)
  int wheelHint = -1;      // ล้อที่เซนเซอร์บอกมา 0-3, -1 = ไม่ทราบ
};

// name = ชื่อที่เซนเซอร์ประกาศ, mfg = manufacturer data (รวม 2 ไบต์แรกที่เป็นรหัสบริษัท)
TpmsReading decodeTpms(const char *name, const uint8_t *mfg, size_t mfgLen);

// ดูว่าน่าจะเป็นเซนเซอร์ลมยางไหม (ใช้กรองก่อนส่งข้อมูลดิบให้หน้าเว็บ)
bool looksLikeTpms(const char *name, const uint8_t *mfg, size_t mfgLen);

constexpr float kpaToPsi(float kpa) { return kpa * 0.1450377f; }
constexpr float psiToKpa(float psi) { return psi / 0.1450377f; }
