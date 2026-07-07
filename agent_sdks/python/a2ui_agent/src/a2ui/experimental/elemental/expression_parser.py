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

"""Expression parser for A2UI Elemental.

Subclasses the core ExpressionParser to support JSX-style expression syntax,
including array literals, object literals, and path bindings prefixed with '$'.
"""

from typing import Any, Dict, List, Union
from a2ui.core.basic_catalog.expression_parser import ExpressionParser, Scanner


class ElementalExpressionParser(ExpressionParser):
    """Parses JSX-style expressions wrapped in curly braces '{...}'."""

    def parse(self, input_str: str, depth: int = 0) -> Any:
        """Parses a complete expression string, stripping outer curly braces if present.

        Unlike the parent class, this does not perform general string interpolation.
        It expects the entire input to be either a plain string or a single expression
        wrapped in '{...}'.
        """
        if depth > self.MAX_DEPTH:
            raise ValueError("Max recursion depth reached in parse")

        trimmed = input_str.strip()
        if trimmed.startswith("{") and trimmed.endswith("}"):
            # Strip outer braces and parse the expression inside
            expr_content = trimmed[1:-1].strip()
            import re

            expr_content = re.sub(r"\[(\d+)\]", r"/\1", expr_content)
            return self.parse_expression(expr_content, depth + 1)

        # Return as plain string literal if not wrapped in braces
        return trimmed

    def _parse_expression_internal(self, scanner: Scanner, depth: int) -> Any:
        scanner.skip_whitespace()
        if scanner.is_at_end():
            return ""

        # 1. Array Literal: Starts with '['
        if scanner.matches_string("["):
            return self.parse_array_literal(scanner, depth)

        # 2. Object Literal: Starts with '{'
        if scanner.matches_string("{"):
            return self.parse_object_literal(scanner, depth)

        # 3. Path Binding: Starts with '$'
        if scanner.matches_string("$"):
            scanner.advance()  # Skip '$'
            path = self.scan_path_or_identifier(scanner)
            return {"path": path}

        # Delegate to parent for primitives, identifiers, and function calls
        return super()._parse_expression_internal(scanner, depth)

    def parse_array_literal(self, scanner: Scanner, depth: int) -> List[Any]:
        """Parses an array literal: [expr1, expr2, ...]"""
        scanner.match("[")
        scanner.skip_whitespace()

        arr = []
        while not scanner.is_at_end() and scanner.peek() != "]":
            val = self._parse_expression_internal(scanner, depth + 1)
            arr.append(val)

            scanner.skip_whitespace()
            if scanner.peek() == ",":
                scanner.advance()
                scanner.skip_whitespace()

        if not scanner.match("]"):
            raise ValueError("Expected ']' at end of array literal")

        return arr

    def parse_function_call(
        self, func_name: str, scanner: Scanner, depth: int
    ) -> Dict[str, Any]:
        """Parses a function call, supporting both positional and named arguments.

        If an argument is not followed by a colon ':', it is treated as a positional
        argument.
        """
        scanner.match("(")
        scanner.skip_whitespace()

        args = {}
        positional_args = []

        while not scanner.is_at_end() and scanner.peek() != ")":
            start_pos = scanner.pos

            # Try to scan as a named argument: identifier followed by ':'
            arg_name = self.scan_identifier(scanner)
            scanner.skip_whitespace()

            if arg_name and scanner.match(":"):
                scanner.skip_whitespace()
                val = self._parse_expression_internal(scanner, depth)
                args[arg_name] = val
            else:
                # Positional argument: backtrack and parse as expression
                scanner.pos = start_pos
                val = self._parse_expression_internal(scanner, depth)
                positional_args.append(val)

            scanner.skip_whitespace()
            if scanner.peek() == ",":
                scanner.advance()
                scanner.skip_whitespace()

        if not scanner.match(")"):
            raise ValueError(f"Expected ')' after function arguments for '{func_name}'")

        if positional_args and args:
            raise ValueError(
                "Cannot mix positional and named arguments in function call"
                f" '{func_name}'"
            )

        if positional_args:
            return {"call": func_name, "args": positional_args, "returnType": "any"}
        return {"call": func_name, "args": args, "returnType": "any"}

    def parse_object_literal(self, scanner: Scanner, depth: int) -> Dict[str, Any]:
        """Parses an object literal: {key1: val1, key2: val2, ...}"""
        scanner.match("{")
        scanner.skip_whitespace()

        obj = {}
        while not scanner.is_at_end() and scanner.peek() != "}":
            # Scan key: can be a string literal or an identifier
            if scanner.matches_string("'") or scanner.matches_string('"'):
                key = self.parse_string_literal(scanner)
            else:
                key = self.scan_identifier(scanner)

            if not key:
                raise ValueError("Expected key in object literal")

            scanner.skip_whitespace()
            if not scanner.match(":"):
                raise ValueError(f"Expected ':' after key '{key}' in object literal")
            scanner.skip_whitespace()

            val = self._parse_expression_internal(scanner, depth + 1)
            obj[key] = val

            scanner.skip_whitespace()
            if scanner.peek() == ",":
                scanner.advance()
                scanner.skip_whitespace()

        if not scanner.match("}"):
            raise ValueError("Expected '}' at end of object literal")

        return obj
