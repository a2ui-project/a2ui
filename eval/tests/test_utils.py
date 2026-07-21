# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Unit tests for eval/iterative/utils modules and CLI flags."""

import json
import os
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EVAL_ITERATIVE_DIR = REPO_ROOT / "eval/iterative"


class TestEvalUtils(unittest.TestCase):

    def test_format_tools_compile_and_parse(self):
        """Test test_compile_snippet and test_parse_ast for Atom format."""
        sys_path_added = False
        import sys

        if str(EVAL_ITERATIVE_DIR) not in sys.path:
            sys.path.insert(0, str(EVAL_ITERATIVE_DIR))
            sys_path_added = True

        try:
            from utils.format_tools import (
                test_compile_snippet,
                test_parse_ast,
                test_decompile_payload,
            )

            # 1. Test compile
            compiled_str = test_compile_snippet("atom", '(Card (Text "Unit Test"))')
            payload = json.loads(compiled_str)
            self.assertEqual(payload["version"], "v1.0")
            self.assertIn("createSurface", payload)

            # 2. Test parse AST
            parsed_str = test_parse_ast("atom", '(Card (Text "Unit Test"))')
            parsed_ast = json.loads(parsed_str)
            self.assertIsInstance(parsed_ast, list)
            self.assertEqual(parsed_ast[0][0], "Card")

            # 3. Test decompile
            decompiled_str = test_decompile_payload("atom", payload)
            self.assertIn("Card", decompiled_str)
            self.assertIn("Unit Test", decompiled_str)
        finally:
            if sys_path_added and str(EVAL_ITERATIVE_DIR) in sys.path:
                sys.path.remove(str(EVAL_ITERATIVE_DIR))

    def test_archiver_slugify(self):
        """Test string slugification helper in archiver module."""
        sys_path_added = False
        import sys

        if str(EVAL_ITERATIVE_DIR) not in sys.path:
            sys.path.insert(0, str(EVAL_ITERATIVE_DIR))
            sys_path_added = True

        try:
            from utils.archiver import _slugify

            slug = _slugify("Compiler-side dynamic event handler normalization!")
            self.assertEqual(slug, "compiler_side_dynamic_event_handler_norm")
        finally:
            if sys_path_added and str(EVAL_ITERATIVE_DIR) in sys.path:
                sys.path.remove(str(EVAL_ITERATIVE_DIR))


if __name__ == "__main__":
    unittest.main()
