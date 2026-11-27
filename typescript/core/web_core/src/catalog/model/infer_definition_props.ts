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

import type {ActionDispatchOptions} from '../../common/metadata.js';
import type {
  ComponentDefinition,
  ComponentParameterDefinition,
  DataParameterDefinition,
  DataTypeDefinition,
  FunctionDefinition,
  TypeDefinition,
} from './catalog_model.js';

/** Resolved accessibility attributes produced by `GenericBinder`. */
export interface ModelResolvedAccessibility {
  label?: string;
  description?: string;
  live?: 'off' | 'polite' | 'assertive';
  hidden?: boolean;
}

/** Resolved child reference item produced by `GenericBinder` for `childList`. */
export interface ModelResolvedChildRef {
  id: string;
  basePath: string;
}

/** Structured check rule outcome produced by `GenericBinder` for `checkable` components. */
export interface ModelValidationResult {
  valid: boolean;
  message: string;
  code?: string;
  severity: 'error' | 'warning' | 'info';
}

type InferParameterMap<
  Params extends readonly ComponentParameterDefinition[],
  Types extends Readonly<Record<string, DataTypeDefinition>>,
  Depth extends readonly unknown[] = [],
> = {
  [P in Params[number] as P['required'] extends true ? P['name'] : never]: InferTypeDefinitionValue<
    P,
    Types,
    Depth
  >;
} & {
  [P in Params[number] as P['required'] extends true
    ? never
    : P['name']]?: InferTypeDefinitionValue<P, Types, Depth>;
};

type InferDataParameterMap<
  Params extends readonly DataParameterDefinition[],
  Types extends Readonly<Record<string, DataTypeDefinition>>,
  Depth extends readonly unknown[] = [],
> = {
  [P in Params[number] as P['required'] extends true ? P['name'] : never]: InferTypeDefinitionValue<
    P,
    Types,
    Depth
  >;
} & {
  [P in Params[number] as P['required'] extends true
    ? never
    : P['name']]?: InferTypeDefinitionValue<P, Types, Depth>;
};

type Prettify<T> = {[K in keyof T]: T[K]} & {};

type NextDepth<D extends readonly unknown[]> = [...D, unknown];

/**
 * Infers the resolved runtime TypeScript value type of a canonical {@link TypeDefinition}.
 */
export type InferTypeDefinitionValue<
  T extends TypeDefinition,
  Types extends Readonly<Record<string, DataTypeDefinition>> = Record<never, never>,
  Depth extends readonly unknown[] = [],
> = Depth['length'] extends 8
  ? unknown
  : TypeDefinition extends T
    ? unknown
    : DataTypeDefinition extends T
      ? unknown
      : T extends {readonly type: 'string'}
        ? string
        : T extends {readonly type: 'number' | 'integer'}
          ? number
          : T extends {readonly type: 'boolean'}
            ? boolean
            : T extends {readonly type: 'enum'; readonly values: readonly (infer V)[]}
              ? V
              : T extends {readonly type: 'const'; readonly value: infer V}
                ? V
                : T extends {readonly type: 'any'}
                  ? unknown
                  : T extends {readonly type: 'child'}
                    ? string
                    : T extends {readonly type: 'childList'}
                      ? (string | ModelResolvedChildRef)[]
                      : T extends {readonly type: 'action'}
                        ? (options?: ActionDispatchOptions) => Promise<void>
                        : T extends {readonly type: 'accessibility'}
                          ? ModelResolvedAccessibility
                          : T extends {readonly type: 'checkRule'}
                            ? unknown
                            : T extends {readonly type: 'dataBinding' | 'functionCall'}
                              ? unknown
                              : T extends {
                                    readonly type: 'ref';
                                    readonly ref: infer RefName extends string;
                                  }
                                ? RefName extends keyof Types
                                  ? InferTypeDefinitionValue<
                                      Types[RefName],
                                      Types,
                                      NextDepth<Depth>
                                    >
                                  : unknown
                                : T extends {readonly type: 'array'; readonly items?: infer Item}
                                  ? Item extends TypeDefinition
                                    ? InferTypeDefinitionValue<Item, Types, NextDepth<Depth>>[]
                                    : unknown[]
                                  : T extends {
                                        readonly type: 'object';
                                        readonly properties?: infer Props;
                                        readonly additionalProperties?: infer Extra;
                                      }
                                    ? Props extends readonly ComponentParameterDefinition[]
                                      ? Extra extends true
                                        ? Prettify<
                                            InferParameterMap<Props, Types, NextDepth<Depth>> &
                                              Record<string, unknown>
                                          >
                                        : Extra extends TypeDefinition
                                          ? Prettify<
                                              InferParameterMap<Props, Types, NextDepth<Depth>> &
                                                Record<
                                                  string,
                                                  InferTypeDefinitionValue<
                                                    Extra,
                                                    Types,
                                                    NextDepth<Depth>
                                                  >
                                                >
                                            >
                                          : Prettify<
                                              InferParameterMap<Props, Types, NextDepth<Depth>>
                                            >
                                      : Extra extends TypeDefinition
                                        ? Record<
                                            string,
                                            InferTypeDefinitionValue<Extra, Types, NextDepth<Depth>>
                                          >
                                        : Record<string, unknown>
                                    : T extends {
                                          readonly type: 'union';
                                          readonly variants: readonly (infer V extends
                                            TypeDefinition)[];
                                        }
                                      ? InferTypeDefinitionValue<V, Types, NextDepth<Depth>>
                                      : unknown;

