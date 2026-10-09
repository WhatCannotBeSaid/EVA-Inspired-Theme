# EVA-Inspired-Theme

[![Licence: MIT + CC BY-NC-SA 4.0](https://img.shields.io/badge/licence-MIT%20%2B%20CC--BY--NC--SA%204.0-yellow.svg)](#licence)
[![Unofficial fan work](https://img.shields.io/badge/project-unofficial_fan_work-blue.svg)](#fan-work-and-attribution)

A Neon Genesis Evangelion–inspired skin for **DeepSeek Harness**. Two fully
designed modes over one removable override layer, a wallpaper paint layer whose
alphas are solved against a contrast budget rather than picked by eye, a boot
mask, and four tiered task sounds.

This repository carries **no image bytes for a background**: the paint layer is
here, the artwork is not. Instead the tracked wallpaper manifest names two
third-party pictures by URL, so a clone draws a background the browser fetches
from wallhaven at paint time, and nothing in git is anyone else's pixel data. The
theme's look is otherwise unchanged — the alphas, the boot mask, the brand mark
and the fonts all come from this repository.

**Unofficial fan work.** Not affiliated with, endorsed by, or licensed by
khara, inc., Hypergryph, or DeepSeek. See
[Fan work and attribution](#fan-work-and-attribution).

## What it is

| | |
|---|---|
| Modes | **Title Card** (light) and **Central Dogma** (dark) |
| Token layer | 55 measured overrides (41 in the light arm, 14 in the dark arm) on a single removable layer |
| Wallpaper layer | No image bytes ship in this repository. The tracked manifest points at two third-party pictures on wallhaven, which the browser fetches at paint time; the maintainer's own machine embeds local copies instead. Surface alphas are solved against a WCAG contrast budget |
| Boot mask | Shown on load; unchanged timings and triggers |
| Task sounds | `ask`, `done`, `fail`, `plan` — four WAVs, ported from `dsh-perlica-ding` v0.2.0. A plain Q&A turn stays silent. No startup chime. |
| Brand mark | One client-side illustration, two tones |
| Also inside | A plugin on/off switch and a session-row status rail, both vendored from MIT plugins |
| Language | All user-facing text goes through the official locale service (zh / en) |

The theme neither reconfigures nor disables any official row. It installs one
layer and can be removed as one. It also ships **no settings panel** and stores
no preference: there is nothing to configure, so there is no config to persist.

## Requirements

- DeepSeek Harness with a web profile.
- Node.js >= 18 — only for the build and check tools. The theme itself runs in
  the browser.

## Install

From this checkout or a clone of it:

```
npm run build                                              # writes the browser bundle
dsh plugin --profile <profile> add link:<path-to-this-checkout>
```

Run the build once after cloning: `client.js` is generated and deliberately not
tracked (see [Layout](#layout)). A clone builds the tracked form: the paint layer
points at the two pictures named in `build/wallpapers.json` and the browser
fetches them, so the background needs a network and the host learns the viewer's
IP. That is the intended public form.

The package carries a `prepare` script that runs exactly that build, so an
install straight from the Git URL produces the bundle for you before the package
is linked. A plain `git clone` still needs one build: `npm run build`, or any
`npm install` inside the checkout, which triggers `prepare`.

The package declares `dsh.bundle.patch`, so the profile reconciles its bundle
stack against the installed package and mounts the theme. If it does not appear
after a restart, append `EVA-Inspired-Theme` to `dsh.profile.bundles` in the
profile's `package.json` — a package that is merely a dependency is not mounted.

## Remove

```
dsh plugin --profile <profile> remove EVA-Inspired-Theme
```

Drop the entry from `dsh.profile.bundles` too if you added it there.

## Layout

```
index.js              host half — mounts, plays the task sounds, registers no route
client.js             GENERATED browser bundle. Not tracked; build it. Do not edit.
src/client.js         the real client half
src/theme.css         the token layer
cordis.patch.yml      the bundle-patch mount declaration
build/                shipped assets + the two vendored client halves
build/wallpapers.json the TRACKED wallpaper manifest — art URLs, not image bytes
sounds/               the four task WAVs
tools/                build, self-check, token audit, sound layer gate
docs/                 design log, recon, audits, render reports
NOTICE                upstream licences and third-party credits
LICENSE               this package's layered licence
LICENSE-CC-BY-NC-SA-4.0.txt  the CC licence text for the brand marks
```

`client.js` is generated from `src/` and carries a banner saying so. Edit `src/`
and run `npm run build`; the check gate fails if the two drift apart.

The wallpaper manifest has two layers, and the tracked one names art instead of
carrying it:

- `build/wallpapers.json` — tracked. Two entries, each with a `direct:` URL that
  points at a third party's copy of the picture, plus the `page:` a credit
  belongs on. The build emits `url("https://…")`, so the theme keeps its
  background while this repository still holds no image bytes. An empty list is
  also legal: it publishes `--cp-pick-light: none; --cp-pick-dark: none;`, the
  paint layer's documented no-art state.
- `out/wallpapers.local.json` — ignored by git. The same shape with `dataUrl:`
  entries; if it exists the build reads it instead and embeds the art, which is
  how the maintainer's own machine keeps looking the way it does. `node
  tools/build-client.mjs --public` ignores it and builds the tracked form anyway.

Because `client.js` is ignored too, and the tracked manifest holds no `dataUrl:`,
a bundle that carries artwork has nowhere to be committed. Those facts are
asserted (`wall.2`, `wall.6`, `wall.7`, `wall.8`).

## Checks

```
npm run verify
```

Runs every gate: syntax check of both bundle halves, the self-check (115
assertions), the token audit (55 overrides, exactly the planned 55), the sound
layer gate (25 checks: format, byte length and peak of each WAV), and a rebuild
comparison that proves `client.js` is in sync with `src/`.

## Licence

This package uses **tiered licensing**. Each licence applies only to the part it
is named against; none of them is an alternative licence for the whole
repository. Images and third-party materials sit outside the blanket grants
unless a row says otherwise, and catalogue data (`build/*.json`) describes assets
without licensing them. No trademark rights are granted here.

| Part | Licence | What it asks of you |
|---|---|---|
| Our code — `index.js`, `src/`, `tools/`, `client.js` | MIT | Keep the copyright and licence notice. Commercial use of the code is fine. |
| Project text — this README, `docs/`, `NOTICE`, `LICENSE` | CC BY-NC-SA 4.0 | Credit, link the licence, note changes, keep it non-commercial, share alike. |
| Brand marks — `build/brand-mark*.png`, `build/brand-mark.jpg` | CC BY-NC-SA 4.0 | Same terms, and this is third-party artwork: see below. |
| Task sounds — `sounds/*.wav` | MIT (upstream `dsh-perlica-ding`) | Keep upstream's notice. |
| Font — `build/great-vibes-latin.woff2` | SIL OFL 1.1 | Keep the notice; do not sell the font on its own. |
| Vendored halves — `build/plugin-toggle.js`, `build/session-eva-status.js` | MIT (two other plugins, same author) | Keep both notices; they are inlined into `client.js` too. |
| The two background wallpapers | **Hotlinked, not distributed, not licensed here.** | This project grants you no rights in them; the credits below are attribution only. |

Because the brand marks forbid commercial use, **the package as a whole may not
be used commercially**. The MIT code on its own is not restricted; drop the brand
marks if you need a commercial-use build.

Full terms: [LICENSE](LICENSE). Upstream texts and per-file credits:
[NOTICE](NOTICE). The CC BY-NC-SA 4.0 legal text ships as
[LICENSE-CC-BY-NC-SA-4.0.txt](LICENSE-CC-BY-NC-SA-4.0.txt) and is also at
<https://creativecommons.org/licenses/by-nc-sa/4.0/>.

## Fan work and attribution

**Unofficial fan work.** Not affiliated with, endorsed by, or licensed by khara,
inc., Hypergryph, or DeepSeek. The theme is a non-commercial fan work, made under
khara's published fan-work guideline (<https://www.khara.co.jp/guideline/>),
which permits non-commercial fan works and licenses neither the characters nor
the brand. Working outside the limits of that guideline needs a separate licence
from khara. The `EVA` in the package name is a reference, not a claim of origin.

**Brand mark.** Character 溟月 by 上善无形 (original character,
<https://space.bilibili.com/4456176>). DeepSeek-elements second pass by ZipZipPipe
(GPT Image 2, <https://space.bilibili.com/4168597>). Refined repair by QYQCAMIAO.
Licensed CC BY-NC-SA 4.0 — credit, non-commercial, share alike. This repository
cropped and resized the illustration to 256×256 and derived the dark variant with
`tools/make-brand-mark-dark.py`; both derived images stay under the same terms.
Commercial use of this artwork needs permission from the rights holders above.

**Task sounds.** From `dsh-perlica-ding` v0.2.0 by 117BS (MIT), rescaled to 60%
volume. The voice lines are upstream's, for the character Perlica (佩丽卡) from
Arknights: Endfield (© Hypergryph / GRYPHLINE).

**Font.** "Great Vibes" by TypeSETit, SIL OFL 1.1.

**Wallpapers — hotlinked with credit, never redistributed.** Two background
images are part of the theme's intended look. Since 2026-10-09 (D79) neither is
in this repository, and since D81 the tracked manifest points at
them instead of embedding them: a build shows the pictures while this repository
carries none of their bytes and grants you no rights in them. The browser fetches
them from wallhaven when the theme paints, so nothing is mirrored here and an
offline machine simply has no background. Provenance, recorded because it is what
a takedown request would be about:

- Dark — **Central Dogma**, `og33jl`,
  [wallhaven.cc/w/og33jl](https://wallhaven.cc/w/og33jl), 2560×1440. Wallhaven
  credits the artist **YOTA SAKI**, and the entry links to the original posting,
  [pixiv artwork 133258822](https://www.pixiv.net/en/artworks/133258822).
  Uploaded to wallhaven by *Elisban*.
- Light — **Title Card**, `x85po3`,
  [wallhaven.cc/w/x85po3](https://wallhaven.cc/w/x85po3), 1760×1066. Wallhaven
  records no source for this upload (uploader *BachoWilson*), so the artist is
  unknown; the same artwork also circulates on Chinese wallpaper sites.

We hold no permission from either artist. If you are one of them and object to
being linked this way, say so and the entry will be dropped from
`build/wallpapers.json` — this repository holds no copy of it either way.

本仓库图片来自网络流传，具体作者未确认；如原作者认为不妥，请联系删除。
