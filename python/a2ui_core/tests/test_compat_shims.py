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

"""Tests for deprecated v0.1 module compatibility shims."""

from __future__ import annotations

import importlib
import inspect
import sys
import warnings

import pytest

FULL_SHIMMED_MODULES: list[tuple[str, str]] = [
    (
        "a2ui.core.basic_catalog.components",
        "a2ui.core.basic_catalog.v0_9.components",
    ),
    (
        "a2ui.core.basic_catalog.function_apis",
        "a2ui.core.basic_catalog.v0_9.function_apis",
    ),
    (
        "a2ui.core.basic_catalog.function_impls",
        "a2ui.core.basic_catalog.v0_9.function_impls",
    ),
    (
        "a2ui.core.basic_catalog.styles",
        "a2ui.core.basic_catalog.v0_9.styles",
    ),
    (
        "a2ui.core.basic_catalog.expression_parser",
        "a2ui.core.expressions.expression_parser",
    ),
    (
        "a2ui.core.schema.client_capabilities",
        "a2ui.core.schema.v0_9.client_capabilities",
    ),
    (
        "a2ui.core.schema.client_to_server",
        "a2ui.core.schema.v0_9.client_to_server",
    ),
    (
        "a2ui.core.schema.constants",
        "a2ui.core.schema.v0_9.constants",
    ),
    (
        "a2ui.core.schema.server_to_client",
        "a2ui.core.schema.v0_9.server_to_client",
    ),
]


def _import_fresh_with_deprecation_check(old_module: str, new_module: str) -> object:
    parent_pkg = old_module.rpartition(".")[0]
    if parent_pkg:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            importlib.import_module(parent_pkg)

    sys.modules.pop(old_module, None)

    with pytest.deprecated_call(match=new_module) as record:
        old_mod = importlib.import_module(old_module)

    matching_warnings = [
        w
        for w in record.list
        if old_module in str(w.message) and new_module in str(w.message)
    ]
    assert len(matching_warnings) == 1
    return old_mod


@pytest.mark.parametrize(("old_module", "new_module"), FULL_SHIMMED_MODULES)
def test_compat_shim_warns_and_reexports(old_module: str, new_module: str) -> None:
    new_mod = importlib.import_module(new_module)
    old_mod = _import_fresh_with_deprecation_check(old_module, new_module)

    if hasattr(new_mod, "__all__"):
        public_names = set(new_mod.__all__)
    else:
        public_names = {
            name
            for name in dir(new_mod)
            if not name.startswith("_") and not inspect.ismodule(getattr(new_mod, name))
        }

    assert hasattr(old_mod, "__all__")
    assert set(getattr(old_mod, "__all__")) >= public_names
    for name in public_names:
        assert hasattr(old_mod, name), f"{old_module} missing {name}"
        assert getattr(old_mod, name) is getattr(new_mod, name)


def test_schema_constants_and_client_to_server_aliases() -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        constants = importlib.import_module("a2ui.core.schema.constants")
        client_to_server = importlib.import_module("a2ui.core.schema.client_to_server")

    assert constants.SPEC_VERSION == constants.PROTOCOL_VERSION
    assert constants.SPEC_VERSION_TYPE is constants.PROTOCOL_VERSION_TYPE
    assert constants.SPEC_BASE_URL == constants.PROTOCOL_BASE_URL

    assert client_to_server.A2uiClientError is client_to_server.A2uiRendererError
    assert (
        client_to_server.A2uiClientErrorMessage
        is client_to_server.A2uiRendererErrorMessage
    )


@pytest.mark.parametrize(
    "removed_module",
    [
        "a2ui.core.rendering",
        "a2ui.core.rendering.component_context",
        "a2ui.core.rendering.data_context",
        "a2ui.core.rendering.generic_binder",
        "a2ui.core.validating",
        "a2ui.core.validating.validator",
        "a2ui.core.validating.catalog_schema_validator",
        "a2ui.core.validating.integrity_checker",
        "a2ui.core.validating.topology_analyzer",
        "a2ui.core.state.node_graph",
        "a2ui.core.state.component_node",
        "a2ui.core.basic_catalog.locale_config",
        "a2ui.core.basic_catalog.operator_apis",
    ],
)
def test_removed_modules_are_not_shimmed(removed_module: str) -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        with pytest.raises(ModuleNotFoundError):
            importlib.import_module(removed_module)
