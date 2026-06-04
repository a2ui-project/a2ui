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

import React, {useEffect, type ReactNode} from 'react';
import {A2UIProvider, A2UIRenderer, useA2UI} from '../../../src/v0_8';
import type * as Types from '@a2ui/web_core/types/types';

/**
 * Helper component that processes messages and renders a surface.
 */
export function TestRenderer({
  messages,
  surfaceId = '@default',
}: {
  messages: Types.ServerToClientMessage[];
  surfaceId?: string;
}) {
  const {processMessages} = useA2UI();

  useEffect(() => {
    processMessages(messages);
  }, [messages, processMessages]);

  return <A2UIRenderer surfaceId={surfaceId} />;
}

/**
 * Full test wrapper with A2UIProvider.
 */
export function TestWrapper({
  children,
  onAction,
  theme,
}: {
  children: ReactNode;
  onAction?: (action: Types.A2UIClientEventMessage) => void;
  theme?: Types.Theme;
}) {
  return (
    <A2UIProvider onAction={onAction} theme={theme}>
      {children}
    </A2UIProvider>
  );
}
