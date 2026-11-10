/*
 * Copyright 2026 Google LLC
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

import {isSignal, peekValue, type ComponentContext} from '@a2ui/web_core/v1_0';
import {ComponentContextFrameHost} from './shared/sandbox/component_context_frame_host.js';
import type {FrameHost, FrameHostSubscription} from './shared/sandbox/frame_host.js';

/** The catalog shape the frame host needs: what it declares and how to invoke it. */
interface InvokableCatalog {
  readonly functions: ReadonlyMap<string, unknown>;
  readonly invoker: ComponentContext['dataContext']['functionInvoker'];
}

/**
 * {@link FrameHost} of a `ReactApp`: the shared `ComponentContextFrameHost` for data and actions,
 * with a function lookup that works on every surface.
 *
 * The shared host calls the component's own catalog when it declares the function, else the
 * surface's default catalog. That fails in two cases a ReactApp meets often:
 *
 * 1. A surface with several catalogs and no default (what the Express compiler creates for more
 *    than one catalog): the default invoker throws for every name the ReactApp catalog doesn't
 *    declare, even `formatCurrency`.
 * 2. A function declared in a third catalog (for example the app's agent functions): the default
 *    catalog's invoker doesn't declare it, so it is sent to the agent under the wrong catalog.
 *
 * This host invokes the first catalog that declares the name, in this order: the component's
 * catalog, the surface default, then every catalog available to the surface. A name nobody
 * declares goes to the default catalog (or the component's, without a default), whose v1.0
 * invoker routes it to the agent.
 */
export class ReactAppFrameHost implements FrameHost {
  private readonly base: ComponentContextFrameHost;

  constructor(private readonly context: ComponentContext) {
    this.base = new ComponentContextFrameHost(context);
  }

  getData(path: string): unknown {
    return this.base.getData(path);
  }

  setData(path: string, value: unknown): void {
    this.base.setData(path, value);
  }

  subscribeData(path: string, onChange: (value: unknown) => void): FrameHostSubscription {
    return this.base.subscribeData(path, onChange);
  }

  dispatchAction(name: string, context: Readonly<Record<string, unknown>>): Promise<void> {
    return this.base.dispatchAction(name, context);
  }

  invokeFunction(name: string, args: Readonly<Record<string, unknown>>): unknown {
    const catalog = this.resolveCatalog(name);
    if (!catalog) {
      throw new Error(`No catalog can run function '${name}'.`);
    }
    const result: unknown = catalog.invoker(name, {...args}, this.context.dataContext);
    return isSignal(result) ? peekValue(result) : result;
  }

  /** The catalog whose invoker runs `name`; see the class comment for the order. */
  resolveCatalog(name: string): InvokableCatalog | undefined {
    const own = this.context.componentModel.catalog as InvokableCatalog | undefined;
    const surface = this.context.dataContext.surface;
    const fallback = (surface?.defaultCatalog as InvokableCatalog | undefined) ?? own;
    const candidates: Array<InvokableCatalog | undefined> = [
      own,
      surface?.defaultCatalog as InvokableCatalog | undefined,
      ...((surface?.availableCatalogs?.values() ?? []) as Iterable<InvokableCatalog>),
    ];
    return candidates.find(catalog => catalog?.functions.has(name)) ?? fallback;
  }
}
