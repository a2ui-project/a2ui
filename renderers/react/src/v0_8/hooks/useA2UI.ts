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

import type * as Types from '@a2ui/web_core/types/types';
import {useA2UIActions, useA2UIState} from '../core/A2UIProvider';

/**
 * Result returned by the useA2UI hook.
 */
export interface UseA2UIResult {
  /** Process incoming server messages */
  processMessages: (messages: Types.ServerToClientMessage[]) => void;

  /** Get a surface by ID */
  getSurface: (surfaceId: string) => Types.Surface | undefined;

  /** Get all surfaces */
  getSurfaces: () => ReadonlyMap<string, Types.Surface>;

  /** Clear all surfaces */
  clearSurfaces: () => void;

  /** The current version number (increments on state changes) */
  version: number;
}

/**
 * Main API hook for A2UI. Provides methods to process messages
 * and access surface state.
 *
 * Note: This hook subscribes to state changes. Components using this
 * will re-render when the A2UI state changes. For action-only usage
 * (no re-renders), use useA2UIActions() instead.
 *
 * @returns Object with message processing and surface access methods
 *
 * @example
 * ```tsx
 * function ChatApp() {
 *   const { processMessages, getSurface } = useA2UI();
 *
 *   useEffect(() => {
 *     const ws = new WebSocket('wss://agent.example.com');
 *     ws.onmessage = (event) => {
 *       const messages = JSON.parse(event.data);
 *       processMessages(messages);
 *     };
 *     return () => ws.close();
 *   }, [processMessages]);
 *
 *   return <A2UIRenderer surfaceId="main" />;
 * }
 * ```
 */
export function useA2UI(): UseA2UIResult {
  const actions = useA2UIActions();
  const state = useA2UIState();

  return {
    processMessages: actions.processMessages,
    getSurface: actions.getSurface,
    getSurfaces: actions.getSurfaces,
    clearSurfaces: actions.clearSurfaces,
    version: state.version,
  };
}
