/*
 * Copyright 2026 Google LLC
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

import {CharStream, CommonTokenStream} from 'antlr4ng';

import {type AgentToRendererMessage, normalizeVersionString} from '../../internal/web_core.js';
import {type SchemaCatalog} from '../../types.js';
import {ExpressLexer} from './generated/ExpressLexer.js';
import {ExpressParser} from './generated/ExpressParser.js';
import {A2uiCatalogError} from '../../errors.js';
import {toWireProtocolVersion} from '../../utils/protocol_version.js';
import {
  ExpressAstVisitor,
  ExpressErrorListener,
  type ExpressCallValue,
  type ExpressCheckValue,
  type ExpressPathValue,
  type ExpressSkippedValue,
  type ExpressStatement,
  type ExpressValue,
} from './visitor.js';
import {CatalogSchemaHelper, expectsOptionObjects, isActionSlot} from './schema_helper.js';
import {
  ExpressDuplicateParamError,
  ExpressDuplicatePropertyError,
  ExpressForbiddenDatabindingError,
  ExpressInvalidParamError,
  ExpressParseError,
  ExpressSyntaxError,
  ExpressUndefinedRootError,
  ExpressUnknownComponentError,
  ExpressUnknownFunctionError,
  ExpressMissingRequiredPropertyError,
  ExpressUnknownPropertyError,
  ExpressValidationError,
  ExpressIdCollisionError,
} from './errors.js';

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
 * Recursively checks if a value structure contains a dynamic DataBinding ($path) ref (compiler.py:104-122).
 */
export function hasDatabinding(v: unknown): boolean {
  if (v && typeof v === 'object') {
    if (Array.isArray(v)) {
      return v.some(hasDatabinding);
    }
    const obj = v as Record<string, unknown>;
    if ('call' in obj || 'event' in obj || 'functionCall' in obj) {
      return false;
    }
    if ('path' in obj && !('componentId' in obj)) {
      return true;
    }
    return Object.values(obj).some(hasDatabinding);
  }
  return false;
}

/**
 * Checks if a value node is a direct dynamic DataBinding ($path) ref.
 */
function isDirectBinding(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return false;
  }
  const obj = v as Record<string, unknown>;
  if ('call' in obj || 'event' in obj || 'functionCall' in obj) {
    return false;
  }
  return 'path' in obj && !('componentId' in obj);
}

/**
 * Checks if a parsed AST value represents a validation check expression (compiler.py:154-160).
 */
export function isCheckExpression(val: unknown): boolean {
  if (val && typeof val === 'object') {
    if (!Array.isArray(val) && 'check' in val) {
      return true;
    }
    if (Array.isArray(val) && val.length > 0) {
      return val.every(isCheckExpression);
    }
  }
  return false;
}

/**
 * Parses numeric major.minor.patch components from a version string.
 */
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
 * Formats an exception reproducing Python's `str(e)` for error wrapping (compiler.py:290).
 */
export function pyStr(e: unknown): string {
  if (e instanceof ExpressSyntaxError) {
    return `${e.message} (line ${e.line})`;
  }
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

/**
 * Formats an AST value reproducing Python's `str(v)` / `repr(v)` in error messages.
 */
function pyRepr(v: unknown): string {
  if (typeof v === 'string') {
    return v;
  }
  if (v === null) {
    return 'None';
  }
  if (typeof v === 'boolean') {
    return v ? 'True' : 'False';
  }
  if (typeof v === 'number') {
    return String(v);
  }
  if (Array.isArray(v)) {
    return `[${v.map(pyRepr).join(', ')}]`;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => `'${k}': ${typeof val === 'string' ? `'${val}'` : pyRepr(val)}`,
    );
    return `{${entries.join(', ')}}`;
  }
  return String(v);
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
  activeBoundPaths: Map<string, ExpressPathValue> = new Map();
}

/**
 * Holds symbols and data path assignments for a target surface scope (compiler.py:175-183).
 */
class SurfaceScope {
  readonly surfaceId: string;
  readonly catalogId?: string;
  readonly rawSymbols: Record<string, unknown> = {};
  readonly dataPathAssignments: Record<string, unknown> = {};

