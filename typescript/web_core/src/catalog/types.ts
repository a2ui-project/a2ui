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
import {generateCatalogSchema} from './schema_generator.js';
import {serializeCatalogDocument} from './schema_serializer.js';
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
  /**
   * The function's definition exactly as authored in the catalog document it
   * was loaded from, before any reference resolution.
   *
   * `Catalog.toJson` emits this verbatim. It is absent for functions defined in
   * code, and a transformer that changes the function's schema must drop it so
   * `toJson` serializes the changed model instead.
   */
  readonly sourceJson?: Readonly<Record<string, unknown>>;
}

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

  /**
   * The component's definition exactly as authored in the catalog document it
   * was loaded from, before any reference resolution.
   *
   * `Catalog.toJson` emits this verbatim. It is absent for components defined
   * in code, and a transformer that changes the component's schema must drop it
   * so `toJson` serializes the changed model instead.
   */
  readonly sourceJson?: Readonly<Record<string, unknown>>;
}

/**
 * Infers the schema type from a ComponentApi.
 *
 * Uses `z.infer` on the `schema` property of a `ComponentApi` object to access
 * component properties with type safety.
 */
export type InferredComponentApiSchemaType<Api extends ComponentApi> = z.infer<Api['schema']>;

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
  /** The `protocolVersion` the source document declared, exactly as written. */
  readonly declaredProtocolVersion?: string;
  /** Authored `$defs` of the source document, unmodified. */
  readonly defs?: Readonly<Record<string, unknown>>;
  /** The authored document this catalog was loaded from, if any. */
  readonly sourceDocument?: Readonly<Record<string, unknown>>;
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
 * Optional settings for a `Catalog`, beyond its id, version and entries.
 */
export interface CatalogOptions {
  /** Schema for this catalog's theme parameters. */
  themeSchema?: z.ZodTypeAny;
  /** System instructions or usage guidelines. */
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
   * The `protocolVersion` the source document declared, exactly as written.
   * `toJson` emits it verbatim.
   */
  declaredProtocolVersion?: string;
  /**
   * Authored `$defs`, unmodified, including the `anyComponent` and
   * `anyFunction` unions if the source declared them.
   */
  defs?: Readonly<Record<string, unknown>>;
  /**
   * The authored catalog document this catalog was loaded from. A transformer
   * that derives a catalog passes it on so `toJson` keeps the document's form.
   */
  sourceDocument?: Readonly<Record<string, unknown>>;
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

  /** The `protocolVersion` the source document declared, exactly as written. */
  readonly declaredProtocolVersion?: string;

  /** Authored `$defs` of the source document, unmodified, including any unions. */
  readonly defs?: Readonly<Record<string, unknown>>;

  /** The authored document this catalog was loaded from, if any. */
  readonly sourceDocument?: Readonly<Record<string, unknown>>;

  private cachedValidationSchema?: Record<string, unknown>;

  /**
   * Self-contained JSON Schema for validating payloads against this catalog.
   *
   * Reconstructed from the components, functions and theme and memoized. An
   * entry loaded from JSON is built from its authored definition; one defined
   * in code is generated from its Zod schema. Common types references are
   * localized and the referenced standard definitions for the catalog's
   * protocol version, and any authored `$defs` an entry references, are
   * bundled into `$defs`, together with the component envelope and the
   * `anyComponent`/`anyFunction` unions. Use `toJson` for the catalog document
   * itself.
   */
  get validationSchema(): Record<string, unknown> {
    if (!this.cachedValidationSchema) {
      this.cachedValidationSchema = generateCatalogSchema(this);
    }
    return this.cachedValidationSchema;
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
   * Returns the unbundled catalog document for this catalog.
   *
   * For a catalog loaded with `fromJson`, the result equals the loaded document:
   * components and functions are emitted from their authored source, common
   * types references stay external, and authored `$defs`, unions and metadata
   * are kept. Entries without a source, from code or rewritten by a
   * transformer, are serialized from their model with common types references
   * written as `common_types.json#/$defs/<name>`. Authored definitions that only
   * dropped entries referenced are left out, and unions are rebuilt when the
   * set of entries differs from the source.
   *
   * @returns A fresh document that the caller may modify.
   */
  toJson(): Record<string, unknown> {
    return serializeCatalogDocument(this);
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
    this.defs = options.defs;
    this.sourceDocument = options.sourceDocument;
    this.invoker = createCatalogInvoker(this.id, this.protocolVersion, this.functions);
  }

  /**
   * Constructs a schema-only Catalog from an authored A2UI catalog document.
   *
   * The document's metadata, authored `$defs` and each entry's raw JSON are
   * kept, so `toJson` returns the document unchanged.
   *
   * @param json Raw catalog document or client capabilities inline catalog.
   * @param protocolVersion Protocol version to use when the document does not
   *   declare one. Catalog documents published before v1.0 omit the field, in
   *   which case `DEFAULT_PROTOCOL_VERSION` applies.
   * @returns A new Catalog populated with component and function schemas.
   * @throws {Error} If the catalog ID is missing or not a string.
   */
  static fromJson(json: Record<string, any>, protocolVersion?: string): CatalogApi {
    const {
      id,
      protocolVersion: resolvedVersion,
      components,
      functions,
      ...options
    } = parseCatalogSchema(json, protocolVersion);
    return new Catalog(id, resolvedVersion, components, functions, options);
  }

  /**
   * Constructs a schema-only Catalog directly from a raw A2UI catalog schema.
   *
   * @deprecated Use `Catalog.fromJson` instead.
   * @param catalogSchema Raw catalog schema or client capabilities payload object.
   * @param protocolVersion Protocol version to use when the schema does not
   *   declare one.
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
