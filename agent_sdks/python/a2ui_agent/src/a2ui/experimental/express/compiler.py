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

"""Compilation engine for A2UI Express.

Tokenizes, lexes, and parses A2UI Express plain-text statements into a clean
AST, compiling it directly into standard A2UI v1.0 JSON messages.
"""

import re
from typing import Any, Optional
from .schema_helper import CatalogSchemaHelper
from .constants import SurfaceOperation


def _set_nested_path(d: dict, path_str: str, val: Any) -> None:
  """Populates a nested dictionary path from a JSON pointer-like string."""
  if path_str.startswith("$/"):
    clean_path = path_str[2:]
  elif path_str.startswith("$"):
    clean_path = path_str[1:]
  else:
    clean_path = path_str

  if not clean_path:
    return

  keys = clean_path.split("/")
  current = d
  for key in keys[:-1]:
    if key not in current or not isinstance(current[key], dict):
      current[key] = {}
    current = current[key]
  current[keys[-1]] = val


def schema_allows_databinding(schema: Any) -> bool:
  """Recursively checks if a property's schema allows a dynamic DataBinding ref."""
  if not isinstance(schema, dict):
    return False
  if "$ref" in schema:
    ref = schema["$ref"]
    if isinstance(ref, str) and ("DataBinding" in ref or "Dynamic" in ref):
      return True
  if "properties" in schema and "path" in schema["properties"]:
    if "componentId" not in schema["properties"]:
      return True
  for key in ["allOf", "oneOf", "anyOf"]:
    if key in schema and isinstance(schema[key], list):
      for sub in schema[key]:
        if schema_allows_databinding(sub):
          return True
  return False


def schema_expects_option_objects(schema: Any) -> bool:
  """Checks if a property's schema expects a list of objects with label/value properties."""
  if not isinstance(schema, dict):
    return False
  if "items" in schema:
    items_schema = schema["items"]

    def has_label_value(sub: Any) -> bool:
      if not isinstance(sub, dict):
        return False
      if (
          "properties" in sub
          and "label" in sub["properties"]
          and "value" in sub["properties"]
      ):
        return True
      for k in ["allOf", "oneOf", "anyOf"]:
        if k in sub and isinstance(sub[k], list):
          if any(has_label_value(s) for s in sub[k]):
            return True
      return False

    return has_label_value(items_schema)
  for key in ["allOf", "oneOf", "anyOf"]:
    if key in schema and isinstance(schema[key], list):
      if any(schema_expects_option_objects(sub) for sub in schema[key]):
        return True
  return False


def is_check_expression(val: Any) -> bool:
  """Checks if a parsed AST value represents a validation check expression."""
  if isinstance(val, dict) and "check" in val:
    return True
  if isinstance(val, list) and val:
    return all(is_check_expression(item) for item in val)
  return False


# Scanner rules for lexical tokenizing
TOKEN_SPEC = [
    ("RAW_TRIPLE_STRING", r'[rR]"""(?:(?!"""(?!"))[\s\S])*"""(?!")'),
    ("RAW_STRING", r'[rR]"[^"]*"'),
    ("TRIPLE_STRING", r'"""(?:(?!"""(?!"))(?:[^\\]|\\[\s\S]))*"""(?!")'),
    ("STRING", r'"(?:[^"\\]|\\.)*"'),
    # Unclosed string fallback rules (must be defined AFTER closed strings)
    ("UNCLOSED_RAW_TRIPLE_STRING", r'[rR]"""[\s\S]*'),
    ("UNCLOSED_RAW_STRING", r'[rR]"[^"]*'),
    ("UNCLOSED_TRIPLE_STRING", r'"""[\s\S]*'),
    ("UNCLOSED_STRING", r'"(?:[^"\\]|\\.)*'),
    ("COMMENT", r"(?:#|//).*"),
    ("PATH", r"\$[a-zA-Z0-9_/]*"),
    ("CHECK", r"\?[a-zA-Z_][a-zA-Z0-9_]*"),
    ("NUMBER", r"-?\d+(?:\.\d+)?"),
    ("BOOLEAN", r"\b(?:true|false)\b"),
    ("NULL", r"\bnull\b"),
    ("IDENTIFIER", r"[^\W\d]\w*"),
    ("LPAREN", r"\("),
    ("RPAREN", r"\)"),
    ("LBRACKET", r"\["),
    ("RBRACKET", r"\]"),
    ("COMMA", r","),
    ("EQUALS", r"="),
    ("COLON", r":"),
    ("LBRACE", r"\{"),
    ("RBRACE", r"\}"),
    ("WS", r"[ \t]+"),
    ("NEWLINE", r"[\r\n]+"),
]


