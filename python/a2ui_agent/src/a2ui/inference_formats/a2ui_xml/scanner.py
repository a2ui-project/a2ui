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

"""Streaming-capable A2UI XML scanner and Six-Laws validator."""

from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Literal, Union

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG

from .errors import A2uiXmlParseError, A2uiXmlStrictViolation, A2uiXmlValidationError
from .expressions import unescape_xml_attr

A2uiXmlNode = Union["ElementNode", "FenceNode", "ProseNode"]

OPEN_A2UI_RE = re.compile(r"<a2ui(?P<attrs>(?:\s[^>]*)?)>", re.IGNORECASE)
CLOSE_A2UI_RE = re.compile(r"</a2ui\s*>", re.IGNORECASE)
_OPEN_A2UI_PREFIX_RE = re.compile(r"<a2ui(?:\s[^>]*)?$", re.IGNORECASE)
_CLOSE_A2UI_PREFIX_RE = re.compile(r"</a2ui\s*$", re.IGNORECASE)

_FENCE_OPEN_RE = re.compile(r"^(?P<indent>[ \t]*)(?P<ticks>`{3,})(?P<rest>[^\r\n]*)$")
_THEMATIC_BREAK_RE = re.compile(r"^[ \t]*(?:-\s*-\s*-[- \t]*|\*\s*\*\s*\*[* \t]*)$")
_PASCAL_CASE_RE = re.compile(r"^[A-Z][a-zA-Z0-9]*$")
_ATTR_NAME_RE = re.compile(r"[a-zA-Z_:][a-zA-Z0-9_.:-]*")


@dataclass
class ElementNode:
    """An XML/A2UI XML tag element and its nested children."""

    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list[A2uiXmlNode] = field(default_factory=list)
    line: int = 1
    self_closing: bool = False
    closed: bool = False


@dataclass
class FenceNode:
    """An opaque fenced code block (Law 4 & Law 6), such as ```` ```json ````."""

    lang: str
    info: str
    content: str
    line: int = 1
    closed: bool = False


@dataclass
class ProseNode:
    """Markdown prose or thematic break inside an A2UI XML surface."""

    text: str
    kind: Literal["prose", "divider"] = "prose"
    line: int = 1


@dataclass
class ParsedDocument:
    """Parsed A2UI XML AST paired with any recovered Six-Laws violations."""

    children: list[A2uiXmlNode]
    violations: list[A2uiXmlStrictViolation]


def _is_prefix_of_ci(text: str, idx: int, target: str) -> bool:
    rem = len(text) - idx
    return 0 < rem < len(target) and target[:rem].lower() == text[idx:].lower()


def possible_a2ui_open_start(text: str) -> int:
    """Returns index where a trailing partial ``<a2ui...`` might start, else ``len(text)``."""
    idx = text.find("<")
    while idx >= 0:
        if _is_prefix_of_ci(
            text, idx, A2UI_INFERENCE_OPEN_TAG
        ) or _OPEN_A2UI_PREFIX_RE.match(text, idx):
            return idx
        idx = text.find("<", idx + 1)
    return len(text)


