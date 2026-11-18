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

import {
  buildComponentRefMap,
  getComponentReferences,
  isValidUax31Identifier,
  MAX_GLOBAL_DEPTH,
  RELAXED_PATH_PATTERN,
  V10_CHILD_REF_OPTIONS,
  type ComponentRefMap,
} from '@a2ui/web_core/validation';
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

/**
 * The message kinds the app accepts: its `MessageProcessor` is configured with these
 * `allowedMessages` and rejects any other kind.
 */
const APP_MESSAGE_KINDS: ReadonlySet<string> = new Set([
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
]);

/** The ID of the component a surface renders first; v1.0 has no way to name another one. */
const ROOT_ID = 'root';

interface CompiledCatalog {
  readonly components: ReadonlyMap<string, ValidateFunction>;
  /** The properties of each component type that reference other components by ID. */
  readonly refMap: ComponentRefMap;
}

/** The components of a surface created by the messages being validated. */
interface CreatedSurface {
  readonly messageIndex: number;
  readonly catalogId: string | undefined;
  readonly components: Map<string, Record<string, unknown>>;
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
    // Lets a `oneOf` dispatch on a property, see `withDiscriminators`.
    discriminator: true,
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
    if (errors.length === 0) {
      errors.push(...this.validateCreatedSurfaces(messages));
    }
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
      this.ajv.addSchema({...withDiscriminators(rest), $id: id});
      const validators = new Map<string, ValidateFunction>();
      for (const type of Object.keys(components)) {
        validators.set(
          type,
          this.ajv.compile({$ref: `${id}#/components/${encodeURIComponent(escapePointer(type))}`}),
        );
      }
      return {components: validators, refMap: buildRefMap(components)};
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
    const depthErrors = describeDepthErrors(message, messageIndex);
    if (depthErrors.length > 0) {
      return depthErrors;
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
    if (!APP_MESSAGE_KINDS.has(kind)) {
      const kinds = [...APP_MESSAGE_KINDS].map(key => `"${key}"`).join(', ');
      return [
        {
          messageIndex,
          surfaceId,
          message: `Message ${messageIndex} (${kind}): the app accepts only ${kinds} messages.`,
        },
      ];
    }
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
    if (kind === 'updateDataModel' && isRecord(body)) {
      const path = body['path'];
      // Mirrors the path check of web_core's `MessageProcessor`.
      if (
        typeof path === 'string' &&
        path !== '' &&
        (!path.startsWith('/') || !RELAXED_PATH_PATTERN.test(path))
      ) {
        errors.push({
          messageIndex,
          surfaceId,
          property: 'path',
          message: `Message ${messageIndex} (updateDataModel): path "${path}" must be a JSON Pointer that starts with "/", such as "/user/name".`,
        });
      }
    }
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
    return [
      ...describeDuplicateIds(components, messageIndex, surfaceId),
      ...components.flatMap(component =>
        this.validateComponent(component, {messageIndex, surfaceId, surfaces}),
      ),
    ];
  }

