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

import {Injectable, OnDestroy} from '@angular/core';
import {NodeResolver, type SurfaceModel} from '@a2ui/web_core/v0_9';

import type {AngularComponentImplementation} from '../catalog/types';

/**
 * Owns the `NodeResolver` for one rendered surface.
 *
 * {@link SurfaceComponent} provides an instance per surface so every
 * {@link ComponentHostComponent} underneath it shares one resolved node tree
 * for the lifetime of the surface view. A host rendered outside a surface
 * component creates its own instance and disposes it when destroyed.
 */
@Injectable()
export class SurfaceNodeResolver implements OnDestroy {
  private resolver?: NodeResolver<AngularComponentImplementation>;
  private surface?: SurfaceModel<AngularComponentImplementation>;

  /**
   * Returns the resolver for `surface`, creating it on first use and replacing
   * (and disposing) the previous one when the surface changes.
   *
   * @param surface The surface model to resolve.
   */
  resolverFor(
    surface: SurfaceModel<AngularComponentImplementation>,
  ): NodeResolver<AngularComponentImplementation> {
    if (!this.resolver || this.surface !== surface) {
      this.resolver?.dispose();
      this.resolver = new NodeResolver(surface);
      this.surface = surface;
    }
    return this.resolver;
  }

  ngOnDestroy(): void {
    this.resolver?.dispose();
    this.resolver = undefined;
    this.surface = undefined;
  }
}
