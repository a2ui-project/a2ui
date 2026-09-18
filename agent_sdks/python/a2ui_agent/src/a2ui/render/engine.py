# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Headless rendering engine for A2UI payloads using Playwright and Chromium."""

from __future__ import annotations

import argparse
import glob
import json
import os
from pathlib import Path
import shutil
import sys
from typing import Any, Sequence

from playwright.sync_api import Error as PlaywrightError, TimeoutError as PlaywrightTimeoutError, sync_playwright


class A2uiRenderError(Exception):
    """Exception raised when rendering an A2UI payload fails."""


def resolve_chromium_binary() -> str | None:
    """Resolves an executable Chromium/Chrome binary across common system paths.

    Returns the absolute path to an existing executable binary, or None to let
    Playwright use its default driver executable.
    """
    env_bin = os.environ.get("A2UI_CHROME_BIN")
    if env_bin and os.path.isfile(env_bin) and os.access(env_bin, os.X_OK):
        return env_bin

    known_system_paths = [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/opt/google/chrome/chrome",
    ]
    for p in known_system_paths:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p

    for name in (
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
    ):
        which_path = shutil.which(name)
        if which_path and os.path.isfile(which_path) and os.access(which_path, os.X_OK):
            return which_path

    # Check cached Playwright browsers
    cache_patterns = [
        os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome"),
        os.path.expanduser(
            "~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell"
        ),
    ]
    for pattern in cache_patterns:
        matches = sorted(glob.glob(pattern), reverse=True)
        for match in matches:
            if os.path.isfile(match) and os.access(match, os.X_OK):
                return match

    return None


def get_harness_path() -> Path:
    """Locates the standalone harness.html bundled with the package."""
    current_dir = Path(__file__).resolve().parent

    candidate_locations = [
        current_dir.parent / "assets" / "render" / "harness.html",
        current_dir / "bundle" / "harness.html",
        current_dir / "harness.html",
    ]

    for candidate in candidate_locations:
        if candidate.is_file():
            return candidate

    # Search in source tree if run from repo
    repo_root = current_dir
    for _ in range(5):
        harness = (
            repo_root
            / "agent_sdks"
            / "python"
            / "a2ui_agent"
            / "src"
            / "a2ui"
            / "assets"
            / "render"
            / "harness.html"
        )
        if harness.is_file():
            return harness
        repo_root = repo_root.parent

    raise A2uiRenderError(
        f"A2UI harness.html not found. Checked: {[str(c) for c in candidate_locations]}"
    )


