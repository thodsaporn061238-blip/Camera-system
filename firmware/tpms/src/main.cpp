// SNP TPMS: จอแสดงลมยาง 4 ล้อ สำหรับบอร์ด ESP32-2432S028 (จอเหลือง)
// - รับค่าจากเซนเซอร์ลมยางผ่าน Bluetooth
// - หน้าจอวาดตามไฟล์ออกแบบ (JSON) แก้จากหน้าเว็บแล้วจอเปลี่ยนทันที ไม่ต้องลงโปรแกรมใหม่
// - เปลี่ยนชื่อ สี หน่วย เกณฑ์เตือน จับคู่เซนเซอร์ และจัดการไฟล์ในบอร์ด ผ่านสาย USB (คำสั่ง JSON ทีละบรรทัด)
#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <lvgl.h>
#include <mbedtls/base64.h>

#include <string>
#include <vector>

#include "layout_bind.h"
#include "tpms_decode.h"

#define APP_NAME "snp-tpms"
#define APP_VERSION "1.1.0"

// ขาของบอร์ด ESP32-2432S028
#define TOUCH_CS 33
#define TOUCH_IRQ 36
#define TOUCH_MOSI 32
#define TOUCH_MISO 39
#define TOUCH_CLK 25
#define PIN_BL 21
#define BL_CHANNEL 7  // ช่อง PWM ของไฟจอ แยกจากช่อง 0 ที่ tone() ใช้กับลำโพง
#define PIN_SPEAKER 26
#define PIN_LED_R 4
#define PIN_LED_G 16
#define PIN_LED_B 17

LV_FONT_DECLARE(snp_th_16);
LV_FONT_DECLARE(snp_th_24);
LV_FONT_DECLARE(snp_num_48);

// หน้าจอเริ่มต้น (firmware/tpms/layouts/default.json ฝังมากับโปรแกรม)
extern const char defaultLayout[] asm("_binary_layouts_default_json_start");
static const char *LAYOUT_PATH = "/layout.json";

static const int WHEELS = 4;
static const uint32_t STALE_MS = 10UL * 60UL * 1000UL;  // ไม่ได้ข้อมูลเกิน 10 นาที = ขาดการติดต่อ
static const uint32_t PAIR_MS = 30000;
static const size_t FS_CHUNK = 3072;  // ขนาดข้อมูลไฟล์ต่อหนึ่งบรรทัดที่ส่งให้หน้าเว็บ

// ---------- ค่าตั้ง (เก็บในหน่วยความจำของบอร์ด ไม่หายเมื่อดับไฟ) ----------
struct Config {
  String title = "TPMS";
  String names[WHEELS] = {"ล้อหน้าซ้าย", "ล้อหน้าขวา", "ล้อหลังซ้าย", "ล้อหลังขวา"};
  String macs[WHEELS];
  String unit = "psi";  // psi, kpa, bar
  float lowPsi = 28, highPsi = 45, hotC = 75;
  uint32_t cBg = 0x000000, cTile = 0x1a1d24, cText = 0xffffff, cOk = 0x35d05a, cLow = 0xff4040,
           cHigh = 0xffa000, cStale = 0x6b7280;
  bool buzzer = true;
  uint8_t bright = 220;
  uint8_t rot = 1;  // 1 หรือ 3 (กลับหัวจอ)
  bool invert = false;
};
static Config cfg;
static Preferences prefs;

static String hexColor(uint32_t c) {
  char b[8];
  snprintf(b, sizeof b, "#%06lX", (unsigned long)(c & 0xffffff));
  return b;
}
static uint32_t parseColor(const char *s, uint32_t fallback) {
  return s ? parseHexColor(s, fallback) : fallback;
}

