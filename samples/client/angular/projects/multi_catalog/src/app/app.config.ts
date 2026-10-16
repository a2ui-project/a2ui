/*
 * Copyright 2026 Google LLC
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

import {BasicCatalog, provideA2UI, provideMarkdownRenderer} from '@a2ui/angular';
import {renderMarkdown} from '@a2ui/markdown-it';
import {ActionPayload} from '@a2ui/web_core/v1_0';
import {
  ApplicationConfig,
  inject,
  Injector,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {provideClientHydration, withEventReplay} from '@angular/platform-browser';

import {Client} from './client';
import {DASHBOARD_CATALOG} from './dashboard-catalog/catalog';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideClientHydration(withEventReplay()),
    // The A2UI v1.0 renderer holds both catalogs. A surface names its default
    // catalog in `createSurface`, and a component from another catalog names
    // that catalog in its own `catalogId`, so one surface can mix them.
    provideA2UI(() => {
      const injector = inject(Injector);
      return {
        catalogs: [inject(BasicCatalog), DASHBOARD_CATALOG],
        actionHandler: (action: ActionPayload) => injector.get(Client).handleAction(action),
      };
    }),
    // The basic catalog's Text renders Markdown.
    provideMarkdownRenderer(renderMarkdown),
  ],
};
