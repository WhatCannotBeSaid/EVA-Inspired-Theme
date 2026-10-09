"""令牌事实查询 —— 按子串列出官方原值、引用计数、声明位置。

用途：写设计文档时核对「官方原值 / 被多少地方引用」这两列，避免手抄。
解释器：DSH runtime Python（只标准库）。
用法：
  $pyr tools\\s2-lookup.py sidebar-fill tooltip menu-backdrop
  $pyr tools\\s2-lookup.py --decl --dsw-alias-label-primary      # 附带声明位置
  $pyr tools\\s2-lookup.py --all-dsw                             # 全部官方 alias
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def main() -> int:
    base = json.loads((OUT / "s2-token-baseline.json").read_text(encoding="utf-8"))
    cnt = {r["token"]: r for r in
           json.loads((OUT / "s2-refcount.json").read_text(encoding="utf-8"))["rows"]}
    refs = json.loads((OUT / "cssom-refs.json").read_text(encoding="utf-8"))

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    show_decl = "--decl" in sys.argv
    if "--all-dsw" in sys.argv:
        args = ["--dsw-"]

    rows = base["rows"]
    if args:
        rows = [x for x in rows if any(a in x["token"] for a in args)]

    print(f"{'token':<46}{'light':<24}{'dark':<24}{'prim':>5}{'total':>7}  decl@")
    for h in sorted(rows, key=lambda x: x["token"]):
        c = cnt.get(h["token"], {})
        decl = refs["declared"].get(h["token"], [])
        where = ""
        if decl:
            d0 = decl[0]
            where = f'{d0.get("sheet", "")[:36]} § {d0.get("selector", "")[:34]}'
        print(f'{h["token"]:<46}{str(h["light"])[:23]:<24}{str(h["dark"])[:23]:<24}'
              f'{c.get("primary", "-"):>5}{c.get("total", "-"):>7}  {where}')
        if show_decl:
            for d in decl:
                print(f'      decl  {d.get("sheet", "")[:44]:<46} '
                      f'{d.get("selector", "")[:40]:<42} = {d.get("value", "")}')
    print(f"\n{len(rows)} row(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