type GenerateDefinitionSetters<
  Params extends readonly ComponentParameterDefinition[],
  Types extends Readonly<Record<string, DataTypeDefinition>>,
> = {
  [P in Params[number] as P extends {readonly dynamic: true}
    ? `set${Capitalize<P['name']>}`
    : never]?: (value: InferTypeDefinitionValue<P, Types>) => void;
};

type CheckableExtension<Def extends ComponentDefinition> = Def extends {readonly checkable: true}
  ? {
      isValid?: boolean;
      validationErrors?: string[];
      validationResults?: ModelValidationResult[];
    }
  : {
      isValid?: boolean;
      validationErrors?: string[];
      validationResults?: ModelValidationResult[];
    };

/**
 * Infers the resolved runtime prop map produced by `GenericBinder` for a canonical
 * {@link ComponentDefinition}, including two-way `set<Prop>` callbacks for dynamic
 * parameters, accessibility props, and checkable validation props.
 */
export type ResolveDefinitionProps<
  Def extends ComponentDefinition,
  Types extends Readonly<Record<string, DataTypeDefinition>> = Record<never, never>,
> = ComponentDefinition extends Def
  ? Record<string, unknown>
  : Prettify<
      (Def['parameters'] extends readonly ComponentParameterDefinition[]
        ? InferParameterMap<Def['parameters'], Types> &
            GenerateDefinitionSetters<Def['parameters'], Types>
        : Record<string, never>) &
        CheckableExtension<Def> & {
          accessibility?: ModelResolvedAccessibility;
          '@accessibility'?: ModelResolvedAccessibility;
        }
    >;

/**
 * Infers the runtime argument object type for a canonical {@link FunctionDefinition}.
 */
export type ResolveFunctionDefinitionArgs<
  Def extends FunctionDefinition,
  Types extends Readonly<Record<string, DataTypeDefinition>> = Record<never, never>,
> = FunctionDefinition extends Def
  ? Record<string, unknown>
  : Def['parameters'] extends readonly DataParameterDefinition[]
    ? Def['additionalParameters'] extends true
      ? Prettify<InferDataParameterMap<Def['parameters'], Types> & Record<string, unknown>>
      : Def['additionalParameters'] extends DataTypeDefinition
        ? Prettify<
            InferDataParameterMap<Def['parameters'], Types> &
              Record<string, InferTypeDefinitionValue<Def['additionalParameters'], Types>>
          >
        : Prettify<InferDataParameterMap<Def['parameters'], Types>>
    : Record<string, unknown>;
