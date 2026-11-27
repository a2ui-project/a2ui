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

import type {z} from 'zod';

import {componentMixinLayout} from '../../catalog/component_envelope.js';
import {
  registerLegacySchemaAdapter,
  type LegacyChildRefOptions,
  type LegacySchemaAdapter,
} from '../../catalog/legacy_schema_adapter.js';
import type {ValidationIssue, ValidationOutcome} from '../../catalog/model/model_validator.js';
import {buildComponentRefMap} from '../../catalog/reference-map.js';
import {isZodSchema} from '../../catalog/schema_loader.js';
import {coerceDynamicBooleans} from '../../catalog/validation_result_coercion.js';
import {extractRefFields} from '../../resolution/ref-fields.js';
import {scrapeZodComponentBehavior, scrapeZodSchemaBehavior} from './zod_behavior_scraper.js';
import {getKnownZodSchemaKeys} from './zod_known_keys.js';
import {
  allowedReturnTypesForZodSchema,
  zodElementSchema,
  zodNarrowRecordSchema,
  zodPropertySchema,
} from './zod_return_types.js';
import {
  legacyZodToJsonSchema,
  zodComponentToDefinition,
  zodFunctionToDefinition,
  zodThemeToSurfaceProperties,
} from './zod_to_model.js';

/**
 * Zod implementation of {@link LegacySchemaAdapter}, isolating all runtime
 * Zod and `zod-to-json-schema` bridging behind the core adapter boundary.
 */
export const zodSchemaAdapter: LegacySchemaAdapter = {
  isLegacySchema(value: unknown): boolean {
    return isZodSchema(value);
  },

  validate(schema: unknown, value: unknown): ValidationOutcome {
    const zodSchema = schema as z.ZodTypeAny;
    const res = zodSchema.safeParse(value);
    if (res.success) {
      return {success: true, data: res.data};
    }
    return {
      success: false,
      issues: res.error.issues as unknown as readonly ValidationIssue[],
    };
  },

  coerceDynamicBooleans(schema: unknown, value: unknown): unknown {
    return coerceDynamicBooleans(schema as z.ZodTypeAny, value);
  },

  scrapeComponentBehavior(schema: unknown, options?: LegacyChildRefOptions) {
    return scrapeZodComponentBehavior(schema as z.ZodTypeAny | undefined, options);
  },

  scrapeSchemaBehavior(schema: unknown, options?: LegacyChildRefOptions) {
    return scrapeZodSchemaBehavior(schema as z.ZodTypeAny | undefined, options);
  },

  extractRefFields(schema: unknown, options?: LegacyChildRefOptions) {
    return extractRefFields(schema as z.ZodTypeAny | undefined, options);
  },

  componentMixinLayout(schema: unknown) {
    return componentMixinLayout(schema as z.ZodTypeAny | undefined);
  },

  getKnownSchemaKeys(schema: unknown): Set<string> | null {
    return getKnownZodSchemaKeys(schema as z.ZodTypeAny);
  },

  allowedReturnTypesForSchema(schema: unknown): ReadonlySet<string> | undefined {
    return allowedReturnTypesForZodSchema(schema as z.ZodTypeAny | undefined);
  },

  elementSchema(schema: unknown): unknown {
    return zodElementSchema(schema as z.ZodTypeAny | undefined);
  },

  propertySchema(schema: unknown, key: string, record?: Record<string, unknown>): unknown {
    return zodPropertySchema(schema as z.ZodTypeAny | undefined, key, record);
  },

  narrowRecordSchema(schema: unknown, record: Record<string, unknown>): unknown {
    return zodNarrowRecordSchema(schema as z.ZodTypeAny | undefined, record);
  },

  schemaToJsonSchema(schema: unknown): Record<string, unknown> {
    return legacyZodToJsonSchema(schema as z.ZodTypeAny);
  },

  componentSchemaToDefinition(name, schema, meta) {
    return zodComponentToDefinition(name, schema as z.ZodTypeAny, meta);
  },

  functionSchemaToDefinition(name, returnType, schema, meta) {
    return zodFunctionToDefinition(name, returnType, schema as z.ZodTypeAny, meta);
  },

  themeSchemaToSurfaceProperties(schema) {
    return zodThemeToSurfaceProperties(schema as z.ZodTypeAny);
  },

  buildLegacyComponentRefMap(components, options) {
    return buildComponentRefMap(
      components as ReadonlyArray<{name: string; schema: z.ZodTypeAny}>,
      options,
    );
  },
};

let registered = false;

/**
 * Registers the Zod {@link LegacySchemaAdapter} with core (idempotent).
 */
export function registerZodSchemaAdapter(): void {
  if (registered) return;
  registered = true;
  registerLegacySchemaAdapter(zodSchemaAdapter);
}
