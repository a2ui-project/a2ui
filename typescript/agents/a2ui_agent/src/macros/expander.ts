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
import {CatalogSchemaHelper, getEnvelopeValue} from '../inference-formats/express/schema-helper.js';
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
import {
  isReservedComponentName,
  macroComponentSchema,
  MacroDefinition,
  validateMacroName,
} from './define-macro.js';
import {invocationArguments, mergeEnvelopeFields} from './invocation-envelope.js';
import {MacroProtocolError} from './macro-protocol-error.js';

const DEFAULT_MACRO_CATALOG_ID = 'https://a2ui.org/catalogs/macros';
const MAX_EXPANSION_DEPTH = 16;
const COMPONENT_BODY_KEYS = ['createSurface', 'updateComponents'] as const;

type JsonObject = Record<string, unknown>;

/** What the expander knows about the surface that a list of components belongs to. */
interface SurfaceScope {
  readonly surfaceId: string | undefined;
  /** The surface's default catalog as the model sees it; may be the macro catalog. */
  readonly catalogId: string | undefined;
  /** The surface's default catalog as the renderer sees it. */
  readonly transportCatalogId: string | undefined;
  /** Whether the expander has seen the surface created. */
  readonly known: boolean;
}

/** Where in the nesting of macro trees a list of components is. */
interface ExpansionLevel {
  readonly depth: number;
  /** The macros whose trees enclose this level. */
  readonly activeMacros: ReadonlySet<string>;
  /** The catalog of the macro whose tree this level is. */
  readonly enclosingCatalogId: string | undefined;
}

const TOP_LEVEL: ExpansionLevel = {
  depth: 0,
  activeMacros: new Set(),
  enclosingCatalogId: undefined,
};

