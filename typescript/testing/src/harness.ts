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

import {
  A2uiError,
  Catalog,
  MessageProcessor,
  basicCatalog,
  type A2uiErrorPayload,
  type A2uiMessage,
  type ActionPayload,
  type ComponentModel,
  type FunctionImplementation,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';

import {createCoreDriver} from './drivers/core.js';
import type {
  ComponentRef,
  InteractOptions,
  SurfaceHarness,
  SurfaceHarnessOptions,
  TargetOptions,
} from './types.js';

/** Thrown when an interaction makes a surface report an error. */
export class SurfaceHarnessError extends Error {
  constructor(
    readonly step: string,
    readonly surfaceErrors: A2uiErrorPayload[],
  ) {
    super(
      `${step} made the surface report ${surfaceErrors.length} error(s):\n` +
        surfaceErrors.map(e => `  [${e.surfaceId ?? '?'}] ${e.code}: ${e.message}`).join('\n'),
    );
    this.name = 'SurfaceHarnessError';
  }
}

function toArray(messages: A2uiMessage[] | A2uiMessage): A2uiMessage[] {
  return Array.isArray(messages) ? messages : [messages];
}

function catalogIdsIn(messages: A2uiMessage[]): string[] {
  const ids: string[] = [];
  for (const message of messages as Array<Record<string, any>>) {
    const id = message?.['createSurface']?.catalogId;
    if (typeof id === 'string' && id) ids.push(id);
  }
  return ids;
}

function assertSupportedVersion(messages: A2uiMessage[]): void {
  for (const message of messages as Array<Record<string, unknown>>) {
    const version = message?.['version'];
    if (typeof version === 'string' && /^v?1\./.test(version)) {
      throw new Error(
        `createSurfaceHarness supports protocol v0.9 and v0.9.1 payloads; got version '${version}'.`,
      );
    }
  }
}

/** Whether a resolved value is a `ResolvedChildRef` produced by a template. */
function isTemplateChild(value: unknown): value is {id: string; basePath: string} {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {id?: unknown}).id === 'string' &&
    typeof (value as {basePath?: unknown}).basePath === 'string'
  );
}

/**
 * Collects child references out of resolved properties.
 *
 * Handles the shapes the basic catalog uses: `child`, `children` (static ids
 * or template instances), and keys ending in `Child` (Modal). Arrays of
 * objects are scanned one level deep, which covers `tabs[].child`.
 */
function childRefsOf(props: Record<string, unknown>): ComponentRef[] {
  const refs: ComponentRef[] = [];
  const visit = (key: string, value: unknown, depth: number) => {
    if (key === 'children' && Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') refs.push({id: item});
        else if (isTemplateChild(item)) refs.push({id: item.id, scope: item.basePath});
      }
      return;
    }
    if (/child$/i.test(key) && typeof value === 'string') {
      refs.push({id: value});
      return;
    }
    if (depth === 0 && Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          for (const [k, v] of Object.entries(item)) visit(k, v, depth + 1);
        }
      }
    }
  };
  for (const [key, value] of Object.entries(props)) visit(key, value, 0);
  return refs;
}

/** Whether a thrown value is an A2UI protocol error rather than a harness usage error. */
function isA2uiError(error: unknown): error is A2uiError {
  return (
    error instanceof A2uiError ||
    (error instanceof Error && typeof (error as {code?: unknown}).code === 'string')
  );
}

/**
 * Builds a surface under test from A2UI messages.
 *
 * Every catalog id the payload or a plugin names is served by a catalog
 * holding the basic components, the basic functions, the functions every
 * plugin contributes, and any `functions` passed in. Catalogs passed through
 * `catalogs` are used as they are.
 */
