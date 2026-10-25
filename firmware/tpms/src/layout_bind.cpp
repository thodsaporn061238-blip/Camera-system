#include "layout_bind.h"

#include <stdlib.h>

std::string expandTemplate(const std::string &tpl,
                           const std::function<bool(const std::string &key, std::string &out)> &lookup) {
  std::string out;
  size_t i = 0;
  while (i < tpl.size()) {
    size_t open = tpl.find('{', i);
    if (open == std::string::npos) break;
    size_t close = tpl.find('}', open + 1);
    if (close == std::string::npos) break;
    out.append(tpl, i, open - i);
    std::string key = tpl.substr(open + 1, close - open - 1), value;
    if (lookup(key, value)) out += value;
    else out.append(tpl, open, close - open + 1);
    i = close + 1;
  }
  out.append(tpl, i, std::string::npos);
  return out;
}

int wheelIndex(const std::string &key) {
  static const char *names[] = {"fl", "fr", "rl", "rr"};
  for (int i = 0; i < 4; i++)
    if (key == names[i]) return i;
  return -1;
}

unsigned long parseHexColor(const std::string &s, unsigned long fallback) {
  if (s.size() != 7 || s[0] != '#') return fallback;
  char *end = nullptr;
  unsigned long v = strtoul(s.c_str() + 1, &end, 16);
  return end && *end == '\0' ? v : fallback;
}
