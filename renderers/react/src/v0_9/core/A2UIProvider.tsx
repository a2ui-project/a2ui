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

import React, {createContext, useContext, useMemo} from 'react';

/**
 * Configuration options and state provided through the A2UI React context.
 */
export interface A2UIContextValue {
  /**
   * Whether universal W3C Custom Element components are enabled for the host app.
   * Defaults to `false`.
   */
  useUniversalComponents: boolean;
}

/**
 * Context for global A2UI settings.
 */
export const A2UIContext = createContext<A2UIContextValue>({
  useUniversalComponents: false,
});

/**
 * Properties for the A2UIProvider component.
 */
export interface A2UIProviderProps {
  /**
   * Whether to enable universal W3C Custom Element components globally across the host application.
   * Defaults to `false` (native React components).
   */
  useUniversalComponents?: boolean;
  children?: React.ReactNode;
}

/**
 * Global provider for configuring A2UI renderer settings in a React application.
 */
export const A2UIProvider: React.FC<A2UIProviderProps> = ({
  useUniversalComponents = false,
  children,
}) => {
  const value = useMemo(
    () => ({
      useUniversalComponents,
    }),
    [useUniversalComponents],
  );

  return <A2UIContext.Provider value={value}>{children}</A2UIContext.Provider>;
};

/**
 * React hook to access the current A2UI configuration.
 */
export function useA2UI(): A2UIContextValue {
  return useContext(A2UIContext);
}
