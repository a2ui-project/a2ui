/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Custom AST visitor and error listener for A2UI Express DSL.
 *
 * Ported from Python's visitor.py. Traverses the ANTLR parse tree to construct
 * JSON-identical AST nodes and collects syntax errors.
 */

import {
  type ATNSimulator,
  BaseErrorListener,
  CharStream,
  CommonTokenStream,
  Lexer,
  type RecognitionException,
  type Recognizer,
  type Token,
} from 'antlr4ng';

import {ExpressLexer} from './generated/ExpressLexer.js';
import {
  type ArgContext,
  type ArrayContext,
  type AssignmentContext,
  type CheckContext,
  type CallContext,
  type ExpressionContext,
  ExpressParser,
  type IdentifierContext,
  type LiteralContext,
  type MapContext,
  type Map_entryContext,
  type Named_argContext,
  type PathContext,
  type ProgramContext,
  type StatementContext,
  type StringContext,
  type VariableContext,
} from './generated/ExpressParser.js';
import {ExpressVisitor} from './generated/ExpressVisitor.js';

/**
 * Primitive literal values produced by the Express AST visitor.
 */
export type ExpressPrimitiveValue = string | number | boolean | null;

/**
 * A dynamic data model path value (e.g. `$/user/name` -> `{path: "/user/name"}`).
 */
export interface ExpressPathValue {
  path: string;
}

/**
 * A validation check rule expression (e.g. `?required` -> `{check: "required", args: []}`).
 */
export interface ExpressCheckValue {
  check: string;
  args: ExpressValue[];
}

/**
 * A variable reference (e.g. `title` -> `{variable: "title"}`).
 */
export interface ExpressVariableValue {
  variable: string;
}

/**
 * The special skip placeholder `_` in argument positions (`{skipped: true}`).
 */
export interface ExpressSkippedValue {
  skipped: true;
}

/**
 * A function or component invocation (e.g. `Text("hello", variant="bold")`).
 * Note: `kwargs` is omitted when empty, matching Python ExpressAstVisitor.
 */
export interface ExpressCallValue {
  call: string;
  args: ExpressValue[];
  kwargs?: Record<string, ExpressValue>;
}

/**
 * A dictionary/map literal (e.g. `{a: 1, "b": 2}`).
 */
export type ExpressMapValue = {
  [key: string]: ExpressValue;
};

/**
 * Recursive type representing any expression value produced by the Express visitor.
 */
export type ExpressValue =
  | ExpressPrimitiveValue
  | ExpressValue[]
  | ExpressPathValue
  | ExpressCheckValue
  | ExpressVariableValue
  | ExpressSkippedValue
  | ExpressCallValue
  | ExpressMapValue;

/**
 * Variable or data path assignment statement (e.g. `root = Column(...)` or `$/a/b = "c"`).
 */
export type ExpressAssignStatement = ['ASSIGN', string, ExpressValue];

/**
 * Standalone expression statement (e.g. `surface("main")`).
 */
export type ExpressExprStatement = ['EXPR', ExpressValue];

/**
 * Discriminated union of all statements produced by the Express visitor.
 */
export type ExpressStatement = ExpressAssignStatement | ExpressExprStatement;

/**
 * A syntax error tuple collected during lexing or parsing:
 * `[line, column, message, isLexer]`.
 */
export type ExpressSyntaxError = [line: number, column: number, message: string, isLexer: boolean];

interface ExpressArgKeyword {
  type: 'kw';
  key: string;
  value: ExpressValue;
}

interface ExpressArgPositional {
  type: 'pos';
  value: ExpressValue;
}

type ExpressArgIntermediate = ExpressArgKeyword | ExpressArgPositional;

function isArgKeyword(val: unknown): val is ExpressArgKeyword {
  return (
    typeof val === 'object' &&
    val !== null &&
    (val as ExpressArgKeyword).type === 'kw' &&
    typeof (val as ExpressArgKeyword).key === 'string'
  );
}

function isArgPositional(val: unknown): val is ExpressArgPositional {
  return typeof val === 'object' && val !== null && (val as ExpressArgPositional).type === 'pos';
}

/**
 * Resolves only standard escape sequences: \n, \r, \t, \\, and \".
 * Any other escape sequences are treated as literal characters.
 * Uses unicode flag (/u) to ensure surrogate pairs are not split.
 */