def _unescape_string(val: str) -> str:
  """Resolves only standard escape sequences: \\n, \\t, \\\\, and \\\".

  Any other escape sequences are treated as literal characters.
  """

  def repl(m):
    seq = m.group(0)
    char = m.group(1)
    if char == "n":
      return "\n"
    if char == "t":
      return "\t"
    if char == "\\":
      return "\\"
    if char == '"':
      return '"'
    return seq

  return re.sub(r"\\(.)", repl, val)


def tokenize(text: str, is_final: bool = True) -> list[tuple[str, Any]]:
  """Tokenizes plain text into a list of scanning tokens.

  Args:
      text: The source line to tokenize.

  Returns:
      A list of token tuples matching (TokenKind, TokenValue).
  """
  tok_regex = "|".join(f"(?P<{name}>{pattern})" for name, pattern in TOKEN_SPEC)
  tokens = []
  last_end = 0
  for mo in re.finditer(tok_regex, text):
    if mo.start() != last_end:
      raise SyntaxError(f"Unexpected character: {text[last_end:mo.start()]!r}")
    kind = mo.lastgroup
    val = mo.group()
    last_end = mo.end()
    if kind in ("WS", "COMMENT"):
      continue
    elif kind == "RAW_TRIPLE_STRING":
      kind = "STRING"
      val = val[4:-3]
    elif kind == "RAW_STRING":
      kind = "STRING"
      val = val[2:-1]
    elif kind == "TRIPLE_STRING":
      kind = "STRING"
      val = _unescape_string(val[3:-3])
    elif kind == "STRING":
      val = _unescape_string(val[1:-1])
    elif kind == "UNCLOSED_RAW_TRIPLE_STRING":
      kind = "INCOMPLETE_STRING"
      val = val[4:]
    elif kind == "UNCLOSED_RAW_STRING":
      kind = "INCOMPLETE_STRING"
      val = val[2:]
    elif kind == "UNCLOSED_TRIPLE_STRING":
      kind = "INCOMPLETE_STRING"
      val = _unescape_string(val[3:])
    elif kind == "UNCLOSED_STRING":
      kind = "INCOMPLETE_STRING"
      val = _unescape_string(val[1:])
    elif kind == "NUMBER":
      val = float(val) if "." in val else int(val)
    elif kind == "BOOLEAN":
      val = val == "true"
    elif kind == "NULL":
      val = None
    tokens.append((kind, val))
  if last_end < len(text):
    if is_final:
      raise SyntaxError(f"Unexpected character: {text[last_end:]!r}")
  return tokens


