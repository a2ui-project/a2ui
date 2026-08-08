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

import {Provider} from '@angular/core';
import {
  A2uiRendererService,
  A2UI_RENDERER_CONFIG,
  RendererConfiguration,
} from './a2ui-renderer.service';

/**
 * Provides the A2UI renderer configuration.
 *
 * @param configOrFactory The configuration or a factory function that returns the configuration.
 * @returns The providers for the A2UI renderer.
 */
export function provideA2Ui(
  configOrFactory: RendererConfiguration | (() => RendererConfiguration),
): Provider[] {
  return [
    A2uiRendererService,
    {
      provide: A2UI_RENDERER_CONFIG,
      ...(typeof configOrFactory === 'function'
        ? {useFactory: configOrFactory}
        : {useValue: configOrFactory}),
    },
  ];
}
