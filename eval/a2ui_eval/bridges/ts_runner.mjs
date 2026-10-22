// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Node ESM bridge runner for evaluating the TypeScript A2UI Agent SDK (@a2ui/agent).
 *
 * Reads a JSON request from stdin and writes a JSON response to stdout.
 */

import * as fs from 'node:fs';

import {CatalogConfig, DirectJsonFormat, ExpressFormat} from '@a2ui/agent';

function toWireVersion(version) {
  const cleaned = String(version ?? '').trim();
  if (!cleaned) {
    return undefined;
  }
  return cleaned.startsWith('v') ? cleaned : `v${cleaned}`;
}

/**
 * Loads the catalog the way the Python bridge does with
 * `CatalogConfig.from_path(path, protocol_version=version)`: the requested
 * version fills in a missing `protocolVersion` and must match a stated one, and
 * the catalog must state its own `catalogId`.
 */
function loadCatalog(resolvedCatalogPath, version) {
  return CatalogConfig.fromPath(resolvedCatalogPath, undefined, toWireVersion(version))
    .transformedCatalog;
}

function createStrategy(formatName, catalog, version, surfaceId) {
  if (formatName === 'direct_json') {
    return new DirectJsonFormat([catalog]);
  }
  if (formatName === 'express') {
    return new ExpressFormat([catalog], {
      surfaceId: surfaceId || 'main',
      version: toWireVersion(version),
    });
  }
  throw new Error(`Unknown format strategy for TypeScript SDK: ${formatName}`);
}

/** Splits a response and compiles its blocks without checking them. */
function compileOnly(parser, completion) {
  return parser
    .unwrap(completion)
    .map(raw =>
      raw.type === 'text'
        ? {type: 'text', text: raw.text}
        : {type: 'a2ui', a2ui: parser.compile(raw.a2uiRaw, raw.isFinal)},
    );
}

function main() {
  try {
    const rawInput = fs.readFileSync(0, 'utf8');
    const req = JSON.parse(rawInput);
    const {
      action,
      format_name: formatName,
      version,
      resolved_catalog_path: resolvedCatalogPath,
      surface_id: surfaceId = 'main',
      completion = '',
      require_complete_tags: requireCompleteTags = false,
      validate = true,
    } = req;

    const catalog = loadCatalog(resolvedCatalogPath, version);
    const strategy = createStrategy(formatName, catalog, version, surfaceId);

    if (action === 'generate_prompt') {
      const prompt = strategy.promptGenerator.generate();
      process.stdout.write(JSON.stringify({result: prompt}));
      return;
    }

    if (action === 'parse_and_validate') {
      const parser = strategy.createParser();
      if (requireCompleteTags && !parser.hasFormatContent(completion, {complete: true})) {
        if (formatName === 'direct_json') {
          throw new Error("A2UI tags '<a2ui-json>' and '</a2ui-json>' not found in response.");
        }
        throw new Error("A2UI tags '<a2ui>' and '</a2ui>' not found in response.");
      }

      // When `validate` is true, the parser checks the messages against a new renderer
      // state, so they must form complete surfaces. Otherwise the blocks are only compiled.
      const parts = validate ? parser.parseResponse(completion) : compileOnly(parser, completion);
      const compiledJsons = [];
      const serializedParts = [];

      for (const part of parts) {
        if (part.type === 'text') {
          serializedParts.push({text: part.text, a2ui_json: null});
        } else if (part.type === 'a2ui') {
          serializedParts.push({text: '', a2ui_json: part.a2ui});
          compiledJsons.push(...part.a2ui);
        }
      }

      if (compiledJsons.length === 0) {
        if (formatName === 'direct_json') {
          throw new Error('No A2UI JSON found in response (tags missing or empty)');
        }
        throw new Error(`No compiled A2UI ${formatName} user interface found in parsed parts.`);
      }

      process.stdout.write(
        JSON.stringify({
          result: {
            compiled_jsons: compiledJsons,
            parts: serializedParts,
          },
        }),
      );
      return;
    }

    throw new Error(`Unsupported bridge action: ${action}`);
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack || ''}` : String(err);
    process.stdout.write(JSON.stringify({error: message.trim()}));
  }
}

main();
