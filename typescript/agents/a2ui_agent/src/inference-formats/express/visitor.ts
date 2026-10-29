/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
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
 * AST nodes tagged by `kind` and collects syntax errors.
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

import {ExpressParseError} from './errors.js';
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
 * A dynamic data model path (e.g. `$/user/name` -> `{kind: 'path', path: '/user/name'}`).
 */
export interface ExpressPathNode {
  kind: 'path';
  path: string;
}

/**
 * A validation check rule expression (e.g. `?required` ->
 * `{kind: 'check', name: 'required', args: []}`).
 */
export interface ExpressCheckNode {
  kind: 'check';
  name: string;
  args: ExpressValue[];
}

/**
 * A variable reference (e.g. `title` -> `{kind: 'variable', name: 'title'}`).
 */
export interface ExpressVariableNode {
  kind: 'variable';
  name: string;
}

/**
 * The special skip placeholder `_` in argument positions.
 */
export interface ExpressSkippedNode {
  kind: 'skipped';
}

/**
 * A function or component invocation (e.g. `Text("hello", variant="bold")`).
 */
export interface ExpressCallNode {
  kind: 'call';
  name: string;
  args: ExpressValue[];
  kwargs: Record<string, ExpressValue>;
}

/**
 * A dictionary/map literal (e.g. `{a: 1, "b": 2}`).
 *
 * Map literals are wrapped rather than represented as plain objects so that
 * their keys, whatever they are, can never be mistaken for another node.
 */
export interface ExpressMapNode {
  kind: 'map';
  entries: Record<string, ExpressValue>;
}

/**
 * Discriminated union of every non-primitive, non-array AST node.
 */
export type ExpressNode =
  | ExpressPathNode
  | ExpressCheckNode
  | ExpressVariableNode
  | ExpressSkippedNode
  | ExpressCallNode
  | ExpressMapNode;

/**
 * Recursive type representing any expression value produced by the Express visitor.
 */
export type ExpressValue = ExpressPrimitiveValue | ExpressValue[] | ExpressNode;

/**
 * Checks whether a value is an AST node of the given kind.
 */
export function isExpressNode<K extends ExpressNode['kind']>(
  val: unknown,
  kind: K,
): val is Extract<ExpressNode, {kind: K}> {
  return (
    typeof val === 'object' &&
    val !== null &&
    !Array.isArray(val) &&
    (val as {kind?: unknown}).kind === kind
  );
}

/**
 * Sets `key` on `target` as an own, enumerable property.
 *
 * Unlike `target[key] = value`, this stores a key such as `__proto__` as data
 * rather than changing the object's prototype, so a map literal keeps every
 * key it is written with.
 */
export function setOwnEntry<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {value, enumerable: true, writable: true, configurable: true});
}

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
export type ExpressErrorRecord = [line: number, column: number, message: string, isLexer: boolean];

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
 * Reads the text of a `NUMBER` token as a number.
 *
 * The token grammar is a JSON number with an optional leading `+` (`42`, `-1`,
 * `.5`, `1.`, `2.5E+3`), which `Number()` reads as is. Integers beyond
 * ±(2^53 − 1) lose precision, as they do in JSON.
 *
 * @param text The matched token text.
 * @returns The value of the literal.
 * @throws {ExpressParseError} When the value is outside the double range (such
 *   as `1e999`), so that every SDK rejects the same literals.
 */
