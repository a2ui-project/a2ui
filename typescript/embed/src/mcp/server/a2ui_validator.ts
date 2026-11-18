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

import Ajv2020, {type ValidateFunction} from 'ajv/dist/2020.js';
import type {CatalogSchemaFile} from '../../contract/index.js';
import {describeSchemaErrors} from './describe_schema_errors.js';
import agentToRendererSchema from './spec/agent_to_renderer.json' with {type: 'json'};
import commonTypesSchema from './spec/common_types.json' with {type: 'json'};

/** A problem found in the A2UI messages a tool or action returned. */
export interface A2uiValidationError {
  /** The index of the offending message in the message list. */
  messageIndex: number;
  /** The surface the message targets, when known. */
  surfaceId?: string;
  /** The ID of the offending component, for component errors. */
  componentId?: string;
  /** The type of the offending component, such as `Text`, for component errors. */
  component?: string;
  /** The path of the offending property, such as `variant` or `action.event.name`. */
  property?: string;
  /** A human-readable description of the problem. */
  message: string;
}

/** The outcome of validating A2UI messages. */
export interface A2uiValidationResult {
  /** Whether the messages are valid. */
  ok: boolean;
  /** The problems found, empty when `ok` is true. */
  errors: A2uiValidationError[];
}

const SPEC_BASE = 'https://a2ui.org/specification/v1_0/';
const AGENT_TO_RENDERER_ID = `${SPEC_BASE}agent_to_renderer.json`;

/**
 * Stands in for the `catalog.json` the message schema refers to. Components and functions are
 * checked against the real catalog schemas separately, with errors that name the component; here
 * any component or function shape is accepted. Function calls exclude `@index`, so that the
 * message schema's `oneOf` between catalog functions and the system `@index` stays exclusive.
 */
const ANY_CATALOG_SCHEMA = {
  $id: `${SPEC_BASE}catalog.json`,
  $defs: {
    anyComponent: {
      type: 'object',
      properties: {component: {type: 'string'}},
      required: ['component'],
      additionalProperties: true,
    },
    anyFunction: {
      type: 'object',
      properties: {'@call': {type: 'string', not: {const: '@index'}}},
      additionalProperties: true,
    },
  },
};

/** The server-to-client message kinds, keyed by their property, with their schema definition. */
const MESSAGE_KINDS: ReadonlyMap<string, string> = new Map(
  (agentToRendererSchema.oneOf as ReadonlyArray<{$ref: string}>).map(({$ref}) => {
    const definition = $ref.slice('#/$defs/'.length);
    // `CreateSurfaceMessage` is the definition of the `createSurface` message.
    const kind = definition.charAt(0).toLowerCase() + definition.slice(1, -'Message'.length);
    return [kind, definition];
  }),
);

interface CompiledCatalog {
  readonly components: ReadonlyMap<string, ValidateFunction>;
}

/**
 * Validates A2UI v1.0 server-to-client messages before they are sent to the app: the message
 * envelopes against the A2UI specification, and each component against the catalog schema of its
 * surface.
 *
 * The validator remembers the catalog of each surface created by messages passed to
 * {@link A2uiValidator.remember}, so that later messages, such as the updates an action returns,
 * can target a surface created by an earlier tool call.
 */
export class A2uiValidator {
  private readonly ajv = new Ajv2020({
    allErrors: true,
    // Catalog schemas carry annotations (`catalogId`, `instructions`, `discriminator`,
    // `returnType`, ...) that are not JSON Schema keywords.
    strict: false,
    validateFormats: false,
    logger: false,
  });
  private readonly envelopes = new Map<string, ValidateFunction>();
  private readonly catalogs = new Map<string, CompiledCatalog>();
  private readonly surfaceCatalogs = new Map<string, string>();
  /** The catalog of surfaces without a known catalog: the only catalog, if there is exactly one. */
  private readonly defaultCatalogId: string | undefined;

  /**
   * Compiles the envelope schemas and the component schemas of every catalog in `schemaFile`.
   *
   * @throws If a catalog schema does not compile, for example because of an unresolvable `$ref`.
   */
  constructor(schemaFile: CatalogSchemaFile) {
    this.ajv.addSchema(commonTypesSchema);
    this.ajv.addSchema(ANY_CATALOG_SCHEMA);
    this.ajv.addSchema(agentToRendererSchema);
    for (const [kind, definition] of MESSAGE_KINDS) {
      this.envelopes.set(
        kind,
        this.ajv.compile({$ref: `${AGENT_TO_RENDERER_ID}#/$defs/${definition}`}),
      );
    }
    Object.entries(schemaFile.catalogs).forEach(([catalogId, schema], index) => {
      this.catalogs.set(catalogId, this.compileCatalog(catalogId, schema, index));
    });
    const catalogIds = [...this.catalogs.keys()];
    this.defaultCatalogId = catalogIds.length === 1 ? catalogIds[0] : undefined;
  }

  /** Validates `messages` without remembering the surfaces they create. */
  validate(messages: unknown): A2uiValidationResult {
    if (!Array.isArray(messages)) {
      return invalid([{messageIndex: -1, message: 'The A2UI messages must be an array.'}]);
    }
    const surfaces = new Map(this.surfaceCatalogs);
    const errors = messages.flatMap((message, index) =>
      this.validateMessage(message, index, surfaces),
    );
    return errors.length === 0 ? {ok: true, errors: []} : invalid(errors);
  }

  /** Remembers the catalog of the surfaces that valid `messages` create, and forgets deleted ones. */
  remember(messages: readonly unknown[]): void {
    for (const message of messages) {
      this.trackSurface(message, this.surfaceCatalogs);
    }
  }

