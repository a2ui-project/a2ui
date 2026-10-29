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
 * Decompilation engine for A2UI Express.
 *
 * Reconstructs standard A2UI envelopes back into A2UI Express DSL code.
 */

import {
  A2uiValidationError,
  AgentToRendererMessage,
  CatalogApi,
  compareSemVer,
  isValidUax31Identifier,
} from '../../internal/web-core.js';
import {A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG} from '../../parser/constants.js';
import {RawResponsePart} from '../../parser/response-part.js';
import {
  buildSchemaHelpers,
  catalogsDefining,
  checkMixedCatalogs,
  toCatalogList,
  unknownCatalogError,
  unknownSymbolError,
} from './catalogs.js';
import {ExpressValidationError} from './errors.js';
import {assignVariableNames, isExpressIdentifier} from './identifier.js';
import {CatalogSchemaHelper, commonDefName} from './schema-helper.js';

/**
 * Wrapper for numeric literals that must retain raw formatting (e.g. floats like 1500.0).
 */
export class RawNumber {
  constructor(public readonly value: string) {}
}

/**
 * Returns the value as a plain object, or undefined if it is not one.
 *
 * @param value The value to check.
 * @returns The value typed as a record, or undefined.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Reads an optional object-valued field, such as an event's `context` or a call's `args`.
 *
 * @param value The field's value.
 * @param owner Describes the object holding the field, for the error message.
 * @param field The field's name, for the error message.
 * @returns The value as a record, or an empty record when it is absent or null.
 * @throws {ExpressValidationError} If the value is present but not a plain object.
 */
function optionalObjectField(
  value: unknown,
  owner: string,
  field: string,
): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  const record = asRecord(value);
  if (!record) {
    throw new ExpressValidationError(`${owner} has a non-object '${field}'`);
  }
  return record;
}

/**
 * Returns whether a data model value has anything to write.
 *
 * Only an empty object has nothing: an empty string, zero, `false` or an empty list at
 * a path is a value the renderer must receive.
 *
 * @param value The value of a data model write.
 */
export function hasDataToWrite(value: unknown): boolean {
  return !(
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof RawNumber) &&
    Object.keys(value).length === 0
  );
}

/**
 * Flattens a nested dictionary dataModel structure into JSON Pointer path segments.
 *
 * A non-object value yields a single entry at the root path `''`.
 *
 * @param dataDict The nested data object, or any other JSON value.
 * @returns Array of [path, value] tuples.
 */
export function flattenDataModel(dataDict: unknown): Array<[string, unknown]> {
  const results: Array<[string, unknown]> = [];

  function recurse(current: unknown, path: string): void {
    if (current instanceof RawNumber) {
      results.push([path, current]);
      return;
    }
    if (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      Object.keys(current).length > 0
    ) {
      for (const [k, v] of Object.entries(current as Record<string, unknown>)) {
        recurse(v, `${path}/${k}`);
      }
    } else {
      results.push([path, current]);
    }
  }

  recurse(dataDict, '');
  return results;
}

/**
 * Checks if a property schema defines a component reference (ComponentId or list of ComponentId).
 *
 * Catalog-agnostic: uses exact def name matching via `commonDefName` (plan §5.1, §5.2 item 6).
 *
 * @param propSchema The property JSON schema to inspect.
 * @returns True if property references component ID.
 */
export function isComponentReferenceProperty(propSchema: unknown): boolean {
  if (!propSchema || typeof propSchema !== 'object') {
    return false;
  }
  const schema = propSchema as Record<string, unknown>;
  if (typeof schema.$ref === 'string') {
    const def = commonDefName(schema.$ref);
    if (def === 'ComponentId' || def === 'Child' || def === 'ChildList') {
      return true;
    }
  }
  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const subs = schema[key];
    if (Array.isArray(subs)) {
      for (const sub of subs) {
        if (isComponentReferenceProperty(sub)) {
          return true;
        }
      }
    }
  }
  if (schema.type === 'array' && schema.items) {
    return isComponentReferenceProperty(schema.items);
  }
  return false;
}

/**
 * Writes a number the way ECMAScript `Number.prototype.toString` does, which is
 * the spelling the Express grammar and every SDK's decompiler agree on: plain
 * decimal for 1e-6 ≤ |v| < 1e21, otherwise exponent form such as `1e-7` or
 * `1.5e+21`. Negative zero is written `-0.0`, since `String(-0)` is `"0"`.
 *
 * @param val The number to decompile.
 * @returns The Express number literal.
 * @throws {A2uiValidationError} When `val` is `NaN` or infinite, which Express
 *   has no notation for.
 */
