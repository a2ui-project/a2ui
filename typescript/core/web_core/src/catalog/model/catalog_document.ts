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

import {validateMetadata} from '../../common/metadata.js';
import {assertUax31Identifier, isValidUax31Identifier} from '../../common/uax31.js';
import {A2uiCatalogError, A2uiValidationError} from '../../errors.js';
import {
  CATALOG_DOCUMENT_FORMAT_VERSION,
  COMPONENT_ONLY_TYPE_KINDS,
  DATA_TYPE_KINDS,
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
  type FunctionDefinition,
  type FunctionReturnDefinition,
  type FunctionReturnShorthand,
  type ParameterDefinition,
  type SurfacePropertiesDefinition,
  type TypeDefinition,
} from './catalog_model.js';

const ALLOWED_CALLERS_SET: ReadonlySet<string> = new Set<AllowedCallers>([
  'rendererOnly',
  'agentOnly',
  'rendererOrAgent',
]);

const ENUM_VALUE_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreezeValue<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreezeValue(item);
    }
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const entry of Object.values(value)) {
      deepFreezeValue(entry);
    }
    return Object.freeze(value);
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new A2uiCatalogError(`${context} must be a non-negative integer.`);
  }
  return value;
}

function assertFiniteNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new A2uiCatalogError(`${context} must be a finite number.`);
  }
  return value;
}

function parseOptionalString(
  obj: Record<string, unknown>,
  key: string,
  ctx: string,
): string | undefined {
  const val = obj[key];
  if (val === undefined) return undefined;
  if (typeof val !== 'string') {
    throw new A2uiCatalogError(`${ctx}.${key} must be a string.`);
  }
  return val;
}

function parseOptionalBoolean(
  obj: Record<string, unknown>,
  key: string,
  ctx: string,
): boolean | undefined {
  const val = obj[key];
  if (val === undefined) return undefined;
  if (typeof val !== 'boolean') {
    throw new A2uiCatalogError(`${ctx}.${key} must be a boolean.`);
  }
  return val;
}

function parseOptionalMetadata(
  obj: Record<string, unknown>,
  ctx: string,
): CatalogMetadata | undefined {
  const raw = obj['metadata'];
  if (raw === undefined) return undefined;
  try {
    validateMetadata(raw);
  } catch (err) {
    if (err instanceof A2uiValidationError) {
      throw new A2uiCatalogError(`${ctx}.metadata is invalid: ${err.message}`);
    }
    throw err;
  }
  return raw;
}

