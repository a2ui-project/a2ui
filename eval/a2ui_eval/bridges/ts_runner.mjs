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
import {MessageProcessor, STRICT_VALIDATION} from '@a2ui/web_core';

function toWireVersion(version) {
  const cleaned = String(version || '0.9.1').trim();
  return cleaned.startsWith('v') ? cleaned : `v${cleaned}`;
}

function loadCatalog(resolvedCatalogPath, version) {
  const wireVersion = toWireVersion(version);
  const rawDoc = JSON.parse(fs.readFileSync(resolvedCatalogPath, 'utf8'));
  const fallbackVersion = rawDoc.protocolVersion ? undefined : wireVersion;
  const fallbackCatalogId =
    rawDoc.catalogId || rawDoc.$id || 'https://a2ui.org/eval/default_catalog';
  const catalogConfig = CatalogConfig.fromPath(
    resolvedCatalogPath,
    undefined,
    fallbackVersion,
    rawDoc.catalogId ? undefined : fallbackCatalogId,
  );
  return catalogConfig.transformedCatalog;
}

function createStrategy(formatName, catalog, surfaceId) {
  if (formatName === 'direct_json') {
    return new DirectJsonFormat([catalog]);
  }
  if (formatName === 'express') {
    return new ExpressFormat([catalog], {
      surfaceId: surfaceId || 'main',
    });
  }
  throw new Error(`Unknown format strategy for TypeScript SDK: ${formatName}`);
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
    } = req;

    const catalog = loadCatalog(resolvedCatalogPath, version);
    const strategy = createStrategy(formatName, catalog, surfaceId);

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

      const parts = parser.parseResponse(completion);
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

      const processor = new MessageProcessor([catalog], undefined, {
        validationConfig: STRICT_VALIDATION,
      });
      processor.processMessages(compiledJsons);

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