export function decompileNumber(val: number): string {
  if (!Number.isFinite(val)) {
    throw new A2uiValidationError(`The number ${val} has no Express notation.`);
  }
  if (Object.is(val, -0)) {
    return '-0.0';
  }
  return String(val);
}

/**
 * Formats a string literal using the cleanest/most readable representation.
 *
 * @param val The string value to decompile.
 * @returns The quoted Express string literal.
 */
export function decompileString(val: string): string {
  const hasNewline = val.includes('\n') || val.includes('\r');
  const hasTab = val.includes('\t');
  const hasBackslash = val.includes('\\');

  // 1. Multi-line strings use triple-quotes
  if (hasNewline && !val.endsWith('"') && !val.includes('"""')) {
    // Use raw triple quotes if there are backslashes but no tabs
    if (hasBackslash && !hasTab) {
      return `r"""${val}"""`;
    }
    // Otherwise standard triple quotes
    const escaped = val.replaceAll('\\', '\\\\').replaceAll('\t', '\\t');
    return `"""${escaped}"""`;
  }

  // 2. Use single-line raw string if it has backslashes but no quotes/tabs/newlines
  if (hasBackslash && !hasNewline && !hasTab && !val.includes('"')) {
    return `r"${val}"`;
  }

  // 3. Fall back to standard double-quoted string with escapes
  const escaped = val
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  return `"${escaped}"`;
}

/**
 * Writes a reference to a component by ID.
 *
 * A component defined in the same block is referenced by its variable name.
 * A component defined elsewhere, such as in an earlier turn, is referenced
 * by a bare name when its ID is a valid UAX 31 variable name that the block
 * does not define, which the compiler reads back as that ID, and by a quoted
 * ID otherwise.
 */
function decompileReference(componentId: string, varNames: ReadonlyMap<string, string>): string {
  const assigned = varNames.get(componentId);
  if (assigned !== undefined) {
    return assigned;
  }
  if (isExpressIdentifier(componentId)) {
    let isTaken = false;
    for (const value of varNames.values()) {
      if (value === componentId) {
        isTaken = true;
        break;
      }
    }
    if (!isTaken) {
      return componentId;
    }
  }
  return decompileString(componentId);
}

/**
 * Converts standard A2UI wire JSON trees back into A2UI Express syntax.
 */
export class ExpressDecompiler {
  readonly helpers: Map<string, CatalogSchemaHelper>;
  readonly catalogs: CatalogApi[];
  readonly protocolVersion: string;
  private readonly soleCatalogId: string | undefined;
  private readonly isV1: boolean;

  /**
   * @param catalogs The catalog, or several.
   * @param protocolVersion The protocol version of the messages.
   */
  constructor(catalogs: CatalogApi | CatalogApi[], protocolVersion: string) {
    this.catalogs = toCatalogList(catalogs);
    checkMixedCatalogs(this.catalogs);
    this.protocolVersion = protocolVersion;
    this.helpers = buildSchemaHelpers(this.catalogs, protocolVersion);
    this.soleCatalogId = this.catalogs.length === 1 ? this.catalogs[0].id : undefined;
    this.isV1 = compareSemVer(this.protocolVersion, '1.0.0') >= 0;
  }

  /**
   * Resolves a component or function against its explicit or surface catalog, returning
   * the catalog's schema helper and the `catalogId` to write (if any).
   */
  private resolveSymbol(
    kind: 'component' | 'function',
    name: string,
    itemCatalogId: unknown,
    surfaceCatalogId: string | undefined,
  ): {helper: CatalogSchemaHelper; catalogId?: string} {
    const label = kind === 'component' ? 'Component' : 'Function';
    const actual =
      (typeof itemCatalogId === 'string' && itemCatalogId ? itemCatalogId : undefined) ??
      surfaceCatalogId;
    if (!actual) {
      throw new ExpressValidationError(
        `${label} '${name}' has no catalogId and its surface has no catalogId.`,
      );
    }
    const helper = this.helpers.get(actual);
    if (!helper) {
      throw unknownCatalogError(`${label} '${name}'`, actual, this.catalogs);
    }
    const defs = kind === 'component' ? helper.components : helper.functions;
    if (!defs.has(name)) {
      throw unknownSymbolError(kind, name, actual, this.helpers);
    }
    if (this.soleCatalogId !== undefined) {
      return {helper};
    }
    const defining = catalogsDefining(this.helpers, kind, name);
    if (defining.length === 1 && defining[0] === actual) {
      return {helper};
    }
    return {helper, catalogId: actual};
  }

