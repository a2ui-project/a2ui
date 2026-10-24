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
 * @fileoverview Compilation engine for A2UI Express DSL.
 *
 * Tokenizes, lexes, and parses A2UI Express plain-text statements into an AST,
 * compiling it directly into standard A2UI wire messages.
 *
 * Ported from origin/main's Python compiler.py.
 */

import {A2uiCatalogError} from '../../errors.js';
import {
  isValidUax31Identifier,
  normalizeVersionString,
  type AgentToRendererMessage,
  type CatalogApi,
} from '../../internal/web-core.js';
import {
  buildSchemaHelpers,
  catalogsDefining,
  resolveExpressVersion,
  surfaceCatalogId,
  toCatalogList,
  unknownCatalogError,
  unknownSymbolError,
} from './catalogs.js';
import {
  ExpressDuplicateParamError,
  ExpressDuplicatePropertyError,
  ExpressForbiddenDatabindingError,
  ExpressIdCollisionError,
  ExpressInvalidParamError,
  ExpressMissingRequiredPropertyError,
  ExpressParseError,
  ExpressSyntaxError,
  ExpressUndefinedRootError,
  ExpressUnknownPropertyError,
  ExpressValidationError,
} from './errors.js';
import {
  CatalogSchemaHelper,
  expectsOptionObjects,
  isActionSlot,
  type ReservedKeys,
} from './schema-helper.js';
import {
  isExpressNode,
  parseExpress,
  setOwnEntry,
  type ExpressCallNode,
  type ExpressCheckNode,
  type ExpressStatement,
  type ExpressValue,
} from './visitor.js';

/**
 * Standard A2UI surface operation envelope keys matching Python's SurfaceOperation.
 */
const SurfaceOperation = {
  CREATE: 'createSurface',
  UPDATE_COMPONENTS: 'updateComponents',
  DELETE: 'deleteSurface',
  UPDATE_DATA: 'updateDataModel',
  CALL_FUNC: 'callFunction',
  SURFACE: 'surface',
} as const;

/**
 * Populates a nested dictionary path from a JSON pointer-like string (compiler.py:48-73).
 *
 * @param d The target dictionary to mutate.
 * @param pathStr The data path string (e.g. "$/user/name").
 * @param val The value to set at the specified path.
 */
export function setNestedPath(d: Record<string, unknown>, pathStr: string, val: unknown): void {
  let cleanPath = pathStr;
  if (cleanPath.startsWith('$/')) {
    cleanPath = cleanPath.slice(2);
  } else if (cleanPath.startsWith('$')) {
    cleanPath = cleanPath.slice(1);
  }

  if (!cleanPath) {
    return;
  }

  const keys = cleanPath.split('/');
  let current = d;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (
      !(key in current) ||
      typeof current[key] !== 'object' ||
      current[key] === null ||
      Array.isArray(current[key])
    ) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = val;
}

/**
 * Checks if a parsed AST value represents a validation check expression (compiler.py:154-160).
 */
export function isCheckExpression(val: unknown): boolean {
  if (isExpressNode(val, 'check')) {
    return true;
  }
  if (Array.isArray(val) && val.length > 0) {
    return val.every(isCheckExpression);
  }
  return false;
}

/**
 * Parses numeric major.minor.patch components from a version string.
 */
/**
 * Checks whether an AST value is a `$path`, directly or through variables.
 *
 * A map literal is data even when its compiled value looks like a data binding, so it is not a
 * path.
 */
function resolvesToPath(node: unknown, rawSymbols: Record<string, unknown>): boolean {
  const seen = new Set<string>();
  let current = node;
  while (isExpressNode(current, 'variable')) {
    if (seen.has(current.name) || !Object.hasOwn(rawSymbols, current.name)) {
      return false;
    }
    seen.add(current.name);
    current = rawSymbols[current.name];
  }
  return isExpressNode(current, 'path');
}

function parseVersionNumbers(v: string): number[] {
  const norm = normalizeVersionString(v);
  if (!norm) {
    return [0, 0, 0];
  }
  const core = norm.split('-')[0].split('+')[0];
  return core.split('.').map(n => parseInt(n, 10) || 0);
}

/**
 * Checks if a given version string is at least the target minimum version.
 */
function isAtLeastVersion(version: string, minVersion: string): boolean {
  const vNums = parseVersionNumbers(version);
  const minNums = parseVersionNumbers(minVersion);
  const len = Math.max(vNums.length, minNums.length);
  for (let i = 0; i < len; i++) {
    const a = vNums[i] ?? 0;
    const b = minNums[i] ?? 0;
    if (a !== b) {
      return a > b;
    }
  }
  return true;
}

/**
 * Formats an error for wrapping in another error's message. Syntax errors carry their
 * line number, which their own message leaves out.
 */
