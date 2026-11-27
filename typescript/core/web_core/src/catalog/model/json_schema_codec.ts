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

import {isAtLeastVersion, toCanonicalVersion} from '../../common/semver.js';
import {isValidUax31Identifier} from '../../common/uax31.js';
import {A2uiCatalogError} from '../../errors.js';
import {
  CATALOG_DOCUMENT_FORMAT_VERSION,
  COMPONENT_ONLY_TYPE_KINDS,
  FORBIDDEN_COMPONENT_PARAM_NAMES,
  FUNCTION_RETURN_SHORTHANDS,
  type AllowedCallers,
  type CatalogMetadata,
  type CatalogModel,
  type ComponentDefinition,
  type ComponentParameterDefinition,
  type DataParameterDefinition,
  type DataTypeDefinition,
  type EnumPrimitiveValue,
  type EnumValueType,
  type FunctionDefinition,
  type FunctionReturnDefinition,
  type FunctionReturnShorthand,
  type ParameterDefinition,
  type SurfacePropertiesDefinition,
  type TypeDefinition,
  type TypeMeta,
} from './catalog_model.js';
import {isPlainRecord} from './format_validators.js';

const DEFAULT_JSON_SCHEMA_URI = 'https://json-schema.org/draft/2020-12/schema';
const DEFAULT_COMMON_TYPES_URI = 'common_types.json';
const COMMON_REF_RE =
  /(?:^|\/)common_types\.json#\/(?:\$defs|definitions)\/([A-Za-z_][A-Za-z0-9_]*)$/;
const LOCAL_DEF_REF_RE = /^#\/(?:\$defs|definitions)\/([A-Za-z_][A-Za-z0-9_]*)$/;

const SKIPPED_LOCAL_DEFS = new Set([
  'anyComponent',
  'anyFunction',
  'theme',
  'ComponentCommon',
  'Checkable',
]);

function commonRefName(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined;
  const match = COMMON_REF_RE.exec(ref);
  return match ? match[1] : undefined;
}

function localDefName(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined;
  const match = LOCAL_DEF_REF_RE.exec(ref);
  return match ? match[1] : undefined;
}

function extractMeta(schema: Record<string, unknown>): TypeMeta {
  const meta: {description?: string; deprecated?: boolean; deprecatedReason?: string} = {};
  if (typeof schema['description'] === 'string') meta.description = schema['description'];
  if (typeof schema['deprecated'] === 'boolean') meta.deprecated = schema['deprecated'];
  if (typeof schema['deprecatedReason'] === 'string') {
    meta.deprecatedReason = schema['deprecatedReason'];
  }
  return meta;
}

function inferEnumValueType(values: readonly EnumPrimitiveValue[]): EnumValueType | undefined {
  if (values.length === 0) return undefined;
  const first = typeof values[0];
  if (
    (first === 'string' || first === 'number' || first === 'boolean') &&
    values.every(v => typeof v === first)
  ) {
    return first;
  }
  return undefined;
}

function containsComponentOnlyType(typeDef: TypeDefinition): boolean {
  if (COMPONENT_ONLY_TYPE_KINDS.has(typeDef.type)) return true;
  if (typeDef.type === 'array' && typeDef.items) {
    return containsComponentOnlyType(typeDef.items);
  }
  if (typeDef.type === 'object') {
    if (typeDef.properties?.some(containsComponentOnlyType)) return true;
    if (
      typeDef.additionalProperties &&
      typeof typeDef.additionalProperties === 'object' &&
      containsComponentOnlyType(typeDef.additionalProperties)
    ) {
      return true;
    }
  }
  if (typeDef.type === 'union') {
    return typeDef.variants.some(containsComponentOnlyType);
  }
  return false;
}

interface ConversionContext {
  readonly rawDefs: Readonly<Record<string, unknown>>;
  readonly localTypes: Map<string, DataTypeDefinition>;
  readonly convertingDefs: Set<string>;
}

function convertCommonRef(defName: string, meta: TypeMeta): TypeDefinition | undefined {
  switch (defName) {
    case 'DynamicString':
      return {type: 'string', dynamic: true, ...meta};
    case 'DynamicNumber':
      return {type: 'number', dynamic: true, ...meta};
    case 'DynamicBoolean':
      return {type: 'boolean', dynamic: true, ...meta};
    case 'DynamicStringList':
      return {type: 'array', items: {type: 'string'}, dynamic: true, ...meta};
    case 'DynamicValue':
      return {type: 'any', dynamic: true, nullable: false, ...meta};
    case 'DataBinding':
      return {type: 'dataBinding', ...meta};
    case 'FunctionCall':
      return {type: 'functionCall', ...meta};
    case 'Child':
    case 'ComponentId':
      return {type: 'child', ...meta};
    case 'ChildList':
    case 'TemplateChildList':
      return {type: 'childList', ...meta};
    case 'Action':
      return {type: 'action', ...meta};
    case 'CheckRule':
      return {type: 'checkRule', ...meta};
    case 'AccessibilityAttributes':
      return {type: 'accessibility', ...meta};
    default:
      return undefined;
  }
}

function extractFormatList(rawList: unknown): string[] | undefined {
  if (!Array.isArray(rawList) || rawList.length === 0) return undefined;
  const formats: string[] = [];
  for (const item of rawList) {
    if (!isPlainRecord(item) || typeof item['format'] !== 'string') {
      return undefined;
    }
    for (const k of Object.keys(item)) {
      if (k !== 'format' && !(k === 'type' && item['type'] === 'string')) {
        return undefined;
      }
    }
    formats.push(item['format']);
  }
  return formats;
}

function extractConditionalFormats(branch: Record<string, unknown>): string[] | undefined {
  const ifObj = branch['if'];
  const thenObj = branch['then'];
  if (!isPlainRecord(ifObj) || ifObj['type'] !== 'string' || !isPlainRecord(thenObj)) {
    return undefined;
  }
  if (typeof thenObj['format'] === 'string') {
    return [thenObj['format']];
  }
  return extractFormatList(thenObj['oneOf'] ?? thenObj['anyOf']);
}

function isReturnTypeConstraintBranch(branch: Record<string, unknown>): boolean {
  const props = branch['properties'];
  if (!isPlainRecord(props)) return false;
  const ret = props['returnType'];
  return isPlainRecord(ret) && typeof ret['const'] === 'string';
}

function extractSingleAtLeastOneOfGroup(anyOf: unknown): string[] | undefined {
  if (!Array.isArray(anyOf) || anyOf.length === 0) return undefined;
  const group: string[] = [];
  for (const branch of anyOf) {
    if (!isPlainRecord(branch)) return undefined;
    const keys = Object.keys(branch);
    if (keys.length !== 1 || keys[0] !== 'required') return undefined;
    const req = branch['required'];
    if (!Array.isArray(req) || req.length !== 1 || typeof req[0] !== 'string') return undefined;
    group.push(req[0]);
  }
  return group.length > 0 ? group : undefined;
}

