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

import type {A2uiMetadata} from '../../common/metadata.js';

/** Current Catalog Document format version discriminator. */
export const CATALOG_DOCUMENT_FORMAT_VERSION = '1.0' as const;

/** Catalog-level or component-level extension metadata. */
export type CatalogMetadata = A2uiMetadata;

/** Allowed caller contexts for a catalog function. */
export type AllowedCallers = 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';

/** Primitive value types allowed inside an `enum` definition. */
export type EnumPrimitiveValue = string | number | boolean;

/** Allowed `valueType` hints on an `enum` definition. */
export type EnumValueType = 'string' | 'number' | 'boolean';

/** Common documentation and deprecation metadata carried by every `TypeDefinition`. */
export interface TypeMeta {
  readonly description?: string;
  readonly deprecated?: boolean;
  readonly deprecatedReason?: string;
}

/** String value type, optionally supporting dynamic data bindings and function calls. */
export interface StringTypeDefinition extends TypeMeta {
  readonly type: 'string';
  readonly dynamic?: boolean;
  readonly format?: string | readonly string[];
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly default?: string;
}

/** Floating-point number type, optionally dynamic. */
export interface NumberTypeDefinition extends TypeMeta {
  readonly type: 'number';
  readonly dynamic?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly default?: number;
}

/** Integer number type, optionally dynamic. */
export interface IntegerTypeDefinition extends TypeMeta {
  readonly type: 'integer';
  readonly dynamic?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly default?: number;
}

/** Boolean type, optionally dynamic (accepting ValidationResult coercion in v1.0). */
export interface BooleanTypeDefinition extends TypeMeta {
  readonly type: 'boolean';
  readonly dynamic?: boolean;
  readonly default?: boolean;
}

/** Enumerated set of literal values, optionally dynamic. */
export interface EnumTypeDefinition extends TypeMeta {
  readonly type: 'enum';
  readonly values: readonly EnumPrimitiveValue[];
  readonly valueType?: EnumValueType;
  readonly dynamic?: boolean;
  readonly default?: EnumPrimitiveValue;
}

/** Single constant literal value. */
export interface ConstTypeDefinition extends TypeMeta {
  readonly type: 'const';
  readonly value: string | number | boolean | null;
}

/**
 * Unconstrained or dynamic value type.
 *
 * - `dynamic: true, nullable: false` corresponds to v1.0 `DynamicValue`.
 * - `dynamic: true, nullable: true` corresponds to an unconstrained `{}` schema.
 */
export interface AnyTypeDefinition extends TypeMeta {
  readonly type: 'any';
  readonly dynamic?: boolean;
  readonly nullable?: boolean;
  readonly default?: unknown;
}

/** Explicit data-binding reference (`{@path}` / `{path}`). */
export interface DataBindingTypeDefinition extends TypeMeta {
  readonly type: 'dataBinding';
}

/** Explicit function call object (`{@call}` / `{call}`). */
export interface FunctionCallTypeDefinition extends TypeMeta {
  readonly type: 'functionCall';
}

/** Catalog-local reference to a named entry in `CatalogModel.types`. */
export interface RefTypeDefinition extends TypeMeta {
  readonly type: 'ref';
  readonly ref: string;
  readonly default?: unknown;
}

/** Single child component reference (`Child` in v1.0, `ComponentId` in v0.9). */
export interface ChildTypeDefinition extends TypeMeta {
  readonly type: 'child';
}

/** Static list of child IDs or dynamic template object (`ChildList`). */
export interface ChildListTypeDefinition extends TypeMeta {
  readonly type: 'childList';
}

/** User interaction handler (`Action`: event or functionCall). */
export interface ActionTypeDefinition extends TypeMeta {
  readonly type: 'action';
}

/** Single validation check rule (`CheckRule`). */
export interface CheckRuleTypeDefinition extends TypeMeta {
  readonly type: 'checkRule';
}

/** Accessibility attributes object (`AccessibilityAttributes`). */
export interface AccessibilityTypeDefinition extends TypeMeta {
  readonly type: 'accessibility';
}

/**
 * In-memory-only legacy escape hatch holding an untranslatable JSON Schema
 * fragment (e.g. `patternProperties`, arbitrary `not`).
 *
 * Never emitted in serialized Catalog Documents.
 */
export interface RawJsonSchemaTypeDefinition extends TypeMeta {
  readonly type: 'rawJsonSchema';
  readonly schema: Readonly<Record<string, unknown>>;
}

/** Structured object type restricted to data parameters. */
export interface DataObjectTypeDefinition extends TypeMeta {
  readonly type: 'object';
  readonly dynamic?: boolean;
  readonly properties?: readonly DataParameterDefinition[];
  readonly additionalProperties?: boolean | DataTypeDefinition;
  readonly atLeastOneOf?: readonly (readonly string[])[];
  readonly default?: Readonly<Record<string, unknown>>;
}

