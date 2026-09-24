/**
 * @license
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

export const DEFAULT_ROOT_ID = 'root';

// Message types (v0.8)
export const MSG_TYPE_BEGIN_RENDERING = 'beginRendering';
export const MSG_TYPE_SURFACE_UPDATE = 'surfaceUpdate';
export const MSG_TYPE_DATA_MODEL_UPDATE = 'dataModelUpdate';
export const MSG_TYPE_DELETE_SURFACE = 'deleteSurface';

// Message types (v0.9 and v1.0)
export const MSG_TYPE_CREATE_SURFACE = 'createSurface';
export const MSG_TYPE_UPDATE_COMPONENTS = 'updateComponents';
export const MSG_TYPE_UPDATE_DATA_MODEL = 'updateDataModel';

// Conversational text (non-A2UI)
export const MSG_TYPE_TEXT = 'text';

// Tag markers for the Direct JSON format
export const A2UI_OPEN_TAG = '<a2ui-json>';
export const A2UI_CLOSE_TAG = '</a2ui-json>';

// Tag markers for the compiled inference formats (Express). Match Python's A2UI_INFERENCE_OPEN_TAG/CLOSE_TAG.
export const A2UI_INFERENCE_OPEN_TAG = '<a2ui>';
export const A2UI_INFERENCE_CLOSE_TAG = '</a2ui>';

export const A2UI_SCHEMA_BLOCK_START = '---BEGIN A2UI JSON SCHEMA---';
export const A2UI_SCHEMA_BLOCK_END = '---END A2UI JSON SCHEMA---';

// Workflow rules for the Direct JSON format's system prompt.
export const DEFAULT_WORKFLOW_RULES = `
The generated response MUST follow these rules:
- The response can contain one or more A2UI JSON blocks.
- Each A2UI JSON block MUST be wrapped in \`${A2UI_OPEN_TAG}\` and \`${A2UI_CLOSE_TAG}\` tags.
- Between or around these blocks, you can provide conversational text.
- The JSON part MUST be a single, raw JSON object (usually a list of A2UI messages) and MUST validate against the provided A2UI JSON SCHEMA.
- Top-Down Component Ordering: Within the \`components\` list of a message:
    - The 'root' component MUST be the FIRST element.
    - Parent components MUST appear before their child components.
    This specific ordering allows the streaming parser to yield and render the UI incrementally as it arrives.
`;