  /**
   * Coalesces split surface messages (`createSurface` followed by `updateComponents` and
   * root `updateDataModel`) into the open `createSurface` for that surface, while keeping
   * incremental updates as separate messages.
   */
  private coalesceSurfaceMessages(
    messages: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    const openBySurface = new Map<string, number>();

    for (const rawMsg of messages) {
      const msg = asRecord(rawMsg);
      if (!msg || Object.keys(msg).length === 0) {
        continue;
      }

      const cs = asRecord(msg.createSurface);
      if (cs) {
        const sid =
          typeof cs.surfaceId === 'string' && cs.surfaceId ? cs.surfaceId : 'default_surface';
        const copy: Record<string, unknown> = {...msg, createSurface: {...cs}};
        openBySurface.set(sid, result.length);
        result.push(copy);
        continue;
      }

      const ds = asRecord(msg.deleteSurface);
      if (ds) {
        const sid =
          typeof ds.surfaceId === 'string' && ds.surfaceId ? ds.surfaceId : 'default_surface';
        openBySurface.delete(sid);
        result.push(msg);
        continue;
      }

      if (asRecord(msg.callRendererFunction) || asRecord(msg.callFunction)) {
        openBySurface.clear();
        result.push(msg);
        continue;
      }

      const uc = asRecord(msg.updateComponents);
      if (uc) {
        const sid =
          typeof uc.surfaceId === 'string' && uc.surfaceId ? uc.surfaceId : 'default_surface';
        if (openBySurface.has(sid)) {
          const openCs = result[openBySurface.get(sid)!].createSurface as Record<string, unknown>;
          if (!openCs.components) {
            openCs.components = uc.components;
            continue;
          }
          openBySurface.delete(sid);
        }
        result.push(msg);
        continue;
      }

      const udm = asRecord(msg.updateDataModel);
      if (udm) {
        const sid =
          typeof udm.surfaceId === 'string' && udm.surfaceId ? udm.surfaceId : 'default_surface';
        if (openBySurface.has(sid)) {
          const openCs = result[openBySurface.get(sid)!].createSurface as Record<string, unknown>;
          const isRootPath =
            udm.path === undefined || udm.path === null || udm.path === '' || udm.path === '/';
          const valObj = asRecord(udm.value);
          if (isRootPath && valObj) {
            openCs.dataModel = {...valObj};
            continue;
          }
          openBySurface.delete(sid);
        }
        result.push(msg);
        continue;
      }

      result.push(msg);
    }

    return result;
  }

  /**
   * Formats a `surface(...)` statement line, omitting `catalogId`.
   */
  private formatSurfaceHeader(
    surfaceId: string,
    opts: {sendDataModel?: boolean; update?: boolean} = {},
  ): string {
    const parts: string[] = [decompileString(surfaceId)];
    if (typeof opts.sendDataModel === 'boolean') {
      parts.push(`sendDataModel=${opts.sendDataModel ? 'true' : 'false'}`);
    }
    if (opts.update) {
      parts.push('update=true');
    }
    return `surface(${parts.join(', ')})`;
  }

  /**
   * Wraps individual decompiled A2UI Express DSL blocks within sentinel tags.
   *
   * @param blocks A list of decompiled A2UI Express DSL statement strings.
   * @returns The merged A2UI Express DSL string enclosed within opening and closing sentinel tags.
   */
  wrapDecompiledBlocks(blocks: string[]): string {
    const fullDsl = blocks.join('\n');
    return `${A2UI_INFERENCE_OPEN_TAG}\n${fullDsl}\n${A2UI_INFERENCE_CLOSE_TAG}`;
  }

  /**
   * Wraps raw response parts, adding format tags around A2UI payload sections.
   *
   * @param blocks A list of raw response parts.
   * @returns The formatted response string.
   */
  wrap(blocks: RawResponsePart[]): string {
    let result = '';
    for (const block of blocks) {
      if (block.type === 'text') {
        result += block.text + '\n';
      } else if (block.type === 'a2ui') {
        result += `${A2UI_INFERENCE_OPEN_TAG}\n${block.a2uiRaw}\n${A2UI_INFERENCE_CLOSE_TAG}\n`;
      }
    }
    return result.trimEnd();
  }

