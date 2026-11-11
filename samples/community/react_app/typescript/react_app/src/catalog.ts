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

import {Catalog, type WebComponentImplementation} from '@a2ui/web_core/v1_0';
import {A2uiReactApp} from './react_app.js';

/** Identifier of the ReactApp catalog (`catalog/v1/catalog.json`). */
export const REACT_APP_CATALOG_ID = 'https://a2ui.org/labs/react_app/v1/catalog.json';

/**
 * The ReactApp catalog: the `ReactApp` component, ready to hand to a `MessageProcessor` next to
 * the host's other catalogs. The element is a universal (Lit) component, so the React renderer
 * (`@a2ui/react`), the Lit renderer and any renderer that renders `WebComponentImplementation`s
 * can show it. Configure where the runtime is served with `configureReactApp`.
 */
export const reactAppCatalog = new Catalog<WebComponentImplementation>(
  REACT_APP_CATALOG_ID,
  '1.0',
  [A2uiReactApp],
  [],
);
