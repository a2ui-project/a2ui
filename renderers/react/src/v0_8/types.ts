/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {ComponentType} from 'react';
import type * as Types from '@a2ui/web_core/types/types';
import type * as Primitives from '@a2ui/web_core/types/primitives';

// Re-export the Types and Primitives namespaces for convenience
export type {Types, Primitives};

// Re-export commonly used types from Types namespace
export type AnyComponentNode = Types.AnyComponentNode;
export type Surface = Types.Surface;
export type SurfaceID = Types.SurfaceID;
export type Theme = Types.Theme;
export type ServerToClientMessage = Types.ServerToClientMessage;
export type A2UIClientEventMessage = Types.A2UIClientEventMessage;
export type Action = Types.Action;
export type DataValue = Types.DataValue;
export type MessageProcessor = Types.MessageProcessor;

// Re-export commonly used types from Primitives namespace
export type StringValue = Primitives.StringValue;
export type NumberValue = Primitives.NumberValue;
export type BooleanValue = Primitives.BooleanValue;

/**
 * Props passed to all A2UI React components.
 */
export interface A2UIComponentProps<T extends Types.AnyComponentNode = Types.AnyComponentNode> {
  /** The resolved component node from the A2UI message processor */
  node: T;
  /** The surface ID this component belongs to */
  surfaceId: string;
}

/**
 * A function that loads a React component asynchronously.
 */
export type ComponentLoader<T extends Types.AnyComponentNode = Types.AnyComponentNode> =
  () => Promise<{
    default: ComponentType<A2UIComponentProps<T>>;
  }>;

/**
 * Registration entry for a component in the registry.
 */
export interface ComponentRegistration<T extends Types.AnyComponentNode = Types.AnyComponentNode> {
  /** The React component or a loader function for lazy loading */
  component: ComponentType<A2UIComponentProps<T>> | ComponentLoader<T>;
  /** If true, the component will be lazy loaded */
  lazy?: boolean;
}

/**
 * Callback for when a user action is dispatched.
 */
export type OnActionCallback = (message: Types.A2UIClientEventMessage) => void | Promise<void>;

/**
 * Configuration options for the A2UI provider.
 */
export interface A2UIProviderConfig {
  /** Callback invoked when a user action is dispatched (button click, etc.) */
  onAction?: OnActionCallback;
  /** Initial theme configuration */
  theme?: Types.Theme;
}
