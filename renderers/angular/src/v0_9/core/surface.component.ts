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

import {ChangeDetectionStrategy, Component, input} from '@angular/core';
import {ComponentHostComponent} from './component-host.component';

/**
 * High-level component for rendering an entire A2UI surface.
 *
 * This component handles the boilerplate of setting up a {@link ComponentHostComponent}
 * for the 'root' component of a surface. It is the recommended way to embed an
 * A2UI surface in an Angular application.
 */
@Component({
  selector: 'a2ui-v09-surface',
  standalone: true,
  imports: [ComponentHostComponent],
  host: {
    style: 'display: contents;',
  },
  template: `
    <a2ui-v09-component-host
      [componentKey]="{id: 'root', basePath: dataContextPath()}"
      [surfaceId]="surfaceId()"
    >
    </a2ui-v09-component-host>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SurfaceComponent {
  /** The unique identifier of the surface to render. */
  surfaceId = input.required<string>();

  /**
   * The path within the surface's data model that represents the current state.
   * Defaults to the root ('/').
   */
  dataContextPath = input<string>('/');
}