  /**
   * Checks the surfaces that `messages` create, once all of them apply, the way the app checks
   * each batch of messages: a second `createSurface` for a surface that exists fails, and every
   * surface with components needs a `root` component, references to existing components only and
   * no cycles. Orphan components are allowed. Surfaces created by earlier calls aren't checked,
   * since their components aren't known here.
   *
   * Only called when every message is valid on its own, so the envelopes can be trusted.
   */
  private validateCreatedSurfaces(messages: readonly unknown[]): A2uiValidationError[] {
    const errors: A2uiValidationError[] = [];
    const created = new Map<string, CreatedSurface>();
    messages.forEach((message, messageIndex) => {
      const record = message as Record<string, unknown>;
      const create = record['createSurface'] as Record<string, unknown> | undefined;
      const update = record['updateComponents'] as Record<string, unknown> | undefined;
      const remove = record['deleteSurface'] as Record<string, unknown> | undefined;
      if (create) {
        const surfaceId = create['surfaceId'] as string;
        if (created.has(surfaceId)) {
          errors.push({
            messageIndex,
            surfaceId,
            message: `Message ${messageIndex} (createSurface): surface "${surfaceId}" already exists. Delete it with a deleteSurface message first, or update it with updateComponents.`,
          });
          return;
        }
        const catalogId =
          typeof create['catalogId'] === 'string' ? create['catalogId'] : this.defaultCatalogId;
        created.set(surfaceId, {messageIndex, catalogId, components: new Map()});
      }
      const body = create ?? update;
      const surface = body ? created.get(body['surfaceId'] as string) : undefined;
      if (body && surface && Array.isArray(body['components'])) {
        for (const component of body['components'] as Array<Record<string, unknown>>) {
          surface.components.set(component['id'] as string, component);
        }
      }
      if (remove) {
        created.delete(remove['surfaceId'] as string);
      }
    });
    for (const [surfaceId, surface] of created) {
      errors.push(...this.describeGraphErrors(surfaceId, surface));
    }
    return errors;
  }

  /**
   * Mirrors `SurfaceComponentsModel.validateTopology` in web_core, which the app runs after each
   * batch with orphan components allowed.
   */
  private describeGraphErrors(surfaceId: string, surface: CreatedSurface): A2uiValidationError[] {
    const {messageIndex, components} = surface;
    if (components.size === 0) return [];
    if (!components.has(ROOT_ID)) {
      return [
        {
          messageIndex,
          surfaceId,
          message: `Surface "${surfaceId}" has no "${ROOT_ID}" component. The app renders the component with ID "${ROOT_ID}" first, so every surface with components needs one.`,
        },
      ];
    }
    const errors: A2uiValidationError[] = [];
    const children = new Map<string, string[]>();
    for (const [componentId, component] of components) {
      const type = component['component'] as string;
      const catalogId =
        typeof component['@catalogId'] === 'string' ? component['@catalogId'] : surface.catalogId;
      const refMap = catalogId === undefined ? undefined : this.catalogs.get(catalogId)?.refMap;
      const references = refMap ? [...getComponentReferences(component, refMap)] : [];
      children.set(
        componentId,
        references.map(([childId]) => childId),
      );
      for (const [childId, property] of references) {
        const located = {messageIndex, surfaceId, componentId, component: type, property};
        if (childId === componentId) {
          errors.push({
            ...located,
            message: `Component "${componentId}" (${type}): property "${property}" refers to the component itself.`,
          });
        } else if (!components.has(childId)) {
          errors.push({
            ...located,
            message: `Component "${componentId}" (${type}): property "${property}" refers to "${childId}", which no component of surface "${surfaceId}" defines.`,
          });
        }
      }
    }
    if (errors.length > 0) return errors;
    const cycle = findCycle(ROOT_ID, children);
    return cycle
      ? [
          {
            messageIndex,
            surfaceId,
            componentId: cycle[0],
            message: `Surface "${surfaceId}" has a cycle of component references: ${cycle.map(id => `"${id}"`).join(' -> ')}.`,
          },
        ]
      : [];
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
    const identifierErrors = describeIdentifierErrors(component).map(problem => ({
      ...located,
      message: `Component "${componentId}": ${problem}`,
    }));
    if (identifierErrors.length > 0) {
      return identifierErrors;
    }
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

/**
 * Describes the identifiers in `component` that the app's A2UI renderer rejects. The v1.0
 * specification requires UAX #31 identifiers for component IDs, function names and argument
 * names, but its JSON schemas don't encode the rule, so this mirrors the checks of web_core's
 * `PayloadValidator` (`typescript/core/web_core/src/validation/payload-validator.ts`) with the
 * same `isValidUax31Identifier` helper. Component types need no check: the catalog lookup
 * already rejects names the catalog doesn't define.
 */
function describeIdentifierErrors(component: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const componentId = component['id'] as string;
  if (!isValidUax31Identifier(componentId)) {
    problems.push(
      `id must be a valid identifier (UAX #31): a letter or "_" followed by letters, digits or "_", such as "${suggestIdentifier(componentId)}".`,
    );
  }
  const {id: _id, component: _component, ...properties} = component;
  collectFunctionIdentifierErrors(properties, '', problems);
  return problems;
}

/** Collects the invalid function and argument names of the function calls nested in `value`. */
function collectFunctionIdentifierErrors(value: unknown, path: string, problems: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectFunctionIdentifierErrors(item, `${path}[${index}]`, problems),
    );
    return;
  }
  if (!isRecord(value)) return;
  const name = value['@call'];
  if (typeof name === 'string') {
    const at = path ? `property "${path}" ` : '';
    // System functions such as `@index` keep their `@` prefix.
    if (!isValidUax31Identifier(name, true)) {
      problems.push(`${at}calls "${name}", which is not a valid function name (UAX #31).`);
    }
    const args = value['args'];
    if (isRecord(args)) {
      for (const argName of Object.keys(args)) {
        if (!isValidUax31Identifier(argName)) {
          problems.push(
            `${at}passes argument "${argName}" to "${name}", which is not a valid argument name (UAX #31).`,
          );
        }
      }
    }
  }
  for (const [key, child] of Object.entries(value)) {
    collectFunctionIdentifierErrors(child, path ? `${path}.${key}` : key, problems);
  }
}