function parseUniqueStringList(
  obj: Record<string, unknown>,
  key: string,
  ctx: string,
): readonly string[] | undefined {
  const raw = obj[key];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new A2uiCatalogError(`${ctx}.${key} must be an array of strings.`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new A2uiCatalogError(`${ctx}.${key} entries must be non-empty strings.`);
    }
    if (seen.has(item)) {
      throw new A2uiCatalogError(`${ctx}.${key} contains duplicate entry '${item}'.`);
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

function parseAtLeastOneOf(
  raw: unknown,
  declaredNames: ReadonlySet<string>,
  ctx: string,
): readonly (readonly string[])[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new A2uiCatalogError(`${ctx}.atLeastOneOf must be an array of parameter name groups.`);
  }
  const groups: string[][] = [];
  for (let i = 0; i < raw.length; i++) {
    const group = raw[i];
    if (!Array.isArray(group) || group.length === 0) {
      throw new A2uiCatalogError(`${ctx}.atLeastOneOf[${i}] must be a non-empty array of strings.`);
    }
    const parsedGroup: string[] = [];
    for (const member of group) {
      if (typeof member !== 'string' || !declaredNames.has(member)) {
        throw new A2uiCatalogError(
          `${ctx}.atLeastOneOf[${i}] references undeclared parameter '${String(member)}'.`,
        );
      }
      parsedGroup.push(member);
    }
    groups.push(parsedGroup);
  }
  return groups;
}

function parseTypeMeta(obj: Record<string, unknown>, ctx: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const description = parseOptionalString(obj, 'description', ctx);
  if (description !== undefined) out['description'] = description;
  const deprecated = parseOptionalBoolean(obj, 'deprecated', ctx);
  if (deprecated !== undefined) out['deprecated'] = deprecated;
  const deprecatedReason = parseOptionalString(obj, 'deprecatedReason', ctx);
  if (deprecatedReason !== undefined) out['deprecatedReason'] = deprecatedReason;
  return out;
}

function parseTypeDefinition(
  raw: unknown,
  allowComponentTypes: boolean,
  ctx: string,
  refsToVerify: Array<{ref: string; ctx: string}>,
): TypeDefinition {
  if (!isPlainObject(raw)) {
    throw new A2uiCatalogError(`${ctx} must be an object.`);
  }
  const type = raw['type'];
  if (typeof type !== 'string') {
    throw new A2uiCatalogError(`${ctx}.type must be a string.`);
  }
  if (type === 'rawJsonSchema') {
    throw new A2uiCatalogError(
      `${ctx}.type 'rawJsonSchema' is in-memory only and cannot appear in a Catalog Document.`,
    );
  }
  if (COMPONENT_ONLY_TYPE_KINDS.has(type)) {
    if (!allowComponentTypes) {
      throw new A2uiCatalogError(
        `${ctx}: component-only type '${type}' is not allowed in a data-only context.`,
      );
    }
    const meta = parseTypeMeta(raw, ctx);
    return {type, ...meta} as TypeDefinition;
  }
  if (!DATA_TYPE_KINDS.has(type)) {
    throw new A2uiCatalogError(`${ctx}: unsupported type '${type}'.`);
  }

  const meta = parseTypeMeta(raw, ctx);
  const dynamic = parseOptionalBoolean(raw, 'dynamic', ctx);

  switch (type) {
    case 'string': {
      const formatRaw = raw['format'];
      let format: string | readonly string[] | undefined;
      if (formatRaw !== undefined) {
        if (typeof formatRaw === 'string') {
          format = formatRaw;
        } else if (
          Array.isArray(formatRaw) &&
          formatRaw.length > 0 &&
          formatRaw.every((f): f is string => typeof f === 'string')
        ) {
          format = [...formatRaw];
        } else {
          throw new A2uiCatalogError(`${ctx}.format must be a string or non-empty string array.`);
        }
      }
      const pattern = parseOptionalString(raw, 'pattern', ctx);
      const minLength =
        raw['minLength'] !== undefined
          ? assertNonNegativeInteger(raw['minLength'], `${ctx}.minLength`)
          : undefined;
      const maxLength =
        raw['maxLength'] !== undefined
          ? assertNonNegativeInteger(raw['maxLength'], `${ctx}.maxLength`)
          : undefined;
      const def = parseOptionalString(raw, 'default', ctx);
      return {
        type: 'string',
        ...(dynamic !== undefined ? {dynamic} : {}),
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
      const min =
        raw['min'] !== undefined ? assertFiniteNumber(raw['min'], `${ctx}.min`) : undefined;
      const max =
        raw['max'] !== undefined ? assertFiniteNumber(raw['max'], `${ctx}.max`) : undefined;
      if (type === 'integer') {
        if (min !== undefined && !Number.isInteger(min)) {
          throw new A2uiCatalogError(`${ctx}.min must be an integer.`);
        }
        if (max !== undefined && !Number.isInteger(max)) {
          throw new A2uiCatalogError(`${ctx}.max must be an integer.`);
        }
      }
      const defRaw = raw['default'];
      let def: number | undefined;
      if (defRaw !== undefined) {
        def = assertFiniteNumber(defRaw, `${ctx}.default`);
        if (type === 'integer' && !Number.isInteger(def)) {
          throw new A2uiCatalogError(`${ctx}.default must be an integer.`);
        }
      }
      return {
        type,
        ...(dynamic !== undefined ? {dynamic} : {}),
        ...(min !== undefined ? {min} : {}),
        ...(max !== undefined ? {max} : {}),
        ...(def !== undefined ? {default: def} : {}),
        ...meta,
      };
    }
    case 'boolean': {
      const def = parseOptionalBoolean(raw, 'default', ctx);
      return {
        type: 'boolean',
        ...(dynamic !== undefined ? {dynamic} : {}),
        ...(def !== undefined ? {default: def} : {}),
        ...meta,
      };
    }
    case 'enum': {
      const rawValues = raw['values'];
      if (!Array.isArray(rawValues) || rawValues.length === 0) {
        throw new A2uiCatalogError(`${ctx}.values must be a non-empty array.`);
      }
      const values: EnumPrimitiveValue[] = [];
      for (const item of rawValues) {
        if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
          throw new A2uiCatalogError(
            `${ctx}.values entries must be strings, numbers, or booleans.`,
          );
        }
        values.push(item);
      }
      const valueTypeRaw = raw['valueType'];
      let valueType: 'string' | 'number' | 'boolean' | undefined;
      if (valueTypeRaw !== undefined) {
        if (typeof valueTypeRaw !== 'string' || !ENUM_VALUE_TYPES.has(valueTypeRaw)) {
          throw new A2uiCatalogError(`${ctx}.valueType must be 'string', 'number', or 'boolean'.`);
        }
        valueType = valueTypeRaw as 'string' | 'number' | 'boolean';
      }
      const defRaw = raw['default'];
      let def: EnumPrimitiveValue | undefined;
      if (defRaw !== undefined) {
        if (
          typeof defRaw !== 'string' &&
          typeof defRaw !== 'number' &&
          typeof defRaw !== 'boolean'
        ) {
          throw new A2uiCatalogError(`${ctx}.default must be a string, number, or boolean.`);
        }
        def = defRaw;
      }
      return {
        type: 'enum',
        values,
        ...(valueType !== undefined ? {valueType} : {}),
        ...(dynamic !== undefined ? {dynamic} : {}),
        ...(def !== undefined ? {default: def} : {}),
        ...meta,
      };
    }
    case 'const': {
      if (!Object.hasOwn(raw, 'value')) {
        throw new A2uiCatalogError(`${ctx}.value is required for const type.`);
      }
      const value = raw['value'];
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        throw new A2uiCatalogError(`${ctx}.value must be a string, number, boolean, or null.`);
      }
      return {type: 'const', value, ...meta};
    }
    case 'any': {
      const nullable = parseOptionalBoolean(raw, 'nullable', ctx);
      const hasDefault = Object.hasOwn(raw, 'default') && raw['default'] !== undefined;
      return {
        type: 'any',
        ...(dynamic !== undefined ? {dynamic} : {}),
        ...(nullable !== undefined ? {nullable} : {}),
        ...(hasDefault ? {default: raw['default']} : {}),
        ...meta,
      };
    }
    case 'object': {
      let properties: ComponentParameterDefinition[] | undefined;
      const declaredNames = new Set<string>();
      if (raw['properties'] !== undefined) {
        if (!Array.isArray(raw['properties'])) {
          throw new A2uiCatalogError(
            `${ctx}.properties must be an array of parameter definitions.`,
          );
        }
        properties = parseParameterList(
          raw['properties'],
          allowComponentTypes,
          false,
          `${ctx}.properties`,
          refsToVerify,
        );
        for (const prop of properties) {
          declaredNames.add(prop.name);
        }
      }
      let additionalProperties: boolean | TypeDefinition | undefined;
      if (raw['additionalProperties'] !== undefined) {
        if (typeof raw['additionalProperties'] === 'boolean') {
          additionalProperties = raw['additionalProperties'];
        } else {
          additionalProperties = parseTypeDefinition(
            raw['additionalProperties'],
            allowComponentTypes,
            `${ctx}.additionalProperties`,
            refsToVerify,
          );
        }
      }
      const atLeastOneOf = parseAtLeastOneOf(raw['atLeastOneOf'], declaredNames, ctx);
      let def: Readonly<Record<string, unknown>> | undefined;
      if (raw['default'] !== undefined) {
        if (!isPlainObject(raw['default'])) {
          throw new A2uiCatalogError(`${ctx}.default must be an object.`);
        }
        def = raw['default'];
      }
      return {
        type: 'object',
        ...(dynamic !== undefined ? {dynamic} : {}),
        ...(properties !== undefined ? {properties} : {}),
        ...(additionalProperties !== undefined ? {additionalProperties} : {}),
        ...(atLeastOneOf !== undefined ? {atLeastOneOf} : {}),
        ...(def !== undefined ? {default: def} : {}),
        ...meta,
      } as TypeDefinition;
    }
    case 'array': {
      const items =
        raw['items'] !== undefined
          ? parseTypeDefinition(raw['items'], allowComponentTypes, `${ctx}.items`, refsToVerify)
          : undefined;
      const minItems =
        raw['minItems'] !== undefined
          ? assertNonNegativeInteger(raw['minItems'], `${ctx}.minItems`)
          : undefined;
      const maxItems =
        raw['maxItems'] !== undefined
          ? assertNonNegativeInteger(raw['maxItems'], `${ctx}.maxItems`)
          : undefined;
      const uniqueItems = parseOptionalBoolean(raw, 'uniqueItems', ctx);
      let def: readonly unknown[] | undefined;
      if (raw['default'] !== undefined) {
        if (!Array.isArray(raw['default'])) {
          throw new A2uiCatalogError(`${ctx}.default must be an array.`);
        }
        def = [...raw['default']];
      }
      return {
        type: 'array',
        ...(dynamic !== undefined ? {dynamic} : {}),
        ...(items !== undefined ? {items} : {}),
        ...(minItems !== undefined ? {minItems} : {}),
        ...(maxItems !== undefined ? {maxItems} : {}),
        ...(uniqueItems !== undefined ? {uniqueItems} : {}),
        ...(def !== undefined ? {default: def} : {}),
        ...meta,
      } as TypeDefinition;
    }
    case 'union': {
      const rawVariants = raw['variants'];
      if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
        throw new A2uiCatalogError(`${ctx}.variants must be a non-empty array.`);
      }
      const variants = rawVariants.map((variant, i) =>
        parseTypeDefinition(variant, allowComponentTypes, `${ctx}.variants[${i}]`, refsToVerify),
      );
      const exclusive = parseOptionalBoolean(raw, 'exclusive', ctx);
      const hasDefault = Object.hasOwn(raw, 'default') && raw['default'] !== undefined;
      return {
        type: 'union',
        variants,
        ...(exclusive !== undefined ? {exclusive} : {}),
        ...(dynamic !== undefined ? {dynamic} : {}),
        ...(hasDefault ? {default: raw['default']} : {}),
        ...meta,
      } as TypeDefinition;
    }
    case 'dataBinding':
      return {type: 'dataBinding', ...meta};
    case 'functionCall':
      return {type: 'functionCall', ...meta};
    case 'ref': {
      const refName = raw['ref'];
      if (typeof refName !== 'string' || !isValidUax31Identifier(refName)) {
        throw new A2uiCatalogError(
          `${ctx}.ref '${String(refName)}' must be a valid UAX #31 identifier.`,
        );
      }
      refsToVerify.push({ref: refName, ctx});
      const hasDefault = Object.hasOwn(raw, 'default') && raw['default'] !== undefined;
      return {
        type: 'ref',
        ref: refName,
        ...(hasDefault ? {default: raw['default']} : {}),
        ...meta,
      };
    }
    default:
      throw new A2uiCatalogError(`${ctx}: unsupported type '${type}'.`);
  }
}