/** A component that invokes a macro, and the catalog it invokes it in. */
interface ResolvedInvocation {
  readonly macro: MacroDefinition;
  readonly catalogId: string | undefined;
}

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
  private readonly schemaHelpers = new Map<string, CatalogSchemaHelper>();
  /** The default catalog of each surface seen created; `null` for none. */
  private readonly surfaceCatalogs = new Map<string, string | null>();

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
   * IDs are namespaced under it. The invocation's `@accessibility`, `@metadata` and
   * `@checks` are merged onto the root. Macros used inside a rendered tree are lowered too.
   *
   * On a surface that mixes catalogs, a component invokes a macro only in the macros'
   * catalog: by its `@catalogId`, the catalog of the macro whose tree it is in, or the
   * surface's default, which the expander learns from `createSurface`. A lowered
   * component without `@catalogId` gets the one registered base catalog that defines it,
   * where the surface's default catalog doesn't. A surface whose default is the standalone
   * macro catalog gets the transport catalog as its default instead.
   *
   * An invocation that fails, for example on an argument that doesn't match its parameter,
   * is kept unexpanded and logged, or throws under `onError: 'raise'`.
   *
   * @returns New messages; `messages` is left unchanged.
   * @throws {A2uiValidationError} If a message has a protocol version other than v1.0, a
   *     macro renders a component named `Surface`, or, under `onError: 'raise'`, an
   *     invocation fails.
   * @throws {A2uiCatalogError} If no registered base catalog, or more than one, defines a
   *     lowered component that needs a catalog, or a surface's default is the standalone
   *     macro catalog without a base catalog to replace it.
   * @throws {A2uiRecursionError} If macros keep invoking macros beyond 16 levels.
   */
  transformToTransport(messages: readonly AgentToRendererMessage[]): AgentToRendererMessage[] {
    return messages.map(message => this.lowerMessage(message, this.surfaceCatalogs));
  }

  private lowerMessage(
    message: AgentToRendererMessage,
    surfaces: Map<string, string | null>,
  ): AgentToRendererMessage {
    const version = (message as unknown as JsonObject)['version'];
    if (typeof version === 'string') {
      assertV10(
        version,
        normalized => `Cannot lower v${normalized} message envelope with a v1.0 MacroExpander.`,
      );
    }
    if (this.macros.size === 0) {
      return message;
    }
    const lowered: JsonObject = {...(message as unknown as JsonObject)};
    for (const bodyKey of COMPONENT_BODY_KEYS) {
      const body = lowered[bodyKey];
      if (!isJsonObject(body)) {
        continue;
      }
      const loweredBody = {...body};
      const surfaceId = typeof body['surfaceId'] === 'string' ? body['surfaceId'] : undefined;
      if (bodyKey === 'createSurface' && surfaceId !== undefined) {
        this.trackCreatedSurface(loweredBody, surfaceId, surfaces);
      }
      const components = body['components'];
      if (Array.isArray(components) && components.length > 0) {
        loweredBody['components'] = this.expandComponents(
          structuredClone(components),
          TOP_LEVEL,
          this.surfaceScope(surfaceId, surfaces),
        );
      }
      lowered[bodyKey] = loweredBody;
    }
    return lowered as unknown as AgentToRendererMessage;
  }

  /**
   * Records the default catalog of a created surface. A default that names the standalone
   * macro catalog is replaced by the transport catalog the renderer knows.
   */
  private trackCreatedSurface(
    body: JsonObject,
    surfaceId: string,
    surfaces: Map<string, string | null>,
  ): void {
    const declared = nonEmptyString(body['catalogId']);
    const [inferenceCatalogId, transportCatalogId] = this.surfaceCatalogPair(declared, true);
    if (transportCatalogId !== declared) {
      if (transportCatalogId === undefined) {
        delete body['catalogId'];
      } else {
        body['catalogId'] = transportCatalogId;
      }
    }
    surfaces.delete(surfaceId);
    surfaces.set(surfaceId, inferenceCatalogId ?? null);
  }

  private surfaceScope(
    surfaceId: string | undefined,
    surfaces: ReadonlyMap<string, string | null>,
  ): SurfaceScope {
    if (surfaceId === undefined || !surfaces.has(surfaceId)) {
      return {surfaceId, catalogId: undefined, transportCatalogId: undefined, known: false};
    }
    const [catalogId, transportCatalogId] = this.surfaceCatalogPair(
      surfaces.get(surfaceId) ?? undefined,
      false,
    );
    return {surfaceId, catalogId, transportCatalogId, known: true};
  }

  /**
   * The default catalog of a surface as the model sees it and as the renderer sees it.
   * They differ when the model's default is the standalone macro catalog, which the
   * renderer doesn't know: the renderer then gets the only registered base catalog, or no
   * default when several are registered.
   *
   * @throws {A2uiCatalogError} If a created surface's default is the standalone macro
   *     catalog and no base catalog is registered.
   */
  private surfaceCatalogPair(
    catalogId: string | undefined,
    isCreated: boolean,
  ): [string | undefined, string | undefined] {
    const isMacroCatalog =
      catalogId === this.macroCatalogId && !this.baseCatalogIds.includes(catalogId);
    if (!isMacroCatalog) {
      return [catalogId, catalogId];
    }
    if (this.baseCatalogIds.length === 0 && isCreated) {
      throw new A2uiCatalogError(
        `Surface default catalogId '${catalogId}' is a standalone macro catalog, and no ` +
          'base catalogs are registered on MacroExpander to resolve a transport catalog.',
      );
    }
    return [catalogId, this.baseCatalogIds.length === 1 ? this.baseCatalogIds[0] : undefined];
  }

  private expandComponents(
    components: readonly unknown[],
    level: ExpansionLevel,
    surface: SurfaceScope,
  ): unknown[] {
    if (level.depth > MAX_EXPANSION_DEPTH) {
      throw new A2uiRecursionError(
        `Macro expansion exceeded maximum recursion depth of ${MAX_EXPANSION_DEPTH}.`,
      );
    }
    const expanded: unknown[] = [];
    for (const component of components) {
      const invocation = isJsonObject(component)
        ? this.resolveInvocation(component, level, surface)
        : undefined;
      if (invocation === undefined) {
        expanded.push(component);
      } else {
        expanded.push(
          ...this.expandInvocation(component as JsonObject, invocation, level, surface),
        );
      }
    }
    return expanded;
  }

  /**
   * Decides whether a component invokes one of the macros, and in which catalog.
   *
   * The component's catalog is its `@catalogId`; inside a macro's tree, the catalog of
   * that macro when the component names no catalog component; otherwise the surface's
   * default. A scoped expander expands only components of its own catalog. An unscoped
   * one with base catalogs leaves alone a component whose catalog has a component of that
   * name, unless `passthroughComponents` pruned it, and one whose catalog it doesn't know.
   */
  private resolveInvocation(
    component: JsonObject,
    level: ExpansionLevel,
    surface: SurfaceScope,
  ): ResolvedInvocation | undefined {
    const name = component['component'];
    if (typeof name !== 'string') {
      return undefined;
    }
    const macro = this.macros.get(name);
    if (macro === undefined) {
      return undefined;
    }
    const declared = new Set(Object.keys(macro.parameters));
    const ownCatalogId = getEnvelopeValue(component, 'catalogId', true, declared) ?? undefined;
    let catalogId: string | undefined;
    if (ownCatalogId !== undefined) {
      if (typeof ownCatalogId !== 'string' || ownCatalogId === '') {
        console.warn(
          `Skipping macro '${name}' on component ${JSON.stringify(component['id'])}: ` +
            `invalid catalogId ${JSON.stringify(ownCatalogId)}.`,
        );
        return undefined;
      }
      catalogId = ownCatalogId;
    } else if (this.inheritsEnclosingCatalog(name, level, surface)) {
      catalogId = level.enclosingCatalogId;
    } else {
      catalogId = surface.catalogId;
    }

    if (level.depth > 0 && ownCatalogId === undefined && this.isCatalogComponent(name)) {
      return undefined;
    }
    if (level.activeMacros.has(name)) {
      // Inside its own tree, a macro's name is the catalog component it wraps.
      const wrapsCatalogComponent =
        catalogId !== level.enclosingCatalogId ||
        (catalogId !== undefined && this.catalogHasComponent(catalogId, name)) ||
        (ownCatalogId === undefined && this.isCatalogComponent(name));
      if (wrapsCatalogComponent) {
        return undefined;
      }
    }
    if (this.catalogId !== undefined) {
      return catalogId === this.catalogId ? {macro, catalogId} : undefined;
    }
    if (this.catalogComponents.size > 0 && catalogId !== undefined) {
      if (!this.catalogComponents.has(catalogId) && catalogId !== this.macroCatalogId) {
        return undefined;
      }
      const keptCatalogComponent =
        this.catalogHasComponent(catalogId, name) &&
        (this.passthroughComponents === undefined || this.passthroughComponents.has(name));
      if (keptCatalogComponent) {
        return undefined;
      }
    }
    return {macro, catalogId};
  }

  /** Whether an unannotated component in a macro's tree belongs to that macro's catalog. */
  private inheritsEnclosingCatalog(
    name: string,
    level: ExpansionLevel,
    surface: SurfaceScope,
  ): boolean {
    if (level.depth === 0 || level.enclosingCatalogId === undefined) {
      return false;
    }
    const surfaceCatalogIsForeign =
      surface.catalogId !== undefined &&
      surface.catalogId !== level.enclosingCatalogId &&
      surface.catalogId !== this.macroCatalogId &&
      !this.catalogComponents.has(surface.catalogId);
    if (surfaceCatalogIsForeign || this.isCatalogComponent(name)) {
      return false;
    }
    const anyCatalogComponents = [...this.catalogComponents.values()].some(names => names.size > 0);
    return !(level.activeMacros.has(name) && !anyCatalogComponents);
  }

  private expandInvocation(
    invocation: JsonObject,
    {macro, catalogId}: ResolvedInvocation,
    level: ExpansionLevel,
    surface: SurfaceScope,
  ): unknown[] {
    const instanceId = typeof invocation['id'] === 'string' ? invocation['id'] : undefined;
    let expanded: unknown[];
    try {
      const declared = new Set(Object.keys(macro.parameters));
      const args = structuredClone(invocationArguments(invocation, declared));
      const tree = renderMacro(macro, coerceArguments(macro, args));
      const lowered = flattenComponentTree(tree, {rootId: instanceId});
      for (const component of lowered) {
        if (isReservedComponentName(component.component)) {
          throw new MacroProtocolError(
            `Macro '${macro.name}' emitted reserved component name 'Surface'.`,
          );
        }
      }
      mergeEnvelopeFields(invocation, declared, lowered, instanceId);
      expanded = this.expandComponents(
        lowered,
        {
          depth: level.depth + 1,
          activeMacros: new Set([...level.activeMacros, macro.name]),
          enclosingCatalogId: catalogId ?? this.catalogId,
        },
        surface,
      );
    } catch (e) {
      if (
        e instanceof A2uiRecursionError ||
        e instanceof MacroProtocolError ||
        e instanceof A2uiCatalogError
      ) {
        throw e;
      }
      if (this.onError === 'raise') {
        if (e instanceof A2uiValidationError) {
          throw e;
        }
        throw new A2uiValidationError(
          `Failed to expand macro '${macro.name}' (id=${JSON.stringify(instanceId)}): ${String(e)}`,
        );
      }
      console.error(`Failed to expand macro '${macro.name}':`, e);
      return [invocation];
    }
    if (level.depth === 0) {
      this.stampOwningCatalogs(expanded, surface);
    }
    return expanded;
  }

  /**
   * Stamps `@catalogId` on lowered components that name no catalog where the renderer
   * would otherwise look in the wrong one: on a surface without a default catalog, or
   * with a default that doesn't define the component. The stamp is the one registered
   * base catalog that defines the component.
   *
   * @throws {A2uiCatalogError} If no registered base catalog, or more than one, defines
   *     such a component.
   */
  private stampOwningCatalogs(components: readonly unknown[], surface: SurfaceScope): void {
    if (!surface.known || this.baseCatalogIds.length === 0) {
      return;
    }
    const surfaceDefault = surface.transportCatalogId;
    for (const component of components) {
      if (!isJsonObject(component) || typeof component['component'] !== 'string') {
        continue;
      }
      const name = component['component'];
      const owners = this.baseCatalogIds.filter(id => this.catalogHasComponent(id, name));
      if (this.onError === 'passthrough' && this.macros.has(name) && owners.length === 0) {
        // An invocation that failed and was kept as it is.
        continue;
      }
      if (
        getEnvelopeValue(component, 'catalogId', true, this.customCatalogIdOwners(name, owners)) !=
        null
      ) {
        continue;
      }
      const needsStamp =
        surfaceDefault === undefined ||
        (this.baseCatalogIds.includes(surfaceDefault) &&
          !this.catalogHasComponent(surfaceDefault, name));
      if (!needsStamp) {
        continue;
      }
      const where =
        surfaceDefault === undefined
          ? `defaultless surface '${surface.surfaceId}'`
          : `surface '${surface.surfaceId}' (default '${surfaceDefault}')`;
      if (owners.length === 1) {
        component['@catalogId'] = owners[0];
      } else if (owners.length > 1) {
        throw new A2uiCatalogError(
          `Expanded component '${name}' has no catalogId on ${where} and is defined in ` +
            `multiple base catalogs: ${owners.join(', ')}. Set @catalogId explicitly in the ` +
            'macro.',
        );
      } else {
        throw new A2uiCatalogError(
          `Expanded component '${name}' has no catalogId on ${where} and is not found in ` +
            `any registered base catalog: ${this.baseCatalogIds.join(', ')}.`,
        );
      }
    }
  }

  /**
   * `catalogId` when every catalog that defines the component declares a `catalogId`
   * property of its own, which a bare `catalogId` then is, rather than the envelope field.
   */
  private customCatalogIdOwners(name: string, owners: readonly string[]): ReadonlySet<string> {
    const custom =
      owners.length > 0 &&
      owners.every(id =>
        this.schemaHelpers.get(id)?.getCustomEnvelopeProperties(name).has('catalogId'),
      );
    return custom ? new Set(['catalogId']) : new Set();
  }

  private catalogHasComponent(catalogId: string, name: string): boolean {
    return this.catalogComponents.get(catalogId)?.has(name) ?? false;
  }

  /** Whether a registered catalog defines a component of this name. */
  private isCatalogComponent(name: string): boolean {
    return [...this.catalogComponents.values()].some(names => names.has(name));
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
    try {
      this.schemaHelpers.set(catalog.id, new CatalogSchemaHelper(catalog, '1.0'));
    } catch {
      // Without a schema helper, the catalog counts as declaring no custom envelope
      // properties.
    }
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

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
