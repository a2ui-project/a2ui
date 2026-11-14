"""Shared setup for the A2UI JupyterLab example notebooks.

Import this module from a notebook or script to check that the renderer
bundle is built and to create surfaces that use the v1.0 basic catalog::

    from renderer_setup import new_surface

    surface = new_surface("my-surface")
    surface.send([...])
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import a2ui_jupyter
from a2ui_jupyter import A2UISurface

BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"

_WIDGET_BUNDLE = Path(a2ui_jupyter.__file__).parent / "static" / "widget.js"


def ensure_renderer_bundle() -> Path:
    """Return the path to the built renderer bundle or raise if it is missing."""
    if not _WIDGET_BUNDLE.is_file():
        raise RuntimeError(
            f"A2UI renderer bundle not found at {_WIDGET_BUNDLE}. "
            "Build it with `corepack yarn workspace @a2ui/jupyter build` "
            "from the repository root, then run `uv sync --all-packages`."
        )
    return _WIDGET_BUNDLE


def new_surface(
    surface_id: str,
    *,
    send_data_model: bool = False,
    **widget_kwargs: Any,
) -> A2UISurface:
    """Create an ``A2UISurface`` and send ``createSurface`` for the basic catalog.

    Set ``send_data_model`` to have the browser send the data model back with
    each action.
    """
    ensure_renderer_bundle()
    surface = A2UISurface(**widget_kwargs)
    create = {
        "surfaceId": surface_id,
        "catalogId": BASIC_CATALOG_ID,
    }
    if send_data_model:
        create["sendDataModel"] = True
    surface.send({"version": "1.0", "createSurface": create})
    return surface
