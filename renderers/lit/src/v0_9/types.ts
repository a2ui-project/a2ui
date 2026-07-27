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

import {ComponentApi} from '@a2ui/web_core/v0_9';

/**
 * Interface representing an A2UI component implementation in Lit.
 *
 * Extends the framework-agnostic component API to include the Lit custom element
 * tag name. Used by A2uiNode to dynamically render the corresponding Lit component,
 * and as the type parameter when defining custom Catalogs.
 */
export interface LitComponentApi extends ComponentApi {
  tagName: string;
}