static void configToJson(JsonObject o) {
  o["title"] = cfg.title;
  JsonArray n = o["names"].to<JsonArray>();
  JsonArray m = o["macs"].to<JsonArray>();
  for (int i = 0; i < WHEELS; i++) {
    n.add(cfg.names[i]);
    m.add(cfg.macs[i]);
  }
  o["unit"] = cfg.unit;
  o["low"] = cfg.lowPsi;
  o["high"] = cfg.highPsi;
  o["hot"] = cfg.hotC;
  JsonObject c = o["colors"].to<JsonObject>();
  c["bg"] = hexColor(cfg.cBg);
  c["tile"] = hexColor(cfg.cTile);
  c["text"] = hexColor(cfg.cText);
  c["ok"] = hexColor(cfg.cOk);
  c["low"] = hexColor(cfg.cLow);
  c["high"] = hexColor(cfg.cHigh);
  c["stale"] = hexColor(cfg.cStale);
  o["buzzer"] = cfg.buzzer;
  o["bright"] = cfg.bright;
  o["rot"] = cfg.rot;
  o["invert"] = cfg.invert;
}

// รับเฉพาะช่องที่ส่งมา ช่องที่ไม่ส่งคงค่าเดิม
static void configFromJson(JsonObjectConst o) {
  if (o["title"].is<const char *>()) cfg.title = o["title"].as<const char *>();
  for (int i = 0; i < WHEELS; i++) {
    if (o["names"][i].is<const char *>()) cfg.names[i] = o["names"][i].as<const char *>();
    if (o["macs"][i].is<const char *>()) cfg.macs[i] = o["macs"][i].as<const char *>();
  }
  if (o["unit"].is<const char *>()) {
    String u = o["unit"].as<const char *>();
    if (u == "psi" || u == "kpa" || u == "bar") cfg.unit = u;
  }
  if (o["low"].is<float>()) cfg.lowPsi = o["low"];
  if (o["high"].is<float>()) cfg.highPsi = o["high"];
  if (o["hot"].is<float>()) cfg.hotC = o["hot"];
  JsonObjectConst c = o["colors"];
  if (!c.isNull()) {
    cfg.cBg = parseColor(c["bg"].as<const char *>(), cfg.cBg);
    cfg.cTile = parseColor(c["tile"].as<const char *>(), cfg.cTile);
    cfg.cText = parseColor(c["text"].as<const char *>(), cfg.cText);
    cfg.cOk = parseColor(c["ok"].as<const char *>(), cfg.cOk);
    cfg.cLow = parseColor(c["low"].as<const char *>(), cfg.cLow);
    cfg.cHigh = parseColor(c["high"].as<const char *>(), cfg.cHigh);
    cfg.cStale = parseColor(c["stale"].as<const char *>(), cfg.cStale);
  }
  if (o["buzzer"].is<bool>()) cfg.buzzer = o["buzzer"];
  if (o["bright"].is<int>()) cfg.bright = constrain(o["bright"].as<int>(), 10, 255);
  if (o["rot"].is<int>()) cfg.rot = o["rot"].as<int>() == 3 ? 3 : 1;
  if (o["invert"].is<bool>()) cfg.invert = o["invert"];
}

static void saveConfig() {
  JsonDocument doc;
  configToJson(doc.to<JsonObject>());
  String s;
  serializeJson(doc, s);
  prefs.putString("cfg", s);
}

static void loadConfig() {
  String s = prefs.getString("cfg", "");
  if (s.isEmpty()) return;
  JsonDocument doc;
  if (!deserializeJson(doc, s)) configFromJson(doc.as<JsonObjectConst>());
}

// ---------- หน้าจอและจอสัมผัส ----------
static TFT_eSPI tft;
static SPIClass touchSpi(VSPI);
static XPT2046_Touchscreen ts(TOUCH_CS, TOUCH_IRQ);
static lv_disp_draw_buf_t drawBuf;
static lv_color_t buf1[320 * 20];

static void flushCb(lv_disp_drv_t *disp, const lv_area_t *a, lv_color_t *px) {
  uint32_t w = a->x2 - a->x1 + 1, h = a->y2 - a->y1 + 1;
  tft.startWrite();
  tft.setAddrWindow(a->x1, a->y1, w, h);
  tft.pushColors((uint16_t *)&px->full, w * h, true);
  tft.endWrite();
  lv_disp_flush_ready(disp);
}