  constructor(surfaceId: string, catalogId?: string) {
    this.surfaceId = surfaceId;
    this.catalogId = catalogId;
  }
}

/**
 * Compilation pipeline for A2UI Express.
 *
 * Resolves positional parameters dynamically, flattens variable references into
 * an adjacency list component tree, and constructs valid A2UI JSON payloads.
 */
export class ExpressCompiler {
  readonly helper: CatalogSchemaHelper;
  readonly version: string;

  constructor(catalog: SchemaCatalog, version?: string) {
    const catalogVersion = toWireProtocolVersion(catalog.protocolVersion);
    if (version && version !== catalogVersion) {
      throw new A2uiCatalogError(
        `Requested protocol version '${version}' does not match catalog version '${catalogVersion}'`,
      );
    }
    this.version = version ?? catalogVersion;
    this.helper = new CatalogSchemaHelper(catalog, this.version);
  }

  /**
   * Compiles plain A2UI Express DSL into standard A2UI wire messages.
   *
   * @param dslText The source A2UI Express DSL text block.
   * @param surfaceId The unique identifier for the compiled surface.
   * @param catalogId The URI/identifier of the schema catalog to reference.
   * @param isFinal Whether this is the final compilation pass.
   * @param version Target version override ("v0.9", "v0.9.1", or "v1.0").
   * @returns A list of standard A2UI wire JSON message dicts.
   */
  compile(
    dslText: string,
    surfaceId = 'default_surface',
    catalogId = '',
    isFinal = true,
    version?: string,
  ): AgentToRendererMessage[] {
    const targetVersion = version ?? this.version;
    const ctx = new CompileContext();

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
      const inputStream = CharStream.fromString(dslBody);
      const lexer = new ExpressLexer(inputStream);
      const errorListener = new ExpressErrorListener();
      lexer.removeErrorListeners();
      lexer.addErrorListener(errorListener);

      const tokenStream = new CommonTokenStream(lexer);
      const parser = new ExpressParser(tokenStream);
      parser.removeErrorListeners();
      parser.addErrorListener(errorListener);

      const tree = parser.program();
      if (isFinal && errorListener.errors.length > 0) {
        const [line, col, msg, isLexer] = errorListener.errors[0];
        const err = new ExpressSyntaxError(
          `Syntax error at line ${line}:${col}: ${msg}`,
          line,
          col,
          isLexer,
        );
        throw err;
      }

      const firstErrorLine =
        errorListener.errors.length > 0 ? errorListener.errors[0][0] : undefined;
      const visitor = new ExpressAstVisitor(firstErrorLine);
      statements = (visitor.visit(tree) as ExpressStatement[] | null) ?? [];
    } catch (e: unknown) {
      if (!isFinal) {
        // Sanctioned swallow (compiler.py:286): when isFinal is false, syntax errors
        // during visitor execution are suppressed and statements becomes [].
        statements = [];
      } else {
        if (e instanceof ExpressSyntaxError && e.isLexer) {
          throw e;
        }
        const innerMsg = pyStr(e);
        const parseErr = new ExpressParseError(`Failed to parse expression: ${innerMsg}`);
        // Set ES2022 cause after construction matching Python's `raise ... from e`
        (parseErr as unknown as {cause?: unknown}).cause = e;
        throw parseErr;
      }
    }

    const scopes: SurfaceScope[] = [];
    let currentScope: SurfaceScope | null = null;
    let targetDeleteSurfaceId: string | null = null;
    const standaloneFunctionCalls: Array<[ExpressCallValue, SurfaceScope | null]> = [];

