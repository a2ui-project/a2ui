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
 * Reads a JSON request from stdin and writes a JSON response to stdout. The
 * request's optional `options` field is the `to_dict()` form of the Python
 * `BridgeOptions` dataclass, so its keys are snake_case (`catalog_id`,
 * `allowed_components`, `allowed_functions`, `allowed_messages`,
 * `initial_renderer_state`, `stream_chunk_size`).
 */

import * as fs from 'node:fs';

import {
  CatalogConfig,
  ComponentPruningTransformer,
  DirectJsonFormat,
  DirectJsonPromptGenerator,
  ExpressFormat,
  FunctionPruningTransformer,
  RendererState,
} from '@a2ui/agent';

/**
 * Normalizes a protocol version string to its `v`-prefixed wire form.
 *
 * @param {string|undefined} version Protocol version string (e.g. '1.0' or 'v1.0').
 * @return {string|undefined} Wire-formatted version string, or undefined if empty.
 */
function toWireVersion(version) {
  const cleaned = String(version ?? '').trim();
  if (!cleaned) {
    return undefined;
  }
  return cleaned.startsWith('v') ? cleaned : `v${cleaned}`;
}

/**
 * Builds the pruning transformers a catalog spec asks for.
 *
 * @param {!Object} spec Catalog specification object.
 * @return {!Array<!Object>} Ordered list of catalog transformers.
 */
function buildTransformers(spec) {
  const transformers = [];
  if (Array.isArray(spec.allowed_components)) {
    transformers.push(new ComponentPruningTransformer(spec.allowed_components));
  }
  if (Array.isArray(spec.allowed_functions)) {
    transformers.push(new FunctionPruningTransformer(spec.allowed_functions));
  }
  return transformers;
}

/**
 * Loads one catalog the way the Python bridge does with
 * `CatalogConfig.from_path(path, transformers=..., protocol_version=version,
 * catalog_id=...)`: the requested version fills in a missing `protocolVersion`
 * and must match a stated one, and `catalog_id` fills in a missing `catalogId`.
 *
 * @param {!Object} spec Catalog specification object with `path` and optional filters.
 * @param {string|undefined} version Requested A2UI protocol version.
 * @return {!Object} Transformed catalog instance.
 */
function loadCatalog(spec, version) {
  return CatalogConfig.fromPath(
    spec.path,
    buildTransformers(spec),
    toWireVersion(version),
    spec.catalog_id ?? undefined,
  ).transformedCatalog;
}

/**
 * Reads one example file: a JSON array of agent-to-renderer messages, or an
 * object with a `messages` array.
 *
 * @param {string} path Filesystem path to the JSON example file.
 * @return {!Array<!Object>} Array of A2UI envelope messages.
 */
function readExampleFile(path) {
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  const messages = Array.isArray(data) ? data : data?.messages;
  if (!Array.isArray(messages)) {
    throw new Error(
      `Example file ${path} must hold a JSON array of messages or {messages: [...]}.`,
    );
  }
  return messages;
}

/**
 * Loads the catalogs named by `payload.options.catalogs` (or the single
 * `catalogPath` when there are none) together with their few-shot examples.
 *
 * @param {!Object} payload Bridge request payload.
 * @param {string|undefined} version Requested A2UI protocol version.
 * @return {{catalogs: !Array<!Object>, examplesByCatalog: (!Object|undefined)}}
 *     Loaded catalogs and optional map of catalog ID to ordered example turns.
 */
function loadCatalogsAndExamples(payload, version) {
  const specs = payload.options?.catalogs?.length
    ? payload.options.catalogs
    : [{path: payload.resolved_catalog_path}];
  const catalogs = [];
  const examplesByCatalog = {};
  let hasExamples = false;
  for (const spec of specs) {
    const catalog = loadCatalog(spec, version);
    catalogs.push(catalog);
    const turns = (spec.examples ?? []).map(readExampleFile);
    if (turns.length > 0) {
      hasExamples = true;
      examplesByCatalog[catalog.id] = turns;
    }
  }
  return {catalogs, examplesByCatalog: hasExamples ? examplesByCatalog : undefined};
}

/**
 * Flattens per-catalog example turns into an ordered list of turns for Direct JSON.
 *
 * The Direct JSON prompt generator renders examples keyed by catalog id as one
 * turn per catalog, so several turns per catalog are passed as an ordered list
 * of turns instead (rendered once, in catalog order).
 *
 * @param {!Object|undefined} examplesByCatalog Map of catalog ID to example turns.
 * @return {!Array<!Array<!Object>>|undefined} Flattened list of example turns, or undefined.
 */