function extractAtLeastOneOf(schema: Record<string, unknown>): string[][] | undefined {
  const groups: string[][] = [];
  const direct = extractSingleAtLeastOneOfGroup(schema['anyOf']);
  if (direct) groups.push(direct);
  if (Array.isArray(schema['allOf'])) {
    for (const branch of schema['allOf']) {
      if (!isPlainRecord(branch)) continue;
      const keys = Object.keys(branch);
      if (keys.length === 1 && keys[0] === 'anyOf') {
        const g = extractSingleAtLeastOneOfGroup(branch['anyOf']);
        if (g) groups.push(g);
      }
    }
  }
  return groups.length > 0 ? groups : undefined;
}

function isDataBindingOrFunctionCall(typeDef: TypeDefinition): boolean {
  return typeDef.type === 'dataBinding' || typeDef.type === 'functionCall';
}

function collapseDynamicUnion(
  variants: TypeDefinition[],
  meta: TypeMeta,
): TypeDefinition | undefined {
  const nonBinding = variants.filter(v => !isDataBindingOrFunctionCall(v));
  const hasBinding = variants.some(v => v.type === 'dataBinding');
  const hasCall = variants.some(v => v.type === 'functionCall');
  if (nonBinding.length === 1 && hasBinding && hasCall) {
    const base = nonBinding[0];
    if (
      base.type === 'string' ||
      base.type === 'number' ||
      base.type === 'integer' ||
      base.type === 'boolean' ||
      base.type === 'enum' ||
      base.type === 'array' ||
      base.type === 'object'
    ) {
      return {...base, dynamic: true, ...meta} as TypeDefinition;
    }
  }
  return undefined;
}

function hasUntranslatableKeywords(schema: Record<string, unknown>): boolean {
  return (
    Object.hasOwn(schema, 'patternProperties') ||
    Object.hasOwn(schema, 'not') ||
    Object.hasOwn(schema, 'dependentRequired') ||
    Object.hasOwn(schema, 'dependentSchemas') ||
    Object.hasOwn(schema, 'propertyNames')
  );
}

