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
 * Declares typings for CSS Modules (*.module.css) files.
 * This allows the TypeScript compiler to resolve CSS class imports as a
 * read-only dictionary of string mappings.
 *
 * This is needed because we typecheck @a2ui/react from source (via path
 * mappings) rather than consuming its compiled build output, which requires
 * the TypeScript compiler to resolve CSS Module imports inside the parent library.
 */
declare module '*.module.css' {
  const classes: {readonly [key: string]: string};
  export default classes;
}
