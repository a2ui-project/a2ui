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

import pytest
from convert_docs import to_mkdocs

# --- 1. A2UI Specific Header Cases ---
ADMONITION_CASES = [
    ('!!! info "Coming soon..."', "Coming soon...", "ℹ️"),
    ('!!! warning "Status: Early Stage Public Preview"', "Status: Early Stage Public Preview", "⚠️"),
    ('!!! success "Stable Release"', "Stable Release", "✅"),
    ('!!! note "Version Compatibility"', "Version Compatibility", "📝"),
    ('!!! warning "Attention"', "Attention", "⚠️"),
    ('!!! tip "It\'s Just JSON"', "It's Just JSON", "💡"),
]

@pytest.mark.parametrize("expected_header, title, emoji", ADMONITION_CASES)
def test_standard_a2ui_conversion(expected_header, title, emoji):
    """Verifies that GitHub style converts to expected A2UI headers."""
    body = "    Line 1\n    Line 2"
    github_input = f"> {emoji} **{title}**\n>\n> Line 1\n> Line 2\n"
    
    expected = f"{expected_header}\n{body}\n"
    
    # GitHub -> MkDocs
    result = to_mkdocs(github_input)
    assert result.strip() == expected.strip()


# --- 2. Empty Title Edge Case ---
def test_empty_title_case():
    """
    Verifies '> 💡' converts to !!! tip "".
    """
    github_input = "> 💡\n>\n> Content.\n"
    expected = '!!! tip ""\n    Content.\n'
    
    result = to_mkdocs(github_input)
    assert result == expected


# --- 3. Spacing & Internal Paragraph Preservation ---
def test_paragraph_spacing_and_trailing_lines():
    """
    Ensures:
    1. GitHub spacer (header vs content) is removed in MkDocs.
    2. Internal blank lines (paragraph breaks) are preserved.
    3. Trailing blockquote markers ('>') are cleaned up.
    """
    source_github = (
        "> ✅ **Stable Release**\n"
        ">\n"             # Spacer line
        "> Line 1\n"
        ">\n"             # Internal break
        "> Line 2\n"
        ">\n"             # Trailing line 1
        ">\n"             # Trailing line 2
    )
    
    result = to_mkdocs(source_github)
    
    expected = (
        '!!! success "Stable Release"\n'
        '    Line 1\n'
        '\n'
        '    Line 2\n'
    )
    assert result == expected


# --- 4. Multiple Blocks & Isolation ---
def test_multiple_blocks_in_one_file():
    """Ensures multiple blocks are processed without bleeding into each other."""
    github_input = (
        '> ✅ **Block 1**\n'
        '> Content 1\n'
        '\n'
        '> ℹ️ **Block 2**\n'
        '> Content 2\n'
    )
    
    expected = (
        '!!! success "Block 1"\n'
        '    Content 1\n'
        '\n'
        '!!! info "Block 2"\n'
        '    Content 2\n'
    )
    
    result = to_mkdocs(github_input)
    assert result == expected


# --- 5. False Positive Prevention ---
def test_regular_blockquote_ignored():
    """Ensures regular quotes are not touched."""
    source = "> This is just a quote, not an admonition."
    assert to_mkdocs(source) == source


# --- 6. GitHub Official Alert Syntax Support ---
def test_github_alert_to_mkdocs():
    """Verifies official [!TYPE] syntax conversion."""
    source = "> [!WARNING]\n> **Security Notice**\n> Do not share keys."
    expected = '!!! warning "Security Notice"\n    Do not share keys.\n'
    
    assert to_mkdocs(source) == expected
