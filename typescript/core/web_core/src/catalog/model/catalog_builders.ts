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

import {
  parseCatalogDocument,
  validateComponentDefinition,
  validateFunctionDefinition,
} from './catalog_document.js';
import {
  CATALOG_DOCUMENT_FORMAT_VERSION,
  type AccessibilityTypeDefinition,
  type ActionTypeDefinition,
  type AnyTypeDefinition,
  type BooleanTypeDefinition,
  type CatalogModel,
  type CheckRuleTypeDefinition,
  type ChildListTypeDefinition,
  type ChildTypeDefinition,
  type ComponentArrayTypeDefinition,
  type ComponentDefinition,
  type ComponentObjectTypeDefinition,
  type ComponentParameterDefinition,
  type ComponentUnionTypeDefinition,
  type DataBindingTypeDefinition,
  type DataParameterDefinition,
  type DataTypeDefinition,
  type EnumPrimitiveValue,
  type EnumTypeDefinition,
  type FunctionCallTypeDefinition,
  type FunctionDefinition,
  type IntegerTypeDefinition,
  type NumberTypeDefinition,
  type RefTypeDefinition,
  type StringTypeDefinition,
  type SurfacePropertiesDefinition,
  type TypeDefinition,
  type TypeMeta,
} from './catalog_model.js';

/** Options for `defineParameter` / `a2uiType.param`. */
export interface ParameterOptions<Req extends boolean = false> {
  readonly required?: Req;
}

/**
 * Combines a parameter name, optional `required` flag, and a {@link TypeDefinition}
 * into a flattened parameter definition while preserving literal types.
 */
export function defineParameter<
  const Name extends string,
  const TypeDef extends TypeDefinition,
  const Req extends boolean = false,
>(
  name: Name,
  typeDef: TypeDef,
  options?: ParameterOptions<Req>,
): Readonly<
  {readonly name: Name} & (Req extends true
    ? {readonly required: true}
    : {readonly required?: false}) &
    TypeDef
> {
  return Object.freeze({
    name,
    ...(options?.required !== undefined ? {required: options.required} : {}),
    ...typeDef,
  }) as Readonly<
    {readonly name: Name} & (Req extends true
      ? {readonly required: true}
      : {readonly required?: false}) &
      TypeDef
  >;
}

/**
 * Strongly typed builder surface for canonical A2UI {@link TypeDefinition} nodes.
 *
 * Dedicated no-options overloads prevent TypeScript from widening `Opts` to the
 * option-constraint type under contextual typing (such as `Record<string, DataTypeDefinition>`).
 */
export interface A2uiTypeBuilders {
  /** Builds a `string` type definition. */
  string(): Readonly<{readonly type: 'string'}>;
  string<const Opts extends Omit<StringTypeDefinition, 'type'>>(
    options: Opts,
  ): Readonly<{readonly type: 'string'} & Opts>;

  /** Builds a `number` type definition. */
  number(): Readonly<{readonly type: 'number'}>;
  number<const Opts extends Omit<NumberTypeDefinition, 'type'>>(
    options: Opts,
  ): Readonly<{readonly type: 'number'} & Opts>;

  /** Builds an `integer` type definition. */
  integer(): Readonly<{readonly type: 'integer'}>;
  integer<const Opts extends Omit<IntegerTypeDefinition, 'type'>>(
    options: Opts,
  ): Readonly<{readonly type: 'integer'} & Opts>;

  /** Builds a `boolean` type definition. */
  boolean(): Readonly<{readonly type: 'boolean'}>;
  boolean<const Opts extends Omit<BooleanTypeDefinition, 'type'>>(
    options: Opts,
  ): Readonly<{readonly type: 'boolean'} & Opts>;

  /** Builds an `enum` type definition preserving literal allowed values. */
  enum<const Values extends readonly [EnumPrimitiveValue, ...EnumPrimitiveValue[]]>(
    values: Values,
  ): Readonly<{readonly type: 'enum'; readonly values: Values}>;
  enum<
    const Values extends readonly [EnumPrimitiveValue, ...EnumPrimitiveValue[]],
    const Opts extends Omit<EnumTypeDefinition, 'type' | 'values'>,
  >(
    values: Values,
    options: Opts,
  ): Readonly<{readonly type: 'enum'; readonly values: Values} & Opts>;

  /** Builds a `const` literal type definition. */
  const<const Val extends string | number | boolean | null>(
    value: Val,
  ): Readonly<{readonly type: 'const'; readonly value: Val}>;
  const<const Val extends string | number | boolean | null, const Opts extends TypeMeta>(
    value: Val,
    options: Opts,
  ): Readonly<{readonly type: 'const'; readonly value: Val} & Opts>;

  /** Builds an `any` type definition. */
  any(): Readonly<{readonly type: 'any'}>;
  any<const Opts extends Omit<AnyTypeDefinition, 'type'>>(
    options: Opts,
  ): Readonly<{readonly type: 'any'} & Opts>;

