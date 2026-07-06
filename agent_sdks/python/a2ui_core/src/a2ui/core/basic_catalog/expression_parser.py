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

import re
from typing import Any, Dict, List, Union


class Scanner:

    def __init__(self, input_str: str) -> None:
        self.input = input_str
        self.pos = 0

    def is_at_end(self) -> bool:
        return self.pos >= len(self.input)

    def peek(self, offset: int = 0) -> str:
        if self.pos + offset >= len(self.input):
            return "\0"
        return self.input[self.pos + offset]

    def advance(self, count: int = 1) -> str:
        chars = self.input[self.pos : self.pos + count]
        self.pos += count
        return chars

    def match(self, expected: str) -> bool:
        if self.peek() == expected:
            self.advance()
            return True
        return False

    def matches(self, expected: str) -> bool:
        return self.input.startswith(expected, self.pos)

    def matches_string(self, expected: str) -> bool:
        return self.peek() == expected

    def matches_keyword(self, keyword: str) -> bool:
        if self.input.startswith(keyword, self.pos):
            next_char = self.peek(len(keyword))
            if not re.match(r"[a-zA-Z0-9_]", next_char):
                self.advance(len(keyword))
                return True
        return False

    def skip_whitespace(self) -> None:
        while not self.is_at_end() and self.peek().isspace():
            self.advance()


class ExpressionParser:
    MAX_DEPTH = 10

    def parse(self, input_str: str, depth: int = 0) -> List[Any]:
        if depth > self.MAX_DEPTH:
            raise ValueError("Max recursion depth reached in parse")
        if not input_str or "${" not in input_str:
            return [input_str] if input_str else []

        parts = []
        scanner = Scanner(input_str)

        while not scanner.is_at_end():
            if scanner.matches("${"):
                scanner.advance(2)
                content = self.extract_interpolation_content(scanner)
                parsed = self.parse_expression(content, depth + 1)
                if parsed is not None and parsed != "":
                    parts.append(parsed)
            elif (
                scanner.peek() == "\\"
                and scanner.peek(1) == "$"
                and scanner.peek(2) == "{"
            ):
                scanner.advance()
                parts.append("${")
                scanner.advance(2)
            else:
                start = scanner.pos
                while not scanner.is_at_end():
                    if scanner.matches("${"):
                        break
                    if (
                        scanner.peek() == "\\"
                        and scanner.peek(1) == "$"
                        and scanner.peek(2) == "{"
                    ):
                        break
                    scanner.advance()
                text_content = scanner.input[start : scanner.pos]
                if text_content:
                    parts.append(text_content)

        return [p for p in parts if p is not None and p != ""]

    def extract_interpolation_content(self, scanner: Scanner) -> str:
        start = scanner.pos
        brace_balance = 1

        while not scanner.is_at_end() and brace_balance > 0:
            char = scanner.advance()
            if char == "{":
                brace_balance += 1
            elif char == "}":
                brace_balance -= 1
            elif char == "'" or char == '"':
                quote = char
                while not scanner.is_at_end():
                    c = scanner.advance()
                    if c == "\\":
                        scanner.advance()
                    elif c == quote:
                        break

        if brace_balance > 0:
            raise ValueError("Unclosed interpolation: missing '}'")

        return scanner.input[start : scanner.pos - 1]

    def parse_expression(self, expr: str, depth: int = 0) -> Any:
        if depth > self.MAX_DEPTH:
            raise ValueError("Max recursion depth reached in parse")
        expr = expr.strip()
        if not expr:
            return ""

        scanner = Scanner(expr)
        result = self._parse_expression_internal(scanner, depth)
        if not scanner.is_at_end():
            raise ValueError(
                f"Unexpected characters at end of expression: '{scanner.input[scanner.pos:]}'"
            )
        return result

    def _parse_expression_internal(self, scanner: Scanner, depth: int) -> Any:
        scanner.skip_whitespace()
        if scanner.is_at_end():
            return ""

        # 0. Nested Interpolation (Block)
        if scanner.matches("${"):
            scanner.advance(2)
            content = self.extract_interpolation_content(scanner)
            return self.parse_expression(content, depth + 1)

        # 1. Literals
        if scanner.matches_string("'") or scanner.matches_string('"'):
            return self.parse_string_literal(scanner)
        if self.is_digit(scanner.peek()) or (
            scanner.peek() == "-" and self.is_digit(scanner.peek(1))
        ):
            return self.parse_number_literal(scanner)
        if scanner.matches_keyword("true"):
            return True
        if scanner.matches_keyword("false"):
            return False
        if scanner.matches_keyword("null"):
            return ""

        # 2. Identifiers (Function calls or Path starts)
        token = self.scan_path_or_identifier(scanner)
        scanner.skip_whitespace()

        if scanner.peek() == "(":
            return self.parse_function_call(token, scanner, depth)
        else:
            if not token:
                return ""
            return {"path": token}

    def scan_path_or_identifier(self, scanner: Scanner) -> str:
        start = scanner.pos
        while not scanner.is_at_end():
            c = scanner.peek()
            if self.is_alnum(c) or c in ("/", ".", "_", "-"):
                scanner.advance()
            else:
                break
        return scanner.input[start : scanner.pos]

    def parse_function_call(
        self, func_name: str, scanner: Scanner, depth: int
    ) -> Dict[str, Any]:
        scanner.match("(")
        scanner.skip_whitespace()

        args = {}

        while not scanner.is_at_end() and scanner.peek() != ")":
            arg_name = self.scan_identifier(scanner)
            scanner.skip_whitespace()
            if not scanner.match(":"):
                raise ValueError(
                    f"Expected ':' after argument name '{arg_name}' in function '{func_name}'"
                )
            scanner.skip_whitespace()

            args[arg_name] = self._parse_expression_internal(scanner, depth)

            scanner.skip_whitespace()
            if scanner.peek() == ",":
                scanner.advance()
                scanner.skip_whitespace()

        if not scanner.match(")"):
            raise ValueError(f"Expected ')' after function arguments for '{func_name}'")

        return {"call": func_name, "args": args, "returnType": "any"}

    def scan_identifier(self, scanner: Scanner) -> str:
        start = scanner.pos
        while not scanner.is_at_end() and (
            self.is_alnum(scanner.peek()) or scanner.peek() == "_"
        ):
            scanner.advance()
        return scanner.input[start : scanner.pos]

    def parse_string_literal(self, scanner: Scanner) -> str:
        quote = scanner.advance()
        result = ""
        while not scanner.is_at_end():
            c = scanner.advance()
            if c == "\\":
                next_c = scanner.advance()
                if next_c == "n":
                    result += "\n"
                elif next_c == "t":
                    result += "\t"
                elif next_c == "r":
                    result += "\r"
                else:
                    result += next_c
            elif c == quote:
                break
            else:
                result += c
        return result

    def parse_number_literal(self, scanner: Scanner) -> Union[int, float]:
        start = scanner.pos
        if scanner.peek() == "-":
            scanner.advance()
        while not scanner.is_at_end() and (
            self.is_digit(scanner.peek()) or scanner.peek() == "."
        ):
            scanner.advance()
        num_str = scanner.input[start : scanner.pos]
        if "." in num_str:
            return float(num_str)
        return int(num_str)

    def is_alnum(self, c: str) -> bool:
        return ("a" <= c <= "z") or ("A" <= c <= "Z") or ("0" <= c <= "9")

    def is_digit(self, c: str) -> bool:
        return "0" <= c <= "9"
