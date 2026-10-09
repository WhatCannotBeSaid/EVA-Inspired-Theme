"""S2 派生图（只读）——找出「哪些令牌只是别的令牌的转发」。

P0 §7 要求优先改上游 alias；P0 §6 禁止为视觉效果逐个覆盖组件令牌。
两者合起来的硬约束是：**只能改派生图的根**。若 token A 声明为
`--A: var(--B)`（纯转发，没有 fallback、没有 color-mix、没有 calc），
那么改 A 等于用一个冻结值截断 B 的下游分发——官方下一次调整 B 时
A 不再跟随。此时应当改 B。

本脚本从 out\\cssom-refs.json 的 declared 里抽出纯转发边，输出：
  roots      没有任何上游的令牌（可以安全覆盖）
  forwards   纯转发令牌 -> 上游令牌（**不要直接覆盖**）
  complex    值里含 var()/color-mix()/calc() 但不是纯转发的令牌（改它只影响自己）
  chains     每个转发令牌的完整上游链（用于 tokens-diff 的「影响范围」列）

解释器：DSH runtime Python（只用标准库）。
用法：$pyr tools\\s2-derivation.py [--chains]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"

PURE = re.compile(r"^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$")


def upstream_of(value: str) -> str | None:
    m = PURE.match(value.strip())
    return m.group(1) if m else None


def main() -> int:
    doc = json.loads((OUT / "cssom-refs.json").read_text(encoding="utf-8"))
    declared = doc["declared"]

    forwards: dict[str, set[str]] = {}
    declared_where: dict[str, list[tuple[str, str]]] = {}
    for token, entries in declared.items():
        ups = set()
        for e in entries:
            u = upstream_of(e["value"])
            if u:
                ups.add(u)
            declared_where.setdefault(token, []).append((e["selector"], e["value"]))
        if ups and len(ups) == 1 and all(upstream_of(e["value"]) for e in entries):
            forwards[token] = ups

    def root_of(token: str, seen: set[str] | None = None) -> list[str]:
        seen = seen or set()
        if token in seen:
            return [token, "...(cycle)"]
        seen.add(token)
        nxt = forwards.get(token)
        if not nxt:
            return [token]
        up = next(iter(nxt))
        return [token] + root_of(up, seen)

    roots = sorted(t for t in declared if t not in forwards)
    print(f"declared tokens = {len(declared)}   pure forwards = {len(forwards)}   roots = {len(roots)}")

    # 反向：一个根被多少个令牌转发（决定覆盖它的收益）
    fanin: dict[str, int] = {}
    for t, ups in forwards.items():
        for u in ups:
            fanin[u] = fanin.get(u, 0) + 1
    print("\n=== 被最多令牌转发的根（改一个，动一片）===")
    for tok, n in sorted(fanin.items(), key=lambda kv: -kv[1])[:24]:
        print(f"  {tok:<46} fanin={n:<4} refs={len(doc['refs'].get(tok, []))}")

    if "--chains" in sys.argv:
        print("\n=== 完整的纯转发边（token -> upstream）===")
        for tok in sorted(forwards):
            up = next(iter(forwards[tok]))
            where = declared_where.get(tok, [])
            sel = where[0][0] if where else "?"
            print(f"  {tok:<46} -> {up:<46} [{sel[:40]}]")

    print("\n=== 我可能想改的令牌，逐个报是不是转发 ===")
    WATCH = [
        "--dsw-alias-bg-base", "--dsw-alias-bg-layer-1", "--dsw-alias-bg-layer-2",
        "--dsw-alias-bg-layer-3", "--dsw-alias-bg-module-platform",
        "--dsw-alias-border-l1", "--dsw-alias-border-l2", "--dsw-alias-border-l3",
        "--dsw-alias-border-l4", "--dsw-elevation-stroke-color",
        "--dsw-alias-label-primary", "--dsw-alias-label-secondary", "--dsw-alias-label-tertiary",
        "--dsw-alias-label-caption", "--dsw-alias-label-dimmed",
        "--dsw-alias-brand-primary", "--dsw-alias-button-primary-fill",
        "--dsw-alias-label-primary-foreground",
        "--dsw-alias-state-business-primary", "--dsw-alias-state-error-primary",
        "--dsw-alias-state-success-primary", "--dsw-alias-state-warn-primary",
        "--dsw-alias-state-warn-label", "--dsw-alias-link",
        "--dsw-alias-interactive-bg-hover", "--dsw-alias-interactive-bg-hover-accent",
        "--dsw-alias-interactive-bg-hover-solid", "--dsw-alias-interactive-bg-active",
        "--dsw-alias-scrollbar-bg-l1", "--dsw-alias-scrollbar-bg-l2",
        "--dsw-alias-scrollbar-hover-l1", "--dsw-alias-scrollbar-hover-l2",
        "--dsw-menu-surface-fill", "--dsw-specific-menu", "--dsw-alias-bg-overlay",
        "--dsw-corner-shape", "--dsw-radius-sm", "--dsw-radius-md", "--dsw-radius-lg",
        "--ds-ease-in-out", "--ds-transition-duration", "--dsw-font-family",
        "--dsw-focus-ring-color", "--dsw-mask-blur", "--dsw-menu-backdrop-filter",
    ]
    for t in WATCH:
        if t in forwards:
            print(f"  转发  {t:<46} -> {next(iter(forwards[t]))}")
        elif t in declared:
            print(f"  根    {t:<46}    decl={declared_where[t][0][0][:38]}")
        else:
            print(f"  无声明 {t}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
