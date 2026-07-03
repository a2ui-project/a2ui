# Copyright 2026 Google LLC
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
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from json.decoder import JSONDecodeError
from typing import Any, Dict
from .constants import ENCODING


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
        return json.load(f)
    except (FileNotFoundError, JSONDecodeError) as e:
      raise IOError(f"Could not load schema from {self.path}: {e}") from e


class HttpCatalogProvider(A2uiCatalogProvider):
  """Loads catalog definition from an HTTP or HTTPS URL."""

  def __init__(self, url: str, timeout: float = 30.0):
    self.url = url
    self.timeout = timeout

  def load(self) -> Dict[str, Any]:
    try:
      request = urllib.request.Request(self.url, headers={"Accept": "application/json"})
      with urllib.request.urlopen(request, timeout=self.timeout) as response:
        charset = response.headers.get_content_charset() or ENCODING
        body = response.read().decode(charset)
      return json.loads(body)
    except (urllib.error.URLError, ValueError, LookupError) as e:
      raise IOError(f"Could not load schema from {self.url}: {e}") from e
