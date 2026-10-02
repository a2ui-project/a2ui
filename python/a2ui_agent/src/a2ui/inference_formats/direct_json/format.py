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

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.common import to_protocol_version
from a2ui.inference_format import InferenceFormat
from a2ui.inference_formats.direct_json._parser_catalogs import (
    supports_multiple_catalogs,
)
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
            catalogs: The active catalogs. The prompt describes all of them.
              From v1.0 on, the parsers hold all of them and resolve each
              component against the catalog that it or its surface names.
              Before v1.0, a parser holds a single catalog, so the parsers
              validate against the first one.
            examples_path: Optional directory or glob pattern of few-shot example
              files, which `a2ui.schema.load_examples` reads.
            progressive_keys: Keys whose string values the stream parsers heal
              when a chunk cuts them. An empty set turns healing off.

        Raises:
            A2uiCatalogError: If no catalog is given, or the catalogs target
              different protocol versions.
        """
        if isinstance(catalogs, (str, bytes)) or not isinstance(catalogs, Sequence):
            raise A2uiCatalogError(
                "The Direct JSON format takes a sequence of catalogs, got"
                f" {type(catalogs).__name__}."
            )
        if not catalogs:
            raise A2uiCatalogError("The Direct JSON format needs at least one catalog.")
        versions = {to_protocol_version(c.protocol_version) for c in catalogs}
        if len(versions) > 1:
            raise A2uiCatalogError(
                "The Direct JSON format's catalogs target different protocol"
                f" versions: {sorted(v.value for v in versions)}."
            )
        self._catalogs = tuple(catalogs)
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
                self._catalogs_for_parser(),
                progressive_keys=self._progressive_keys,
            )
        return self._parser

    @property
    def catalogs(self) -> tuple[CatalogApi, ...]:
        """The active catalogs, in the order the format received them."""
        return self._catalogs

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
            self._catalogs_for_parser(),
            progressive_keys=self._progressive_keys,
        )

    def _catalogs_for_parser(self) -> Sequence[CatalogApi]:
        """Returns the catalogs that a parser for this format may hold."""
        if supports_multiple_catalogs(self._catalogs[0].protocol_version):
            return self._catalogs
        return self._catalogs[:1]
