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

import {z} from 'zod';
import type {ProtocolVersion} from '../processing/adapters/base.js';
import {DataContext} from '../resolution/data-context.js';
import {Signal} from '../reactivity/signals.js';
import {A2uiCatalogError, A2uiExpressionError} from '../errors.js';
import {isAtLeastVersion} from '../common/semver.js';
import {SpecVersion} from '../spec_versions.js';
import {parseCatalogSchema} from './schema_loader.js';
import type {JsonSchemaObject} from './spec_annotations.js';
import {generateValidationSchema} from './schema_generator.js';
import {
  deepCopyJson,
  frozenJson,
  retainedDefs,
  serializeCatalogDocument,
} from './schema_serializer.js';
import {
  buildComponentRefMap,
  type ComponentChildRefs,
  type ComponentRefMap,
} from './reference-map.js';
import {V09_CHILD_REF_OPTIONS} from '../v0_9/standard_defs.js';
import {IndexImplementation} from '../v1_0/functions/system_functions.js';

export type {ComponentChildRefs};

/**
 * Registry mapping A2UI function return type identifiers to their TypeScript runtime types.
 *
 * Core defines version-agnostic primitives. Specific protocol versions (such as v1.0)
 * or custom catalogs can augment this interface using TypeScript module declaration merging.
 */
export interface A2uiReturnTypeMap {
  string: string;
  number: number;
  boolean: boolean;
  array: unknown[];
  object: Record<string, unknown>;
  any: unknown;
  void: void;
}

/**
 * Union of valid A2UI function return type identifiers.
 */
export type A2uiReturnType = keyof A2uiReturnTypeMap | (string & {});

/**
 * Infers the TypeScript runtime return type for a given A2UI return type identifier.
 */
export type InferA2uiReturnType<T extends string> = T extends keyof A2uiReturnTypeMap
  ? A2uiReturnTypeMap[T]
  : unknown;

/**
 * Specification and schema for an A2UI function API.
 */
export interface FunctionApi {
  /** Name of the function as it appears in A2UI JSON payloads. */
  readonly name: string;
  /** Return type identifier for the function. */
  readonly returnType: A2uiReturnType;
  /** Zod schema validating the function's input arguments. */
  readonly schema: z.ZodTypeAny;
  /** Allowed caller contexts for the function. */
  readonly allowedCallers?: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
  /** Whether the function requires explicit user interaction before execution. */
  readonly requiresUserActivation?: boolean;
  /** Human-readable description of the function's purpose. */
  readonly description?: string;
}

export type {JsonSchemaObject};

/**
 * A function implementation that can be registered with a catalog or evaluator.
 */
export interface FunctionImplementation extends FunctionApi {
  /**
   * Executes the function logic with the provided arguments and context.
   *
   * @param args Validated input arguments for the function.
   * @param context Data context for expression and state resolution.
   * @param abortSignal Optional abort signal to cancel async execution.
   * @returns The resolved function output value or reactive Signal.
   */
  execute(
    args: Record<string, unknown>,
    context: DataContext,
    abortSignal?: AbortSignal,
  ): unknown | Signal<unknown>;
}

/**
 * Recursively unwraps dynamic wire AST nodes into their evaluated runtime values.
 */
export type ResolvedDynamic<T> = T extends {path: string} | {call: string}
  ? never
  : T extends (infer U)[]
    ? ResolvedDynamic<U>[]
    : T extends object
      ? {[K in keyof T]: ResolvedDynamic<T[K]>}
      : T;

/**
 * Extracts and resolves execution-time argument types from a function's Zod validation schema.
 */
export type ResolvedFunctionArgs<Schema extends z.ZodTypeAny> = ResolvedDynamic<z.infer<Schema>>;

/**
 * Creates a typed FunctionImplementation from an API definition and an execution callback.
 *
 * @param api The function API definition containing name, schema, and metadata.
 * @param execute The execution handler callback.
 * @returns A complete FunctionImplementation object.
 */
export function createFunctionImplementation<
  Schema extends z.ZodTypeAny = z.ZodTypeAny,
  TReturn extends A2uiReturnType = A2uiReturnType,