function convertJsonSchemaNode(
  raw: unknown,
  allowComponentTypes: boolean,
  ctx: ConversionContext,
): TypeDefinition {
  if (!isPlainRecord(raw)) {
    return {type: 'any', dynamic: true, nullable: true};
  }
  const meta = extractMeta(raw);

  // Check common_types.json $ref
  const cRef = commonRefName(raw['$ref']);
  if (cRef) {
    const mapped = convertCommonRef(cRef, meta);
    if (mapped) return mapped;
  }

  // Check local #/$defs/<name> $ref
  const lRef = localDefName(raw['$ref']);
  if (lRef && Object.hasOwn(ctx.rawDefs, lRef)) {
    if (!SKIPPED_LOCAL_DEFS.has(lRef) && isValidUax31Identifier(lRef)) {
      const hasDefault = Object.hasOwn(raw, 'default') && raw['default'] !== undefined;
      const refNode: TypeDefinition = {
        type: 'ref',
        ref: lRef,
        ...(hasDefault ? {default: raw['default']} : {}),
        ...meta,
      };
      // Recursive self-reference while converting `lRef`: emit a ref node directly.
      if (ctx.convertingDefs.has(lRef)) {
        return refNode;
      }
      if (!ctx.localTypes.has(lRef)) {
        ctx.convertingDefs.add(lRef);
        const converted = convertJsonSchemaNode(ctx.rawDefs[lRef], true, ctx);
        ctx.convertingDefs.delete(lRef);
        if (!containsComponentOnlyType(converted) && converted.type !== 'rawJsonSchema') {
          ctx.localTypes.set(lRef, converted as DataTypeDefinition);
        }
      }
      if (ctx.localTypes.has(lRef)) {
        return refNode;
      }
    }
    if (!ctx.convertingDefs.has(lRef)) {
      ctx.convertingDefs.add(lRef);
      const inline = convertJsonSchemaNode(ctx.rawDefs[lRef], allowComponentTypes, ctx);
      ctx.convertingDefs.delete(lRef);
      return {...inline, ...meta};
    }
  }

  // Handle allOf (e.g. DateTimeInput DynamicString + if/then format, v0.9 FunctionCall + returnType)
  if (Array.isArray(raw['allOf'])) {
    const branches = raw['allOf'].filter(isPlainRecord);
    if (branches.length === 2) {
      for (const [a, b] of [
        [branches[0], branches[1]],
        [branches[1], branches[0]],
      ] as const) {
        const refName = commonRefName(a['$ref']);
        if (refName === 'DynamicString') {
          const formats = extractConditionalFormats(b);
          if (formats) {
            return {
              type: 'string',
              dynamic: true,
              format: formats.length === 1 ? formats[0] : formats,
              ...meta,
            };
          }
        }
        if (refName === 'FunctionCall' && isReturnTypeConstraintBranch(b)) {
          return {type: 'functionCall', ...meta};
        }
      }
    }
    // Single-entry allOf (when not a multi-group atLeastOneOf on an object schema)
    if (branches.length === 1 && raw['type'] !== 'object' && !isPlainRecord(raw['properties'])) {
      const inner = convertJsonSchemaNode(branches[0], allowComponentTypes, ctx);
      return {...inner, ...meta};
    }
  }

  if (hasUntranslatableKeywords(raw)) {
    return {type: 'rawJsonSchema', schema: JSON.parse(JSON.stringify(raw)), ...meta};
  }

  // Handle const
  if (Object.hasOwn(raw, 'const')) {
    const val = raw['const'];
    if (
      val === null ||
      typeof val === 'string' ||
      typeof val === 'number' ||
      typeof val === 'boolean'
    ) {
      return {type: 'const', value: val, ...meta};
    }
  }

  // Handle enum
  if (Array.isArray(raw['enum']) && raw['enum'].length > 0) {
    const values = raw['enum'].filter(
      (v): v is EnumPrimitiveValue =>
        typeof v === 'string' ||
        (typeof v === 'number' && Number.isFinite(v)) ||
        typeof v === 'boolean',
    );
    if (values.length === raw['enum'].length) {
      const valueType =
        raw['type'] === 'string' || raw['type'] === 'number' || raw['type'] === 'boolean'
          ? (raw['type'] as EnumValueType)
          : inferEnumValueType(values);
      const def =
        typeof raw['default'] === 'string' ||
        typeof raw['default'] === 'number' ||
        typeof raw['default'] === 'boolean'
          ? raw['default']
          : undefined;
      return {
        type: 'enum',
        values,
        ...(valueType !== undefined ? {valueType} : {}),
        ...(def !== undefined ? {default: def} : {}),
        ...meta,
      };
    }
  }

  // Handle non-dynamic multi-format StringType (`{ type: 'string', oneOf: [{ format: ... }, ...] }`)
  const multiStringFormats =
    raw['type'] === 'string' ? extractFormatList(raw['oneOf'] ?? raw['anyOf']) : undefined;

  // Handle oneOf / anyOf (unions)
  const unionKey = multiStringFormats
    ? undefined
    : Array.isArray(raw['oneOf'])
      ? 'oneOf'
      : Array.isArray(raw['anyOf']) && raw['type'] !== 'object' && !isPlainRecord(raw['properties'])
        ? 'anyOf'
        : undefined;
  if (unionKey) {
    const list = raw[unionKey] as unknown[];
    const variants = list.map(item => convertJsonSchemaNode(item, allowComponentTypes, ctx));
    const collapsed = collapseDynamicUnion(variants, meta);
    if (collapsed) return collapsed;
    const exclusive = unionKey === 'oneOf';
    const hasDefault = Object.hasOwn(raw, 'default') && raw['default'] !== undefined;
    return {
      type: 'union',
      variants,
      exclusive,
      ...(hasDefault ? {default: raw['default']} : {}),
      ...meta,
    } as TypeDefinition;
  }

  // Handle JSON Schema multi-type array e.g. type: ["boolean", "object"]
  if (Array.isArray(raw['type'])) {
    const types = raw['type'].filter((item): item is string => typeof item === 'string');
    const nonNullTypes = types.filter(item => item !== 'null');
    if (nonNullTypes.length > 1) {
      const variants = nonNullTypes.map(subType => {
        const subSchema: Record<string, unknown> = {...raw, type: subType};
        delete subSchema['description'];
        return convertJsonSchemaNode(subSchema, allowComponentTypes, ctx);
      });
      return {type: 'union', variants, exclusive: true, ...meta} as TypeDefinition;
    }
    if (nonNullTypes.length === 1) {
      return convertJsonSchemaNode({...raw, type: nonNullTypes[0]}, allowComponentTypes, ctx);
    }
  }

  const schemaType =
    typeof raw['type'] === 'string'
      ? raw['type']
      : isPlainRecord(raw['properties']) || Object.hasOwn(raw, 'additionalProperties')
        ? 'object'
        : Object.hasOwn(raw, 'items')
          ? 'array'
          : undefined;

  switch (schemaType) {
    case 'string': {
      const format: string | readonly string[] | undefined = multiStringFormats
        ? multiStringFormats.length === 1
          ? multiStringFormats[0]
          : multiStringFormats
        : typeof raw['format'] === 'string'
          ? raw['format']
          : undefined;
      const pattern = typeof raw['pattern'] === 'string' ? raw['pattern'] : undefined;
      const minLength = typeof raw['minLength'] === 'number' ? raw['minLength'] : undefined;
      const maxLength = typeof raw['maxLength'] === 'number' ? raw['maxLength'] : undefined;
      const def = typeof raw['default'] === 'string' ? raw['default'] : undefined;
      return {
        type: 'string',
        ...(format !== undefined ? {format} : {}),
        ...(pattern !== undefined ? {pattern} : {}),
        ...(minLength !== undefined ? {minLength} : {}),
        ...(maxLength !== undefined ? {maxLength} : {}),
        ...(def !== undefined ? {default: def} : {}),
        ...meta,
      };
    }
    case 'number':
    case 'integer': {
      const min = typeof raw['minimum'] === 'number' ? raw['minimum'] : undefined;
      const max = typeof raw['maximum'] === 'number' ? raw['maximum'] : undefined;
      const def = typeof raw['default'] === 'number' ? raw['default'] : undefined;
      return {
        type: schemaType,
        ...(min !== undefined ? {min} : {}),
        ...(max !== undefined ? {max} : {}),
        ...(def !== undefined ? {default: def} : {}),
        ...meta,
      };
    }
    case 'boolean': {
      const def = typeof raw['default'] === 'boolean' ? raw['default'] : undefined;
      return {type: 'boolean', ...(def !== undefined ? {default: def} : {}), ...meta};
    }
    case 'array': {
      const items =
        raw['items'] !== undefined
          ? convertJsonSchemaNode(raw['items'], allowComponentTypes, ctx)
          : undefined;
      const minItems = typeof raw['minItems'] === 'number' ? raw['minItems'] : undefined;
      const maxItems = typeof raw['maxItems'] === 'number' ? raw['maxItems'] : undefined;
      const uniqueItems = typeof raw['uniqueItems'] === 'boolean' ? raw['uniqueItems'] : undefined;
      const def = Array.isArray(raw['default']) ? [...raw['default']] : undefined;
      return {
        type: 'array',
        ...(items !== undefined ? {items} : {}),
        ...(minItems !== undefined ? {minItems} : {}),
        ...(maxItems !== undefined ? {maxItems} : {}),
        ...(uniqueItems !== undefined ? {uniqueItems} : {}),
        ...(def !== undefined ? {default: def} : {}),
        ...meta,
      } as TypeDefinition;
    }
    case 'object': {
      const reqSet = new Set(
        Array.isArray(raw['required'])
          ? (raw['required'] as unknown[]).filter((r): r is string => typeof r === 'string')
          : [],
      );
      let properties: ComponentParameterDefinition[] | undefined;
      if (isPlainRecord(raw['properties'])) {
        properties = Object.entries(raw['properties']).map(([name, propRaw]) => {
          const propType = convertJsonSchemaNode(propRaw, allowComponentTypes, ctx);
          return {
            name,
            ...(reqSet.has(name) ? {required: true} : {}),
            ...propType,
          };
        });
      }
      // In JSON Schema, omitting additionalProperties/unevaluatedProperties allows extra keys,
      // whereas CatalogModel defaults additionalProperties to false.
      let additionalProperties: boolean | TypeDefinition | undefined;
      if (typeof raw['additionalProperties'] === 'boolean') {
        additionalProperties = raw['additionalProperties'];
      } else if (isPlainRecord(raw['additionalProperties'])) {
        additionalProperties = convertJsonSchemaNode(
          raw['additionalProperties'],
          allowComponentTypes,
          ctx,
        );
      } else if (raw['unevaluatedProperties'] === false) {
        additionalProperties = false;
      } else {
        additionalProperties = true;
      }
      const atLeastOneOf = extractAtLeastOneOf(raw);
      const def = isPlainRecord(raw['default']) ? raw['default'] : undefined;
      return {
        type: 'object',
        ...(properties !== undefined ? {properties} : {}),
        ...(additionalProperties !== undefined ? {additionalProperties} : {}),
        ...(atLeastOneOf !== undefined ? {atLeastOneOf} : {}),
        ...(def !== undefined ? {default: def} : {}),
        ...meta,
      } as TypeDefinition;
    }
    default: {
      // Unconstrained `{}` schema (e.g. `required.args.value`).
      const hasDefault = Object.hasOwn(raw, 'default') && raw['default'] !== undefined;
      return {
        type: 'any',
        dynamic: true,
        nullable: true,
        ...(hasDefault ? {default: raw['default']} : {}),
        ...meta,
      };
    }
  }
}

