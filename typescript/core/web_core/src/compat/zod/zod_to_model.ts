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
import {zodToJsonSchema} from 'zod-to-json-schema';

import {exclusiveUnionOverride} from '../../catalog/exclusive_union.js';
import type {
  ComponentDefinition,
  FunctionDefinition,
  SurfacePropertiesDefinition,
} from '../../catalog/model/catalog_model.js';
import {jsonSchemaToModel} from '../../catalog/model/json_schema_codec.js';
import {cleanSchemaNode} from '../../catalog/schema_generator.js';
import {getSpecAnnotation} from '../../catalog/spec_annotations.js';

/** Converts a legacy Zod schema to a cleaned JSON Schema fragment. */
export function legacyZodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, {
    target: 'jsonSchema2019-09',
    $refStrategy: 'none',
    override: exclusiveUnionOverride,
  }) as Record<string, unknown>;
  cleanSchemaNode(raw, undefined, {stripAdditionalProperties: true});
  return raw;
}

/**
 * Converts a legacy Zod component schema into a canonical {@link ComponentDefinition}.
 */
export function zodComponentToDefinition(
  name: string,
  schema: z.ZodTypeAny,
  meta?: {
    readonly allowedParents?: readonly string[];
    readonly allowedChildren?: readonly string[];
    readonly metadata?: Record<string, unknown>;
  },
): ComponentDefinition {
  const raw = legacyZodToJsonSchema(schema);
  const specAnn = getSpecAnnotation(schema);
  const isCheckable = Boolean(specAnn?.mixins?.includes('Checkable'));
  const compDoc: Record<string, unknown> = {
    catalogId: 'a2ui:compat',
    protocolVersion: '1.0',
    components: {
      [name]: {
        ...raw,
        ...(isCheckable
          ? {
              allOf: [{$ref: 'common_types.json#/$defs/Checkable'}, raw],
            }
          : {}),
        ...(meta?.allowedParents ? {allowedParents: [...meta.allowedParents]} : {}),
        ...(meta?.allowedChildren ? {allowedChildren: [...meta.allowedChildren]} : {}),
        ...(meta?.metadata ? {metadata: meta.metadata} : {}),
      },
    },
  };
  const model = jsonSchemaToModel(compDoc, {protocolVersion: '1.0', catalogId: 'a2ui:compat'});
  return (
    model.components?.[0] ?? {
      name,
      ...(isCheckable ? {checkable: true} : {}),
    }
  );
}

/**
 * Converts a legacy Zod function schema into a canonical {@link FunctionDefinition}.
 */
export function zodFunctionToDefinition(
  name: string,
  returnType: string,
  schema: z.ZodTypeAny,
  meta?: {
    readonly description?: string;
    readonly allowedCallers?: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
    readonly requiresUserActivation?: boolean;
  },
): FunctionDefinition {
  const rawArgs = legacyZodToJsonSchema(schema);
  const fnDoc: Record<string, unknown> = {
    catalogId: 'a2ui:compat',
    protocolVersion: '1.0',
    functions: {
      [name]: {
        type: 'object',
        ...(meta?.description !== undefined ? {description: meta.description} : {}),
        returnType,
        ...(meta?.allowedCallers !== undefined ? {allowedCallers: meta.allowedCallers} : {}),
        ...(meta?.requiresUserActivation !== undefined
          ? {requiresUserActivation: meta.requiresUserActivation}
          : {}),
        properties: {
          '@call': {const: name},
          args: rawArgs,
        },
        required: ['@call', 'args'],
      },
    },
  };
  const model = jsonSchemaToModel(fnDoc, {protocolVersion: '1.0', catalogId: 'a2ui:compat'});
  return (
    model.functions?.[0] ?? {
      name,
      returnType: 'any',
    }
  );
}

/**
 * Converts a legacy Zod theme schema into a canonical {@link SurfacePropertiesDefinition}.
 */
export function zodThemeToSurfaceProperties(
  schema: z.ZodTypeAny,
): SurfacePropertiesDefinition | undefined {
  const raw = legacyZodToJsonSchema(schema);
  const doc: Record<string, unknown> = {
    catalogId: 'a2ui:compat',
    protocolVersion: '0.9',
    $defs: {theme: raw},
  };
  const model = jsonSchemaToModel(doc, {protocolVersion: '0.9', catalogId: 'a2ui:compat'});
  return model.surfaceProperties;
}

/**
 * Wraps a legacy Zod component API with a derived canonical `definition`.
 */
export function fromZodComponent<
  T extends {
    readonly name: string;
    readonly schema: z.ZodTypeAny;
    readonly allowedParents?: readonly string[];
    readonly allowedChildren?: readonly string[];
    readonly metadata?: Record<string, unknown>;
  },
>(api: T): T & {readonly definition: ComponentDefinition} {
  return {
    ...api,
    definition: zodComponentToDefinition(api.name, api.schema, {
      allowedParents: api.allowedParents,
      allowedChildren: api.allowedChildren,
      metadata: api.metadata,
    }),
  };
}

/**
 * Wraps a legacy Zod function API with a derived canonical `definition`.
 */
export function fromZodFunction<
  T extends {
    readonly name: string;
    readonly returnType: string;
    readonly schema: z.ZodTypeAny;
    readonly description?: string;
    readonly allowedCallers?: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
    readonly requiresUserActivation?: boolean;
  },
>(api: T): T & {readonly definition: FunctionDefinition} {
  return {
    ...api,
    definition: zodFunctionToDefinition(api.name, api.returnType, api.schema, {
      description: api.description,
      allowedCallers: api.allowedCallers,
      requiresUserActivation: api.requiresUserActivation,
    }),
  };
}
