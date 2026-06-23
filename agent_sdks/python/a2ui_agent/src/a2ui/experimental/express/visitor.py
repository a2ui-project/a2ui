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

"""Custom AST visitor for A2UI Express."""

import re
from typing import Any, Optional
from antlr4 import *
from antlr4.error.ErrorListener import ErrorListener
from .generated.express_parser import ExpressParser
from .generated.express_visitor import ExpressVisitor


def _unescape_string(val: str) -> str:
  """Resolves only standard escape sequences: \\n, \\r, \\t, \\\\, and \\\".

  Any other escape sequences are treated as literal characters.
  """

  def repl(m):
    seq = m.group(0)
    char = m.group(1)
    if char == "n":
      return "\n"
    if char == "r":
      return "\r"
    if char == "t":
      return "\t"
    if char == "\\":
      return "\\"
    if char == '"':
      return '"'
    return seq

  return re.sub(r"\\([\s\S])", repl, val)


class ExpressAstVisitor(ExpressVisitor):
  """Traverses the ANTLR parse tree to construct the expected AST nodes."""

  def __init__(self, first_error_line: Optional[int] = None):
    super().__init__()
    self.first_error_line = first_error_line

  def visitProgram(self, ctx: ExpressParser.ProgramContext) -> list:
    # program : statement* EOF ;
    statements = []
    for stmt_ctx in ctx.statement():
      if (
          self.first_error_line is not None
          and stmt_ctx.start.line >= self.first_error_line
      ):
        break
      try:
        stmt = self.visit(stmt_ctx)
        if stmt is not None:
          statements.append(stmt)
      except Exception:
        pass
    return statements

  def visitStatement(self, ctx: ExpressParser.StatementContext):
    # statement : assignment | expression ;
    if ctx.assignment():
      return self.visit(ctx.assignment())
    if ctx.expression():
      return ("EXPR", self.visit(ctx.expression()))
    return None

  def visitAssignment(self, ctx: ExpressParser.AssignmentContext):
    # assignment : (identifier | path) '=' expression ;
    if ctx.identifier():
      target = ctx.identifier().getText()
    else:
      target = ctx.path().getText()

    value = self.visit(ctx.expression())
    return ("ASSIGN", target, value)

  def visitExpression(self, ctx: ExpressParser.ExpressionContext):
    # expression has exactly one child rule
    return self.visit(ctx.getChild(0))

  def visitArray(self, ctx: ExpressParser.ArrayContext) -> list:
    # array : '[' (expression (',' expression)*)? ','? ']' ;
    return [self.visit(expr) for expr in ctx.expression()]

  def visitMap(self, ctx: ExpressParser.MapContext) -> dict:
    # map : '{' (map_entry (',' map_entry)*)? ','? '}' ;
    res = {}
    for entry in ctx.map_entry():
      k, v = self.visit(entry)
      res[k] = v
    return res

  def visitMap_entry(self, ctx: ExpressParser.Map_entryContext) -> tuple[str, Any]:
    # map_entry : (identifier | string) ':' expression ;
    if ctx.identifier():
      k = ctx.identifier().getText()
    else:
      k = self.visit(ctx.string())

    v = self.visit(ctx.expression())
    return k, v

  def visitPath(self, ctx: ExpressParser.PathContext) -> dict:
    # path : PATH ;
    text = ctx.PATH().getText()
    return {"path": text[1:]}

  def visitCheck(self, ctx: ExpressParser.CheckContext) -> dict:
    # check : CHECK ('(' (expression (',' expression)*)? ','? ')')? ;
    name = ctx.CHECK().getText()[1:]  # strip ?
    args = []
    for expr in ctx.expression():
      args.append(self.visit(expr))
    return {"check": name, "args": args}

  def visitCall(self, ctx: ExpressParser.CallContext) -> dict:
    # call : identifier '(' (expression (',' expression)*)? ','? ')' ;
    name = ctx.identifier().getText()
    args = []
    for expr in ctx.expression():
      args.append(self.visit(expr))
    return {"call": name, "args": args}

  def visitVariable(self, ctx: ExpressParser.VariableContext) -> dict:
    # variable : '_' | identifier ;
    if ctx.identifier():
      name = ctx.identifier().getText()
      return {"variable": name}
    else:
      return {"skipped": True}

  def visitLiteral(self, ctx: ExpressParser.LiteralContext) -> Any:
    # literal : string | NUMBER | BOOLEAN | 'null' ;
    if ctx.string():
      return self.visit(ctx.string())
    if ctx.NUMBER():
      val = ctx.NUMBER().getText()
      return float(val) if "." in val else int(val)
    if ctx.BOOLEAN():
      return ctx.BOOLEAN().getText() == "true"
    return None

  def visitIdentifier(self, ctx: ExpressParser.IdentifierContext) -> str:
    # identifier : IDENTIFIER ;
    return ctx.IDENTIFIER().getText()

  def visitString(self, ctx: ExpressParser.StringContext) -> str:
    # string : RAW_TRIPLE_STRING | TRIPLE_STRING | RAW_STRING | STANDARD_STRING ;
    child = ctx.getChild(0)
    symbol = child.getSymbol()
    token_type = symbol.type
    val = symbol.text

    if token_type == ExpressParser.RAW_TRIPLE_STRING:
      # val starts with r""" or R""" and ends with """
      return val[4:-3]
    elif token_type == ExpressParser.RAW_STRING:
      # val starts with r" or R" and ends with "
      return val[2:-1]
    elif token_type == ExpressParser.TRIPLE_STRING:
      # val starts with """ and ends with """
      return _unescape_string(val[3:-3])
    elif token_type == ExpressParser.STANDARD_STRING:
      # val starts with " and ends with "
      return _unescape_string(val[1:-1])

    return val


class ExpressErrorListener(ErrorListener):
  """Custom ANTLR error listener that collects syntax errors."""

  def __init__(self):
    super().__init__()
    self.errors = []

  def syntaxError(self, recognizer, offendingSymbol, line, column, msg, e):
    is_lexer = isinstance(recognizer, Lexer)
    self.errors.append((line, column, msg, is_lexer))