function collectComponentSchemaParts(
  schema: Record<string, unknown>,
  rawDefs: Readonly<Record<string, unknown>>,
  visited: Set<unknown>,
): {
  checkable: boolean;
  description?: string;
  properties: Map<string, Record<string, unknown>>;
  required: Set<string>;
  atLeastOneOf: string[][];
} {
  let checkable = false;
  let description = typeof schema['description'] === 'string' ? schema['description'] : undefined;
  const properties = new Map<string, Record<string, unknown>>();
  const required = new Set<string>();
  const atLeastOneOf: string[][] = [];

  const visit = (node: unknown): void => {
    if (!isPlainRecord(node) || visited.has(node)) return;
    visited.add(node);

    const cRef = commonRefName(node['$ref']);
    if (cRef === 'Checkable') {
      checkable = true;
      return;
    }
    if (cRef === 'ComponentCommon') {
      return;
    }
    const lRef = localDefName(node['$ref']);
    if (lRef && Object.hasOwn(rawDefs, lRef)) {
      visit(rawDefs[lRef]);
      return;
    }
    if (description === undefined && typeof node['description'] === 'string') {
      description = node['description'];
    }
    if (isPlainRecord(node['properties'])) {
      for (const [key, propSchema] of Object.entries(node['properties'])) {
        if (FORBIDDEN_COMPONENT_PARAM_NAMES.has(key)) {
          if (key === '@checks') checkable = true;
          continue;
        }
        if (key === 'checks' && isPlainRecord(propSchema)) {
          const items = propSchema['items'];
          if (
            propSchema['type'] === 'array' &&
            isPlainRecord(items) &&
            commonRefName(items['$ref']) === 'CheckRule'
          ) {
            checkable = true;
            continue;
          }
        }
        if (
          key === 'accessibility' &&
          isPlainRecord(propSchema) &&
          commonRefName(propSchema['$ref']) === 'AccessibilityAttributes'
        ) {
          continue;
        }
        if (!properties.has(key) && isPlainRecord(propSchema)) {
          properties.set(key, propSchema);
        }
      }
    }
    if (Array.isArray(node['required'])) {
      for (const r of node['required']) {
        if (typeof r === 'string' && !FORBIDDEN_COMPONENT_PARAM_NAMES.has(r)) {
          required.add(r);
        }
      }
    }
    const extracted = extractSingleAtLeastOneOfGroup(node['anyOf']);
    if (extracted) {
      atLeastOneOf.push(extracted);
    }
    if (Array.isArray(node['allOf'])) {
      // Visit specific component sub-schemas (declaring `component`) before mixins
      // so component-own parameter ordering is preserved.
      const specific: unknown[] = [];
      const mixins: unknown[] = [];
      for (const sub of node['allOf']) {
        if (
          isPlainRecord(sub) &&
          isPlainRecord(sub['properties']) &&
          Object.hasOwn(sub['properties'], 'component')
        ) {
          specific.push(sub);
        } else {
          mixins.push(sub);
        }
      }
      for (const sub of [...specific, ...mixins]) {
        visit(sub);
      }
    }
  };

  visit(schema);
  return {checkable, description, properties, required, atLeastOneOf};
}

function convertComponentSchema(
  name: string,
  schema: Record<string, unknown>,
  ctx: ConversionContext,
): ComponentDefinition {
  const parts = collectComponentSchemaParts(schema, ctx.rawDefs, new Set());
  const parameters: ComponentParameterDefinition[] = [];
  for (const [paramName, propSchema] of parts.properties) {
    const typeDef = convertJsonSchemaNode(propSchema, true, ctx);
    parameters.push({
      name: paramName,
      ...(parts.required.has(paramName) ? {required: true} : {}),
      ...typeDef,
    });
  }
  const allowedParents = Array.isArray(schema['allowedParents'])
    ? (schema['allowedParents'] as unknown[]).filter((s): s is string => typeof s === 'string')
    : undefined;
  const allowedChildren = Array.isArray(schema['allowedChildren'])
    ? (schema['allowedChildren'] as unknown[]).filter((s): s is string => typeof s === 'string')
    : undefined;
  const metadata = isPlainRecord(schema['metadata'])
    ? (schema['metadata'] as CatalogMetadata)
    : undefined;
  const deprecated = typeof schema['deprecated'] === 'boolean' ? schema['deprecated'] : undefined;
  const deprecatedReason =
    typeof schema['deprecatedReason'] === 'string' ? schema['deprecatedReason'] : undefined;

  return {
    name,
    ...(parts.description !== undefined ? {description: parts.description} : {}),
    ...(parts.checkable ? {checkable: true} : {}),
    ...(parameters.length > 0 ? {parameters} : {}),
    ...(parts.atLeastOneOf.length > 0 ? {atLeastOneOf: parts.atLeastOneOf} : {}),
    ...(allowedParents !== undefined ? {allowedParents} : {}),
    ...(allowedChildren !== undefined ? {allowedChildren} : {}),
    ...(metadata !== undefined ? {metadata} : {}),
    ...(deprecated !== undefined ? {deprecated} : {}),
    ...(deprecatedReason !== undefined ? {deprecatedReason} : {}),
  };
}

function convertFunctionSchema(
  name: string,
  rawFn: Record<string, unknown>,
  ctx: ConversionContext,
): FunctionDefinition {
  const description = typeof rawFn['description'] === 'string' ? rawFn['description'] : undefined;
  const fnProps = isPlainRecord(rawFn['properties']) ? rawFn['properties'] : undefined;
  const constProp = (key: string): unknown => {
    const entry = fnProps?.[key];
    return isPlainRecord(entry) ? entry['const'] : undefined;
  };

  const rawReturn = rawFn['returnType'] ?? constProp('returnType');
  let returnType: FunctionReturnDefinition = 'any';
  if (typeof rawReturn === 'string' && FUNCTION_RETURN_SHORTHANDS.has(rawReturn)) {
    returnType = rawReturn as FunctionReturnShorthand;
  } else if (isPlainRecord(rawReturn)) {
    returnType = convertJsonSchemaNode(rawReturn, false, ctx) as DataTypeDefinition;
  }

  const rawCallers = rawFn['allowedCallers'] ?? constProp('allowedCallers');
  const allowedCallers: AllowedCallers | undefined =
    rawCallers === 'rendererOnly' || rawCallers === 'agentOnly' || rawCallers === 'rendererOrAgent'
      ? rawCallers
      : undefined;

  const rawActivation = rawFn['requiresUserActivation'] ?? constProp('requiresUserActivation');
  const requiresUserActivation = typeof rawActivation === 'boolean' ? rawActivation : undefined;

  const argsSchema = isPlainRecord(fnProps?.['args'])
    ? fnProps['args']
    : isPlainRecord(rawFn['parameters'])
      ? rawFn['parameters']
      : undefined;

  let parameters: DataParameterDefinition[] | undefined;
  let atLeastOneOf: string[][] | undefined;
  let additionalParameters: boolean | DataTypeDefinition | undefined;

  if (argsSchema) {
    const reqSet = new Set(
      Array.isArray(argsSchema['required'])
        ? (argsSchema['required'] as unknown[]).filter((r): r is string => typeof r === 'string')
        : [],
    );
    if (isPlainRecord(argsSchema['properties'])) {
      parameters = Object.entries(argsSchema['properties']).map(([paramName, propRaw]) => {
        const typeDef = convertJsonSchemaNode(propRaw, false, ctx) as DataTypeDefinition;
        return {
          name: paramName,
          ...(reqSet.has(paramName) ? {required: true} : {}),
          ...typeDef,
        };
      });
    }
    atLeastOneOf = extractAtLeastOneOf(argsSchema);
    if (typeof argsSchema['additionalProperties'] === 'boolean') {
      if (argsSchema['additionalProperties']) additionalParameters = true;
    } else if (isPlainRecord(argsSchema['additionalProperties'])) {
      additionalParameters = convertJsonSchemaNode(
        argsSchema['additionalProperties'],
        false,
        ctx,
      ) as DataTypeDefinition;
    }
  }

  const deprecated = typeof rawFn['deprecated'] === 'boolean' ? rawFn['deprecated'] : undefined;
  const deprecatedReason =
    typeof rawFn['deprecatedReason'] === 'string' ? rawFn['deprecatedReason'] : undefined;

  return {
    name,
    ...(description !== undefined ? {description} : {}),
    returnType,
    ...(allowedCallers !== undefined ? {allowedCallers} : {}),
    ...(requiresUserActivation ? {requiresUserActivation: true} : {}),
    ...(parameters !== undefined && parameters.length > 0 ? {parameters} : {}),
    ...(atLeastOneOf !== undefined && atLeastOneOf.length > 0 ? {atLeastOneOf} : {}),
    ...(additionalParameters !== undefined ? {additionalParameters} : {}),
    ...(deprecated !== undefined ? {deprecated} : {}),
    ...(deprecatedReason !== undefined ? {deprecatedReason} : {}),
  };
}

