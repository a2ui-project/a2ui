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

import os
import pathlib
import sys

import pytest

# Add the script's directory to the path so the test can import it.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from validate_doc_examples import (
    V0_9_1,
    V1_0,
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
def test_version_for_label(label, expected):
    assert version_for_label(label) == expected


def test_extracts_mkdocs_tabs():
    examples = extract_examples_from_text(DOC, _mkdocs_tabs(V10_TEXT, V091_TEXT))
    assert [e.tab_label for e in examples] == ["v1.0", "v0.9.1"]
    assert all(validate(e) == [] for e in examples)


def test_extracts_astro_tabs():
    examples = extract_examples_from_text(DOC, _astro_tabs(V10_TEXT, V091_TEXT))
    assert [e.tab_label for e in examples] == ["v1.0", "v0.9.1"]
    assert all(validate(e) == [] for e in examples)


def test_mkdocs_tab_ends_at_dedent():
    text = (
        _mkdocs_tabs(V10_TEXT, V091_TEXT) + "\n```json\n" + V10_TEXT.strip() + "\n```\n"
    )
    examples = extract_examples_from_text(DOC, text)
    assert examples[-1].tab_label is None
    assert validate(examples[-1]) == []


def test_reports_v10_syntax_in_v091_tab():
    examples = extract_examples_from_text(
        DOC, _mkdocs_tabs(V10_TEXT, V10_TEXT.replace('"1.0"', '"v0.9"'))
    )
    assert validate(examples[0]) == []
    assert validate(examples[1]) != []


def test_reports_v091_syntax_in_v10_tab():
    examples = extract_examples_from_text(
        DOC, _astro_tabs(V091_TEXT.replace('"v0.9"', '"1.0"'), V091_TEXT)
    )
    assert validate(examples[0]) != []
    assert validate(examples[1]) == []


def test_reports_unknown_basic_catalog_property():
    bad = V10_TEXT.replace(
        '"text": {"@path": "/name"}', '"text": "Hi", "colour": "red"'
    )
    examples = extract_examples_from_text(DOC, "```json\n" + bad.strip() + "\n```\n")
    assert validate(examples[0]) != []


def test_accepts_components_from_other_catalogs():
    custom = V10_TEXT.replace(
        '"component": "Text", "text": {"@path": "/name"}',
        '"component": "StatCard", "label": "Revenue"',
    )
    examples = extract_examples_from_text(DOC, "```json\n" + custom.strip() + "\n```\n")
    assert validate(examples[0]) == []


def test_untabbed_component_checked_against_v10():
    v10_component = '{"id": "t", "component": "Text", "text": {"@path": "/name"}}'
    v091_component = '{"id": "t", "component": "Text", "text": {"path": "/name"}}'
    ok = extract_examples_from_text(DOC, "```json\n" + v10_component + "\n```\n")
    bad = extract_examples_from_text(DOC, "```json\n" + v091_component + "\n```\n")
    assert validate(ok[0]) == []
    assert validate(bad[0]) != []


def test_skip_marker():
    text = (
        "<!-- example: skip -->\n\n```json\n"
        + '{"version": "1.0", "updateComponents": {}}'
        + "\n```\n"
    )
    examples = extract_examples_from_text(DOC, text)
    assert examples[0].skipped
    assert validate(examples[0]) == []


def test_ignores_v08_tabs_and_unrelated_json():
    text = (
        '=== "v0.8"\n\n    ```json\n    {"surfaceUpdate": {}}\n   '
        ' ```\n\n```json\n{"name": "my-catalog"}\n```\n'
    )
    examples = extract_examples_from_text(DOC, text)
    assert all(validate(e) == [] for e in examples)


def test_invalid_json_in_version_tab_is_an_error():
    examples = extract_examples_from_text(DOC, _astro_tabs("{not json", V091_TEXT))
    assert validate(examples[0]) != []


def test_main_exit_codes(tmp_path):
    good = tmp_path / "good.md"
    good.write_text(_mkdocs_tabs(V10_TEXT, V091_TEXT))
    bad = tmp_path / "bad.mdx"
    bad.write_text(_astro_tabs(V091_TEXT.replace('"v0.9"', '"1.0"'), V091_TEXT))
    assert main(["--paths", str(good)]) == 0
    assert main(["--paths", str(tmp_path)]) == 1