static void touchCb(lv_indev_drv_t *, lv_indev_data_t *data) {
  if (ts.tirqTouched() && ts.touched()) {
    TS_Point p = ts.getPoint();
    int x = map(p.x, 200, 3700, 0, 320), y = map(p.y, 240, 3800, 0, 240);
    if (cfg.rot == 3) {
      x = 320 - x;
      y = 240 - y;
    }
    data->point.x = constrain(x, 0, 319);
    data->point.y = constrain(y, 0, 239);
    data->state = LV_INDEV_STATE_PR;
  } else {
    data->state = LV_INDEV_STATE_REL;
  }
}

// ---------- ข้อมูลล้อ ----------
struct Wheel {
  bool has = false;
  TpmsReading r;
  uint32_t at = 0;
};
static Wheel wheels[WHEELS];
static String statusMsg;
static int pairingWheel = -1;
static uint32_t pairingUntil = 0;
static String pairBestMac;
static int pairBestRssi = -127;
static bool rawMode = false;

static const char *unitLabel() {
  return cfg.unit == "kpa" ? "kPa" : cfg.unit == "bar" ? "bar" : "PSI";
}

static String formatPressure(float kpa) {
  char b[12];
  if (cfg.unit == "kpa") snprintf(b, sizeof b, "%.0f", kpa);
  else if (cfg.unit == "bar") snprintf(b, sizeof b, "%.2f", kpa / 100.0f);
  else snprintf(b, sizeof b, "%.1f", kpaToPsi(kpa));
  return b;
}

enum Status { ST_NONE, ST_OK, ST_LOW, ST_HIGH, ST_STALE };

static Status wheelStatus(const Wheel &w) {
  if (!w.has) return ST_NONE;
  if (millis() - w.at > STALE_MS) return ST_STALE;
  float psi = kpaToPsi(w.r.kpa);
  if (psi < cfg.lowPsi || w.r.alarm) return ST_LOW;
  if (psi > cfg.highPsi || w.r.tempC > cfg.hotC) return ST_HIGH;
  return ST_OK;
}

static uint32_t statusColor(int i) {
  if (pairingWheel == i) return cfg.cHigh;
  Status st = wheelStatus(wheels[i]);
  return st == ST_OK ? cfg.cOk : st == ST_LOW ? cfg.cLow : st == ST_HIGH ? cfg.cHigh : cfg.cStale;
}

// ค่าของตัวแปรในไฟล์ออกแบบ เช่น {fl.p} {unit} {c.tile} (รายการทั้งหมดอยู่ใน docs/LAYOUT.md)
static bool wheelValue(int i, const std::string &field, String &v) {
  const Wheel &w = wheels[i];
  Status st = wheelStatus(w);
  bool live = w.has && pairingWheel != i;
  char b[40];
  if (field == "name") v = cfg.names[i];
  else if (field == "p") v = live ? formatPressure(w.r.kpa) : String("--");
  else if (field == "psi") v = live ? String(kpaToPsi(w.r.kpa), 1) : String("--");
  else if (field == "kpa") v = live ? String(w.r.kpa, 0) : String("--");
  else if (field == "bar") v = live ? String(w.r.kpa / 100.0f, 2) : String("--");
  else if (field == "temp") v = live ? String(w.r.tempC, 0) : String("--");
  else if (field == "batt") {
    if (!live) v = "--";
    else if (w.r.batteryV > 0) v = String(w.r.batteryV, 1) + "V";
    else if (w.r.batteryPct >= 0) v = String(w.r.batteryPct) + "%";
    else v = "--";
  } else if (field == "info") {
    if (pairingWheel == i) {
      snprintf(b, sizeof b, "กำลังจับคู่ %lus", (unsigned long)((pairingUntil - millis()) / 1000));
      v = b;
    } else if (st == ST_NONE) v = cfg.macs[i].isEmpty() ? "กดค้างเพื่อจับคู่" : "รอสัญญาณ...";
    else if (st == ST_STALE) v = "ขาดการติดต่อ";
    else {
      String batt;
      wheelValue(i, "batt", batt);
      v = String(w.r.tempC, 0) + "°C | " + batt;
    }
  } else if (field == "status") {
    v = pairingWheel == i ? "กำลังจับคู่" : st == ST_OK ? "ปกติ" : st == ST_LOW ? "ลมต่ำ" : st == ST_HIGH ? "ลมสูง/ร้อน"
        : st == ST_STALE ? "ขาดการติดต่อ" : cfg.macs[i].isEmpty() ? "ยังไม่จับคู่" : "รอสัญญาณ";
  } else if (field == "color") v = hexColor(statusColor(i));
  else if (field == "border") {
    bool warn = pairingWheel == i || st == ST_LOW || st == ST_HIGH;
    v = hexColor(warn ? statusColor(i) : cfg.cTile);
  } else return false;
  return true;
}