  /** Builds an `object` type definition. */
  object(): Readonly<{readonly type: 'object'}>;
  object<const Props extends readonly ComponentParameterDefinition[]>(
    properties: Props,
  ): Readonly<{readonly type: 'object'; readonly properties: Props}>;
  object<
    const Props extends readonly ComponentParameterDefinition[] | undefined,
    const Opts extends Omit<ComponentObjectTypeDefinition, 'type' | 'properties'>,
  >(
    properties: Props,
    options: Opts,
  ): Readonly<
    {readonly type: 'object'} & (Props extends readonly ComponentParameterDefinition[]
      ? {readonly properties: Props}
      : Record<never, never>) &
      Opts
  >;

  /** Builds an `array` type definition. */
  array(): Readonly<{readonly type: 'array'}>;
  array<const Items extends TypeDefinition>(
    items: Items,
  ): Readonly<{readonly type: 'array'; readonly items: Items}>;
  array<
    const Items extends TypeDefinition | undefined,
    const Opts extends Omit<ComponentArrayTypeDefinition, 'type' | 'items'>,
  >(
    items: Items,
    options: Opts,
  ): Readonly<
    {readonly type: 'array'} & (Items extends TypeDefinition
      ? {readonly items: Items}
      : Record<never, never>) &
      Opts
  >;

  /** Builds a `union` type definition (`exclusive` defaults to `true`). */
  union<const Variants extends readonly [TypeDefinition, ...TypeDefinition[]]>(
    variants: Variants,
  ): Readonly<{readonly type: 'union'; readonly variants: Variants}>;
  union<
    const Variants extends readonly [TypeDefinition, ...TypeDefinition[]],
    const Opts extends Omit<ComponentUnionTypeDefinition, 'type' | 'variants'>,
  >(
    variants: Variants,
    options: Opts,
  ): Readonly<{readonly type: 'union'; readonly variants: Variants} & Opts>;

  /** Builds a `dataBinding` type definition. */
  dataBinding(): Readonly<DataBindingTypeDefinition>;
  dataBinding<const Opts extends TypeMeta>(
    options: Opts,
  ): Readonly<DataBindingTypeDefinition & Opts>;

  /** Builds a `functionCall` type definition. */
  functionCall(): Readonly<FunctionCallTypeDefinition>;
  functionCall<const Opts extends TypeMeta>(
    options: Opts,
  ): Readonly<FunctionCallTypeDefinition & Opts>;

  /** Builds a catalog-local `ref` type definition referencing an entry in `CatalogModel.types`. */
  ref<const RefName extends string>(
    ref: RefName,
  ): Readonly<{readonly type: 'ref'; readonly ref: RefName}>;
  ref<const RefName extends string, const Opts extends Omit<RefTypeDefinition, 'type' | 'ref'>>(
    ref: RefName,
    options: Opts,
  ): Readonly<{readonly type: 'ref'; readonly ref: RefName} & Opts>;

  /** Builds a single-child component reference (`child`) type definition. */
  child(): Readonly<ChildTypeDefinition>;
  child<const Opts extends TypeMeta>(options: Opts): Readonly<ChildTypeDefinition & Opts>;

  /** Builds a child list / template (`childList`) type definition. */
  childList(): Readonly<ChildListTypeDefinition>;
  childList<const Opts extends TypeMeta>(options: Opts): Readonly<ChildListTypeDefinition & Opts>;

  /** Builds an interaction `action` type definition. */
  action(): Readonly<ActionTypeDefinition>;
  action<const Opts extends TypeMeta>(options: Opts): Readonly<ActionTypeDefinition & Opts>;

  /** Builds a `checkRule` type definition. */
  checkRule(): Readonly<CheckRuleTypeDefinition>;
  checkRule<const Opts extends TypeMeta>(options: Opts): Readonly<CheckRuleTypeDefinition & Opts>;

  /** Builds an `accessibility` attributes type definition. */
  accessibility(): Readonly<AccessibilityTypeDefinition>;
  accessibility<const Opts extends TypeMeta>(
    options: Opts,
  ): Readonly<AccessibilityTypeDefinition & Opts>;

  /** Combines a parameter name, optional `required` flag, and type definition. */
  readonly param: typeof defineParameter;
}

/**
 * Ergonomic zero-dependency builders for canonical A2UI {@link TypeDefinition} nodes.
 *
 * Uses TypeScript `const` type parameters so literal parameter names, `required`,
 * `dynamic`, enum `values`, `child`, `childList`, and `action` types survive
 * compile-time prop inference via `ResolveDefinitionProps`.
 */
