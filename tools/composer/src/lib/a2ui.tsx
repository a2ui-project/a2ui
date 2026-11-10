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
 * A2UI renderer adapter.
 *
 * All composer code imports from this file instead of the renderer package
 * directly. Normalizes legacy v0.8 widget definitions into v0.9 surface
 * inputs and renders all surfaces through `@a2ui/react`.
 */
'use client';

import dynamic from 'next/dynamic';
import {useMemo} from 'react';

import type {A2UIComponent, SpecVersion} from '@/types/widget';
import {normalizeV08Surface} from './v08-to-v09';

const V09Viewer = dynamic(() => import('./v09Viewer').then(m => ({default: m.V09Viewer})), {
  ssr: false,
});

export interface A2UIViewerProps {
  root: string;
  components: A2UIComponent[];
  data?: Record<string, unknown>;
  specVersion?: SpecVersion;
  onAction?: (action: unknown) => void;
  className?: string;
}

export function A2UIViewer({root, components, data, onAction, className}: A2UIViewerProps) {
  const normalized = useMemo(
    () => normalizeV08Surface({root, components, data}),
    [root, components, data],
  );

  return (
    <V09Viewer
      root={normalized.root}
      components={normalized.components}
      data={normalized.data}
      onAction={onAction}
      className={className}
    />
  );
}