static bool lookupValue(const std::string &key, std::string &out) {
  String v;
  size_t dot = key.find('.');
  std::string head = key.substr(0, dot), field = dot == std::string::npos ? "" : key.substr(dot + 1);
  int wi = wheelIndex(head);
  if (wi >= 0) {
    if (!wheelValue(wi, field, v)) return false;
  } else if (head == "c") {
    if (field == "bg") v = hexColor(cfg.cBg);
    else if (field == "tile") v = hexColor(cfg.cTile);
    else if (field == "text") v = hexColor(cfg.cText);
    else if (field == "ok") v = hexColor(cfg.cOk);
    else if (field == "low") v = hexColor(cfg.cLow);
    else if (field == "high") v = hexColor(cfg.cHigh);
    else if (field == "stale") v = hexColor(cfg.cStale);
    else return false;
  } else if (key == "unit") v = unitLabel();
  else if (key == "title") v = cfg.title;
  else if (key == "status") v = statusMsg;
  else return false;
  out = v.c_str();
  return true;
}

static std::string expand(const std::string &tpl) { return expandTemplate(tpl, lookupValue); }

// ---------- หน้าจอตามไฟล์ออกแบบ ----------
struct Item {
  lv_obj_t *obj;
  bool isText;
  std::string text, color, bg, border;           // แม่แบบ (อาจมี {ตัวแปร})
  std::string lastText, lastColor, lastBg, lastBorder;  // ค่าที่แสดงอยู่ ใช้เทียบก่อนวาดใหม่
};
static std::vector<Item> items;
static std::string screenBg = "{c.bg}", lastScreenBg;
static String currentLayout;

static const lv_font_t *fontFor(int size) {
  return size >= 40 ? &snp_num_48 : size >= 20 ? &snp_th_24 : &snp_th_16;
}

static lv_color_t colorOf(const std::string &s, uint32_t fallback) {
  return lv_color_hex(parseHexColor(s, fallback));
}

static void startPairing(int i);
static void boxEvent(lv_event_t *e) { startPairing((int)(intptr_t)lv_event_get_user_data(e)); }

// อัปเดตเฉพาะส่วนที่ค่าเปลี่ยน (ตั้งข้อความซ้ำจะทำให้ข้อความที่เลื่อนวิ่งเริ่มใหม่ตลอด)
static void refreshScreen() {
  std::string bg = expand(screenBg);
  if (bg != lastScreenBg) {
    lastScreenBg = bg;
    lv_obj_set_style_bg_color(lv_scr_act(), colorOf(bg, cfg.cBg), 0);
  }
  for (Item &it : items) {
    if (it.isText) {
      std::string t = expand(it.text);
      if (t != it.lastText) lv_label_set_text(it.obj, (it.lastText = t).c_str());
      std::string c = expand(it.color);
      if (c != it.lastColor) lv_obj_set_style_text_color(it.obj, colorOf(it.lastColor = c, cfg.cText), 0);
    } else {
      std::string b = expand(it.bg);
      if (b != it.lastBg) lv_obj_set_style_bg_color(it.obj, colorOf(it.lastBg = b, cfg.cTile), 0);
      std::string br = expand(it.border);
      if (br != it.lastBorder) lv_obj_set_style_border_color(it.obj, colorOf(it.lastBorder = br, cfg.cText), 0);
    }
  }
}

