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

"""Unit tests for JSON payload autofixer."""

import unittest
from a2ui.parser.payload_fixer import (
    _fix_unescaped_backslashes,
    _remove_trailing_commas,
    parse_and_fix,
)


class TestPayloadFixer(unittest.TestCase):
    """Unit test suite for payload_fixer."""

    def test_fix_unescaped_backslashes_latex(self):
        """Verify invalid backslashes (e.g. LaTeX) are escaped while valid ones are preserved."""
        invalid_json = (
            r'{"formula": "\approx \Delta x", "valid": "line1\nline2", "escaped_slash":'
            r' "path\\to\\file"}'
        )
        fixed = _fix_unescaped_backslashes(invalid_json)
        self.assertIn(r'"formula": "\\approx \\Delta x"', fixed)
        self.assertIn(r'"valid": "line1\nline2"', fixed)
        self.assertIn(r'"escaped_slash": "path\\to\\file"', fixed)

    def test_fix_trailing_commas(self):
        """Verify trailing commas in objects and arrays are cleanly removed."""
        trailing_comma_json = r'{"a": [1, 2, ], "b": {"k": "v", }, }'
        fixed = _remove_trailing_commas(trailing_comma_json)
        self.assertNotIn(', ]', fixed)
        self.assertNotIn(', }', fixed)

    def test_parse_and_fix_recovers_from_corrupt_json(self):
        """Verify parse_and_fix recovers payloads with both trailing commas and LaTeX."""
        corrupt_payload = (
            r'[{"version": "v0.9", "createSurface": {"surfaceId": "default",'
            r' "components": ['
            r'{"id": "t1", "component": "Text", "text": "Formula: \approx \Delta",},'
            r']}}]'
        )
        res = parse_and_fix(corrupt_payload)
        self.assertEqual(len(res), 1)
        components = res[0]['createSurface']['components']
        self.assertEqual(components[0]['text'], r'Formula: \approx \Delta')
