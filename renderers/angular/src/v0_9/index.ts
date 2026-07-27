/*
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

/**
 * Public API surface for A2UI Angular Renderer v0.9.
 *
 * This module provides the core services, components, and catalogs required
 * to render A2UI surfaces using the v0.9 protocol.
 *
 * @module v0.9
 */

// Core Services and Components
export * from './core/a2ui-renderer.service';
export * from './core/component-host.component';
export * from './core/surface.component';
export * from './core/catalog_component';
export * from './core/component-binder.service';
export * from './core/types';
export * from './core/utils';
export * from './core/markdown';

// Catalog Types and Implementations
export * from './catalog/types';
export * from './catalog/basic/basic-catalog';

// Basic Catalog Components
export * from './catalog/basic/text.component';
export * from './catalog/basic/row.component';
export * from './catalog/basic/column.component';
export * from './catalog/basic/button.component';
export * from './catalog/basic/text-field.component';
export * from './catalog/basic/image.component';
export * from './catalog/basic/icon.component';
export * from './catalog/basic/video.component';
export * from './catalog/basic/audio-player.component';
export * from './catalog/basic/list.component';
export * from './catalog/basic/card.component';
export * from './catalog/basic/tabs.component';
export * from './catalog/basic/modal.component';
export * from './catalog/basic/divider.component';
export * from './catalog/basic/check-box.component';
export * from './catalog/basic/choice-picker.component';
export * from './catalog/basic/slider.component';
export * from './catalog/basic/date-time-input.component';