// สร้างหน้าจอใหม่จากไฟล์ออกแบบ ถ้าไฟล์ผิดจะคงหน้าจอเดิมไว้และคืนข้อความผิดพลาด
static bool applyLayout(const String &json, String &err) {
  JsonDocument doc;
  DeserializationError e = deserializeJson(doc, json);
  if (e) {
    err = String("ไฟล์ออกแบบไม่ใช่ JSON ที่ถูกต้อง: ") + e.c_str();
    return false;
  }
  JsonArrayConst list = doc["items"];
  if (list.isNull()) {
    err = "ไฟล์ออกแบบต้องมีรายการ \"items\"";
    return false;
  }
  lv_obj_t *scr = lv_scr_act();
  lv_obj_clean(scr);
  lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);
  items.clear();
  screenBg = doc["bg"] | "{c.bg}";
  lastScreenBg.clear();

  for (JsonObjectConst o : list) {
    if (items.size() >= 80) break;  // กันหน่วยความจำเต็ม
    Item it{};
    std::string type = o["type"] | "text";
    int x = o["x"] | 0, y = o["y"] | 0, w = o["w"] | 0, h = o["h"] | 0;
    if (type == "box") {
      it.isText = false;
      it.obj = lv_obj_create(scr);
      lv_obj_remove_style_all(it.obj);
      lv_obj_set_style_bg_opa(it.obj, LV_OPA_COVER, 0);
      lv_obj_set_pos(it.obj, x, y);
      lv_obj_set_size(it.obj, w > 0 ? w : 20, h > 0 ? h : 20);
      lv_obj_set_style_radius(it.obj, o["r"] | 0, 0);
      lv_obj_set_style_border_width(it.obj, o["bw"] | 0, 0);
      it.bg = o["bg"] | "{c.tile}";
      it.border = o["border"] | "{c.text}";
      int pair = wheelIndex(o["pair"] | "");
      if (pair >= 0) lv_obj_add_event_cb(it.obj, boxEvent, LV_EVENT_LONG_PRESSED, (void *)(intptr_t)pair);
      else lv_obj_clear_flag(it.obj, LV_OBJ_FLAG_CLICKABLE);
    } else {
      it.isText = true;
      it.obj = lv_label_create(scr);
      lv_obj_set_style_text_font(it.obj, fontFor(o["font"] | 16), 0);
      if (w > 0) {
        lv_obj_set_width(it.obj, w);
        lv_label_set_long_mode(it.obj, (o["scroll"] | false) ? LV_LABEL_LONG_SCROLL_CIRCULAR : LV_LABEL_LONG_WRAP);
      }
      std::string align = o["align"] | "left";
      lv_obj_set_style_text_align(it.obj, align == "center" ? LV_TEXT_ALIGN_CENTER
                                  : align == "right" ? LV_TEXT_ALIGN_RIGHT : LV_TEXT_ALIGN_LEFT, 0);
      lv_obj_set_pos(it.obj, x, y);
      lv_label_set_text(it.obj, "");
      it.text = o["text"] | "";
      it.color = o["color"] | "{c.text}";
    }
    items.push_back(it);
  }
  currentLayout = json;
  refreshScreen();
  return true;
}

static void applyStyle() {
  refreshScreen();
  ledcWrite(BL_CHANNEL, cfg.bright);
  tft.setRotation(cfg.rot);
  tft.invertDisplay(cfg.invert);
  lv_obj_invalidate(lv_scr_act());
}

static void startPairing(int i) {
  pairingWheel = i;
  pairingUntil = millis() + PAIR_MS;
  pairBestMac = "";
  pairBestRssi = -127;
  refreshScreen();
}

// ---------- Bluetooth ----------
struct Adv {
  char mac[18];
  char name[24];
  uint8_t mfg[31];
  uint8_t mfgLen;
  int8_t rssi;
};
static QueueHandle_t advQueue;

class ScanCallbacks : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice *d) override {
    Adv a = {};
    strlcpy(a.mac, d->getAddress().toString().c_str(), sizeof a.mac);
    if (d->haveName()) strlcpy(a.name, d->getName().c_str(), sizeof a.name);
    if (d->haveManufacturerData()) {
      std::string m = d->getManufacturerData();
      a.mfgLen = min(m.size(), sizeof a.mfg);
      memcpy(a.mfg, m.data(), a.mfgLen);
    }
    a.rssi = d->getRSSI();
    if (rawMode || looksLikeTpms(a.name, a.mfg, a.mfgLen)) xQueueSend(advQueue, &a, 0);
  }
};