    for (const stmt of statements) {
      const [stmtType, ...stmtArgs] = stmt;
      if (stmtType === 'EXPR') {
        const parsedVal = stmtArgs[0];
        if (
          parsedVal &&
          typeof parsedVal === 'object' &&
          'call' in parsedVal &&
          (parsedVal as ExpressCallValue).call === 'surface'
        ) {
          const callVal = parsedVal as ExpressCallValue;
          const args = callVal.args ?? [];
          const kwargs = callVal.kwargs ?? {};
          const targetSurf =
            typeof kwargs.surfaceId === 'string'
              ? kwargs.surfaceId
              : args.length > 0 && typeof args[0] === 'string'
                ? args[0]
                : surfaceId;
          const targetCat =
            typeof kwargs.catalogId === 'string'
              ? kwargs.catalogId
              : args.length > 1 && typeof args[1] === 'string'
                ? args[1]
                : catalogId;

          currentScope = new SurfaceScope(targetSurf, targetCat);
          scopes.push(currentScope);
        } else if (
          parsedVal &&
          typeof parsedVal === 'object' &&
          'call' in parsedVal &&
          (parsedVal as ExpressCallValue).call === 'deleteSurface'
        ) {
          const callVal = parsedVal as ExpressCallValue;
          const args = callVal.args ?? [];
          const kwargs = callVal.kwargs ?? {};
          if (args.length > 0 && typeof args[0] === 'string') {
            targetDeleteSurfaceId = args[0];
          } else if (typeof kwargs.surfaceId === 'string') {
            targetDeleteSurfaceId = kwargs.surfaceId;
          }
        } else if (parsedVal && typeof parsedVal === 'object' && 'call' in parsedVal) {
          standaloneFunctionCalls.push([parsedVal as ExpressCallValue, currentScope]);
        }
      } else if (stmtType === 'ASSIGN') {
        const [varName, parsedVal] = stmtArgs as [string, ExpressValue];
        if (currentScope === null) {
          currentScope = new SurfaceScope(surfaceId, catalogId);
          scopes.push(currentScope);
        }
        if (varName.startsWith('$')) {
          currentScope.dataPathAssignments[varName] = parsedVal;
        } else {
          currentScope.rawSymbols[varName] = parsedVal;
        }
      }
    }

    if (targetDeleteSurfaceId !== null) {
      return [
        asAgentToRendererMessage({
          version: targetVersion,
          [SurfaceOperation.DELETE]: {surfaceId: targetDeleteSurfaceId},
        }),
      ];
    }

    if (standaloneFunctionCalls.length > 0) {
      if (!isAtLeastVersion(targetVersion, 'v1.0')) {
        throw new ExpressValidationError(
          `Standalone function calls are not supported in A2UI ${targetVersion}`,
        );
      }
      const [firstCall, callScope] = standaloneFunctionCalls[0];
      ctx.inlineCounter += 1;
      const rawSyms = callScope ? callScope.rawSymbols : {};
      const compiledVal = this._compileValue(firstCall, rawSyms, ctx, false) as Record<
        string,
        unknown
      >;

      return [
        asAgentToRendererMessage({
          version: targetVersion,
          callRendererFunction: {
            functionCallId: `call_${ctx.inlineCounter}`,
            callFunction: {
              catalogId:
                callScope?.catalogId ||
                catalogId ||
                (typeof this.helper.catalog.catalogId === 'string'
                  ? this.helper.catalog.catalogId
                  : 'https://a2ui.org/catalog.json'),
              call: compiledVal.call as string,
              args: (compiledVal.args as Record<string, unknown>) ?? {},
            },
          },
        }),
      ];
    }

    if (scopes.length === 0) {
      throw new ExpressUndefinedRootError('root');
    }

    const resultMessages: AgentToRendererMessage[] = [];

    for (const scope of scopes) {
      const scopeSurfId = scope.surfaceId;
      const scopeCatId =
        scope.catalogId ||
        catalogId ||
        (typeof this.helper.catalog.catalogId === 'string'
          ? this.helper.catalog.catalogId
          : 'https://a2ui.org/catalog.json');

      // Compile data model paths (compiler.py:401-405)
      const dataModel: Record<string, unknown> = {};
      for (const [pathName, astVal] of Object.entries(scope.dataPathAssignments)) {
        const compiledVal = this._compileValue(astVal, scope.rawSymbols, ctx, false);
        setNestedPath(dataModel, pathName, compiledVal);
      }

      const compiledComponents: Record<string, unknown>[] = [];
      for (const [varName, ast] of Object.entries(scope.rawSymbols)) {
        const compDict = this._compileAstNode(varName, ast, scope.rawSymbols, ctx);
        if (compDict) {
          compiledComponents.push(compDict);
        }
      }

      compiledComponents.push(...ctx.extraComponents);
      ctx.extraComponents = [];

      if (!('root' in scope.rawSymbols)) {
        if (
          compiledComponents.length === 0 &&
          Object.keys(scope.dataPathAssignments).length === 0
        ) {
          throw new ExpressUndefinedRootError('root');
        }

        if (compiledComponents.length > 0) {
          resultMessages.push(
            asAgentToRendererMessage({
              version: targetVersion,
              [SurfaceOperation.UPDATE_COMPONENTS]: {
                surfaceId: scopeSurfId,
                components: compiledComponents,
              },
            }),
          );
        }

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
        continue;
      }

      if (isAtLeastVersion(targetVersion, 'v1.0')) {
        const createPayload: Record<string, unknown> = {
          surfaceId: scopeSurfId,
          catalogId: scopeCatId,
          components: compiledComponents,
        };
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
            [SurfaceOperation.CREATE]: {
              surfaceId: scopeSurfId,
              catalogId: scopeCatId,
            },
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
    }

    return resultMessages;
  }

