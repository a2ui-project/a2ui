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

"""The abstract base class for catalog transformers."""

from abc import ABC, abstractmethod

from a2ui.core import CatalogApi


class CatalogTransformer(ABC):
    """A rule applied to a catalog before it reaches a prompt or a validator.

    A transformer returns a new catalog and leaves the one it was given
    unchanged. Transformers are registered on a `CatalogConfig`, which applies
    them in order when it builds its catalog.
    """

    @abstractmethod
    def transform(self, catalog: CatalogApi) -> CatalogApi:
        """Returns the transformed catalog.

        Args:
            catalog: The catalog to transform. It is not modified.

        Returns:
            A new catalog.
        """
