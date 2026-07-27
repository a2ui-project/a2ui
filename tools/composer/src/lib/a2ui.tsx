/* eslint-disable @typescript-eslint/no-explicit-any */ // TODO: remediate legacy any types
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
 * A2UI renderer adapter.
 *
 * All composer code imports from this file instead of the renderer package
 * directly. Switches between v0.8 and v0.9 renderers based on specVersion.
 *
 * The adapter is the only place that interprets component structure.
 * All other code treats components as opaque A2UIComponent[] arrays.
 */
'use client';

import dynamic from 'next/dynamic';
import {A2UIViewer as BaseA2UIViewer} from '@a2ui/react';
import {viewerTheme} from './viewerTheme';
import type {A2UIComponent, SpecVersion} from '@/types/widget';

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

export function A2UIViewer({specVersion = '0.8', components, ...props}: A2UIViewerProps) {
  if (specVersion === '0.9') {
    return (
      <V09Viewer
        root={props.root}
        components={components as Array<{id: string; component: string; [key: string]: unknown}>}
        data={props.data}
        onAction={props.onAction}
      />
    );
  }

  return (
    <BaseA2UIViewer
      theme={viewerTheme}
      root={props.root}
      components={components as Array<{id: string; component: Record<string, unknown>}>}
      data={props.data}
      onAction={props.onAction as any}
      className={props.className}
    />
  );
}
