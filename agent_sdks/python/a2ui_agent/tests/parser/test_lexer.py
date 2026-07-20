# Copyright 2026 Google LLC
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

"""Unit tests for state-machine-based BlockLexer."""

import unittest
from a2ui.parser.lexer import BlockLexer


class TestBlockLexer(unittest.TestCase):
    """Unit test suite for BlockLexer."""

    def test_lexer_standard_parsing(self):
        """Verify standard unwrapping of tags and conversational text."""
        content = "Preamble\n<a2ui>\ncode_here\n</a2ui>\nPostamble"
        lexer = BlockLexer()
        parts = lexer.tokenize(content)

        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0].text, "Preamble")
        self.assertEqual(parts[0].a2ui_raw, "code_here")
        self.assertTrue(parts[0].is_final)
        self.assertEqual(parts[1].text, "Postamble")
        self.assertIsNone(parts[1].a2ui_raw)

    def test_lexer_embedded_tag_in_string(self):
        """Verify embedded close tag inside double-quoted string doesn't split the block."""
        content = 'Preamble\n<a2ui>\ntext = "Hello </a2ui> World"\n</a2ui>'
        lexer = BlockLexer()
        parts = lexer.tokenize(content)

        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].text, "Preamble")
        self.assertEqual(parts[0].a2ui_raw, 'text = "Hello </a2ui> World"')
        self.assertTrue(parts[0].is_final)

    def test_lexer_triple_quoted_string(self):
        """Verify embedded close tag inside triple quotes doesn't split the block."""
        content = 'Preamble\n<a2ui>\ntext = """\nLine 1\n</a2ui>\nLine 2\n"""\n</a2ui>'
        lexer = BlockLexer()
        parts = lexer.tokenize(content)

        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].text, "Preamble")
        self.assertEqual(parts[0].a2ui_raw, 'text = """\nLine 1\n</a2ui>\nLine 2\n"""')
        self.assertTrue(parts[0].is_final)

    def test_lexer_unclosed_block_truncation(self):
        """Verify lexer auto-closes truncated block and sets is_final=False."""
        content = 'Preamble\n<a2ui>\ntext = "Hello'
        lexer = BlockLexer()
        parts = lexer.tokenize(content)

        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].text, "Preamble")
        self.assertEqual(parts[0].a2ui_raw, 'text = "Hello')
        self.assertFalse(parts[0].is_final)

    def test_lexer_embedded_tag_in_comment(self):
        """Verify embedded close tag inside comment doesn't split the block."""
        content = "Preamble\n<a2ui>\n# Some </a2ui> comment\ntext = 123\n</a2ui>"
        lexer = BlockLexer()
        parts = lexer.tokenize(content)

        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].text, "Preamble")
        self.assertEqual(parts[0].a2ui_raw, "# Some </a2ui> comment\ntext = 123")
        self.assertTrue(parts[0].is_final)

    def test_lexer_open_tag_with_attributes(self):
        """Verify that open tags with attributes are correctly matched and parsed."""
        content = (
            'Preamble\n<a2ui id="main" surfaceId="foo">\ncode_here\n</a2ui>\nPostamble'
        )
        lexer = BlockLexer()
        parts = lexer.tokenize(content)

        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0].text, "Preamble")
        self.assertEqual(parts[0].a2ui_raw, "code_here")
        self.assertTrue(parts[0].is_final)
        self.assertEqual(parts[1].text, "Postamble")

    def test_lexer_markdown_cleaning(self):
        """Verify that markdown code block wrapper tags are stripped from conversational text parts."""
        content = "Preamble\n```html\n<a2ui>\ncode_here\n</a2ui>\n```\nPostamble"
        lexer = BlockLexer()
        parts = lexer.tokenize(content)

        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0].text, "Preamble")
        self.assertEqual(parts[0].a2ui_raw, "code_here")
        self.assertTrue(parts[0].is_final)
        self.assertEqual(parts[1].text, "Postamble")

    def test_lexer_inner_markdown_cleaning(self):
        """Verify that markdown code block wrappers inside the tag are stripped from the raw content."""
        content = "Preamble\n<a2ui>\n```json\ncode_here\n```\n</a2ui>\nPostamble"
        lexer = BlockLexer()
        parts = lexer.tokenize(content)

        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0].text, "Preamble")
        self.assertEqual(parts[0].a2ui_raw, "code_here")
        self.assertTrue(parts[0].is_final)
        self.assertEqual(parts[1].text, "Postamble")


if __name__ == "__main__":
    unittest.main()