function convertThemeToSurfaceProperties(
  rawTheme: unknown,
  ctx: ConversionContext,
): SurfacePropertiesDefinition | undefined {
  if (!isPlainRecord(rawTheme)) return undefined;
  const description =
    typeof rawTheme['description'] === 'string' ? rawTheme['description'] : undefined;
  const isWrapper = rawTheme['type'] === 'object' || isPlainRecord(rawTheme['properties']);
  const propsObj = isWrapper
    ? isPlainRecord(rawTheme['properties'])
      ? rawTheme['properties']
      : {}
    : rawTheme;
  const reqSet = new Set(
    isWrapper && Array.isArray(rawTheme['required'])
      ? (rawTheme['required'] as unknown[]).filter((r): r is string => typeof r === 'string')
      : [],
  );
  const properties: DataParameterDefinition[] = [];
  for (const [name, propRaw] of Object.entries(propsObj)) {
    if (!isValidUax31Identifier(name)) continue;
    const typeDef = convertJsonSchemaNode(propRaw, false, ctx) as DataTypeDefinition;
    properties.push({
      name,
      ...(reqSet.has(name) ? {required: true} : {}),
      ...typeDef,
    });
  }
  let additionalProperties: boolean | DataTypeDefinition | undefined;
  if (isWrapper) {
    if (typeof rawTheme['additionalProperties'] === 'boolean') {
      additionalProperties = rawTheme['additionalProperties'];
    } else if (isPlainRecord(rawTheme['additionalProperties'])) {
      additionalProperties = convertJsonSchemaNode(
        rawTheme['additionalProperties'],
        false,
        ctx,
      ) as DataTypeDefinition;
    }
  }
  if (properties.length === 0 && additionalProperties === undefined && description === undefined) {
    return undefined;
  }
  return {
    ...(description !== undefined ? {description} : {}),
    ...(properties.length > 0 ? {properties} : {}),
    ...(additionalProperties !== undefined ? {additionalProperties} : {}),
  };
}

/** Options for {@link jsonSchemaToModel}. */
export interface JsonSchemaToModelOptions {
  readonly protocolVersion?: string;
  readonly catalogId?: string;
}

/**
 * Converts a legacy A2UI JSON Schema catalog document (v0.8, v0.9, v0.9.1, v1.0)
 * into a canonical {@link CatalogModel} with zero Zod dependency.
 */
export function jsonSchemaToModel(
  rawDoc: Record<string, unknown>,
  options?: JsonSchemaToModelOptions,
): CatalogModel {
  if (!isPlainRecord(rawDoc)) {
    throw new A2uiCatalogError('Catalog JSON Schema document must be an object.');
  }
  const catalogId =
    options?.catalogId ??
    (typeof rawDoc['catalogId'] === 'string' && rawDoc['catalogId']
      ? rawDoc['catalogId']
      : typeof rawDoc['$id'] === 'string' && rawDoc['$id']
        ? rawDoc['$id']
        : undefined);
  if (!catalogId) {
    throw new A2uiCatalogError('Catalog JSON Schema document is missing catalogId.');
  }

  const protocolVersion =
    options?.protocolVersion ??
    (typeof rawDoc['protocolVersion'] === 'string' ? rawDoc['protocolVersion'] : '0.9');
  const rawDefs = isPlainRecord(rawDoc['$defs'])
    ? rawDoc['$defs']
    : isPlainRecord(rawDoc['definitions'])
      ? rawDoc['definitions']
      : {};

  const ctx: ConversionContext = {
    rawDefs,
    localTypes: new Map(),
    convertingDefs: new Set(),
  };

  const components: ComponentDefinition[] = [];
  if (isPlainRecord(rawDoc['components'])) {
    for (const [compName, compRaw] of Object.entries(rawDoc['components'])) {
      if (compName === 'Surface' || !isPlainRecord(compRaw)) continue;
      components.push(convertComponentSchema(compName, compRaw, ctx));
    }
  }

  const functions: FunctionDefinition[] = [];
  if (Array.isArray(rawDoc['functions'])) {
    for (const fnRaw of rawDoc['functions']) {
      if (!isPlainRecord(fnRaw) || typeof fnRaw['name'] !== 'string') continue;
      functions.push(convertFunctionSchema(fnRaw['name'], fnRaw, ctx));
    }
  } else if (isPlainRecord(rawDoc['functions'])) {
    for (const [fnName, fnRaw] of Object.entries(rawDoc['functions'])) {
      if (!isPlainRecord(fnRaw)) continue;
      functions.push(convertFunctionSchema(fnName, fnRaw, ctx));
    }
  }

  const rawTheme = rawDefs['theme'] ?? rawDoc['theme'] ?? rawDoc['styles'];
  const surfaceProperties = convertThemeToSurfaceProperties(rawTheme, ctx);

  const typesObj: Record<string, DataTypeDefinition> = {};
  for (const [k, v] of ctx.localTypes) {
    typesObj[k] = v;
  }

  return {
    formatVersion: CATALOG_DOCUMENT_FORMAT_VERSION,
    catalogId,
    protocolVersion,
    ...(typeof rawDoc['title'] === 'string' ? {title: rawDoc['title']} : {}),
    ...(typeof rawDoc['description'] === 'string' ? {description: rawDoc['description']} : {}),
    ...(typeof rawDoc['instructions'] === 'string' ? {instructions: rawDoc['instructions']} : {}),
    ...(isPlainRecord(rawDoc['metadata']) ? {metadata: rawDoc['metadata'] as CatalogMetadata} : {}),
    ...(Object.keys(typesObj).length > 0 ? {types: typesObj} : {}),
    ...(surfaceProperties !== undefined ? {surfaceProperties} : {}),
    ...(components.length > 0 ? {components} : {}),
    ...(functions.length > 0 ? {functions} : {}),
  };
}

