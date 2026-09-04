/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type PrimitiveKind = 'string' | 'integer' | 'float' | 'boolean' | 'any';

export interface PrimitiveType {
  readonly kind: 'primitive';
  readonly primitive: PrimitiveKind;
}

export interface EnumType {
  readonly kind: 'enum';
  readonly name: string;
  readonly values: readonly string[];
  readonly description?: string;
}

export interface ComponentRefType {
  readonly kind: 'component_ref';
  readonly allowedComponents: readonly string[];
}

export interface ComponentListType {
  readonly kind: 'component_list';
  readonly allowedComponents: readonly string[];
}

export interface DynamicType {
  readonly kind: 'dynamic';
  readonly inner: TypeDescriptor;
}

export interface ActionType {
  readonly kind: 'action';
}

export interface DataBindingType {
  readonly kind: 'data_binding';
}

export interface CheckRuleType {
  readonly kind: 'check_rule';
}

export interface ListType {
  readonly kind: 'list';
  readonly elementType: TypeDescriptor;
}

export interface MapType {
  readonly kind: 'map';
  readonly valueType: TypeDescriptor;
}

export interface UnionType {
  readonly kind: 'union';
  readonly options: readonly TypeDescriptor[];
}

export type TypeDescriptor =
  | PrimitiveType
  | EnumType
  | ComponentRefType
  | ComponentListType
  | DynamicType
  | ActionType
  | DataBindingType
  | CheckRuleType
  | ListType
  | MapType
  | UnionType;

export interface PropertyDescriptor {
  readonly name: string;
  readonly type: TypeDescriptor;
  readonly description?: string;
  readonly defaultValue?: any;
  readonly isRequired: boolean;
}

export interface AnalysedComponentApi {
  readonly name: string;
  readonly description?: string;
  readonly properties: ReadonlyMap<string, PropertyDescriptor>;
  readonly requiredProperties: readonly string[];
  readonly isCheckable: boolean;
}

export interface AnalysedFunctionApi {
  readonly name: string;
  readonly description?: string;
  readonly parameters: ReadonlyMap<string, PropertyDescriptor>;
  readonly requiredParameters: readonly string[];
  readonly returnType?: TypeDescriptor;
}

export interface AnalysedCatalog {
  readonly catalogId: string;
  readonly specVersion: string;
  readonly components: ReadonlyMap<string, AnalysedComponentApi>;
  readonly functions: ReadonlyMap<string, AnalysedFunctionApi>;
  readonly enums: ReadonlyMap<string, EnumType>;
}
