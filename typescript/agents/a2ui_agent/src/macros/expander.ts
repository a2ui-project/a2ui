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

import {ComponentPruningTransformer} from '../catalog-transformers/pruning.js';
import {ComponentNode, isComponentNode} from '../component-tree/component-node.js';
import {flattenComponentTree} from '../component-tree/flatten.js';
import {
  A2uiCatalogError,
  A2uiRecursionError,
  A2uiValidationError,
  AgentToRendererMessage,
  Catalog,
  CatalogApi,
  normalizeVersionString,
  toCanonicalVersion,
} from '../internal/web-core.js';
import {coerceArguments} from './coercion.js';
import {macroComponentSchema, MacroDefinition, validateMacroName} from './define-macro.js';
import {MacroProtocolError} from './macro-protocol-error.js';

const DEFAULT_MACRO_CATALOG_ID = 'https://a2ui.org/catalogs/macros';
const MAX_EXPANSION_DEPTH = 16;
const COMPONENT_BODY_KEYS = ['createSurface', 'updateComponents'] as const;

type JsonObject = Record<string, unknown>;

/** Options for `MacroExpander`. */
export interface MacroExpanderOptions {
  /**
   * The base catalog components that inference catalogs keep next to the macros. All of
   * them by default; `[]` keeps only the macros.
   */
  passthroughComponents?: readonly string[];
  /**
   * The catalog the macros belong to. When set, an invocation expands only when its
   * `@catalogId`, or the default catalog of its surface, is this ID. It is also the ID of
   * `toCatalog()`. Give each expander its own ID when several work on the same messages.
   */
  catalogId?: string;
  /**
   * The transport catalogs that the lowered components come from. Registering them lets
   * the expander tell a macro from a catalog component of the same name, and stamp the
   * owning `@catalogId` on lowered components where the surface needs it.
   */
  baseCatalogs?: readonly CatalogApi[];
  /**
   * What to do when an invocation fails, for example on an argument of the wrong type:
   * keep it unexpanded and log the error (`passthrough`, the default), or throw an
   * `A2uiValidationError` (`raise`), for agents that retry with the error.
   */
  onError?: 'passthrough' | 'raise';
}

/**
 * Lowers macros to the catalog components a renderer knows.
 *
 * The model sees the macros through the inference catalogs `transformCatalogs` derives
 * from the transport catalogs. The expander lowers the model's messages back to the
 * transport catalogs with `transformToTransport` before they reach the renderer. Macros
 * target A2UI v1.0.
 */
export class MacroExpander {
  /** The catalog the macros belong to, as given in the options. */
  readonly catalogId: string | undefined;
  readonly onError: 'passthrough' | 'raise';
  private readonly macros: ReadonlyMap<string, MacroDefinition>;
  private readonly passthroughComponents: ReadonlySet<string> | undefined;
  /** The component names of each known catalog, including the macros' own scoped catalog. */
  private readonly catalogComponents = new Map<string, ReadonlySet<string>>();
  /** The IDs of the registered base catalogs, in the order they were registered. */
  private readonly baseCatalogIds: string[] = [];

  /**
   * @throws {A2uiValidationError} If a macro name is not a valid v1.0 component name, or a
   *     base catalog targets a protocol version other than v1.0.
   */
  constructor(macros: readonly MacroDefinition[], options: MacroExpanderOptions = {}) {
    const onError = options.onError ?? 'passthrough';
    if (onError !== 'passthrough' && onError !== 'raise') {
      throw new TypeError(`Invalid onError policy '${String(onError)}'.`);
    }
    this.onError = onError;
    for (const macro of macros) {
      validateMacroName(macro.name);
    }
    this.macros = new Map(macros.map(macro => [macro.name, macro]));
    this.passthroughComponents =
      options.passthroughComponents === undefined
        ? undefined
        : new Set(options.passthroughComponents);
    this.catalogId = options.catalogId;
    if (this.catalogId !== undefined) {
      this.catalogComponents.set(this.catalogId, new Set());
    }
    for (const catalog of options.baseCatalogs ?? []) {
      this.registerCatalog(catalog);
    }
  }