static void startScan() {
  NimBLEDevice::init("");
  NimBLEScan *scan = NimBLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new ScanCallbacks(), true);
  scan->setActiveScan(true);  // ขอชื่อเซนเซอร์ด้วย
  scan->setInterval(97);
  scan->setWindow(67);
  scan->setMaxResults(0);
  scan->setDuplicateFilter(false);
  scan->start(0, nullptr, false);
}

static void sendJson(JsonDocument &doc) {
  serializeJson(doc, Serial);
  Serial.println();
}

static void printReading(const Adv &a, const TpmsReading &r, int wheel) {
  JsonDocument doc;
  JsonObject s = doc["sensor"].to<JsonObject>();
  s["mac"] = a.mac;
  s["name"] = a.name;
  s["rssi"] = a.rssi;
  char hex[63] = {};
  for (int i = 0; i < a.mfgLen; i++) snprintf(hex + i * 2, 3, "%02x", a.mfg[i]);
  s["mfg"] = hex;
  s["wheel"] = wheel;
  if (r.ok) {
    s["format"] = r.format;
    s["kpa"] = serialized(String(r.kpa, 1));
    s["psi"] = serialized(String(kpaToPsi(r.kpa), 1));
    s["temp"] = serialized(String(r.tempC, 1));
    if (r.batteryPct >= 0) s["battery"] = r.batteryPct;
    if (r.batteryV > 0) s["volt"] = serialized(String(r.batteryV, 2));
    s["alarm"] = r.alarm;
  }
  sendJson(doc);
}

static void printConfig() {
  JsonDocument doc;
  configToJson(doc["cfg"].to<JsonObject>());
  sendJson(doc);
}

static void handleAdv(const Adv &a) {
  TpmsReading r = decodeTpms(a.name, a.mfg, a.mfgLen);
  int wheel = -1;
  for (int i = 0; i < WHEELS; i++)
    if (cfg.macs[i].equalsIgnoreCase(a.mac)) wheel = i;

  if (pairingWheel >= 0 && wheel < 0 && r.ok && a.rssi > pairBestRssi) {
    pairBestRssi = a.rssi;
    pairBestMac = a.mac;
  }
  if (wheel >= 0 && r.ok) {
    wheels[wheel].has = true;
    wheels[wheel].r = r;
    wheels[wheel].at = millis();
    refreshScreen();
  }
  printReading(a, r, wheel);
}

static void finishPairing() {
  int i = pairingWheel;
  pairingWheel = -1;
  if (!pairBestMac.isEmpty()) {
    cfg.macs[i] = pairBestMac;
    wheels[i].has = false;
    saveConfig();
    printConfig();
    statusMsg = String("จับคู่ ") + cfg.names[i] + " แล้ว";
  } else {
    statusMsg = "ไม่พบเซนเซอร์ ลองใหม่";
  }
  refreshScreen();
}

// ---------- ไฟล์ในบอร์ด (LittleFS) ----------
static void fsError(const String &msg) {
  JsonDocument doc;
  doc["fs_err"] = msg;
  sendJson(doc);
}

static void fsOk(const String &path, size_t size) {
  JsonDocument doc;
  doc["fs_ok"]["path"] = path;
  doc["fs_ok"]["size"] = size;
  sendJson(doc);
}

