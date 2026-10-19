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

"""Checks `updateComponents` against what it changes under deferred graph checks.

Under a validation config that allows dangling references, and orphans or a
missing root, a processor checks each batch against the components it changes.
These tests compare it with a processor that checks the whole surface on every
batch, which is what every processor did before.
"""

import random
from typing import Any

import pytest

from a2ui.core import MessageProcessor
from a2ui.core.basic_catalog import v0_8
from a2ui.core.catalog import Catalog
from a2ui.core.exceptions import A2uiError
from a2ui.core.processing import MessageProcessorOptions
from a2ui.core.validation import ValidationConfig

CATALOG = Catalog.from_json(
    {
        "catalogId": "custom",
        "components": {
            "Box": {
                "type": "object",
                "properties": {"children": {"$ref": "#/$defs/ChildList"}},
            },
            "Strict": {
                "type": "object",
                "allowedChildren": ["Item", "Box"],
                "properties": {"children": {"$ref": "#/$defs/ChildList"}},
            },
            "Card": {
                "type": "object",
                "properties": {"child": {"$ref": "#/$defs/ComponentId"}},
            },
            "Item": {
                "type": "object",
                "allowedParents": ["Strict", "Box", "Surface"],
            },
            "Header": {"type": "object", "allowedParents": ["Box"]},
            # A type with no reference fields, whose children are guessed from
            # its properties (the legacy v0.8 heuristic): `note` names a child
            # when it names a component the surface holds.
            "Leaf": {
                "type": "object",
                "properties": {"note": {"type": "string"}},
            },
        },
    },
    catalog_id="custom",
    protocol_version="v1.0",
)

IDS = ["root", "a", "b", "c", "d", "e", "f"]
TYPES = ["Box", "Strict", "Card", "Item", "Header", "Leaf"]

CONFIGS = {
    "missing_root_allowed": ValidationConfig(
        allow_dangling_references=True,
        allow_missing_root=True,
        allow_orphan_components=True,
    ),
    "orphans_allowed": ValidationConfig(
        allow_dangling_references=True,
        allow_orphan_components=True,
    ),
    "shallow": ValidationConfig(
        allow_dangling_references=True,
        allow_missing_root=True,
        max_depth=2,
    ),
}


def _component(rng: random.Random) -> dict[str, Any]:
    comp_id = rng.choice(IDS)
    comp_type = rng.choice(TYPES)
    comp: dict[str, Any] = {"id": comp_id, "component": comp_type}
    if comp_type in ("Box", "Strict"):
        comp["children"] = rng.sample(IDS, rng.randint(0, 3))
    elif comp_type == "Card":
        comp["child"] = rng.choice(IDS)
    elif comp_type == "Leaf" and rng.random() < 0.7:
        comp["note"] = rng.choice(IDS)
    return comp


def _batch(rng: random.Random) -> list[dict[str, Any]]:
    components: dict[str, dict[str, Any]] = {}
    for _ in range(rng.randint(1, 3)):
        comp = _component(rng)
        components[comp["id"]] = comp
    return list(components.values())


def _message(components: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "version": "v1.0",
        "updateComponents": {"surfaceId": "s1", "components": components},
    }


def _processor(config: ValidationConfig) -> MessageProcessor:
    processor = MessageProcessor(
        [CATALOG], options=MessageProcessorOptions(validation_config=config)
    )
    processor.process_messages([{
        "version": "v1.0",
        "createSurface": {"surfaceId": "s1", "catalogId": "custom"},
    }])
    return processor


def _whole_surface_processor(config: ValidationConfig) -> MessageProcessor:
    """A processor that checks every batch against the whole surface.

    The model is never told that a checked batch was applied, so it never
    starts a check from what the last one found.
    """
    processor = _processor(config)
    model = processor.model.get_surface("s1").components_model
    model.components_update_applied = lambda _: None  # type: ignore[method-assign]
    return processor


def _outcome(processor: MessageProcessor, message: dict[str, Any]) -> Any:
    try:
        processor.process_messages([message])
    except A2uiError as err:
        return (type(err).__name__, str(err))
    return None