function toDirectJsonExamples(examplesByCatalog) {
  if (!examplesByCatalog) {
    return undefined;
  }
  return Object.values(examplesByCatalog).flat();
}

/**
 * Instantiates the requested TypeScript inference format strategy.
 *
 * @param {string} formatName Format identifier ('direct_json' or 'express').
 * @param {!Array<!Object>} catalogs Active catalog configurations.
 * @param {!Object|undefined} examplesByCatalog Optional map of catalog ID to examples.
 * @param {!Array<string>|undefined} allowedMessages Optional message type allowlist.
 * @param {string|undefined} version Requested A2UI protocol version.
 * @param {string|undefined} surfaceId Default surface ID.
 * @return {!Object} Configured inference format instance.
 */
function createStrategy(
  formatName,
  catalogs,
  examplesByCatalog,
  allowedMessages,
  version,
  surfaceId,
) {
  if (formatName === 'direct_json') {
    const examples = toDirectJsonExamples(examplesByCatalog);
    const format = new DirectJsonFormat(catalogs, examples);
    if (allowedMessages !== undefined) {
      // DirectJsonFormat does not forward an allowlist to its prompt generator.
      format.promptGenerator = new DirectJsonPromptGenerator(catalogs, examples, allowedMessages);
    }
    return format;
  }
  if (formatName === 'express') {
    return new ExpressFormat(catalogs, {
      surfaceId: surfaceId || 'main',
      version: toWireVersion(version),
      examples: examplesByCatalog,
      allowedMessages,
    });
  }
  throw new Error(`Unknown format strategy for TypeScript SDK: ${formatName}`);
}

/**
 * Verifies that the completion contains complete opening and closing A2UI tags.
 *
 * @param {!Object} parser Format parser instance.
 * @param {string} formatName Format identifier ('direct_json' or 'express').
 * @param {string} completion Raw model completion text.
 */
function checkCompleteTags(parser, formatName, completion) {
  if (parser.hasFormatContent(completion, {complete: true})) {
    return;
  }
  if (formatName === 'direct_json') {
    throw new Error("A2UI tags '<a2ui-json>' and '</a2ui-json>' not found in response.");
  }
  throw new Error("A2UI tags '<a2ui>' and '</a2ui>' not found in response.");
}

/**
 * Splits a response and compiles its blocks without checking them.
 *
 * @param {!Object} parser Format parser instance.
 * @param {string} completion Raw model completion text.
 * @return {!Array<!Object>} Parsed text and compiled A2UI parts.
 */
function compileOnly(parser, completion) {
  return parser
    .unwrap(completion)
    .map(raw =>
      raw.type === 'text'
        ? {type: 'text', text: raw.text}
        : {type: 'a2ui', a2ui: parser.compile(raw.a2uiRaw, raw.isFinal)},
    );
}

/**
 * Splits parsed parts into the wire form and the flat list of compiled messages.
 *
 * @param {!Array<!Object>} parts Parsed text and A2UI parts.
 * @return {{compiledJsons: !Array<!Object>, serializedParts: !Array<!Object>}}
 *     Flat list of compiled messages and serialized response parts.
 */
function serializeParts(parts) {
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
  return {compiledJsons, serializedParts};
}

/**
 * Ensures at least one A2UI message was compiled from the completion.
 *
 * @param {!Array<!Object>} compiledJsons Compiled A2UI messages.
 * @param {string} formatName Format identifier ('direct_json' or 'express').
 */
function requireCompiledJsons(compiledJsons, formatName) {
  if (compiledJsons.length > 0) {
    return;
  }
  if (formatName === 'direct_json') {
    throw new Error('No A2UI JSON found in response (tags missing or empty)');
  }
  throw new Error(`No compiled A2UI ${formatName} user interface found in parsed parts.`);
}

/**
 * Builds a RendererState seeded with any initial renderer state messages.
 *
 * @param {!Array<!Object>} catalogs Active catalog configurations.
 * @param {!Array<!Object>|undefined} initialState Optional seed messages.
 * @return {!RendererState} Seeded renderer state instance.
 */
function buildInitialState(catalogs, initialState) {
  const state = new RendererState(catalogs);
  if (Array.isArray(initialState) && initialState.length > 0) {
    state.checkTopology(state.apply(initialState));
  }
  return state;
}

