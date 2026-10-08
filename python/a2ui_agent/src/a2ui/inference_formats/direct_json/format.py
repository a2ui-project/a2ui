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

"""Standard A2UI Direct JSON inference format coordination."""

from collections.abc import Collection, Sequence

from a2ui.core import CatalogApi
from a2ui.inference_format import InferenceFormat
from a2ui.inference_formats._shared import check_catalogs
from a2ui.inference_formats.direct_json.parser import DirectJsonParser
from a2ui.inference_formats.direct_json.prompt_generator import DirectJsonPromptGenerator
from a2ui.inference_formats.direct_json.streaming import DirectJsonStreamParser
from a2ui.schema.constants import DEFAULT_PROGRESSIVE_KEYS


class DirectJsonFormat(InferenceFormat):
    """Manages standard A2UI JSON schema responses and prompt injection (Direct JSON Format).

    The format works on catalogs that are already resolved for a renderer, for
    example the ones that `a2ui.utils.resolve_catalogs` returns. Selecting
    catalogs from renderer capabilities, adding inline catalogs and modifying
    or pruning catalog schemas all happen before the format is built.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        *,
        examples_path: str | None = None,
        progressive_keys: Collection[str] = DEFAULT_PROGRESSIVE_KEYS,
    ):
        """Initializes the DirectJsonFormat with resolved catalogs.

        Args:
            catalogs: The active catalogs. The prompt describes all of them, and
              the parsers hold all of them and resolve each component against
              the catalog that it or its surface names.
            examples_path: Optional directory or glob pattern of few-shot example
              files, which `a2ui.schema.load_examples` reads.
            progressive_keys: Keys whose string values the stream parsers heal
              when a chunk cuts them. An empty set turns healing off.

        Raises:
            TypeError: If `catalogs` is not a sequence of catalogs.
            A2uiCatalogError: If no catalog is given, two catalogs share a
              catalog ID, or the catalogs target different protocol versions.
        """
        self._catalogs = check_catalogs(catalogs)
        self._examples_path = examples_path
        self._progressive_keys = frozenset(progressive_keys)
        self._parser: DirectJsonParser | None = None
        self._prompt_generator: DirectJsonPromptGenerator | None = None

    @property
    def prompt_generator(self) -> DirectJsonPromptGenerator:
        """The prompt generator instance configured for this Direct JSON format."""
        if self._prompt_generator is None:
            self._prompt_generator = DirectJsonPromptGenerator(self)
        return self._prompt_generator

    @property
    def parser(self) -> DirectJsonParser:
        """The parser instance configured for this Direct JSON format."""
        if self._parser is None:
            self._parser = DirectJsonParser(
                self._catalogs,
                progressive_keys=self._progressive_keys,
            )
        return self._parser

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the active catalogs, in the order the format received them."""
        return list(self._catalogs)

    @property
    def examples_path(self) -> str | None:
        """The directory or glob pattern of few-shot example files, if any."""
        return self._examples_path

    def create_stream_parser(self) -> DirectJsonStreamParser:
        """Creates a streaming parser configured by this format.

        The parser heals this format's progressive keys and checks each
        message the way a renderer holding the catalogs would.

        Returns:
            A new streaming parser.
        """
        return DirectJsonStreamParser(
            self._catalogs,
            progressive_keys=self._progressive_keys,
        )