export const a2uiType: A2uiTypeBuilders = Object.freeze({
  string(options?: Omit<StringTypeDefinition, 'type'>) {
    return Object.freeze({type: 'string' as const, ...(options ?? {})});
  },
  number(options?: Omit<NumberTypeDefinition, 'type'>) {
    return Object.freeze({type: 'number' as const, ...(options ?? {})});
  },
  integer(options?: Omit<IntegerTypeDefinition, 'type'>) {
    return Object.freeze({type: 'integer' as const, ...(options ?? {})});
  },
  boolean(options?: Omit<BooleanTypeDefinition, 'type'>) {
    return Object.freeze({type: 'boolean' as const, ...(options ?? {})});
  },
  enum(
    values: readonly [EnumPrimitiveValue, ...EnumPrimitiveValue[]],
    options?: Omit<EnumTypeDefinition, 'type' | 'values'>,
  ) {
    return Object.freeze({
      type: 'enum' as const,
      values: Object.freeze([...values]),
      ...(options ?? {}),
    });
  },
  const(value: string | number | boolean | null, options?: TypeMeta) {
    return Object.freeze({type: 'const' as const, value, ...(options ?? {})});
  },
  any(options?: Omit<AnyTypeDefinition, 'type'>) {
    return Object.freeze({type: 'any' as const, ...(options ?? {})});
  },
  object(
    properties?: readonly ComponentParameterDefinition[],
    options?: Omit<ComponentObjectTypeDefinition, 'type' | 'properties'>,
  ) {
    return Object.freeze({
      type: 'object' as const,
      ...(properties !== undefined ? {properties} : {}),
      ...(options ?? {}),
    });
  },
  array(items?: TypeDefinition, options?: Omit<ComponentArrayTypeDefinition, 'type' | 'items'>) {
    return Object.freeze({
      type: 'array' as const,
      ...(items !== undefined ? {items} : {}),
      ...(options ?? {}),
    });
  },
  union(
    variants: readonly [TypeDefinition, ...TypeDefinition[]],
    options?: Omit<ComponentUnionTypeDefinition, 'type' | 'variants'>,
  ) {
    return Object.freeze({
      type: 'union' as const,
      variants: Object.freeze([...variants]),
      ...(options ?? {}),
    });
  },
  dataBinding(options?: TypeMeta) {
    return Object.freeze({type: 'dataBinding' as const, ...(options ?? {})});
  },
  functionCall(options?: TypeMeta) {
    return Object.freeze({type: 'functionCall' as const, ...(options ?? {})});
  },
  ref(ref: string, options?: Omit<RefTypeDefinition, 'type' | 'ref'>) {
    return Object.freeze({type: 'ref' as const, ref, ...(options ?? {})});
  },
  child(options?: TypeMeta) {
    return Object.freeze({type: 'child' as const, ...(options ?? {})});
  },
  childList(options?: TypeMeta) {
    return Object.freeze({type: 'childList' as const, ...(options ?? {})});
  },
  action(options?: TypeMeta) {
    return Object.freeze({type: 'action' as const, ...(options ?? {})});
  },
  checkRule(options?: TypeMeta) {
    return Object.freeze({type: 'checkRule' as const, ...(options ?? {})});
  },
  accessibility(options?: TypeMeta) {
    return Object.freeze({type: 'accessibility' as const, ...(options ?? {})});
  },
  param: defineParameter,
}) as A2uiTypeBuilders;

/** Short alias for {@link a2uiType}. */
export const t = a2uiType;

/**
 * Defines and validates a canonical {@link ComponentDefinition} while preserving
 * all literal parameter names and types for compile-time prop inference.
 */
export function defineComponent<const Def extends ComponentDefinition>(def: Def): Def {
  validateComponentDefinition(def);
  return Object.freeze(def);
}

/**
 * Defines and validates a canonical {@link FunctionDefinition} while preserving
 * all literal parameter names and return type information.
 */
export function defineFunction<const Def extends FunctionDefinition>(def: Def): Def {
  validateFunctionDefinition(def);
  return Object.freeze(def);
}

/**
 * Defines a canonical {@link SurfacePropertiesDefinition} (surface-level theme/properties).
 */
export function defineSurfaceProperties<
  const Def extends {
    readonly description?: string;
    readonly properties?: readonly DataParameterDefinition[];
    readonly additionalProperties?: boolean | DataTypeDefinition;
  },
>(def: Def): Def & SurfacePropertiesDefinition {
  return Object.freeze(def) as Def & SurfacePropertiesDefinition;
}

/** Input shape accepted by {@link defineCatalog} (`formatVersion` defaults to `'1.0'`). */
export type CatalogModelInput = Omit<CatalogModel, 'formatVersion'> & {
  readonly formatVersion?: typeof CATALOG_DOCUMENT_FORMAT_VERSION;
};

/**
 * Defines, validates, and deeply freezes a canonical {@link CatalogModel}
 * without any schema-library dependency.
 */
export function defineCatalog<const Input extends CatalogModelInput>(model: Input): CatalogModel {
  return parseCatalogDocument({
    ...model,
    formatVersion: model.formatVersion ?? CATALOG_DOCUMENT_FORMAT_VERSION,
  });
}
