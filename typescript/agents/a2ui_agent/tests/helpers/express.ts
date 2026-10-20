/*
 * Copyright 2024 Google LLC
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

/**
 * Builds Express test inputs and reads Express output for tests.
 */

import {ExpressCompiler} from '../../src/inference-formats/express/compiler.js';
import {CatalogApi} from '../../src/internal/web-core.js';

/**
 * Returns a v0.9 `createSurface` message.
 *
 * The v0.9 builders return plain objects because `AgentToRendererMessage` describes
 * v1.0 messages; callers serialize them into example JSON.
 */
export function surface(surfaceId: string, catalogId: string) {
  return {version: 'v0.9', createSurface: {surfaceId, catalogId}};
}

/** Returns a v0.9 `updateComponents` message whose root is a `Text` showing `value`. */
export function text(surfaceId: string, value: string) {
  return {
    version: 'v0.9',
    updateComponents: {surfaceId, components: [{id: 'root', component: 'Text', text: value}]},
  };
}

/** One surface of a compiled Express block. */
export interface CompiledSurface {
  id: string;
  /** Present when the block created the surface rather than only updating it. */
  catalogId?: string;
  components: Array<Record<string, unknown>>;
}

/**
 * Compiles Express output and returns its surfaces, in order.
 *
 * Each `createSurface` message starts a new entry, so a block that opens the same
 * surface twice yields two entries. Component updates attach to the latest entry for
 * their surface.
 *
 * @param text Express output. When it holds `<a2ui>` tags, only the tagged blocks are
 *     compiled, so a whole prompt text works too.
 * @param cat The catalog to compile against.
 * @param version The protocol version to compile to.
 */
export function compileSurfaces(
  text: string,
  cat: CatalogApi,
  version = 'v0.9',
): CompiledSurface[] {
  const surfaces: CompiledSurface[] = [];
  for (const msg of new ExpressCompiler([cat], version).compile(text)) {
    const {createSurface, updateComponents} = msg as {
      createSurface?: {surfaceId: string; catalogId?: string};
      updateComponents?: {surfaceId: string; components: Array<Record<string, unknown>>};
    };
    if (createSurface) {
      const {surfaceId: id, catalogId} = createSurface;
      surfaces.push({id, catalogId, components: []});
    }
    if (updateComponents) {
      let target = surfaces.findLast(s => s.id === updateComponents.surfaceId);
      if (!target) {
        target = {id: updateComponents.surfaceId, components: []};
        surfaces.push(target);
      }
      target.components.push(...updateComponents.components);
    }
  }
  return surfaces;
}