/** Suggests a valid identifier for `id`, such as `issue_body` for `issue-body`. */
function suggestIdentifier(id: string): string {
  const replaced = [...id].map(char => (/\p{XID_Continue}/u.test(char) ? char : '_')).join('');
  return isValidUax31Identifier(replaced) ? replaced : `_${replaced}`;
}

/**
 * Reports what in `message` exceeds the nesting limit of web_core's `validateRecursionAndPaths`
 * (`typescript/core/web_core/src/validation/integrity-checker.ts`), which the app runs on every
 * message: values nested more than `MAX_GLOBAL_DEPTH` levels below the message.
 */
function describeDepthErrors(
  message: Record<string, unknown>,
  messageIndex: number,
): A2uiValidationError[] {
  const locate = (path: ReadonlyArray<string | number>) => {
    const [kind, list, index, ...rest] = path;
    const body = message[kind as string];
    const component =
      list === 'components' && typeof index === 'number' && isRecord(body)
        ? (body['components'] as unknown[])[index]
        : undefined;
    if (!isRecord(component)) {
      return {
        located: {messageIndex},
        label: `Message ${messageIndex} (${String(kind)})`,
        property: formatPath(path),
      };
    }
    const componentId = String(component['id']);
    const type = String(component['component']);
    return {
      located: {messageIndex, componentId, component: type},
      label: `Component "${componentId}" (${type})`,
      property: formatPath(rest),
    };
  };

  let tooDeep: Array<string | number> | undefined;
  const visit = (value: unknown, path: Array<string | number>): void => {
    if (tooDeep) return;
    // The message itself is at depth 0, so a value's depth is the length of its path.
    if (path.length > MAX_GLOBAL_DEPTH) {
      tooDeep = [...path];
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, index]));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  };
  visit(message, []);
  if (!tooDeep) return [];
  const {located, label, property} = locate(tooDeep);
  return [
    {
      ...located,
      property,
      message: `${label}: ${property ? `property "${property}" ` : ''}is nested more than ${MAX_GLOBAL_DEPTH} levels deep in its message, which the app does not allow.`,
    },
  ];
}

/** Formats a path like `["text", "args", "value"]` or `["children", 0]` as `text.args.value`. */
function formatPath(path: ReadonlyArray<string | number>): string {
  return path.reduce<string>(
    (text, segment) =>
      typeof segment === 'number' ? `${text}[${segment}]` : text ? `${text}.${segment}` : segment,
    '',
  );
}

/** The property that names the function a call invokes. */
const CALL_PROPERTY = '@call';

