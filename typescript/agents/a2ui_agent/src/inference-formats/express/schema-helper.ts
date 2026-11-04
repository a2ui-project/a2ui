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
 * Utility for parsing A2UI component and function catalogs for Express inference format.
 *
 * Resolves component properties, functions, and requirements in strict schema definition
 * order to support positional parameter mapping.
 */

import {A2uiCatalogError} from '../../errors.js';
import {CatalogApi, V09_STANDARD_DEFS, V10_STANDARD_DEFS} from '../../internal/web-core.js';
import {toWireProtocolVersion} from '../../utils/protocol-version.js';

const COMMON_DEF_REGEX = /(?:^|\/)common_types\.json#\/(?:\$defs|definitions)\/(\w+)$/;

/**
 * Recognizes protocol common types referenced via `$ref` into `common_types.json`.
 *
 * Matches both relative paths (`common_types.json#/$defs/<Name>`) and absolute URLs
 * (`https://a2ui.org/specification/.../common_types.json#/$defs/<Name>`), under either
 * `$defs` or the older `definitions`.
 *
 * @param ref The `$ref` string to inspect.
 * @returns The def name if pointing into `common_types.json`, or undefined.
 */
export function commonDefName(ref: unknown): string | undefined {
  if (typeof ref !== 'string') {
    return undefined;
  }
  const match = COMMON_DEF_REGEX.exec(ref);
  return match ? match[1] : undefined;
}

/**
 * Checks whether a property schema is an Action slot.
 *
 * A property is an action slot when its schema references the common `Action` def,
 * directly or through `oneOf`/`anyOf`/`allOf`.
 *
 * @param schema The property JSON schema to inspect.
 * @returns True if the schema references the common `Action` type.
 */
