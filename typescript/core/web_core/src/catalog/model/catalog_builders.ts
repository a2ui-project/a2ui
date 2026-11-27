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
 * Ergonomic zero-dependency builders for canonical A2UI {@link TypeDefinition} nodes.
 *
 * Uses TypeScript `const` type parameters so literal parameter names, `required`,
 * `dynamic`, enum `values`, `child`, `childList`, and `action` types survive
 * compile-time prop inference via `ResolveDefinitionProps`.
 */
export const a2uiType = {
  /** Builds a `string` type definition. */
  string<const Opts extends Omit<StringTypeDefinition, 'type'> = Record<never, never>>(
    options?: Opts,
  ): Readonly<{readonly type: 'string'} & Opts> {
    return Object.freeze({type: 'string' as const, ...(options ?? ({} as Opts))});
  },

  /** Builds a `number` type definition. */
  number<const Opts extends Omit<NumberTypeDefinition, 'type'> = Record<never, never>>(
    options?: Opts,
  ): Readonly<{readonly type: 'number'} & Opts> {
    return Object.freeze({type: 'number' as const, ...(options ?? ({} as Opts))});
  },

  /** Builds an `integer` type definition. */
  integer<const Opts extends Omit<IntegerTypeDefinition, 'type'> = Record<never, never>>(
    options?: Opts,
  ): Readonly<{readonly type: 'integer'} & Opts> {
    return Object.freeze({type: 'integer' as const, ...(options ?? ({} as Opts))});
  },

  /** Builds a `boolean` type definition. */
  boolean<const Opts extends Omit<BooleanTypeDefinition, 'type'> = Record<never, never>>(
    options?: Opts,
  ): Readonly<{readonly type: 'boolean'} & Opts> {
    return Object.freeze({type: 'boolean' as const, ...(options ?? ({} as Opts))});
  },

  /** Builds an `enum` type definition preserving literal allowed values. */
  enum<
    const Values extends readonly [EnumPrimitiveValue, ...EnumPrimitiveValue[]],
    const Opts extends Omit<EnumTypeDefinition, 'type' | 'values'> = Record<never, never>,
  >(
    values: Values,
    options?: Opts,
  ): Readonly<{readonly type: 'enum'; readonly values: Values} & Opts> {
    return Object.freeze({
      type: 'enum' as const,
      values: Object.freeze([...values]) as unknown as Values,
      ...(options ?? ({} as Opts)),
    });
  },

  /** Builds a `const` literal type definition. */
  const<
    const Val extends string | number | boolean | null,
    const Opts extends TypeMeta = Record<never, never>,
  >(value: Val, options?: Opts): Readonly<{readonly type: 'const'; readonly value: Val} & Opts> {
    return Object.freeze({type: 'const' as const, value, ...(options ?? ({} as Opts))});
  },

  /** Builds an `any` type definition. */
  any<const Opts extends Omit<AnyTypeDefinition, 'type'> = Record<never, never>>(
    options?: Opts,
  ): Readonly<{readonly type: 'any'} & Opts> {
    return Object.freeze({type: 'any' as const, ...(options ?? ({} as Opts))});
  },

  /** Builds an `object` type definition. */
  object<
    const Props extends readonly ComponentParameterDefinition[] | undefined = undefined,
    const Opts extends Omit<ComponentObjectTypeDefinition, 'type' | 'properties'> = Record<
      never,
      never
    >,
  >(
    properties?: Props,
    options?: Opts,
  ): Readonly<
    {readonly type: 'object'} & (Props extends readonly ComponentParameterDefinition[]
      ? {readonly properties: Props}
      : Record<never, never>) &
      Opts
  > {
    return Object.freeze({
      type: 'object' as const,
      ...(properties !== undefined ? {properties} : {}),
      ...(options ?? ({} as Opts)),
    }) as Readonly<
      {readonly type: 'object'} & (Props extends readonly ComponentParameterDefinition[]
        ? {readonly properties: Props}
        : Record<never, never>) &
        Opts
    >;
  },

  /** Builds an `array` type definition. */
  array<
    const Items extends TypeDefinition | undefined = undefined,
    const Opts extends Omit<ComponentArrayTypeDefinition, 'type' | 'items'> = Record<never, never>,
  >(
    items?: Items,
    options?: Opts,
  ): Readonly<
    {readonly type: 'array'} & (Items extends TypeDefinition
      ? {readonly items: Items}
      : Record<never, never>) &
      Opts
  > {
    return Object.freeze({
      type: 'array' as const,
      ...(items !== undefined ? {items} : {}),
      ...(options ?? ({} as Opts)),
    }) as Readonly<
      {readonly type: 'array'} & (Items extends TypeDefinition
        ? {readonly items: Items}
        : Record<never, never>) &
        Opts
    >;
  },

  /** Builds a `union` type definition (`exclusive` defaults to `true`). */
  union<
    const Variants extends readonly [TypeDefinition, ...TypeDefinition[]],
    const Opts extends Omit<ComponentUnionTypeDefinition, 'type' | 'variants'> = Record<
      never,
      never
    >,
  >(
    variants: Variants,
    options?: Opts,
  ): Readonly<{readonly type: 'union'; readonly variants: Variants} & Opts> {
    return Object.freeze({
      type: 'union' as const,
      variants: Object.freeze([...variants]) as unknown as Variants,
      ...(options ?? ({} as Opts)),
    });
  },

  /** Builds a `dataBinding` type definition. */
  dataBinding<const Opts extends TypeMeta = Record<never, never>>(
    options?: Opts,
  ): Readonly<DataBindingTypeDefinition & Opts> {
    return Object.freeze({type: 'dataBinding' as const, ...(options ?? ({} as Opts))});
  },

  /** Builds a `functionCall` type definition. */
  functionCall<const Opts extends TypeMeta = Record<never, never>>(
    options?: Opts,
  ): Readonly<FunctionCallTypeDefinition & Opts> {
    return Object.freeze({type: 'functionCall' as const, ...(options ?? ({} as Opts))});
  },

  /** Builds a catalog-local `ref` type definition referencing an entry in `CatalogModel.types`. */
  ref<
    const RefName extends string,
    const Opts extends Omit<RefTypeDefinition, 'type' | 'ref'> = Record<never, never>,
  >(ref: RefName, options?: Opts): Readonly<{readonly type: 'ref'; readonly ref: RefName} & Opts> {
    return Object.freeze({type: 'ref' as const, ref, ...(options ?? ({} as Opts))});
  },

  /** Builds a single-child component reference (`child`) type definition. */
  child<const Opts extends TypeMeta = Record<never, never>>(
    options?: Opts,
  ): Readonly<ChildTypeDefinition & Opts> {
    return Object.freeze({type: 'child' as const, ...(options ?? ({} as Opts))});
  },

  /** Builds a child list / template (`childList`) type definition. */
  childList<const Opts extends TypeMeta = Record<never, never>>(
    options?: Opts,
  ): Readonly<ChildListTypeDefinition & Opts> {
    return Object.freeze({type: 'childList' as const, ...(options ?? ({} as Opts))});
  },

  /** Builds an interaction `action` type definition. */
  action<const Opts extends TypeMeta = Record<never, never>>(
    options?: Opts,
  ): Readonly<ActionTypeDefinition & Opts> {
    return Object.freeze({type: 'action' as const, ...(options ?? ({} as Opts))});
  },

  /** Builds a `checkRule` type definition. */
  checkRule<const Opts extends TypeMeta = Record<never, never>>(
    options?: Opts,
  ): Readonly<CheckRuleTypeDefinition & Opts> {
    return Object.freeze({type: 'checkRule' as const, ...(options ?? ({} as Opts))});
  },

  /** Builds an `accessibility` attributes type definition. */
  accessibility<const Opts extends TypeMeta = Record<never, never>>(
    options?: Opts,
  ): Readonly<AccessibilityTypeDefinition & Opts> {
    return Object.freeze({type: 'accessibility' as const, ...(options ?? ({} as Opts))});
  },

  /** Combines a parameter name, optional `required` flag, and type definition. */
  param: defineParameter,
} as const;

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