/** Array type restricted to data elements. */
export interface DataArrayTypeDefinition extends TypeMeta {
  readonly type: 'array';
  readonly dynamic?: boolean;
  readonly items?: DataTypeDefinition;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly default?: readonly unknown[];
}

/** Union type restricted to data variants. */
export interface DataUnionTypeDefinition extends TypeMeta {
  readonly type: 'union';
  readonly variants: readonly DataTypeDefinition[];
  readonly exclusive?: boolean;
  readonly dynamic?: boolean;
  readonly default?: unknown;
}

/** Structured object type allowed in component parameters (may nest component-only types). */
export interface ComponentObjectTypeDefinition extends TypeMeta {
  readonly type: 'object';
  readonly dynamic?: boolean;
  readonly properties?: readonly ComponentParameterDefinition[];
  readonly additionalProperties?: boolean | TypeDefinition;
  readonly atLeastOneOf?: readonly (readonly string[])[];
  readonly default?: Readonly<Record<string, unknown>>;
}

/** Array type allowed in component parameters (may nest component-only types). */
export interface ComponentArrayTypeDefinition extends TypeMeta {
  readonly type: 'array';
  readonly dynamic?: boolean;
  readonly items?: TypeDefinition;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly default?: readonly unknown[];
}

/** Union type allowed in component parameters (may nest component-only types). */
export interface ComponentUnionTypeDefinition extends TypeMeta {
  readonly type: 'union';
  readonly variants: readonly TypeDefinition[];
  readonly exclusive?: boolean;
  readonly dynamic?: boolean;
  readonly default?: unknown;
}

/** Alias covering either data or component object types. */
export type ObjectTypeDefinition = DataObjectTypeDefinition | ComponentObjectTypeDefinition;

/** Alias covering either data or component array types. */
export type ArrayTypeDefinition = DataArrayTypeDefinition | ComponentArrayTypeDefinition;

/** Alias covering either data or component union types. */
export type UnionTypeDefinition = DataUnionTypeDefinition | ComponentUnionTypeDefinition;

/** The 13 canonical data type variants plus the in-memory `rawJsonSchema` escape hatch. */
export type DataTypeDefinition =
  | StringTypeDefinition
  | NumberTypeDefinition
  | IntegerTypeDefinition
  | BooleanTypeDefinition
  | EnumTypeDefinition
  | ConstTypeDefinition
  | AnyTypeDefinition
  | DataObjectTypeDefinition
  | DataArrayTypeDefinition
  | DataUnionTypeDefinition
  | DataBindingTypeDefinition
  | FunctionCallTypeDefinition
  | RefTypeDefinition
  | RawJsonSchemaTypeDefinition;

/** The 5 component-only type variants. */
export type ComponentOnlyTypeDefinition =
  | ChildTypeDefinition
  | ChildListTypeDefinition
  | ActionTypeDefinition
  | CheckRuleTypeDefinition
  | AccessibilityTypeDefinition;

/** The 18 canonical type variants plus the in-memory `rawJsonSchema` escape hatch. */
export type TypeDefinition =
  | StringTypeDefinition
  | NumberTypeDefinition
  | IntegerTypeDefinition
  | BooleanTypeDefinition
  | EnumTypeDefinition
  | ConstTypeDefinition
  | AnyTypeDefinition
  | ComponentObjectTypeDefinition
  | ComponentArrayTypeDefinition
  | ComponentUnionTypeDefinition
  | DataBindingTypeDefinition
  | FunctionCallTypeDefinition
  | RefTypeDefinition
  | ComponentOnlyTypeDefinition
  | RawJsonSchemaTypeDefinition;

/** Named parameter fields flattened onto a `TypeDefinition`. */
export interface ParameterMeta {
  readonly name: string;
  readonly required?: boolean;
}

/** Flattened named data parameter (used in functions, surfaceProperties, and data objects). */
export type DataParameterDefinition = DataTypeDefinition & ParameterMeta;

/** Flattened named component parameter (used in components and component objects). */
export type ComponentParameterDefinition = TypeDefinition & ParameterMeta;

/** Named parameter definition (component or data). */
export type ParameterDefinition = ComponentParameterDefinition;

/** Shorthand string forms for a function's return type. */
export type FunctionReturnShorthand =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'validationResult'
  | 'any'
  | 'void';

/** Explicit void return type object with optional description. */
export interface VoidReturnDefinition {
  readonly type: 'void';
  readonly description?: string;
}

/** Explicit validationResult return type object with optional description. */
export interface ValidationResultReturnDefinition {
  readonly type: 'validationResult';
  readonly description?: string;
}

/** Return type definition for a catalog function. */
export type FunctionReturnDefinition =
  | FunctionReturnShorthand
  | VoidReturnDefinition
  | ValidationResultReturnDefinition
  | DataTypeDefinition;