>(
  api: {
    name: string;
    returnType: TReturn;
    schema: Schema;
    allowedCallers?: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent';
    requiresUserActivation?: boolean;
    description?: string;
  },
  execute: (
    args: ResolvedFunctionArgs<Schema>,
    context: DataContext,
    abortSignal?: AbortSignal,
  ) => InferA2uiReturnType<TReturn> | Signal<InferA2uiReturnType<TReturn>>,
): FunctionImplementation {
  return {
    name: api.name,
    returnType: api.returnType,
    schema: api.schema,
    allowedCallers: api.allowedCallers,
    requiresUserActivation: api.requiresUserActivation,
    description: api.description,
    execute: execute as (
      args: Record<string, unknown>,
      ctx: DataContext,
      ab?: AbortSignal,
    ) => unknown,
  };
}

import {FunctionInvoker} from './function_invoker.js';

/**
 * Contract for a component's capabilities and properties, independent of rendering implementation.
 *
 * @template Schema The Zod schema type for the component's properties.
 */
export interface ComponentApi<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Name of the component as it appears in A2UI JSON (e.g., 'Button'). */
  name: string;

  /**
   * Zod schema describing the properties of this component.
   *
   * Must include catalog-specific common properties (e.g. 'weight', 'accessibility')
   * and must omit envelope fields like 'component' or 'id'.
   */
  readonly schema: Schema;

  /** Optional allowed parent component types (e.g. ['Column', 'Surface']). */
  readonly allowedParents?: string[];

  /** Optional allowed child component types (e.g. ['Text', 'Button']). */
  readonly allowedChildren?: string[];
}

/**
 * Infers the schema type from a ComponentApi.
 *
 * Uses `z.infer` on the `schema` property of a `ComponentApi` object to access
 * component properties with type safety.
 */
export type InferredComponentApiSchemaType<Api extends ComponentApi> = z.infer<Api['schema']>;

/**
 * The `anyComponent` and `anyFunction` unions a catalog document carries in
 * `$defs`, which `Catalog.toJson` computes from the catalog's entries.
 */
export interface CatalogUnions {
  /**
   * Whether the document has `$defs.anyComponent`: a `oneOf` of references to
   * every component, discriminated by `component`.
   */
  readonly anyComponent?: boolean;
  /** Whether the document has `$defs.anyFunction`: a `oneOf` of references to every function. */
  readonly anyFunction?: boolean;
}

/**
 * The document-level fields of a catalog document, other than its ID,
 * components and functions, as `Catalog.toJson` writes them.
 *
 * `Catalog.fromJson` reads them from the document it loads, and the built-in
 * basic catalogs set the scalar ones, which their generated models carry. A
 * catalog defined in code may leave them all out.
 */