def _normalize_payload(payload: Any) -> list[dict[str, Any]]:
    """Normalizes various payload input representations into a list of messages."""
    if isinstance(payload, (str, Path, os.PathLike)):
        path_str = str(payload)
        is_json_string = path_str.strip().startswith(("{", "["))

        if not is_json_string:
            if not os.path.isfile(path_str):
                raise A2uiRenderError(f"Payload file not found: '{path_str}'")
            try:
                with open(path_str, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                raise A2uiRenderError(
                    f"Failed to read payload file '{path_str}': {e}"
                ) from e
        else:
            try:
                data = json.loads(path_str)
            except json.JSONDecodeError as e:
                raise A2uiRenderError(f"Malformed payload JSON: {e}") from e
    else:
        data = payload

    if isinstance(data, list):
        if not data:
            raise A2uiRenderError("Payload cannot be an empty message list")
        return data
    elif isinstance(data, dict):
        if "messages" in data and isinstance(data["messages"], list):
            if not data["messages"]:
                raise A2uiRenderError("Payload messages list is empty")
            return data["messages"]
        return [data]
    else:
        raise A2uiRenderError(f"Unsupported payload type: {type(data).__name__}")


class HeadlessRenderEngine:
    """Manages a headless Chromium session for fast, multi-shot A2UI rendering."""

    def __init__(
        self,
        executable_path: str | None = None,
        default_width: int = 800,
        default_height: int = 600,
    ) -> None:
        self.executable_path = executable_path or resolve_chromium_binary()
        self.default_width = default_width
        self.default_height = default_height
        self._playwright = None
        self._browser = None
        self._harness_path = get_harness_path()

    def __enter__(self) -> HeadlessRenderEngine:
        self.start()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()

    def start(self) -> None:
        """Starts Playwright and launches the headless Chromium browser."""
        if self._browser is not None:
            return

        self._playwright = sync_playwright().start()
        launch_kwargs: dict[str, Any] = {
            "headless": True,
            "args": [
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--allow-file-access-from-files",
            ],
        }
        if self.executable_path:
            launch_kwargs["executable_path"] = self.executable_path

        try:
            self._browser = self._playwright.chromium.launch(**launch_kwargs)
        except Exception as e:
            self.close()
            raise A2uiRenderError(f"Failed to launch Chromium: {e}") from e

    def close(self) -> None:
        """Closes browser and stops Playwright."""
        if self._browser is not None:
            try:
                self._browser.close()
            except Exception:
                pass
            self._browser = None

        if self._playwright is not None:
            try:
                self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

    def render(
        self,
        payload: Any,
        out_path: str | os.PathLike | None = None,
        width: int | None = None,
        height: int | None = None,
        catalog_id: str | None = None,
        timeout_seconds: float = 15.0,
    ) -> bytes:
        """Renders an A2UI payload to PNG bytes, optionally writing to out_path."""
        if self._browser is None:
            self.start()

        messages = _normalize_payload(payload)

        w = width or self.default_width
        h = height or self.default_height

        context = None
        page = None
        effective_timeout_sec = max(0.05, float(timeout_seconds))
        timeout_ms = max(1, int(float(timeout_seconds) * 1000))
        nav_timeout_ms = max(5000, timeout_ms)

        try:
            context = self._browser.new_context(viewport={"width": w, "height": h})
            page = context.new_page()
            page.set_default_timeout(nav_timeout_ms)

            # Load harness file
            harness_url = self._harness_path.as_uri()
            page.goto(harness_url, timeout=nav_timeout_ms)
            page.wait_for_function(
                "() => window.__A2UI_READY__ === true", timeout=nav_timeout_ms
            )

            # Invoke renderA2UIPayload in JS context
            render_opts = {
                "width": w,
                "height": h,
                "catalogId": catalog_id,
                "timeoutMs": timeout_ms,
            }
            res = page.evaluate(
                "([payload, options]) => window.renderA2UIPayload(payload, options)",
                [messages, render_opts],
            )

            if not isinstance(res, dict):
                raise A2uiRenderError(
                    f"Render harness returned unexpected result: {res}"
                )

            if not res.get("success"):
                err_msg = res.get("error", "Unknown render error")
                if "timed out" in err_msg.lower():
                    raise A2uiRenderError(f"Rendering timed out: {err_msg}")
                raise A2uiRenderError(f"Rendering failed: {err_msg}")

            png_bytes = page.screenshot(full_page=False, timeout=nav_timeout_ms)

            if out_path:
                out_p = Path(out_path)
                out_p.parent.mkdir(parents=True, exist_ok=True)
                out_p.write_bytes(png_bytes)

            return png_bytes

        except PlaywrightTimeoutError as e:
            raise A2uiRenderError(
                f"Rendering timed out after {timeout_seconds} seconds"
            ) from e
        except PlaywrightError as e:
            raise A2uiRenderError(f"Playwright error during rendering: {e}") from e
        finally:
            if page is not None:
                try:
                    page.close()
                except Exception:
                    pass
            if context is not None:
                try:
                    context.close()
                except Exception:
                    pass


def render_payload_to_png(
    payload: Any,
    out_path: str | os.PathLike | None = None,
    width: int = 800,
    height: int = 600,
    catalog_id: str | None = None,
    timeout_seconds: float = 15.0,
) -> bytes:
    """Renders an A2UI payload to PNG bytes using a headless Chromium browser.

    Args:
        payload: A2UI payload as a dict, list of messages, JSON string, or file path.
        out_path: Optional file path where the PNG will be saved.
        width: Viewport width in pixels (default 800).
        height: Viewport height in pixels (default 600).
        catalog_id: Optional catalog identifier override.
        timeout_seconds: Maximum time in seconds to wait for settling (default 15.0).

    Returns:
        bytes: The rendered PNG image data.

    Raises:
        A2uiRenderError: If the payload is malformed, rendering times out, or a browser error occurs.
    """
    with HeadlessRenderEngine(default_width=width, default_height=height) as engine:
        return engine.render(
            payload=payload,
            out_path=out_path,
            width=width,
            height=height,
            catalog_id=catalog_id,
            timeout_seconds=timeout_seconds,
        )


def render_cli(argv: Sequence[str] | None = None) -> int:
    """CLI handler for `a2ui render <payload.json> --png <out.png>`."""
    parser = argparse.ArgumentParser(
        prog="a2ui render",
        description=(
            "Render an A2UI JSON payload to a PNG snapshot using headless Chromium."
        ),
    )
    parser.add_argument(
        "payload", help="Path to A2UI JSON payload file, or raw JSON string."
    )
    parser.add_argument(
        "--png", required=True, help="Destination path for output PNG image."
    )
    parser.add_argument(
        "--width",
        type=int,
        default=800,
        help="Viewport width in pixels (default: 800).",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=600,
        help="Viewport height in pixels (default: 600).",
    )
    parser.add_argument(
        "--catalog", dest="catalog_id", default=None, help="Catalog ID override."
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=15.0,
        help="Settling timeout in seconds (default: 15).",
    )

    args = parser.parse_args(argv)

    try:
        render_payload_to_png(
            payload=args.payload,
            out_path=args.png,
            width=args.width,
            height=args.height,
            catalog_id=args.catalog_id,
            timeout_seconds=args.timeout,
        )
        print(f"Rendered snapshot saved to {args.png} ({args.width}x{args.height})")
        return 0
    except A2uiRenderError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(render_cli())
