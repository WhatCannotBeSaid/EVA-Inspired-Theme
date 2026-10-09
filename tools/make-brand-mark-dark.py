"""Derive `build/brand-mark-dark.png` from the illustration the user supplied for
dark mode (attachment `e0811dc6…`, 1254x1254 RGBA).

The light-mode mark (`build/brand-mark.png`) is NOT touched: the user asked for the
dark sidebar mark only.

Recipe, and why each step is here
---------------------------------
* the source already carries a real alpha matte (47% fully transparent, 51% solid),
  so there is no flood fill to run -- and none is wanted, because the character's
  headdress is white and a fill would eat it;
* the bounding box comes from alpha >= 32, not alpha > 0: the source has ~18k
  stray pixels at alpha 1..31 (matte noise) which would otherwise stretch the box
  to the full canvas and shrink the subject;
* resize is PREMULTIPLIED. PIL resizes RGBA channels independently, and this
  file's transparent pixels are pure black (0,0,0,0), so a naive LANCZOS downscale
  drags that black into every edge pixel and leaves a dark fringe -- invisible on
  the dark sidebar, but a dirty outline the moment the mark sits on anything light.
  Multiply -> resize -> divide keeps the colour honest.
* crop to subject, pad 6%, square, 256x256: byte-for-byte the same framing as the
  light mark, so switching modes does not shift the logo's size in the sidebar.
"""
import numpy as np
from PIL import Image

SRC = (r"<USERPROFILE>\.dsh\attachments\v1\objects\e0"
       r"\e0811dc6ee5fd0978aa3a2f6974842e2793445fb393870a05e70bc1e0432786c")
OUT = r"<plugins>\EVA-Inspired-Theme\build\brand-mark-dark.png"
LIGHT = r"<plugins>\EVA-Inspired-Theme\build\brand-mark.png"
SIDE = 256
PAD_FRAC = 0.06

src = Image.open(SRC).convert("RGBA")
a = np.asarray(src).astype(np.float64)
rgb, alpha = a[:, :, :3] / 255.0, a[:, :, 3] / 255.0

ys, xs = np.where(a[:, :, 3] >= 32)
x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
print(f"source          : {src.size[0]}x{src.size[1]}")
print(f"subject bbox    : x {x0}-{x1}  y {y0}-{y1}  -> {x1-x0+1}x{y1-y0+1}")

# premultiplied resize of the cropped subject
crop_rgb = rgb[y0:y1 + 1, x0:x1 + 1]
crop_a = alpha[y0:y1 + 1, x0:x1 + 1]
side = max(crop_rgb.shape[0], crop_rgb.shape[1])
pad = round(side * PAD_FRAC)
canvas_side = side + 2 * pad
print(f"subject+padding : {canvas_side}x{canvas_side} target canvas")
scale = SIDE / canvas_side

pm = crop_rgb * crop_a[:, :, None]                      # premultiply
pm_img = Image.fromarray((pm * 255).astype(np.uint8), "RGB").resize(
    (round(pm.shape[1] * scale), round(pm.shape[0] * scale)), Image.LANCZOS)
a_img = Image.fromarray((crop_a * 255).astype(np.uint8), "L").resize(
    (round(crop_a.shape[1] * scale), round(crop_a.shape[0] * scale)), Image.LANCZOS)

pm = np.asarray(pm_img).astype(np.float64) / 255.0
al = np.asarray(a_img).astype(np.float64) / 255.0
unpm = np.where(al[:, :, None] > 1e-6, pm / np.maximum(al[:, :, None], 1e-6), 0.0)
out_rgb = np.clip(unpm * 255.0, 0, 255).astype(np.uint8)
out_a = np.round(al * 255.0).astype(np.uint8)

art = Image.fromarray(np.dstack([out_rgb, out_a]), "RGBA")
final = Image.new("RGBA", (SIDE, SIDE), (0, 0, 0, 0))
final.alpha_composite(art, ((SIDE - art.width) // 2, (SIDE - art.height) // 2))
final.save(OUT)

# ---- diagnostics: framing parity with the light mark, and brightness gain ----
def stats(path, label):
    im = Image.open(path).convert("RGBA")
    b = np.asarray(im).astype(np.float64)
    al = b[:, :, 3]
    ys, xs = np.where(al >= 32)
    solid = al >= 224
    lum = (0.2126 * b[:, :, 0] + 0.7152 * b[:, :, 1] + 0.0722 * b[:, :, 2])
    fill = max(xs.max() - xs.min() + 1, ys.max() - ys.min() + 1) / im.size[0]
    print(f"{label:22s} {im.size[0]}x{im.size[1]}  subject fill {fill*100:5.1f}%  "
          f"solid {solid.mean()*100:5.1f}%  mean luminance (solid) {lum[solid].mean():6.1f}")
    return lum[solid].mean()

old = stats(LIGHT, "light mark (kept)")
new = stats(OUT, "dark mark (new)")
print(f"\nbrightness gain     : {new/old:.2f}x  (+{new-old:.1f} on a 0-255 scale)")
import os
print(f"written             : {OUT}  {os.path.getsize(OUT)} bytes")