export interface CatalogDocumentOptions {
  /** System instructions or usage guidelines (`instructions`). */
  instructions?: string;
  /** The catalog document's `$schema`. */
  schemaUri?: string;
  /** The catalog document's `$id`. */
  schemaId?: string;
  /** The catalog document's `title`. */
  title?: string;
  /** The catalog document's `description`. */
  description?: string;
  /**
   * The `protocolVersion` the document declares, exactly as written, which
   * `toJson` emits verbatim. `null` for a document that declares none, such as
   * the catalogs published before v1.0. When undefined, `toJson` emits the
   * catalog's protocol version in canonical form.
   */
  declaredProtocolVersion?: string | null;
  /**
   * Whether the document declares `catalogId`. Defaults to `true`. `false` for
   * a document such as the v0.8 basic catalog, which is identified by the ID
   * it is loaded with, so that `toJson` does not add one.
   */
  declaresCatalogId?: boolean;
  /**
   * Whether the document declares `components`. Defaults to `true`. `false`
   * for a document that has no `components` key, such as a catalog of
   * functions only, so that `toJson` does not add an empty map. `toJson`
   * still writes `components` if the catalog has any.
   */
  declaresComponents?: boolean;
  /**
   * Whether the document writes `functions` as a map from name to call schema
   * (`'map'`) or as a list of named function definitions (`'list'`). When set,
   * `toJson` emits `functions` in that form even if the catalog has none. When
   * undefined, `toJson` emits a map, and only when the catalog has functions.
   */
  functionsLayout?: 'map' | 'list';
  /**
   * Which of the `anyComponent` and `anyFunction` unions the document has.
   * When undefined, a v1.0 catalog has both, and an earlier one has each union
   * whose section is not empty.
   */
  unions?: CatalogUnions;
  /**
   * The document's named `$defs`, as written, other than the `anyComponent`
   * and `anyFunction` unions that `toJson` computes. Local `#/$defs/<name>`
   * references in the catalog's entry definitions resolve against them.
   * Includes the theme (`$defs.theme`) when the document declares it there.
   * A catalog defined in code declares its definitions as models instead
   * (`defModels` and the mixins of its components).
   */
  defs?: Readonly<Record<string, unknown>>;
  /**
   * How the document writes the common types document in references, such as
   * `https://a2ui.org/specification/v0_9/common_types.json`. `toJson` writes
   * the common types references of entries defined in code, and their
   * `ComponentCommon`-style mixins, against it. Defaults to
   * `common_types.json`.
   */
  commonTypesUri?: string;
  /**
   * Where the document of a catalog defined in code declares the theme that
   * `themeSchema` models: under `$defs.theme` (`'defs'`), or as the map of
   * theme properties under the top-level `styles` key (`'styles'`), as the
   * v0.8 basic catalog does. When undefined, a catalog before v1.0 declares
   * it under `$defs.theme`.
   */
  themeLocation?: 'defs' | 'styles';
  /**
   * Models of named definitions that the document declares under `$defs`
   * besides those its components' mixins name, each named with `specDef`,
   * such as the theme of the v0.9 basic catalog's document. `toJson`
   * computes the definitions from them.
   */
  defModels?: readonly z.ZodTypeAny[];
  /**
   * Top-level document keys the fields above do not cover, as written: for
   * example `extensions`, or the theme of a v0.8 catalog (`styles`).
   */
  extensionFields?: Readonly<Record<string, unknown>>;
}

/**
 * Optional settings for a `Catalog`, beyond its id, version and entries.
 */
export interface CatalogOptions extends CatalogDocumentOptions {
  /** Schema for this catalog's theme parameters. */
  themeSchema?: z.ZodTypeAny;
}

/**
 * Public structural interface for `Catalog`.
 *
 * Declares all publicly accessed properties of `Catalog` to prevent property
 * renaming during compilation.
 */
export declare interface CatalogInterface<
  T extends ComponentApi = ComponentApi,
  F extends FunctionApi = FunctionImplementation,
> {
  /** Unique identifier for the catalog (usually a URI). */
  readonly id: string;
  /** Protocol specification version supported by this catalog. */
  readonly protocolVersion: ProtocolVersion | string;
  /** Map of registered component definitions. */
  readonly components: ReadonlyMap<string, T>;
  /** Map of registered function definitions. */
  readonly functions: ReadonlyMap<string, F>;
  /** Schema for theme parameters used by this catalog. */
  readonly themeSchema?: z.ZodTypeAny;
  /** System instructions or usage guidelines for this catalog. */
  readonly instructions?: string;
  /** Invoker callback that delegates to this catalog's registered functions. */
  readonly invoker: FunctionInvoker;
  /** The document's `$schema`, if known. */
  readonly schemaUri?: string;
  /** The document's `$id`, if known. */
  readonly schemaId?: string;
  /** The document's `title`, if known. */
  readonly title?: string;
  /** The document's `description`, if known. */
  readonly description?: string;
  /** See {@link CatalogDocumentOptions.declaredProtocolVersion}. */
  readonly declaredProtocolVersion?: string | null;
  /** See {@link CatalogDocumentOptions.declaresCatalogId}. */
  readonly declaresCatalogId?: boolean;
  /** See {@link CatalogDocumentOptions.declaresComponents}. */
  readonly declaresComponents?: boolean;
  /** See {@link CatalogDocumentOptions.functionsLayout}. */
  readonly functionsLayout?: 'map' | 'list';
  /** See {@link CatalogDocumentOptions.unions}. */
  readonly unions?: CatalogUnions;
  /** Named `$defs` of the catalog document, without the computed unions. */
  readonly defs?: Readonly<Record<string, unknown>>;
  /** See {@link CatalogDocumentOptions.extensionFields}. */
  readonly extensionFields?: Readonly<Record<string, unknown>>;
  /** See {@link CatalogDocumentOptions.commonTypesUri}. */
  readonly commonTypesUri?: string;
  /** See {@link CatalogDocumentOptions.themeLocation}. */
  readonly themeLocation?: 'defs' | 'styles';
  /** See {@link CatalogDocumentOptions.defModels}. */
  readonly defModels?: readonly z.ZodTypeAny[];
  /** Self-contained, bundled JSON Schema used to validate payloads against this catalog. */
  readonly validationSchema: Record<string, unknown>;
  /**
   * Dynamically reconstructed standard A2UI catalog JSON Schema document.
   *
   * @deprecated Use `validationSchema` instead.
   */
  readonly catalogSchema: Record<string, unknown>;
  /** Unbundled catalog document for this catalog. */
  toJson(): Record<string, unknown>;
  /** Component reference map for child reference extraction and topology validation. */
  readonly componentRefMap: ComponentRefMap;
}