  /**
   * Decompiles standard A2UI wire JSON into clean A2UI Express lines.
   *
   * @param messages Standard A2UI wire JSON envelope dict or list of message dicts.
   * @param useKeywordArgs Whether to format component arguments as keyword parameters (e.g. param=value).
   * @returns The decompiled A2UI Express DSL string.
   */
  decompile(
    messages: AgentToRendererMessage | AgentToRendererMessage[],
    useKeywordArgs = false,
  ): string {
    const rawList = Array.isArray(messages) ? messages : [messages];
    const coalesced = this.coalesceSurfaceMessages(
      rawList as unknown as Array<Record<string, unknown>>,
    );
    const surfaceCatalogs = new Map<string, string>();
    const blocks: string[] = [];
    let callIndex = 0;

    for (const envelope of coalesced) {
      const isFirst = blocks.length === 0;
      const ds = asRecord(envelope.deleteSurface);
      if (ds) {
        blocks.push(this.decompileDeleteSurface(ds, surfaceCatalogs));
        continue;
      }

      const crf = asRecord(envelope.callRendererFunction);
      const funcOp = crf ? asRecord(crf.callFunction) : asRecord(envelope.callFunction);
      if (funcOp) {
        callIndex += 1;
        const callId =
          crf && typeof crf.functionCallId === 'string' && crf.functionCallId
            ? crf.functionCallId
            : undefined;
        blocks.push(this.decompileCallFunction(funcOp, callId, callIndex));
        continue;
      }

      const udm = asRecord(envelope.updateDataModel);
      if (udm) {
        const block = this.decompileUpdateDataModel(udm, surfaceCatalogs, isFirst);
        if (block) blocks.push(block);
        continue;
      }

      const cs = asRecord(envelope.createSurface);
      if (cs) {
        const block = this.decompileCreateSurface(cs, surfaceCatalogs, useKeywordArgs, isFirst);
        if (block) blocks.push(block);
        continue;
      }

      const uc = asRecord(envelope.updateComponents);
      if (uc) {
        const block = this.decompileUpdateComponents(uc, surfaceCatalogs, useKeywordArgs, isFirst);
        if (block) blocks.push(block);
        continue;
      }
    }

    return blocks.join('\n');
  }

  private resolveSurfaceContext(
    surfaceId: string,
    surfaceCatalogs: ReadonlyMap<string, string>,
  ): {surfaceCatalogId: string | undefined; helper: CatalogSchemaHelper} {
    const surfaceCatalogId = surfaceCatalogs.get(surfaceId) ?? this.soleCatalogId;
    const helper =
      (surfaceCatalogId ? this.helpers.get(surfaceCatalogId) : undefined) ??
      this.helpers.get(this.catalogs[0].id)!;
    return {surfaceCatalogId, helper};
  }

  private checkComponentIds(componentIds: readonly string[]): void {
    if (!this.isV1) {
      return;
    }
    const details = componentIds
      .filter(cid => !isValidUax31Identifier(cid))
      .map(cid => ({
        path: `components.${cid}.id`,
        code: 'invalid_identifier',
        message: `Component id '${cid}' must be a valid UAX #31 identifier`,
      }));
    if (details.length > 0) {
      throw new A2uiValidationError(details[0].message, details);
    }
  }

  private collectVariableNames(components: Array<Record<string, unknown>>): Map<string, string> {
    const compIds: string[] = [];
    for (const c of components) {
      if (typeof c.id === 'string') {
        compIds.push(c.id);
      }
    }
    this.checkComponentIds(compIds);
    return assignVariableNames(compIds);
  }

  private formatDataModelLines(
    dataVal: unknown,
    basePath: string,
    varNames: ReadonlyMap<string, string>,
    helper: CatalogSchemaHelper,
    surfaceCatalogId: string | undefined,
  ): string[] {
    if (!basePath && !hasDataToWrite(dataVal)) {
      return [];
    }
    const flattened = flattenDataModel(dataVal);
    flattened.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return flattened.map(([leafPath, val]) => {
      const combinedPath = basePath ? `${basePath}${leafPath}` : leafPath;
      const valStr = this.decompileValue(val, varNames, false, helper, surfaceCatalogId);
      return `$${combinedPath} = ${valStr}`;
    });
  }

  private decompileDeleteSurface(
    surfOp: Record<string, unknown>,
    surfaceCatalogs: Map<string, string>,
  ): string {
    const surfaceId = typeof surfOp.surfaceId === 'string' ? surfOp.surfaceId : '';
    surfaceCatalogs.delete(surfaceId || 'default_surface');
    return `deleteSurface(${decompileString(surfaceId)})`;
  }