/**
 * Feeds the completion through a fresh streaming parser in `chunkSize`-character
 * slices and fails when the streamed parse throws or yields no A2UI part.
 *
 * @param {!Object} parser Format parser instance.
 * @param {!Array<!Object>} catalogs Active catalog configurations.
 * @param {!Array<!Object>|undefined} initialState Optional seed messages.
 * @param {string} completion Raw model completion text.
 * @param {number} chunkSize Character slice size per streaming feed call.
 */
function checkStreamedParse(parser, catalogs, initialState, completion, chunkSize) {
  const stream = parser.openStream({state: buildInitialState(catalogs, initialState)});
  let sawA2ui = false;
  for (let start = 0; start < completion.length; start += chunkSize) {
    let parts;
    try {
      parts = stream.feed(completion.slice(start, start + chunkSize));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Streamed parse failed at offset ${start} (chunk size ${chunkSize}): ${detail}`,
      );
    }
    sawA2ui = sawA2ui || parts.some(part => part.type === 'a2ui');
  }
  try {
    const tail = stream.close();
    sawA2ui = sawA2ui || tail.some(part => part.type === 'a2ui');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Streamed parse failed on close (chunk size ${chunkSize}): ${detail}`);
  }
  if (!sawA2ui) {
    throw new Error(
      `Streamed parse (chunk size ${chunkSize}) produced no A2UI part for a completion that parsed whole.`,
    );
  }
}

/**
 * Parses and optionally validates a model completion using the TypeScript SDK.
 *
 * @param {!Object} payload Bridge request payload.
 * @param {!Object} strategy Configured inference format instance.
 * @param {!Array<!Object>} catalogs Active catalog configurations.
 * @return {{compiled_jsons: !Array<!Object>, parts: !Array<!Object>}}
 *     Compiled A2UI messages and serialized response parts.
 */
function parseAndValidate(payload, strategy, catalogs) {
  const {
    format_name: formatName,
    completion = '',
    require_complete_tags: requireCompleteTags = false,
    validate = true,
  } = payload;
  const options = payload.options ?? {};

  const parser = strategy.createParser();
  if (requireCompleteTags) {
    checkCompleteTags(parser, formatName, completion);
  }
  // Compile raw blocks first so empty/missing A2UI blocks report the canonical
  // tag error before RendererState validation runs.
  const {compiledJsons, serializedParts} = serializeParts(compileOnly(parser, completion));
  requireCompiledJsons(compiledJsons, formatName);

  const chunkSize = options.stream_chunk_size;
  if (chunkSize !== undefined && chunkSize !== null) {
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      throw new Error(`stream_chunk_size must be a positive integer, got ${chunkSize}`);
    }
    if (strategy.supportsStreaming) {
      checkStreamedParse(parser, catalogs, options.initial_renderer_state, completion, chunkSize);
    }
  }
  if (validate) {
    const state = buildInitialState(catalogs, options.initial_renderer_state);
    state.checkTopology(state.apply(compiledJsons));
  }
  return {compiled_jsons: compiledJsons, parts: serializedParts};
}

/**
 * Dispatches a bridge request payload to `generate_prompt` or `parse_and_validate`.
 *
 * @param {!Object} payload Bridge request payload decoded from stdin.
 * @return {string|!Object} Generated prompt string or parse result object.
 */
function handleRequest(payload) {
  const {action, format_name: formatName, version, surface_id: surfaceId = 'main'} = payload;
  const {catalogs, examplesByCatalog} = loadCatalogsAndExamples(payload, version);
  const allowedMessages = payload.options?.allowed_messages ?? undefined;
  const strategy = createStrategy(
    formatName,
    catalogs,
    examplesByCatalog,
    allowedMessages,
    version,
    surfaceId,
  );

  if (action === 'generate_prompt') {
    return strategy.promptGenerator.generate();
  }
  if (action === 'parse_and_validate') {
    return parseAndValidate(payload, strategy, catalogs);
  }
  throw new Error(`Unsupported bridge action: ${action}`);
}

/** Reads a JSON request from stdin and writes the JSON response to stdout. */
function main() {
  try {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    process.stdout.write(JSON.stringify({result: handleRequest(payload)}));
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack || ''}` : String(err);
    process.stdout.write(JSON.stringify({error: message.trim()}));
  }
}

main();