/**
 * Collection of available components and functions.
 *
 * The `F` parameter distinguishes catalogs that carry executable function
 * implementations (`FunctionImplementation`, the default and the only kind a
 * renderer should hold) from schema-only catalogs (`FunctionApi`), whose
 * functions are signatures loaded from catalog JSON with no code attached.
 * Consumers that need to execute functions, such as `NodeResolver`, constrain
 * `F` to `FunctionImplementation` so a schema-only catalog is rejected at
 * compile time rather than resolving values to `undefined` at runtime.
 *
 * A catalog is its catalog document in model form. An entry `fromJson`
 * loaded (`JsonComponentApi`, `JsonFunctionApi`) has its JSON Schema
 * definition as its model, from which its Zod schema is derived. An entry
 * defined in code has its Zod schema as its model; when the schema is
 * annotated as a specification model (see `spec`), as the built-in basic
 * catalogs' generated models are, `toJson` computes its definition in the
 * layout of the catalog's protocol version, and otherwise generates one. The
 * catalog keeps the document-level fields (`CatalogDocumentOptions`).
 * `toJson` assembles the document from all of these and `validationSchema`
 * bundles it, so `Catalog.fromJson(doc).toJson()` equals `doc`, and `toJson`
 * of a built-in basic catalog equals its published document.
 */
export class Catalog<
  T extends ComponentApi,
  F extends FunctionApi = FunctionImplementation,
