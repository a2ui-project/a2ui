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

import {isSignal, peekValue, type ComponentContext} from '@a2ui/web_core/v0_9';
import type {FrameHost, FrameHostSubscription} from './frame_host.js';

/**
 * {@link FrameHost} over the `ComponentContext` of a universal component.
 *
 * Data paths go through the component's data context: absolute JSON pointers address the surface
 * data model and relative ones are resolved against the component's base path. Subscriptions fire
 * synchronously during a write, which the data model sync relies on to suppress echoes. Functions
 * go to the surface catalog's invoker, which validates the arguments against the function's schema;
 * a result that is a signal is read once, since a frame receives a single reply per call. Actions
 * are dispatched as `event` actions of the component, so listeners see it as the source.
 */
export class ComponentContextFrameHost implements FrameHost {
  constructor(private readonly context: ComponentContext) {}

  getData(path: string): unknown {
    return this.context.dataContext.resolveDynamicValue<unknown>({path});
  }

  setData(path: string, value: unknown): void {
    this.context.dataContext.set(path, value);
  }

  subscribeData(path: string, onChange: (value: unknown) => void): FrameHostSubscription {
    const subscription = this.context.dataContext.subscribeDynamicValue<unknown>({path}, onChange);
    return {
      unsubscribe: () => {
        subscription.unsubscribe();
      },
    };
  }

  invokeFunction(name: string, args: Readonly<Record<string, unknown>>): unknown {
    const {dataContext} = this.context;
    const result: unknown = dataContext.functionInvoker(name, {...args}, dataContext);
    return isSignal(result) ? peekValue(result) : result;
  }

  dispatchAction(name: string, context: Readonly<Record<string, unknown>>): Promise<void> {
    return this.context.dispatchAction({event: {name, context}});
  }
}