export function isActionSlot(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  const s = schema as Record<string, unknown>;
  if (typeof s.$ref === 'string' && commonDefName(s.$ref) === 'Action') {
    return true;
  }
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const list = s[key];
    if (Array.isArray(list) && list.some(sub => isActionSlot(sub))) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a property's schema expects a list of objects with label/value properties.
 *
 * Ported verbatim from Python's `_schema_expects_option_objects` (compiler.py:124-152).
 * Sanctioned exception: plan §5.2 item 2.
 *
 * @param schema The property JSON schema to inspect.
 * @returns True if schema expects option objects.
 */
export function expectsOptionObjects(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  const s = schema as Record<string, unknown>;
  if ('items' in s) {
    const itemsSchema = s.items;

    const hasLabelValue = (sub: unknown): boolean => {
      if (!sub || typeof sub !== 'object') {
        return false;
      }
      const subObj = sub as Record<string, unknown>;
      if (
        subObj.properties &&
        typeof subObj.properties === 'object' &&
        'label' in (subObj.properties as Record<string, unknown>) &&
        'value' in (subObj.properties as Record<string, unknown>)
      ) {
        return true;
      }
      for (const k of ['allOf', 'oneOf', 'anyOf'] as const) {
        const list = subObj[k];
        if (Array.isArray(list)) {
          if (list.some(hasLabelValue)) {
            return true;
          }
        }
      }
      return false;
    };

    return hasLabelValue(itemsSchema);
  }
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const list = s[key];
    if (Array.isArray(list)) {
      if (list.some(sub => expectsOptionObjects(sub))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Dynamic schema crawler for A2UI catalogs used by Express format.
 */

/**
 * Returns the `$ref` of a schema when it points inside the same document (`#/...`).
 *
 * @param sub The schema to inspect.
 * @returns The local reference, or undefined.
 */
function localRef(sub: unknown): string | undefined {
  if (!sub || typeof sub !== 'object') {
    return undefined;
  }
  const ref = (sub as Record<string, unknown>).$ref;
  return typeof ref === 'string' && ref.startsWith('#/') ? ref : undefined;
}

/**
 * Returns the common type definitions (`common_types.json` `$defs`) for a protocol
 * version, as web_core generates them from the specification.
 */
function standardDefsFor(protocolVersion: string): Record<string, unknown> {
  switch (toWireProtocolVersion(protocolVersion)) {
    case 'v0.9':
    case 'v0.9.1':
      return V09_STANDARD_DEFS;
    case '1.0':
      return V10_STANDARD_DEFS;
    default:
      throw new A2uiCatalogError(`No common types for protocol version '${protocolVersion}'.`);
  }
}

/**
 * The keys that mark a data binding (`path`) and a function call (`call`) on the wire.
 * v1.0 prefixes both with `@`; v0.9 and v0.9.1 use the plain names.
 */
export interface ReservedKeys {
  readonly path: string;
  readonly call: string;
}

/**
 * Returns the wire keys for data bindings and function calls in a protocol version.
 */
function reservedKeysFor(protocolVersion: string): ReservedKeys {
  switch (toWireProtocolVersion(protocolVersion)) {
    case 'v0.9':
    case 'v0.9.1':
      return {path: 'path', call: 'call'};
    default:
      return {path: '@path', call: '@call'};
  }
}

export class CatalogSchemaHelper {
  readonly catalog: Record<string, unknown>;
  readonly commonTypes: Record<string, unknown>;
  readonly commonTypesLoaded: boolean;
  /** The wire keys for data bindings and function calls in this catalog's version. */
  readonly keys: ReservedKeys;
  readonly components: ReadonlyMap<string, Record<string, unknown>>;
  readonly functions: ReadonlyMap<string, Record<string, unknown>>;

  private readonly componentProperties = new Map<string, string[]>();
  private readonly componentRequired = new Map<string, string[]>();
  private readonly checkRuleProperties = new Map<string, string>();
  private readonly inheritedCheckRulePropertyNames = new Map<string, string>();
  private readonly inheritedCheckRuleSchemas = new Map<string, Record<string, unknown>>();
  private readonly componentPropertyEnums = new Map<string, string[]>();
  private readonly functionProperties = new Map<string, string[]>();
  private readonly functionRequired = new Map<string, string[]>();

  constructor(catalog: CatalogApi, protocolVersion: string) {
    this.catalog = catalog.toJson();
    try {
      this.commonTypes = {$defs: standardDefsFor(protocolVersion)};
      this.commonTypesLoaded = true;
    } catch {
      this.commonTypes = {$defs: {}};
      this.commonTypesLoaded = false;
    }
    this.keys = reservedKeysFor(protocolVersion);

    const rawComponents = (this.catalog.components ?? {}) as Record<string, unknown>;
    const componentsMap = new Map<string, Record<string, unknown>>();
    for (const [name, schema] of Object.entries(rawComponents)) {
      if (catalog.components.has(name) && schema && typeof schema === 'object') {
        componentsMap.set(name, schema as Record<string, unknown>);
      }
    }
    this.components = componentsMap;

    const rawFunctions = (this.catalog.functions ?? {}) as Record<string, unknown>;
    const functionsMap = new Map<string, Record<string, unknown>>();
    for (const [name, schema] of Object.entries(rawFunctions)) {
      if (catalog.functions.has(name) && schema && typeof schema === 'object') {
        functionsMap.set(name, schema as Record<string, unknown>);
      }
    }
    this.functions = functionsMap;

    this.loadMappings();
  }

  private lookupCommonDef(defName: string): unknown {
    const defs =
      (this.commonTypes.$defs as Record<string, unknown> | undefined) ??
      (this.commonTypes.definitions as Record<string, unknown> | undefined);
    return defs ? defs[defName] : undefined;
  }

  private resolveJsonPointer(root: Record<string, unknown>, pointer: string): unknown {
    if (!pointer.startsWith('#/')) {
      return undefined;
    }
    const parts = pointer.slice(2).split('/');
    let current: unknown = root;
    for (const part of parts) {
      if (!current || typeof current !== 'object') {
        return undefined;
      }
      const unescaped = part.replace(/~1/g, '/').replace(/~0/g, '~');
      current = (current as Record<string, unknown>)[unescaped];
    }
    return current;
  }

  /**
   * Resolves a schema that is a local `#/...` reference against the catalog.
   *
   * @param sub The schema that may be a reference.
   * @returns The referenced schema, or undefined if `sub` is not a local reference.
   */
  private resolveLocalRef(sub: unknown): unknown {
    const ref = localRef(sub);
    return ref ? this.resolveJsonPointer(this.catalog, ref) : undefined;
  }

  /**
   * Lists the sub-schemas of a component in the order its properties are read.
   *
   * The component's own schema comes first, so its own definition of a property
   * overrides an inherited one. Then come the allOf entries that declare
   * `component` (the specific schemas), then the other allOf entries (the
   * common mixins). Each allOf entry is expanded depth first: a local `#/...`
   * reference is resolved against the catalog, and the entries of its own
   * allOf follow it. References into `common_types.json` are kept as is.
   *
   * @param schema The component schema.
   * @returns The ordered sub-schemas.
   */
  private orderedComponentSubSchemas(schema: Record<string, unknown>): Record<string, unknown>[] {
    const specific: Record<string, unknown>[] = [];
    const inherited: Record<string, unknown>[] = [];
    if (Array.isArray(schema.allOf)) {
      for (let sub of schema.allOf) {
        if (localRef(sub)) {
          const resolved = this.resolveLocalRef(sub);
          if (resolved && typeof resolved === 'object') {
            sub = resolved;
          }
        }
        if (!sub || typeof sub !== 'object') {
          continue;
        }
        const subObj = sub as Record<string, unknown>;
        const props = subObj.properties;
        if (
          props &&
          typeof props === 'object' &&
          'component' in (props as Record<string, unknown>)
        ) {
          specific.push(subObj);
        } else {
          inherited.push(subObj);
        }
      }
    }

    const expanded: Record<string, unknown>[] = [schema];
    const visited = new Set<Record<string, unknown>>([schema]);
    const expand = (node: Record<string, unknown>) => {
      let target = node;
      if (localRef(target)) {
        const resolved = this.resolveLocalRef(target);
        if (resolved && typeof resolved === 'object') {
          target = resolved as Record<string, unknown>;
        }
      }
      if (visited.has(target)) {
        return;
      }
      visited.add(target);
      expanded.push(target);
      if (Array.isArray(target.allOf)) {
        for (const child of target.allOf) {
          if (child && typeof child === 'object') {
            expand(child as Record<string, unknown>);
          }
        }
      }
    };
    for (const s of [...specific, ...inherited]) {
      expand(s);
    }
    return expanded;
  }

  private getCheckRuleDefName(ref: unknown): string | undefined {
    if (typeof ref !== 'string') {
      return undefined;
    }
    const commonName = commonDefName(ref);
    if (commonName) {
      return commonName;
    }
    if (ref.startsWith('#/$defs/')) {
      return ref.slice(8);
    }
    if (ref.startsWith('#/definitions/')) {
      return ref.slice(14);
    }
    return undefined;
  }

  private isCheckRuleArraySchema(propSchema: unknown): boolean {
    if (!propSchema || typeof propSchema !== 'object') {
      return false;
    }
    const s = propSchema as Record<string, unknown>;
    if (s.type !== 'array') {
      return false;
    }
    const items = s.items;
    if (!items || typeof items !== 'object') {
      return false;
    }
    const itemsRef = (items as Record<string, unknown>).$ref;
    return commonDefName(itemsRef) === 'CheckRule';
  }

  private loadMappings(): void {
    const findEnum = (s: unknown): string[] | undefined => {
      if (s && typeof s === 'object') {
        let obj = s as Record<string, unknown>;
        const visitedPointers = new Set<string>();
        let ref = localRef(obj);
        while (ref) {
          if (visitedPointers.has(ref)) {
            break;
          }
          visitedPointers.add(ref);
          const resolved = this.resolveJsonPointer(this.catalog, ref);
          if (resolved && typeof resolved === 'object') {
            obj = resolved as Record<string, unknown>;
            ref = localRef(obj);
          } else {
            break;
          }
        }
        if (Array.isArray(obj.enum)) {
          return obj.enum as string[];
        }
        for (const k of ['oneOf', 'anyOf', 'allOf'] as const) {
          const list = obj[k];
          if (Array.isArray(list)) {
            for (const subS of list) {
              const res = findEnum(subS);
              if (res) {
                return res;
              }
            }
          }
        }
      }
      return undefined;
    };

    for (const [name, schema] of this.components.entries()) {
      const props: Record<string, unknown> = {};
      const reqs: string[] = [];

      const subSchemas = this.orderedComponentSubSchemas(schema);

      // Checkability (plan §5.2 item 4):
      // (a) own property whose schema is {type: 'array', items: {$ref: <common_types CheckRule>}}
      let ownCheckProp: string | undefined;
      for (const subObj of subSchemas) {
        if (subObj.$ref) {
          continue;
        }
        if (subObj.properties && typeof subObj.properties === 'object') {
          for (const [pk, pv] of Object.entries(subObj.properties as Record<string, unknown>)) {
            if (this.isCheckRuleArraySchema(pv)) {
              ownCheckProp = pk;
              break;
            }
          }
        }
        if (ownCheckProp) {
          break;
        }
      }

      // (b) inherited property from allOf $ref into common_types
      let inheritedCheckProp: string | undefined;
      let inheritedSchema: Record<string, unknown> | undefined;
      if (!ownCheckProp) {
        for (const subObj of subSchemas) {
          if (typeof subObj.$ref !== 'string') {
            continue;
          }
          const defName = commonDefName(subObj.$ref);
          if (defName) {
            const commonDef = this.lookupCommonDef(defName);
            if (commonDef && typeof commonDef === 'object') {
              const commonObj = commonDef as Record<string, unknown>;
              if (commonObj.properties && typeof commonObj.properties === 'object') {
                for (const [pk, pv] of Object.entries(
                  commonObj.properties as Record<string, unknown>,
                )) {
                  if (pv && typeof pv === 'object') {
                    const propObj = pv as Record<string, unknown>;
                    if (
                      propObj.type === 'array' &&
                      propObj.items &&
                      typeof propObj.items === 'object'
                    ) {
                      const itemsRef = (propObj.items as Record<string, unknown>).$ref;
                      if (this.getCheckRuleDefName(itemsRef) === 'CheckRule') {
                        inheritedCheckProp = pk;
                        inheritedSchema = propObj;
                        break;
                      }
                    }
                  }
                }
              }
            }
          }
          if (inheritedCheckProp) {
            break;
          }
        }
      }

      if (ownCheckProp) {
        this.checkRuleProperties.set(name, ownCheckProp);
      } else if (inheritedCheckProp) {
        this.checkRuleProperties.set(name, inheritedCheckProp);
        this.inheritedCheckRulePropertyNames.set(name, inheritedCheckProp);
        if (inheritedSchema) {
          this.inheritedCheckRuleSchemas.set(name, inheritedSchema);
        }
      }

      for (const subObj of subSchemas) {
        if (subObj.properties && typeof subObj.properties === 'object') {
          // `subSchemas` lists the component's own schema first, then its
          // specific allOf entries, then its mixins, each with its nested
          // allOf. The first definition of a property wins, as in
          // `getPropertySchema`, so the component's own definition overrides
          // an inherited one, and a property keeps the position where it is
          // first declared.
          for (const [pk, pv] of Object.entries(subObj.properties as Record<string, unknown>)) {
            if (Object.hasOwn(props, pk)) {
              continue;
            }
            props[pk] = pv;
            const enumVal = findEnum(pv);
            if (enumVal) {
              this.componentPropertyEnums.set(`${name}.${pk}`, enumVal);
            }
          }
        }
        if (Array.isArray(subObj.required)) {
          for (const r of subObj.required as string[]) {
            if (!reqs.includes(r)) {
              reqs.push(r);
            }
          }
        }
      }

      // Filter out structural properties 'component' and 'id'
      const orderedKeys: string[] = [];
      for (const k of Object.keys(props)) {
        if (k !== 'component' && k !== 'id') {
          orderedKeys.push(k);
        }
      }

      // If checkable via inheritance (b), append check-rule property at the end.
      // Own check-rule properties (a) stay at their declared position in orderedKeys.
      if (inheritedCheckProp && !orderedKeys.includes(inheritedCheckProp)) {
        orderedKeys.push(inheritedCheckProp);
      }

      this.componentProperties.set(name, orderedKeys);
      this.componentRequired.set(name, reqs);
    }

    for (const [name, schema] of this.functions.entries()) {
      const subSchemas: unknown[] = [schema];
      const localRefs: unknown[] = [];
      if (Array.isArray(schema.allOf)) {
        for (const sub of schema.allOf) {
          if (localRef(sub)) {
            localRefs.push(sub);
          } else {
            subSchemas.push(sub);
          }
        }
      }
      subSchemas.push(...localRefs);

      const props: Record<string, unknown> = {};
      const reqs: string[] = [];
      for (let sub of subSchemas) {
        if (!sub || typeof sub !== 'object') {
          continue;
        }
        if (localRef(sub)) {
          const resolved = this.resolveLocalRef(sub);
          if (resolved && typeof resolved === 'object') {
            sub = resolved;
          }
        }
        const subObj = sub as Record<string, unknown>;
        if (subObj.properties && typeof subObj.properties === 'object') {
          const argsObj = (subObj.properties as Record<string, unknown>).args;
          if (argsObj && typeof argsObj === 'object') {
            const argsProps = (argsObj as Record<string, unknown>).properties;
            if (argsProps && typeof argsProps === 'object') {
              Object.assign(props, argsProps);
            }
            const argsReq = (argsObj as Record<string, unknown>).required;
            if (Array.isArray(argsReq)) {
              reqs.push(...(argsReq as string[]));
            }
          }
        }
      }
      this.functionProperties.set(name, Object.keys(props));
      this.functionRequired.set(name, reqs);
    }
  }

  /**
   * Returns the ordered properties of the specified component.
   */
  getComponentProperties(name: string): string[] {
    return this.componentProperties.get(name) ?? [];
  }

  /**
   * Returns the list of required properties for the specified component.
   */
  getComponentRequired(name: string): string[] {
    return this.componentRequired.get(name) ?? [];
  }

  /**
   * Returns whether the specified component supports client-side checks.
   */
  isCheckable(name: string): boolean {
    return this.getCheckRuleProperty(name) !== undefined;
  }

  /**
   * Returns the check-rule property name for the specified component, or undefined.
   */
  getCheckRuleProperty(name: string): string | undefined {
    return this.checkRuleProperties.get(name);
  }

  /**
   * Returns the ordered properties of the specified function's arguments.
   */
  getFunctionProperties(name: string): string[] {
    return this.functionProperties.get(name) ?? [];
  }

  /**
   * Returns the list of required argument properties for the function.
   */
  getFunctionRequired(name: string): string[] {
    return this.functionRequired.get(name) ?? [];
  }

  /**
   * Retrieves the JSON schema for a specific function argument property.
   */
  getFunctionPropertySchema(fnName: string, propName: string): Record<string, unknown> | undefined {
    const fnSchema = this.functions.get(fnName);
    if (!fnSchema) {
      return undefined;
    }

    const subSchemas: unknown[] = [fnSchema];
    const localRefs: unknown[] = [];
    if (Array.isArray(fnSchema.allOf)) {
      for (const sub of fnSchema.allOf) {
        if (localRef(sub)) {
          localRefs.push(sub);
        } else {
          subSchemas.push(sub);
        }
      }
    }
    subSchemas.push(...localRefs);

    for (let sub of subSchemas) {
      if (sub && typeof sub === 'object') {
        if (localRef(sub)) {
          const resolved = this.resolveLocalRef(sub);
          if (resolved && typeof resolved === 'object') {
            sub = resolved;
          }
        }
        const subObj = sub as Record<string, unknown>;
        if (subObj.properties && typeof subObj.properties === 'object') {
          const argsObj = (subObj.properties as Record<string, unknown>).args;
          if (argsObj && typeof argsObj === 'object') {
            const argsProps = (argsObj as Record<string, unknown>).properties;
            if (argsProps && typeof argsProps === 'object' && propName in argsProps) {
              return (argsProps as Record<string, unknown>)[propName] as Record<string, unknown>;
            }
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Returns the list of allowed enum values for a component property, or undefined.
   */
  getPropertyEnum(componentName: string, propertyName: string): string[] | undefined {
    return this.componentPropertyEnums.get(`${componentName}.${propertyName}`);
  }

  /**
   * Retrieves the description of the component from its catalog schema.
   */
  getComponentDescription(name: string): string | undefined {
    const schema = this.components.get(name);
    if (!schema) {
      return undefined;
    }
    if (typeof schema.description === 'string') {
      return schema.description;
    }
    if (Array.isArray(schema.allOf)) {
      for (let sub of schema.allOf) {
        if (localRef(sub)) {
          const resolved = this.resolveLocalRef(sub);
          if (resolved && typeof resolved === 'object') {
            sub = resolved;
          }
        }
        if (
          sub &&
          typeof sub === 'object' &&
          typeof (sub as Record<string, unknown>).description === 'string'
        ) {
          return (sub as Record<string, unknown>).description as string;
        }
      }
    }
    return undefined;
  }

  /**
   * Retrieves the description of the function from its catalog schema.
   */
  getFunctionDescription(name: string): string | undefined {
    const schema = this.functions.get(name);
    if (!schema) {
      return undefined;
    }
    return typeof schema.description === 'string' ? schema.description : undefined;
  }

  /**
   * Crawls all sub-schemas of a component to retrieve a property's schema definition.
   *
   * The sub-schemas are searched in the order `orderedComponentSubSchemas`
   * lists them, the component's own schema first, and the first definition
   * found is returned, so the component's own definition of a property
   * overrides an inherited one, including one from a nested allOf.
   */
  getPropertySchema(
    componentName: string,
    propertyName: string,
  ): Record<string, unknown> | undefined {
    const schema = this.components.get(componentName);
    if (!schema) {
      return undefined;
    }

    for (const subObj of this.orderedComponentSubSchemas(schema)) {
      if (subObj.properties && typeof subObj.properties === 'object') {
        const props = subObj.properties as Record<string, unknown>;
        if (propertyName in props) {
          const propVal = props[propertyName];
          if (!propVal || typeof propVal !== 'object') {
            return undefined;
          }
          const current = propVal as Record<string, unknown>;
          const visitedPointers = new Set<string>();
          let ref = localRef(current);
          let merged: Record<string, unknown> = current;
          while (ref) {
            if (visitedPointers.has(ref)) {
              break;
            }
            visitedPointers.add(ref);
            const resolved = this.resolveJsonPointer(this.catalog, ref);
            if (resolved && typeof resolved === 'object') {
              merged = {
                ...(resolved as Record<string, unknown>),
                ...merged,
              };
              ref = localRef(resolved);
            } else {
              break;
            }
          }
          return merged;
        }
      }
    }
    return undefined;
  }

  /**
   * Retrieves the check-rule property's schema for a component (own or inherited).
   */
  getCheckRulePropertySchema(componentName: string): Record<string, unknown> | undefined {
    const propName = this.getCheckRuleProperty(componentName);
    if (!propName) {
      return undefined;
    }
    const own = this.getPropertySchema(componentName, propName);
    if (own) {
      return own;
    }
    return this.inheritedCheckRuleSchemas.get(componentName);
  }

  /**
   * Checks whether a schema admits a data binding path.
   *
   * True when the schema is, or combines via `$ref`/oneOf/anyOf/allOf, an object schema
   * whose `properties` contains `path` (v0.9) or `@path` (v1.0).
   *
   * Follows `$ref`s in `commonTypes` or the catalog document.
   * Never descends into `items` or property values.
   */
  admitsPath(schema: unknown): boolean {
    const visited = new Set<unknown>();

    const check = (s: unknown, inCommonTypes: boolean): boolean => {
      if (!s || typeof s !== 'object') {
        return false;
      }
      if (visited.has(s)) {
        return false;
      }
      visited.add(s);

      const obj = s as Record<string, unknown>;

      if (obj.properties && typeof obj.properties === 'object') {
        const props = obj.properties as Record<string, unknown>;
        if ('path' in props || '@path' in props) {
          return true;
        }
      }

      if (typeof obj.$ref === 'string') {
        const ref = obj.$ref;
        const defName = commonDefName(ref);
        if (defName) {
          const resolved = this.lookupCommonDef(defName);
          if (resolved && check(resolved, true)) {
            return true;
          }
        } else if (
          inCommonTypes &&
          (ref.startsWith('#/$defs/') || ref.startsWith('#/definitions/'))
        ) {
          const name = ref.startsWith('#/$defs/') ? ref.slice(8) : ref.slice(14);
          const resolved = this.lookupCommonDef(name);
          if (resolved && check(resolved, true)) {
            return true;
          }
        } else if (ref.startsWith('#/')) {
          const resolved = this.resolveJsonPointer(this.catalog, ref);
          if (resolved && check(resolved, false)) {
            return true;
          }
        }
      }

      for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
        const list = obj[key];
        if (Array.isArray(list)) {
          for (const sub of list) {
            if (check(sub, inCommonTypes)) {
              return true;
            }
          }
        }
      }

      return false;
    };

    return check(schema, false);
  }

  /**
   * Checks whether a property schema accepts a numeric value by resolving `$ref`s
   * in `commonTypes` or the catalog document.
   */
  acceptsNumber(schema: unknown): boolean {
    const visited = new Set<unknown>();

    const check = (s: unknown, inCommonTypes: boolean): boolean => {
      if (!s || typeof s !== 'object') {
        return false;
      }
      if (visited.has(s)) {
        return false;
      }
      visited.add(s);

      const obj = s as Record<string, unknown>;

      const type = obj.type;
      if (type === 'number' || type === 'integer') {
        return true;
      }
      if (Array.isArray(type) && (type.includes('number') || type.includes('integer'))) {
        return true;
      }

      if (typeof obj.const === 'number') {
        return true;
      }

      if (Array.isArray(obj.enum) && obj.enum.some(v => typeof v === 'number')) {
        return true;
      }

      if (typeof obj.$ref === 'string') {
        const ref = obj.$ref;
        const defName = commonDefName(ref);
        if (defName) {
          const resolved = this.lookupCommonDef(defName);
          if (!resolved) {
            return true;
          }
          if (check(resolved, true)) {
            return true;
          }
        } else if (
          inCommonTypes &&
          (ref.startsWith('#/$defs/') || ref.startsWith('#/definitions/'))
        ) {
          const name = ref.startsWith('#/$defs/') ? ref.slice(8) : ref.slice(14);
          const resolved = this.lookupCommonDef(name);
          if (!resolved) {
            return true;
          }
          if (check(resolved, true)) {
            return true;
          }
        } else if (ref.startsWith('#/')) {
          const resolved = this.resolveJsonPointer(this.catalog, ref);
          if (!resolved) {
            return true;
          }
          if (check(resolved, false)) {
            return true;
          }
        } else if (ref.startsWith('catalog.json#/')) {
          const resolved = this.resolveJsonPointer(this.catalog, ref.slice(12));
          if (!resolved) {
            return true;
          }
          if (check(resolved, false)) {
            return true;
          }
        } else {
          return true;
        }
      }

      for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
        const list = obj[key];
        if (Array.isArray(list)) {
          for (const sub of list) {
            if (check(sub, inCommonTypes)) {
              return true;
            }
          }
        }
      }

      const typeKeys = [
        'type',
        'const',
        'enum',
        '$ref',
        'allOf',
        'oneOf',
        'anyOf',
        'properties',
        'items',
        'prefixItems',
        'not',
      ];
      if (!typeKeys.some(k => k in obj)) {
        return true;
      }

      return false;
    };

    return check(schema, false);
  }

  /**
   * Resolves the schema of an array's items.
   *
   * Traverses $ref (both in common types and catalog document), allOf, oneOf, and anyOf
   * to find the declared schema at that position.
   *
   * @param schema The array's JSON schema.
   * @returns The resolved item schema, or undefined if not declared.
   */
  resolveItemSchema(schema: unknown): Record<string, unknown> | undefined {
    return this.resolveAt(schema, undefined);
  }

  /**
   * Resolves the schema of an object's property, falling back to `additionalProperties`
   * when the property is not declared.
   *
   * Traverses $ref (both in common types and catalog document), allOf, oneOf, and anyOf
   * to find the declared schema at that position. A property named `items` is looked up
   * as a property, not as the array items.
   *
   * @param schema The object's JSON schema.
   * @param name The property name.
   * @returns The resolved property schema, or undefined if not declared.
   */
  resolvePropertySchema(schema: unknown, name: string): Record<string, unknown> | undefined {
    return this.resolveAt(schema, name);
  }

  /**
   * @param property The property to resolve, or undefined for the array items.
   */
  private resolveAt(
    schema: unknown,
    property: string | undefined,
  ): Record<string, unknown> | undefined {
    const visited = new Set<unknown>();

    const resolve = (s: unknown, inCommonTypes: boolean): Record<string, unknown> | undefined => {
      if (!s || typeof s !== 'object') {
        return undefined;
      }
      if (visited.has(s)) {
        return undefined;
      }
      visited.add(s);

      const obj = s as Record<string, unknown>;

      if (property === undefined) {
        if (obj.items && typeof obj.items === 'object') {
          return obj.items as Record<string, unknown>;
        }
      } else {
        if (obj.properties && typeof obj.properties === 'object') {
          const props = obj.properties as Record<string, unknown>;
          const declared = Object.hasOwn(props, property) ? props[property] : undefined;
          if (declared && typeof declared === 'object') {
            return declared as Record<string, unknown>;
          }
        }
        if (obj.additionalProperties && typeof obj.additionalProperties === 'object') {
          return obj.additionalProperties as Record<string, unknown>;
        }
      }

      if (typeof obj.$ref === 'string') {
        const ref = obj.$ref;
        const defName = commonDefName(ref);
        if (defName) {
          const target = this.lookupCommonDef(defName);
          const found = resolve(target, true);
          if (found) {
            return found;
          }
        } else if (
          inCommonTypes &&
          (ref.startsWith('#/$defs/') || ref.startsWith('#/definitions/'))
        ) {
          const name = ref.startsWith('#/$defs/') ? ref.slice(8) : ref.slice(14);
          const target = this.lookupCommonDef(name);
          const found = resolve(target, true);
          if (found) {
            return found;
          }
        } else if (ref.startsWith('#/')) {
          const target = this.resolveJsonPointer(this.catalog, ref);
          const found = resolve(target, false);
          if (found) {
            return found;
          }
        }
      }

      for (const k of ['allOf', 'oneOf', 'anyOf'] as const) {
        const list = obj[k];
        if (Array.isArray(list)) {
          for (const sub of list) {
            const found = resolve(sub, inCommonTypes);
            if (found) {
              return found;
            }
          }
        }
      }

      return undefined;
    };

    return resolve(schema, false);
  }
}
