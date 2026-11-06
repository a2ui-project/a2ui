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

from __future__ import annotations

import os
import pathlib
import sys
from unittest import mock

import jsonschema
import pytest

# Add the script's directory to the path so the test can import it.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from validate_doc_examples import (
    V0_9_1,
    V1_0,
    _errors_for,
    extract_examples_from_text,
    main,
    validate,
    version_for_label,
)

DOC = pathlib.Path("doc.md")

V10_TEXT = """
{
  "version": "1.0",
  "updateComponents": {
    "surfaceId": "s",
    "components": [{"id": "root", "component": "Text", "text": {"@path": "/name"}}]
  }
}
"""

V091_TEXT = """
{
  "version": "v0.9",
  "updateComponents": {
    "surfaceId": "s",
    "components": [{"id": "root", "component": "Text", "text": {"path": "/name"}}]
  }
}
"""


def _indent(text: str, prefix: str) -> str:
    return "\n".join(
        prefix + line if line else line for line in text.strip().splitlines()
    )


def _mkdocs_tabs(v10: str, v091: str) -> str:
    return (
        '=== "v1.0"\n\n    ```json\n'
        + _indent(v10, "    ")
        + '\n    ```\n\n=== "v0.9.1"\n\n    ```json\n'
        + _indent(v091, "    ")
        + "\n    ```\n\nAfter the tabs.\n"
    )


def _astro_tabs(v10: str, v091: str) -> str:
    return (
        '<Tabs syncKey="protocol-version">\n  <TabItem label="v1.0">\n\n```json\n'
        + v10.strip()
        + '\n```\n\n  </TabItem>\n  <TabItem label="v0.9.1">\n\n```json\n'
        + v091.strip()
        + "\n```\n\n  </TabItem>\n</Tabs>\n"
    )


@pytest.mark.parametrize(
    "label, expected",
    [
        ("v1.0", V1_0),
        ("v0.9.1", V0_9_1),
        ("v0.9", V0_9_1),
        ("v0.9 — `createSurface`", V0_9_1),
        ("v0.8", None),
        ("Python", None),
    ],
)
def test_version_for_label(label: str, expected: str | None) -> None:
    assert version_for_label(label) == expected


def test_extracts_mkdocs_tabs() -> None:
    examples = extract_examples_from_text(DOC, _mkdocs_tabs(V10_TEXT, V091_TEXT))
    assert [e.tab_label for e in examples] == ["v1.0", "v0.9.1"]
    assert all(validate(e) == [] for e in examples)


def test_extracts_astro_tabs() -> None:
    examples = extract_examples_from_text(DOC, _astro_tabs(V10_TEXT, V091_TEXT))
    assert [e.tab_label for e in examples] == ["v1.0", "v0.9.1"]
    assert all(validate(e) == [] for e in examples)


def test_mkdocs_tab_ends_at_dedent() -> None:
    text = (
        _mkdocs_tabs(V10_TEXT, V091_TEXT) + "\n```json\n" + V10_TEXT.strip() + "\n```\n"
    )
    examples = extract_examples_from_text(DOC, text)
    assert examples[-1].tab_label is None
    assert validate(examples[-1]) == []


def test_reports_v10_syntax_in_v091_tab() -> None:
    examples = extract_examples_from_text(
        DOC, _mkdocs_tabs(V10_TEXT, V10_TEXT.replace('"1.0"', '"v0.9"'))
    )
    assert validate(examples[0]) == []
    assert validate(examples[1]) != []


def test_reports_v091_syntax_in_v10_tab() -> None:
    examples = extract_examples_from_text(
        DOC, _astro_tabs(V091_TEXT.replace('"v0.9"', '"1.0"'), V091_TEXT)
    )
    assert validate(examples[0]) != []
    assert validate(examples[1]) == []


def test_reports_unknown_basic_catalog_property() -> None:
    bad = V10_TEXT.replace(
        '"text": {"@path": "/name"}', '"text": "Hi", "colour": "red"'
    )
    examples = extract_examples_from_text(DOC, "```json\n" + bad.strip() + "\n```\n")
    assert validate(examples[0]) != []


def test_accepts_components_from_other_catalogs() -> None:
    custom = V10_TEXT.replace(
        '"component": "Text", "text": {"@path": "/name"}',
        '"component": "StatCard", "label": "Revenue"',
    )
    examples = extract_examples_from_text(DOC, "```json\n" + custom.strip() + "\n```\n")
    assert validate(examples[0]) == []


def test_untabbed_component_checked_against_both_versions() -> None:
    shared = '{"id": "t", "component": "Text", "text": "Hello"}'
    v10_only = '{"id": "t", "component": "Text", "text": {"@path": "/name"}}'
    v091_only = '{"id": "t", "component": "Text", "text": {"path": "/name"}}'
    ok = extract_examples_from_text(DOC, "```json\n" + shared + "\n```\n")
    bad_v10 = extract_examples_from_text(DOC, "```json\n" + v10_only + "\n```\n")
    bad_v091 = extract_examples_from_text(DOC, "```json\n" + v091_only + "\n```\n")
    assert validate(ok[0]) == []
    assert validate(bad_v10[0]) != []
    assert validate(bad_v091[0]) != []


