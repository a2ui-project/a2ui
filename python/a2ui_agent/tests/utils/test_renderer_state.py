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

"""Unit tests for `a2ui.utils.RendererState`."""

from __future__ import annotations

import copy
from typing import Any

import pytest

from a2ui.core import (
    A2uiCatalogError,
    A2uiIntegrityError,
    A2uiValidationError,
    Catalog,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.utils import RendererState, validate_payload

_BASIC = BasicCatalog("0.9")
_CREATE = {
    "version": "v0.9",
    "createSurface": {"surfaceId": "s", "catalogId": _BASIC.catalog_id},
}
_DELETE = {"version": "v0.9", "deleteSurface": {"surfaceId": "s"}}


def _update(*components: dict[str, Any], surface_id: str = "s") -> dict[str, Any]:
    return {
        "version": "v0.9",
        "updateComponents": {"surfaceId": surface_id, "components": list(components)},
    }


def _column(*children: str, component_id: str = "root") -> dict[str, Any]:
    return {"id": component_id, "component": "Column", "children": list(children)}


def _text(component_id: str, text: str = "Hi") -> dict[str, Any]:
    return {"id": component_id, "component": "Text", "text": text}


def _turn(state: RendererState, *messages: dict[str, Any]) -> None:
    """Applies one turn's messages and checks the trees they touch."""
    state.check_topology(state.apply(list(messages)))


def _component_ids(state: RendererState, surface_id: str = "s") -> set[str]:
    surface = state.get_surface(surface_id)
    assert surface is not None
    return set(surface.components_model.keys)


def _snapshot(state: RendererState) -> dict[str, Any]:
    """The surfaces a state holds, as plain data, to compare two states."""
    snapshot: dict[str, Any] = {}
    for surface_id in state.surface_ids:
        surface = state.get_surface(surface_id)
        assert surface is not None
        snapshot[surface_id] = (
            {c.id: (c.type, c.properties) for c in surface.components_model.values},
            surface.data_model.get("/"),
        )
    # A copy, since the state changes the objects it holds.
    return copy.deepcopy(snapshot)


# The first turn of a canvas: a root column showing one text.
_FIRST_TURN = [_CREATE, _update(_column("a"), _text("a"))]


def _canvas() -> RendererState:
    """A state holding a surface whose root column shows one text."""
    state = RendererState([_BASIC])
    _turn(state, *_FIRST_TURN)
    return state


def test_a_later_turn_may_reference_components_of_an_earlier_turn():
    state = _canvas()

    _turn(state, _update(_column("a", "b"), _text("b")))

    assert _component_ids(state) == {"root", "a", "b"}


def test_a_later_turn_rejects_a_reference_no_turn_sent():
    state = _canvas()
    payload = [_update(_column("a", "missing"))]

    # Checked on its own, the update may refer to anything the renderer holds.
    validate_payload([_BASIC], payload)
    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        _turn(state, *payload)


def test_a_later_turn_rejects_a_cycle_with_earlier_components():
    state = _canvas()

    with pytest.raises(A2uiValidationError, match="[Cc]ircular|[Cc]ycle"):
        state.apply(_update(_column("root", component_id="a")))


def test_a_later_turn_rejects_a_new_component_that_is_unreachable():
    state = _canvas()

    with pytest.raises(A2uiIntegrityError, match="'orphan' is not reachable"):
        _turn(state, _update(_text("orphan")))


def test_a_later_turn_may_leave_a_replaced_component_unreachable():
    """The protocol cannot remove one component, so replacing one detaches it."""
    state = _canvas()
    second_turn = _update(_column("b"), _text("b"))
    third_turn = _update(_text("b", "Still fine"))

    _turn(state, second_turn)
    _turn(state, third_turn)

    assert _component_ids(state) == {"root", "a", "b"}


def test_one_payload_may_not_add_a_component_it_leaves_unreachable():
    state = RendererState([_BASIC])

    with pytest.raises(A2uiIntegrityError, match="'a' is not reachable"):
        _turn(
            state,
            _CREATE,
            _update(_column("a"), _text("a")),
            _update(_column("b"), _text("b")),
        )


def test_creating_a_surface_twice_is_rejected():
    state = _canvas()

    with pytest.raises(A2uiIntegrityError, match="already exists"):
        state.apply(_CREATE)


def test_a_deleted_surface_may_be_created_again():
    state = _canvas()

    _turn(state, _DELETE)
    assert state.surface_ids == []
    _turn(state, _CREATE, _update(_text("root")))

    assert _component_ids(state) == {"root"}


def test_an_update_to_an_unknown_surface_is_rejected_by_default():
    state = RendererState([_BASIC])

    with pytest.raises(A2uiIntegrityError, match="Surface not found"):
        state.apply(_update(_column("a")))
    assert state.surface_ids == []


def test_apply_is_atomic():
    state = _canvas()
    before = _snapshot(state)

    with pytest.raises(A2uiValidationError):
        state.apply([
            _update(_text("a", "Changed"), _text("b")),
            _update({"id": "c", "component": "Unknown"}),
        ])

    assert _snapshot(state) == before
    assert _component_ids(state) == {"root", "a"}
    surface = state.get_surface("s")
    assert surface is not None
    component = surface.components_model.get("a")
    assert component is not None
    assert component.properties["text"] == "Hi"


def test_a_failed_transaction_restores_every_call_inside_it():
    state = RendererState([_BASIC])

    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        with state.transaction():
            state.apply([_CREATE, _update(_column("a"))])
            state.check_topology(["s"])

    assert state.surface_ids == []


def test_a_successful_transaction_keeps_its_calls():
    state = RendererState([_BASIC])

    with state.transaction():
        state.apply(_CREATE)
        state.apply(_update(_text("root")))

    assert _component_ids(state) == {"root"}


def test_v08_updates_before_begin_rendering_are_buffered():
    catalog = BasicCatalog("0.8")
    state = RendererState([catalog])
    update = {
        "surfaceUpdate": {
            "surfaceId": "s",
            "components": [{
                "id": "root",
                "component": {"Column": {"children": {"explicitList": ["t"]}}},
            }],
        }
    }
    begin = {"beginRendering": {"surfaceId": "s", "root": "root"}}

    touched = state.apply([update, begin])

    # The buffered update is checked once the surface begins rendering.
    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        state.check_topology(touched)


def test_v08_updates_buffered_in_an_earlier_turn_are_checked_on_begin_rendering():
    catalog = BasicCatalog("0.8")
    state = RendererState([catalog])
    text = {"Text": {"text": {"literalString": "Hi"}}}
    update = {
        "surfaceUpdate": {
            "surfaceId": "s",
            "components": [
                {
                    "id": "root",
                    "component": {"Column": {"children": {"explicitList": ["t"]}}},
                },
                {"id": "t", "component": text},
                {"id": "orphan", "component": text},
            ],
        }
    }
    begin = {"beginRendering": {"surfaceId": "s", "root": "root"}}

    # The surface is assumed until it begins rendering, so its tree isn't
    # checked yet.
    state.apply(update)

    with pytest.raises(A2uiIntegrityError, match="'orphan' is not reachable"):
        state.check_topology(state.apply(begin))


def _v08_update(*component_ids: str) -> dict[str, Any]:
    text = {"Text": {"text": {"literalString": "Hi"}}}
    return {
        "surfaceUpdate": {
            "surfaceId": "s",
            "components": [{"id": c, "component": text} for c in component_ids],
        }
    }


def test_v08_updates_still_buffered_when_the_response_is_checked_are_rejected():
    state = RendererState([BasicCatalog("0.8")])

    with pytest.raises(A2uiIntegrityError, match="no beginRendering"):
        state.check_topology(state.apply(_v08_update("root")))


def test_validate_payload_assumes_a_v08_surface_without_begin_rendering():
    validate_payload([BasicCatalog("0.8")], _v08_update("root"))


def test_a_rollback_restores_the_v08_buffer_and_placeholder():
    state = RendererState([BasicCatalog("0.8")])
    state.apply(_v08_update("root"))
    begin = {"beginRendering": {"surfaceId": "s", "root": "root"}}

    with pytest.raises(A2uiValidationError):
        with state.transaction():
            state.apply(begin)
            state.apply(_v08_update("a"))
            state.apply({
                "surfaceUpdate": {
                    "surfaceId": "s",
                    "components": [{"id": "x", "component": {"Unknown": {}}}],
                }
            })

    # The surface is a placeholder again, still waiting for beginRendering,
    # and the buffered update is applied again when it arrives.
    assert _component_ids(state) == {"root"}
    with pytest.raises(A2uiIntegrityError, match="no beginRendering"):
        state.check_topology(["s"])
    state.check_topology(state.apply(begin))
    assert _component_ids(state) == {"root"}


def test_catalogs_with_incompatible_versions_are_rejected():
    with pytest.raises(A2uiCatalogError, match="incompatible protocol versions"):
        RendererState([_BASIC, BasicCatalog("1.0")])


def test_a_newer_version_of_a_message_replaces_the_older_one():
    """A stream applies a message again each time it grows."""
    versions = [_update(_text("a", "Hel")), _update(_text("a", "Hello"))]
    every_version = _canvas()
    latest_only = _canvas()

    for version in versions:
        every_version.apply(version)
    latest_only.apply(versions[-1])

    assert _snapshot(every_version) == _snapshot(latest_only)


def test_a_rollback_restores_a_deleted_surface():
    state = _canvas()

    with pytest.raises(A2uiValidationError):
        with state.transaction():
            state.apply(_DELETE)
            state.apply(_update(_text("a")))

    assert _component_ids(state) == {"root", "a"}


def test_nested_rollbacks_restore_the_outer_snapshot():
    state = _canvas()

    with pytest.raises(A2uiValidationError):
        with state.transaction():
            # The inner `apply` changes `a` before it fails, so its rollback
            # restores the snapshot it shares with the outer transaction.
            with pytest.raises(A2uiValidationError):
                state.apply([
                    _update(_text("a", "Inner")),
                    _update({"id": "x", "component": "Unknown"}),
                ])
            state.apply(_update(_text("a", "Changed again")))
            state.apply(_update({"id": "y", "component": "Unknown"}))

    surface = state.get_surface("s")
    assert surface is not None
    component = surface.components_model.get("a")
    assert component is not None
    assert component.properties["text"] == "Hi"


def test_mark_checked_stops_holding_changed_components_against_checks():
    state = _canvas()
    state.apply(_update(_text("orphan")))

    state.mark_checked(["s"])

    state.check_topology(["s"])


def test_mark_checked_still_reports_a_dangling_reference():
    state = _canvas()
    state.apply(_update(_column("a", "missing")))

    state.mark_checked(["s"])

    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        state.check_topology(["s"])


def test_a_failed_inner_transaction_undoes_only_its_own_changes():
    state = _canvas()

    with state.transaction():
        state.apply(_update(_column("a", "b"), _text("b")))
        with pytest.raises(A2uiValidationError):
            with state.transaction():
                state.apply(_update(_text("a", "Inner")))
                state.apply(_update({"id": "x", "component": "Unknown"}))
        state.apply(_update(_text("c")))

    assert _component_ids(state) == {"root", "a", "b", "c"}
    surface = state.get_surface("s")
    assert surface is not None
    component = surface.components_model.get("a")
    assert component is not None
    assert component.properties["text"] == "Hi"


def test_a_rollback_restores_the_properties_of_a_component_updated_in_place():
    state = _canvas()
    surface = state.get_surface("s")
    assert surface is not None
    component = surface.components_model.get("a")
    assert component is not None

    with pytest.raises(A2uiValidationError):
        with state.transaction():
            state.apply(_update(_text("a", "Once")))
            state.apply(_update(_text("a", "Twice")))
            state.apply(_update({"id": "x", "component": "Unknown"}))

    # The update changed the same component object, which keeps its identity.
    assert surface.components_model.get("a") is component
    assert component.properties["text"] == "Hi"


def test_a_rollback_restores_a_component_replaced_by_another_type():
    state = _canvas()
    before = _snapshot(state)

    with pytest.raises(A2uiValidationError):
        with state.transaction():
            state.apply(_update({"id": "a", "component": "Divider"}))
            state.apply(_update({"id": "x", "component": "Unknown"}))

    assert _snapshot(state) == before
    # The restored component is checked like any other.
    _turn(state, _update(_text("a", "Again")))


def test_a_rollback_restores_a_surface_deleted_and_created_again():
    state = _canvas()
    data = {"version": "v0.9", "updateDataModel": {"surfaceId": "s", "value": {"n": 1}}}
    _turn(state, data)
    before = _snapshot(state)

    with pytest.raises(A2uiValidationError):
        with state.transaction():
            state.apply([_DELETE, _CREATE, _update(_text("root", "New"))])
            state.apply(_update({"id": "x", "component": "Unknown"}))

    assert _snapshot(state) == before
    # The restored surface still holds its tree for later turns.
    _turn(state, _update(_column("a", "b"), _text("b")))


def test_a_rollback_restores_the_data_model():
    state = _canvas()
    _turn(
        state,
        {
            "version": "v0.9",
            "updateDataModel": {"surfaceId": "s", "value": {"a": {"b": 1}, "l": [1]}},
        },
    )
    before = _snapshot(state)

    with pytest.raises(A2uiValidationError):
        with state.transaction():
            for path, value in [
                ("/a/b", 2),
                ("/a/new/deep", 3),
                ("/l/3", 4),
                ("/a", None),
            ]:
                state.apply({
                    "version": "v0.9",
                    "updateDataModel": {"surfaceId": "s", "path": path, "value": value},
                })
            state.apply(_update({"id": "x", "component": "Unknown"}))

    assert _snapshot(state) == before


def test_a_rollback_restores_what_check_topology_marked_checked():
    state = _canvas()
    state.apply(_update(_text("orphan")))

    with pytest.raises(A2uiValidationError):
        with state.transaction():
            # A surface whose new components are reachable is marked checked.
            state.apply(_update(_column("a", "orphan")))
            state.check_topology(["s"])
            state.apply(_update({"id": "x", "component": "Unknown"}))

    # The rollback restores both the parent that reached 'orphan' and the
    # record that 'orphan' was added since the last check.
    with pytest.raises(A2uiIntegrityError, match="'orphan' is not reachable"):
        state.check_topology(["s"])


def test_a_rollback_undoes_updates_made_before_the_surface_was_deleted():
    state = _canvas()
    before = _snapshot(state)

    with pytest.raises(A2uiValidationError):
        with state.transaction():
            state.apply(_update(_text("a", "Changed")))
            state.apply({
                "version": "v0.9",
                "updateDataModel": {"surfaceId": "s", "path": "/n", "value": 1},
            })
            state.apply(_DELETE)
            state.apply(_update(_text("a")))

    assert _snapshot(state) == before


def test_a_rollback_restores_each_components_own_catalog_on_a_deleted_surface():
    basic = BasicCatalog("1.0")
    items = Catalog.from_json(
        {
            "catalogId": "items",
            "components": {
                "Item": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "component": {"const": "Item"},
                        "label": {"type": "string"},
                    },
                    "required": ["id", "component"],
                }
            },
        },
        protocol_version="v1.0",
        catalog_id="items",
    )
    state = RendererState([basic, items])
    _turn(
        state,
        {
            "version": "v1.0",
            "createSurface": {"surfaceId": "s", "catalogId": basic.catalog_id},
        },
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [
                    {"id": "root", "component": "Column", "children": ["i"]},
                    {"id": "i", "component": "Item", "catalogId": "items"},
                ],
            },
        },
    )

    with pytest.raises(A2uiValidationError):
        with state.transaction():
            state.apply({"version": "v1.0", "deleteSurface": {"surfaceId": "s"}})
            state.apply(_update(_text("a")))

    surface = state.get_surface("s")
    assert surface is not None
    item = surface.components_model.get("i")
    assert item is not None
    assert item.catalog is not None and item.catalog.catalog_id == "items"
    root = surface.components_model.get("root")
    assert root is not None and root.catalog.catalog_id == basic.catalog_id