function parseParameterList(
  rawList: readonly unknown[],
  allowComponentTypes: boolean,
  forbidEnvelopeKeys: boolean,
  ctx: string,
  refsToVerify: Array<{ref: string; ctx: string}>,
): ComponentParameterDefinition[] {
  const seen = new Set<string>();
  const out: ComponentParameterDefinition[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    const itemCtx = `${ctx}[${i}]`;
    if (!isPlainObject(item)) {
      throw new A2uiCatalogError(`${itemCtx} must be an object.`);
    }
    const name = item['name'];
    if (typeof name !== 'string' || !name) {
      throw new A2uiCatalogError(`${itemCtx}.name must be a non-empty string.`);
    }
    if (forbidEnvelopeKeys && FORBIDDEN_COMPONENT_PARAM_NAMES.has(name)) {
      throw new A2uiCatalogError(
        `${itemCtx}: parameter name '${name}' is a reserved protocol envelope key and must not be declared.`,
      );
    }
    assertUax31Identifier(name, `parameter identifier '${name}' at ${itemCtx}`);
    if (seen.has(name)) {
      throw new A2uiCatalogError(`${ctx} contains duplicate parameter name '${name}'.`);
    }
    seen.add(name);
    const required = parseOptionalBoolean(item, 'required', itemCtx);
    const typeDef = parseTypeDefinition(item, allowComponentTypes, itemCtx, refsToVerify);
    out.push({
      name,
      ...(required !== undefined ? {required} : {}),
      ...typeDef,
    });
  }
  return out;
}

