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

import {ChangeDetectionStrategy, Component, OnInit, input} from '@angular/core';
import {CatalogComponentInstance} from '../core/catalog_component_instance';

/**
 * Placeholder Angular component for catalog entries that only provide a Web Component.
 *
 * `AngularCatalog` assigns it so every entry has a `component`. It is only instantiated when
 * `RendererConfiguration.useUniversalComponents` is off, in which case Web Components are not
 * rendered, so it renders nothing and reports the misconfiguration.
 */
@Component({
  selector: 'a2ui-v09-universal-only',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UniversalOnlyComponent implements CatalogComponentInstance, OnInit {
  readonly props = input<Record<string, unknown>>({});
  readonly surfaceId = input.required<string>();
  readonly componentId = input.required<string>();
  readonly dataContextPath = input<string>('/');

  ngOnInit(): void {
    console.error(
      `Component "${this.componentId()}" in surface "${this.surfaceId()}" is a Web Component ` +
        `and requires 'useUniversalComponents' to render.`,
    );
  }
}