  private decompileCallFunction(
    funcOp: Record<string, unknown>,
    functionCallId: string | undefined,
    callIndex: number,
  ): string {
    const extraKwargs =
      functionCallId && functionCallId !== `call_${callIndex}`
        ? [`functionCallId=${decompileString(functionCallId)}`]
        : undefined;
    return this.formatFunctionCall(funcOp, new Map(), this.soleCatalogId, extraKwargs);
  }

  private decompileUpdateDataModel(
    valOp: Record<string, unknown>,
    surfaceCatalogs: ReadonlyMap<string, string>,
    isFirst: boolean,
  ): string | undefined {
    const surfaceId =
      typeof valOp.surfaceId === 'string' && valOp.surfaceId ? valOp.surfaceId : 'default_surface';
    const {surfaceCatalogId, helper} = this.resolveSurfaceContext(surfaceId, surfaceCatalogs);
    const rawPath = typeof valOp.path === 'string' && valOp.path ? valOp.path : '/';
    const basePath = rawPath.replace(/\/+$/, '');
    const dataVal = basePath ? (valOp.value ?? null) : (valOp.value ?? {});
    const valStr = this.decompileValue(dataVal, new Map(), false, helper, surfaceCatalogId);
    const pathStr = basePath ? `$${basePath}` : '$/';

    const dslLines: string[] = [];
    if (!(isFirst && surfaceId === 'default_surface')) {
      dslLines.push(this.formatSurfaceHeader(surfaceId));
    }
    dslLines.push(`${pathStr} = ${valStr}`);
    return dslLines.join('\n');
  }

  private decompileCreateSurface(
    cs: Record<string, unknown>,
    surfaceCatalogs: Map<string, string>,
    useKeywordArgs: boolean,
    isFirst: boolean,
  ): string | undefined {
    const surfaceId =
      typeof cs.surfaceId === 'string' && cs.surfaceId ? cs.surfaceId : 'default_surface';
    if (typeof cs.catalogId === 'string' && cs.catalogId) {
      if (this.helpers.size > 0 && !this.helpers.has(cs.catalogId)) {
        throw unknownCatalogError(`Surface '${surfaceId}'`, cs.catalogId, this.catalogs);
      }
      surfaceCatalogs.set(surfaceId, cs.catalogId);
    } else {
      surfaceCatalogs.delete(surfaceId);
    }
    const {surfaceCatalogId, helper} = this.resolveSurfaceContext(surfaceId, surfaceCatalogs);

    const sendDataModel = typeof cs.sendDataModel === 'boolean' ? cs.sendDataModel : undefined;
    const dslLines: string[] = [];
    if (!(isFirst && surfaceId === 'default_surface' && sendDataModel === undefined)) {
      dslLines.push(this.formatSurfaceHeader(surfaceId, {sendDataModel}));
    }

    const components = Array.isArray(cs.components)
      ? (cs.components as Array<Record<string, unknown>>)
      : [];
    const varNames = this.collectVariableNames(components);

    if (asRecord(cs.dataModel)) {
      dslLines.push(
        ...this.formatDataModelLines(cs.dataModel, '', varNames, helper, surfaceCatalogId),
      );
    }

    for (const c of components) {
      dslLines.push(this.formatComponent(c, varNames, surfaceCatalogId, useKeywordArgs));
    }

    return dslLines.length > 0 ? dslLines.join('\n') : undefined;
  }

  private decompileUpdateComponents(
    uc: Record<string, unknown>,
    surfaceCatalogs: ReadonlyMap<string, string>,
    useKeywordArgs: boolean,
    isFirst: boolean,
  ): string | undefined {
    const surfaceId =
      typeof uc.surfaceId === 'string' && uc.surfaceId ? uc.surfaceId : 'default_surface';
    const {surfaceCatalogId} = this.resolveSurfaceContext(surfaceId, surfaceCatalogs);
    const components = Array.isArray(uc.components)
      ? (uc.components as Array<Record<string, unknown>>)
      : [];
    const hasRoot = components.some(c => asRecord(c)?.id === 'root');

    const dslLines: string[] = [];
    if (hasRoot || !(isFirst && surfaceId === 'default_surface')) {
      dslLines.push(
        this.formatSurfaceHeader(surfaceId, {
          update: hasRoot ? true : undefined,
        }),
      );
    }

    const varNames = this.collectVariableNames(components);
    for (const c of components) {
      dslLines.push(this.formatComponent(c, varNames, surfaceCatalogId, useKeywordArgs));
    }

    return dslLines.length > 0 ? dslLines.join('\n') : undefined;
  }