def scan_a2ui_block_end(content: str) -> tuple[int | None, int | None, int]:
    """Finds ``</a2ui>`` outside opaque code fences, XML comments, and quotes.

    Returns:
      Tuple ``(close_start, close_end, safe_readable_end)`` where ``close_start`` is
      ``None`` when ``</a2ui>`` has not arrived yet.
    """
    n = len(content)
    i = 0
    at_line_start = True
    in_fence_ticks: int | None = None
    in_tag_quote: str | None = None
    in_tag = False

    while i < n:
        if in_fence_ticks is not None:
            line_end = content.find("\n", i)
            seg_end = n if line_end < 0 else line_end
            line_str = content[i:seg_end].rstrip("\r")
            stripped = line_str.strip()
            if len(stripped) >= in_fence_ticks and stripped == "`" * len(stripped):
                in_fence_ticks = None
            if line_end < 0:
                return None, None, n
            i = line_end + 1
            at_line_start = True
            continue

        if at_line_start and not in_tag:
            line_end = content.find("\n", i)
            seg_end = n if line_end < 0 else line_end
            line_str = content[i:seg_end].rstrip("\r")
            fence_match = _FENCE_OPEN_RE.match(line_str)
            if fence_match:
                if line_end < 0:
                    return None, None, i
                in_fence_ticks = len(fence_match.group("ticks"))
                i = line_end + 1
                at_line_start = True
                continue

        ch = content[i]
        if ch == "\n":
            at_line_start = True
            i += 1
            continue
        if not ch.isspace():
            at_line_start = False

        if in_tag_quote is not None:
            if ch == "\\" and i + 1 < n:
                i += 2
                continue
            if ch == in_tag_quote:
                in_tag_quote = None
            i += 1
            continue

        if not in_tag and content.startswith("<!--", i):
            end_comment = content.find("-->", i + 4)
            if end_comment < 0:
                return None, None, i
            # Track newlines inside comment
            i = end_comment + 3
            continue

        if in_tag:
            if ch in ('"', "'"):
                in_tag_quote = ch
            elif ch == ">":
                in_tag = False
            i += 1
            continue

        if ch == "<":
            close_match = CLOSE_A2UI_RE.match(content, i)
            if close_match:
                return i, close_match.end(), i
            if _is_prefix_of_ci(
                content, i, A2UI_INFERENCE_CLOSE_TAG
            ) or _CLOSE_A2UI_PREFIX_RE.match(content, i):
                return None, None, i
            # Check if this begins a regular tag `<Tag` or `</Tag`
            if i + 1 < n and (content[i + 1].isalpha() or content[i + 1] == "/"):
                in_tag = True
            i += 1
            continue

        i += 1

    return None, None, n


def parse_tag_attributes(
    attr_text: str,
    *,
    line: int,
    violations: list[A2uiXmlStrictViolation],
    tuned: bool = False,
) -> dict[str, str]:
    """Parses XML attributes, recording Law 5 violations for non-double-quoted forms."""
    attrs: dict[str, str] = {}
    pos = 0
    n = len(attr_text)

    while pos < n:
        while pos < n and attr_text[pos].isspace():
            pos += 1
        if pos >= n:
            break

        if tuned and attr_text[pos] in (",", ";", '"', "'"):
            violations.append(
                A2uiXmlStrictViolation(
                    law="law5_attr_punctuation",
                    message=(
                        f"Stray punctuation {attr_text[pos]!r} stripped in tag"
                        " attributes."
                    ),
                    line=line,
                )
            )
            pos += 1
            continue

        name_match = _ATTR_NAME_RE.match(attr_text, pos)
        if not name_match:
            raise A2uiXmlParseError(
                f"Invalid attribute syntax near {attr_text[pos:pos + 20]!r} on line"
                f" {line}."
            )
        key = name_match.group(0)
        pos = name_match.end()

        ws_pos = pos
        while ws_pos < n and attr_text[ws_pos].isspace():
            ws_pos += 1

        if ws_pos >= n or attr_text[ws_pos] != "=":
            violations.append(
                A2uiXmlStrictViolation(
                    law="law5_double_quotes",
                    message=(
                        f"Bare boolean attribute {key!r} must be written as"
                        f' {key}="true".'
                    ),
                    line=line,
                )
            )
            if key in attrs:
                raise A2uiXmlValidationError(
                    f"Duplicate attribute {key!r} on line {line}."
                )
            attrs[key] = "true"
            pos = ws_pos
            continue

        pos = ws_pos + 1  # skip '='
        while pos < n and attr_text[pos].isspace():
            pos += 1
        if pos >= n:
            raise A2uiXmlParseError(
                f"Missing attribute value for {key!r} on line {line}."
            )

        quote = attr_text[pos]
        if quote in ('"', "'"):
            if quote == "'":
                violations.append(
                    A2uiXmlStrictViolation(
                        law="law5_double_quotes",
                        message=(
                            f"Single-quoted attribute {key}='...' violates Law 5; use"
                            " double quotes."
                        ),
                        line=line,
                    )
                )
            pos += 1
            val_chars: list[str] = []
            closed = False
            while pos < n:
                ch = attr_text[pos]
                pos += 1
                if ch == quote:
                    closed = True
                    break
                if ch == "\\" and pos < n and attr_text[pos] == quote:
                    val_chars.append(quote)
                    pos += 1
                else:
                    val_chars.append(ch)
            if not closed:
                raise A2uiXmlParseError(
                    f"Unterminated string for attribute {key!r} on line {line}."
                )
            raw_val = unescape_xml_attr("".join(val_chars))
        elif quote == "{":
            # Lenient recovery for JSX-style `prop={expr}` without quotes
            violations.append(
                A2uiXmlStrictViolation(
                    law="law5_double_quotes",
                    message=(
                        f"Unquoted brace attribute {key}={{...}} violates Law 5; use"
                        " double quotes."
                    ),
                    line=line,
                )
            )
            depth = 0
            start_brace = pos
            while pos < n:
                ch = attr_text[pos]
                if ch in ('"', "'"):
                    q = ch
                    pos += 1
                    while pos < n and attr_text[pos] != q:
                        if attr_text[pos] == "\\":
                            pos += 2
                        else:
                            pos += 1
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        pos += 1
                        break
                pos += 1
            if depth != 0:
                raise A2uiXmlParseError(
                    f"Unterminated '{{' in attribute {key!r} on line {line}."
                )
            raw_val = attr_text[start_brace:pos]
        else:
            violations.append(
                A2uiXmlStrictViolation(
                    law="law5_double_quotes",
                    message=(
                        f"Unquoted attribute {key}=... violates Law 5; wrap all"
                        " attribute values in double quotes."
                    ),
                    line=line,
                )
            )
            val_start = pos
            while pos < n and not attr_text[pos].isspace():
                pos += 1
            raw_val = unescape_xml_attr(attr_text[val_start:pos])

        if key in attrs:
            raise A2uiXmlValidationError(f"Duplicate attribute {key!r} on line {line}.")
        attrs[key] = raw_val

    return attrs


