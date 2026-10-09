#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Shared helpers for the S1 reconnaissance probes.

The live UI needs the instance's own session cookie. These probes no longer go
looking for it on disk: the signing secret comes from the environment
(`DSH_SESSION_SECRET`, base64url, the same value the official client-connection
layer signs with). With no secret the probe still runs -- unauthenticated --
and says so on stderr, so nothing in this file is a recipe for locating
anyone's credential store.

Interpreter: system Python 3.14 (playwright).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
AUTHORITY = os.environ.get("DSH_AUTHORITY", "").strip()
if not AUTHORITY:
    raise SystemExit("set DSH_AUTHORITY to the running DSH instance (host:port)")
URL = f"http://{AUTHORITY}"
VIEWPORT = {"width": 1600, "height": 1000}


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def session_cookie() -> list:
    """Return [cookie] for this instance, or [] when no secret was supplied.

    The signed value stays in memory: never printed, never written down.
    """
    raw = os.environ.get("DSH_SESSION_SECRET", "").strip()
    if not raw:
        print(
            "probe: DSH_SESSION_SECRET is not set -- opening the UI unauthenticated",
            file=sys.stderr,
        )
        return []
    secret = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    name = "dsh-auth-" + b64url(hashlib.sha256(AUTHORITY.encode()).digest())
    now = int(time.time() * 1000)
    payload = b64url(
        json.dumps(
            {"version": 1, "authority": AUTHORITY, "issuedAt": now, "expiresAt": now + 7 * 86400000},
            separators=(",", ":"),
        ).encode()
    )
    signature = b64url(hmac.new(secret, payload.encode(), hashlib.sha256).digest())
    return [
        {
            "name": name,
            "value": f"v1.{payload}.{signature}",
            "domain": AUTHORITY.rsplit(":", 1)[0],
            "path": "/",
            "httpOnly": True,
            "sameSite": "Strict",
        }
    ]


def open_page(mode: str = "light", settle_ms: int = 9000):
    """Open the live DSH desktop UI in a faithful color scheme.

    The color scheme is decided by the OFFICIAL boot chain: the ui-theme
    preference is `system`, so a fresh browser context's `color_scheme` drives
    `prefers-color-scheme` and the app flips `body[data-ds-dark-theme]` itself.
    Never toggle the attribute by hand — that produces a mixed state
    (html color-scheme stays light) and is not a faithful dark.
    """
    from playwright.sync_api import sync_playwright

    OUT.mkdir(parents=True, exist_ok=True)
    pw = sync_playwright().start()
    browser = pw.chromium.launch()
    context = browser.new_context(viewport=VIEWPORT, color_scheme=mode)
    context.add_cookies(session_cookie())
    page = context.new_page()
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_selector("#root", timeout=30_000)
    page.wait_for_timeout(settle_ms)
    page._dsh_pw = pw  # keep the driver alive for the caller
    return page
