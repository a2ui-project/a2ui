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

'use client';

import {Widget} from '@/types/widget';
import {A2UIViewer} from '@/lib/a2ui';

interface GalleryWidgetProps {
  widget: Widget;
  height?: number;
  onClick?: () => void;
}

export function GalleryWidget({widget, height = 200, onClick}: GalleryWidgetProps) {
  // Get the first data state's data for preview
  const previewData = widget.dataStates?.[0]?.data ?? {};

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={e => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick();
      }}
      className={`w-full text-left rounded-xl border border-white bg-white/80 p-4 shadow-sm transition-all hover:shadow-md hover:border-muted-foreground/30 overflow-hidden ${onClick ? 'cursor-pointer' : ''}`}
      style={{minHeight: height}}
    >
      <div className="flex flex-col gap-2 h-full">
        <span className="text-xs font-medium text-muted-foreground">{widget.name}</span>
        <div
          className="pointer-events-none flex-1 flex items-center justify-center"
          style={{'--a2ui-card-bg': 'transparent'} as React.CSSProperties}
        >
          <A2UIViewer
            root={widget.root}
            components={widget.components}
            data={previewData}
            specVersion={widget.specVersion}
          />
        </div>
      </div>
    </div>
  );
}
