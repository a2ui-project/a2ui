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

import {config} from 'zod/v4/core';

/**
 * Turns off zod 4's JIT parser before the MCP SDK defines its schemas.
 *
 * Without it, the first zod 4 object schema probes for `new Function`, which the default MCP Apps
 * CSP blocks and reports as a violation. The App SDK sets the same option, but only in the `App`
 * constructor, after the SDK's schemas exist. `start_embed_app.ts` imports this module first and
 * reads this constant, so bundlers keep it and run it before the SDK modules.
 */
export const ZOD_JITLESS = (() => {
  config({jitless: true});
  return true;
})();
