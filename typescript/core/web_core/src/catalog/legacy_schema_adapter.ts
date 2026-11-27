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

import type {
  CatalogModel,
  ComponentDefinition,
  FunctionDefinition,
  SurfacePropertiesDefinition,
} from './model/catalog_model.js';
import type {
  ModelBehaviorNode,
  ModelComponentRefMap,
  ModelEnvelopeLayout,
  ModelRefFields,
} from './model/model_semantics.js';
import type {ValidationOutcome} from './model/model_validator.js';

/** Minimal child-reference options structural type (avoids importing versioned schema files). */
export interface LegacyChildRefOptions {
  readonly childRefNames: ReadonlySet<string>;
  readonly childListRefNames: ReadonlySet<string>;
  readonly childPropertyNames?: ReadonlySet<string>;
}

/**
 * Pluggable compatibility adapter bridging legacy schema-library entries (such as
 * Zod schemas and `zod-to-json-schema`) into the zero-dependency core runtime.
 *
 * Registered automatically by the compatibility entrypoints (`@a2ui/web_core`,
 * `@a2ui/web_core/zod`, `@a2ui/web_core/v0_9`, `@a2ui/web_core/v1_0`). Core
 * modules (`src/catalog/model/*`, `src/processing/*`, `src/validation/*`,
 * `src/resolution/*`) depend ONLY on this interface, establishing a strict
 * one-way boundary ready for extracting `@a2ui/zod`.
 */
export interface LegacySchemaAdapter {
  /** Returns whether `value` is a legacy schema instance managed by this adapter. */
  isLegacySchema(value: unknown): boolean;

  /** Validates `value` against a legacy schema. */
  validate(schema: unknown, value: unknown): ValidationOutcome;

  /** Coerces resolved `DynamicBoolean` positions according to a legacy schema. */
  coerceDynamicBooleans(schema: unknown, value: unknown): unknown;

  /** Scrapes a legacy component schema into a `BehaviorNode` tree. */
  scrapeComponentBehavior(schema: unknown, options?: LegacyChildRefOptions): ModelBehaviorNode;

  /** Scrapes an arbitrary legacy schema into a `BehaviorNode` tree. */
  scrapeSchemaBehavior(schema: unknown, options?: LegacyChildRefOptions): ModelBehaviorNode;

  /** Extracts child reference fields from a legacy component schema. */
  extractRefFields(schema: unknown, options?: LegacyChildRefOptions): ModelRefFields;

  /** Computes the envelope mixin layout of a legacy component schema. */
  componentMixinLayout(schema: unknown): ModelEnvelopeLayout;

  /** Returns the known declared object keys of a legacy schema, or `null` if open. */
  getKnownSchemaKeys(schema: unknown): Set<string> | null;

  /** Returns allowed pre-1.0 function return types for a legacy slot schema. */
  allowedReturnTypesForSchema(schema: unknown): ReadonlySet<string> | undefined;

  /** Resolves an array element schema from a legacy schema (for pre-1.0 return-type checking). */
  elementSchema(schema: unknown): unknown;

  /** Resolves a record property schema from a legacy schema (for pre-1.0 return-type checking). */
  propertySchema(schema: unknown, key: string, record?: Record<string, unknown>): unknown;

  /** Narrows a union record schema from a legacy schema (for pre-1.0 return-type checking). */
  narrowRecordSchema(schema: unknown, record: Record<string, unknown>): unknown;

  /** Serializes a legacy schema to a raw JSON Schema fragment (used for v0.9 inline catalogs). */
  schemaToJsonSchema(schema: unknown): Record<string, unknown>;

  /** Converts a legacy Zod component schema into a canonical {@link ComponentDefinition}. */
  componentSchemaToDefinition(
    name: string,
    schema: unknown,
    meta?: {
      allowedParents?: readonly string[];
      allowedChildren?: readonly string[];
      metadata?: Record<string, unknown>;
    },
  ): ComponentDefinition;

  /** Converts a legacy Zod function schema into a canonical {@link FunctionDefinition}. */
  functionSchemaToDefinition(
    name: string,
    returnType: string,
    schema: unknown,
    meta?: {
      description?: string;
      allowedCallers?: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
      requiresUserActivation?: boolean;
    },
  ): FunctionDefinition;

  /** Converts a legacy theme schema into a canonical {@link SurfacePropertiesDefinition}. */
  themeSchemaToSurfaceProperties(schema: unknown): SurfacePropertiesDefinition | undefined;

  /** Builds a `ComponentRefMap` for legacy components lacking canonical definitions. */
  buildLegacyComponentRefMap(
    components: ReadonlyArray<{readonly name: string; readonly schema?: unknown}>,
    options: LegacyChildRefOptions,
  ): ModelComponentRefMap;

  /** Converts an entire legacy Catalog instance to a canonical {@link CatalogModel}. */
  catalogToModel?(catalog: unknown): CatalogModel;
}

let activeAdapter: LegacySchemaAdapter | undefined;

/**
 * Registers the active {@link LegacySchemaAdapter} used when core encounters a
 * legacy schema-backed component, function, or theme without a canonical `definition`.
 */
export function registerLegacySchemaAdapter(adapter: LegacySchemaAdapter): void {
  activeAdapter = adapter;
}

/**
 * Returns the currently registered {@link LegacySchemaAdapter}, or `undefined`
 * when running in pure zero-dependency mode.
 */
export function getLegacySchemaAdapter(): LegacySchemaAdapter | undefined {
  return activeAdapter;
}
