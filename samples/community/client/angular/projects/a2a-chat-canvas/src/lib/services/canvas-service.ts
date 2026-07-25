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

import * as Types from '@a2ui/web_core/types/types';
import {Injectable, signal} from '@angular/core';

/**
 * Service to manage the state of the canvas, which displays A2UI surfaces.
 */
@Injectable({
  providedIn: 'root',
})
export class CanvasService {
  /** The ID of the A2UI surface currently displayed in the canvas. */
  readonly surfaceId = signal<string | null>(null);
  /** The root component nodes of the A2UI surface to be rendered. */
  readonly contents = signal<Types.AnyComponentNode[] | null>(null);

  /**
   * Opens a specific A2UI surface in the canvas.
   * @param surfaceId The ID of the surface to open.
   * @param contents The root component nodes of the surface.
   */
  openSurfaceInCanvas(surfaceId: string, contents: Types.AnyComponentNode[]) {
    this.surfaceId.set(surfaceId);
    this.contents.set([...contents]);
  }
}
