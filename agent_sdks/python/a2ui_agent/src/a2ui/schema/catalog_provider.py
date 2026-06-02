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