/** Options controlling {@link modelToJsonSchema} output layout. */
export interface ModelToJsonSchemaOptions {
  /** Protocol version controlling `@call` vs `call`, `Child` vs `ComponentId`, etc. */
  readonly protocolVersion?: string;
  /** URI prefix for common types `$ref`s. Defaults to `'common_types.json'`. */
  readonly commonTypesUri?: string;
  /** `$schema` URI to emit. Defaults to JSON Schema draft 2020-12. */
  readonly schemaUri?: string;
  /** Optional `$id` URI to emit. */
  readonly schemaId?: string;
  /** Function serialization layout (`'map'` default for v1.0, `'list'` optional for v0.9). */
  readonly functionsLayout?: 'map' | 'list';
}

function attachMeta(target: Record<string, unknown>, meta: TypeMeta): Record<string, unknown> {
  if (meta.description !== undefined) target['description'] = meta.description;
  if (meta.deprecated !== undefined) target['deprecated'] = meta.deprecated;
  if (meta.deprecatedReason !== undefined) target['deprecatedReason'] = meta.deprecatedReason;
  return target;
}

function applyAtLeastOneOf(
  target: Record<string, unknown>,
  groups: readonly (readonly string[])[] | undefined,
): void {
  if (!groups || groups.length === 0) return;
  if (groups.length === 1) {
    target['anyOf'] = groups[0].map(k => ({'required': [k]}));
    return;
  }
  const branches = groups.map(g => ({'anyOf': g.map(k => ({'required': [k]}))}));
  if (Array.isArray(target['allOf'])) {
    (target['allOf'] as unknown[]).push(...branches);
  } else {
    target['allOf'] = branches;
  }
}

function buildObjectSchemaBody(
  properties: readonly ParameterDefinition[] | undefined,
  atLeastOneOf: readonly (readonly string[])[] | undefined,
  options: ModelToJsonSchemaOptions,
  opts: {
    readonly initialProps?: Record<string, unknown>;
    readonly initialRequired?: string[];
    readonly emitEmptyProps?: boolean;
    readonly additionalRule?: boolean | TypeDefinition;
    readonly defaultClosed?: boolean;
    readonly closedKeyword?: 'additionalProperties' | 'unevaluatedProperties';
  } = {},
): {readonly schema: Record<string, unknown>; readonly requiredCount: number} {
  const props: Record<string, unknown> = opts.initialProps ? {...opts.initialProps} : {};
  const required: string[] = opts.initialRequired ? [...opts.initialRequired] : [];
  for (const param of properties ?? []) {
    props[param.name] = typeDefinitionToJsonSchema(param, options);
    if (param.required) required.push(param.name);
  }
  const obj: Record<string, unknown> = {'type': 'object'};
  if (opts.emitEmptyProps || Object.keys(props).length > 0) {
    obj['properties'] = props;
  }
  if (required.length > 0) {
    obj['required'] = required;
  }
  applyAtLeastOneOf(obj, atLeastOneOf);
  const closedKey = opts.closedKeyword ?? 'additionalProperties';
  if (opts.additionalRule === undefined) {
    if (opts.defaultClosed) {
      obj[closedKey] = false;
    }
  } else if (typeof opts.additionalRule === 'boolean') {
    if (!opts.additionalRule) {
      obj[closedKey] = false;
    } else if (opts.defaultClosed === false) {
      obj['additionalProperties'] = true;
    }
  } else {
    obj['additionalProperties'] = typeDefinitionToJsonSchema(opts.additionalRule, options);
  }
  return {schema: obj, requiredCount: required.length};
}

/**
 * Serializes a canonical {@link SurfacePropertiesDefinition} into a JSON Schema
 * object (`$defs.theme` / v0.9 `theme`).
 */
export function surfacePropertiesToJsonSchema(
  surfaceProperties: SurfacePropertiesDefinition,
  options: ModelToJsonSchemaOptions = {},
): Record<string, unknown> {
  const {schema} = buildObjectSchemaBody(surfaceProperties.properties, undefined, options, {
    additionalRule: surfaceProperties.additionalProperties,
    defaultClosed: false,
  });
  if (surfaceProperties.description !== undefined) {
    schema['description'] = surfaceProperties.description;
  }
  return schema;
}

/**
 * Serializes a single canonical {@link TypeDefinition} into a JSON Schema Draft 2020-12 object.
 */