function parseFunctionReturnType(
  raw: unknown,
  ctx: string,
  refsToVerify: Array<{ref: string; ctx: string}>,
): FunctionReturnDefinition {
  if (typeof raw === 'string') {
    if (!FUNCTION_RETURN_SHORTHANDS.has(raw)) {
      throw new A2uiCatalogError(
        `${ctx}.returnType '${raw}' is not a valid return type shorthand.`,
      );
    }
    return raw as FunctionReturnShorthand;
  }
  if (!isPlainObject(raw)) {
    throw new A2uiCatalogError(`${ctx}.returnType must be a shorthand string or type object.`);
  }
  const type = raw['type'];
  if (type === 'void' || type === 'validationResult') {
    const description = parseOptionalString(raw, 'description', `${ctx}.returnType`);
    return {type, ...(description !== undefined ? {description} : {})};
  }
  return parseTypeDefinition(raw, false, `${ctx}.returnType`, refsToVerify) as DataTypeDefinition;
}

function parseComponentDefinition(
  raw: unknown,
  ctx: string,
  refsToVerify: Array<{ref: string; ctx: string}>,
): ComponentDefinition {
  if (!isPlainObject(raw)) {
    throw new A2uiCatalogError(`${ctx} must be an object.`);
  }
  const name = raw['name'];
  if (typeof name !== 'string' || !name) {
    throw new A2uiCatalogError(`${ctx}.name must be a non-empty string.`);
  }
  if (name === 'Surface') {
    throw new A2uiCatalogError(
      `${ctx}: component name 'Surface' is reserved and cannot be declared in a catalog.`,
    );
  }
  assertUax31Identifier(name, `component identifier '${name}' at ${ctx}`);
  const description = parseOptionalString(raw, 'description', ctx);
  const checkable = parseOptionalBoolean(raw, 'checkable', ctx);
  let parameters: ComponentParameterDefinition[] | undefined;
  const declaredNames = new Set<string>();
  if (raw['parameters'] !== undefined) {
    if (!Array.isArray(raw['parameters'])) {
      throw new A2uiCatalogError(`${ctx}.parameters must be an array.`);
    }
    parameters = parseParameterList(
      raw['parameters'],
      true,
      true,
      `${ctx}.parameters`,
      refsToVerify,
    );
    for (const p of parameters) {
      declaredNames.add(p.name);
    }
  }
  const atLeastOneOf = parseAtLeastOneOf(raw['atLeastOneOf'], declaredNames, ctx);
  const allowedParents = parseUniqueStringList(raw, 'allowedParents', ctx);
  const allowedChildren = parseUniqueStringList(raw, 'allowedChildren', ctx);
  const metadata = parseOptionalMetadata(raw, ctx);
  const deprecated = parseOptionalBoolean(raw, 'deprecated', ctx);
  const deprecatedReason = parseOptionalString(raw, 'deprecatedReason', ctx);
  return {
    name,
    ...(description !== undefined ? {description} : {}),
    ...(checkable !== undefined ? {checkable} : {}),
    ...(parameters !== undefined ? {parameters} : {}),
    ...(atLeastOneOf !== undefined ? {atLeastOneOf} : {}),
    ...(allowedParents !== undefined ? {allowedParents} : {}),
    ...(allowedChildren !== undefined ? {allowedChildren} : {}),
    ...(metadata !== undefined ? {metadata} : {}),
    ...(deprecated !== undefined ? {deprecated} : {}),
    ...(deprecatedReason !== undefined ? {deprecatedReason} : {}),
  };
}

