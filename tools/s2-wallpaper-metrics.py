"""S2 参考图量化盘点（只读，不修改任何图片）。

回答 S2 的两个硬问题：
  1. 这 8 张参考图的「色彩关系 / 厚薄关系 / 几何关系」到底是多少（不许凭目视下结论）。
  2. 每张图作为「壁纸」时的亮度上限 —— 亮色模式与暗色模式各自能承受多亮的 art。

指标（全部按 sRGB 非线性空间计算，因为 CSS 的 alpha 合成就在这个空间做）：
  lum          WCAG 相对亮度（0..1），含均值与 p01/p05/p25/p50/p75/p95/p99
  share*       落在若干亮度阈值之上/之下的像素占比
  sat          HSV 饱和度（均值 / p50 / p95）与「霓虹占比」（S>0.5 且 V>0.5）
  dominant     量化到 32 色后的前 12 个主导色（hex + 占比 + 自身亮度）
  edge         灰度梯度幅值（均值 / p95）→ 量化「信息密度 / 厚薄关系」
  grid3x3      3x3 分区的平均亮度 → 说明画面明暗分布（正文区能落在哪里）

解释器：DSH runtime Python（需要 numpy + Pillow）。
产物：out\\s2-wallpapers.json

用法：
  $pyr tools\\s2-wallpaper-metrics.py
  $pyr tools\\s2-wallpaper-metrics.py --long 2500
"""

# ── 历史工具（2026-10-05 EVA 版）：磁盘上的 Cyberpunk 版 8 张参考图已随项目目录删除，
#    下面的文件名清单因此不可能再解析；EVA 的两张壁纸由用户直接指定（亮 8g9wyy /
#    暗 yqmlmx），量化由 tools/s3-veil-budget.py 在真实源图上直接做，故本文件不再需要
#    运行。清单与阈值是历史记录，故意不更新。

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
DESK = Path(str(Path.home() / "Desktop"))

FILES = [
    "wallhaven-l89r6q.png",
    "wallhaven-gpzve7.png",
    "wallhaven-28wpjm.png",
    "wallhaven-6oqzgq.jpg",
    "wallhaven-28kdom.png",
    "wallhaven-6k2ogx.jpg",
    "wallhaven-2eglj6.jpg",
    "wallhaven-l8v3ey.png",
]

# sRGB -> 线性
_LIN = np.array([((c / 255.0) / 12.92) if c / 255.0 <= 0.04045
                 else (((c / 255.0) + 0.055) / 1.055) ** 2.4 for c in range(256)],
                dtype=np.float64)


def rel_luminance(rgb: np.ndarray) -> np.ndarray:
    """rgb: (...,3) uint8 或 float 0..255 -> 相对亮度 (...,)。"""
    lin = _LIN[np.clip(rgb, 0, 255).astype(np.uint8)]
    return 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]


def hexof(rgb) -> str:
    r, g, b = (int(round(float(c))) for c in rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


def analyse(path: Path, long_edge: int) -> dict:
    im = Image.open(path)
    src_w, src_h = im.size
    im = im.convert("RGB")
    scale = long_edge / max(src_w, src_h)
    if scale < 1.0:
        im = im.resize((max(1, int(src_w * scale)), max(1, int(src_h * scale))), Image.LANCZOS)
    arr = np.asarray(im, dtype=np.uint8)
    h, w, _ = arr.shape

    lum = rel_luminance(arr)
    flat = lum.ravel()

    # HSV
    hsv = np.asarray(im.convert("HSV"), dtype=np.float64) / 255.0
    sat = hsv[..., 1].ravel()
    val = hsv[..., 2].ravel()

    # 边缘密度：灰度的一阶梯度
    gray = (0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]) / 255.0
    gy, gx = np.gradient(gray)
    edge = np.hypot(gx, gy)

    # 主导色
    q = im.quantize(colors=32, method=Image.MEDIANCUT).convert("RGB")
    qarr = np.asarray(q, dtype=np.uint8).reshape(-1, 3)
    colors, counts = np.unique(qarr, axis=0, return_counts=True)
    order = np.argsort(-counts)
    dom = []
    for i in order[:12]:
        c = colors[i]
        dom.append(
            {
                "hex": hexof(c),
                "share": round(float(counts[i]) / qarr.shape[0], 5),
                "lum": round(float(rel_luminance(c.reshape(1, 3))[0]), 5),
            }
        )

    # 3x3 分区平均亮度
    grid = []
    for r in range(3):
        row = []
        for c in range(3):
            blk = lum[r * h // 3:(r + 1) * h // 3, c * w // 3:(c + 1) * w // 3]
            row.append(round(float(blk.mean()), 4))
        grid.append(row)

    def share(mask) -> float:
        return round(float(mask.mean()), 5)

    pct = lambda p: round(float(np.percentile(flat, p)), 5)

    return {
        "file": path.name,
        "sourceSize": [src_w, src_h],
        "analysedSize": [w, h],
        "aspect": round(src_w / src_h, 4),
        "lumMean": round(float(flat.mean()), 5),
        "lumP": {"p01": pct(1), "p05": pct(5), "p25": pct(25), "p50": pct(50),
                 "p75": pct(75), "p95": pct(95), "p99": pct(99)},
        "shareAbove": {"0_5": share(flat > 0.5), "0_75": share(flat > 0.75), "0_9": share(flat > 0.9)},
        "shareBelow": {"0_1": share(flat < 0.1), "0_05": share(flat < 0.05), "0_02": share(flat < 0.02)},
        "satMean": round(float(sat.mean()), 5),
        "satP50": round(float(np.percentile(sat, 50)), 5),
        "satP95": round(float(np.percentile(sat, 95)), 5),
        "neonShare": share((sat > 0.5) & (val > 0.5)),
        "edgeMean": round(float(edge.mean()), 5),
        "edgeP95": round(float(np.percentile(edge, 95)), 5),
        "grid3x3": grid,
        "dominant": dom,
    }


def main() -> int:
    long_edge = 1600
    if "--long" in sys.argv:
        long_edge = int(sys.argv[sys.argv.index("--long") + 1])

    results = []
    for name in FILES:
        path = DESK / name
        if not path.exists():
            print("MISSING", path)
            continue
        r = analyse(path, long_edge)
        results.append(r)
        print(
            f"{name:<22} {r['sourceSize'][0]}x{r['sourceSize'][1]:<5} "
            f"lum mean {r['lumMean']:.4f} p05 {r['lumP']['p05']:.4f} p50 {r['lumP']['p50']:.4f} "
            f"p95 {r['lumP']['p95']:.4f} | sat {r['satMean']:.3f} neon {r['neonShare']:.3f} "
            f"| edge {r['edgeMean']:.4f} | >0.5 {r['shareAbove']['0_5']:.3f} <0.05 {r['shareBelow']['0_05']:.3f}"
        )

    payload = {
        "source": str(DESK),
        "analysedLongEdge": long_edge,
        "colourSpace": "sRGB (non-linear), matching CSS alpha compositing",
        "images": results,
    }
    OUT.mkdir(exist_ok=True)
    (OUT / "s2-wallpapers.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"\n-> out\\s2-wallpapers.json  ({len(results)} images)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
