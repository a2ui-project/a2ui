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

/** A live subscription to a data model path; call `unsubscribe` to stop receiving changes. */
export interface FrameHostSubscription {
  unsubscribe(): void;
}

/**
 * What a frame bridge needs from the host that renders the frame component.
 *
 * A universal component provides it from its `ComponentContext`: `getData`, `setData` and
 * `subscribeData` map to the surface `DataModel`, `invokeFunction` to the catalog's function
 * invoker and `dispatchAction` to the component's action dispatcher. Tests provide plain fakes.
 *
 * Paths are absolute JSON pointers into the surface data model, as declared in the component's
 * `data.paths` property.
 */
export interface FrameHost {
  /** Reads the value at an absolute JSON pointer path, or `undefined` if there is none. */
  getData(path: string): unknown;
  /** Writes a value at an absolute JSON pointer path. */
  setData(path: string, value: unknown): void;
  /** Calls `onChange` whenever the value at the path changes. */
  subscribeData(path: string, onChange: (value: unknown) => void): FrameHostSubscription;
  /**
   * Invokes a function of the surface's catalog by name. The result may be a value or a promise
   * of one; the bridge awaits it before replying to the frame.
   */
  invokeFunction(name: string, args: Readonly<Record<string, unknown>>): unknown;
  /** Dispatches a named action, with its context, on behalf of the frame component. */
  dispatchAction(name: string, context: Readonly<Record<string, unknown>>): void | Promise<void>;
}