export function typeDefinitionToJsonSchema(
  typeDef: TypeDefinition,
  options: ModelToJsonSchemaOptions = {},
): Record<string, unknown> {
  const commonUri = options.commonTypesUri ?? DEFAULT_COMMON_TYPES_URI;
  const atLeastV10 = isAtLeastVersion(options.protocolVersion ?? '1.0', '1.0');
  const commonRef = (name: string): Record<string, unknown> => ({
    '$ref': `${commonUri}#/$defs/${name}`,
  });

  if (typeDef.type === 'rawJsonSchema') {
    return JSON.parse(JSON.stringify(typeDef.schema)) as Record<string, unknown>;
  }

  switch (typeDef.type) {
    case 'string': {
      const hasConstraints =
        typeDef.pattern !== undefined ||
        typeDef.minLength !== undefined ||
        typeDef.maxLength !== undefined ||
        typeDef.default !== undefined;
      if (typeDef.dynamic) {
        if (typeDef.format !== undefined && !hasConstraints) {
          if (Array.isArray(typeDef.format)) {
            return attachMeta(
              {
                'allOf': [
                  commonRef('DynamicString'),
                  {
                    'if': {'type': 'string'},
                    'then': {'oneOf': typeDef.format.map(f => ({'format': f}))},
                  },
                ],
              },
              typeDef,
            );
          }
          return attachMeta(
            {
              'oneOf': [
                {'type': 'string', 'format': typeDef.format},
                commonRef('DataBinding'),
                commonRef('FunctionCall'),
              ],
            },
            typeDef,
          );
        }
        if (!hasConstraints) {
          return attachMeta(commonRef('DynamicString'), typeDef);
        }
      }
      const lit: Record<string, unknown> = {'type': 'string'};
      if (typeDef.format !== undefined) {
        if (Array.isArray(typeDef.format)) {
          lit['oneOf'] = typeDef.format.map(f => ({'format': f}));
        } else {
          lit['format'] = typeDef.format;
        }
      }
      if (typeDef.pattern !== undefined) lit['pattern'] = typeDef.pattern;
      if (typeDef.minLength !== undefined) lit['minLength'] = typeDef.minLength;
      if (typeDef.maxLength !== undefined) lit['maxLength'] = typeDef.maxLength;
      if (typeDef.default !== undefined) lit['default'] = typeDef.default;
      if (typeDef.dynamic) {
        return attachMeta(
          {'oneOf': [lit, commonRef('DataBinding'), commonRef('FunctionCall')]},
          typeDef,
        );
      }
      return attachMeta(lit, typeDef);
    }
    case 'number':
    case 'integer': {
      const hasConstraints =
        typeDef.min !== undefined || typeDef.max !== undefined || typeDef.default !== undefined;
      if (typeDef.dynamic && typeDef.type === 'number' && !hasConstraints) {
        return attachMeta(commonRef('DynamicNumber'), typeDef);
      }
      const lit: Record<string, unknown> = {'type': typeDef.type};
      if (typeDef.min !== undefined) lit['minimum'] = typeDef.min;
      if (typeDef.max !== undefined) lit['maximum'] = typeDef.max;
      if (typeDef.default !== undefined) lit['default'] = typeDef.default;
      if (typeDef.dynamic) {
        return attachMeta(
          {'oneOf': [lit, commonRef('DataBinding'), commonRef('FunctionCall')]},
          typeDef,
        );
      }
      return attachMeta(lit, typeDef);
    }
    case 'boolean': {
      if (typeDef.dynamic && typeDef.default === undefined) {
        return attachMeta(commonRef('DynamicBoolean'), typeDef);
      }
      const lit: Record<string, unknown> = {'type': 'boolean'};
      if (typeDef.default !== undefined) lit['default'] = typeDef.default;
      if (typeDef.dynamic) {
        return attachMeta(
          {'oneOf': [lit, commonRef('DataBinding'), commonRef('FunctionCall')]},
          typeDef,
        );
      }
      return attachMeta(lit, typeDef);
    }
    case 'enum': {
      const lit: Record<string, unknown> = {};
      const valueType = typeDef.valueType ?? inferEnumValueType(typeDef.values);
      if (valueType !== undefined) lit['type'] = valueType;
      lit['enum'] = [...typeDef.values];
      if (typeDef.default !== undefined) lit['default'] = typeDef.default;
      if (typeDef.dynamic) {
        return attachMeta(
          {'oneOf': [lit, commonRef('DataBinding'), commonRef('FunctionCall')]},
          typeDef,
        );
      }
      return attachMeta(lit, typeDef);
    }
    case 'const':
      return attachMeta({'const': typeDef.value}, typeDef);
    case 'any': {
      if (typeDef.dynamic && typeDef.nullable === false) {
        return attachMeta(commonRef('DynamicValue'), typeDef);
      }
      const out: Record<string, unknown> = {};
      if (typeDef.default !== undefined) out['default'] = typeDef.default;
      return attachMeta(out, typeDef);
    }
    case 'object': {
      const {schema: obj} = buildObjectSchemaBody(
        typeDef.properties,
        typeDef.atLeastOneOf,
        options,
        {
          additionalRule: typeDef.additionalProperties,
          defaultClosed: true,
          closedKeyword: 'additionalProperties',
        },
      );
      if (typeDef.default !== undefined) obj['default'] = typeDef.default;
      if (typeDef.dynamic) {
        return attachMeta(
          {'oneOf': [obj, commonRef('DataBinding'), commonRef('FunctionCall')]},
          typeDef,
        );
      }
      return attachMeta(obj, typeDef);
    }
    case 'array': {
      const hasConstraints =
        typeDef.minItems !== undefined ||
        typeDef.maxItems !== undefined ||
        typeDef.uniqueItems !== undefined ||
        typeDef.default !== undefined;
      if (
        typeDef.dynamic &&
        !hasConstraints &&
        typeDef.items?.type === 'string' &&
        !typeDef.items.dynamic &&
        typeDef.items.format === undefined &&
        typeDef.items.pattern === undefined &&
        typeDef.items.minLength === undefined &&
        typeDef.items.maxLength === undefined &&
        typeDef.items.default === undefined
      ) {
        return attachMeta(commonRef('DynamicStringList'), typeDef);
      }
      const arr: Record<string, unknown> = {'type': 'array'};
      if (typeDef.items !== undefined) {
        arr['items'] = typeDefinitionToJsonSchema(typeDef.items, options);
      }
      if (typeDef.minItems !== undefined) arr['minItems'] = typeDef.minItems;
      if (typeDef.maxItems !== undefined) arr['maxItems'] = typeDef.maxItems;
      if (typeDef.uniqueItems !== undefined) arr['uniqueItems'] = typeDef.uniqueItems;
      if (typeDef.default !== undefined) arr['default'] = typeDef.default;
      if (typeDef.dynamic) {
        return attachMeta(
          {'oneOf': [arr, commonRef('DataBinding'), commonRef('FunctionCall')]},
          typeDef,
        );
      }
      return attachMeta(arr, typeDef);
    }
    case 'union': {
      const key = typeDef.exclusive === false ? 'anyOf' : 'oneOf';
      const variants = typeDef.variants.map(v => typeDefinitionToJsonSchema(v, options));
      if (typeDef.dynamic) {
        variants.push(commonRef('DataBinding'), commonRef('FunctionCall'));
      }
      const out: Record<string, unknown> = {[key]: variants};
      if (typeDef.default !== undefined) out['default'] = typeDef.default;
      return attachMeta(out, typeDef);
    }
    case 'dataBinding':
      return attachMeta(commonRef('DataBinding'), typeDef);
    case 'functionCall':
      return attachMeta(commonRef('FunctionCall'), typeDef);
    case 'ref': {
      const out: Record<string, unknown> = {'$ref': `#/$defs/${typeDef.ref}`};
      if (typeDef.default !== undefined) out['default'] = typeDef.default;
      return attachMeta(out, typeDef);
    }
    case 'child':
      return attachMeta(commonRef(atLeastV10 ? 'Child' : 'ComponentId'), typeDef);
    case 'childList':
      return attachMeta(commonRef('ChildList'), typeDef);
    case 'action':
      return attachMeta(commonRef('Action'), typeDef);
    case 'checkRule':
      return attachMeta(commonRef('CheckRule'), typeDef);
    case 'accessibility':
      return attachMeta(commonRef('AccessibilityAttributes'), typeDef);
  }
}

