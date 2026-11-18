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

export {
  startEmbedApp,
  type EmbedAppHandle,
  type ModelContextOptions,
  type StartEmbedAppOptions,
} from './start_embed_app.js';
export {
  A2UI_STRUCTURED_KEY,
  ACTION_TOOL_NAME,
  ActionCallSchema,
  CONTRACT_VERSION,
  CatalogSchemaFileSchema,
  DEFAULT_RESOURCE_URI,
  EmbedPayloadSchema,
  checkContractVersion,
  readEmbedPayload,
  toToolResult,
  type ActionCall,
  type CatalogSchemaFile,
  type ContractVersionCheck,
  type EmbedPayload,
  type EmbedPayloadErrorCode,
  type EmbedToolResult,
  type ReadEmbedPayloadResult,
} from '../contract/index.js';
