/**
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
 * Gallery widget registry.
 *
 * Exports version-specific gallery arrays. The gallery page selects
 * which set to display based on the global SpecVersion context.
 */
export {V08_GALLERY_WIDGETS} from './v08';
export {V09_GALLERY_WIDGETS} from './v09';

// Re-export all individual widgets for direct imports
export * from './v08';
export * from './v09';