  /**
   * Compiles a single variable's AST node into standard component format (compiler.py:471-643).
   *
   * @param varName The variable identifier (which becomes component ID).
   * @param ast The parsed expression AST node.
   * @param rawSymbols Parsed global variable symbol table.
   * @param ctx Active compiler execution context.
   * @returns The compiled component JSON dictionary, or null if not a component.
   */
  private _compileAstNode(
    varName: string,
    ast: unknown,
    rawSymbols: Record<string, unknown>,
    ctx: CompileContext,
  ): Record<string, unknown> | null {
    if (!ast || typeof ast !== 'object' || !('call' in ast)) {
      return null;
    }

    const callAst = ast as ExpressCallValue;
    const compName = callAst.call;
    const args = callAst.args ?? [];
    const kwargs = callAst.kwargs ?? {};

    if (!this.helper.components.has(compName)) {
      if (
        compName === 'Event' ||
        compName === '_template' ||
        compName === 'surface' ||
        compName === 'deleteSurface' ||
        this.helper.functions.has(compName)
      ) {
        return null;
      }
      throw new ExpressUnknownComponentError(compName);
    }

    const properties = this.helper.getComponentProperties(compName);
    const compDict: Record<string, unknown> = {
      id: varName,
      component: compName,
    };

    // Sanctioned departure §5.2 item 4: check-rule property
    const checkPropName = this.helper.getCheckRuleProperty(compName);
    const nonCheckProperties = checkPropName
      ? properties.filter(p => p !== checkPropName)
      : properties;

    const rawChecks: ExpressCheckValue[] = [];
    const propArgPairs: Array<[string, unknown]> = [];
    let propIdx = 0;

    for (const arg of args) {
      if (isCheckExpression(arg)) {
        if (Array.isArray(arg)) {
          rawChecks.push(...(arg as ExpressCheckValue[]));
        } else {
          rawChecks.push(arg as ExpressCheckValue);
        }
        continue;
      }

      if (propIdx < nonCheckProperties.length) {
        propArgPairs.push([nonCheckProperties[propIdx], arg]);
        propIdx += 1;
      }
    }

    for (const [k, v] of Object.entries(kwargs)) {
      if (isCheckExpression(v)) {
        if (Array.isArray(v)) {
          rawChecks.push(...(v as ExpressCheckValue[]));
        } else {
          rawChecks.push(v as ExpressCheckValue);
        }
        continue;
      }
      propArgPairs.push([k, v]);
    }

    const seenProperties = new Set<string>();
    const boundPaths = new Map<string, ExpressPathValue>();

    for (const [propName, arg] of propArgPairs) {
      if (!properties.includes(propName)) {
        throw new ExpressUnknownPropertyError(compName, propName, properties);
      }
      if (seenProperties.has(propName)) {
        throw new ExpressDuplicatePropertyError(compName, propName);
      }
      seenProperties.add(propName);

      if (
        arg &&
        typeof arg === 'object' &&
        'skipped' in arg &&
        (arg as ExpressSkippedValue).skipped
      ) {
        compDict[propName] = null;
        continue;
      }

      const propSchema = this.helper.getPropertySchema(compName, propName);
      // Sanctioned departure §5.2 item 1: action slot via isActionSlot
      const isAction = isActionSlot(propSchema);

      let mappedVal = this._compileValue(arg, rawSymbols, ctx, isAction, {
        parentId: varName,
        property: propName,
      });

      // Sanctioned departure §5.2 item 5: forbidden-binding check walking schema.
      // Gated like Python (compiler.py:547): a property whose schema admits a path
      // as a whole is not inspected further.
      if (propSchema && !this.helper.admitsPath(propSchema)) {
        this._checkDataBindings(compName, propName, mappedVal, propSchema);
      }

      // Sanctioned departure §5.2 item 2: option-object coercion
      if (propSchema && !this.helper.admitsPath(propSchema)) {
        if (Array.isArray(mappedVal) && expectsOptionObjects(propSchema)) {
          mappedVal = mappedVal.map(opt =>
            typeof opt === 'string' ? {label: opt, value: opt} : opt,
          );
        }
      }

      // Enum validation (compiler.py:557-565)
      const enumVals = this.helper.getPropertyEnum(compName, propName);
      if (enumVals && typeof mappedVal === 'string') {
        if (!enumVals.includes(mappedVal)) {
          const pyListStr = `[${enumVals.map(e => `'${e}'`).join(', ')}]`;
          throw new ExpressValidationError(
            `Value '${mappedVal}' is not a valid enum choice for property '${propName}' of component '${compName}'. Allowed values are: ${pyListStr}`,
          );
        }
      }

      compDict[propName] = mappedVal;

      // Sanctioned departure §5.2 item 3: record bound path of every property whose compiled
      // value is an object with a path key (and not a componentId).
      if (
        mappedVal &&
        typeof mappedVal === 'object' &&
        'path' in mappedVal &&
        !('componentId' in mappedVal)
      ) {
        boundPaths.set(propName, mappedVal as ExpressPathValue);
      }
    }

    const requiredProps = this.helper.getComponentRequired(compName);
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
        if (rc && typeof rc === 'object' && 'check' in rc) {
          const checkName = rc.check;
          const checkArgs = rc.args ?? [];
          const compiledArgs: Record<string, unknown> = {};

          const checkProps = this.helper.getFunctionProperties(checkName);
          let messageVal = `${checkName.charAt(0).toUpperCase() + checkName.slice(1)} check failed`;

          const explicitArgs = [...checkArgs];
          let isValueInjected = false;

          // Sanctioned departure §5.2 item 3: implicit first argument injection
          if (checkProps.length > 0) {
            const first = checkProps[0];
            const firstIsPath =
              explicitArgs.length > 0 &&
              explicitArgs[0] &&
              typeof explicitArgs[0] === 'object' &&
              'path' in explicitArgs[0];

            if (!firstIsPath) {
              const bound = boundPaths.get(first);
              if (bound) {
                compiledArgs[first] = bound;
                isValueInjected = true;
              }
            }
          }

          const startPropIdx = isValueInjected ? 1 : 0;

          for (let cIdx = 0; cIdx < explicitArgs.length; cIdx++) {
            const cArg = explicitArgs[cIdx];
            const propTargetIdx = cIdx + startPropIdx;
            if (propTargetIdx < checkProps.length) {
              const propName = checkProps[propTargetIdx];
              const propSchema = this.helper.getFunctionPropertySchema(checkName, propName);
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

              if (
                cArg &&
                typeof cArg === 'object' &&
                'skipped' in cArg &&
                (cArg as ExpressSkippedValue).skipped
              ) {
                compiledArgs[propName] = null;
                continue;
              }
              compiledArgs[propName] = this._compileValue(cArg, rawSymbols, ctx, false);
            } else {
              if (typeof cArg === 'string') {
                messageVal = cArg;
              }
            }
          }

          compiledChecks.push({
            condition: {call: checkName, args: compiledArgs},
            message: messageVal,
          });
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
   * Compiles an individual AST node value into valid A2UI equivalents (compiler.py:644-838).
   *
   * @param val The parsed AST node value.
   * @param rawSymbols Parsed global variable symbol table.
   * @param ctx Active compiler execution context.
   * @param isAction Whether this value lies inside a component Action field.
   * @returns The semantically correct A2UI JSON structure.
   */
  private _compileValue(
    val: unknown,
    rawSymbols: Record<string, unknown>,
    ctx: CompileContext,
    isAction = false,
    inlineCtx?: {parentId: string; property: string; index?: number},
  ): unknown {
    if (val && typeof val === 'object') {
      if ('path' in val) {
        return val;
      }

      if ('variable' in val) {
        const refName = (val as {variable: string}).variable;
        if (refName in rawSymbols) {
          const symbolVal = rawSymbols[refName];
          if (
            symbolVal &&
            typeof symbolVal === 'object' &&
            'call' in symbolVal &&
            this.helper.components.has((symbolVal as ExpressCallValue).call)
          ) {
            return refName;
          }
          return this._compileValue(symbolVal, rawSymbols, ctx, isAction);
        }
        return refName;
      }

      if ('check' in val) {
        const checkVal = val as ExpressCheckValue;
        const checkName = checkVal.check;
        const checkArgs = checkVal.args ?? [];

        const compiledArgs: Record<string, unknown> = {};
        const checkProps = this.helper.getFunctionProperties(checkName);

        const explicitArgs = [...checkArgs];
        let isValueInjected = false;

        // Sanctioned departure §5.2 item 3: implicit first argument injection
        if (checkProps.length > 0) {
          const first = checkProps[0];
          const firstIsPath =
            explicitArgs.length > 0 &&
            explicitArgs[0] &&
            typeof explicitArgs[0] === 'object' &&
            'path' in explicitArgs[0];

          if (!firstIsPath) {
            const bound = ctx.activeBoundPaths.get(first);
            if (bound) {
              compiledArgs[first] = bound;
              isValueInjected = true;
            }
          }
        }

        const startPropIdx = isValueInjected ? 1 : 0;
        for (let cIdx = 0; cIdx < explicitArgs.length; cIdx++) {
          const cArg = explicitArgs[cIdx];
          const propTargetIdx = cIdx + startPropIdx;
          if (propTargetIdx < checkProps.length) {
            const propName = checkProps[propTargetIdx];
            const propSchema = this.helper.getFunctionPropertySchema(checkName, propName);
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
              break;
            }

            if (
              cArg &&
              typeof cArg === 'object' &&
              'skipped' in cArg &&
              (cArg as ExpressSkippedValue).skipped
            ) {
              continue;
            }
            compiledArgs[propName] = this._compileValue(cArg, rawSymbols, ctx, isAction);
          }
        }

        return {call: checkName, args: compiledArgs};
      }

      if ('call' in val) {
        const callVal = val as ExpressCallValue;
        const fnName = callVal.call;
        const fnArgs = callVal.args ?? [];
        const fnKwargs = callVal.kwargs ?? {};

        // 1. Is it an inline component constructor?
        if (this.helper.components.has(fnName)) {
          ctx.inlineCounter += 1;
          const inlineId = inlineCtx
            ? inlineCtx.index !== undefined
              ? `${inlineCtx.parentId}_${inlineCtx.property}_${inlineCtx.index}`
              : `${inlineCtx.parentId}_${inlineCtx.property}`
            : `_inline_${ctx.inlineCounter}`;
          if (inlineId in rawSymbols || ctx.generatedIds.has(inlineId)) {
            throw new ExpressIdCollisionError(inlineId);
          }
          ctx.generatedIds.add(inlineId);
          const extraStartIndex = ctx.extraComponents.length;
          const compiledInline = this._compileAstNode(inlineId, val, rawSymbols, ctx);
          if (compiledInline) {
            ctx.extraComponents.splice(extraStartIndex, 0, compiledInline);
          }
          return inlineId;
        }

        // 2. Is it a reserved _template signature?
        if (fnName === '_template') {
          if (fnArgs.length < 2) {
            throw new ExpressParseError(
              '_template helper requires exactly 2 arguments: path and templateComponent.',
            );
          }
          const pathVal = this._compileValue(fnArgs[0], rawSymbols, ctx, isAction);
          if (!pathVal || typeof pathVal !== 'object' || !('path' in pathVal)) {
            throw new ExpressParseError(
              `The first argument to _template must be a dynamic data binding path (prefixed by $), got: ${pyRepr(fnArgs[0])}`,
            );
          }
          const compIdVal = this._compileValue(fnArgs[1], rawSymbols, ctx, isAction);
          return {path: (pathVal as ExpressPathValue).path, componentId: compIdVal};
        }

        // 3. Is it a reserved Event signature?
        if (fnName === 'Event') {
          const compiledEventName =
            fnArgs.length > 0 ? this._compileValue(fnArgs[0], rawSymbols, ctx, isAction) : '';

          if (fnArgs.length <= 1) {
            return {
              event: {
                name: compiledEventName,
              },
            };
          }

          const rawContext = this._compileValue(fnArgs[1], rawSymbols, ctx, isAction);
          const compiledContext: Record<string, unknown> = {};
          if (rawContext && typeof rawContext === 'object') {
            if (Array.isArray(rawContext)) {
              for (const item of rawContext) {
                if (item && typeof item === 'object' && !Array.isArray(item)) {
                  Object.assign(compiledContext, item);
                }
              }
            } else {
              Object.assign(compiledContext, rawContext);
            }
          }
          return {
            event: {
              name: compiledEventName,
              context: compiledContext,
            },
          };
        }

        // 4. Is it a regular catalog function?
        if (this.helper.functions.has(fnName)) {
          const fnProps = this.helper.getFunctionProperties(fnName);
          const compiledArgs: Record<string, unknown> = {};
          for (let idx = 0; idx < fnArgs.length; idx++) {
            const arg = fnArgs[idx];
            if (idx < fnProps.length) {
              if (
                arg &&
                typeof arg === 'object' &&
                'skipped' in arg &&
                (arg as ExpressSkippedValue).skipped
              ) {
                continue;
              }
              const valItem = this._compileValue(arg, rawSymbols, ctx, isAction);
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
            if (
              v &&
              typeof v === 'object' &&
              'skipped' in v &&
              (v as ExpressSkippedValue).skipped
            ) {
              continue;
            }
            const valItem = this._compileValue(v, rawSymbols, ctx, isAction);
            if (valItem !== undefined && valItem !== null) {
              compiledArgs[k] = valItem;
            }
          }

          // Wrap in functionCall only if inside an action field
          if (isAction) {
            return {
              functionCall: {call: fnName, args: compiledArgs},
            };
          }

          // Otherwise, compile direct dynamic function call expression
          return {call: fnName, args: compiledArgs};
        }

        // Fallback for unknown functions
        throw new ExpressUnknownFunctionError(fnName);
      }

      if (Array.isArray(val)) {
        return val.map((item, index) =>
          this._compileValue(
            item,
            rawSymbols,
            ctx,
            isAction,
            inlineCtx ? {...inlineCtx, index} : undefined,
          ),
        );
      }

      const dictRes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        dictRes[k] = this._compileValue(v, rawSymbols, ctx, isAction);
      }
      return dictRes;
    }

    return val;
  }

  /**
   * Validates dynamic databindings against the schema (sanctioned departure §5.2 item 5).
   *
   * Walks the compiled value alongside the schema. At each node, if the value is a
   * dynamic databinding, it is allowed iff `helper.admitsPath(schemaAtThisPosition)`.
   * Descends into arrays via schema `items` and into objects via `properties[key]`.
   * If schema cannot be determined at a position, the binding is treated as allowed.
   */
  private _checkDataBindings(
    compName: string,
    topLevelPropName: string,
    val: unknown,
    schema: unknown,
  ): void {
    const walk = (v: unknown, s: unknown): void => {
      if (isDirectBinding(v)) {
        if (s && !this.helper.admitsPath(s)) {
          throw new ExpressForbiddenDatabindingError(compName, topLevelPropName);
        }
        return;
      }
      if (Array.isArray(v)) {
        const itemSchema = s ? this.helper.resolveSubschema(s, 'items') : undefined;
        for (const item of v) {
          walk(item, itemSchema);
        }
        return;
      }
      if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        if ('call' in obj || 'event' in obj || 'functionCall' in obj) {
          return;
        }
        for (const [k, subVal] of Object.entries(obj)) {
          const propSchema = s ? this.helper.resolveSubschema(s, k) : undefined;
          walk(subVal, propSchema);
        }
      }
    };

    walk(val, schema);
  }
}