  /** The ID of the standalone catalog `toCatalog()` exports. */
  get macroCatalogId(): string {
    return this.catalogId ?? DEFAULT_MACRO_CATALOG_ID;
  }

  /**
   * Registers a base catalog, as `baseCatalogs` does.
   *
   * @throws {A2uiValidationError} If the catalog targets a protocol version other than v1.0.
   */
  registerCatalog(catalog: CatalogApi): void {
    assertV10(
      catalog.protocolVersion,
      version => `Cannot register v${version} catalog with a v1.0 MacroExpander.`,
    );
    this.recordComponents(catalog);
  }

  /**
   * Derives the inference catalogs from the transport catalogs, and registers the
   * transport catalogs as base catalogs.
   *
   * The base catalogs come back pruned to `passthroughComponents`, followed by the
   * standalone macro catalog of `toCatalog()`. When one of them has the expander's
   * `catalogId`, the macros are added to that catalog instead.
   *
   * @throws {A2uiValidationError} If a catalog targets a protocol version other than v1.0.
   * @throws {A2uiCatalogError} If a macro has the name of a component of the catalog it is
   *     added to.
   */
  transformCatalogs(catalogs: readonly CatalogApi[]): CatalogApi[] {
    for (const catalog of catalogs) {
      this.registerCatalog(catalog);
    }
    if (catalogs.length === 0) {
      return this.macros.size > 0 ? [this.toCatalog()] : [];
    }
    const augmentsInPlace =
      this.catalogId !== undefined && catalogs.some(catalog => catalog.id === this.catalogId);
    const pruner = this.pruner();
    const inference = catalogs.map(catalog => {
      if (augmentsInPlace && catalog.id === this.catalogId) {
        return this.transformToInferenceCatalog(catalog);
      }
      return pruner ? pruner.transform(catalog) : catalog;
    });
    if (!augmentsInPlace && this.macros.size > 0) {
      inference.push(this.toCatalog());
    }
    return inference;
  }

  /**
   * Adds the macros to a copy of one base catalog, pruned to `passthroughComponents`, and
   * registers the catalog as a base catalog. For surfaces that use a single catalog.
   *
   * @throws {A2uiValidationError} If the catalog targets a protocol version other than v1.0.
   * @throws {A2uiCatalogError} If a macro has the name of a component the catalog keeps.
   */
  transformToInferenceCatalog(baseCatalog: CatalogApi): CatalogApi {
    assertV10(
      baseCatalog.protocolVersion,
      version => `Cannot augment v${version} catalog with v1.0 macros.`,
    );
    const pruned = this.pruner()?.transform(baseCatalog) ?? baseCatalog;
    for (const name of this.macros.keys()) {
      if (pruned.components.has(name)) {
        throw new A2uiCatalogError(
          `Macro component '${name}' collides with an existing component in the base catalog.`,
        );
      }
    }
    const macroCatalog = this.toCatalog();
    const augmented = pruned.withEntries(
      [...pruned.components.values(), ...macroCatalog.components.values()],
      [...pruned.functions.values()],
    );
    this.recordComponents(baseCatalog);
    return augmented;
  }

  /** Exports the macros as a standalone v1.0 catalog with the ID `macroCatalogId`. */
  toCatalog(): CatalogApi {
    const components: Record<string, unknown> = {};
    for (const macro of this.macros.values()) {
      components[macro.name] = macroComponentSchema(macro);
    }
    const references = [...this.macros.keys()].map(name => ({$ref: `#/components/${name}`}));
    return Catalog.fromJson({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      protocolVersion: '1.0',
      catalogId: this.macroCatalogId,
      title: 'A2UI Macros Catalog',
      description: 'Standalone catalog of high-level A2UI macro components.',
      components,
      $defs: {
        anyComponent:
          references.length > 0
            ? {oneOf: references, discriminator: {propertyName: 'component'}}
            : {not: {}},
        anyFunction: {not: {}},
      },
    });
  }

