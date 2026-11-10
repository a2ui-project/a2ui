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

/**
 * V0.9 A2UI Surface viewer.
 *
 * Renders v0.9 component definitions using `@a2ui/react`.
 * Creates a SurfaceModel via MessageProcessor and renders with A2uiSurface.
 */
'use client';

import {useEffect, useMemo} from 'react';

import {A2uiSurface, type ReactCatalogComponent} from '@a2ui/react';
import {type A2uiMessage, MessageProcessor, RELAXED_VALIDATION} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';

import {remapRootComponent, type V09Component} from './v08-to-v09';

const CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const SURFACE_ID = 'v09-preview';

export interface V09ViewerProps {
  root: string;
  components: V09Component[];
  data?: Record<string, unknown>;
  onAction?: (action: unknown) => void;
  className?: string;
}

export function V09Viewer({root, components, data = {}, onAction, className}: V09ViewerProps) {
  const surface = useMemo(() => {
    const processor = new MessageProcessor<ReactCatalogComponent>([basicCatalog], undefined, {
      validationConfig: RELAXED_VALIDATION,
    });

    const mappedComponents = remapRootComponent(root, components);

    const messages: A2uiMessage[] = [
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
          components: mappedComponents,
        },
      },
    ];

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
  }, [root, components, data]);

  useEffect(() => {
    if (!surface || !onAction) {
      return undefined;
    }
    const subscription = surface.onAction.subscribe((action: unknown) => {
      onAction(action);
    });
    return () => subscription.unsubscribe();
  }, [surface, onAction]);

  if (!surface) {
    return <div style={{color: 'gray', padding: '8px'}}>No surface created</div>;
  }

  if (className) {
    return (
      <div className={className}>
        <A2uiSurface surface={surface} />
      </div>
    );
  }

  return <A2uiSurface surface={surface} />;
}
