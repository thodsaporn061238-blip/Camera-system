// แทนค่าในข้อความของไฟล์ออกแบบหน้าจอ เช่น "{fl.p} {unit}" -> "34.2 PSI"
// ไม่พึ่ง Arduino จึงทดสอบบนคอมพิวเตอร์ได้ (firmware/tpms/test/test_layout.cpp)
// ตรงกับ expandTemplate ใน web/layout.js ที่ใช้วาดภาพตัวอย่างบนหน้าเว็บ
#pragma once
#include <functional>
#include <string>

// lookup(key, out) คืน true ถ้ารู้จัก key; key ที่ไม่รู้จักจะคงข้อความ {key} ไว้ให้เห็นว่าพิมพ์ผิด
std::string expandTemplate(const std::string &tpl,
                           const std::function<bool(const std::string &key, std::string &out)> &lookup);

// "fl" "fr" "rl" "rr" -> 0-3, อื่น ๆ -> -1
int wheelIndex(const std::string &key);

// "#RRGGBB" -> 0xRRGGBB, รูปแบบผิดคืน fallback
unsigned long parseHexColor(const std::string &s, unsigned long fallback);
