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

import {AgentToRendererMessage} from '../../internal/web_core.js';
import {RawResponsePart} from '../../parser/response_part.js';
import {A2UI_INFERENCE_OPEN_TAG, A2UI_INFERENCE_CLOSE_TAG} from '../../parser/constants.js';
import {SchemaCatalog} from '../../types.js';
import {CatalogSchemaHelper, commonDefName} from './schema_helper.js';

/**
 * Wrapper for numeric literals that must retain raw formatting (e.g. floats like 1500.0).
 */
export class RawNumber {
  constructor(public readonly value: string) {}
}

/**
 * Flattens a nested dictionary dataModel structure into JSON Pointer path segments.
 *
 * @param dataDict The nested data object.
 * @returns Array of [path, value] tuples.
 */
export function flattenDataModel(dataDict: Record<string, unknown>): Array<[string, unknown]> {
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
 * Formats a string literal using the cleanest/most readable representation.
 *
 * @param val The string value to decompile.
 * @returns The quoted Express string literal.
 */
export function decompileString(val: string): string {
  const hasNewline = val.includes('\n') || val.includes('\r');
  const hasTab = val.includes('\t');
  const hasQuote = val.includes('"');
  const hasBackslash = val.includes('\\');

  // 1. Use triple-quotes for multi-line or strings containing double quotes
  if ((hasQuote || hasNewline) && !val.endsWith('"')) {
    if (!val.includes('"""')) {
      // Use raw triple quotes if there are backslashes but no tabs
      if (hasBackslash && !hasTab) {
        return `r"""${val}"""`;
      }
      // Otherwise standard triple quotes
      const escaped = val.replaceAll('\\', '\\\\').replaceAll('\t', '\\t');
      return `"""${escaped}"""`;
    }
  }

  // 2. Use single-line raw string if it has backslashes but no quotes/tabs/newlines
  if (hasBackslash && !hasNewline && !hasTab && !hasQuote) {
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
 * Converts standard A2UI wire JSON trees back into A2UI Express syntax.
 */
export class ExpressDecompiler {
  readonly helper: CatalogSchemaHelper;
  readonly catalog: SchemaCatalog;
  readonly protocolVersion: string;

  constructor(catalog: SchemaCatalog, protocolVersion: string) {
    this.catalog = catalog;
    this.protocolVersion = protocolVersion;
    this.helper = new CatalogSchemaHelper(catalog, protocolVersion);
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
    if (Array.isArray(messages)) {
      return messages
        .filter(item => item && typeof item === 'object' && Object.keys(item).length > 0)
        .map(item => this.decompile(item, useKeywordArgs))
        .join('\n');
    }

    const envelope = messages as unknown as Record<string, unknown>;

    // Handle deleteSurface action
    if (
      'deleteSurface' in envelope &&
      envelope.deleteSurface &&
      typeof envelope.deleteSurface === 'object'
    ) {
      const surfOp = envelope.deleteSurface as Record<string, unknown>;
      const surfaceId = typeof surfOp.surfaceId === 'string' ? surfOp.surfaceId : '';
      return `deleteSurface("${surfaceId}")`;
    }

    // Handle updateDataModel action (known gap: standalone updateDataModel writes no surface line)
    if (
      'updateDataModel' in envelope &&
      envelope.updateDataModel &&
      typeof envelope.updateDataModel === 'object'
    ) {
      const valOp = envelope.updateDataModel as Record<string, unknown>;
      const dataVal = (valOp.value ?? {}) as Record<string, unknown>;
      const dslLines: string[] = [];
      if (dataVal && typeof dataVal === 'object') {
        const flattened = flattenDataModel(dataVal);
        flattened.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        for (const [path, val] of flattened) {
          const valStr = this.decompileValue(val, new Set(), false);
          dslLines.push(`$${path} = ${valStr}`);
        }
      }
      return dslLines.join('\n');
    }

    // Handle callFunction action
    if (
      'callFunction' in envelope &&
      envelope.callFunction &&
      typeof envelope.callFunction === 'object'
    ) {
      const funcOp = envelope.callFunction as Record<string, unknown>;
      const fnName = typeof funcOp.call === 'string' ? funcOp.call : '';
      const fnArgs = (funcOp.args ?? {}) as unknown;
      const argsList: string[] = [];
      if (this.helper.functions.has(fnName)) {
        const fnProps = this.helper.getFunctionProperties(fnName);
        if (fnArgs && typeof fnArgs === 'object' && !Array.isArray(fnArgs)) {
          const argsDict = fnArgs as Record<string, unknown>;
          for (const propName of fnProps) {
            if (propName in argsDict) {
              const valStr = this.decompileValue(argsDict[propName], new Set(), false);
              argsList.push(valStr);
            } else {
              argsList.push('_');
            }
          }
        } else if (Array.isArray(fnArgs)) {
          for (let idx = 0; idx < fnProps.length; idx++) {
            if (idx < fnArgs.length) {
              const valStr = this.decompileValue(fnArgs[idx], new Set(), false);
              argsList.push(valStr);
            } else {
              argsList.push('_');
            }
          }
        }
      } else {
        if (fnArgs && typeof fnArgs === 'object' && !Array.isArray(fnArgs)) {
          for (const v of Object.values(fnArgs as Record<string, unknown>)) {
            const valStr = this.decompileValue(v, new Set(), false);
            argsList.push(valStr);
          }
        } else if (Array.isArray(fnArgs)) {
          for (const v of fnArgs) {
            const valStr = this.decompileValue(v, new Set(), false);
            argsList.push(valStr);
          }
        }
      }
      while (argsList.length > 0 && argsList[argsList.length - 1] === '_') {
        argsList.pop();
      }
      const argsStr = argsList.join(', ');
      return `${fnName}(${argsStr})`;
    }

    // Handle createSurface and updateComponents (known gap: updateComponents writes no root)
    let createSurface: Record<string, unknown> = {};
    if (
      'createSurface' in envelope &&
      envelope.createSurface &&
      typeof envelope.createSurface === 'object'
    ) {
      createSurface = envelope.createSurface as Record<string, unknown>;
    } else if (
      'updateComponents' in envelope &&
      envelope.updateComponents &&
      typeof envelope.updateComponents === 'object'
    ) {
      createSurface = envelope.updateComponents as Record<string, unknown>;
    }

    const surfaceId = typeof createSurface.surfaceId === 'string' ? createSurface.surfaceId : '';
    const catalogId = typeof createSurface.catalogId === 'string' ? createSurface.catalogId : '';
    const components = Array.isArray(createSurface.components)
      ? (createSurface.components as Array<Record<string, unknown>>)
      : [];
    const dataModel = (createSurface.dataModel ?? {}) as Record<string, unknown>;

    let defaultCatalogId = 'https://a2ui.org/catalog.json';
    if (this.helper.catalog && typeof this.helper.catalog.catalogId === 'string') {
      defaultCatalogId = this.helper.catalog.catalogId;
    } else if (this.catalog && this.catalog.id) {
      defaultCatalogId = this.catalog.id;
    }

    const dslLines: string[] = [];
    if (surfaceId && surfaceId !== 'default_surface') {
      if (catalogId && catalogId !== defaultCatalogId) {
        dslLines.push(`surface("${surfaceId}", catalogId="${catalogId}")`);
      } else {
        dslLines.push(`surface("${surfaceId}")`);
      }
    }

    // Index components by ID for hierarchy mapping
    const compIds = new Set<string>();
    for (const c of components) {
      if (typeof c.id === 'string') {
        compIds.add(c.id);
      }
    }

    // Decompile dataModel paths first
    if (dataModel && typeof dataModel === 'object' && Object.keys(dataModel).length > 0) {
      const flattened = flattenDataModel(dataModel);
      flattened.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      for (const [path, val] of flattened) {
        const valStr = this.decompileValue(val, compIds);
        dslLines.push(`$${path} = ${valStr}`);
      }
    }

    for (const c of components) {
      const compId = typeof c.id === 'string' ? c.id : '';
      const compName = typeof c.component === 'string' ? c.component : '';
      if (!this.helper.components.has(compName)) {
        continue;
      }

      const properties = this.helper.getComponentProperties(compName);
      const argsReprs: string[] = [];
      const checkProp = this.helper.getCheckRuleProperty(compName);

      for (const propName of properties) {
        if (checkProp && propName === checkProp) {
          // Decompile checks
          const checksVal = (c[checkProp] ?? []) as Array<Record<string, unknown>>;
          if (!checksVal || checksVal.length === 0) {
            argsReprs.push('_');
            continue;
          }

          const compiledChecksList: string[] = [];
          for (const rc of checksVal) {
            const condition = (rc.condition ?? {}) as Record<string, unknown>;
            const message = typeof rc.message === 'string' ? rc.message : '';

            // If condition.call is absent, Python reproduces '?None'
            const checkName = typeof condition.call === 'string' ? condition.call : 'None';
            const checkArgs = (condition.args ?? {}) as Record<string, unknown>;

            const checkProps =
              checkName !== 'None' ? this.helper.getFunctionProperties(checkName) : [];
            const explicitArgsReprs: string[] = [];

            // If first property is value (or matching component prop), skip it (plan §5.2 item 3)
            let startIdx = 0;
            if (checkProps.length > 0 && (checkProps[0] === 'value' || checkProps[0] in c)) {
              startIdx = 1;
            }

            for (let idx = startIdx; idx < checkProps.length; idx++) {
              const p = checkProps[idx];
              if (p in checkArgs) {
                explicitArgsReprs.push(this.decompileValue(checkArgs[p], compIds));
              }
            }

            const capName =
              checkName.length > 0
                ? checkName[0].toUpperCase() + checkName.slice(1).toLowerCase()
                : checkName;
            if (checkName !== 'None' && message && message !== `${capName} check failed`) {
              explicitArgsReprs.push(decompileString(message));
            }

            if (explicitArgsReprs.length > 0) {
              compiledChecksList.push(`?${checkName}(${explicitArgsReprs.join(', ')})`);
            } else {
              compiledChecksList.push(`?${checkName}`);
            }
          }

          if (compiledChecksList.length === 1) {
            argsReprs.push(compiledChecksList[0]);
          } else {
            argsReprs.push(`[${compiledChecksList.join(', ')}]`);
          }
          continue;
        }

        // Map other regular properties
        if (propName in c) {
          const val = c[propName];
          const pSchema = this.helper.getPropertySchema(compName, propName);
          const isPropRef = isComponentReferenceProperty(pSchema);
          const valStr = this.decompileValue(val, compIds, isPropRef);
          if (useKeywordArgs) {
            argsReprs.push(`${propName}=${valStr}`);
          } else {
            argsReprs.push(valStr);
          }
        } else {
          if (!useKeywordArgs) {
            // Only append "_" if there is a subsequent regular property that has a value
            const idx = properties.indexOf(propName);
            let hasSubsequentVal = false;
            for (let i = idx + 1; i < properties.length; i++) {
              const p = properties[i];
              if (p !== checkProp && p in c) {
                hasSubsequentVal = true;
                break;
              }
            }
            if (hasSubsequentVal) {
              argsReprs.push('_');
            }
          }
        }
      }

      // Strip trailing optional skipped arguments for readability
      while (argsReprs.length > 0 && argsReprs[argsReprs.length - 1] === '_') {
        argsReprs.pop();
      }

      dslLines.push(`${compId} = ${compName}(${argsReprs.join(', ')})`);
    }

    return dslLines.join('\n');
  }

  /**
   * Decompiles a single value node back to A2UI Express notation.
   *
   * @param val The JSON-serialized property value structure.
   * @param compIds A set of all component IDs registered in the surface context.
   * @param isRef Whether this value is a component reference.
   * @returns A plain-text representation of the value.
   */
  decompileValue(val: unknown, compIds: Set<string>, isRef = false): string {
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
      return String(val);
    }

    if (typeof val === 'string') {
      // If it matches a component ID reference, keep it as a variable identifier
      if (isRef && compIds.has(val)) {
        return val;
      }
      return decompileString(val);
    }

    if (Array.isArray(val)) {
      const listReprs = val.map(item => this.decompileValue(item, compIds, isRef));
      return `[${listReprs.join(', ')}]`;
    }

    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>;

      if ('path' in obj && typeof obj.path === 'string') {
        if ('componentId' in obj && typeof obj.componentId === 'string') {
          const pathRepr = this.decompileValue({path: obj.path}, compIds, false);
          const compIdRepr = obj.componentId;
          return `_template(${pathRepr}, ${compIdRepr})`;
        }
        const pathStr = obj.path;
        if (pathStr.startsWith('/')) {
          return `$/${pathStr.slice(1)}`;
        }
        return `$${pathStr}`;
      }

      if ('event' in obj && obj.event && typeof obj.event === 'object') {
        const evt = obj.event as Record<string, unknown>;
        const name = typeof evt.name === 'string' ? evt.name : '';
        const ctx = (evt.context ?? {}) as Record<string, unknown>;
        const ctxReprs: string[] = [];
        for (const [k, v] of Object.entries(ctx)) {
          // Python known gap: non-identifier map keys in Event context are written unquoted
          ctxReprs.push(`${k}: ${this.decompileValue(v, compIds, false)}`);
        }
        if (ctxReprs.length > 0) {
          return `Event("${name}", {${ctxReprs.join(', ')}})`;
        }
        return `Event("${name}")`;
      }

      if ('functionCall' in obj && obj.functionCall && typeof obj.functionCall === 'object') {
        const fn = obj.functionCall as Record<string, unknown>;
        const name = typeof fn.call === 'string' ? fn.call : '';
        const args = (fn.args ?? {}) as Record<string, unknown>;

        const fnProps = this.helper.getFunctionProperties(name);
        const argsReprs: string[] = [];
        for (const p of fnProps) {
          if (p in args) {
            argsReprs.push(this.decompileValue(args[p], compIds, false));
          } else {
            argsReprs.push('_');
          }
        }
        while (argsReprs.length > 0 && argsReprs[argsReprs.length - 1] === '_') {
          argsReprs.pop();
        }
        return `${name}(${argsReprs.join(', ')})`;
      }

      if ('call' in obj && typeof obj.call === 'string') {
        const name = obj.call;
        const args = (obj.args ?? {}) as unknown;
        const argsReprs: string[] = [];
        if (this.helper.functions.has(name)) {
          const fnProps = this.helper.getFunctionProperties(name);
          for (const p of fnProps) {
            if (
              args &&
              typeof args === 'object' &&
              !Array.isArray(args) &&
              p in (args as Record<string, unknown>)
            ) {
              argsReprs.push(
                this.decompileValue((args as Record<string, unknown>)[p], compIds, false),
              );
            } else {
              argsReprs.push('_');
            }
          }
        } else {
          if (Array.isArray(args)) {
            for (const v of args) {
              argsReprs.push(this.decompileValue(v, compIds, false));
            }
          } else if (args && typeof args === 'object') {
            for (const v of Object.values(args as Record<string, unknown>)) {
              argsReprs.push(this.decompileValue(v, compIds, false));
            }
          }
        }
        while (argsReprs.length > 0 && argsReprs[argsReprs.length - 1] === '_') {
          argsReprs.pop();
        }
        return `${name}(${argsReprs.join(', ')})`;
      }

      // General dict
      const itemsReprs: string[] = [];
      const identRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      for (const [k, v] of Object.entries(obj)) {
        const itemIsRef = isRef || k === 'child' || k === 'componentId';
        const kRepr = identRegex.test(k) ? k : decompileString(k);
        itemsReprs.push(`${kRepr}: ${this.decompileValue(v, compIds, itemIsRef)}`);
      }
      return `{${itemsReprs.join(', ')}}`;
    }

    return String(val);
  }
}
