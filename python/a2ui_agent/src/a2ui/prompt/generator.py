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

"""Abstract prompt generator interface for inference formats."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence
from typing import Any, final
import weakref

from a2ui.constants import EXAMPLES_HEADING
from a2ui.core import CatalogApi

__all__ = [
    "PromptGenerator",
    "assemble_instructions",
]


class PromptGenerator(ABC):
    """Abstract base class for inference format prompt generators.

    A format implements the three hooks, `generate_base_rules`,
    `generate_catalog_instructions` and `generate_examples`, and the `catalogs`
    property. `generate()` and `SkillGenerator` both assemble the hooks' output
    with `assemble_instructions`, so a prompt snippet and a monolithic skill
    for the same catalogs have the same body. Formats override the hooks, never
    `generate()`.

    A generator is treated as immutable once built: the assembled text is
    cached per generator and set of catalogs.
    """

    @property
    @abstractmethod
    def catalogs(self) -> list[CatalogApi]:
        """The catalogs the generator describes, in order."""

    def generate_base_rules(self) -> str:
        """Returns the core syntax contract and grammar rules for the inference format."""
        return ""

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: Any | None = None,
    ) -> str:
        """Returns component and function signatures or JSON schemas for a catalog.

        With no catalog, returns the instructions for every catalog in
        `catalogs`, which must be the catalogs' own instructions joined by a
        blank line.
        """
        return ""

    def generate_examples(
        self,
        catalog: Any | None = None,
        validate: bool = False,
    ) -> str:
        """Returns formatted few-shot examples for a catalog."""
        return ""

    @final
    def generate(self) -> str:
        """Returns the prompt snippet for all of the generator's catalogs.

        This is `assemble_instructions(self)`. Formats override the hooks,
        never this method.
        """
        return assemble_instructions(self)


_cache: weakref.WeakKeyDictionary[
    PromptGenerator, dict[tuple[int, ...], tuple[tuple[CatalogApi, ...], str]]
] = weakref.WeakKeyDictionary()


def assemble_instructions(
    generator: PromptGenerator,
    catalogs: Sequence[CatalogApi] | None = None,
) -> str:
    """Assembles a generator's hooks into the instructions for some catalogs.

    The text is the base rules, then the catalog instructions, then the
    examples under `EXAMPLES_HEADING`, separated by blank lines. Sections that
    render nothing are left out.

    For the generator's own catalogs, the catalog instructions and examples
    come from one call each to `generate_catalog_instructions()` and
    `generate_examples()`, so a format can render what its catalogs share once.
    For any other catalogs, each catalog's instructions and examples are
    rendered on their own and joined; a format whose examples aren't kept per
    catalog returns the same examples for each catalog, so examples a catalog
    repeats are added once.

    `PromptGenerator.generate()` returns this for all of the generator's
    catalogs, and `SkillGenerator.generate_skill()` uses it for the body of a
    monolithic skill.

    Args:
      generator: The prompt generator whose hooks render the sections.
      catalogs: The catalogs to describe, in order. Defaults to the
        generator's `catalogs`.

    Returns:
      The assembled text, cached per generator and catalogs.
    """
    own_catalogs = tuple(generator.catalogs)
    targets = own_catalogs if catalogs is None else tuple(catalogs)
    key = tuple(id(c) for c in targets)
    try:
        per_generator = _cache.setdefault(generator, {})
    except TypeError:
        # A generator that can't be weakly referenced isn't cached.
        per_generator = {}
    cached = per_generator.get(key)
    if cached is not None:
        return cached[1]

    parts: list[str] = []
    base_rules = generator.generate_base_rules()
    if base_rules:
        parts.append(base_rules)

    examples: list[str] = []
    if _same_catalogs(targets, own_catalogs):
        instructions = generator.generate_catalog_instructions()
        if instructions:
            parts.append(instructions)
        all_examples = generator.generate_examples()
        if all_examples:
            examples.append(all_examples)
    else:
        for catalog in targets:
            instructions = generator.generate_catalog_instructions(catalog=catalog)
            if instructions:
                parts.append(instructions)
            catalog_examples = generator.generate_examples(catalog=catalog)
            if catalog_examples and catalog_examples not in examples:
                examples.append(catalog_examples)
    if examples:
        parts.append(EXAMPLES_HEADING + "\n\n".join(examples))

    text = "\n\n".join(parts)
    # The catalogs are kept with the text so their ids can't be reused while
    # the entry exists.
    per_generator[key] = (targets, text)
    return text


def _same_catalogs(a: Sequence[CatalogApi], b: Sequence[CatalogApi]) -> bool:
    """Whether two catalog sequences hold the same catalog objects in order."""
    return len(a) == len(b) and all(x is y for x, y in zip(a, b))