/**
 * Returns a copy of a catalog schema whose function-call `oneOf`s dispatch on `@call`.
 *
 * A catalog's `anyFunction` is a `oneOf` over every function, and arguments are dynamic values that
 * can be function calls again. Without a discriminator, ajv validates every call against every
 * function to check that exactly one matches, so validation time grows exponentially with how
 * deeply calls nest. This adds `discriminator: {propertyName: '@call'}` to each `oneOf` whose
 * alternatives all fix `@call` with a `const` and require it, so ajv validates each call against
 * the function it names only. It also drops any discriminator the catalog declares that ajv would
 * reject, so that turning discriminators on can't break a catalog that worked without them.
 */
function withDiscriminators(schema: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(schema);
  const resolve = (ref: unknown): unknown => {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
    return ref
      .slice(2)
      .split('/')
      .map(unescapePointer)
      .reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), copy);
  };
  const tags = (alternative: unknown, property: string): boolean => {
    const target =
      isRecord(alternative) && '$ref' in alternative ? resolve(alternative['$ref']) : alternative;
    if (!isRecord(target) || !isRecord(target['properties'])) return false;
    const tag = target['properties'][property];
    return (
      isRecord(tag) &&
      (typeof tag['const'] === 'string' || Array.isArray(tag['enum'])) &&
      Array.isArray(target['required']) &&
      target['required'].includes(property)
    );
  };
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isRecord(node)) return;
    const oneOf = node['oneOf'];
    const declared = node['discriminator'];
    if (declared !== undefined) {
      const property = isRecord(declared) ? declared['propertyName'] : undefined;
      const valid =
        typeof property === 'string' &&
        Array.isArray(oneOf) &&
        oneOf.every(alternative => tags(alternative, property));
      if (!valid) delete node['discriminator'];
    } else if (
      Array.isArray(oneOf) &&
      oneOf.length > 1 &&
      oneOf.every(alternative => tags(alternative, CALL_PROPERTY))
    ) {
      node['discriminator'] = {propertyName: CALL_PROPERTY};
    }
    Object.values(node).forEach(visit);
  };
  visit(copy);
  return copy;
}

function unescapePointer(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Builds web_core's map of the properties that reference other components from the JSON schemas
 * of a catalog's components, so references are read the way the app reads them.
 */
function buildRefMap(components: Record<string, unknown>): ComponentRefMap {
  const refMap = buildComponentRefMap(
    Object.entries(components).map(([name, schema]) => ({name, schema}) as never),
    V10_CHILD_REF_OPTIONS,
  );
  // A component's own `id` is a `ComponentId` too, but not a reference.
  return Object.fromEntries(
    Object.entries(refMap).map(([type, refs]) => [
      type,
      {...refs, singleRefs: new Set([...refs.singleRefs].filter(name => name !== 'id'))},
    ]),
  );
}

/** Reports the component IDs that appear more than once in one message, as the app rejects them. */
function describeDuplicateIds(
  components: ReadonlyArray<Record<string, unknown>>,
  messageIndex: number,
  surfaceId: string | undefined,
): A2uiValidationError[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const errors: A2uiValidationError[] = [];
  for (const component of components) {
    const componentId = component['id'] as string;
    if (seen.has(componentId) && !reported.has(componentId)) {
      reported.add(componentId);
      errors.push({
        messageIndex,
        surfaceId,
        componentId,
        message: `Component "${componentId}" is defined more than once in message ${messageIndex} for surface "${surfaceId}". Component IDs must be unique within a message.`,
      });
    }
    seen.add(componentId);
  }
  return errors;
}

/** Returns a cycle reachable from `start`, as the IDs along it ending with the first one. */
function findCycle(start: string, children: ReadonlyMap<string, string[]>): string[] | undefined {
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    const index = path.indexOf(id);
    if (index !== -1) return [...path.slice(index), id];
    if (done.has(id) || !children.has(id)) return undefined;
    path.push(id);
    for (const child of children.get(id)!) {
      const cycle = visit(child);
      if (cycle) return cycle;
    }
    path.pop();
    done.add(id);
    return undefined;
  };
  return visit(start);
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