function parseFunctionDefinition(
  raw: unknown,
  ctx: string,
  refsToVerify: Array<{ref: string; ctx: string}>,
): FunctionDefinition {
  if (!isPlainObject(raw)) {
    throw new A2uiCatalogError(`${ctx} must be an object.`);
  }
  const name = raw['name'];
  if (typeof name !== 'string' || !name) {
    throw new A2uiCatalogError(`${ctx}.name must be a non-empty string.`);
  }
  if (name.startsWith('@')) {
    throw new A2uiCatalogError(
      `${ctx}: function name '${name}' cannot start with '@' (reserved for system functions).`,
    );
  }
  assertUax31Identifier(name, `function identifier '${name}' at ${ctx}`);
  if (!Object.hasOwn(raw, 'returnType') || raw['returnType'] === undefined) {
    throw new A2uiCatalogError(`${ctx}.returnType is required.`);
  }
  const returnType = parseFunctionReturnType(raw['returnType'], ctx, refsToVerify);
  const description = parseOptionalString(raw, 'description', ctx);
  const allowedCallersRaw = raw['allowedCallers'];
  let allowedCallers: AllowedCallers | undefined;
  if (allowedCallersRaw !== undefined) {
    if (typeof allowedCallersRaw !== 'string' || !ALLOWED_CALLERS_SET.has(allowedCallersRaw)) {
      throw new A2uiCatalogError(
        `${ctx}.allowedCallers must be 'rendererOnly', 'agentOnly', or 'rendererOrAgent'.`,
      );
    }
    allowedCallers = allowedCallersRaw as AllowedCallers;
  }
  const requiresUserActivation = parseOptionalBoolean(raw, 'requiresUserActivation', ctx);
  if (
    requiresUserActivation === true &&
    allowedCallers !== undefined &&
    allowedCallers !== 'rendererOnly'
  ) {
    throw new A2uiCatalogError(
      `${ctx}: requiresUserActivation=true requires allowedCallers to be 'rendererOnly', got '${allowedCallers}'.`,
    );
  }
  let parameters: DataParameterDefinition[] | undefined;
  const declaredNames = new Set<string>();
  if (raw['parameters'] !== undefined) {
    if (!Array.isArray(raw['parameters'])) {
      throw new A2uiCatalogError(`${ctx}.parameters must be an array.`);
    }
    parameters = parseParameterList(
      raw['parameters'],
      false,
      false,
      `${ctx}.parameters`,
      refsToVerify,
    ) as DataParameterDefinition[];
    for (const p of parameters) {
      declaredNames.add(p.name);
    }
  }
  const atLeastOneOf = parseAtLeastOneOf(raw['atLeastOneOf'], declaredNames, ctx);
  let additionalParameters: boolean | DataTypeDefinition | undefined;
  if (raw['additionalParameters'] !== undefined) {
    if (typeof raw['additionalParameters'] === 'boolean') {
      additionalParameters = raw['additionalParameters'];
    } else {
      additionalParameters = parseTypeDefinition(
        raw['additionalParameters'],
        false,
        `${ctx}.additionalParameters`,
        refsToVerify,
      ) as DataTypeDefinition;
    }
  }
  const deprecated = parseOptionalBoolean(raw, 'deprecated', ctx);
  const deprecatedReason = parseOptionalString(raw, 'deprecatedReason', ctx);
  return {
    name,
    ...(description !== undefined ? {description} : {}),
    returnType,
    ...(allowedCallers !== undefined ? {allowedCallers} : {}),
    ...(requiresUserActivation !== undefined ? {requiresUserActivation} : {}),
    ...(parameters !== undefined ? {parameters} : {}),
    ...(atLeastOneOf !== undefined ? {atLeastOneOf} : {}),
    ...(additionalParameters !== undefined ? {additionalParameters} : {}),
    ...(deprecated !== undefined ? {deprecated} : {}),
    ...(deprecatedReason !== undefined ? {deprecatedReason} : {}),
  };
}

function parseSurfaceProperties(
  raw: unknown,
  ctx: string,
  refsToVerify: Array<{ref: string; ctx: string}>,
): SurfacePropertiesDefinition {
  if (!isPlainObject(raw)) {
    throw new A2uiCatalogError(`${ctx} must be an object.`);
  }
  const description = parseOptionalString(raw, 'description', ctx);
  let properties: DataParameterDefinition[] | undefined;
  if (raw['properties'] !== undefined) {
    if (!Array.isArray(raw['properties'])) {
      throw new A2uiCatalogError(`${ctx}.properties must be an array.`);
    }
    properties = parseParameterList(
      raw['properties'],
      false,
      false,
      `${ctx}.properties`,
      refsToVerify,
    ) as DataParameterDefinition[];
  }
  let additionalProperties: boolean | DataTypeDefinition | undefined;
  if (raw['additionalProperties'] !== undefined) {
    if (typeof raw['additionalProperties'] === 'boolean') {
      additionalProperties = raw['additionalProperties'];
    } else {
      additionalProperties = parseTypeDefinition(
        raw['additionalProperties'],
        false,
        `${ctx}.additionalProperties`,
        refsToVerify,
      ) as DataTypeDefinition;
    }
  }
  return {
    ...(description !== undefined ? {description} : {}),
    ...(properties !== undefined ? {properties} : {}),
    ...(additionalProperties !== undefined ? {additionalProperties} : {}),
  };
}

/**
 * Returns `true` iff `raw` is a JSON object carrying a string `formatVersion`
 * discriminator (identifying the decoupled Catalog Document format rather than
 * a legacy JSON Schema catalog document).
 */
export function isCatalogDocument(raw: unknown): raw is Record<string, unknown> {
  return isPlainObject(raw) && typeof raw['formatVersion'] === 'string';
}

/** Optional overrides applied when loading a Catalog Document. */
export interface ParseCatalogDocumentOptions {
  /** Overrides the document's `protocolVersion`. */
  readonly protocolVersion?: string;
  /** Overrides the document's `catalogId`. */
  readonly catalogId?: string;
}

/**
 * Parses and validates a serialized Catalog Document (`formatVersion: "1.0"`)
 * into an immutable {@link CatalogModel}.
 *
 * Enforces `formatVersion === "1.0"`, UAX #31 identifiers, the `"Surface"`
 * component ban, `requiresUserActivation` vs `allowedCallers`, unique names,
 * and local `ref` resolution against `types`.
 *
 * @throws {A2uiCatalogError} If any structural or semantic invariant is violated.
 */