static void fsCommand(JsonDocument &cmd) {
  String op = cmd["fs"].as<const char *>();
  String path = cmd["path"] | "";
  if (!path.isEmpty() && !path.startsWith("/")) path = "/" + path;

  if (op == "list") {
    JsonDocument doc;
    JsonArray list = doc["files"].to<JsonArray>();
    File root = LittleFS.open("/");
    for (File f = root.openNextFile(); f; f = root.openNextFile()) {
      JsonObject o = list.add<JsonObject>();
      o["path"] = String("/") + f.name();
      o["size"] = f.size();
      o["dir"] = f.isDirectory();
    }
    doc["total"] = LittleFS.totalBytes();
    doc["used"] = LittleFS.usedBytes();
    sendJson(doc);
  } else if (op == "read") {
    File f = LittleFS.open(path, "r");
    if (!f) return fsError("ไม่พบไฟล์ " + path);
    size_t offset = cmd["offset"] | 0, size = f.size();
    size_t len = min((size_t)(cmd["len"] | (int)FS_CHUNK), FS_CHUNK);
    static uint8_t raw[FS_CHUNK];
    static unsigned char b64[FS_CHUNK * 4 / 3 + 8];
    f.seek(offset);
    size_t n = f.read(raw, min(len, size > offset ? size - offset : 0));
    size_t outLen = 0;
    mbedtls_base64_encode(b64, sizeof b64, &outLen, raw, n);
    b64[outLen] = 0;
    JsonDocument doc;
    JsonObject o = doc["file"].to<JsonObject>();
    o["path"] = path;
    o["offset"] = offset;
    o["size"] = size;
    o["data"] = (const char *)b64;
    sendJson(doc);
  } else if (op == "write") {
    const char *data = cmd["data"] | "";
    static uint8_t raw[FS_CHUNK + 4];
    size_t n = 0;
    if (mbedtls_base64_decode(raw, sizeof raw, &n, (const unsigned char *)data, strlen(data)) != 0) {
      return fsError("ข้อมูลไฟล์เสีย (base64)");
    }
    File f = LittleFS.open(path, (cmd["append"] | false) ? "a" : "w");
    if (!f) return fsError("เขียนไฟล์ " + path + " ไม่ได้");
    f.write(raw, n);
    size_t size = f.size();
    f.close();
    fsOk(path, size);
  } else if (op == "delete") {
    if (!LittleFS.remove(path)) return fsError("ลบ " + path + " ไม่ได้");
    fsOk(path, 0);
  } else if (op == "rename") {
    String to = cmd["to"] | "";
    if (!to.startsWith("/")) to = "/" + to;
    if (!LittleFS.rename(path, to)) return fsError("เปลี่ยนชื่อ " + path + " ไม่ได้");
    fsOk(to, 0);
  } else {
    fsError("ไม่รู้จักคำสั่ง fs: " + op);
  }
}

static String readFile(const char *path) {
  File f = LittleFS.open(path, "r");
  if (!f) return "";
  String s = f.readString();
  f.close();
  return s;
}

static void reportLayout(bool ok, const String &err, bool saved) {
  JsonDocument doc;
  if (ok) {
    doc["layout_ok"]["items"] = items.size();
    doc["layout_ok"]["saved"] = saved;
  } else {
    doc["layout_err"] = err;
  }
  sendJson(doc);
}

// ---------- คำสั่งจากหน้าเว็บ (JSON ทีละบรรทัด) ----------
static void handleCommand(const String &line) {
  JsonDocument doc;
  if (deserializeJson(doc, line)) return;  // ไม่ใช่ JSON (เช่น คำสั่ง AT ที่หน้าเว็บลองส่ง) ข้ามไป
  if (doc["hello"].is<bool>() || doc["get"] == "info") {
    JsonDocument out;
    out["hello"]["app"] = APP_NAME;
    out["hello"]["version"] = APP_VERSION;
    out["hello"]["layout"] = true;
    out["hello"]["fs"] = true;
    sendJson(out);
  }
  if (doc["get"] == "cfg") printConfig();
  if (doc["get"] == "layout") {
    Serial.print("{\"layout\":");
    Serial.print(currentLayout);
    Serial.println("}");
  }
  if (doc["set"].is<JsonObjectConst>()) {
    configFromJson(doc["set"].as<JsonObjectConst>());
    saveConfig();
    applyStyle();
    printConfig();
  }
  if (doc["reset"] == "cfg") {
    cfg = Config();
    saveConfig();
    applyStyle();
    printConfig();
  }
  if (doc["layout"].is<JsonObjectConst>()) {
    String json, err;
    serializeJson(doc["layout"], json);
    bool save = doc["save"] | false;
    bool ok = applyLayout(json, err);
    if (ok && save) {
      File f = LittleFS.open(LAYOUT_PATH, "w");
      if (f) {
        f.print(json);
        f.close();
      } else {
        save = false;
      }
    }
    reportLayout(ok, err, save);
  }
  if (doc["reset"] == "layout" || doc["reload"] == "layout") {
    if (doc["reset"] == "layout") LittleFS.remove(LAYOUT_PATH);
    String json = readFile(LAYOUT_PATH), err;
    bool ok = applyLayout(json.isEmpty() ? String(defaultLayout) : json, err);
    reportLayout(ok, err, false);
  }
  if (doc["fs"].is<const char *>()) fsCommand(doc);
  if (doc["pair"].is<int>()) startPairing(constrain(doc["pair"].as<int>(), 0, WHEELS - 1));
  if (doc["unpair"].is<int>()) {
    int i = constrain(doc["unpair"].as<int>(), 0, WHEELS - 1);
    cfg.macs[i] = "";
    wheels[i].has = false;
    saveConfig();
    refreshScreen();
    printConfig();
  }
  if (doc["raw"].is<bool>()) rawMode = doc["raw"];
  if (doc["beep"].is<bool>()) tone(PIN_SPEAKER, 2000, 150);
}

