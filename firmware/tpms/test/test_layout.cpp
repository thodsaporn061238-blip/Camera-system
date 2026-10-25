// ทดสอบการแทนค่าในไฟล์ออกแบบหน้าจอบนคอมพิวเตอร์:
//   g++ -std=c++17 -Isrc test/test_layout.cpp src/layout_bind.cpp -o /tmp/t && /tmp/t
#include <assert.h>
#include <stdio.h>

#include "layout_bind.h"

int main() {
  auto lookup = [](const std::string &k, std::string &out) {
    if (k == "fl.p") return out = "34.2", true;
    if (k == "unit") return out = "PSI", true;
    if (k == "fl.name") return out = "ล้อหน้าซ้าย", true;
    return false;
  };
  assert(expandTemplate("{fl.p} {unit}", lookup) == "34.2 PSI");
  assert(expandTemplate("{fl.name} ({unit})", lookup) == "ล้อหน้าซ้าย (PSI)");
  assert(expandTemplate("ไม่มีตัวแปร", lookup) == "ไม่มีตัวแปร");
  assert(expandTemplate("{พิมพ์ผิด} {unit}", lookup) == "{พิมพ์ผิด} PSI");  // key ผิดคงไว้ให้เห็น
  assert(expandTemplate("ค้าง {unit", lookup) == "ค้าง {unit");              // ปีกกาไม่ปิด
  assert(expandTemplate("{}{unit}", lookup) == "{}PSI");

  assert(wheelIndex("fl") == 0 && wheelIndex("rr") == 3 && wheelIndex("xx") == -1);
  assert(parseHexColor("#35D05A", 0) == 0x35d05a);
  assert(parseHexColor("#35D05", 7) == 7);
  assert(parseHexColor("35D05AA", 7) == 7);
  assert(parseHexColor("#GGGGGG", 7) == 7);
  puts("layout_bind: ผ่านทั้งหมด");
  return 0;
}