export function parseCatalogDocument(
  raw: unknown,
  options?: ParseCatalogDocumentOptions,
): CatalogModel {
  if (!isPlainObject(raw)) {
    throw new A2uiCatalogError('Catalog document must be a JSON object.');
  }
  const formatVersion = raw['formatVersion'];
  if (formatVersion !== CATALOG_DOCUMENT_FORMAT_VERSION) {
    throw new A2uiCatalogError(
      `Unsupported catalog document formatVersion '${String(formatVersion)}'; expected '${CATALOG_DOCUMENT_FORMAT_VERSION}'.`,
    );
  }
  const catalogId = options?.catalogId ?? raw['catalogId'];
  if (typeof catalogId !== 'string' || catalogId.length === 0) {
    throw new A2uiCatalogError('Catalog document requires a non-empty string catalogId.');
  }

  const schema = parseOptionalString(raw, '$schema', 'catalog');
  const protocolVersion =
    options?.protocolVersion ?? parseOptionalString(raw, 'protocolVersion', 'catalog') ?? '1.0';
  const title = parseOptionalString(raw, 'title', 'catalog');
  const description = parseOptionalString(raw, 'description', 'catalog');
  const instructions = parseOptionalString(raw, 'instructions', 'catalog');
  const metadata = parseOptionalMetadata(raw, 'catalog');

  const refsToVerify: Array<{ref: string; ctx: string}> = [];

  let types: Record<string, DataTypeDefinition> | undefined;
  if (raw['types'] !== undefined) {
    if (!isPlainObject(raw['types'])) {
      throw new A2uiCatalogError('catalog.types must be an object.');
    }
    types = {};
    for (const [typeName, typeRaw] of Object.entries(raw['types'])) {
      assertUax31Identifier(typeName, `type identifier '${typeName}' in catalog.types`);
      types[typeName] = parseTypeDefinition(
        typeRaw,
        false,
        `catalog.types.${typeName}`,
        refsToVerify,
      ) as DataTypeDefinition;
    }
  }

  const surfaceProperties =
    raw['surfaceProperties'] !== undefined
      ? parseSurfaceProperties(raw['surfaceProperties'], 'catalog.surfaceProperties', refsToVerify)
      : undefined;

  let components: ComponentDefinition[] | undefined;
  if (raw['components'] !== undefined) {
    if (!Array.isArray(raw['components'])) {
      throw new A2uiCatalogError('catalog.components must be an array.');
    }
    const seenComponents = new Set<string>();
    components = raw['components'].map((compRaw, i) => {
      const parsed = parseComponentDefinition(compRaw, `catalog.components[${i}]`, refsToVerify);
      if (seenComponents.has(parsed.name)) {
        throw new A2uiCatalogError(`Duplicate component name '${parsed.name}' in catalog.`);
      }
      seenComponents.add(parsed.name);
      return parsed;
    });
  }

  let functions: FunctionDefinition[] | undefined;
  if (raw['functions'] !== undefined) {
    if (!Array.isArray(raw['functions'])) {
      throw new A2uiCatalogError('catalog.functions must be an array.');
    }
    const seenFunctions = new Set<string>();
    functions = raw['functions'].map((fnRaw, i) => {
      const parsed = parseFunctionDefinition(fnRaw, `catalog.functions[${i}]`, refsToVerify);
      if (seenFunctions.has(parsed.name)) {
        throw new A2uiCatalogError(`Duplicate function name '${parsed.name}' in catalog.`);
      }
      seenFunctions.add(parsed.name);
      return parsed;
    });
  }

  for (const {ref, ctx} of refsToVerify) {
    if (!types || !Object.hasOwn(types, ref)) {
      throw new A2uiCatalogError(
        `${ctx}: local type reference '${ref}' does not match any entry in catalog.types.`,
      );
    }
  }

  const model: CatalogModel = {
    ...(schema !== undefined ? {$schema: schema} : {}),
    formatVersion: CATALOG_DOCUMENT_FORMAT_VERSION,
    catalogId,
    protocolVersion,
    ...(title !== undefined ? {title} : {}),
    ...(description !== undefined ? {description} : {}),
    ...(instructions !== undefined ? {instructions} : {}),
    ...(metadata !== undefined ? {metadata} : {}),
    ...(types !== undefined ? {types} : {}),
    ...(surfaceProperties !== undefined ? {surfaceProperties} : {}),
    ...(components !== undefined ? {components} : {}),
    ...(functions !== undefined ? {functions} : {}),
  };

  return deepFreezeValue(model);
}

/** Validates a standalone {@link ComponentDefinition} for programmatic authoring. */
export function validateComponentDefinition(
  def: ComponentDefinition,
  types?: Readonly<Record<string, DataTypeDefinition>>,
): ComponentDefinition {
  const refsToVerify: Array<{ref: string; ctx: string}> = [];
  const parsed = parseComponentDefinition(def, `component '${def?.name ?? ''}'`, refsToVerify);
  if (types) {
    for (const {ref, ctx} of refsToVerify) {
      if (!Object.hasOwn(types, ref)) {
        throw new A2uiCatalogError(`${ctx}: local type reference '${ref}' not found in types.`);
      }
    }
  }
  return deepFreezeValue(parsed);
}

/** Validates a standalone {@link FunctionDefinition} for programmatic authoring. */
export function validateFunctionDefinition(
  def: FunctionDefinition,
  types?: Readonly<Record<string, DataTypeDefinition>>,
): FunctionDefinition {
  const refsToVerify: Array<{ref: string; ctx: string}> = [];
  const parsed = parseFunctionDefinition(def, `function '${def?.name ?? ''}'`, refsToVerify);
  if (types) {
    for (const {ref, ctx} of refsToVerify) {
      if (!Object.hasOwn(types, ref)) {
        throw new A2uiCatalogError(`${ctx}: local type reference '${ref}' not found in types.`);
      }
    }
  }
  return deepFreezeValue(parsed);
}