static String lineBuf;
static void readSerial() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (lineBuf.length()) handleCommand(lineBuf);
      lineBuf = "";
    } else if (lineBuf.length() < 16384) {  // ไฟล์ออกแบบทั้งไฟล์มาในบรรทัดเดียว
      lineBuf += ch;
    }
  }
}

// ---------- เตือน ----------
static uint32_t lastBeep = 0, lastTick = 0;
static void alarms() {
  bool bad = false;
  for (int i = 0; i < WHEELS; i++) {
    Status st = wheelStatus(wheels[i]);
    bad |= st == ST_LOW || st == ST_HIGH;
  }
  digitalWrite(PIN_LED_R, bad ? LOW : HIGH);  // ไฟ LED บนบอร์ดติดเมื่อ LOW
  if (bad && cfg.buzzer && millis() - lastBeep > 10000) {
    lastBeep = millis();
    tone(PIN_SPEAKER, 2400, 300);
  }
}

void setup() {
  Serial.setRxBufferSize(4096);
  Serial.begin(115200);
  pinMode(PIN_LED_R, OUTPUT);
  pinMode(PIN_LED_G, OUTPUT);
  pinMode(PIN_LED_B, OUTPUT);
  digitalWrite(PIN_LED_R, HIGH);
  digitalWrite(PIN_LED_G, HIGH);
  digitalWrite(PIN_LED_B, HIGH);

  prefs.begin("tpms", false);
  loadConfig();
  LittleFS.begin(true);  // ครั้งแรกจะฟอร์แมตพื้นที่เก็บไฟล์ให้เอง

  tft.begin();
  ledcSetup(BL_CHANNEL, 5000, 8);
  ledcAttachPin(PIN_BL, BL_CHANNEL);
  touchSpi.begin(TOUCH_CLK, TOUCH_MISO, TOUCH_MOSI, TOUCH_CS);
  ts.begin(touchSpi);
  ts.setRotation(1);

  lv_init();
  lv_disp_draw_buf_init(&drawBuf, buf1, nullptr, sizeof buf1 / sizeof buf1[0]);
  static lv_disp_drv_t dispDrv;
  lv_disp_drv_init(&dispDrv);
  dispDrv.hor_res = 320;
  dispDrv.ver_res = 240;
  dispDrv.flush_cb = flushCb;
  dispDrv.draw_buf = &drawBuf;
  lv_disp_drv_register(&dispDrv);
  static lv_indev_drv_t indevDrv;
  lv_indev_drv_init(&indevDrv);
  indevDrv.type = LV_INDEV_TYPE_POINTER;
  indevDrv.read_cb = touchCb;
  lv_indev_drv_register(&indevDrv);

  String saved = readFile(LAYOUT_PATH), err;
  if (saved.isEmpty() || !applyLayout(saved, err)) applyLayout(String(defaultLayout), err);
  applyStyle();

  advQueue = xQueueCreate(32, sizeof(Adv));
  startScan();
  handleCommand("{\"hello\":true}");
  printConfig();
}

void loop() {
  readSerial();
  Adv a;
  while (xQueueReceive(advQueue, &a, 0) == pdTRUE) handleAdv(a);
  if (pairingWheel >= 0 && (millis() > pairingUntil || pairBestRssi > -45)) finishPairing();
  if (millis() - lastTick > 1000) {
    lastTick = millis();
    refreshScreen();
    alarms();
  }
  lv_timer_handler();
  delay(5);
}
