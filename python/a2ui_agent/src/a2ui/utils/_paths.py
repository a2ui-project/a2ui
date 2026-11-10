# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Internal helper that turns a path or `file://` URL into a local path."""

from __future__ import annotations

from urllib.parse import urlparse
from urllib.request import url2pathname

from a2ui.core import A2uiCatalogError


def to_local_path(path: str, *, kind: str) -> str:
    """Returns the local filesystem path that `path` names.

    `path` is either a filesystem path or a `file://` URL. A Windows path such
    as `C:/catalogs/basic.json` parses with the drive letter as its URL scheme,
    so a single-letter scheme is read as a drive, not a URL. A `file://` URL is
    decoded with `url2pathname`, which also drops the slash before a Windows
    drive (`file:///C:/x` becomes `C:\\x`).

    Args:
        path: A filesystem path or a `file://` URL.
        kind: What the path points at, such as `"catalog"`, used in the error
            message.

    Returns:
        The local filesystem path.

    Raises:
        A2uiCatalogError: If `path` is a URL with a scheme other than `file`.
    """
    parsed = urlparse(path)
    scheme = parsed.scheme
    if not scheme or (len(scheme) == 1 and scheme.isalpha()):
        return path
    if scheme != "file":
        raise A2uiCatalogError(f"Unsupported {kind} URL scheme '{scheme}' in '{path}'.")
    return url2pathname(parsed.path)
