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

import {Catalog, ComponentApi, FunctionApi} from './internal/web_core.js';

export type {ProtocolVersion} from './internal/web_core.js';

/**
 * A schema-only parameterization of the A2UI Catalog.
 *
 * An agent never executes catalog functions, so it only needs their signatures.
 * This type aliases `Catalog<ComponentApi, FunctionApi>` to reflect that.
 */
export type SchemaCatalog = Catalog<ComponentApi, FunctionApi>;
