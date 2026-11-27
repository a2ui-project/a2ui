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
 * Isolated Zod compatibility layer (`@a2ui/web_core/zod`).
 *
 * Houses all Zod-backed schema bridging, AST scrapers, and JSON Schema <-> Zod
 * helpers so core modules stay zero-dependency and ready for future extraction
 * into `@a2ui/zod`.
 */

import {registerZodSchemaAdapter} from './zod_schema_adapter.js';

registerZodSchemaAdapter();

export {registerZodSchemaAdapter, zodSchemaAdapter} from './zod_schema_adapter.js';
export {
  fromZodComponent,
  fromZodFunction,
  legacyZodToJsonSchema,
  zodComponentToDefinition,
  zodFunctionToDefinition,
  zodThemeToSurfaceProperties,
} from './zod_to_model.js';
export {scrapeZodComponentBehavior, scrapeZodSchemaBehavior} from './zod_behavior_scraper.js';
export {getKnownZodSchemaKeys} from './zod_known_keys.js';
export {
  allowedReturnTypesForZodSchema,
  zodElementSchema,
  zodNarrowRecordSchema,
  zodPropertySchema,
} from './zod_return_types.js';
export {exclusiveUnion, exclusiveUnionOverride} from '../../catalog/exclusive_union.js';
export {JsonComponentApi, JsonFunctionApi} from '../../catalog/json_entries.js';
export {
  spec,
  specDef,
  type JsonSchemaObject,
  type SpecAnnotation,
  type SpecMixin,
} from '../../catalog/spec_annotations.js';
export {
  DEFAULT_PROTOCOL_VERSION,
  isZodSchema,
  parseCatalogSchema,
  type ParsedCatalogSchema,
} from '../../catalog/schema_loader.js';
export {serializeCatalogDocument as serializeCatalogToJsonSchema} from '../../catalog/schema_serializer.js';
export {generateValidationSchema} from '../../catalog/schema_generator.js';
export {
  extractRefFields,
  type ChildRefAnalysisOptions,
  type RefFields,
  type RefKind,
} from '../../resolution/ref-fields.js';
export {
  registerLegacySchemaAdapter,
  getLegacySchemaAdapter,
  type LegacySchemaAdapter,
} from '../../catalog/legacy_schema_adapter.js';