/** Canonical semantic definition of a catalog component. */
export interface ComponentDefinition {
  readonly name: string;
  readonly description?: string;
  readonly checkable?: boolean;
  readonly parameters?: readonly ComponentParameterDefinition[];
  readonly atLeastOneOf?: readonly (readonly string[])[];
  readonly allowedParents?: readonly string[];
  readonly allowedChildren?: readonly string[];
  readonly metadata?: CatalogMetadata;
  readonly deprecated?: boolean;
  readonly deprecatedReason?: string;
}

/** Canonical semantic definition of a catalog function. */
export interface FunctionDefinition {
  readonly name: string;
  readonly description?: string;
  readonly returnType: FunctionReturnDefinition;
  readonly allowedCallers?: AllowedCallers;
  readonly requiresUserActivation?: boolean;
  readonly parameters?: readonly DataParameterDefinition[];
  readonly atLeastOneOf?: readonly (readonly string[])[];
  readonly additionalParameters?: boolean | DataTypeDefinition;
  readonly deprecated?: boolean;
  readonly deprecatedReason?: string;
}

/** Canonical definition of customizable surface-level properties (v0.9 `theme`). */
export interface SurfacePropertiesDefinition {
  readonly description?: string;
  readonly properties?: readonly DataParameterDefinition[];
  readonly additionalProperties?: boolean | DataTypeDefinition;
}

/** Canonical immutable in-memory representation of an A2UI catalog. */
export interface CatalogModel {
  readonly $schema?: string;
  readonly formatVersion: typeof CATALOG_DOCUMENT_FORMAT_VERSION;
  readonly catalogId: string;
  readonly protocolVersion?: string;
  readonly title?: string;
  readonly description?: string;
  readonly instructions?: string;
  readonly metadata?: CatalogMetadata;
  readonly types?: Readonly<Record<string, DataTypeDefinition>>;
  readonly surfaceProperties?: SurfacePropertiesDefinition;
  readonly components?: readonly ComponentDefinition[];
  readonly functions?: readonly FunctionDefinition[];
}

/** Set of all 13 canonical data type discriminator strings. */
export const DATA_TYPE_KINDS: ReadonlySet<string> = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'enum',
  'const',
  'any',
  'object',
  'array',
  'union',
  'dataBinding',
  'functionCall',
  'ref',
]);

/** Set of all 5 component-only type discriminator strings. */
export const COMPONENT_ONLY_TYPE_KINDS: ReadonlySet<string> = new Set([
  'child',
  'childList',
  'action',
  'checkRule',
  'accessibility',
]);

/** Set of all 9 shorthand function return type strings. */
export const FUNCTION_RETURN_SHORTHANDS: ReadonlySet<string> = new Set<FunctionReturnShorthand>([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'validationResult',
  'any',
  'void',
]);

/** Protocol envelope keys forbidden as declared component parameter names. */
export const FORBIDDEN_COMPONENT_PARAM_NAMES: ReadonlySet<string> = new Set([
  'component',
  'id',
  '@catalogId',
  '@accessibility',
  '@metadata',
  '@checks',
]);

/**
 * Extracts the coarse protocol return type identifier string from a
 * {@link FunctionReturnDefinition} (e.g. `'string'`, `'boolean'`, `'validationResult'`, `'any'`).
 */
export function functionReturnTypeName(returnType: FunctionReturnDefinition): string {
  if (typeof returnType === 'string') {
    return returnType;
  }
  switch (returnType.type) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'array':
    case 'object':
    case 'validationResult':
    case 'any':
    case 'void':
      return returnType.type;
    case 'integer':
      return 'number';
    case 'enum':
      return returnType.valueType ?? 'any';
    case 'const':
      if (typeof returnType.value === 'string') return 'string';
      if (typeof returnType.value === 'number') return 'number';
      if (typeof returnType.value === 'boolean') return 'boolean';
      return 'any';
    default:
      return 'any';
  }
}

/** Type guard checking whether a value is a canonical {@link ComponentDefinition}. */
export function isComponentDefinition(value: unknown): value is ComponentDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj['name'] !== 'string' || !obj['name']) {
    return false;
  }
  // Distinguish from Zod schemas (`_def`), BehaviorNodes (`type`),
  // ComponentApi/FunctionApi wrappers (`schema`/`definition`), and FunctionDefinitions (`returnType`).
  if (
    '_def' in obj ||
    'safeParse' in obj ||
    'type' in obj ||
    'schema' in obj ||
    'definition' in obj ||
    'returnType' in obj
  ) {
    return false;
  }
  return (
    obj['parameters'] === undefined ||
    Array.isArray(obj['parameters']) ||
    typeof obj['checkable'] === 'boolean'
  );
}