> implements CatalogInterface<T, F> {
  /** Unique identifier for the catalog. */
  readonly id: string;

  /**
   * Protocol specification version supported by this catalog.
   */
  readonly protocolVersion: ProtocolVersion | string;

  /**
   * Map of available components keyed by component name.
   *
   * Readonly to encourage immutable extension patterns.
   */
  readonly components: ReadonlyMap<string, T>;

  /**
   * Map of functions provided by this catalog.
   */
  readonly functions: ReadonlyMap<string, F>;

  /**
   * Schema for theme parameters used by this catalog.
   */
  readonly themeSchema?: z.ZodTypeAny;

  /**
   * Optional system instructions or usage guidelines for this catalog.
   */
  readonly instructions?: string;

  /**
   * Function invoker callback that delegates to this catalog's registered functions.
   */
  readonly invoker: FunctionInvoker;

  /** The document's `$schema`, if known. */
  readonly schemaUri?: string;

  /** The document's `$id`, if known. */
  readonly schemaId?: string;

  /** The document's `title`, if known. */
  readonly title?: string;

  /** The document's `description`, if known. */
  readonly description?: string;

  /** See {@link CatalogDocumentOptions.declaredProtocolVersion}. */
  readonly declaredProtocolVersion?: string | null;

  /** See {@link CatalogDocumentOptions.declaresCatalogId}. */
  readonly declaresCatalogId: boolean;

  /** See {@link CatalogDocumentOptions.declaresComponents}. */
  readonly declaresComponents: boolean;

  /** See {@link CatalogDocumentOptions.functionsLayout}. */
  readonly functionsLayout?: 'map' | 'list';

  /** See {@link CatalogDocumentOptions.unions}. */
  readonly unions?: CatalogUnions;

  /**
   * Named `$defs` of the catalog document, without the computed unions.
   * Deeply frozen.
   */
  readonly defs?: Readonly<Record<string, unknown>>;

  /** See {@link CatalogDocumentOptions.extensionFields}. Deeply frozen. */
  readonly extensionFields?: Readonly<Record<string, unknown>>;

  /** See {@link CatalogDocumentOptions.commonTypesUri}. */
  readonly commonTypesUri?: string;

  /** See {@link CatalogDocumentOptions.themeLocation}. */
  readonly themeLocation?: 'defs' | 'styles';

  /** See {@link CatalogDocumentOptions.defModels}. */
  readonly defModels?: readonly z.ZodTypeAny[];

  private cachedValidationSchema?: Record<string, unknown>;

  private cachedDocument?: Record<string, unknown>;

  /**
   * Self-contained JSON Schema for validating payloads against this catalog.
   *
   * Built from the catalog's model and memoized: from the definition of each
   * entry `toJson` writes, or, for an entry defined in code without
   * specification annotations, from its Zod schema. Common
   * types references are localized and the referenced standard definitions
   * for the catalog's protocol version, and any of the catalog's `defs` an
   * entry references, are bundled into `$defs`, together with the component
   * envelope and the `anyComponent`/`anyFunction` unions. Use `toJson` for the
   * catalog document itself.
   *
   * Each read returns a fresh copy that the caller may modify.
   */
  get validationSchema(): Record<string, unknown> {
    if (!this.cachedValidationSchema) {
      this.cachedValidationSchema = generateValidationSchema(this);
    }
    return deepCopyJson(this.cachedValidationSchema);
  }

  /**
   * Dynamically reconstructs and memoizes the unified standard A2UI catalog JSON Schema document.
   *
   * @deprecated Use `validationSchema` for the bundled schema or `toJson` for
   *   the catalog document.
   */
  get catalogSchema(): Record<string, unknown> {
    return this.validationSchema;
  }

  /**
   * Returns the unbundled catalog document for this catalog, assembled from
   * its model and memoized.
   *
   * The document-level fields come from the catalog (`CatalogDocumentOptions`).
   * An entry `fromJson` loaded is written as its definition, with references
   * kept as written, unless it references a local definition the catalog
   * lacks. An entry defined in code whose schema is a specification model is
   * computed from its model in the layout of the catalog's protocol version,
   * with its mixins and the `defModels` written to `$defs`; any other entry
   * is generated from its Zod schema. Common types references are written
   * against `commonTypesUri`. The `anyComponent` and `anyFunction` unions are
   * computed from the entries. So for a catalog loaded with `fromJson`, the
   * result equals the loaded document (minus any entries that the document's
   * `anyComponent.oneOf` or `anyFunction.oneOf` unions omit, which `fromJson`
   * filters out on load), and for a built-in basic catalog, the published
   * document.
   *
   * @returns A fresh document that the caller may modify.
   */
  toJson(): Record<string, unknown> {
    if (!this.cachedDocument) {
      this.cachedDocument = serializeCatalogDocument(this);
    }
    return deepCopyJson(this.cachedDocument);
  }

  /**
   * Returns a catalog with this catalog's ID, version, theme and
   * document-level fields, and the given entries instead of its own.
   *
   * Definitions of `defs` that only entries left out referenced are dropped,
   * so `toJson` of the result does not carry, say, the mixin of a pruned
   * component. Catalog transformers use it to derive a catalog.
   *
   * @param components The components of the new catalog.
   * @param functions The functions of the new catalog.
   * @returns A new catalog.
   */
  withEntries(components: T[], functions: F[]): Catalog<T, F> {
    const componentsChanged =
      components.length !== this.components.size ||
      components.some(c => this.components.get(c.name) !== c);
    const functionsChanged =
      functions.length !== this.functions.size ||
      functions.some(f => this.functions.get(f.name) !== f);
    let baseDefs = this.defs;
    if (baseDefs && (componentsChanged || functionsChanged)) {
      const copy = {...baseDefs};
      if (componentsChanged) delete copy['anyComponent'];
      if (functionsChanged) delete copy['anyFunction'];
      baseDefs = copy;
    }
    const unions = this.unions
      ? {
          anyComponent: this.unions.anyComponent || componentsChanged,
          anyFunction: this.unions.anyFunction || functionsChanged,
        }
      : undefined;
    return new Catalog<T, F>(this.id, this.protocolVersion, components, functions, {
      themeSchema: this.themeSchema,
      instructions: this.instructions,
      schemaUri: this.schemaUri,
      schemaId: this.schemaId,
      title: this.title,
      description: this.description,
      declaredProtocolVersion: this.declaredProtocolVersion,
      declaresCatalogId: this.declaresCatalogId,
      declaresComponents: this.declaresComponents,
      functionsLayout: this.functionsLayout,
      unions,
      defs: retainedDefs(
        baseDefs,
        [...this.components.values(), ...this.functions.values()],
        [...components, ...functions],
        this.extensionFields,
      ),
      extensionFields: this.extensionFields,
      commonTypesUri: this.commonTypesUri,
      themeLocation: this.themeLocation,
      defModels: this.defModels,
    });
  }

  private _componentRefMap?: ComponentRefMap;

  /**
   * Lazily computed component reference map for child reference extraction and topology validation.
   */
  get componentRefMap(): ComponentRefMap {
    if (!this._componentRefMap) {
      this._componentRefMap = buildComponentRefMap(this, V09_CHILD_REF_OPTIONS);
    }
    return this._componentRefMap;
  }

  /**
   * Initializes a new `Catalog`.
   *
   * @param id Unique identifier for the catalog, usually a URI.
   * @param protocolVersion Protocol specification version this catalog targets.
   * @param components Component definitions to register.
   * @param functions Function definitions to register.
   * @param themeSchemaOrOptions Optional schema for this catalog's theme
   *   parameters, or a `CatalogOptions` object.
   * @param instructions Optional system instructions or usage guidelines. Ignored
   *   when `themeSchemaOrOptions` is a `CatalogOptions` object that sets them.
   * @throws {A2uiCatalogError} If `protocolVersion` is empty or not provided.
   */
  constructor(
    id: string,
    protocolVersion: ProtocolVersion | string,
    components: T[] = [],
    functions: F[] = [],
    themeSchemaOrOptions?: z.ZodTypeAny | CatalogOptions,
    instructions?: string,
  ) {
    if (!protocolVersion) {
      throw new A2uiCatalogError('protocolVersion must be provided.');
    }

    this.id = id;
    this.protocolVersion = protocolVersion;

    const compMap = new Map<string, T>();
    for (const comp of components) {
      compMap.set(comp.name, comp);
    }
    this.components = compMap;

    const funcMap = new Map<string, F>();
    for (const fn of functions) {
      funcMap.set(fn.name, fn);
    }
    this.functions = funcMap;

    const options: CatalogOptions = isZodSchema(themeSchemaOrOptions)
      ? {themeSchema: themeSchemaOrOptions}
      : (themeSchemaOrOptions ?? {});
    this.themeSchema = options.themeSchema;
    this.instructions = options.instructions ?? instructions;
    this.schemaUri = options.schemaUri;
    this.schemaId = options.schemaId;
    this.title = options.title;
    this.description = options.description;
    this.declaredProtocolVersion = options.declaredProtocolVersion;
    this.declaresCatalogId = options.declaresCatalogId ?? true;
    this.declaresComponents = options.declaresComponents ?? true;
    this.functionsLayout = options.functionsLayout;
    this.unions = options.unions ? Object.freeze({...options.unions}) : undefined;
    // Frozen, so neither the caller nor a reader of the catalog can change the
    // fields `toJson` assembles the document from. Values that are already
    // frozen, such as those `fromJson` produced, are kept without copying.
    this.defs = frozenJson(options.defs);
    this.extensionFields = frozenJson(options.extensionFields);
    this.commonTypesUri = options.commonTypesUri;
    this.themeLocation = options.themeLocation;
    this.defModels = options.defModels ? Object.freeze([...options.defModels]) : undefined;
    this.invoker = createCatalogInvoker(this.id, this.protocolVersion, this.functions);
  }

  /**
   * Constructs a schema-only Catalog from an authored A2UI catalog document.
   *
   * Each entry is a `JsonComponentApi` or `JsonFunctionApi` whose model is
   * its definition as written, from which its Zod schema is derived on first
   * use, and the catalog keeps the document-level fields, so `toJson` returns
   * the document unchanged.
   *
   * @param json Raw catalog document or client capabilities inline catalog.
   * @param protocolVersion Protocol version of the catalog. When given, it
   *   takes precedence over the `protocolVersion` the document declares: it
   *   becomes the catalog's `protocolVersion` and selects the version's
   *   loading rules, while `toJson` still writes the version the document
   *   declares. When omitted, the document's version applies, and for a
   *   document that declares none, such as those published before v1.0,
   *   `DEFAULT_PROTOCOL_VERSION`.
   * @param catalogId Catalog ID to use instead of the one the document
   *   declares, or for a document that declares none, such as the v0.8 basic
   *   catalog. It becomes the catalog's `id`, and replaces the document's own
   *   `catalogId` in `toJson`; a document that declares none still has none
   *   in `toJson`.
   * @returns A new Catalog populated with component and function schemas.
   * @throws {Error} If the catalog ID is missing or not a string.
   */
  static fromJson(
    json: Record<string, any>,
    protocolVersion?: string,
    catalogId?: string,
  ): CatalogApi {
    const {
      id,
      protocolVersion: resolvedVersion,
      components,
      functions,
      ...options
    } = parseCatalogSchema(json, protocolVersion, catalogId);
    return new Catalog(id, resolvedVersion, components, functions, options);
  }

  /**
   * Constructs a schema-only Catalog directly from a raw A2UI catalog schema.
   *
   * @deprecated Use `Catalog.fromJson` instead.
   * @param catalogSchema Raw catalog schema or client capabilities payload object.
   * @param protocolVersion Protocol version of the catalog, which takes
   *   precedence over the one the schema declares, as in `fromJson`.
   * @returns A new Catalog populated with component and function schemas.
   * @throws {Error} If the catalog ID is missing or not a string.
   */
  static fromSchema(catalogSchema: Record<string, any>, protocolVersion?: string): CatalogApi {
    return Catalog.fromJson(catalogSchema, protocolVersion);
  }
}

