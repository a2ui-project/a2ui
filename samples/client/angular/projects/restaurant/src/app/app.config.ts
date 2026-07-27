/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  A2uiRendererService,
  A2UI_RENDERER_CONFIG,
  BasicCatalog,
  provideMarkdownRenderer,
} from '@a2ui/angular/v0_9';
import {Client} from './client';
import {inject, Injector} from '@angular/core';
import {IMAGE_CONFIG} from '@angular/common';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {provideClientHydration, withEventReplay} from '@angular/platform-browser';
import {renderMarkdown} from '@a2ui/markdown-it';
import {A2uiClientAction} from '@a2ui/web_core/v0_9';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideClientHydration(withEventReplay()),
    {
      provide: A2UI_RENDERER_CONFIG,
      useFactory: () => {
        const injector = inject(Injector);
        return {
          catalogs: [new BasicCatalog()],
          actionHandler: (action: A2uiClientAction) => injector.get(Client).handleAction(action),
        };
      },
    },
    A2uiRendererService,
    provideMarkdownRenderer(renderMarkdown as any),
    {
      provide: IMAGE_CONFIG,
      useValue: {
        disableImageSizeWarning: true,
        disableImageLazyLoadWarning: true,
      },
    },
  ],
};
