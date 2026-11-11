# Copyright 2026 Light Huska
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

import copy
from typing import Any

import pytest

from a2ui.core import A2uiDataError, DataModel


@pytest.mark.parametrize(
    ("initial", "path"),
    [
        ({}, "/items/10001"),
        ({}, "/items/10001/name"),
        ({}, "/outer/items/10001/name"),
        ({"items": None}, "/items/10001/name"),
        ({"items": []}, "/items/2/values/10001"),
        ({"items": [None]}, "/items/0/values/10001"),
        ({"items": [{"values": None}]}, "/items/0/values/10001"),
        ({}, "/new/0/nested/10001"),
    ],
)
def test_rejected_write_preserves_data_and_observers(
    initial: dict[str, Any], path: str
) -> None:
    model = DataModel(initial)
    original_root = model.get("/")
    snapshot = copy.deepcopy(original_root)
    notifications: list[Any] = []
    subscription = model.subscribe("/", notifications.append)

    with pytest.raises(A2uiDataError, match="exceeds maximum supported index"):
        model.set(path, "value")

    assert model.get("/") == snapshot
    assert model.get("/") is original_root
    assert notifications == []
    assert initial == snapshot

    model.set("/valid", True)
    assert notifications == [{**snapshot, "valid": True}]
    subscription.unsubscribe()


def test_existing_dictionary_numeric_keys_are_not_array_indices() -> None:
    model = DataModel({"items": {"10001": {}}})
    model.set("/items/10001/name", "value")
    assert model.get("/") == {"items": {"10001": {"name": "value"}}}


def test_maximum_supported_array_index_remains_valid() -> None:
    model = DataModel()
    model.set("/items/10000/name", "value")
    assert model.get("/items/10000/name") == "value"
    assert len(model.get("/items")) == 10001


def test_deleting_missing_deep_path_remains_a_noop() -> None:
    model = DataModel({"items": []})
    model.delete("/items/2/values/10001")
    assert model.get("/") == {"items": []}
