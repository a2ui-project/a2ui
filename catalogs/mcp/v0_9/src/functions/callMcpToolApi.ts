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

import {z} from 'zod';

/**
 * Function API definition for `callMcpTool`.
 *
 * Arguments:
 * - `name`: The name of the MCP tool to execute.
 * - `arguments`: Optional arguments object passed to the MCP tool.
 */
export const CallMcpToolApi = {
  name: 'callMcpTool' as const,
  returnType: 'any' as const,
  schema: z.object({
    name: z.string().describe('The name of the MCP tool to execute.'),
    arguments: z
      .record(z.any())
      .optional()
      .default({})
      .describe('The arguments to pass to the MCP tool.'),
  }),
  description: 'Invokes a tool on a connected Model Context Protocol (MCP) server.',
};