export function formatErrorMessage(e: unknown): string {
  if (e instanceof ExpressSyntaxError) {
    return `${e.message} (line ${e.line})`;
  }
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

/**
 * Formats a value for an error message: strings as they are, anything else as JSON.
 */
function formatValue(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * Casts raw compiler message envelopes to AgentToRendererMessage.
 * Python reproduces several behaviours that do not strictly match the standard TS message type
 * (such as standalone function calls emitting top-level functionCallId and callFunction).
 * Per spec Wave 2a line 37: "cast deliberately in ONE small helper with a comment citing this spec".
 */
function asAgentToRendererMessage(msg: Record<string, unknown>): AgentToRendererMessage {
  return msg as unknown as AgentToRendererMessage;
}

/**
 * Holds mutable state for a single compiler execution pass (compiler.py:166-173).
 */
class CompileContext {
  extraComponents: Record<string, unknown>[] = [];
  generatedIds: Set<string> = new Set();
  inlineCounter = 0;
  /** Compiled data bindings of the component being compiled, by property name. */
  activeBoundPaths: Map<string, Record<string, unknown>> = new Map();
  /** The variables whose values are being compiled, to catch a variable whose value refers back to it. */
  readonly resolving: Set<string> = new Set();
  readonly keys: ReservedKeys;

  constructor(keys: ReservedKeys) {
    this.keys = keys;
  }
}

/**
 * Holds symbols and data path assignments for a target surface scope (compiler.py:175-183).
 */
class SurfaceScope {
  readonly surfaceId: string;
  readonly sendDataModel?: boolean;
  readonly update: boolean;
  readonly rawSymbols: Record<string, unknown> = {};
  readonly dataPathAssignments: Record<string, unknown> = {};

  constructor(surfaceId: string, sendDataModel?: boolean, update = false) {
    this.surfaceId = surfaceId;
    this.sendDataModel = sendDataModel;
    this.update = update;
  }
}

type CompilationUnit =
  | {kind: 'scope'; scope: SurfaceScope}
  | {kind: 'delete'; surfaceId: string}
  | {kind: 'call'; stmt: ExpressCallNode; scope: SurfaceScope | null};

/**
 * Compilation pipeline for A2UI Express.
 *
 * Resolves positional parameters dynamically, flattens variable references into
 * an adjacency list component tree, and constructs valid A2UI JSON payloads.
 */
export class ExpressCompiler {
  readonly helpers: Map<string, CatalogSchemaHelper>;
  readonly catalogs: CatalogApi[];
  readonly version: string;

  /**
   * @param catalogs The active catalog, or several.
   * @param version The protocol version to emit. Defaults to the catalogs' version.
   */
  constructor(catalogs: CatalogApi | CatalogApi[], version?: string) {
    this.catalogs = toCatalogList(catalogs);
    this.version = resolveExpressVersion(this.catalogs, version);
    this.helpers = buildSchemaHelpers(this.catalogs, this.version);
  }

  /**
   * Checks whether a call names a component rather than a function across active catalogs.
   */
  private definesComponent(name: string, explicitCatalogId: unknown): boolean {
    if (typeof explicitCatalogId === 'string' && this.helpers.has(explicitCatalogId)) {
      return this.helpers.get(explicitCatalogId)!.components.has(name);
    }
    return catalogsDefining(this.helpers, 'component', name).length > 0;
  }

  /**
   * Checks whether a call names a function across active catalogs or in the named catalog.
   */
  private definesFunction(name: string, explicitCatalogId: unknown): boolean {
    if (explicitCatalogId !== undefined) {
      return (
        typeof explicitCatalogId === 'string' &&
        (this.helpers.get(explicitCatalogId)?.functions.has(name) ?? false)
      );
    }
    return catalogsDefining(this.helpers, 'function', name).length > 0;
  }

  /**
   * Resolves a component or function symbol against the active catalogs.
   */
  private resolveSymbol(
    kind: 'component' | 'function',
    name: string,
    explicitCatalogId: unknown,
    targetMajorMinor: [number, number],
  ): {helper: CatalogSchemaHelper; catalogId?: string} {
    const label = kind === 'component' ? 'Component' : 'Function';
    if (explicitCatalogId !== undefined) {
      if (targetMajorMinor[0] < 1) {
        throw new ExpressValidationError(
          'catalogId on a component or function call is only supported in A2UI v1.0 or later.',
        );
      }
      if (typeof explicitCatalogId !== 'string' || !explicitCatalogId) {
        throw new ExpressValidationError(
          `catalogId on ${kind} '${name}' must be a non-empty string.`,
        );
      }
      const helper = this.helpers.get(explicitCatalogId);
      if (!helper) {
        throw unknownCatalogError(`${label} '${name}'`, explicitCatalogId, this.catalogs);
      }
      const defs = kind === 'component' ? helper.components : helper.functions;
      if (!defs.has(name)) {
        throw unknownSymbolError(kind, name, explicitCatalogId, this.helpers);
      }
      return {helper, catalogId: explicitCatalogId};
    }

    const matches = catalogsDefining(this.helpers, kind, name);
    if (matches.length > 1) {
      const ids = matches.map(c => `'${c}'`).join(', ');
      throw new ExpressValidationError(
        `${label} '${name}' is defined in several catalogs: ${ids}. Name the catalog to use with a catalogId argument.`,
      );
    }
    if (matches.length === 0) {
      throw unknownSymbolError(kind, name, undefined, this.helpers);
    }
    const cid = matches[0];
    return {
      helper: this.helpers.get(cid)!,
      catalogId: this.catalogs.length > 1 ? cid : undefined,
    };
  }

  /**
   * Parses and validates a `surface(...)` statement.
   */
  private parseSurfaceCall(callVal: ExpressCallNode): {
    surfaceId: string;
    catalogId: string;
    sendDataModel?: boolean;
    update: boolean;
  } {
    const args = callVal.args;
    const kwargs = callVal.kwargs;

    if (args.length === 0) {
      throw new ExpressValidationError(
        'surface() requires at least 1 argument: surface("surface_id").',
      );
    }
    if (args.length > 2) {
      throw new ExpressValidationError(
        'surface() takes at most 2 positional arguments: surface(id) or surface(id, catalogId).',
      );
    }
    const surfaceId = args[0];
    if (typeof surfaceId !== 'string') {
      throw new ExpressValidationError('The first argument to surface() must be a string literal.');
    }

    let catalogId = '';
    if (args.length === 2) {
      if ('catalogId' in kwargs) {
        throw new ExpressValidationError(
          'Duplicate catalogId in surface(): specified both positionally and as a keyword argument.',
        );
      }
      if (typeof args[1] !== 'string') {
        throw new ExpressValidationError(
          'The second argument to surface() must be a catalog ID string.',
        );
      }
      catalogId = args[1];
    }

    let sendDataModel: boolean | undefined;
    let update = false;

    for (const [k, val] of Object.entries(kwargs)) {
      if (k === 'catalogId') {
        if (typeof val !== 'string') {
          throw new ExpressValidationError('The catalogId argument to surface() must be a string.');
        }
        catalogId = val;
      } else if (k === 'sendDataModel') {
        if (typeof val !== 'boolean') {
          throw new ExpressValidationError(
            'The sendDataModel argument to surface() must be a boolean.',
          );
        }
        sendDataModel = val;
      } else if (k === 'update') {
        if (typeof val !== 'boolean') {
          throw new ExpressValidationError('The update argument to surface() must be a boolean.');
        }
        update = val;
      } else {
        throw new ExpressValidationError(`Unknown keyword argument '${k}' in surface().`);
      }
    }

    if (catalogId) {
      if (this.catalogs.length > 1) {
        throw new ExpressValidationError(
          `surface() names catalog '${catalogId}', but a surface names no catalog when several catalogs are active. Component and function names resolve across the active catalogs, or take catalogId="..." when shared.`,
        );
      }
      if (catalogId !== this.catalogs[0].id) {
        throw unknownCatalogError(`Surface '${surfaceId}'`, catalogId, this.catalogs);
      }
    }

    return {surfaceId, catalogId, sendDataModel, update};
  }

  /**
   * Compiles plain A2UI Express DSL into standard A2UI wire messages.
   *
   * @param dslText The source A2UI Express DSL text block.
   * @param surfaceId The unique identifier for the compiled surface.
   * @param isFinal Whether this is the final compilation pass.
   * @param version Target version override ("v0.9", "v0.9.1", or "v1.0").
   * @returns A list of standard A2UI wire JSON message dicts.
   */
  compile(
    dslText: string,
    surfaceId = 'default_surface',
    isFinal = true,
    version?: string,
  ): AgentToRendererMessage[] {
    const targetVersion = version ? resolveExpressVersion(this.catalogs, version) : this.version;
    const vNums = parseVersionNumbers(targetVersion);
    const targetMajorMinor: [number, number] = [vNums[0] ?? 0, vNums[1] ?? 0];
    if (this.catalogs.length > 1 && targetMajorMinor[0] < 1) {
      throw new A2uiCatalogError(
        `Several catalogs need A2UI v1.0 or later, where components and function calls carry their own catalogId, but got '${targetVersion}'.`,
      );
    }

    const defaultKeys: ReservedKeys =
      targetMajorMinor[0] >= 1 ? {path: '@path', call: '@call'} : {path: 'path', call: 'call'};
    const ctx = new CompileContext(defaultKeys);

    // Sentinel tag stripping (compiler.py:235-254; load-bearing per plan §9)
    const hasSentinels = dslText.includes('<a2ui>');
    const lines: string[] = [];
    let insideA2ui = !hasSentinels;
    for (const line of dslText.split(/\r?\n/)) {
      let curLine = line;
      let trimmed = curLine.trim();
      if (trimmed.includes('<a2ui>')) {
        insideA2ui = true;
        curLine = curLine.replace('<a2ui>', '');
        trimmed = curLine.trim();
      }
      if (trimmed.includes('</a2ui>')) {
        insideA2ui = false;
        curLine = curLine.split('</a2ui>')[0];
        if (curLine.trim()) {
          lines.push(curLine);
        }
        continue;
      }
      if (insideA2ui) {
        lines.push(curLine);
      }
    }

    const dslBody = lines.join('\n');

    // ANTLR parsing and AST construction (compiler.py:256-291)
    let statements: ExpressStatement[] = [];
    try {
      const parsed = parseExpress(dslBody);
      if (isFinal && parsed.errors.length > 0) {
        const [line, col, msg, isLexer] = parsed.errors[0];
        const err = new ExpressSyntaxError(
          `Syntax error at line ${line}:${col}: ${msg}`,
          line,
          col,
          isLexer,
        );
        throw err;
      }
      statements = parsed.statements;
    } catch (e: unknown) {
      if (!isFinal) {
        // Sanctioned swallow (compiler.py:286): when isFinal is false, syntax errors
        // during visitor execution are suppressed and statements becomes [].
        statements = [];
      } else {
        if (e instanceof ExpressSyntaxError && e.isLexer) {
          throw e;
        }
        const innerMsg = formatErrorMessage(e);
        const parseErr = new ExpressParseError(`Failed to parse expression: ${innerMsg}`);
        // Set ES2022 cause after construction matching Python's `raise ... from e`
        (parseErr as unknown as {cause?: unknown}).cause = e;
        throw parseErr;
      }
    }

    const units: CompilationUnit[] = [];
    let currentScope: SurfaceScope | null = null;

    for (const stmt of statements) {
      const [stmtType, ...stmtArgs] = stmt;
      if (stmtType === 'EXPR') {
        const parsedVal = stmtArgs[0];
        if (isExpressNode(parsedVal, 'call') && parsedVal.name === 'surface') {
          const parsed = this.parseSurfaceCall(parsedVal);
          currentScope = new SurfaceScope(parsed.surfaceId, parsed.sendDataModel, parsed.update);
          units.push({kind: 'scope', scope: currentScope});
        } else if (isExpressNode(parsedVal, 'call') && parsedVal.name === 'deleteSurface') {
          const args = parsedVal.args;
          const kwargs = parsedVal.kwargs;
          let targetDeleteSurfaceId: string | null = null;
          if (args.length > 0 && typeof args[0] === 'string') {
            targetDeleteSurfaceId = args[0];
          } else if (typeof kwargs.surfaceId === 'string') {
            targetDeleteSurfaceId = kwargs.surfaceId;
          }
          if (!targetDeleteSurfaceId) {
            throw new ExpressValidationError(
              'deleteSurface() requires the id of the surface to delete.',
            );
          }
          units.push({kind: 'delete', surfaceId: targetDeleteSurfaceId});
        } else if (isExpressNode(parsedVal, 'call')) {
          units.push({
            kind: 'call',
            stmt: parsedVal,
            scope: currentScope,
          });
        }
      } else if (stmtType === 'ASSIGN') {
        const [varName, parsedVal] = stmtArgs as [string, ExpressValue];
        if (currentScope === null) {
          currentScope = new SurfaceScope(surfaceId);
          units.push({kind: 'scope', scope: currentScope});
        }
        if (varName.startsWith('$')) {
          currentScope.dataPathAssignments[varName] = parsedVal;
        } else {
          setOwnEntry(currentScope.rawSymbols, varName, parsedVal);
        }
      }
    }

    if (units.length === 0) {
      throw new ExpressUndefinedRootError('root');
    }

    const resultMessages: AgentToRendererMessage[] = [];
    let callCounter = 0;

    for (const unit of units) {
      if (unit.kind === 'delete') {
        resultMessages.push(
          asAgentToRendererMessage({
            version: targetVersion,
            [SurfaceOperation.DELETE]: {surfaceId: unit.surfaceId},
          }),
        );
      } else if (unit.kind === 'call') {
        if (targetMajorMinor[0] === 0 && targetMajorMinor[1] <= 9) {
          throw new ExpressValidationError(
            'Standalone function calls are not supported in A2UI v0.9',
          );
        }
        callCounter += 1;
        const rawSyms = unit.scope ? unit.scope.rawSymbols : {};
        const [compiledVal, explicitCallId] = this.compileFunctionCall(
          unit.stmt,
          rawSyms,
          new Map(),
          ctx,
          targetMajorMinor,
          false,
          true,
        );
        const callFunction: Record<string, unknown> = {
          catalogId: (compiledVal.catalogId as string | undefined) ?? this.catalogs[0].id,
          ...compiledVal,
        };
        resultMessages.push(
          asAgentToRendererMessage({
            version: targetVersion,
            callRendererFunction: {
              functionCallId: explicitCallId ?? `call_${callCounter}`,
              callFunction,
            },
          }),
        );
      } else {
        resultMessages.push(...this.compileScope(unit.scope, ctx, targetVersion, targetMajorMinor));
      }
    }

    return resultMessages;
  }

  /**
   * Compiles a single surface scope into createSurface, updateComponents, and/or updateDataModel messages.
   */
  private compileScope(
    scope: SurfaceScope,
    ctx: CompileContext,
    targetVersion: string,
    targetMajorMinor: [number, number],
  ): AgentToRendererMessage[] {
    const scopeSurfId = scope.surfaceId;
    const catalogId = surfaceCatalogId(this.catalogs);

    const compIds = new Map<string, string>();
    for (const [varName, ast] of Object.entries(scope.rawSymbols)) {
      if (isExpressNode(ast, 'call')) {
        const compName = ast.name;
        const explicitId = ast.kwargs.id;
        if (explicitId !== undefined) {
          if (typeof explicitId !== 'string' || explicitId.length === 0) {
            throw new ExpressValidationError(
              `id on component '${compName}' must be a non-empty string.`,
            );
          }
          if (targetMajorMinor[0] >= 1 && !isValidUax31Identifier(explicitId)) {
            throw new ExpressValidationError(
              `Component id '${explicitId}' on '${compName}' is not a valid UAX 31 identifier.`,
            );
          }
        }
        if (this.definesComponent(compName, ast.kwargs.catalogId)) {
          compIds.set(varName, (explicitId as string | undefined) ?? varName);
        }
      }
    }

    // Compile data model paths (compiler.py:401-405)
    const dataModel: Record<string, unknown> = {};
    for (const [pathName, astVal] of Object.entries(scope.dataPathAssignments)) {
      const compiledVal = this._compileValue(
        astVal,
        scope.rawSymbols,
        compIds,
        ctx,
        targetMajorMinor,
        false,
      );
      setNestedPath(dataModel, pathName, compiledVal);
    }

    const compiledComponents: Record<string, unknown>[] = [];
    for (const [varName, ast] of Object.entries(scope.rawSymbols)) {
      const compDict = this._compileAstNode(
        varName,
        ast,
        scope.rawSymbols,
        compIds,
        ctx,
        targetMajorMinor,
      );
      if (compDict) {
        compiledComponents.push(compDict);
      }
    }

    compiledComponents.push(...ctx.extraComponents);
    ctx.extraComponents = [];

    const resultMessages: AgentToRendererMessage[] = [];
    const hasRootComponent = compiledComponents.some(c => c.id === 'root');

    if (scope.update || !hasRootComponent) {
      if (compiledComponents.length === 0) {
        if (Object.keys(scope.dataPathAssignments).length > 0) {
          return [
            asAgentToRendererMessage({
              version: targetVersion,
              [SurfaceOperation.UPDATE_DATA]: {
                surfaceId: scopeSurfId,
                path: '/',
                value: dataModel,
              },
            }),
          ];
        }
        throw new ExpressUndefinedRootError('root');
      }
      resultMessages.push(
        asAgentToRendererMessage({
          version: targetVersion,
          [SurfaceOperation.UPDATE_COMPONENTS]: {
            surfaceId: scopeSurfId,
            components: compiledComponents,
          },
        }),
      );
      if (Object.keys(dataModel).length > 0) {
        resultMessages.push(
          asAgentToRendererMessage({
            version: targetVersion,
            [SurfaceOperation.UPDATE_DATA]: {
              surfaceId: scopeSurfId,
              path: '/',
              value: dataModel,
            },
          }),
        );
      }
      return resultMessages;
    }

    const createPayload: Record<string, unknown> = {
      surfaceId: scopeSurfId,
    };
    if (catalogId !== undefined) {
      createPayload.catalogId = catalogId;
    }
    if (scope.sendDataModel !== undefined) {
      createPayload.sendDataModel = scope.sendDataModel;
    }

    if (isAtLeastVersion(targetVersion, 'v1.0')) {
      createPayload.components = compiledComponents;
      if (Object.keys(dataModel).length > 0) {
        createPayload.dataModel = dataModel;
      }
      resultMessages.push(
        asAgentToRendererMessage({
          version: targetVersion,
          [SurfaceOperation.CREATE]: createPayload,
        }),
      );
    } else {
      resultMessages.push(
        asAgentToRendererMessage({
          version: targetVersion,
          [SurfaceOperation.CREATE]: createPayload,
        }),
        asAgentToRendererMessage({
          version: targetVersion,
          [SurfaceOperation.UPDATE_COMPONENTS]: {
            surfaceId: scopeSurfId,
            components: compiledComponents,
          },
        }),
      );
      if (Object.keys(dataModel).length > 0) {
        resultMessages.push(
          asAgentToRendererMessage({
            version: targetVersion,
            [SurfaceOperation.UPDATE_DATA]: {
              surfaceId: scopeSurfId,
              path: '/',
              value: dataModel,
            },
          }),
        );
      }
    }
    return resultMessages;
  }

  /**
   * Compiles a single variable's AST node into standard component format (compiler.py:471-643).
   *
   * @param varName The variable identifier (which becomes component ID unless `id=` is set).
   * @param ast The parsed expression AST node.
   * @param rawSymbols Parsed global variable symbol table.
   * @param compIds Mapping from variable names to resolved component IDs.
   * @param ctx Active compiler execution context.
   * @param targetMajorMinor Target major and minor protocol version numbers.
   * @returns The compiled component JSON dictionary, or null if not a component.
   */
  private _compileAstNode(
    varName: string,
    ast: unknown,
    rawSymbols: Record<string, unknown>,
    compIds: Map<string, string>,
    ctx: CompileContext,
    targetMajorMinor: [number, number],
  ): Record<string, unknown> | null {
    if (!isExpressNode(ast, 'call')) {
      return null;
    }

    const compName = ast.name;
    const args = ast.args;
    const rawKwargs = {...ast.kwargs};

    const explicitCatalogId = rawKwargs.catalogId;
    delete rawKwargs.catalogId;

    const explicitId = rawKwargs.id;
    delete rawKwargs.id;

    if (explicitId !== undefined) {
      if (typeof explicitId !== 'string' || explicitId.length === 0) {
        throw new ExpressValidationError(
          `id on component '${compName}' must be a non-empty string.`,
        );
      }
      if (targetMajorMinor[0] >= 1 && !isValidUax31Identifier(explicitId)) {
        throw new ExpressValidationError(
          `Component id '${explicitId}' on '${compName}' is not a valid UAX 31 identifier.`,
        );
      }
    }

    if (
      !this.definesComponent(compName, explicitCatalogId) &&
      ((explicitCatalogId === undefined &&
        (compName === 'Event' ||
          compName === '_template' ||
          compName === 'surface' ||
          compName === 'deleteSurface')) ||
        this.definesFunction(compName, explicitCatalogId))
    ) {
      return null;
    }

    const {helper: compHelper, catalogId: resolvedCatalogId} = this.resolveSymbol(
      'component',
      compName,
      explicitCatalogId,
      targetMajorMinor,
    );

    const compId = (explicitId as string | undefined) ?? compIds.get(varName) ?? varName;
    const properties = compHelper.getComponentProperties(compName);
    const compDict: Record<string, unknown> = {
      id: compId,
      component: compName,
    };
    if (resolvedCatalogId !== undefined) {
      compDict.catalogId = resolvedCatalogId;
    }

    // Sanctioned departure §5.2 item 4: check-rule property
    const checkPropName = compHelper.getCheckRuleProperty(compName);
    const nonCheckProperties = checkPropName
      ? properties.filter(p => p !== checkPropName)
      : properties;

    const rawChecks: ExpressCheckNode[] = [];
    const propArgPairs: Array<[string, unknown]> = [];
    let propIdx = 0;

    const posArgs: ExpressValue[] = [];
    for (const arg of args) {
      if (isCheckExpression(arg)) {
        if (Array.isArray(arg)) {
          rawChecks.push(...(arg as ExpressCheckNode[]));
        } else {
          rawChecks.push(arg as ExpressCheckNode);
        }
        continue;
      }
      posArgs.push(arg);
    }

    const requiredProps = compHelper.getComponentRequired(compName);
    for (let argIdx = 0; argIdx < posArgs.length; argIdx++) {
      const arg = posArgs[argIdx];
      if (propIdx >= nonCheckProperties.length) {
        throw new ExpressValidationError(
          `${compName} takes at most ${nonCheckProperties.length} positional arguments (${nonCheckProperties.join(', ')}), but component '${compId}' passes ${posArgs.length}.`,
        );
      }
      if (
        typeof arg === 'number' &&
        !compHelper.acceptsNumber(
          compHelper.getPropertySchema(compName, nonCheckProperties[propIdx]),
        )
      ) {
        let moved = false;
        if (argIdx === posArgs.length - 1) {
          const numericLater: number[] = [];
          for (let laterIdx = propIdx + 1; laterIdx < nonCheckProperties.length; laterIdx++) {
            const laterProp = nonCheckProperties[laterIdx];
            if (
              !(laterProp in rawKwargs) &&
              compHelper.acceptsNumber(compHelper.getPropertySchema(compName, laterProp))
            ) {
              numericLater.push(laterIdx);
            }
          }
          if (numericLater.length === 1) {
            const targetIdx = numericLater[0];
            let allOptionalEnums = true;
            for (let idx = propIdx; idx < targetIdx; idx++) {
              const skippedProp = nonCheckProperties[idx];
              if (
                requiredProps.includes(skippedProp) ||
                !compHelper.getPropertyEnum(compName, skippedProp)?.length
              ) {
                allOptionalEnums = false;
                break;
              }
            }
            if (allOptionalEnums) {
              propIdx = targetIdx;
              moved = true;
            }
          }
        }
        if (
          !moved &&
          !requiredProps.includes(nonCheckProperties[propIdx]) &&
          compHelper.commonTypesLoaded
        ) {
          throw new ExpressValidationError(
            `Positional argument ${argIdx + 1} for component '${compName}' is a number, which is not valid for optional property '${nonCheckProperties[propIdx]}'.`,
          );
        }
      }
      propArgPairs.push([nonCheckProperties[propIdx], arg]);
      propIdx += 1;
    }

    for (const [k, v] of Object.entries(rawKwargs)) {
      if (isCheckExpression(v)) {
        if (Array.isArray(v)) {
          rawChecks.push(...(v as ExpressCheckNode[]));
        } else {
          rawChecks.push(v as ExpressCheckNode);
        }
        continue;
      }
      propArgPairs.push([k, v]);
    }

    const seenProperties = new Set<string>();
    const boundPaths = new Map<string, Record<string, unknown>>();

    for (const [propName, arg] of propArgPairs) {
      if (!properties.includes(propName)) {
        throw new ExpressUnknownPropertyError(compName, propName, properties);
      }
      if (seenProperties.has(propName)) {
        throw new ExpressDuplicatePropertyError(compName, propName);
      }
      seenProperties.add(propName);

      if (isExpressNode(arg, 'skipped')) {
        compDict[propName] = null;
        continue;
      }

      const propSchema = compHelper.getPropertySchema(compName, propName);
      // Sanctioned departure §5.2 item 1: action slot via isActionSlot
      const isAction = isActionSlot(propSchema);

      let mappedVal = this._compileValue(
        arg,
        rawSymbols,
        compIds,
        ctx,
        targetMajorMinor,
        isAction,
        {
          parentId: compId,
          property: propName,
        },
      );

      // Sanctioned departure §5.2 item 5: forbidden-binding check walking schema.
      // Gated like Python (compiler.py:547): a property whose schema admits a path
      // as a whole is not inspected further.
      if (propSchema && !compHelper.admitsPath(propSchema)) {
        this._checkDataBindings(compName, propName, arg, propSchema, compHelper, rawSymbols);
      }

      // Sanctioned departure §5.2 item 2: option-object coercion
      if (propSchema && !compHelper.admitsPath(propSchema)) {
        if (Array.isArray(mappedVal) && expectsOptionObjects(propSchema)) {
          mappedVal = mappedVal.map(opt =>
            typeof opt === 'string' ? {label: opt, value: opt} : opt,
          );
        }
      }

      // Enum validation (compiler.py:557-565)
      const enumVals = compHelper.getPropertyEnum(compName, propName);
      if (
        enumVals &&
        !(mappedVal && typeof mappedVal === 'object') &&
        !enumVals.includes(mappedVal as string)
      ) {
        const pyListStr = `[${enumVals.map(e => `'${e}'`).join(', ')}]`;
        throw new ExpressValidationError(
          `Value '${mappedVal}' is not a valid enum choice for property '${propName}' of component '${compName}'. Allowed values are: ${pyListStr}`,
        );
      }

      compDict[propName] = mappedVal;

      // Sanctioned departure §5.2 item 3: record the bound path of every property whose value
      // is a `$path`, directly or through variables. A map literal shaped like a data binding
      // is data, so it binds no check.
      if (resolvesToPath(arg, rawSymbols)) {
        boundPaths.set(propName, mappedVal as Record<string, unknown>);
      }
    }

    for (const reqProp of requiredProps) {
      if (reqProp === 'id' || reqProp === 'component') {
        continue;
      }
      if (!seenProperties.has(reqProp)) {
        throw new ExpressMissingRequiredPropertyError(compName, reqProp);
      }
    }

    // Set active bound paths for nested check compile resolution (item 3)
    ctx.activeBoundPaths = boundPaths;

    // Second pass: compile checks with implicit path injection (compiler.py:578-640)
    if (rawChecks.length > 0) {
      // Sanctioned departure §5.2 item 4: reject checks if component has no check-rule property
      if (!checkPropName) {
        throw new ExpressValidationError(
          `Component '${compName}' does not accept checks.`,
          'Remove the check expressions, or use a component whose schema declares a list of CheckRule.',
        );
      }

      const compiledChecks: Record<string, unknown>[] = [];
      for (const rc of rawChecks) {
        if (isExpressNode(rc, 'check')) {
          compiledChecks.push(
            this.compileCheckCall(rc, rawSymbols, compIds, ctx, targetMajorMinor, false),
          );
        }
      }

      if (compiledChecks.length > 0) {
        compDict[checkPropName] = compiledChecks;
      }
    }

    ctx.activeBoundPaths = new Map();

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(compDict)) {
      if (v !== null && v !== undefined) {
        result[k] = v;
      }
    }
    return result;
  }

  /**
   * Compiles a `?check(...)` expression into a condition and failure message.
   */
  private compileCheckCall(
    rc: ExpressCheckNode,
    rawSymbols: Record<string, unknown>,
    compIds: Map<string, string>,
    ctx: CompileContext,
    targetMajorMinor: [number, number],
    isAction = false,
  ): {condition: Record<string, unknown>; message: string} {
    const checkName = rc.name;
    const rawArgs = rc.args;
    const remainingArgs: ExpressValue[] = [];
    let checkCatalogId: unknown = undefined;

    for (const arg of rawArgs) {
      if (isExpressNode(arg, 'map') && Object.hasOwn(arg.entries, 'catalogId')) {
        const otherKeys = Object.keys(arg.entries).filter(k => k !== 'catalogId');
        if (otherKeys.length > 0) {
          throw new ExpressValidationError(
            `Unsupported key(s) in check options for '?${checkName}': ${otherKeys.join(', ')}. Only 'catalogId' is allowed.`,
          );
        }
        if (checkCatalogId !== undefined && checkCatalogId !== arg.entries.catalogId) {
          throw new ExpressValidationError(
            `Check '?${checkName}' specifies conflicting catalogId values.`,
          );
        }
        checkCatalogId = arg.entries.catalogId;
        continue;
      }
      remainingArgs.push(arg);
    }

    const {helper: checkHelper} = this.resolveSymbol(
      'function',
      checkName,
      checkCatalogId,
      targetMajorMinor,
    );

    const checkProps = checkHelper.getFunctionProperties(checkName);
    let messageVal = `${checkName.charAt(0).toUpperCase() + checkName.slice(1)} check failed`;

    const callArgs: ExpressValue[] = [];
    let isValueInjected = false;

    // Sanctioned departure §5.2 item 3: implicit first argument injection
    if (checkProps.length > 0) {
      const first = checkProps[0];
      const firstIsPath = remainingArgs.length > 0 && isExpressNode(remainingArgs[0], 'path');

      if (!firstIsPath) {
        const bound = ctx.activeBoundPaths.get(first);
        if (bound) {
          const rawPath = String(bound[ctx.keys.path] ?? '');
          callArgs.push({kind: 'path', path: rawPath});
          isValueInjected = true;
        }
      }
    }

    const startPropIdx = isValueInjected ? 1 : 0;
    for (let cIdx = 0; cIdx < remainingArgs.length; cIdx++) {
      const cArg = remainingArgs[cIdx];
      const propTargetIdx = cIdx + startPropIdx;
      if (propTargetIdx < checkProps.length) {
        const propName = checkProps[propTargetIdx];
        const propSchema = checkHelper.getFunctionPropertySchema(checkName, propName);
        let isMessage = false;
        if (typeof cArg === 'string' && propSchema) {
          const expectedType = propSchema.type;
          if (
            expectedType === 'integer' ||
            expectedType === 'number' ||
            expectedType === 'boolean'
          ) {
            isMessage = true;
          }
        }

        if (isMessage) {
          messageVal = cArg as string;
          break;
        }

        callArgs.push(cArg);
      } else {
        if (typeof cArg === 'string') {
          messageVal = cArg;
        }
      }
    }

    const innerKwargs: Record<string, ExpressValue> = {};
    if (checkCatalogId !== undefined) {
      innerKwargs.catalogId = checkCatalogId as ExpressValue;
    }

    const conditionCall: ExpressCallNode = {
      kind: 'call',
      name: checkName,
      args: callArgs,
      kwargs: innerKwargs,
    };

    const [condition] = this.compileFunctionCall(
      conditionCall,
      rawSymbols,
      compIds,
      ctx,
      targetMajorMinor,
      isAction,
      false,
    );

    return {condition, message: messageVal};
  }

  /**
   * Compiles a function call AST node into a wire function call object.
   */
  private compileFunctionCall(
    callVal: ExpressCallNode,
    rawSymbols: Record<string, unknown>,
    compIds: Map<string, string>,
    ctx: CompileContext,
    targetMajorMinor: [number, number],
    isAction = false,
    allowCallId = false,
  ): [Record<string, unknown>, string | undefined] {
    const fnName = callVal.name;
    const fnArgs = callVal.args;
    const fnKwargs = {...callVal.kwargs};

    const explicitCatalogId = fnKwargs.catalogId;
    delete fnKwargs.catalogId;

    let explicitCallId: string | undefined;
    if (allowCallId && 'functionCallId' in fnKwargs) {
      const rawCallId = fnKwargs.functionCallId;
      delete fnKwargs.functionCallId;
      if (typeof rawCallId !== 'string' || !rawCallId) {
        throw new ExpressValidationError(
          `functionCallId on function '${fnName}' must be a non-empty string.`,
        );
      }
      explicitCallId = rawCallId;
    }

    const {helper: fnHelper, catalogId: resolvedCatalogId} = this.resolveSymbol(
      'function',
      fnName,
      explicitCatalogId,
      targetMajorMinor,
    );

    const fnProps = fnHelper.getFunctionProperties(fnName);
    const compiledArgs: Record<string, unknown> = {};
    for (let idx = 0; idx < fnArgs.length; idx++) {
      const arg = fnArgs[idx];
      if (idx < fnProps.length) {
        if (isExpressNode(arg, 'skipped')) {
          continue;
        }
        const valItem = this._compileValue(
          arg,
          rawSymbols,
          compIds,
          ctx,
          targetMajorMinor,
          isAction,
        );
        if (valItem !== undefined && valItem !== null) {
          compiledArgs[fnProps[idx]] = valItem;
        }
      }
    }

    for (const [k, v] of Object.entries(fnKwargs)) {
      if (!fnProps.includes(k)) {
        throw new ExpressInvalidParamError(fnName, k, fnProps);
      }
      if (k in compiledArgs) {
        throw new ExpressDuplicateParamError(fnName, k);
      }
      if (isExpressNode(v, 'skipped')) {
        continue;
      }
      const valItem = this._compileValue(v, rawSymbols, compIds, ctx, targetMajorMinor, isAction);
      if (valItem !== undefined && valItem !== null) {
        compiledArgs[k] = valItem;
      }
    }

    const res: Record<string, unknown> = {
      [fnHelper.keys.call]: fnName,
    };
    if (resolvedCatalogId !== undefined) {
      res.catalogId = resolvedCatalogId;
    }
    res.args = compiledArgs;

    return [res, explicitCallId];
  }

  /**
   * Compiles an individual AST node value into valid A2UI equivalents (compiler.py:644-838).
   *
   * @param val The parsed AST node value.
   * @param rawSymbols Parsed global variable symbol table.
   * @param compIds Mapping from variable names to resolved component IDs.
   * @param ctx Active compiler execution context.
   * @param targetMajorMinor Target major and minor protocol version numbers.
   * @param isAction Whether this value lies inside a component Action field.
   * @returns The semantically correct A2UI JSON structure.
   */
  private _compileValue(
    val: unknown,
    rawSymbols: Record<string, unknown>,
    compIds: Map<string, string>,
    ctx: CompileContext,
    targetMajorMinor: [number, number],
    isAction = false,
    inlineCtx?: {parentId: string; property: string; index?: number},
  ): unknown {
    if (Array.isArray(val)) {
      return val.map((item, index) =>
        this._compileValue(
          item,
          rawSymbols,
          compIds,
          ctx,
          targetMajorMinor,
          isAction,
          inlineCtx ? {...inlineCtx, index} : undefined,
        ),
      );
    }

    if (isExpressNode(val, 'map')) {
      // A map literal is always data, whatever its keys are.
      const dictRes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val.entries)) {
        setOwnEntry(
          dictRes,
          k,
          this._compileValue(v, rawSymbols, compIds, ctx, targetMajorMinor, isAction),
        );
      }
      return dictRes;
    }

    if (isExpressNode(val, 'path')) {
      return {[ctx.keys.path]: val.path};
    }

    if (isExpressNode(val, 'variable')) {
      const refName = val.name;
      if (compIds.has(refName)) {
        return compIds.get(refName)!;
      }
      if (Object.hasOwn(rawSymbols, refName)) {
        if (ctx.resolving.has(refName)) {
          throw new ExpressValidationError(
            `Variable '${refName}' refers to itself through its own value.`,
          );
        }
        ctx.resolving.add(refName);
        try {
          return this._compileValue(
            rawSymbols[refName],
            rawSymbols,
            compIds,
            ctx,
            targetMajorMinor,
            isAction,
          );
        } finally {
          ctx.resolving.delete(refName);
        }
      }
      return refName;
    }

    if (isExpressNode(val, 'skipped')) {
      throw new ExpressValidationError("'_' can only stand in for an argument.");
    }

    if (isExpressNode(val, 'check')) {
      const {condition} = this.compileCheckCall(
        val,
        rawSymbols,
        compIds,
        ctx,
        targetMajorMinor,
        isAction,
      );
      return condition;
    }

    if (isExpressNode(val, 'call')) {
      const callVal = val;
      const fnName = callVal.name;
      const fnArgs = callVal.args;
      const fnKwargs = callVal.kwargs;

      // 1. Is it a reserved _template signature?
      if (fnName === '_template') {
        if (fnArgs.length < 2) {
          throw new ExpressParseError(
            '_template helper requires exactly 2 arguments: path and templateComponent.',
          );
        }
        const pathVal = this._compileValue(
          fnArgs[0],
          rawSymbols,
          compIds,
          ctx,
          targetMajorMinor,
          isAction,
        );
        if (!pathVal || typeof pathVal !== 'object' || !(ctx.keys.path in pathVal)) {
          throw new ExpressParseError(
            `The first argument to _template must be a dynamic data binding path (prefixed by $), got: ${formatValue(fnArgs[0])}`,
          );
        }
        const compIdVal = this._compileValue(
          fnArgs[1],
          rawSymbols,
          compIds,
          ctx,
          targetMajorMinor,
          isAction,
        );
        // A template's path is a plain property of ChildList, not a data binding, so it
        // keeps the unprefixed name in every version.
        return {
          path: (pathVal as Record<string, unknown>)[ctx.keys.path],
          componentId: compIdVal,
        };
      }

      // 2. Is it a reserved Event signature?
      if (fnName === 'Event') {
        const compiledEventName =
          fnArgs.length > 0
            ? this._compileValue(fnArgs[0], rawSymbols, compIds, ctx, targetMajorMinor, isAction)
            : '';

        if (fnArgs.length <= 1) {
          return {
            event: {
              name: compiledEventName,
            },
          };
        }

        const rawContext = this._compileValue(
          fnArgs[1],
          rawSymbols,
          compIds,
          ctx,
          targetMajorMinor,
          isAction,
        );
        // Entries are copied as own properties, so that a key such as `__proto__`
        // stays data rather than changing the context's prototype.
        const compiledContext: Record<string, unknown> = {};
        const mergeContext = (source: object): void => {
          for (const [k, v] of Object.entries(source)) {
            setOwnEntry(compiledContext, k, v);
          }
        };
        if (rawContext && typeof rawContext === 'object') {
          if (Array.isArray(rawContext)) {
            for (const item of rawContext) {
              if (item && typeof item === 'object' && !Array.isArray(item)) {
                mergeContext(item);
              }
            }
          } else {
            mergeContext(rawContext);
          }
        }
        return {
          event: {
            name: compiledEventName,
            context: compiledContext,
          },
        };
      }

      // 3. Is it an inline component constructor?
      if (this.definesComponent(fnName, fnKwargs.catalogId)) {
        ctx.inlineCounter += 1;
        const inlineId = inlineCtx
          ? inlineCtx.index !== undefined
            ? `${inlineCtx.parentId}_${inlineCtx.property}_${inlineCtx.index}`
            : `${inlineCtx.parentId}_${inlineCtx.property}`
          : `_inline_${ctx.inlineCounter}`;
        if (
          Object.hasOwn(rawSymbols, inlineId) ||
          Array.from(compIds.values()).includes(inlineId) ||
          ctx.generatedIds.has(inlineId)
        ) {
          throw new ExpressIdCollisionError(inlineId);
        }
        ctx.generatedIds.add(inlineId);
        const extraStartIndex = ctx.extraComponents.length;
        const compiledInline = this._compileAstNode(
          inlineId,
          val,
          rawSymbols,
          compIds,
          ctx,
          targetMajorMinor,
        );
        if (compiledInline) {
          ctx.extraComponents.splice(extraStartIndex, 0, compiledInline);
          return compiledInline.id as string;
        }
        return inlineId;
      }

      // 4. Regular catalog function call
      const [compiledFn] = this.compileFunctionCall(
        callVal,
        rawSymbols,
        compIds,
        ctx,
        targetMajorMinor,
        false,
        false,
      );
      if (isAction) {
        return {functionCall: compiledFn};
      }
      return compiledFn;
    }

    return val;
  }

  /**
   * Validates dynamic databindings against the schema (sanctioned departure §5.2 item 5).
   *
   * Walks the AST value alongside the schema. At each node, a `$path` is allowed iff
   * `helper.admitsPath(schemaAtThisPosition)`. Descends into arrays via schema `items`,
   * into map literals via `properties[key]`, and into the value of a referenced
   * variable. Walking the AST rather than the compiled value means a map literal whose
   * keys are named like a call, an event or a function call is still searched. Calls,
   * checks, events and templates are not searched, since they resolve their own
   * arguments. If schema cannot be determined at a position, the binding is treated
   * as allowed.
   */
  private _checkDataBindings(
    compName: string,
    topLevelPropName: string,
    val: unknown,
    schema: unknown,
    helper: CatalogSchemaHelper,
    rawSymbols: Record<string, unknown>,
  ): void {
    const walk = (v: unknown, s: unknown, seen: ReadonlySet<string>): void => {
      if (isExpressNode(v, 'path')) {
        if (s && !helper.admitsPath(s)) {
          throw new ExpressForbiddenDatabindingError(compName, topLevelPropName);
        }
        return;
      }
      if (isExpressNode(v, 'variable')) {
        if (!seen.has(v.name) && Object.hasOwn(rawSymbols, v.name)) {
          walk(rawSymbols[v.name], s, new Set([...seen, v.name]));
        }
        return;
      }
      if (Array.isArray(v)) {
        const itemSchema = s ? helper.resolveSubschema(s, 'items') : undefined;
        for (const item of v) {
          walk(item, itemSchema, seen);
        }
        return;
      }
      if (isExpressNode(v, 'map')) {
        for (const [k, subVal] of Object.entries(v.entries)) {
          const propSchema = s ? helper.resolveSubschema(s, k) : undefined;
          walk(subVal, propSchema, seen);
        }
      }
    };

    walk(val, schema, new Set());
  }
}
