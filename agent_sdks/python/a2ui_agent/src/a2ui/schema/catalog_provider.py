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

"""Module for providing A2UI catalog schemas and resources."""

import json
import logging
import urllib.request
from abc import ABC, abstractmethod
from json.decoder import JSONDecodeError
from typing import Any, Dict, cast
from urllib.error import URLError
from .constants import ENCODING

logger = logging.getLogger(__name__)


class A2uiCatalogProvider(ABC):
    """Abstract base class for providing A2UI schemas and catalogs."""

    @abstractmethod
    def load(self) -> Dict[str, Any]:
        """Loads a catalog definition.

        Returns:
          The loaded catalog as a dictionary.
        """
        pass


class FileSystemCatalogProvider(A2uiCatalogProvider):
    """Loads catalog definition from the local filesystem."""

    def __init__(self, path: str):
        self.path = path

    def load(self) -> Dict[str, Any]:
        try:
            with open(self.path, "r", encoding=ENCODING) as f:
                return cast(Dict[str, Any], json.load(f))
        except (FileNotFoundError, JSONDecodeError) as e:
            raise IOError(f"Could not load schema from {self.path}: {e}") from e


class HttpCatalogProvider(A2uiCatalogProvider):
    """Loads catalog definition from a remote HTTP/HTTPS URL."""

    def __init__(self, url: str):
        self.url = url

    def load(self) -> Dict[str, Any]:
        try:
            req = urllib.request.Request(
                self.url, headers={"User-Agent": "A2UI-Agent-SDK/1.0"}
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                content_type = response.headers.get("Content-Type", "").split(";")[0].strip()
                recognized_types = ("application/json", "application/agent-plugin+json")
                if content_type and content_type not in recognized_types:
                    logger.warning(
                        f"Response Content-Type '{content_type}' is not a recognized "
                        "catalog entry type (expected 'application/json' or "
                        "'application/agent-plugin+json')."
                    )
                return cast(Dict[str, Any], json.loads(response.read().decode(ENCODING)))
        except Exception as e:
            raise IOError(f"Could not load schema from {self.url}: {e}") from e