  private trimTrailingPlaceholders(argsReprs: string[]): void {
    while (argsReprs.length > 0 && argsReprs[argsReprs.length - 1] === '_') {
      argsReprs.pop();
    }
  }

  private formatCheckPropertyArg(
    propName: string,
    checksVal: unknown,
    comp: Record<string, unknown>,
    varNames: ReadonlyMap<string, string>,
    surfaceCatalogId: string | undefined,
    useKeywordArgs: boolean,
  ): string | undefined {
    if (!Array.isArray(checksVal) || checksVal.length === 0) {
      return useKeywordArgs ? undefined : '_';
    }

    const compiledChecksList: string[] = [];
    for (const rc of checksVal) {
      const ruleRecord = asRecord(rc);
      if (ruleRecord) {
        compiledChecksList.push(this.formatCheckRule(ruleRecord, comp, varNames, surfaceCatalogId));
      }
    }

    const checksRepr =
      compiledChecksList.length === 1
        ? compiledChecksList[0]
        : `[${compiledChecksList.join(', ')}]`;
    return useKeywordArgs ? `${propName}=${checksRepr}` : checksRepr;
  }

  private formatRegularPropertyArg(
    comp: Record<string, unknown>,
    compName: string,
    propName: string,
    properties: string[],
    checkProp: string | undefined,
    varNames: ReadonlyMap<string, string>,
    helper: CatalogSchemaHelper,
    surfaceCatalogId: string | undefined,
    useKeywordArgs: boolean,
  ): string | undefined {
    if (propName in comp) {
      const pSchema = helper.getPropertySchema(compName, propName);
      const isPropRef = isComponentReferenceProperty(pSchema);
      const valStr = this.decompileValue(
        comp[propName],
        varNames,
        isPropRef,
        helper,
        surfaceCatalogId,
      );
      return useKeywordArgs ? `${propName}=${valStr}` : valStr;
    }

    if (useKeywordArgs) {
      return undefined;
    }

    const idx = properties.indexOf(propName);
    const hasSubsequentVal = properties.slice(idx + 1).some(p => p !== checkProp && p in comp);
    return hasSubsequentVal ? '_' : undefined;
  }

  /**
   * Formats a single component definition into an Express assignment line.
   */
  private formatComponent(
    comp: Record<string, unknown>,
    varNames: ReadonlyMap<string, string>,
    surfaceCatalogId: string | undefined,
    useKeywordArgs: boolean,
  ): string {
    const compId = typeof comp.id === 'string' ? comp.id : '';
    const varName = varNames.get(compId) ?? compId;
    const compName = typeof comp.component === 'string' ? comp.component : '';

    const {helper, catalogId: emitCatalogId} = this.resolveSymbol(
      'component',
      compName,
      comp.catalogId,
      surfaceCatalogId,
    );

    const properties = helper.getComponentProperties(compName);
    const checkProp = helper.getCheckRuleProperty(compName);
    const argsReprs: string[] = [];

    for (const propName of properties) {
      const arg =
        checkProp && propName === checkProp
          ? this.formatCheckPropertyArg(
              propName,
              comp[checkProp],
              comp,
              varNames,
              surfaceCatalogId,
              useKeywordArgs,
            )
          : this.formatRegularPropertyArg(
              comp,
              compName,
              propName,
              properties,
              checkProp,
              varNames,
              helper,
              surfaceCatalogId,
              useKeywordArgs,
            );
      if (arg !== undefined) {
        argsReprs.push(arg);
      }
    }

    this.trimTrailingPlaceholders(argsReprs);

    if (emitCatalogId !== undefined) {
      argsReprs.push(`catalogId=${decompileString(emitCatalogId)}`);
    }
    if (varName !== compId) {
      argsReprs.push(`id=${decompileString(compId)}`);
    }

    return `${varName} = ${compName}(${argsReprs.join(', ')})`;
  }

