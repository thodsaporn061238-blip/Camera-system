// SNP TPMS: จอแสดงลมยาง 4 ล้อ สำหรับบอร์ด ESP32-2432S028 (จอเหลือง)
// - รับค่าจากเซนเซอร์ลมยางผ่าน Bluetooth
// - เปลี่ยนชื่อ สี หน่วย เกณฑ์เตือน และจับคู่เซนเซอร์ ได้จากหน้าเว็บผ่านสาย USB (คำสั่ง JSON ทีละบรรทัด)
// - กดค้างที่ช่องล้อบนจอ เพื่อจับคู่เซนเซอร์ที่อยู่ใกล้ที่สุด
#include <Arduino.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <lvgl.h>

#include "tpms_decode.h"

#define APP_NAME "snp-tpms"
#define APP_VERSION "1.0.0"

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

static const int WHEELS = 4;
static const uint32_t STALE_MS = 10UL * 60UL * 1000UL;  // ไม่ได้ข้อมูลเกิน 10 นาที = ขาดการติดต่อ
static const uint32_t PAIR_MS = 30000;

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
  if (!s || s[0] != '#' || strlen(s) != 7) return fallback;
  return strtoul(s + 1, nullptr, 16);
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
  lv_obj_t *tile, *name, *value, *info;
};
static Wheel wheels[WHEELS];
static lv_obj_t *titleLabel, *statusLabel, *carBody;
static int pairingWheel = -1;
static uint32_t pairingUntil = 0;
static String pairBestMac;
static int pairBestRssi = -127;
static bool rawMode = false;

static lv_color_t col(uint32_t c) { return lv_color_hex(c); }

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

// เปลี่ยนข้อความเฉพาะเมื่อต่างจากเดิม (ตั้งซ้ำทุกวินาทีจะทำให้ข้อความที่เลื่อนวิ่งเริ่มใหม่ตลอด)
static void setText(lv_obj_t *label, const char *text) {
  if (strcmp(lv_label_get_text(label), text) != 0) lv_label_set_text(label, text);
}

static void renderWheel(int i) {
  Wheel &w = wheels[i];
  char buf[64];
  snprintf(buf, sizeof buf, "%s (%s)", cfg.names[i].c_str(), unitLabel());  // เช่น "ล้อหน้าซ้าย (PSI)"
  setText(w.name, buf);
  lv_obj_set_style_bg_color(w.tile, col(cfg.cTile), 0);
  lv_obj_set_style_text_color(w.name, col(cfg.cText), 0);
  lv_obj_set_style_text_color(w.info, col(cfg.cText), 0);

  if (pairingWheel == i) {
    setText(w.value, "--");
    snprintf(buf, sizeof buf, "กำลังจับคู่ %lus", (unsigned long)((pairingUntil - millis()) / 1000));
    setText(w.info, buf);
    lv_obj_set_style_text_color(w.value, col(cfg.cHigh), 0);
    lv_obj_set_style_border_color(w.tile, col(cfg.cHigh), 0);
    return;
  }
  Status st = wheelStatus(w);
  uint32_t c = st == ST_OK ? cfg.cOk : st == ST_LOW ? cfg.cLow : st == ST_HIGH ? cfg.cHigh : cfg.cStale;
  lv_obj_set_style_text_color(w.value, col(c), 0);
  lv_obj_set_style_border_color(w.tile, col(st == ST_LOW || st == ST_HIGH ? c : cfg.cTile), 0);
  if (st == ST_NONE) {
    setText(w.value, "--");
    setText(w.info, cfg.macs[i].isEmpty() ? "กดค้างเพื่อจับคู่" : "รอสัญญาณ...");
    return;
  }
  setText(w.value, formatPressure(w.r.kpa).c_str());
  if (w.r.batteryV > 0) snprintf(buf, sizeof buf, "%.0f°C | %.1fV", w.r.tempC, w.r.batteryV);
  else if (w.r.batteryPct >= 0) snprintf(buf, sizeof buf, "%.0f°C | %d%%", w.r.tempC, w.r.batteryPct);
  else snprintf(buf, sizeof buf, "%.0f°C", w.r.tempC);
  setText(w.info, st == ST_STALE ? "ขาดการติดต่อ" : buf);
}

static void applyStyle() {
  lv_obj_t *scr = lv_scr_act();
  lv_obj_set_style_bg_color(scr, col(cfg.cBg), 0);
  setText(titleLabel, cfg.title.c_str());
  lv_obj_set_style_text_color(titleLabel, col(cfg.cText), 0);
  lv_obj_set_style_text_color(statusLabel, col(cfg.cText), 0);
  lv_obj_set_style_bg_color(carBody, col(cfg.cTile), 0);
  lv_obj_set_style_border_color(carBody, col(cfg.cText), 0);
  for (int i = 0; i < WHEELS; i++) renderWheel(i);
  ledcWrite(BL_CHANNEL, cfg.bright);
  tft.setRotation(cfg.rot);
  tft.invertDisplay(cfg.invert);
  lv_obj_invalidate(scr);
}

static void startPairing(int i) {
  pairingWheel = i;
  pairingUntil = millis() + PAIR_MS;
  pairBestMac = "";
  pairBestRssi = -127;
  renderWheel(i);
}

static void tileEvent(lv_event_t *e) { startPairing((int)(intptr_t)lv_event_get_user_data(e)); }