def build_surface_directive_from_a2ui_attrs(
    raw_attr_text: str,
    *,
    tuned: bool = False,
) -> tuple[str, list[A2uiXmlStrictViolation]]:
    """Converts ``<a2ui surface="..." update="true">`` attributes into a ``<Surface />`` header.

    Preserves the raw attribute quoting/flag tokens on ``<Surface ... />`` so
    that downstream ``compile_with_diagnostics(raw_block)`` calls retain any
    Law 5 attribute violations from the ``<a2ui ...>`` envelope.
    """
    stripped = raw_attr_text.strip()
    if not stripped:
        return "", []
    violations: list[A2uiXmlStrictViolation] = []
    attrs = parse_tag_attributes(stripped, line=1, violations=violations, tuned=tuned)
    if not attrs:
        return "", violations
    single_line_attrs = re.sub(r"\s*\r?\n\s*", " ", stripped)
    return f"<Surface {single_line_attrs} />", violations


def _sanitize_tag_name(
    raw_name: str, line: int, violations: list[A2uiXmlStrictViolation]
) -> str:
    """Strips trailing non-ASCII noise from tag names and checks Law 3 PascalCase."""
    ascii_prefix = []
    for ch in raw_name:
        if ch.isascii() and (ch.isalnum() or ch in ("_", "-")):
            ascii_prefix.append(ch)
        else:
            break
    cleaned = "".join(ascii_prefix)
    if cleaned != raw_name:
        violations.append(
            A2uiXmlStrictViolation(
                law="law3_tag_noise",
                message=(
                    f"Non-ASCII or invalid suffix stripped from tag {raw_name!r}"
                    f" -> {cleaned!r}."
                ),
                line=line,
            )
        )
    if not cleaned:
        raise A2uiXmlParseError(f"Invalid empty tag name {raw_name!r} on line {line}.")
    if not _PASCAL_CASE_RE.match(cleaned):
        violations.append(
            A2uiXmlStrictViolation(
                law="law3_pascal_case",
                message=f"Tag <{cleaned}> should use PascalCase per A2UI XML Law 3.",
                line=line,
            )
        )
    return cleaned


def _unwrap_accidental_outer_fence(
    source: str, violations: list[A2uiXmlStrictViolation]
) -> str:
    """Unwraps an outer non-JSON markdown fence wrapping the entire ``<a2ui>`` body."""
    stripped = source.strip()
    if not stripped.startswith("```"):
        return source
    first_nl = stripped.find("\n")
    if first_nl < 0:
        return source
    header = stripped[:first_nl].strip()
    lang = (
        header.lstrip("`").strip().split()[0].lower()
        if header.lstrip("`").strip()
        else ""
    )
    if lang == "json":
        return source
    if not stripped.endswith("```"):
        return source
    inner = stripped[first_nl + 1 : -3]
    # Only unwrap if inner contains no closing fence of its own at root
    if "```" in inner:
        return source
    violations.append(
        A2uiXmlStrictViolation(
            law="law4_outer_fence",
            message=(
                "Do not wrap the entire <a2ui> payload inside a markdown code fence."
            ),
            line=1,
        )
    )
    return inner