/** Serializes a canonical {@link ComponentDefinition} to a JSON Schema component entry. */
export function componentDefinitionToJsonSchema(
  comp: ComponentDefinition,
  options: ModelToJsonSchemaOptions = {},
): Record<string, unknown> {
  const commonUri = options.commonTypesUri ?? DEFAULT_COMMON_TYPES_URI;
  const atLeastV10 = isAtLeastVersion(options.protocolVersion ?? '1.0', '1.0');
  const {schema: body} = buildObjectSchemaBody(comp.parameters, comp.atLeastOneOf, options, {
    initialProps: {'component': {'const': comp.name}},
    initialRequired: ['component'],
    emitEmptyProps: true,
  });

  const mixins: Array<Record<string, unknown>> = [];
  if (!atLeastV10) {
    mixins.push({'$ref': `${commonUri}#/$defs/ComponentCommon`});
  }
  if (comp.checkable) {
    mixins.push({'$ref': `${commonUri}#/$defs/Checkable`});
  }

  const out: Record<string, unknown> =
    mixins.length > 0 ? {'type': 'object', 'allOf': [...mixins, body]} : body;
  if (!atLeastV10) {
    out['unevaluatedProperties'] = false;
  }
  if (comp.description !== undefined) out['description'] = comp.description;
  if (comp.allowedParents !== undefined) out['allowedParents'] = [...comp.allowedParents];
  if (comp.allowedChildren !== undefined) out['allowedChildren'] = [...comp.allowedChildren];
  if (comp.metadata !== undefined) out['metadata'] = JSON.parse(JSON.stringify(comp.metadata));
  if (comp.deprecated !== undefined) out['deprecated'] = comp.deprecated;
  if (comp.deprecatedReason !== undefined) out['deprecatedReason'] = comp.deprecatedReason;
  return out;
}

/** Serializes a canonical {@link FunctionDefinition} to a JSON Schema function entry. */
export function functionDefinitionToJsonSchema(
  fn: FunctionDefinition,
  options: ModelToJsonSchemaOptions = {},
): Record<string, unknown> {
  const atLeastV10 = isAtLeastVersion(options.protocolVersion ?? '1.0', '1.0');
  const callKey = atLeastV10 ? '@call' : 'call';
  const {schema: argsObj, requiredCount: argsRequiredCount} = buildObjectSchemaBody(
    fn.parameters,
    fn.atLeastOneOf,
    options,
    {
      emitEmptyProps: true,
      additionalRule: fn.additionalParameters,
      defaultClosed: true,
      closedKeyword: 'unevaluatedProperties',
    },
  );

  const returnTypeValue =
    typeof fn.returnType === 'string'
      ? fn.returnType
      : fn.returnType.type === 'void' || fn.returnType.type === 'validationResult'
        ? fn.returnType.type
        : typeDefinitionToJsonSchema(fn.returnType, options);

  if (options.functionsLayout === 'list') {
    const item: Record<string, unknown> = {
      'name': fn.name,
      ...(fn.description !== undefined ? {'description': fn.description} : {}),
      'returnType': returnTypeValue,
      'parameters': argsObj,
    };
    if (fn.allowedCallers !== undefined) item['allowedCallers'] = fn.allowedCallers;
    if (fn.requiresUserActivation) item['requiresUserActivation'] = true;
    return item;
  }

  const argsRequired = argsRequiredCount > 0 || (fn.atLeastOneOf?.length ?? 0) > 0;
  const fnProps: Record<string, unknown> = {
    [callKey]: {'const': fn.name},
    'args': argsObj,
  };
  if (!atLeastV10) {
    fnProps['returnType'] = {'const': returnTypeValue};
  }
  const out: Record<string, unknown> = {
    'type': 'object',
    ...(fn.description !== undefined ? {'description': fn.description} : {}),
    ...(atLeastV10 ? {'returnType': returnTypeValue} : {}),
    ...(fn.allowedCallers !== undefined ? {'allowedCallers': fn.allowedCallers} : {}),
    ...(fn.requiresUserActivation ? {'requiresUserActivation': true} : {}),
    'properties': fnProps,
    'required': argsRequired ? [callKey, 'args'] : [callKey],
    ...(!atLeastV10 ? {'unevaluatedProperties': false} : {}),
  };
  if (fn.deprecated !== undefined) out['deprecated'] = fn.deprecated;
  if (fn.deprecatedReason !== undefined) out['deprecatedReason'] = fn.deprecatedReason;
  return out;
}

/**
 * Generates a JSON Schema Draft 2020-12 A2UI catalog document from a canonical
 * {@link CatalogModel} with zero Zod dependency.
 */
export function modelToJsonSchema(
  model: CatalogModel,
  options: ModelToJsonSchemaOptions = {},
): Record<string, unknown> {
  const protocolVersion =
    options.protocolVersion ??
    (model.protocolVersion
      ? (toCanonicalVersion(model.protocolVersion) ?? model.protocolVersion)
      : '1.0');
  const resolvedOpts: ModelToJsonSchemaOptions = {...options, protocolVersion};

  const out: Record<string, unknown> = {
    '$schema': options.schemaUri ?? DEFAULT_JSON_SCHEMA_URI,
  };
  if (options.schemaId !== undefined) out['$id'] = options.schemaId;
  out['protocolVersion'] = protocolVersion;
  if (model.title !== undefined) out['title'] = model.title;
  if (model.description !== undefined) out['description'] = model.description;
  out['catalogId'] = model.catalogId;
  if (model.instructions !== undefined) out['instructions'] = model.instructions;
  if (model.metadata !== undefined) out['metadata'] = JSON.parse(JSON.stringify(model.metadata));

  const componentsObj: Record<string, unknown> = {};
  const componentRefs: Array<Record<string, unknown>> = [];
  for (const comp of model.components ?? []) {
    componentsObj[comp.name] = componentDefinitionToJsonSchema(comp, resolvedOpts);
    componentRefs.push({'$ref': `#/components/${comp.name}`});
  }
  out['components'] = componentsObj;

  const functionRefs: Array<Record<string, unknown>> = [];
  if (model.functions && model.functions.length > 0) {
    if (options.functionsLayout === 'list') {
      out['functions'] = model.functions.map(fn =>
        functionDefinitionToJsonSchema(fn, resolvedOpts),
      );
    } else {
      const functionsObj: Record<string, unknown> = {};
      for (const fn of model.functions) {
        functionsObj[fn.name] = functionDefinitionToJsonSchema(fn, resolvedOpts);
        functionRefs.push({'$ref': `#/functions/${fn.name}`});
      }
      out['functions'] = functionsObj;
    }
  }

  const defs: Record<string, unknown> = {};
  defs['anyComponent'] =
    componentRefs.length > 0
      ? {'oneOf': componentRefs, 'discriminator': {'propertyName': 'component'}}
      : {'not': {}};
  defs['anyFunction'] = functionRefs.length > 0 ? {'oneOf': functionRefs} : {'not': {}};

  if (model.types) {
    for (const [typeName, typeDef] of Object.entries(model.types)) {
      defs[typeName] = typeDefinitionToJsonSchema(typeDef, resolvedOpts);
    }
  }

  if (model.surfaceProperties) {
    defs['theme'] = surfacePropertiesToJsonSchema(model.surfaceProperties, resolvedOpts);
  }

  out['$defs'] = defs;
  return out;
}
