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

/**
 * V0.9 A2UI Surface viewer.
 *
 * Renders v0.9 component definitions using the React v0.9 renderer.
 * Creates a SurfaceModel via MessageProcessor and renders with A2uiSurface.
 *
 * Components are expected to be in v0.9 format:
 *   { id: "title", component: "Text", text: "Hello", variant: "h1" }
 */
'use client';

import {useMemo} from 'react';
import {A2uiSurface, basicCatalog} from '@a2ui/react/v0_9';
import {MessageProcessor} from '@a2ui/web_core/v0_9';

const CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const SURFACE_ID = 'v09-preview';

interface V09Component {
  id: string;
  component: string;
  [key: string]: unknown;
}

export interface V09ViewerProps {
  root: string;
  components: V09Component[];
  data?: Record<string, unknown>;
  onAction?: (action: unknown) => void;
}

export function V09Viewer({root, components, data = {}, onAction}: V09ViewerProps) {
  const surface = useMemo(() => {
    const processor = new MessageProcessor(
      [basicCatalog],
      onAction ? (action: unknown) => onAction(action) : undefined,
    );

    // Build v0.9 messages from the widget data.
    // Typed as any[] because the message union type is complex and
    // we pass them directly to processMessages which handles validation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: SURFACE_ID,
          catalogId: CATALOG_ID,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: SURFACE_ID,
          components: components.map(c => {
            // Ensure root component is mapped correctly
            if (c.id === root) {
              return {...c, id: 'root'};
            }
            return c;
          }),
        },
      },
    ];

    // Add data model if present
    if (data && Object.keys(data).length > 0) {
      messages.push({
        version: 'v0.9',
        updateDataModel: {
          surfaceId: SURFACE_ID,
          path: '/',
          value: data,
        },
      });
    }

    processor.processMessages(messages);

    return processor.model.getSurface(SURFACE_ID);
  }, [root, components, data, onAction]);

  if (!surface) {
    return <div style={{color: 'gray', padding: '8px'}}>No surface created</div>;
  }

  return <A2uiSurface surface={surface} />;
}