function serializeTypeDefinition(typeDef: TypeDefinition, ctx: string): Record<string, unknown> {
  if (typeDef.type === 'rawJsonSchema') {
    throw new A2uiCatalogError(
      `${ctx}: cannot serialize in-memory 'rawJsonSchema' escape hatch to a Catalog Document.`,
    );
  }
  // Quoted wire keys survive Closure Compiler property renaming.
  const out: Record<string, unknown> = {'type': typeDef.type};
  if (typeDef.description !== undefined) out['description'] = typeDef.description;
  if (typeDef.deprecated !== undefined) out['deprecated'] = typeDef.deprecated;
  if (typeDef.deprecatedReason !== undefined) out['deprecatedReason'] = typeDef.deprecatedReason;

  switch (typeDef.type) {
    case 'string':
      if (typeDef.dynamic) out['dynamic'] = true;
      if (typeDef.format !== undefined) {
        out['format'] = Array.isArray(typeDef.format) ? [...typeDef.format] : typeDef.format;
      }
      if (typeDef.pattern !== undefined) out['pattern'] = typeDef.pattern;
      if (typeDef.minLength !== undefined) out['minLength'] = typeDef.minLength;
      if (typeDef.maxLength !== undefined) out['maxLength'] = typeDef.maxLength;
      if (typeDef.default !== undefined) out['default'] = typeDef.default;
      break;
    case 'number':
    case 'integer':
      if (typeDef.dynamic) out['dynamic'] = true;
      if (typeDef.min !== undefined) out['min'] = typeDef.min;
      if (typeDef.max !== undefined) out['max'] = typeDef.max;
      if (typeDef.default !== undefined) out['default'] = typeDef.default;
      break;
    case 'boolean':
      if (typeDef.dynamic) out['dynamic'] = true;
      if (typeDef.default !== undefined) out['default'] = typeDef.default;
      break;
    case 'enum':
      out['values'] = [...typeDef.values];
      if (typeDef.valueType !== undefined) out['valueType'] = typeDef.valueType;
      if (typeDef.dynamic) out['dynamic'] = true;
      if (typeDef.default !== undefined) out['default'] = typeDef.default;
      break;
    case 'const':
      out['value'] = typeDef.value;
      break;
    case 'any':
      if (typeDef.dynamic !== undefined) out['dynamic'] = typeDef.dynamic;
      if (typeDef.nullable !== undefined) out['nullable'] = typeDef.nullable;
      if (typeDef.default !== undefined) out['default'] = typeDef.default;
      break;
    case 'object':
      if (typeDef.dynamic) out['dynamic'] = true;
      if (typeDef.properties !== undefined) {
        out['properties'] = typeDef.properties.map((p, i) =>
          serializeParameter(p, `${ctx}.properties[${i}]`),
        );
      }
      if (typeDef.additionalProperties !== undefined) {
        out['additionalProperties'] =
          typeof typeDef.additionalProperties === 'boolean'
            ? typeDef.additionalProperties
            : serializeTypeDefinition(typeDef.additionalProperties, `${ctx}.additionalProperties`);
      }
      if (typeDef.atLeastOneOf !== undefined) {
        out['atLeastOneOf'] = typeDef.atLeastOneOf.map(g => [...g]);
      }
      if (typeDef.default !== undefined) {
        out['default'] = JSON.parse(JSON.stringify(typeDef.default)) as Record<string, unknown>;
      }
      break;
    case 'array':
      if (typeDef.dynamic) out['dynamic'] = true;
      if (typeDef.items !== undefined) {
        out['items'] = serializeTypeDefinition(typeDef.items, `${ctx}.items`);
      }
      if (typeDef.minItems !== undefined) out['minItems'] = typeDef.minItems;
      if (typeDef.maxItems !== undefined) out['maxItems'] = typeDef.maxItems;
      if (typeDef.uniqueItems !== undefined) out['uniqueItems'] = typeDef.uniqueItems;
      if (typeDef.default !== undefined) {
        out['default'] = JSON.parse(JSON.stringify(typeDef.default)) as unknown[];
      }
      break;
    case 'union':
      out['variants'] = typeDef.variants.map((v, i) =>
        serializeTypeDefinition(v, `${ctx}.variants[${i}]`),
      );
      if (typeDef.exclusive !== undefined) out['exclusive'] = typeDef.exclusive;
      if (typeDef.dynamic) out['dynamic'] = true;
      if (typeDef.default !== undefined) {
        out['default'] = JSON.parse(JSON.stringify(typeDef.default));
      }
      break;
    case 'ref':
      out['ref'] = typeDef.ref;
      if (typeDef.default !== undefined) {
        out['default'] = JSON.parse(JSON.stringify(typeDef.default));
      }
      break;
    case 'dataBinding':
    case 'functionCall':
    case 'child':
    case 'childList':
    case 'action':
    case 'checkRule':
    case 'accessibility':
      break;
  }
  return out;
}

function serializeParameter(param: ParameterDefinition, ctx: string): Record<string, unknown> {
  const typeObj = serializeTypeDefinition(param, ctx);
  const out: Record<string, unknown> = {'name': param.name};
  if (param.required) out['required'] = true;
  Object.assign(out, typeObj);
  return out;
}