def test_fence_info_strings_and_same_line_astro_tab_transition() -> None:
    text = (
        '<Tabs>\n<TabItem label="v1.0">\n```json title="v1"\n'
        + V10_TEXT.strip()
        + '\n```\n</TabItem><TabItem label="v0.9.1">\n```json {1-3}\n'
        + V091_TEXT.strip()
        + "\n```\n</TabItem>\n</Tabs>\n"
    )
    examples = extract_examples_from_text(DOC, text)
    assert [e.tab_label for e in examples] == ["v1.0", "v0.9.1"]
    assert all(validate(e) == [] for e in examples)


def test_validates_tabbed_client_events_and_untabbed_version_errors() -> None:
    valid_action = (
        '{"version": "1.0", "action": {"name": "go", "surfaceId": "s",'
        ' "sourceComponentId": "b", "timestamp": "2026-03-15T14:30:00Z",'
        ' "context": {}}}'
    )
    missing_version_action = '{"action": {"name": "go"}}'
    examples = extract_examples_from_text(
        DOC, _mkdocs_tabs(valid_action, missing_version_action)
    )
    assert validate(examples[0]) == []
    assert validate(examples[1]) != []

    bad_untabbed_version = extract_examples_from_text(
        DOC,
        '```json\n{"version": "v1.0", "deleteSurface": {"surfaceId": "s"}}\n```\n',
    )
    missing_untabbed_version = extract_examples_from_text(
        DOC, '```json\n{"deleteSurface": {"surfaceId": "s"}}\n```\n'
    )
    assert validate(bad_untabbed_version[0]) != []
    assert validate(missing_untabbed_version[0]) != []


def test_custom_function_calls_enforce_envelope_properties() -> None:
    valid_v10 = (
        '{"id": "t", "component": "Text", "text": {"@call": "customFn",'
        ' "args": {"x": 1}}}'
    )
    bad_v10_return_type = (
        '{"id": "t", "component": "Text", "text": {"@call": "customFn",'
        ' "returnType": "string", "args": {"x": 1}}}'
    )
    bad_v10_args_list = (
        '{"id": "t", "component": "Text", "text": {"@call": "customFn",'
        ' "args": [1, 2]}}}'
    )
    valid_v091 = (
        '{"id": "t", "component": "Text", "text": {"call": "customFn",'
        ' "returnType": "string", "args": {"x": 1}}}'
    )
    bad_v091_extra = (
        '{"id": "t", "component": "Text", "text": {"call": "customFn", "bogus": true}}'
    )
    ok = extract_examples_from_text(DOC, _mkdocs_tabs(valid_v10, valid_v091))
    assert all(validate(e) == [] for e in ok)

    errs = extract_examples_from_text(
        DOC, _mkdocs_tabs(bad_v10_return_type, bad_v091_extra)
    )
    assert validate(errs[0]) != []
    assert validate(errs[1]) != []

    bad_list = extract_examples_from_text(
        DOC, _mkdocs_tabs(bad_v10_args_list, valid_v091)
    )
    assert validate(bad_list[0]) != []


def test_validates_json_array_payloads() -> None:
    valid_stream = (
        '[{"version": "1.0", "createSurface": {"surfaceId": "s", "catalogId":'
        ' "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"}},'
        f" {V10_TEXT.strip()}]"
    )
    invalid_stream = (
        f'[{{"version": "1.0", "createSurface": {{}}}}, {V10_TEXT.strip()}]'
    )
    ok = extract_examples_from_text(DOC, "```json\n" + valid_stream + "\n```\n")
    bad = extract_examples_from_text(DOC, "```json\n" + invalid_stream + "\n```\n")
    assert validate(ok[0]) == []
    assert validate(bad[0]) != []


def test_skip_marker() -> None:
    text = (
        "<!-- example: skip -->\n\n```json\n"
        + '{"version": "1.0", "updateComponents": {}}'
        + "\n```\n"
    )
    examples = extract_examples_from_text(DOC, text)
    assert examples[0].skipped
    assert validate(examples[0]) == []


def test_ignores_v08_tabs_and_unrelated_json() -> None:
    text = (
        '=== "v0.8"\n\n    ```json\n    {"surfaceUpdate": {}}\n   '
        ' ```\n\n```json\n{"name": "my-catalog"}\n```\n'
    )
    examples = extract_examples_from_text(DOC, text)
    assert all(validate(e) == [] for e in examples)


def test_invalid_json_in_version_tab_is_an_error() -> None:
    examples = extract_examples_from_text(DOC, _astro_tabs("{not json", V091_TEXT))
    assert validate(examples[0]) != []


def test_sorts_errors_with_mixed_str_and_int_paths() -> None:
    fake_validator = mock.Mock()
    fake_validator.iter_errors.return_value = [
        jsonschema.ValidationError("object key error", path=["surfaceId"]),
        jsonschema.ValidationError("array index error", path=[0, "id"]),
    ]
    with mock.patch("validate_doc_examples.schema_set") as mock_schema_set:
        mock_schema_set.return_value.validator_for.return_value = fake_validator
        errors = _errors_for({"version": "1.0"}, V1_0)
    assert errors == [
        "v1.0: 0/id: array index error",
        "v1.0: surfaceId: object key error",
    ]


def test_main_exit_codes(tmp_path: pathlib.Path) -> None:
    good = tmp_path / "good.md"
    good.write_text(_mkdocs_tabs(V10_TEXT, V091_TEXT))
    bad = tmp_path / "bad.mdx"
    bad.write_text(_astro_tabs(V091_TEXT.replace('"v0.9"', '"1.0"'), V091_TEXT))
    assert main(["--paths", str(good)]) == 0
    assert main(["--paths", str(tmp_path)]) == 1
