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
  A2uiErrorPayload,
  A2uiMessage,
  ActionPayload,
  Catalog,
  ComponentModel,
  FunctionImplementation,
  MessageProcessor,
  SurfaceModel,
} from '@a2ui/web_core/v0_9';

/**
 * Extends the harness with catalog functions and asynchronous work.
 *
 * A plugin is how a catalog package ships its own test support. For example,
 * `@a2ui/catalog-mcp/testing` provides a plugin that registers `callMcpTool`
 * against a stub MCP server and lets `settle` wait for tool answers.
 */
export interface SurfaceHarnessPlugin {
  /** Name reported in error messages. */
  readonly name?: string;
  /** Catalog ids to synthesize even when the payload does not name them. */
  readonly catalogIds?: readonly string[];
  /**
   * Functions added to every synthesized catalog. `processor` is a handle on
   * the harness processor, valid once messages are processed; a function may
   * keep it to apply messages or read surfaces later.
   */
  functions?(processor: MessageProcessor<any>): FunctionImplementation[];
  /** Whether the plugin has asynchronous work outstanding. */
  pending?(): boolean;
  /** Waits for the plugin's outstanding work. Called until `pending` is false. */
  settle?(): Promise<void>;
  /** Releases plugin resources. */
  dispose?(): void;
}

/** Options for {@link createSurfaceHarness}. */
export interface SurfaceHarnessOptions {
  /** The A2UI messages that build the surface, as an agent would send them. */
  messages: A2uiMessage[] | A2uiMessage;
  /** Plugins that add catalog functions and asynchronous work, such as a stub MCP server. */
  plugins?: SurfaceHarnessPlugin[];
  /** Further catalog functions every synthesized catalog carries. */
  functions?: FunctionImplementation[];
  /**
   * Catalogs to register as they are. A `createSurface` that names one of
   * these ids uses it instead of a synthesized basic catalog.
   */
  catalogs?: Catalog<any>[];
  /**
   * The driver that executes interactions. Defaults to the `core` driver,
   * which runs on `web_core` state alone.
   */
  driver?: SurfaceDriver;
  /**
   * Whether `click`, `setValue`, and `process` throw when a surface reports an
   * error while they run. Defaults to `true`. Errors are recorded in
   * {@link SurfaceHarness.errors} either way.
   */
  throwOnError?: boolean;
}

/**
 * Where inside a surface a component instance lives.
 *
 * A component rendered from a `List` template exists once per item, so an id
 * alone is ambiguous. `scope` is the data model path of the item the instance
 * is bound to, as {@link SurfaceHarness.children} reports it.
 */
export interface ComponentRef {
  /** The component id, as written in the payload. */
  id: string;
  /** Data model path the instance is scoped to. Absent for a static child. */
  scope?: string;
}

/** Options narrowing which component instance a method addresses. */
export interface TargetOptions {
  /** Data model path of the template item, for components inside a `List`. */
  scope?: string;
  /** Surface the component belongs to. Defaults to the first surface created. */
  surfaceId?: string;
}

/** Options for interactions, which also accept a per-call error policy. */
export interface InteractOptions extends TargetOptions {
  /** Overrides {@link SurfaceHarnessOptions.throwOnError} for this call. */
  throwOnError?: boolean;
}

/**
 * Platform-specific half of the harness.
 *
 * A driver turns a component reference into an interaction on a concrete
 * renderer. The shared harness handles everything that is the same on every
 * platform: catalogs, plugins, recording, and the error trap.
 */
export interface SurfaceDriver {
  /** Human-readable name, reported in error messages. */
  readonly name: string;
  /** Prepares a newly created surface, for example by mounting it. */
  mount(surface: SurfaceModel<any>): Promise<void> | void;
  /** Returns the resolved properties of a component instance. */
  props(surface: SurfaceModel<any>, ref: ComponentRef): Record<string, unknown>;
  /** Activates a component as a user would. */
  click(surface: SurfaceModel<any>, ref: ComponentRef): Promise<void>;
  /** Enters a value into an input component as a user would. */
  setValue(surface: SurfaceModel<any>, ref: ComponentRef, value: unknown): Promise<void>;
  /** Waits until pending renders and subscriptions have settled. */
  settle(): Promise<void>;
  /** Releases anything the driver mounted. */
  dispose(): void;
}

/**
 * A surface under test, addressed only through the identifiers in its A2UI
 * JSON: component ids, property names, data model paths, and action names.
 */
export interface SurfaceHarness {
  /** The processor holding every surface. For assertions the API does not cover. */
  readonly processor: MessageProcessor<any>;
  /** Every `event` action dispatched to the agent, in order. */
  readonly actions: ActionPayload[];
  /** Every error any surface reported, in order. */
  readonly errors: A2uiErrorPayload[];

  /** Ids of the live surfaces, in creation order. */
  surfaces(): string[];
  /** The surface model, defaulting to the first surface created. */
  surface(surfaceId?: string): SurfaceModel<any>;

  /** Value at a JSON Pointer in the surface data model. */
  data(path: string, surfaceId?: string): unknown;
  /** Writes the data model directly. Seeds state; does not simulate input. */
  setData(path: string, value: unknown, surfaceId?: string): Promise<void>;

  /** Whether a component with this id exists on the surface. */
  exists(id: string, surfaceId?: string): boolean;
  /** The component as declared, with its raw (unresolved) properties. */
  component(id: string, surfaceId?: string): ComponentModel;
  /** All properties of a component instance, with bindings and calls resolved. */
  props(id: string, options?: TargetOptions): Record<string, unknown>;
  /** One resolved property of a component instance. */
  prop(id: string, name: string, options?: TargetOptions): unknown;
  /** Whether the component is reachable from the surface root. */
  rendered(id: string, options?: TargetOptions): boolean;
  /**
   * The children of a layout component. Static children carry only an id;
   * children of a `List` template carry the scope of each instantiated item.
   */
  children(id: string, options?: TargetOptions): ComponentRef[];

  /** Activates a component, running its `action`. Waits for plugins and renders. */
  click(id: string, options?: InteractOptions): Promise<void>;
  /** Enters a value into an input component. Waits for renders. */
  setValue(id: string, value: unknown, options?: InteractOptions): Promise<void>;
  /** Feeds further A2UI messages, as a streaming agent would. */
  process(messages: A2uiMessage[] | A2uiMessage, options?: {throwOnError?: boolean}): Promise<void>;
  /** Waits until pending plugin work, subscriptions, and renders have settled. */
  settle(): Promise<void>;
  /** Releases every surface, plugin, and driver resource. */
  dispose(): void;
}