function serializeReturnType(
  returnType: FunctionReturnDefinition,
  ctx: string,
): string | Record<string, unknown> {
  if (typeof returnType === 'string') {
    return returnType;
  }
  if (returnType.type === 'void' || returnType.type === 'validationResult') {
    const out: Record<string, unknown> = {'type': returnType.type};
    if (returnType.description !== undefined) out['description'] = returnType.description;
    return out;
  }
  return serializeTypeDefinition(returnType, ctx);
}

/**
 * Serializes a {@link CatalogModel} into a plain JSON Catalog Document object
 * (`formatVersion: "1.0"`).
 *
 * @throws {A2uiCatalogError} If the model contains an in-memory `rawJsonSchema` node.
 */
export function serializeCatalogDocument(model: CatalogModel): Record<string, unknown> {
  // Quoted keys to prevent property renaming during Closure Compiler minification.
  const out: Record<string, unknown> = {};
  if (model.$schema !== undefined) out['$schema'] = model.$schema;
  out['formatVersion'] = model.formatVersion ?? CATALOG_DOCUMENT_FORMAT_VERSION;
  out['catalogId'] = model.catalogId;
  if (model.protocolVersion !== undefined) out['protocolVersion'] = model.protocolVersion;
  if (model.title !== undefined) out['title'] = model.title;
  if (model.description !== undefined) out['description'] = model.description;
  if (model.instructions !== undefined) out['instructions'] = model.instructions;
  if (model.metadata !== undefined) {
    out['metadata'] = JSON.parse(JSON.stringify(model.metadata));
  }
  if (model.types !== undefined && Object.keys(model.types).length > 0) {
    const typesObj: Record<string, unknown> = {};
    for (const [name, typeDef] of Object.entries(model.types)) {
      typesObj[name] = serializeTypeDefinition(typeDef, `types.${name}`);
    }
    out['types'] = typesObj;
  }
  if (model.surfaceProperties !== undefined) {
    const sp: Record<string, unknown> = {};
    if (model.surfaceProperties.description !== undefined) {
      sp['description'] = model.surfaceProperties.description;
    }
    if (model.surfaceProperties.properties !== undefined) {
      sp['properties'] = model.surfaceProperties.properties.map((p, i) =>
        serializeParameter(p, `surfaceProperties.properties[${i}]`),
      );
    }
    if (model.surfaceProperties.additionalProperties !== undefined) {
      sp['additionalProperties'] =
        typeof model.surfaceProperties.additionalProperties === 'boolean'
          ? model.surfaceProperties.additionalProperties
          : serializeTypeDefinition(
              model.surfaceProperties.additionalProperties,
              'surfaceProperties.additionalProperties',
            );
    }
    out['surfaceProperties'] = sp;
  }
  if (model.components !== undefined && model.components.length > 0) {
    out['components'] = model.components.map((comp, i) => {
      const c: Record<string, unknown> = {'name': comp.name};
      if (comp.description !== undefined) c['description'] = comp.description;
      if (comp.checkable) c['checkable'] = true;
      if (comp.parameters !== undefined && comp.parameters.length > 0) {
        c['parameters'] = comp.parameters.map((p, j) =>
          serializeParameter(p, `components[${i}].parameters[${j}]`),
        );
      }
      if (comp.atLeastOneOf !== undefined && comp.atLeastOneOf.length > 0) {
        c['atLeastOneOf'] = comp.atLeastOneOf.map(g => [...g]);
      }
      if (comp.allowedParents !== undefined) c['allowedParents'] = [...comp.allowedParents];
      if (comp.allowedChildren !== undefined) c['allowedChildren'] = [...comp.allowedChildren];
      if (comp.metadata !== undefined) {
        c['metadata'] = JSON.parse(JSON.stringify(comp.metadata));
      }
      if (comp.deprecated !== undefined) c['deprecated'] = comp.deprecated;
      if (comp.deprecatedReason !== undefined) c['deprecatedReason'] = comp.deprecatedReason;
      return c;
    });
  }
  if (model.functions !== undefined && model.functions.length > 0) {
    out['functions'] = model.functions.map((fn, i) => {
      const f: Record<string, unknown> = {'name': fn.name};
      if (fn.description !== undefined) f['description'] = fn.description;
      f['returnType'] = serializeReturnType(fn.returnType, `functions[${i}].returnType`);
      if (fn.allowedCallers !== undefined) f['allowedCallers'] = fn.allowedCallers;
      if (fn.requiresUserActivation) f['requiresUserActivation'] = true;
      if (fn.parameters !== undefined && fn.parameters.length > 0) {
        f['parameters'] = fn.parameters.map((p, j) =>
          serializeParameter(p, `functions[${i}].parameters[${j}]`),
        );
      }
      if (fn.atLeastOneOf !== undefined && fn.atLeastOneOf.length > 0) {
        f['atLeastOneOf'] = fn.atLeastOneOf.map(g => [...g]);
      }
      if (fn.additionalParameters !== undefined) {
        f['additionalParameters'] =
          typeof fn.additionalParameters === 'boolean'
            ? fn.additionalParameters
            : serializeTypeDefinition(
                fn.additionalParameters,
                `functions[${i}].additionalParameters`,
              );
      }
      if (fn.deprecated !== undefined) f['deprecated'] = fn.deprecated;
      if (fn.deprecatedReason !== undefined) f['deprecatedReason'] = fn.deprecatedReason;
      return f;
    });
  }
  return out;
}