export function unescapeString(val: string): string {
  return val.replace(/\\([\s\S])/gu, (match, char: string) => {
    switch (char) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '\\':
        return '\\';
      case '"':
        return '"';
      default:
        return match;
    }
  });
}

/**
 * Custom ANTLR error listener that collects syntax errors as 4-tuples:
 * `[line, column, message, isLexer]`.
 */
export class ExpressErrorListener extends BaseErrorListener {
  readonly errors: ExpressSyntaxError[] = [];

  override syntaxError<S extends Token, T extends ATNSimulator>(
    recognizer: Recognizer<T>,
    _offendingSymbol: S | null,
    line: number,
    column: number,
    msg: string,
    _e: RecognitionException | null,
  ): void {
    const isLexer = recognizer instanceof Lexer;
    this.errors.push([line, column, msg, isLexer]);
  }
}

/**
 * Traverses the ANTLR parse tree to construct the expected AST nodes.
 */
export class ExpressAstVisitor extends ExpressVisitor<unknown> {
  readonly firstErrorLine?: number;

  constructor(firstErrorLine?: number) {
    super();
    this.firstErrorLine = firstErrorLine;
  }

  override visitProgram = (ctx: ProgramContext): ExpressStatement[] => {
    // program : statement* EOF ;
    const statements: ExpressStatement[] = [];
    for (const stmtCtx of ctx.statement()) {
      if (
        this.firstErrorLine !== undefined &&
        stmtCtx.start !== null &&
        stmtCtx.start.line >= this.firstErrorLine
      ) {
        break;
      }
      try {
        const stmt = this.visit(stmtCtx) as ExpressStatement | null;
        if (stmt !== null && stmt !== undefined) {
          statements.push(stmt);
        }
      } catch {
        // Python visitor.py:69-70 silently drops individual statements that fail to compile.
        // This is the error-isolation step of the error-recovery workflow.
      }
    }
    return statements;
  };

  override visitStatement = (ctx: StatementContext): ExpressStatement | null => {
    // statement : assignment | expression ;
    if (ctx.assignment()) {
      return this.visit(ctx.assignment()!) as ExpressStatement;
    }
    if (ctx.expression()) {
      return ['EXPR', this.visit(ctx.expression()!) as ExpressValue];
    }
    return null;
  };

  override visitAssignment = (ctx: AssignmentContext): ExpressAssignStatement => {
    // assignment : (identifier | path) '=' expression ;
    let target: string;
    if (ctx.identifier()) {
      target = ctx.identifier()!.getText();
    } else {
      target = ctx.path()!.getText();
    }
    const value = this.visit(ctx.expression()!) as ExpressValue;
    return ['ASSIGN', target, value];
  };

  override visitExpression = (ctx: ExpressionContext): ExpressValue => {
    // expression has exactly one child rule
    const child = ctx.getChild(0);
    return child ? (this.visit(child) as ExpressValue) : null;
  };

  override visitArray = (ctx: ArrayContext): ExpressValue[] => {
    // array : '[' (expression (',' expression)*)? ','? ']' ;
    return ctx.expression().map(expr => this.visit(expr) as ExpressValue);
  };

  override visitMap = (ctx: MapContext): ExpressMapValue => {
    // map : '{' (map_entry (',' map_entry)*)? ','? '}' ;
    const res: ExpressMapValue = {};
    for (const entry of ctx.map_entry()) {
      const [k, v] = this.visit(entry) as [string, ExpressValue];
      res[k] = v;
    }
    return res;
  };

  override visitMap_entry = (ctx: Map_entryContext): [string, ExpressValue] => {
    // map_entry : (identifier | string) ':' expression ;
    let k: string;
    if (ctx.identifier()) {
      k = ctx.identifier()!.getText();
    } else {
      k = this.visit(ctx.string()!) as string;
    }
    const v = this.visit(ctx.expression()!) as ExpressValue;
    return [k, v];
  };

  override visitPath = (ctx: PathContext): ExpressPathValue => {
    // path : PATH ;
    const text = ctx.PATH()!.getText();
    return {path: text.slice(1)};
  };

  override visitCheck = (ctx: CheckContext): ExpressCheckValue => {
    // check : CHECK ('(' (expression (',' expression)*)? ','? ')')? ;
    const name = ctx.CHECK()!.getText().slice(1);
    const args: ExpressValue[] = [];
    for (const expr of ctx.expression()) {
      args.push(this.visit(expr) as ExpressValue);
    }
    return {check: name, args};
  };

