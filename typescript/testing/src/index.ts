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
 * A2UI surface test harness.
 *
 * Drives an A2UI payload through the identifiers in its JSON: component ids,
 * property names, data model paths, and action names. Catalog packages extend
 * it with plugins; for MCP surfaces, pair it with `@a2ui/catalog-mcp/testing`.
 *
 * ```ts
 * const mcp = stubMcp({tools: {get_forecast: 'Sunny'}});
 * const h = await createSurfaceHarness({messages: surfaceJson, plugins: [mcp]});
 * await h.setValue('city_field', 'Seattle');
 * await h.click('search_button');
 * expect(mcp.calls).toEqual([{name: 'get_forecast', arguments: {city: 'Seattle'}}]);
 * expect(h.prop('result_text', 'text')).toBe('Sunny');
 * ```
 */

export {createCoreDriver} from './drivers/core.js';
export {SurfaceHarnessError, createSurfaceHarness} from './harness.js';
export type {
  ComponentRef,
  InteractOptions,
  SurfaceDriver,
  SurfaceHarness,
  SurfaceHarnessOptions,
  SurfaceHarnessPlugin,
  TargetOptions,
} from './types.js';
