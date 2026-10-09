"""S2 引用次数统计（只读）——把「引用次数」这一列的定义固定下来。

背景：recon.md §8 的逐令牌引用数与 out\\cssom-refs.json 的长度对不上
（§8 记 `--dsw-alias-label-primary` 675 / `--dsw-alias-bg-layer-1` 11，
 而 refs 列表长度是 705 / 149）。本脚本把三种口径一次算清，用来判定
 §8 当初数的是哪一种，并给 S2 的令牌差异表选定一个可复算的口径。

三种口径（同一份 out\\cssom-refs.json，不重新起浏览器）：
  total        该令牌出现在多少条声明里（= refs[token] 的长度，全库合计 8527）
  primary      该令牌至少有一次出现在某个 var() 的**第一个参数**位（真正供值）
  fallbackOnly 该令牌在 value 里出现过，但从不处于任何 var() 的首参位（只是兜底）
  inCustomProp 引用发生在**自定义属性**的值里（会再往下派生一层）

解释器：DSH runtime Python（只用标准库）。
用法：$pyr tools\\s2-refcount.py [--all]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def first_args(value: str, token: str) -> bool:
    """token 是否出现在某个 var() 的第一个参数位。"""
    i = 0
    while True:
        i = value.find("var(", i)
        if i < 0:
            return False
        j = i + 4
        depth = 1
        argno = 1
        buf = []
        while j < len(value) and depth:
            ch = value[j]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    break
            elif ch == "," and depth == 1:
                argno += 1
            if argno == 1:
                buf.append(ch)
            j += 1
        if "".join(buf).strip() == token:
            return True
        i = j


def main() -> int:
    doc = json.loads((OUT / "cssom-refs.json").read_text(encoding="utf-8"))
    refs = doc["refs"]

    rows = []
    for token, entries in refs.items():
        prim = sum(1 for e in entries if first_args(e["value"], token))
        icp = sum(1 for e in entries if e.get("inCustomProp"))
        rows.append(
            {
                "token": token,
                "total": len(entries),
                "primary": prim,
                "fallbackOnly": len(entries) - prim,
                "inCustomProp": icp,
            }
        )

    rows.sort(key=lambda r: -r["total"])
    (OUT / "s2-refcount.json").write_text(
        json.dumps({"source": "out/cssom-refs.json", "rows": rows}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )

    print(f"tokens with refs = {len(rows)}   total refs = {sum(r['total'] for r in rows)}")
    print(f"{'token':<52}{'total':>7}{'primary':>9}{'fallback':>10}{'inCustom':>10}")
    print("-" * 90)
    sel = rows if "--all" in sys.argv else rows[:60]
    for r in sel:
        print(f"{r['token']:<52}{r['total']:>7}{r['primary']:>9}{r['fallbackOnly']:>10}{r['inCustomProp']:>10}")
    print(f"\nprinted {len(sel)}/{len(rows)} -> out\\s2-refcount.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
