#!/usr/bin/env bash
# Stop hook: ห้ามจบงานถ้ายังมีโค้ดที่ไม่ได้ commit หรือไม่ได้ push ขึ้น GitHub
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

input=$(cat)
# ถ้าเตือนไปแล้วรอบหนึ่ง (เช่น push ไม่ได้เพราะไม่มีสิทธิ์) ให้จบได้ เพื่อไม่ให้วนไม่รู้จบ
case "$input" in *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;; esac

problems=""
dirty=$(git status --porcelain)
[ -n "$dirty" ] && problems="$problems\n- มีไฟล์ที่ยังไม่ได้ commit:\n$dirty"

branch=$(git branch --show-current)
if [ -n "$branch" ]; then
  if ! git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    # clone แบบ single-branch ไม่มี ref ติดตาม branch อื่น ให้ถาม GitHub ตรง ๆ
    remote=$(git ls-remote --heads origin "$branch" 2>/dev/null | cut -f1)
    if [ -z "$remote" ]; then
      problems="$problems\n- branch '$branch' ยังไม่เคย push ขึ้น GitHub"
    elif [ "$remote" != "$(git rev-parse HEAD)" ]; then
      problems="$problems\n- commit ล่าสุดในเครื่องไม่ตรงกับบน GitHub"
    fi
  else
    ahead=$(git rev-list --count '@{u}..HEAD')
    [ "$ahead" -gt 0 ] && problems="$problems\n- มี $ahead commit ที่ยังไม่ได้ push ขึ้น GitHub"
  fi
fi

[ -z "$problems" ] && exit 0
printf "ยังไม่ได้สำรองโค้ดขึ้นออนไลน์ (กฎของ repo นี้: ทุกการแก้ไขต้อง commit และ push ทุกครั้ง)%b\nให้ commit และ git push -u origin %s ก่อนจบงาน ถ้า push ไม่ได้ ให้แจ้งผู้ใช้ว่าโค้ดยังไม่ขึ้นออนไลน์และเพราะอะไร\n" "$problems" "$branch" >&2
exit 2