  /**
   * Formats a check rule as `?funcName(...)` or `?funcName`.
   */
  private formatCheckRule(
    rule: Record<string, unknown>,
    component: Record<string, unknown>,
    varNames: ReadonlyMap<string, string>,
    surfaceCatalogId: string | undefined,
  ): string {
    const hasCondition = 'condition' in rule && asRecord(rule.condition) !== undefined;
    const condition = hasCondition ? (rule.condition as Record<string, unknown>) : rule;
    const message = hasCondition && typeof rule.message === 'string' ? rule.message : '';

    const rawCall = condition['@call'] ?? condition['call'];
    const funcName = typeof rawCall === 'string' && rawCall ? rawCall : 'None';
    const checkArgs = optionalObjectField(condition.args, `Check '${funcName}'`, 'args');

    let chkHelper: CatalogSchemaHelper | undefined;
    let emitCatalogId: string | undefined;
    if (funcName !== 'None') {
      ({helper: chkHelper, catalogId: emitCatalogId} = this.resolveSymbol(
        'function',
        funcName,
        condition.catalogId,
        surfaceCatalogId,
      ));
    }

    const checkProps = chkHelper ? chkHelper.getFunctionProperties(funcName) : [];
    const helper = chkHelper ?? this.helpers.get(this.catalogs[0].id)!;

    const componentValue = asRecord(component.value);
    const checkValue = asRecord(checkArgs.value);
    const compValPath = componentValue
      ? (componentValue['@path'] ?? componentValue['path'])
      : undefined;
    const checkValPath = checkValue ? (checkValue['@path'] ?? checkValue['path']) : undefined;

    let startIdx = 0;
    if (
      checkProps.length > 0 &&
      checkProps[0] === 'value' &&
      typeof compValPath === 'string' &&
      compValPath === checkValPath
    ) {
      startIdx = 1;
    }

    const explicitArgsReprs: string[] = [];
    for (let idx = startIdx; idx < checkProps.length; idx++) {
      const p = checkProps[idx];
      if (p in checkArgs) {
        explicitArgsReprs.push(
          this.decompileValue(checkArgs[p], varNames, false, helper, surfaceCatalogId),
        );
      } else {
        explicitArgsReprs.push('_');
      }
    }

    const capName =
      funcName.length > 0 ? funcName[0].toUpperCase() + funcName.slice(1).toLowerCase() : funcName;
    if (funcName !== 'None' && message && message !== `${capName} check failed`) {
      explicitArgsReprs.push(decompileString(message));
    } else {
      this.trimTrailingPlaceholders(explicitArgsReprs);
    }

    if (emitCatalogId !== undefined) {
      explicitArgsReprs.push(`{catalogId: ${decompileString(emitCatalogId)}}`);
    }

    if (explicitArgsReprs.length > 0) {
      return `?${funcName}(${explicitArgsReprs.join(', ')})`;
    }
    return `?${funcName}`;
  }

  /**
   * Formats a function call object into an Express call string.
   */
  private formatFunctionCall(
    funcCall: Record<string, unknown>,
    varNames: ReadonlyMap<string, string>,
    surfaceCatalogId: string | undefined,
    extraKwargs?: string[],
  ): string {
    const rawCall = funcCall['@call'] ?? funcCall['call'];
    const funcName = typeof rawCall === 'string' ? rawCall : '';
    const rawArgs = funcCall.args;
    const isListArgs = Array.isArray(rawArgs);
    const dictArgs = isListArgs
      ? {}
      : optionalObjectField(rawArgs, `Function call '${funcName}'`, 'args');

    const {helper, catalogId: emitCatalogId} = this.resolveSymbol(
      'function',
      funcName,
      funcCall.catalogId,
      surfaceCatalogId,
    );

    const fnProps = helper.getFunctionProperties(funcName);
    const argsReprs: string[] = [];
    for (let idx = 0; idx < fnProps.length; idx++) {
      const p = fnProps[idx];
      const present = isListArgs ? idx < rawArgs.length : p in dictArgs;
      if (present) {
        const argVal = isListArgs ? rawArgs[idx] : dictArgs[p];
        argsReprs.push(this.decompileValue(argVal, varNames, false, helper, surfaceCatalogId));
      } else {
        argsReprs.push('_');
      }
    }
    this.trimTrailingPlaceholders(argsReprs);

    if (emitCatalogId !== undefined) {
      argsReprs.push(`catalogId=${decompileString(emitCatalogId)}`);
    }
    if (extraKwargs && extraKwargs.length > 0) {
      argsReprs.push(...extraKwargs);
    }

    return `${funcName}(${argsReprs.join(', ')})`;
  }

