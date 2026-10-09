"""S2 令牌基线（只读）。

把 S1 已经取到的运行时真值整理成 S2 选令牌直接可用的表：
  令牌名 -> 官方 light 原值 / 官方 dark 原值 / 引用次数 / 声明处 / 是否 alias

数据源（全部是 S1 的产物，不重新起浏览器）：
  out\\baseline.json    light.bodyComputed / dark.bodyComputed  = 官方运行时真值（498 个）
  out\\cssom-refs.json  refs[token] / declared[token] / sheets  = 引用图

解释器：DSH runtime Python（只用标准库）。
产物：out\\s2-token-baseline.json

用法：
  $pyr tools\\s2-token-baseline.py            # 打印摘要
  $pyr tools\\s2-token-baseline.py --dsw      # 只打印 --dsw-* 且有引用的
  $pyr tools\\s2-token-baseline.py --alias    # 只打印 --dsw-alias-*
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def load(name: str) -> dict:
    return json.loads((OUT / name).read_text(encoding="utf-8"))


def ref_shape(refs: dict, token: str):
    """把 refs[token] 归一成 (条数, [声明/消费摘要字符串])。"""
    node = refs.get(token)
    if node is None:
        return 0, []
    if isinstance(node, int):
        return node, []
    if isinstance(node, list):
        return len(node), node[:4]
    if isinstance(node, dict):
        # 可能是 {"count": n, "rules": [...]} 之类
        for key in ("count", "n", "total"):
            if isinstance(node.get(key), int):
                inner = node.get("rules") or node.get("items") or []
                return node[key], (inner[:4] if isinstance(inner, list) else [])
        return len(node), [f"<dict keys={list(node.keys())[:6]}>"]
    return 0, [f"<{type(node).__name__}>"]


def describe(entry) -> str:
    if isinstance(entry, str):
        return entry
    return json.dumps(entry, ensure_ascii=False)[:160]


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "--all"

    baseline = load("baseline.json")
    refsdoc = load("cssom-refs.json")

    light = baseline["light"]["bodyComputed"]
    dark = baseline["dark"]["bodyComputed"]
    html_light = baseline["light"]["htmlComputed"]
    refs = refsdoc.get("refs", {})
    declared = refsdoc.get("declared", {})

    rows = []
    for name in sorted(set(light) | set(dark) | set(html_light)):
        n_refs, sample = ref_shape(refs, name)
        dec = declared.get(name)
        if isinstance(dec, list):
            dec_n = len(dec)
            dec_sample = [describe(d) for d in dec[:3]]
        elif dec is None:
            dec_n = 0
            dec_sample = []
        else:
            dec_n, dec_sample = 1, [describe(dec)]

        rows.append(
            {
                "token": name,
                "light": light.get(name),
                "dark": dark.get(name),
                "onHtml": name in html_light,
                "refs": n_refs,
                "declarations": dec_n,
                "refSample": [describe(s) for s in sample],
                "declSample": dec_sample,
            }
        )

    payload = {
        "source": {
            "baseline": "out/baseline.json",
            "baselineCapturedAt": baseline.get("capturedAt"),
            "refs": "out/cssom-refs.json",
            "sheets": len(refsdoc.get("sheets", [])),
        },
        "counts": {
            "tokens": len(rows),
            "withRefs": sum(1 for r in rows if r["refs"] > 0),
            "dswTokens": sum(1 for r in rows if r["token"].startswith("--dsw-")),
            "dswTokensWithRefs": sum(
                1 for r in rows if r["token"].startswith("--dsw-") and r["refs"] > 0
            ),
            "aliasTokens": sum(1 for r in rows if r["token"].startswith("--dsw-alias-")),
            "staticTokens": sum(1 for r in rows if r["token"].startswith("--dsw-static-")),
            "dshTokens": sum(1 for r in rows if r["token"].startswith("--dsh-")),
        },
        "rows": rows,
    }
    (OUT / "s2-token-baseline.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    print("capturedAt =", baseline.get("capturedAt"), "sheets =", len(refsdoc.get("sheets", [])))
    print("counts =", json.dumps(payload["counts"], ensure_ascii=False))

    if mode == "--alias":
        sel = [r for r in rows if r["token"].startswith("--dsw-alias-")]
    elif mode == "--dsw":
        sel = [r for r in rows if r["token"].startswith("--dsw-") and r["refs"] > 0]
    elif mode == "--static":
        sel = [r for r in rows if r["token"].startswith("--dsw-static-")]
    elif mode == "--all":
        sel = rows
    else:
        sel = [r for r in rows if r["token"].startswith("--dsw-") and r["refs"] > 0]

    print(f"\n{'token':<52}{'refs':>5}{'dec':>5}  {'light':<26}{'dark':<26}")
    print("-" * 118)
    for r in sorted(sel, key=lambda x: -x["refs"]):
        print(
            f"{r['token']:<52}{r['refs']:>5}{r['declarations']:>5}  "
            f"{str(r['light'])[:25]:<26}{str(r['dark'])[:25]:<26}"
        )
    print(f"\nprinted {len(sel)} rows -> out\\s2-token-baseline.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