/**
 * A catalog whose components and functions carry schemas only.
 *
 * What `Catalog.fromJson` produces, and what agents work with: they prompt
 * and validate against signatures but never execute a function. A renderer
 * that executes functions needs a catalog of `FunctionImplementation`s instead.
 */
export type CatalogApi = Catalog<ComponentApi, FunctionApi>;

/**
 * Whether a value is a Zod schema. Checked structurally so schemas built with
 * another copy of Zod are recognized.
 */
function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {safeParse?: unknown}).safeParse === 'function'
  );
}

function createCatalogInvoker<F extends FunctionApi>(
  catalogId: string,
  protocolVersion: ProtocolVersion | string,
  functions: ReadonlyMap<string, F>,
): FunctionInvoker {
  return (name, rawArgs, ctx, abortSignal) => {
    const fn =
      functions.get(name) ??
      (isAtLeastVersion(protocolVersion, SpecVersion.V1_0) && name === '@index'
        ? (IndexImplementation as unknown as F)
        : undefined);
    if (!fn) {
      throw new A2uiExpressionError(`Function not found in catalog '${catalogId}': ${name}`, name);
    }
    assertUserActivation(fn, ctx);
    const execute = (fn as Partial<FunctionImplementation>).execute;
    if (typeof execute !== 'function') {
      throw new A2uiExpressionError(
        `Function '${name}' in catalog '${catalogId}' is schema-only and has no implementation.`,
        name,
      );
    }

    try {
      const safeArgs = fn.schema.parse(rawArgs);
      return execute.call(fn, safeArgs, ctx, abortSignal);
    } catch (e: any) {
      if (e?.name === 'ZodError' || e instanceof z.ZodError) {
        throw new A2uiExpressionError(
          `Validation failed for function '${name}': ${e.message}`,
          name,
          e.errors ?? e.issues,
        );
      }
      throw e;
    }
  };
}

function assertUserActivation(fn: FunctionApi, ctx: DataContext | undefined): void {
  if (!fn.requiresUserActivation) return;
  const isPassive = Boolean(
    (ctx as {isPassiveEvaluation?: boolean} | undefined)?.isPassiveEvaluation,
  );
  const isActivated = Boolean((ctx as {isUserActivated?: boolean} | undefined)?.isUserActivated);
  const browserUnactivated =
    !isActivated &&
    typeof navigator !== 'undefined' &&
    !(navigator.userActivation?.isActive ?? true);
  if (isPassive || browserUnactivated) {
    throw new A2uiExpressionError(
      `Function '${fn.name}' requires user activation and cannot be evaluated without an active user gesture.`,
      fn.name,
    );
  }
}