def _components(processor: MessageProcessor) -> dict[str, Any]:
    model = processor.model.get_surface("s1").components_model
    return {comp_id: comp.component_tree for comp_id, comp in model.entries}


@pytest.mark.parametrize("config_name", sorted(CONFIGS))
@pytest.mark.parametrize("seed", range(40))
def test_matches_whole_surface_check(config_name: str, seed: int) -> None:
    """Each batch is accepted or rejected with the error a whole check gives."""
    config = CONFIGS[config_name]
    rng = random.Random(seed)
    incremental = _processor(config)
    whole = _whole_surface_processor(config)
    for step in range(30):
        message = _message(_batch(rng))
        expected = _outcome(whole, message)
        assert _outcome(incremental, message) == expected, (seed, step, message)
        assert _components(incremental) == _components(whole), (seed, step)


def test_cycle_through_existing_components_is_rejected() -> None:
    processor = _processor(CONFIGS["missing_root_allowed"])
    processor.process_messages([
        _message([{"id": "a", "component": "Box", "children": ["b"]}]),
        _message([{"id": "b", "component": "Box", "children": ["c"]}]),
    ])
    with pytest.raises(A2uiError, match="Circular reference"):
        processor.process_messages(
            [_message([{"id": "c", "component": "Box", "children": ["a"]}])]
        )
    assert "c" not in processor.model.get_surface("s1").components_model


def test_child_of_unallowed_type_is_rejected_when_it_arrives() -> None:
    processor = _processor(CONFIGS["missing_root_allowed"])
    processor.process_messages(
        [_message([{"id": "root", "component": "Strict", "children": ["a", "b"]}])]
    )
    processor.process_messages([_message([{"id": "a", "component": "Item"}])])
    with pytest.raises(A2uiError, match="cannot contain child 'b' \\(Leaf\\)"):
        processor.process_messages([_message([{"id": "b", "component": "Leaf"}])])


def test_depth_limit_holds_across_batches() -> None:
    processor = _processor(CONFIGS["shallow"])
    processor.process_messages([
        _message([{"id": "a", "component": "Box", "children": ["b"]}]),
        _message([{"id": "b", "component": "Box", "children": ["c"]}]),
    ])
    with pytest.raises(A2uiError, match="recursion limit"):
        processor.process_messages(
            [_message([{"id": "c", "component": "Card", "child": "d"}])]
            + [_message([{"id": "d", "component": "Box"}])]
        )


V08_CATALOG = v0_8.BasicCatalog()


def _v08_component(rng: random.Random) -> dict[str, Any]:
    comp_id = rng.choice(IDS)
    kind = rng.choice(["Column", "Row", "Card", "Text", "Text"])
    if kind in ("Column", "Row"):
        props: dict[str, Any] = {
            "children": {"explicitList": rng.sample(IDS, rng.randint(0, 3))}
        }
    elif kind == "Card":
        props = {"child": rng.choice(IDS)}
    else:
        props = {"text": {"literalString": rng.choice(IDS)}}
    return {"id": comp_id, "component": {kind: props}}


@pytest.mark.parametrize("seed", range(20))
def test_v08_matches_whole_surface_check(seed: int) -> None:
    """The same holds for v0.8 surfaces, whose references some types guess."""
    config = CONFIGS["missing_root_allowed"]
    begin = {
        "beginRendering": {
            "surfaceId": "s1",
            "catalogId": V08_CATALOG.catalog_id,
            "root": "root",
        }
    }

    def processor() -> MessageProcessor:
        proc = MessageProcessor(
            [V08_CATALOG], options=MessageProcessorOptions(validation_config=config)
        )
        proc.process_messages([begin])
        return proc

    rng = random.Random(seed)
    incremental = processor()
    whole = processor()
    model = whole.model.get_surface("s1").components_model
    model.components_update_applied = lambda _: None  # type: ignore[method-assign]
    for step in range(30):
        components = {c["id"]: c for c in (_v08_component(rng) for _ in range(2))}
        message = {
            "surfaceUpdate": {
                "surfaceId": "s1",
                "components": list(components.values()),
            }
        }
        expected = _outcome(whole, message)
        assert _outcome(incremental, message) == expected, (seed, step, message)
        assert _components(incremental) == _components(whole), (seed, step)
