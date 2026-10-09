#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Single source of truth shared by the two consumer probes.

probe-consumers.py answers "does a consumer element exist in this UI state".
probe-rule-fire.py answers "does the consumer rule actually resolve when such
an element does exist". Both must agree on which tokens, which sentinel value
and which rendered facts count as faithful — so those live here rather than
being duplicated and silently drifting apart.
"""

from __future__ import annotations

SETTLE_MS = 9000

# token -> sentinel value written to <body> inline while measuring
SENTINELS: dict[str, str] = {
    "--dsh-boot-bg": "rgb(1, 2, 3)",
    "--dsw-desktop-window-tint": "rgb(1, 2, 3)",
    "--dsw-focus-ring-color": "rgb(1, 2, 3)",
    "--dsw-menu-backdrop-filter": "blur(3px)",
    "--dsw-menu-surface-fill": "rgb(1, 2, 3)",
    "--dsw-specific-menu": "rgb(1, 2, 3)",
    "--dsw-alias-bg-overlay": "rgb(1, 2, 3)",
    "--dsw-alias-button-primary-fill": "rgb(1, 2, 3)",
    "--dsw-alias-state-error-primary": "rgb(1, 2, 3)",
    "--dsw-alias-state-success-primary": "rgb(1, 2, 3)",
    "--dsw-alias-state-warn-primary": "rgb(1, 2, 3)",
    "--dsw-elevation-stroke-color": "rgb(1, 2, 3)",
    "--dsw-elevation-stroke": "0 0 0 9px rgb(1, 2, 3)",
    "--dsw-shadow-lv1": "0 0 0 9px rgb(1, 2, 3)",
    "--dsw-mask-blur": "blur(7px)",
}

TARGETS: list[str] = list(SENTINELS)

# What a faithful render of each mode looks like. Deliberately does NOT read
# data-ds-theme-source: boot-theme.ts:31 writes that on <html>, and asserting a
# preference attribute proves nothing about which palette was rendered. These
# three are direct observations of the rendered document.
EXPECTED = {
    "light": {"htmlColorScheme": "light", "darkAttr": False, "bootBg": "#fff"},
    "dark": {"htmlColorScheme": "dark", "darkAttr": True, "bootBg": "#151517"},
}
