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

import type {z} from 'zod';
import type {ComponentApi} from '../catalog/types.js';

/**
 * An implementation of a UI component using Web Components (Custom Elements).
 * Extends ComponentApi to include the Custom Element's tag name.
 *
 * @template Schema the Zod schema type for the component's properties.
 */
export interface WebComponentImplementation<
  Schema extends z.ZodTypeAny = z.ZodTypeAny,
> extends ComponentApi<Schema> {
  /** The HTML tag name of the Custom Element registered for this component. */
  readonly tagName: string;
}
