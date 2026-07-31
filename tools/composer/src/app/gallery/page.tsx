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

import {useState} from 'react';
import {useRouter} from 'next/navigation';
import dynamic from 'next/dynamic';
const GalleryWidget = dynamic(
  () => import('@/components/gallery/gallery-widget').then(mod => mod.GalleryWidget),
  {ssr: false},
);
import {WidgetPreviewModal} from '@/components/gallery/widget-preview-modal';
import {Widget} from '@/types/widget';
import {useWidgets} from '@/contexts/widgets-context';
import {useSpecVersion} from '@/contexts/spec-version-context';
import {V08_GALLERY_WIDGETS, V09_GALLERY_WIDGETS} from '@/data/gallery';

export default function GalleryPage() {
  const [selectedWidget, setSelectedWidget] = useState<Widget | null>(null);
  const {addWidget} = useWidgets();
  const router = useRouter();
  const {specVersion, isLoaded} = useSpecVersion();

  const galleryWidgets = specVersion === '0.9' ? V09_GALLERY_WIDGETS : V08_GALLERY_WIDGETS;

  const handleOpenInEditor = async () => {
    if (!selectedWidget) return;

    // Create a new widget with a unique ID but copy the content
    const newWidget: Widget = {
      ...selectedWidget,
      id: crypto.randomUUID(),
      name: `${selectedWidget.name} (Copy)`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save to storage
    await addWidget(newWidget);

    // Close modal and navigate to editor
    setSelectedWidget(null);
    router.push(`/widget/${newWidget.id}`);
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <h1 className="mb-6 text-2xl font-semibold">Gallery</h1>
      <div
        className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4 2xl:columns-5"
        style={{columnWidth: '308px'}}
      >
        {!isLoaded
          ? null
          : galleryWidgets.map(item => (
              <div key={item.widget.id} className="mb-4 break-inside-avoid">
                <GalleryWidget
                  widget={item.widget}
                  height={item.height}
                  onClick={() => setSelectedWidget(item.widget)}
                />
              </div>
            ))}
      </div>

      {selectedWidget && (
        <WidgetPreviewModal
          widget={selectedWidget}
          onClose={() => setSelectedWidget(null)}
          onOpenInEditor={handleOpenInEditor}
        />
      )}
    </div>
  );
}