  /**
   * Lowers the macro invocations in `createSurface` and `updateComponents` messages to the
   * catalog components they render. Other messages and components are kept as they are.
   *
   * An invocation's components replace it in the list, descendants first, as
   * `flattenComponentTree` lists them: the root takes the invocation's ID, and the other
   * IDs are namespaced under it. Macros used inside a rendered tree are lowered too.
   *
   * @returns New messages; `messages` is left unchanged.
   * @throws {A2uiValidationError} If an invocation's arguments don't match its macro, or
   *     its `render` throws.
   * @throws {A2uiRecursionError} If macros keep invoking macros beyond 16 levels.
   */
  transformToTransport(messages: readonly AgentToRendererMessage[]): AgentToRendererMessage[] {
    return messages.map(message => this.lowerMessage(message));
  }

  private lowerMessage(message: AgentToRendererMessage): AgentToRendererMessage {
    if (this.macros.size === 0) {
      return message;
    }
    const lowered: JsonObject = {...(message as unknown as JsonObject)};
    for (const bodyKey of COMPONENT_BODY_KEYS) {
      const body = lowered[bodyKey];
      if (!isJsonObject(body) || !Array.isArray(body['components'])) {
        continue;
      }
      lowered[bodyKey] = {
        ...body,
        components: this.expandComponents(structuredClone(body['components']), 0),
      };
    }
    return lowered as unknown as AgentToRendererMessage;
  }

  private expandComponents(components: readonly unknown[], depth: number): unknown[] {
    if (depth > MAX_EXPANSION_DEPTH) {
      throw new A2uiRecursionError(
        `Macro expansion exceeded maximum recursion depth of ${MAX_EXPANSION_DEPTH}.`,
      );
    }
    const expanded: unknown[] = [];
    for (const component of components) {
      const macro = isJsonObject(component) ? this.invokedMacro(component) : undefined;
      if (macro === undefined) {
        expanded.push(component);
      } else {
        expanded.push(...this.expandInvocation(component as JsonObject, macro, depth));
      }
    }
    return expanded;
  }

  private invokedMacro(component: JsonObject): MacroDefinition | undefined {
    const name = component['component'];
    return typeof name === 'string' ? this.macros.get(name) : undefined;
  }

  private expandInvocation(
    component: JsonObject,
    macro: MacroDefinition,
    depth: number,
  ): unknown[] {
    const {component: _name, id, ...args} = component;
    const instanceId = typeof id === 'string' ? id : undefined;
    const tree = renderMacro(macro, coerceArguments(macro, args));
    const lowered = flattenComponentTree(tree, {rootId: instanceId});
    return this.expandComponents(lowered, depth + 1);
  }

  private pruner(): ComponentPruningTransformer | undefined {
    return this.passthroughComponents === undefined
      ? undefined
      : new ComponentPruningTransformer([...this.passthroughComponents].sort());
  }

  /** Records the component names of a base catalog, without checking its version. */
  private recordComponents(catalog: CatalogApi): void {
    if (!catalog.id) {
      return;
    }
    this.catalogComponents.set(catalog.id, new Set(catalog.components.keys()));
    if (!this.baseCatalogIds.includes(catalog.id)) {
      this.baseCatalogIds.push(catalog.id);
    }
  }
}

/** Throws a `MacroProtocolError` with `message(version)` unless `version` is v1.0. */
function assertV10(version: string, message: (version: string) => string): void {
  if (!isV10(version)) {
    throw new MacroProtocolError(message(normalizeVersionString(version)));
  }
}

function isV10(version: string): boolean {
  return toCanonicalVersion(normalizeVersionString(version)) === '1.0';
}

/**
 * Calls a macro's `render`. A `render` that keeps calling itself overflows the stack, which
 * is reported as the recursion it is.
 */
function renderMacro(macro: MacroDefinition, args: JsonObject): ComponentNode {
  let tree: unknown;
  try {
    tree = macro.render(args as never);
  } catch (e) {
    if (e instanceof RangeError && /call stack/i.test(e.message)) {
      throw new A2uiRecursionError(`Macro '${macro.name}' renders itself without end.`);
    }
    throw e;
  }
  if (!isComponentNode(tree)) {
    throw new A2uiValidationError(`Macro '${macro.name}' must return a component node.`);
  }
  return tree;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
