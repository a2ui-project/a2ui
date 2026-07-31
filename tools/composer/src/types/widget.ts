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
 * Version-agnostic component type.
 *
 * Components are stored as opaque objects — the editor displays them as JSON
 * and the adapter interprets them based on specVersion. Only two places need
 * to understand the internal structure: the renderer adapter and the AI prompt.
 */
export type A2UIComponent = Record<string, unknown> & {id: string};

export interface DataState {
  name: string;
  data: Record<string, unknown>;
}

export type SpecVersion = '0.8' | '0.9';

export interface Widget {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  specVersion: SpecVersion;
  root: string;
  components: A2UIComponent[];
  dataStates: DataState[];
}
