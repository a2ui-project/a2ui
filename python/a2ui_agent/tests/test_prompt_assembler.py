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

"""Unit tests for `a2ui.prompt.assemble_instructions`."""

from __future__ import annotations

from typing import Any

import pytest

from a2ui.constants import EXAMPLES_HEADING
from a2ui.core import Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.inference_formats.express import ExpressFormat
from a2ui.prompt import PromptGenerator, assemble_instructions
from a2ui.skill import SkillGenerator


def _catalog(
    catalog_id: str, version: ProtocolVersion = ProtocolVersion.V0_9
) -> CatalogApi:
    return Catalog.from_json(
        {"catalogId": catalog_id, "components": {}}, protocol_version=version
    )


class _RecordingGenerator(PromptGenerator):
    """Renders each hook as a label and counts the calls."""

    def __init__(self, catalogs: list[CatalogApi], shared_examples: bool = False):
        self._catalogs = catalogs
        self._shared_examples = shared_examples
        self.calls = 0

    @property
    def catalogs(self) -> list[CatalogApi]:
        return list(self._catalogs)

    def generate_base_rules(self) -> str:
        self.calls += 1
        return "RULES"

    def generate_catalog_instructions(
        self, include_schema: bool = True, catalog: Any | None = None
    ) -> str:
        if catalog is None:
            return "ALL"
        return f"INST:{catalog.catalog_id}"

    def generate_examples(
        self, catalog: Any | None = None, validate: bool = False
    ) -> str:
        if self._shared_examples or catalog is None:
            return "EXAMPLES"
        return f"EX:{catalog.catalog_id}"


def test_generate_assembles_the_hooks_for_the_generators_catalogs():
    gen = _RecordingGenerator([_catalog("a"), _catalog("b")])

    assert gen.generate() == f"RULES\n\nALL\n\n{EXAMPLES_HEADING}EXAMPLES"
    assert assemble_instructions(gen) == gen.generate()


def test_other_catalogs_are_rendered_one_by_one():
    a, b, c = _catalog("a"), _catalog("b"), _catalog("c")
    gen = _RecordingGenerator([a, b])

    assert (
        assemble_instructions(gen, [b, c])
        == f"RULES\n\nINST:b\n\nINST:c\n\n{EXAMPLES_HEADING}EX:b\n\nEX:c"
    )


def test_examples_every_catalog_shares_are_added_once():
    a, c = _catalog("a"), _catalog("c")
    gen = _RecordingGenerator([a], shared_examples=True)

    text = assemble_instructions(gen, [a, c])

    assert text.count("EXAMPLES") == 1


def test_the_snippet_for_the_generators_own_catalogs_is_cached():
    a, b = _catalog("a"), _catalog("b")
    gen = _RecordingGenerator([a, b])

    gen.generate()
    gen.generate()
    assemble_instructions(gen, [a, b])
    assert gen.calls == 1

    # Other catalogs aren't cached, so the cache holds no catalog the
    # generator doesn't.
    assemble_instructions(gen, [b])
    assemble_instructions(gen, [b])
    assert gen.calls == 3


def test_a_generator_must_name_its_catalogs():
    class NoCatalogs(PromptGenerator):
        pass

    with pytest.raises(TypeError):
        NoCatalogs()  # type: ignore[abstract]


@pytest.mark.parametrize("make_format", [ExpressFormat, DirectJsonFormat])
@pytest.mark.parametrize("catalog_count", [1, 2])
def test_the_monolithic_skill_body_is_the_prompt_snippet(make_format, catalog_count):
    catalogs = [
        BasicCatalog(ProtocolVersion.V1_0),
        _catalog("https://a2ui.org/other", ProtocolVersion.V1_0),
    ]
    fmt = make_format(catalogs[:catalog_count])

    body = SkillGenerator(fmt).generate_skill().content

    assert body == fmt.prompt_generator.generate() + "\n"