  private compileCatalog(catalogId: string, schema: Record<string, unknown>, index: number) {
    const components = schema['components'];
    if (!isRecord(components)) {
      throw new Error(`The schema of catalog "${catalogId}" has no "components" object.`);
    }
    // Every catalog gets an ID next to the specification files, so that references to
    // `common_types.json` resolve to the copy bundled with this package.
    const id = `${SPEC_BASE}embed-catalog-${index}.json`;
    const {$schema: _schema, $id: _id, ...rest} = schema;
    try {
      this.ajv.addSchema({...rest, $id: id});
      const validators = new Map<string, ValidateFunction>();
      for (const type of Object.keys(components)) {
        validators.set(
          type,
          this.ajv.compile({$ref: `${id}#/components/${encodeURIComponent(escapePointer(type))}`}),
        );
      }
      return {components: validators};
    } catch (error) {
      throw new Error(
        `The schema of catalog "${catalogId}" is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private validateMessage(
    message: unknown,
    messageIndex: number,
    surfaces: Map<string, string>,
  ): A2uiValidationError[] {
    if (!isRecord(message)) {
      return [{messageIndex, message: `Message ${messageIndex} must be an object.`}];
    }
    const kind = [...MESSAGE_KINDS.keys()].find(key => key in message);
    if (kind === undefined) {
      const kinds = [...MESSAGE_KINDS.keys()].map(key => `"${key}"`).join(', ');
      return [
        {
          messageIndex,
          message: `Message ${messageIndex} is not an A2UI v1.0 server-to-client message: it must have one of ${kinds}.`,
        },
      ];
    }
    const body = message[kind];
    const surfaceId =
      isRecord(body) && typeof body['surfaceId'] === 'string' ? body['surfaceId'] : undefined;
    const envelope = this.envelopes.get(kind)!;
    if (!envelope(message)) {
      return describeSchemaErrors(envelope.errors ?? []).map(({property, problem}) => ({
        messageIndex,
        surfaceId,
        property,
        message: `Message ${messageIndex} (${kind}): ${property ? `property "${property}" ` : ''}${problem}`,
      }));
    }

    const errors: A2uiValidationError[] = [];
    if (kind === 'createSurface' && isRecord(body)) {
      const catalogId = body['catalogId'];
      if (typeof catalogId === 'string' && !this.catalogs.has(catalogId)) {
        errors.push({
          messageIndex,
          surfaceId,
          message: `Surface "${surfaceId}" uses catalog "${catalogId}", which the app does not include. ${this.describeCatalogs()}`,
        });
      }
    }
    this.trackSurface(message, surfaces);
    if (errors.length > 0 || !isRecord(body) || !Array.isArray(body['components'])) {
      return errors;
    }
    const components = body['components'] as Array<Record<string, unknown>>;
    return components.flatMap(component =>
      this.validateComponent(component, {messageIndex, surfaceId, surfaces}),
    );
  }

  private validateComponent(
    component: Record<string, unknown>,
    {
      messageIndex,
      surfaceId,
      surfaces,
    }: {messageIndex: number; surfaceId: string | undefined; surfaces: Map<string, string>},
  ): A2uiValidationError[] {
    // The envelope schema guarantees a string `id` and `component`.
    const componentId = component['id'] as string;
    const type = component['component'] as string;
    const located = {messageIndex, surfaceId, componentId, component: type};
    const label = `Component "${componentId}" (${type})`;
    const catalogId =
      typeof component['@catalogId'] === 'string'
        ? component['@catalogId']
        : ((surfaceId === undefined ? undefined : surfaces.get(surfaceId)) ??
          this.defaultCatalogId);
    if (catalogId === undefined) {
      return [
        {
          ...located,
          message: `${label}: the catalog of surface "${surfaceId}" is unknown. Create the surface with a createSurface message that names its catalogId first.`,
        },
      ];
    }
    const catalog = this.catalogs.get(catalogId);
    if (!catalog) {
      return [
        {
          ...located,
          message: `${label}: catalog "${catalogId}" is not included in the app. ${this.describeCatalogs()}`,
        },
      ];
    }
    const validate = catalog.components.get(type);
    if (!validate) {
      return [
        {
          ...located,
          message: `${label}: catalog "${catalogId}" has no component named "${type}".`,
        },
      ];
    }
    if (validate(component)) {
      return [];
    }
    return describeSchemaErrors(validate.errors ?? []).map(({property, problem}) => ({
      ...located,
      property,
      message: `${label}: ${property ? `property "${property}" ` : ''}${problem}`,
    }));
  }

  private trackSurface(message: unknown, surfaces: Map<string, string>): void {
    if (!isRecord(message)) return;
    const create = message['createSurface'];
    if (isRecord(create) && typeof create['surfaceId'] === 'string') {
      const catalogId =
        typeof create['catalogId'] === 'string' ? create['catalogId'] : this.defaultCatalogId;
      if (catalogId === undefined) {
        surfaces.delete(create['surfaceId']);
      } else {
        surfaces.set(create['surfaceId'], catalogId);
      }
    }
    const remove = message['deleteSurface'];
    if (isRecord(remove) && typeof remove['surfaceId'] === 'string') {
      surfaces.delete(remove['surfaceId']);
    }
  }

  private describeCatalogs(): string {
    return `The app includes: ${[...this.catalogs.keys()].map(id => `"${id}"`).join(', ')}.`;
  }
}

function invalid(errors: A2uiValidationError[]): A2uiValidationResult {
  return {ok: false, errors};
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