def _dedent_fence_lines(lines: list[str], base_indent: str) -> str:
    if not lines:
        return ""
    prefix_len = len(base_indent)
    out: list[str] = []
    for ln in lines:
        if prefix_len and ln.startswith(base_indent):
            out.append(ln[prefix_len:])
        elif prefix_len and not ln.strip():
            out.append("")
        else:
            out.append(ln)
    return "\n".join(out)


def _find_tag_end(source: str, start: int) -> int | None:
    """Finds the matching ``>`` of a tag starting at ``start``, respecting quotes/braces."""
    n = len(source)
    i = start + 1
    quote: str | None = None
    brace_depth = 0
    while i < n:
        ch = source[i]
        if quote is not None:
            if ch == "\\" and i + 1 < n:
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ('"', "'"):
            quote = ch
        elif ch == "{":
            brace_depth += 1
        elif ch == "}" and brace_depth > 0:
            brace_depth -= 1
        elif ch == ">" and brace_depth == 0:
            return i
        i += 1
    return None


def parse_a2ui_xml_document(
    source: str,
    *,
    is_final: bool = True,
    strict: bool = False,
    tuned: bool = False,
) -> ParsedDocument:
    """Parses an A2UI XML document into an AST and collects Six-Laws violations.

    Args:
      source: Raw A2UI XML text inside ``<a2ui>...</a2ui>``.
      is_final: Whether ``source`` represents the complete block. When False
        (streaming), unclosed trailing tags or fences are left with
        ``closed=False`` without raising or recording EOF violations.
      strict: When True, immediately raises ``A2uiXmlParseError`` on any Six-Laws
        violation.
      tuned: When True, activates enhanced closing-tag debris and attribute
        punctuation recovery.

    Returns:
      ``ParsedDocument`` containing root ``children`` and ``violations``.
    """
    violations: list[A2uiXmlStrictViolation] = []
    if is_final:
        source = _unwrap_accidental_outer_fence(source, violations)

    root_children: list[A2uiXmlNode] = []
    stack: list[ElementNode] = []

    def current_children() -> list[A2uiXmlNode]:
        return stack[-1].children if stack else root_children

    n = len(source)
    pos = 0
    line = 1
    at_line_start = True
    tokens_on_current_line = 0

    while pos < n:
        # 1. At start of line, check for triple-backtick code fence (Law 4 & Law 6)
        if at_line_start:
            line_end = source.find("\n", pos)
            seg_end = n if line_end < 0 else line_end
            raw_line = source[pos:seg_end].rstrip("\r")
            fence_match = _FENCE_OPEN_RE.match(raw_line)
            if fence_match:
                if line_end < 0 and not is_final:
                    # Wait until the fence header line finishes streaming
                    break
                indent = fence_match.group("indent")
                ticks = fence_match.group("ticks")
                rest = fence_match.group("rest").strip()
                parts = rest.split(None, 1)
                lang = parts[0] if parts else ""
                info = parts[1].strip() if len(parts) > 1 else ""
                fence_line = line
                pos = n if line_end < 0 else line_end + 1
                line += 1 if line_end >= 0 else 0

                body_lines: list[str] = []
                fence_closed = False
                while pos < n:
                    nl = source.find("\n", pos)
                    l_end = n if nl < 0 else nl
                    f_line = source[pos:l_end].rstrip("\r")
                    f_stripped = f_line.strip()
                    if len(f_stripped) >= len(ticks) and f_stripped == "`" * len(
                        f_stripped
                    ):
                        if nl < 0 and not is_final:
                            # Might still receive more backticks, wait
                            break
                        fence_closed = True
                        pos = n if nl < 0 else nl + 1
                        if nl >= 0:
                            line += 1
                        break
                    if nl < 0 and not is_final:
                        break
                    body_lines.append(f_line)
                    pos = n if nl < 0 else nl + 1
                    if nl >= 0:
                        line += 1

                if not fence_closed and is_final:
                    violations.append(
                        A2uiXmlStrictViolation(
                            law="law4_unclosed_fence",
                            message=(
                                f"Unclosed code fence starting on line {fence_line}."
                            ),
                            line=fence_line,
                        )
                    )
                    fence_closed = True

                current_children().append(
                    FenceNode(
                        lang=lang,
                        info=info,
                        content=_dedent_fence_lines(body_lines, indent),
                        line=fence_line,
                        closed=fence_closed,
                    )
                )
                at_line_start = True
                tokens_on_current_line = 0
                if not fence_closed and not is_final:
                    break
                continue

            # Thematic break `---` or `***` on its own line
            if _THEMATIC_BREAK_RE.match(raw_line):
                if line_end < 0 and not is_final:
                    break
                current_children().append(
                    ProseNode(text="---", kind="divider", line=line)
                )
                pos = n if line_end < 0 else line_end + 1
                if line_end >= 0:
                    line += 1
                at_line_start = True
                tokens_on_current_line = 0
                continue

        # Advance past horizontal whitespace
        while pos < n and source[pos] in (" ", "\t", "\r"):
            pos += 1
        if pos >= n:
            break

        if source[pos] == "\n":
            pos += 1
            line += 1
            at_line_start = True
            tokens_on_current_line = 0
            continue

        at_line_start = False

        # 2. XML comment `<!-- ... -->`
        if source.startswith("<!--", pos):
            end_comment = source.find("-->", pos + 4)
            if end_comment < 0:
                if not is_final:
                    break
                raise A2uiXmlParseError(
                    f"Unclosed XML comment starting on line {line}."
                )
            line += source.count("\n", pos, end_comment + 3)
            pos = end_comment + 3
            continue

        # 3. Structural tag `<Tag ...>` or `</Tag>`
        if (
            source[pos] == "<"
            and pos + 1 < n
            and (
                source[pos + 1].isalpha()
                or source[pos + 1] == "/"
                or not source[pos + 1].isascii()
            )
            and not source.startswith("<http://", pos)
            and not source.startswith("<https://", pos)
            and not source.startswith("<mailto:", pos)
        ):
            tag_end = _find_tag_end(source, pos)
            if tag_end is None:
                if not is_final:
                    break
                raise A2uiXmlParseError(
                    f"Unclosed '<' tag starting on line {line}:"
                    f" {source[pos:pos + 40]!r}"
                )

            if tokens_on_current_line > 0:
                violations.append(
                    A2uiXmlStrictViolation(
                        law="law2_verticality",
                        message=(
                            "Law 2 violation: every <Tag> and </Tag> must sit on its"
                            " own line."
                        ),
                        line=line,
                    )
                )
            tokens_on_current_line += 1

            raw_inside = source[pos + 1 : tag_end]
            tag_start_line = line
            line += source.count("\n", pos, tag_end + 1)
            pos = tag_end + 1

            # Closing tag `</Tag>`
            if raw_inside.startswith("/"):
                close_raw = raw_inside[1:].strip()
                if tuned:
                    debris_match = re.match(
                        r"^([^\s\"'/]+)(?P<debris>[\s\"'/].*)$",
                        close_raw,
                        flags=re.DOTALL,
                    )
                    if debris_match:
                        violations.append(
                            A2uiXmlStrictViolation(
                                law="law3_closing_tag_debris",
                                message=(
                                    "Trailing debris stripped from closing tag"
                                    f" </{close_raw}>."
                                ),
                                line=tag_start_line,
                            )
                        )
                        close_raw = debris_match.group(1)
                close_name = _sanitize_tag_name(close_raw, tag_start_line, violations)
                if close_name.lower() == "root":
                    violations.append(
                        A2uiXmlStrictViolation(
                            law="law1_implicit_root",
                            message=(
                                "Do not wrap A2UI XML output in a <Root> tag (Law 1)."
                            ),
                            line=tag_start_line,
                        )
                    )
                    continue

                # Match against open stack (exact first, then case-insensitive)
                match_idx: int | None = None
                for idx in range(len(stack) - 1, -1, -1):
                    if stack[idx].tag == close_name:
                        match_idx = idx
                        break
                if match_idx is None:
                    for idx in range(len(stack) - 1, -1, -1):
                        if stack[idx].tag.lower() == close_name.lower():
                            match_idx = idx
                            violations.append(
                                A2uiXmlStrictViolation(
                                    law="law3_mismatched_case",
                                    message=(
                                        f"Closing tag </{close_name}> does not match"
                                        f" case of <{stack[idx].tag}>."
                                    ),
                                    line=tag_start_line,
                                )
                            )
                            break

                if match_idx is None:
                    if strict:
                        raise A2uiXmlParseError(
                            f"Unexpected closing tag </{close_name}> on line"
                            f" {tag_start_line}."
                        )
                    violations.append(
                        A2uiXmlStrictViolation(
                            law="unmatched_close_tag",
                            message=f"Stray closing tag </{close_name}> ignored.",
                            line=tag_start_line,
                        )
                    )
                    continue

                # Pop any unclosed intermediate tags above `match_idx`
                while len(stack) - 1 > match_idx:
                    unclosed = stack.pop()
                    unclosed.closed = True
                    violations.append(
                        A2uiXmlStrictViolation(
                            law="unclosed_tag",
                            message=(
                                f"Tag <{unclosed.tag}> opened on line {unclosed.line}"
                                f" was implicitly closed by </{close_name}>."
                            ),
                            line=unclosed.line,
                        )
                    )
                closed_elem = stack.pop()
                closed_elem.closed = True
                continue

            # Opening or self-closing tag `<Tag ...>` / `<Tag ... />`
            self_closing = raw_inside.rstrip().endswith("/")
            body_inside = (
                raw_inside.rstrip()[:-1] if self_closing else raw_inside
            ).strip()

            # Split tag name from attribute tail
            name_end = 0
            while name_end < len(body_inside) and not body_inside[name_end].isspace():
                name_end += 1
            raw_tag_name = body_inside[:name_end]
            attr_tail = body_inside[name_end:]

            tag_name = _sanitize_tag_name(raw_tag_name, tag_start_line, violations)
            attrs = parse_tag_attributes(
                attr_tail,
                line=tag_start_line,
                violations=violations,
                tuned=tuned,
            )

            if tag_name.lower() == "root" and not attrs:
                violations.append(
                    A2uiXmlStrictViolation(
                        law="law1_implicit_root",
                        message="Do not wrap A2UI XML output in a <Root> tag (Law 1).",
                        line=tag_start_line,
                    )
                )
                continue

            elem = ElementNode(
                tag=tag_name,
                attrs=attrs,
                line=tag_start_line,
                self_closing=self_closing,
                closed=self_closing,
            )
            current_children().append(elem)
            if not self_closing:
                stack.append(elem)
            continue

        # 4. Prose / inline text up to newline or next structural `<Tag`
        text_start = pos
        text_line = line
        while pos < n and source[pos] != "\n":
            if (
                source[pos] == "<"
                and pos + 1 < n
                and (source[pos + 1].isalpha() or source[pos + 1] == "/")
                and not source.startswith("<http://", pos)
                and not source.startswith("<https://", pos)
                and not source.startswith("<mailto:", pos)
            ):
                break
            pos += 1

        if pos == n and not is_final:
            # Wait for complete prose line or closing tag before emitting prose
            break

        raw_prose = source[text_start:pos].strip()
        if raw_prose:
            if tokens_on_current_line > 0:
                violations.append(
                    A2uiXmlStrictViolation(
                        law="law2_verticality",
                        message=(
                            "Law 2 violation: never place prose text on the same line"
                            " as a <Tag>."
                        ),
                        line=text_line,
                    )
                )
            tokens_on_current_line += 1
            current_children().append(
                ProseNode(
                    text=unescape_xml_attr(raw_prose), kind="prose", line=text_line
                )
            )

    if is_final:
        while stack:
            unclosed = stack.pop()
            unclosed.closed = True
            violations.append(
                A2uiXmlStrictViolation(
                    law="unclosed_tag",
                    message=(
                        f"Unclosed tag <{unclosed.tag}> opened on line"
                        f" {unclosed.line} at end of block."
                    ),
                    line=unclosed.line,
                )
            )

    if strict and violations:
        first = violations[0]
        loc = f" (line {first.line})" if first.line is not None else ""
        raise A2uiXmlParseError(f"[{first.law}]{loc} {first.message}")

    return ParsedDocument(children=root_children, violations=violations)
