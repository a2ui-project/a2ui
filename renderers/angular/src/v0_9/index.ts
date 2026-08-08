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

/**
 * Public API surface for A2UI Angular Renderer v0.9.
 *
 * @module v0.9
 */

// Core Services and Components
export * from './core/a2ui-renderer.service';
export * from './core/component-host.component';
export * from './core/surface.component';
export * from './core/catalog_component';
export * from './core/catalog_component_instance';
export * from './core/component-binder.service';
export * from './core/types';
export * from './core/utils';
export * from './core/markdown';

// Catalog Types and Implementations
export * from './catalog/types';
export * from './catalog/to_web_component';
export * from './catalog/basic/basic-catalog';
