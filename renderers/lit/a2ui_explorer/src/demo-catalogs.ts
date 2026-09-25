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

import {IFRAME_CATALOG_ID, iframeCatalog} from '@a2ui/catalog-iframe';
import {createMcpCatalogFunctions, MCP_CATALOG_ID, mcpCatalog} from '@a2ui/catalog-mcp';
import {basicCatalog, LitComponentApi} from '@a2ui/lit/v0_9';
import {Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';

/**
 * Builds the catalogs of the iframe and MCP examples, to register next to the basic catalog.
 *
 * A surface is bound to the one catalog its `createSurface.catalogId` names, and the examples of
 * both catalogs mix their components with basic ones. Each catalog therefore carries the basic
 * components and functions as well, under its own id.
 *
 * The MCP catalog also gets `callMcpTool`, with a client resolver that rejects every call: the
 * explorer has no MCP server, and the rejection tells a tester so instead of failing with an
 * unknown function. `callMcpTool` needs the processor that receives the messages of tool results,
 * and `MessageProcessor` reads its catalog array lazily, so the caller creates the processor over
 * an array first and pushes these catalogs into it afterwards.
 *
 * @param processor The processor the catalogs are registered with.
 */
export function createDemoCatalogs(
  processor: MessageProcessor<LitComponentApi>,
): Catalog<LitComponentApi>[] {
  const basicComponents = [...basicCatalog.components.values()];
  const basicFunctions = [...basicCatalog.functions.values()];
  return [
    new Catalog<LitComponentApi>(
      IFRAME_CATALOG_ID,
      [...basicComponents, ...iframeCatalog.components.values()],
      basicFunctions,
    ),
    new Catalog<LitComponentApi>(
      MCP_CATALOG_ID,
      [...basicComponents, ...mcpCatalog.components.values()],
      [...basicFunctions, ...createMcpCatalogFunctions(rejectMcpToolCall, processor)],
    ),
  ];
}

/** The client resolver of `callMcpTool` in the explorer, which is not connected to an MCP server. */
async function rejectMcpToolCall(toolName: string): Promise<never> {
  throw new Error(
    `The explorer is not connected to an MCP server, so the MCP tool '${toolName}' cannot be ` +
      'called. The MCP samples under samples/community run tool calls end to end.',
  );
}
