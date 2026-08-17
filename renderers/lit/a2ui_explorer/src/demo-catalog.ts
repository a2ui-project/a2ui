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

import {Catalog} from '@a2ui/web_core/v0_9';
import {BASIC_FUNCTIONS} from '@a2ui/web_core/v0_9/basic_catalog';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {customSliderComponent} from './custom-slider.js';
import {customGridComponent} from './custom-grid.js';

/**
 * A catalog specific to the demo, extending the basic catalog with custom components.
 */
export const demoCatalog = new Catalog(
  basicCatalog.id,
  [...basicCatalog.components.values(), customSliderComponent, customGridComponent],
  BASIC_FUNCTIONS,
);