  override visitArg = (ctx: ArgContext): ExpressArgIntermediate => {
    // arg : named_arg | expression ;
    if (ctx.named_arg()) {
      const [k, v] = this.visit(ctx.named_arg()!) as [string, ExpressValue];
      return {type: 'kw', key: k, value: v};
    }
    return {
      type: 'pos',
      value: this.visit(ctx.expression()!) as ExpressValue,
    };
  };

  override visitNamed_arg = (ctx: Named_argContext): [string, ExpressValue] => {
    // named_arg : identifier '=' expression ;
    const k = ctx.identifier()!.getText();
    const v = this.visit(ctx.expression()!) as ExpressValue;
    return [k, v];
  };

  override visitCall = (ctx: CallContext): ExpressCallValue => {
    // call : identifier '(' (arg (',' arg)*)? ','? ')' ;
    const name = ctx.identifier()!.getText();
    const args: ExpressValue[] = [];
    const kwargs: Record<string, ExpressValue> = {};
    let hasKwargs = false;

    for (const argCtx of ctx.arg()) {
      const res = this.visit(argCtx);
      if (isArgKeyword(res)) {
        kwargs[res.key] = res.value;
        hasKwargs = true;
      } else if (isArgPositional(res)) {
        args.push(res.value);
      } else {
        // Python visitor.py appends any other result unconditionally.
        args.push((res ?? null) as ExpressValue);
      }
    }

    const node: ExpressCallValue = {call: name, args};
    if (hasKwargs) {
      node.kwargs = kwargs;
    }
    return node;
  };

  override visitVariable = (ctx: VariableContext): ExpressVariableValue | ExpressSkippedValue => {
    // variable : '_' | identifier ;
    if (ctx.identifier()) {
      const name = ctx.identifier()!.getText();
      return {variable: name};
    }
    return {skipped: true};
  };

  override visitLiteral = (ctx: LiteralContext): ExpressPrimitiveValue => {
    // literal : string | NUMBER | BOOLEAN | 'null' ;
    if (ctx.string()) {
      return this.visit(ctx.string()!) as string;
    }
    if (ctx.NUMBER()) {
      const val = ctx.NUMBER()!.getText();
      return Number(val);
    }
    if (ctx.BOOLEAN()) {
      return ctx.BOOLEAN()!.getText() === 'true';
    }
    return null;
  };

  override visitIdentifier = (ctx: IdentifierContext): string => {
    // identifier : IDENTIFIER ;
    return ctx.IDENTIFIER()!.getText();
  };

  override visitString = (ctx: StringContext): string => {
    // string : RAW_TRIPLE_STRING | TRIPLE_STRING | RAW_STRING | STANDARD_STRING ;
    if (ctx.RAW_TRIPLE_STRING()) {
      const val = ctx.RAW_TRIPLE_STRING()!.getText();
      return val.slice(4, -3);
    }
    if (ctx.RAW_STRING()) {
      const val = ctx.RAW_STRING()!.getText();
      return val.slice(2, -1);
    }
    if (ctx.TRIPLE_STRING()) {
      const val = ctx.TRIPLE_STRING()!.getText();
      return unescapeString(val.slice(3, -3));
    }
    if (ctx.STANDARD_STRING()) {
      const val = ctx.STANDARD_STRING()!.getText();
      return unescapeString(val.slice(1, -1));
    }
    return ctx.getText();
  };
}

/**
 * Parses Express DSL source into syntax errors and statements.
 *
 * Runs the parsing pipeline mirroring compiler.py:256-283.
 */
export function parseExpress(source: string): {
  errors: ExpressSyntaxError[];
  statements: ExpressStatement[];
} {
  const inputStream = CharStream.fromString(source);
  const lexer = new ExpressLexer(inputStream);
  const errorListener = new ExpressErrorListener();
  lexer.removeErrorListeners();
  lexer.addErrorListener(errorListener);

  const tokenStream = new CommonTokenStream(lexer);
  const parser = new ExpressParser(tokenStream);
  parser.removeErrorListeners();
  parser.addErrorListener(errorListener);

  const tree = parser.program();
  const firstErrorLine = errorListener.errors.length > 0 ? errorListener.errors[0][0] : undefined;
  const visitor = new ExpressAstVisitor(firstErrorLine);
  const statements = (visitor.visit(tree) as ExpressStatement[] | null) ?? [];

  return {
    errors: errorListener.errors,
    statements,
  };
}