class TokenParser:
  """Recursive-descent parser for A2UI Express expressions.

  Parses tokenized structures (calls, arrays, maps, data paths, primitives)
  into intermediate syntax trees.
  """

  def __init__(self, tokens: list[tuple[str, Any]]):
    """Initializes the parser with the scanner token list.

    Args:
        tokens: The scanner token list.
    """
    self.tokens = tokens
    self.pos = 0

  def peek(self) -> Optional[tuple[str, Any]]:
    """Returns the current token without consuming it.

    Returns:
        The current token tuple, or None if at EOF.
    """
    if self.pos < len(self.tokens):
      return self.tokens[self.pos]
    return None

  def consume(self, kind: Optional[str] = None) -> tuple[str, Any]:
    """Consumes the current token, asserting its type if requested.

    Args:
        kind: Optional token kind to assert.

    Returns:
        The consumed token tuple.

    Raises:
        SyntaxError: If the token is missing or does not match kind.
    """
    tok = self.peek()
    if not tok:
      raise SyntaxError("Unexpected end of input")
    if kind and tok[0] != kind:
      raise SyntaxError(f"Expected {kind}, got {tok[0]}: {tok[1]}")
    self.pos += 1
    return tok

  def parse_expression(self) -> Any:
    """Parses a standalone expression.

    Returns:
        The parsed expression AST node.

    Raises:
        SyntaxError: If the expression structure is invalid.
    """
    tok = self.peek()
    if not tok:
      raise SyntaxError("Expected expression")

    kind, val = tok
    if kind == "LBRACKET":
      return self.parse_array()
    if kind == "LBRACE":
      return self.parse_map()
    if kind == "PATH":
      self.consume()
      return {"path": val[1:]}
    if kind == "CHECK":
      return self.parse_check()
    if kind == "IDENTIFIER":
      self.consume()
      next_tok = self.peek()
      if next_tok and next_tok[0] == "LPAREN":
        return self.parse_call(val)
      if val == "_":
        return {"skipped": True}
      return {"variable": val}
    if kind in ("STRING", "NUMBER", "BOOLEAN", "NULL"):
      self.consume()
      return val
    raise SyntaxError(f"Unexpected token {kind}: {val}")

  def parse_array(self) -> list:
    """Parses an array of expressions.

    Returns:
        A list of parsed expression AST nodes.
    """
    self.consume("LBRACKET")
    items = []
    if self.peek() and self.peek()[0] != "RBRACKET":
      items.append(self.parse_expression())
      while self.peek() and self.peek()[0] == "COMMA":
        self.consume("COMMA")
        items.append(self.parse_expression())
    self.consume("RBRACKET")
    return items

  def parse_check(self) -> dict:
    """Parses a check validation expression.

    Returns:
        A check rule AST dictionary.
    """
    tok = self.consume("CHECK")
    name = tok[1][1:]  # strip ?
    next_tok = self.peek()
    args = []
    if next_tok and next_tok[0] == "LPAREN":
      self.consume("LPAREN")
      if self.peek() and self.peek()[0] != "RPAREN":
        args.append(self.parse_expression())
        while self.peek() and self.peek()[0] == "COMMA":
          self.consume("COMMA")
          args.append(self.parse_expression())
      self.consume("RPAREN")
    return {"check": name, "args": args}

  def parse_call(self, name: str) -> dict:
    """Parses a component or function call.

    Args:
        name: The identifier name of the component or function.

    Returns:
        A call AST dictionary.
    """
    self.consume("LPAREN")
    args = []
    if self.peek() and self.peek()[0] != "RPAREN":
      args.append(self.parse_expression())

      while self.peek() and self.peek()[0] == "COMMA":
        self.consume("COMMA")
        args.append(self.parse_expression())
    self.consume("RPAREN")
    return {"call": name, "args": args}

  def parse_map(self) -> dict:
    """Parses a key-value dictionary block.

    Returns:
        A dictionary mapping string keys to parsed expressions.
    """
    self.consume("LBRACE")
    res = {}
    if self.peek() and self.peek()[0] != "RBRACE":
      next_tok = self.peek()
      if next_tok[0] not in ("IDENTIFIER", "STRING"):
        raise SyntaxError(f"Expected IDENTIFIER or STRING key, got {next_tok[0]}")
      k_tok = self.consume()
      self.consume("COLON")
      v = self.parse_expression()
      res[k_tok[1]] = v
      while self.peek() and self.peek()[0] == "COMMA":
        self.consume("COMMA")
        next_tok = self.peek()
        if next_tok[0] not in ("IDENTIFIER", "STRING"):
          raise SyntaxError(f"Expected IDENTIFIER or STRING key, got {next_tok[0]}")
        k_tok = self.consume()
        self.consume("COLON")
        v = self.parse_expression()
        res[k_tok[1]] = v
    self.consume("RBRACE")
    return res


class _CompileContext:
  """Holds mutable state for a single compiler execution thread."""

  def __init__(self):
    self.extra_components: list[dict] = []
    self.inline_counter: int = 0
    self.active_value_path: Optional[dict] = None


