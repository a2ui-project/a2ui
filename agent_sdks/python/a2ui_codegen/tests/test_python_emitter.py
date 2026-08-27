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

"""Unit tests for PythonEmitter."""

import ast
from pathlib import Path
import pytest
from a2ui.codegen.analyzer import CatalogAnalyzer
from a2ui.codegen.emitter.python import PythonEmitter


def test_emit_valid_python(tmp_path: Path):
    repo_root = Path(__file__).resolve().parents[4]
    schema_path = repo_root / "specification" / "v0_9_1" / "catalogs" / "basic" / "catalog.json"
    catalog = CatalogAnalyzer.from_file(schema_path)

    emitter = PythonEmitter(catalog)
    written_files = emitter.emit(tmp_path)

    expected_names = {"types.py", "components.py", "functions.py", "__init__.py", "py.typed"}
    actual_names = {f.name for f in written_files}
    assert expected_names.issubset(actual_names)

    # Verify each .py file parses with AST without any syntax errors
    for py_file in tmp_path.glob("*.py"):
        content = py_file.read_text(encoding="utf-8")
        try:
            ast.parse(content, filename=py_file.name)
        except SyntaxError as e:
            pytest.fail(f"Syntax error in generated {py_file.name}: {e}\nContent:\n{content}")

    # Check that Text, Card, Column classes exist in components.py
    components_code = (tmp_path / "components.py").read_text(encoding="utf-8")
    assert "class Text(ComponentBuilderNode):" in components_code
    assert "class Card(ComponentBuilderNode):" in components_code
    assert "class Column(ComponentBuilderNode):" in components_code
    assert "class Button(ComponentBuilderNode):" in components_code

    # Check types.py contains expected enums
    types_code = (tmp_path / "types.py").read_text(encoding="utf-8")
    assert "TextVariant = Literal[" in types_code
    assert '"body"' in types_code

    # Check functions.py contains formatString
    functions_code = (tmp_path / "functions.py").read_text(encoding="utf-8")
    assert "def formatString(" in functions_code