  /**
   * Decompiles a single value node back to A2UI Express notation.
   *
   * @param val The JSON-serialized property value structure.
   * @param varNames Maps the ID of each component defined in the same block to its variable name.
   * @param isRef Whether this value is a component reference.
   * @param helper The schema helper of the value's catalog. Defaults to the first catalog.
   * @param surfaceCatalogId The catalog of the enclosing surface, if any.
   * @returns A plain-text representation of the value.
   */
  decompileValue(
    val: unknown,
    varNames: ReadonlyMap<string, string>,
    isRef = false,
    helper: CatalogSchemaHelper = this.helpers.get(this.catalogs[0].id)!,
    surfaceCatalogId: string | undefined = this.soleCatalogId,
  ): string {
    if (val instanceof RawNumber) {
      return val.value;
    }

    if (val === null) {
      return 'null';
    }

    if (typeof val === 'boolean') {
      return val ? 'true' : 'false';
    }

    if (typeof val === 'number') {
      return decompileNumber(val);
    }

    if (typeof val === 'string') {
      if (isRef) {
        return decompileReference(val, varNames);
      }
      return decompileString(val);
    }

    if (Array.isArray(val)) {
      const listReprs = val.map(item =>
        this.decompileValue(item, varNames, isRef, helper, surfaceCatalogId),
      );
      return `[${listReprs.join(', ')}]`;
    }

    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>;

      // A template keeps the plain `path` key in every version; a data binding uses the
      // version's reserved key.
      if (
        typeof obj.path === 'string' &&
        'componentId' in obj &&
        typeof obj.componentId === 'string'
      ) {
        const pathRepr = this.decompileValue(
          {[helper.keys.path]: obj.path},
          varNames,
          false,
          helper,
          surfaceCatalogId,
        );
        const compIdRepr = decompileReference(obj.componentId, varNames);
        return `_template(${pathRepr}, ${compIdRepr})`;
      }

      // A data binding is an object whose only key is the version's binding key, so a plain
      // `path` key in v1.0, or a binding key beside other keys, is data.
      const boundPath = obj[helper.keys.path];
      if (typeof boundPath === 'string' && Object.keys(obj).length === 1) {
        const pathStr = boundPath;
        if (pathStr.startsWith('/')) {
          return `$/${pathStr.slice(1)}`;
        }
        return `$${pathStr}`;
      }

      // Before v1.0 an event has no userMessage, and the compiler rejects `userMessage=`,
      // so such an object is written as a map literal that compiles back as written.
      if (
        'event' in obj &&
        obj.event &&
        typeof obj.event === 'object' &&
        (this.isV1 || (obj.event as Record<string, unknown>).userMessage === undefined)
      ) {
        const evt = obj.event as Record<string, unknown>;
        const name = typeof evt.name === 'string' ? evt.name : '';
        const ctx = optionalObjectField(evt.context, `Event '${name}'`, 'context');
        const ctxReprs: string[] = [];
        for (const [k, v] of Object.entries(ctx)) {
          const kRepr = isExpressIdentifier(k) ? k : decompileString(k);
          ctxReprs.push(
            `${kRepr}: ${this.decompileValue(v, varNames, false, helper, surfaceCatalogId)}`,
          );
        }
        const eventArgs = [decompileString(name)];
        if (ctxReprs.length > 0) {
          eventArgs.push(`{${ctxReprs.join(', ')}}`);
        }
        if (evt.userMessage !== undefined && evt.userMessage !== null) {
          const userMessage = this.decompileValue(
            evt.userMessage,
            varNames,
            false,
            helper,
            surfaceCatalogId,
          );
          eventArgs.push(`userMessage=${userMessage}`);
        }
        return `Event(${eventArgs.join(', ')})`;
      }

      if ('functionCall' in obj && obj.functionCall && typeof obj.functionCall === 'object') {
        return this.formatFunctionCall(
          obj.functionCall as Record<string, unknown>,
          varNames,
          surfaceCatalogId,
        );
      }

      // Only the version's function call key names a call, so a plain `call` key in v1.0 is data.
      const callName = obj[helper.keys.call];
      if (typeof callName === 'string') {
        return this.formatFunctionCall(obj, varNames, surfaceCatalogId);
      }

      // General dict
      const itemsReprs: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        const itemIsRef = isRef || k === 'child' || k === 'componentId';
        const kRepr = isExpressIdentifier(k) ? k : decompileString(k);
        itemsReprs.push(
          `${kRepr}: ${this.decompileValue(v, varNames, itemIsRef, helper, surfaceCatalogId)}`,
        );
      }
      return `{${itemsReprs.join(', ')}}`;
    }

    return String(val);
  }
}