static void buildUi() {
  lv_obj_t *scr = lv_scr_act();
  lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);
  const int tw = 124, th = 112;
  const int xs[WHEELS] = {2, 194, 2, 194}, ys[WHEELS] = {2, 2, 126, 126};
  for (int i = 0; i < WHEELS; i++) {
    Wheel &w = wheels[i];
    w.tile = lv_obj_create(scr);
    lv_obj_set_pos(w.tile, xs[i], ys[i]);
    lv_obj_set_size(w.tile, tw, th);
    lv_obj_set_style_radius(w.tile, 10, 0);
    lv_obj_set_style_border_width(w.tile, 2, 0);
    lv_obj_set_style_pad_all(w.tile, 4, 0);
    lv_obj_clear_flag(w.tile, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(w.tile, tileEvent, LV_EVENT_LONG_PRESSED, (void *)(intptr_t)i);

    // ข้อความที่ยาวเกินช่องจะเลื่อนวิ่งแทนการล้นออกนอกช่อง
    w.name = lv_label_create(w.tile);
    lv_obj_set_style_text_font(w.name, &snp_th_16, 0);
    lv_label_set_long_mode(w.name, LV_LABEL_LONG_SCROLL_CIRCULAR);
    lv_obj_set_width(w.name, tw - 12);
    lv_obj_set_style_text_align(w.name, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(w.name, LV_ALIGN_TOP_MID, 0, 0);
    w.value = lv_label_create(w.tile);
    lv_obj_set_style_text_font(w.value, &snp_num_48, 0);
    lv_obj_align(w.value, LV_ALIGN_CENTER, 0, 2);
    w.info = lv_label_create(w.tile);
    lv_obj_set_style_text_font(w.info, &snp_th_16, 0);
    lv_label_set_long_mode(w.info, LV_LABEL_LONG_SCROLL_CIRCULAR);
    lv_obj_set_width(w.info, tw - 12);
    lv_obj_set_style_text_align(w.info, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(w.info, LV_ALIGN_BOTTOM_MID, 0, 0);
  }

  // หัวข้อและข้อความสถานะอยู่ในช่องว่างกลางจอ (กว้าง 66 จุด) ยาวเกินจะเลื่อนวิ่ง
  titleLabel = lv_label_create(scr);
  lv_obj_set_style_text_font(titleLabel, &snp_th_24, 0);
  lv_label_set_long_mode(titleLabel, LV_LABEL_LONG_SCROLL_CIRCULAR);
  lv_obj_set_width(titleLabel, 66);
  lv_obj_set_style_text_align(titleLabel, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(titleLabel, LV_ALIGN_TOP_MID, 0, 4);

  // รถมุมมองจากด้านบน วางกลางจอระหว่างช่องล้อ
  carBody = lv_obj_create(scr);
  lv_obj_set_size(carBody, 40, 120);
  lv_obj_align(carBody, LV_ALIGN_CENTER, 0, 8);
  lv_obj_set_style_radius(carBody, 14, 0);
  lv_obj_set_style_border_width(carBody, 2, 0);
  lv_obj_clear_flag(carBody, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);

  statusLabel = lv_label_create(scr);
  lv_obj_set_style_text_font(statusLabel, &snp_th_16, 0);
  lv_label_set_long_mode(statusLabel, LV_LABEL_LONG_SCROLL_CIRCULAR);
  lv_obj_set_width(statusLabel, 66);
  lv_obj_set_style_text_align(statusLabel, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(statusLabel, LV_ALIGN_BOTTOM_MID, 0, -2);
  lv_label_set_text(statusLabel, "");
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
  serializeJson(doc, Serial);
  Serial.println();
}

static void printConfig() {
  JsonDocument doc;
  configToJson(doc["cfg"].to<JsonObject>());
  serializeJson(doc, Serial);
  Serial.println();
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
    renderWheel(wheel);
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
    lv_label_set_text_fmt(statusLabel, "จับคู่ %s แล้ว", cfg.names[i].c_str());
  } else {
    lv_label_set_text(statusLabel, "ไม่พบเซนเซอร์ ลองใหม่");
  }
  renderWheel(i);
}

// ---------- คำสั่งจากหน้าเว็บ (JSON ทีละบรรทัด) ----------
static void handleCommand(const String &line) {
  JsonDocument doc;
  if (deserializeJson(doc, line)) return;  // ไม่ใช่ JSON (เช่น คำสั่ง AT ที่หน้าเว็บลองส่ง) ข้ามไป
  if (doc["hello"].is<bool>() || doc["get"] == "info") {
    JsonDocument out;
    out["hello"]["app"] = APP_NAME;
    out["hello"]["version"] = APP_VERSION;
    serializeJson(out, Serial);
    Serial.println();
  }
  if (doc["get"] == "cfg") printConfig();
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
  if (doc["pair"].is<int>()) startPairing(constrain(doc["pair"].as<int>(), 0, WHEELS - 1));
  if (doc["unpair"].is<int>()) {
    int i = constrain(doc["unpair"].as<int>(), 0, WHEELS - 1);
    cfg.macs[i] = "";
    wheels[i].has = false;
    saveConfig();
    renderWheel(i);
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
    } else if (lineBuf.length() < 2048) {
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
  Serial.begin(115200);
  pinMode(PIN_LED_R, OUTPUT);
  pinMode(PIN_LED_G, OUTPUT);
  pinMode(PIN_LED_B, OUTPUT);
  digitalWrite(PIN_LED_R, HIGH);
  digitalWrite(PIN_LED_G, HIGH);
  digitalWrite(PIN_LED_B, HIGH);

  prefs.begin("tpms", false);
  loadConfig();

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

  buildUi();
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
    for (int i = 0; i < WHEELS; i++) renderWheel(i);
    alarms();
  }
  lv_timer_handler();
  delay(5);
}
