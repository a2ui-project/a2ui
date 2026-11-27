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
 * Zero-dependency canonical in-memory catalog representation, authoring builders,
 * Catalog Document parser/serializer, runtime validator, semantic helpers, and
 * JSON Schema Draft 2020-12 codec.
 */

export {
  CATALOG_DOCUMENT_FORMAT_VERSION,
  COMPONENT_ONLY_TYPE_KINDS,
  DATA_TYPE_KINDS,
  FORBIDDEN_COMPONENT_PARAM_NAMES,
  FUNCTION_RETURN_SHORTHANDS,
  functionReturnTypeName,
  isComponentDefinition,
  type AccessibilityTypeDefinition,
  type ActionTypeDefinition,
  type AllowedCallers,
  type AnyTypeDefinition,
  type ArrayTypeDefinition,
  type BooleanTypeDefinition,
  type CatalogMetadata,
  type CatalogModel,
  type CheckRuleTypeDefinition,
  type ChildListTypeDefinition,
  type ChildTypeDefinition,
  type ComponentArrayTypeDefinition,
  type ComponentDefinition,
  type ComponentObjectTypeDefinition,
  type ComponentOnlyTypeDefinition,
  type ComponentParameterDefinition,
  type ComponentUnionTypeDefinition,
  type ConstTypeDefinition,
  type DataArrayTypeDefinition,
  type DataBindingTypeDefinition,
  type DataObjectTypeDefinition,
  type DataParameterDefinition,
  type DataTypeDefinition,
  type DataUnionTypeDefinition,
  type EnumPrimitiveValue,
  type EnumTypeDefinition,
  type EnumValueType,
  type FunctionCallTypeDefinition,
  type FunctionDefinition,
  type FunctionReturnDefinition,
  type FunctionReturnShorthand,
  type IntegerTypeDefinition,
  type NumberTypeDefinition,
  type ObjectTypeDefinition,
  type ParameterDefinition,
  type ParameterMeta,
  type RawJsonSchemaTypeDefinition,
  type RefTypeDefinition,
  type StringTypeDefinition,
  type SurfacePropertiesDefinition,
  type TypeDefinition,
  type TypeMeta,
  type UnionTypeDefinition,
  type ValidationResultReturnDefinition,
  type VoidReturnDefinition,
} from './catalog_model.js';
export {
  a2uiType,
  defineCatalog,
  defineComponent,
  defineFunction,
  defineParameter,
  defineSurfaceProperties,
  t,
  type A2uiTypeBuilders,
  type CatalogModelInput,
  type ParameterOptions,
} from './catalog_builders.js';
export {
  type InferTypeDefinitionValue,
  type ModelCheckProps,
  type ModelResolvedAccessibility,
  type ModelResolvedChildRef,
  type ModelValidationResult,
  type ResolveDefinitionProps,
  type ResolveFunctionDefinitionArgs,
} from './infer_definition_props.js';
export {
  isCatalogDocument,
  parseCatalogDocument,
  serializeCatalogDocument,
  validateComponentDefinition,
  validateFunctionDefinition,
  type ParseCatalogDocumentOptions,
} from './catalog_document.js';
export {
  coerceModelDynamicBoolean,
  coerceModelDynamicBooleans,
  formatValidationIssue,
  isDataBindingValue,
  isFunctionCallValue,
  validateCatalogValue,
  validateComponentProperties,
  validateFunctionArguments,
  validateSurfaceProperties,
  type ValidateCatalogValueOptions,
  type ValidationIssue,
  type ValidationOutcome,
} from './model_validator.js';
export {
  allowedReturnTypesForDefinition,
  buildModelReferenceMap,
  definitionEnvelopeLayout,
  definitionToBehavior,
  extractDefinitionRefFields,
  findDynamicBooleanParamNames,
  getFunctionDefinitionParameterNames,
  type ModelBehaviorNode,
  type ModelComponentChildRefs,
  type ModelComponentRefMap,
  type ModelEnvelopeLayout,
  type ModelEnvelopeMixinKey,
  type ModelRefFields,
  type ModelRefKind,
} from './model_semantics.js';
export {
  findMatchingOpaqueSpec,
  mergeOpaqueTypeRegistries,
  serializeOpaqueValuesForAgent,
  type OpaqueTypeRegistry,
  type OpaqueTypeSpec,
} from './opaque_types.js';
export {
  componentDefinitionToJsonSchema,
  functionDefinitionToJsonSchema,
  jsonSchemaToModel,
  modelToJsonSchema,
  surfacePropertiesToJsonSchema,
  typeDefinitionToJsonSchema,
  type JsonSchemaToModelOptions,
  type ModelToJsonSchemaOptions,
} from './json_schema_codec.js';