export function parseNumberLiteral(text: string): number {
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new ExpressParseError(`Number literal ${text} is out of range.`);
  }
  return value;
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
  readonly errors: ExpressErrorRecord[] = [];

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

  override visitMap = (ctx: MapContext): ExpressMapNode => {
    // map : '{' (map_entry (',' map_entry)*)? ','? '}' ;
    const entries: Record<string, ExpressValue> = {};
    for (const entry of ctx.map_entry()) {
      const [k, v] = this.visit(entry) as [string, ExpressValue];
      setOwnEntry(entries, k, v);
    }
    return {kind: 'map', entries};
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

  override visitPath = (ctx: PathContext): ExpressPathNode => {
    // path : PATH ;
    const text = ctx.PATH()!.getText();
    return {kind: 'path', path: text.slice(1)};
  };

  override visitCheck = (ctx: CheckContext): ExpressCheckNode => {
    // check : CHECK ('(' (expression (',' expression)*)? ','? ')')? ;
    const name = ctx.CHECK()!.getText().slice(1);
    const args: ExpressValue[] = [];
    for (const expr of ctx.expression()) {
      args.push(this.visit(expr) as ExpressValue);
    }
    return {kind: 'check', name, args};
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

  override visitCall = (ctx: CallContext): ExpressCallNode => {
    // call : identifier '(' (arg (',' arg)*)? ','? ')' ;
    const name = ctx.identifier()!.getText();
    const args: ExpressValue[] = [];
    const kwargs: Record<string, ExpressValue> = {};

    for (const argCtx of ctx.arg()) {
      const res = this.visit(argCtx);
      if (isArgKeyword(res)) {
        setOwnEntry(kwargs, res.key, res.value);
      } else if (isArgPositional(res)) {
        args.push(res.value);
      } else {
        // Python visitor.py appends any other result unconditionally.
        args.push((res ?? null) as ExpressValue);
      }
    }

    return {kind: 'call', name, args, kwargs};
  };

  override visitVariable = (ctx: VariableContext): ExpressVariableNode | ExpressSkippedNode => {
    // variable : '_' | identifier ;
    if (ctx.identifier()) {
      const name = ctx.identifier()!.getText();
      return {kind: 'variable', name};
    }
    return {kind: 'skipped'};
  };

  override visitLiteral = (ctx: LiteralContext): ExpressPrimitiveValue => {
    // literal : string | NUMBER | BOOLEAN | 'null' ;
    if (ctx.string()) {
      return this.visit(ctx.string()!) as string;
    }
    if (ctx.NUMBER()) {
      return parseNumberLiteral(ctx.NUMBER()!.getText());
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
      return unescapeString(val.slice(1, -1).replace(/^[\r\n]+|[\r\n]+$/g, ''));
    }
    return ctx.getText();
  };
}

const IDENT_START = 'a-zA-Z_';
const IDENT_CHARS = 'a-zA-Z0-9_';
const IDENTIFIER = `[${IDENT_START}][${IDENT_CHARS}]*`;

const SQL_COMMENT_OR_TOKEN_REGEX =
  /([rR]"""[\s\S]*?"""|[rR]"[^\r\n"]*"|"""(?:\\[\s\S]|[^\\])*?"""|"(?:\\[\s\S]|[^\\])*?"|(?:#|\/\/)[^\r\n]*|\/\*[\s\S]*?\*\/)|--([^\r\n]*)/g;
const DECLARED_LHS_REGEX = new RegExp(`^[ \\t]*(${IDENTIFIER})[ \\t]*=(?!=)`, 'gm');
const SPLIT_LHS_REGEX = new RegExp(
  `^([ \\t]*${IDENTIFIER})[ \\t]*(\\r?\\n)[ \\t]*([${IDENT_CHARS}]+)(?=[ \\t]*=(?!=))`,
  'gm',
);
const SPLIT_DATA_PATH_REGEX = new RegExp(
  '(\\$[' + IDENT_CHARS + '/]*/)[ \\t]*(\\r?\\n)[ \\t]*([' + IDENT_CHARS + '/]+)',
  'g',
);
const IDENT_ONLY_REGEX = new RegExp(`^${IDENTIFIER}$`);
const ASSIGN_EQUALS_REGEX = /^[ \t]*=(?!=)/;
const SPLIT_ARG_IDENT_REGEX = new RegExp(
  `([([,:=][ \\t]*\\r?\\n?[ \\t]*|[([,:=][ \\t]*)(${IDENTIFIER})[ \\t]*(\\r?\\n)[ \\t]*([${IDENT_CHARS}]+)(?=[ \\t]*[,)\\]}]|\\s*\\r?\\n)`,
  'g',
);

/**
 * Normalizes `--` comments and line-broken tokens outside strings and comments,
 * keeping line counts intact so syntax error positions match the original source.
 */
export function normalizeExpressSource(source: string): string {
  const segments: Array<{isTok: boolean; text: string}> = [];
  let pos = 0;
  for (const m of source.matchAll(SQL_COMMENT_OR_TOKEN_REGEX)) {
    const idx = m.index ?? 0;
    if (idx > pos) {
      segments.push({isTok: false, text: source.slice(pos, idx)});
    }
    if (m[1] !== undefined) {
      segments.push({isTok: true, text: m[1]});
    } else {
      segments.push({isTok: true, text: `//${m[2] ?? ''}`});
    }
    pos = idx + m[0].length;
  }
  if (pos < source.length) {
    segments.push({isTok: false, text: source.slice(pos)});
  }

  let depth = 0;
  const segDepths: number[][] = [];
  for (const seg of segments) {
    if (seg.isTok) {
      segDepths.push([]);
      continue;
    }
    const depths: number[] = [];
    for (let i = 0; i < seg.text.length; i++) {
      const ch = seg.text[i];
      depths.push(depth);
      if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
      } else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth > 0) depth--;
      }
    }
    segDepths.push(depths);
  }

  const splitP2Starts = new Set<string>();
  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx];
    if (!seg.isTok) {
      const depths = segDepths[segIdx];
      for (const m of seg.text.matchAll(SPLIT_LHS_REGEX)) {
        const fullIdx = m.index ?? 0;
        if (depths[fullIdx] === 0) {
          const p2Offset = fullIdx + m[0].length - m[3].length;
          splitP2Starts.add(`${segIdx}:${p2Offset}`);
        }
      }
    }
  }

  const directDeclared = new Set<string>();
  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx];
    if (!seg.isTok) {
      const depths = segDepths[segIdx];
      for (const m of seg.text.matchAll(DECLARED_LHS_REGEX)) {
        const fullIdx = m.index ?? 0;
        const identOffset = fullIdx + m[0].indexOf(m[1]);
        if (depths[identOffset] === 0 && !splitP2Starts.has(`${segIdx}:${identOffset}`)) {
          directDeclared.add(m[1]);
        }
      }
    }
  }

  const declared = new Set<string>(directDeclared);
  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx];
    if (!seg.isTok) {
      const depths = segDepths[segIdx];
      for (const m of seg.text.matchAll(SPLIT_LHS_REGEX)) {
        const fullIdx = m.index ?? 0;
        if (depths[fullIdx] === 0) {
          const p1 = m[1].trim();
          const p2 = m[3];
          if (!directDeclared.has(p1) && !directDeclared.has(p2)) {
            declared.add(p1 + p2);
          }
        }
      }
    }
  }

  const out: string[] = [];
  for (const seg of segments) {
    if (seg.isTok) {
      out.push(seg.text);
      continue;
    }
    let text = seg.text.replace(
      SPLIT_DATA_PATH_REGEX,
      (full, p1: string, nl: string, p2: string, offset: number, string: string) => {
        const rest = string.slice(offset + full.length);
        if (IDENT_ONLY_REGEX.test(p2) && ASSIGN_EQUALS_REGEX.test(rest)) {
          return full;
        }
        return `${p1}${p2}${nl}`;
      },
    );
    text = text.replace(SPLIT_LHS_REGEX, (full, p1Raw: string, nl: string, p2: string) => {
      const p1 = p1Raw.trim();
      if (!directDeclared.has(p1) && !directDeclared.has(p2)) {
        return `${p1Raw}${p2}${nl}`;
      }
      return full;
    });
    text = text.replace(
      SPLIT_ARG_IDENT_REGEX,
      (full, prefix: string, p1: string, nl: string, p2: string) => {
        const joined = p1 + p2;
        if (declared.has(joined) && !declared.has(p1) && !declared.has(p2)) {
          return `${prefix}${joined}${nl}`;
        }
        return full;
      },
    );
    out.push(text);
  }
  return out.join('');
}

/**
 * Parses Express DSL source into syntax errors and statements.
 *
 * Runs the parsing pipeline mirroring compiler.py:256-283.
 */
export function parseExpress(source: string): {
  errors: ExpressErrorRecord[];
  statements: ExpressStatement[];
} {
  const inputStream = CharStream.fromString(normalizeExpressSource(source));
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