class ExpressCompiler:
  """Compilation pipeline for A2UI Express.

  Resolves positional parameters dynamically, flattens variable references into
  an adjacency list widget tree, and constructs valid A2UI v1.0 JSON payloads.

  Attributes:
      helper: A CatalogSchemaHelper loaded with the target catalog definition.
  """

  def __init__(self, catalog_path: str):
    """Initializes the compiler with the specified catalog schema.

    Args:
        catalog_path: The absolute filesystem path to the catalog JSON file.
    """
    self.helper = CatalogSchemaHelper(catalog_path)

  def compile(
      self,
      dsl_text: str,
      surface_id: str = "default_surface",
      catalog_id: str = "",
      is_final: bool = True,
  ) -> dict:
    """Compiles plain A2UI Express DSL into standard A2UI v1.0 wire JSON.

    Args:
        dsl_text: The source A2UI Express DSL text block.
        surface_id: The unique identifier for the compiled user interface surface.
        catalog_id: The URI/identifier of the schema catalog to reference.

    Returns:
        The standard A2UI v1.0 JSON envelope.

    Raises:
        ValueError: If the root component variable is missing.
    """
    ctx = _CompileContext()
    # Detect if sentinel tags exist in the input
    has_sentinels = "<a2ui>" in dsl_text
    lines = []
    inside_a2ui = not has_sentinels
    for line in dsl_text.splitlines():
      trimmed = line.strip()
      if "<a2ui>" in trimmed:
        inside_a2ui = True
        line = line.replace("<a2ui>", "")
        trimmed = line.strip()
      if "</a2ui>" in trimmed:
        inside_a2ui = False
        line = line.split("</a2ui>")[0]
        if line.strip():
          lines.append(line)
        continue
      if inside_a2ui:
        lines.append(line)

    dsl_body = "\n".join(lines)

    # Tokenize the entire text block
    tokens = tokenize(dsl_body, is_final=is_final)

    statements = []
    current_statement = []
    open_p = 0
    open_b = 0
    open_c = 0
    has_incomplete_token = False

    for tok_kind, tok_val in tokens:
      if tok_kind == "NEWLINE":
        if (
            current_statement
            and open_p <= 0
            and open_b <= 0
            and open_c <= 0
            and not has_incomplete_token
        ):
          statements.append(current_statement)
          current_statement = []
        continue

      if tok_kind == "LPAREN":
        open_p += 1
      elif tok_kind == "RPAREN":
        open_p -= 1
      elif tok_kind == "LBRACKET":
        open_b += 1
      elif tok_kind == "RBRACKET":
        open_b -= 1
      elif tok_kind == "LBRACE":
        open_c += 1
      elif tok_kind == "RBRACE":
        open_c -= 1
      elif tok_kind == "INCOMPLETE_STRING":
        has_incomplete_token = True
        if is_final:
          raise SyntaxError("Unterminated string literal.")

      current_statement.append((tok_kind, tok_val))

    # For streaming compatibility: compile the last statement only if complete and balanced
    if current_statement:
      if open_p <= 0 and open_b <= 0 and open_c <= 0 and not has_incomplete_token:
        statements.append(current_statement)
      elif is_final:
        if has_incomplete_token:
          raise SyntaxError("Unterminated string literal at end of input.")
        raise SyntaxError(
            f"Unbalanced symbols at end of input (open parentheses: {open_p}, "
            f"open brackets: {open_b}, open braces: {open_c})."
        )

    raw_symbols = {}
    data_path_assignments = {}
    target_delete_surface_id = None
    standalone_function_calls = []

    # Token parser loop
    for tokens in statements:
      if not tokens:
        continue

      if (
          len(tokens) >= 2
          and tokens[0][0] in ("IDENTIFIER", "PATH")
          and tokens[1][0] == "EQUALS"
      ):
        var_name = tokens[0][1]
        expr_tokens = tokens[2:]
        try:
          parser = TokenParser(expr_tokens)
          parsed_val = parser.parse_expression()
          if var_name.startswith("$"):
            data_path_assignments[var_name] = parsed_val
          else:
            raw_symbols[var_name] = parsed_val
        except Exception as e:
          raise ValueError(
              f"Failed to parse expression for variable '{var_name}': {e}"
          ) from e
      else:
        try:
          parser = TokenParser(tokens)
          parsed_val = parser.parse_expression()
          if isinstance(parsed_val, dict) and parsed_val.get("call") == "deleteSurface":
            args = parsed_val.get("args", [])
            if args and isinstance(args[0], str):
              target_delete_surface_id = args[0]
          elif isinstance(parsed_val, dict) and "call" in parsed_val:
            standalone_function_calls.append(parsed_val)
        except Exception as e:
          raise ValueError(f"Failed to parse expression: {e}") from e

    # Compile data model paths
    data_model = {}
    for path_name, ast_val in data_path_assignments.items():
      compiled_val = self._compile_value(ast_val, raw_symbols, ctx)
      _set_nested_path(data_model, path_name, compiled_val)

    if target_delete_surface_id is not None:
      return {
          "version": "v1.0",
          SurfaceOperation.DELETE: {"surfaceId": target_delete_surface_id},
      }

    if standalone_function_calls:
      first_call = standalone_function_calls[0]
      ctx.inline_counter += 1
      compiled_val = self._compile_value(first_call, raw_symbols, ctx, is_action=False)
      return {
          "version": "v1.0",
          "functionCallId": f"call_{ctx.inline_counter}",
          SurfaceOperation.CALL_FUNC: {
              "call": compiled_val.get("call"),
              "args": compiled_val.get("args", {}),
          },
      }

    compiled_components = []

    # Adjacency list flattening starting at root
    if "root" not in raw_symbols:
      if data_path_assignments:
        return {
            "version": "v1.0",
            SurfaceOperation.UPDATE_DATA: {
                "surfaceId": surface_id,
                "path": "/",
                "value": data_model,
            },
        }
      raise ValueError(
          "A2UI Express source must define a 'root' variable or have data model path"
          " assignments."
      )

    for var_name, ast in raw_symbols.items():
      comp_dict = self._compile_ast_node(var_name, ast, raw_symbols, ctx)
      if comp_dict:
        compiled_components.append(comp_dict)

    compiled_components.extend(ctx.extra_components)

    # Resolve catalog ID
    if not catalog_id:
      catalog_id = self.helper.catalog.get("catalogId", "https://a2ui.org/catalog.json")

    envelope = {
        "version": "v1.0",
        SurfaceOperation.CREATE: {
            "surfaceId": surface_id,
            "catalogId": catalog_id,
            "components": compiled_components,
        },
    }
    if data_model:
      envelope[SurfaceOperation.CREATE]["dataModel"] = data_model

    return envelope

  def _compile_ast_node(
      self, var_name: str, ast: Any, raw_symbols: dict, ctx: _CompileContext
  ) -> Optional[dict]:
    """Compiles a single variable's AST node into standard component format.

    Args:
        var_name: The variable identifier (which becomes the component ID).
        ast: The parsed expression AST node.
        raw_symbols: A dictionary containing all other parsed variables.
        ctx: The active compiler execution context.

    Returns:
        The compiled component JSON dictionary, or None if it is not a component.
    """
    if not isinstance(ast, dict) or "call" not in ast:
      return None

    comp_name = ast["call"]
    args = ast["args"]

    if comp_name not in self.helper.components:
      # Not a component, could be a standalone action/helper; skip writing as component
      return None

    properties = self.helper.get_component_properties(comp_name)
    comp_dict = {"id": var_name, "component": comp_name}

    # Sibling path tracking for check rules
    sibling_value_path = None

    non_check_properties = [p for p in properties if p != "checks"]
    raw_checks = []

    # Map positional arguments
    prop_idx = 0
    for arg in args:
      if is_check_expression(arg):
        if isinstance(arg, list):
          raw_checks.extend(arg)
        else:
          raw_checks.append(arg)
        continue

      if prop_idx < len(non_check_properties):
        prop_name = non_check_properties[prop_idx]
        prop_idx += 1

        if isinstance(arg, dict) and arg.get("skipped"):
          comp_dict[prop_name] = None
          continue

        mapped_val = self._compile_value(
            arg, raw_symbols, ctx, is_action=(prop_name in ["action", "submitAction"])
        )
        prop_schema = self.helper.get_property_schema(comp_name, prop_name)
        if prop_schema and not schema_allows_databinding(prop_schema):
          if (
              isinstance(mapped_val, dict)
              and "path" in mapped_val
              and "componentId" not in mapped_val
          ):
            raise ValueError(
                f"Property '{prop_name}' of component '{comp_name}' does not support"
                " dynamic data bindings (paths). You must provide a static value/array"
                " instead."
            )
          if isinstance(mapped_val, list) and schema_expects_option_objects(
              prop_schema
          ):
            mapped_val = [
                {"label": opt, "value": opt} if isinstance(opt, str) else opt
                for opt in mapped_val
            ]
        enum_vals = self.helper.get_property_enum(comp_name, prop_name)
        if enum_vals and isinstance(mapped_val, str) and mapped_val not in enum_vals:
          mapped_val = None
        comp_dict[prop_name] = mapped_val

        if (
            prop_name == "value"
            and isinstance(mapped_val, dict)
            and "path" in mapped_val
        ):
          sibling_value_path = mapped_val

    # Set active path for nested check compile resolution
    ctx.active_value_path = sibling_value_path

    # Second pass: compile checks with implicit path injection
    if raw_checks:
      compiled_checks = []
      for rc in raw_checks:
        if isinstance(rc, dict) and "check" in rc:
          check_name = rc["check"]
          check_args = rc["args"]
          compiled_args = {}

          check_props = self.helper.get_function_properties(check_name)
          message_val = f"{check_name.capitalize()} check failed"

          explicit_args = list(check_args)
          is_value_injected = False

          # Handle implicit target 'value' injection
          if check_props and check_props[0] == "value":
            if (
                explicit_args
                and isinstance(explicit_args[0], dict)
                and "path" in explicit_args[0]
            ):
              pass
            else:
              if sibling_value_path:
                compiled_args["value"] = sibling_value_path
                is_value_injected = True

          start_prop_idx = 1 if is_value_injected else 0

          for c_idx, c_arg in enumerate(explicit_args):
            prop_target_idx = c_idx + start_prop_idx
            if prop_target_idx < len(check_props):
              prop_name = check_props[prop_target_idx]
              prop_schema = self.helper.get_function_property_schema(
                  check_name, prop_name
              )
              is_message = False
              if isinstance(c_arg, str) and prop_schema:
                expected_type = prop_schema.get("type")
                if expected_type in ["integer", "number", "boolean"]:
                  is_message = True

              if is_message:
                message_val = c_arg
                break

              if isinstance(c_arg, dict) and c_arg.get("skipped"):
                compiled_args[prop_name] = None
                continue
              compiled_args[prop_name] = self._compile_value(c_arg, raw_symbols, ctx)
            else:
              if isinstance(c_arg, str):
                message_val = c_arg

          compiled_checks.append({
              "condition": {"call": check_name, "args": compiled_args},
              "message": message_val,
          })
      if compiled_checks:
        comp_dict["checks"] = compiled_checks

    ctx.active_value_path = None
    return {k: v for k, v in comp_dict.items() if v is not None}

  def _compile_value(
      self, val: Any, raw_symbols: dict, ctx: _CompileContext, is_action: bool = False
  ) -> Any:
    """Compiles an individual AST node value into valid A2UI equivalents.

    Args:
        val: The parsed AST node value.
        raw_symbols: The parsed global variable symbol table.
        ctx: The active compiler execution context.
        is_action: Whether this value lies inside a component Action field.

    Returns:
        The semantically correct A2UI JSON structure.
    """
    if isinstance(val, dict):
      if "path" in val:
        return val
      if "variable" in val:
        ref_name = val["variable"]
        if ref_name in raw_symbols:
          symbol_val = raw_symbols[ref_name]
          if (
              isinstance(symbol_val, dict)
              and symbol_val.get("call") in self.helper.components
          ):
            return ref_name
          return self._compile_value(symbol_val, raw_symbols, ctx, is_action)
        return ref_name
      if "check" in val:
        check_name = val["check"]
        check_args = val.get("args", [])

        compiled_args = {}
        check_props = self.helper.get_function_properties(check_name)

        explicit_args = list(check_args)
        is_value_injected = False

        if check_props:
          if check_props[0] == "value":
            if not (
                explicit_args
                and isinstance(explicit_args[0], dict)
                and "path" in explicit_args[0]
            ):
              if ctx.active_value_path:
                compiled_args["value"] = ctx.active_value_path
                is_value_injected = True

          start_prop_idx = 1 if is_value_injected else 0
          for c_idx, c_arg in enumerate(explicit_args):
            prop_target_idx = c_idx + start_prop_idx
            if prop_target_idx < len(check_props):
              prop_name = check_props[prop_target_idx]
              prop_schema = self.helper.get_function_property_schema(
                  check_name, prop_name
              )
              is_message = False
              if isinstance(c_arg, str) and prop_schema:
                expected_type = prop_schema.get("type")
                if expected_type in ["integer", "number", "boolean"]:
                  is_message = True

              if is_message:
                break

              if isinstance(c_arg, dict) and c_arg.get("skipped"):
                continue
              compiled_args[prop_name] = self._compile_value(
                  c_arg, raw_symbols, ctx, is_action
              )

        return {"call": check_name, "args": compiled_args}
      if "call" in val:
        # Nested function call (e.g. formatString or actions)
        fn_name = val["call"]
        fn_args = val["args"]

        # Is it an inline component constructor?
        if fn_name in self.helper.components:
          ctx.inline_counter += 1
          inline_id = f"_inline_{ctx.inline_counter}"
          compiled_inline = self._compile_ast_node(inline_id, val, raw_symbols, ctx)
          if compiled_inline:
            ctx.extra_components.append(compiled_inline)
          return inline_id

        # Is it a reserved Template signature?
        if fn_name == "_template":
          if len(fn_args) < 2:
            raise ValueError(
                "_template helper requires exactly 2 arguments: path and"
                " templateComponent."
            )
          path_val = self._compile_value(fn_args[0], raw_symbols, ctx, is_action)
          comp_id_val = self._compile_value(fn_args[1], raw_symbols, ctx, is_action)
          return {"path": path_val["path"], "componentId": comp_id_val}

        # Is it a reserved Event signature?
        if fn_name == "Event":
          event_name = fn_args[0] if len(fn_args) > 0 else ""
          context_map = fn_args[1] if len(fn_args) > 1 else {}
          compiled_context = {}
          if isinstance(context_map, dict):
            for k, v in context_map.items():
              compiled_context[k] = self._compile_value(v, raw_symbols, ctx, is_action)
          elif isinstance(context_map, list):
            for item in context_map:
              if isinstance(item, dict):
                for k, v in item.items():
                  compiled_context[k] = self._compile_value(
                      v, raw_symbols, ctx, is_action
                  )
          return {"event": {"name": event_name, "context": compiled_context}}

        # Is it a regular catalog function?
        if fn_name in self.helper.functions:
          fn_props = self.helper.get_function_properties(fn_name)
          compiled_args = {}
          for idx, arg in enumerate(fn_args):
            if idx < len(fn_props):
              if isinstance(arg, dict) and arg.get("skipped"):
                continue
              val_item = self._compile_value(arg, raw_symbols, ctx, is_action)
              if val_item is not None:
                compiled_args[fn_props[idx]] = val_item

          # Wrap in functionCall only if inside an action field
          if is_action:
            return {"functionCall": {"call": fn_name, "args": compiled_args}}

          # Otherwise, compile direct dynamic function call expression
          res_expr = {"call": fn_name, "args": compiled_args}
          return res_expr

        # Fallback
        return {
            "call": fn_name,
            "args": [
                self._compile_value(a, raw_symbols, ctx, is_action) for a in fn_args
            ],
        }

      return {
          k: self._compile_value(v, raw_symbols, ctx, is_action) for k, v in val.items()
      }

    if isinstance(val, list):
      # If this is a list of elements, compile each element
      compiled_list = []
      for item in val:
        comp_item = self._compile_value(item, raw_symbols, ctx, is_action)
        compiled_list.append(comp_item)
      return compiled_list

    return val
