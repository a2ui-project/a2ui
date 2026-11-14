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

/**
 * Protocol message checks that the specification's JSON Schemas cannot
 * express. Each runs on a message that already passed schema validation.
 *
 * Rules the JSON Schemas do express are not repeated here: for example v1.0's
 * "a component cannot be `Surface`" (`agent_to_renderer.json`) and the
 * outbound error code rules (`client_to_server.json`, `renderer_to_agent.json`).
 */

import type {A2uiIssue} from '../../schema-engine/types.js';

export {checkV08ComponentIds} from './component-ids.js';
export {checkV08ExactlyOneKey} from './exactly-one-key.js';

/** A protocol message check, run after a successful schema check. */
export type IntegrityCheck = (message: unknown) => A2uiIssue[];