export async function createSurfaceHarness(
  options: SurfaceHarnessOptions,
): Promise<SurfaceHarness> {
  const initialMessages = structuredClone(toArray(options.messages));
  assertSupportedVersion(initialMessages);

  const driver = options.driver ?? createCoreDriver();
  const plugins = options.plugins ?? [];
  const throwOnErrorDefault = options.throwOnError ?? true;

  const actions: ActionPayload[] = [];
  const errors: A2uiErrorPayload[] = [];
  const surfaceOrder: string[] = [];

  // Plugin functions need the processor and the processor needs the catalogs,
  // which it links into copies at construction. A late-bound forwarder breaks
  // the cycle without mutating the catalog list afterwards.
  const holder: {processor?: MessageProcessor<any>} = {};
  const lateProcessor = new Proxy({} as MessageProcessor<any>, {
    get: (_target, property) => {
      const target = holder.processor;
      if (!target) throw new Error('The harness processor is not constructed yet.');
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const functions: FunctionImplementation[] = [
    ...basicCatalog.functions.values(),
    ...plugins.flatMap(plugin => plugin.functions?.(lateProcessor) ?? []),
    ...(options.functions ?? []),
  ];
  const catalogs: Catalog<any>[] = [];
  const provided = new Map((options.catalogs ?? []).map(c => [c.id, c]));
  const wanted = new Set([
    basicCatalog.id,
    ...plugins.flatMap(plugin => [...(plugin.catalogIds ?? [])]),
    ...catalogIdsIn(initialMessages),
  ]);
  for (const id of wanted) {
    catalogs.push(
      provided.get(id) ??
        new Catalog<any>(
          id,
          '0.9',
          [...basicCatalog.components.values()],
          functions,
          basicCatalog.themeSchema,
        ),
    );
  }
  for (const [id, catalog] of provided) {
    if (!wanted.has(id)) catalogs.push(catalog);
  }

  const processor = new MessageProcessor<any>(catalogs, action => {
    actions.push(action);
  });
  holder.processor = processor;

  processor.model.onSurfaceCreated.subscribe(surface => {
    surfaceOrder.push(surface.id);
    surface.onError.subscribe(error => {
      errors.push(error);
    });
    void driver.mount(surface);
  });

  const settle = async () => {
    // Plugin work can apply messages that start more plugin work, so wait
    // until a full pass sees nothing pending.
    do {
      await Promise.all(plugins.map(plugin => plugin.settle?.()));
      await driver.settle();
    } while (plugins.some(plugin => plugin.pending?.()));
  };

  const surface = (surfaceId?: string): SurfaceModel<any> => {
    const id = surfaceId ?? surfaceOrder[0];
    const model = id ? processor.model.getSurface(id) : undefined;
    if (!model) {
      throw new Error(
        surfaceId
          ? `No surface '${surfaceId}'. Live surfaces: ${surfaceOrder.join(', ') || '(none)'}.`
          : 'No surface has been created. Does the payload include createSurface?',
      );
    }
    return model;
  };

  const component = (id: string, surfaceId?: string): ComponentModel => {
    const target = surface(surfaceId);
    const model = target.componentsModel.get(id);
    if (!model) {
      throw new Error(
        `Component '${id}' is not on surface '${target.id}'. Known ids: ${[
          ...target.componentsModel.keys,
        ].join(', ')}.`,
      );
    }
    return model;
  };

  const ref = (id: string, options?: TargetOptions): ComponentRef =>
    options?.scope ? {id, scope: options.scope} : {id};

  const guarded = async (
    step: string,
    run: () => Promise<void>,
    throwOnError: boolean | undefined,
    surfaceId?: string,
  ) => {
    const before = errors.length;
    try {
      await run();
    } catch (error: unknown) {
      if (!isA2uiError(error)) throw error;
      // An action that awaits a failing async function rejects instead of
      // dispatching. Record it unless the surface already reported it.
      if (errors.length === before) {
        errors.push({
          code: error.code,
          message: error.message,
          surfaceId: surfaceId ?? surfaceOrder[0],
          expression: (error as {expression?: string}).expression,
        });
      }
    }
    await settle();
    const fresh = errors.slice(before);
    if (fresh.length > 0 && (throwOnError ?? throwOnErrorDefault)) {
      throw new SurfaceHarnessError(step, fresh);
    }
  };

  const harness: SurfaceHarness = {
    processor,
    actions,
    errors,

    surfaces: () => surfaceOrder.filter(id => processor.model.getSurface(id)),
    surface,

    data: (path, surfaceId) => surface(surfaceId).dataModel.get(path),
    setData: async (path, value, surfaceId) => {
      surface(surfaceId).dataModel.set(path, value);
      await settle();
    },

    exists: (id, surfaceId) => surface(surfaceId).componentsModel.get(id) !== undefined,
    component,
    props: (id, options) => {
      component(id, options?.surfaceId);
      return driver.props(surface(options?.surfaceId), ref(id, options));
    },
    prop: (id, name, options) => harness.props(id, options)[name],

    children: (id, options) => childRefsOf(harness.props(id, options)),

    rendered: (id, options) => {
      const model = surface(options?.surfaceId);
      if (!model.componentsModel.get(id)) return false;
      const seen = new Set<string>();
      const queue: ComponentRef[] = [{id: model.rootId}];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const key = `${current.id}@${current.scope ?? '/'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (current.id === id && (!options?.scope || current.scope === options.scope)) {
          return true;
        }
        if (!model.componentsModel.get(current.id)) continue;
        for (const child of childRefsOf(driver.props(model, current))) {
          queue.push(child.scope ? child : {id: child.id, scope: current.scope});
        }
      }
      return false;
    },

    click: (id, options?: InteractOptions) =>
      guarded(
        `click('${id}')`,
        async () => {
          component(id, options?.surfaceId);
          await driver.click(surface(options?.surfaceId), ref(id, options));
        },
        options?.throwOnError,
        options?.surfaceId,
      ),

    setValue: (id, value, options?: InteractOptions) =>
      guarded(
        `setValue('${id}', ${JSON.stringify(value)})`,
        async () => {
          component(id, options?.surfaceId);
          await driver.setValue(surface(options?.surfaceId), ref(id, options), value);
        },
        options?.throwOnError,
        options?.surfaceId,
      ),

    process: (messages, options) =>
      guarded(
        'process(messages)',
        async () => {
          processor.processMessages(structuredClone(toArray(messages)));
        },
        options?.throwOnError,
      ),

    settle,

    dispose: () => {
      for (const plugin of plugins) plugin.dispose?.();
      driver.dispose();
      processor.dispose();
    },
  };

  await harness.process(initialMessages, {throwOnError: throwOnErrorDefault});
  return harness;
}
