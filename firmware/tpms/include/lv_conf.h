// ค่าตั้งของ LVGL (ไลบรารีวาดหน้าจอ) เปิดเฉพาะส่วนที่ใช้ เพื่อประหยัดหน่วยความจำ
#ifndef LV_CONF_H
#define LV_CONF_H

#include <stdint.h>

#define LV_COLOR_DEPTH 16
#define LV_COLOR_16_SWAP 0
#define LV_MEM_CUSTOM 0
#define LV_MEM_SIZE (48U * 1024U)
#define LV_DISP_DEF_REFR_PERIOD 30
#define LV_INDEV_DEF_READ_PERIOD 30
#define LV_TICK_CUSTOM 1
#define LV_TICK_CUSTOM_INCLUDE "Arduino.h"
#define LV_TICK_CUSTOM_SYS_TIME_EXPR (millis())
#define LV_DPI_DEF 130
#define LV_USE_LOG 0
#define LV_USE_ASSERT_NULL 1
#define LV_USE_ASSERT_MALLOC 1
#define LV_USE_PERF_MONITOR 0
#define LV_USE_MEM_MONITOR 0

#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_DEFAULT &lv_font_montserrat_14
#define LV_USE_FONT_PLACEHOLDER 1
#define LV_TXT_ENC LV_TXT_ENC_UTF8

#define LV_USE_LABEL 1
#define LV_LABEL_TEXT_SELECTION 0
#define LV_LABEL_LONG_TXT_HINT 0
#define LV_USE_BTN 1
#define LV_USE_BTNMATRIX 0
#define LV_USE_IMG 0
#define LV_USE_LINE 1
#define LV_USE_ARC 0
#define LV_USE_BAR 0
#define LV_USE_SLIDER 0
#define LV_USE_CHECKBOX 0
#define LV_USE_DROPDOWN 0
#define LV_USE_ROLLER 0
#define LV_USE_SWITCH 0
#define LV_USE_TEXTAREA 0
#define LV_USE_TABLE 0
#define LV_USE_CANVAS 0

#define LV_USE_ANIMIMG 0
#define LV_USE_CALENDAR 0
#define LV_USE_CHART 0
#define LV_USE_COLORWHEEL 0
#define LV_USE_IMGBTN 0
#define LV_USE_KEYBOARD 0
#define LV_USE_LED 0
#define LV_USE_LIST 0
#define LV_USE_MENU 0
#define LV_USE_METER 0
#define LV_USE_MSGBOX 0
#define LV_USE_SPAN 0
#define LV_USE_SPINBOX 0
#define LV_USE_SPINNER 0
#define LV_USE_TABVIEW 0
#define LV_USE_TILEVIEW 0
#define LV_USE_WIN 0

#define LV_USE_THEME_DEFAULT 1
#define LV_THEME_DEFAULT_DARK 1
#define LV_USE_FLEX 1
#define LV_USE_GRID 0

#endif
