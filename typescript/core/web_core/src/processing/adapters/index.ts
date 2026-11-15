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

export {
  isCatalogVersionCompatible,
  registerKnownActionsProvider,
  type ProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS,
  DEFAULT_CATALOG_COMPATIBILITY,
  type VersionAdapterResolver,
  type VersionAdapter,
  type KnownActionsProvider,
  BaseVersionAdapter,
} from './base.js';
export {V0Point8Adapter} from './v0_8.js';
export {V0Point9Adapter} from './v0_9.js';
export {V1Point0Adapter} from './v1_0.js';
export {VersionAdapterFactory, defaultVersionAdapterFactory} from './factory.js';
