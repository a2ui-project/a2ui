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

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function findRepoRoot(startDir = __dirname) {
  let curr = startDir;
  for (let i = 0; i < 6; i++) {
    if (
      fs.existsSync(path.join(curr, 'specification')) &&
      fs.existsSync(path.join(curr, 'catalogs'))
    ) {
      return curr;
    }
    curr = path.resolve(curr, '..');
  }
  return path.resolve(__dirname, '../../../..');
}

/**
 * Canonical specification Markdown source-to-route registry (zero duplication via --8<--).
 */
export const SPEC_DOC_ROUTES = {
  'specification/v1_0/docs/a2ui_protocol.md': 'specification/v1.0-a2ui',
  'specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md':
    'specification/v1.0-a2ui-extension-specification',
  'specification/v1_0/docs/evolution_guide.md': 'specification/v1.0-evolution-guide',
  'catalogs/basic/v1/basic_catalog_implementation_guide.md':
    'specification/v1.0-basic-catalog-implementation-guide',

  'specification/v0_9_1/docs/a2ui_protocol.md': 'specification/v0.9.1-a2ui',
  'specification/v0_9_1/docs/a2ui_extension_specification.md':
    'specification/v0.9.1-a2ui-extension-specification',
  'specification/v0_9_1/docs/evolution_guide.md': 'specification/v0.9.1-evolution-guide',
  'specification/v0_9_1/docs/basic_catalog_implementation_guide.md':
    'specification/v0.9.1-basic-catalog-implementation-guide',

  'specification/v0_8/docs/a2ui_protocol.md': 'specification/v0.8-a2ui',
  'specification/v0_8/docs/a2ui_extension_specification.md': 'specification/v0.8-a2a-extension',
  'specification/v0_8/docs/custom_catalog_changes.md': 'specification/v0.8-custom-catalog-changes',
};

/**
 * Categorized JSON Schema catalog for v1.0, v0.9.1, and v0.8 (matching SITE_OUTLINE.md 4.2.1).
 */
export const SPEC_SCHEMAS = {
  'v1.0': [
    {
      category: 'Wire Messages',
      alias: 'agent_to_renderer.json',
      sourcePath: 'specification/v1_0/json/agent_to_renderer.json',
      rawPublicPath: '/specification/v1_0/agent_to_renderer.json',
    },
    {
      category: 'Wire Messages',
      alias: 'renderer_to_agent.json',
      sourcePath: 'specification/v1_0/json/renderer_to_agent.json',
      rawPublicPath: '/specification/v1_0/renderer_to_agent.json',
    },
    {
      category: 'Common Types',
      alias: 'common_types.json',
      sourcePath: 'specification/v1_0/json/common_types.json',
      rawPublicPath: '/specification/v1_0/common_types.json',
    },
    {
      category: 'Catalog Definition & Data Model',
      alias: 'catalog_definition.json',
      sourcePath: 'specification/v1_0/json/catalog_definition.json',
      rawPublicPath: '/specification/v1_0/catalog_definition.json',
    },
    {
      category: 'Catalog Definition & Data Model',
      alias: 'renderer_data_model.json',
      sourcePath: 'specification/v1_0/json/renderer_data_model.json',
      rawPublicPath: '/specification/v1_0/renderer_data_model.json',
    },
    {
      category: 'Capabilities',
      alias: 'agent_capabilities.json',
      sourcePath: 'specification/v1_0/json/agent_capabilities.json',
      rawPublicPath: '/specification/v1_0/agent_capabilities.json',
    },
    {
      category: 'Capabilities',
      alias: 'renderer_capabilities.json',
      sourcePath: 'specification/v1_0/json/renderer_capabilities.json',
      rawPublicPath: '/specification/v1_0/renderer_capabilities.json',
    },
    {
      category: 'Batching & Wrappers',
      alias: 'agent_to_renderer_list.json',
      sourcePath: 'specification/v1_0/json/agent_to_renderer_list.json',
      rawPublicPath: '/specification/v1_0/json/agent_to_renderer_list.json',
    },
    {
      category: 'Batching & Wrappers',
      alias: 'renderer_to_agent_list.json',
      sourcePath: 'specification/v1_0/json/renderer_to_agent_list.json',
      rawPublicPath: '/specification/v1_0/json/renderer_to_agent_list.json',
    },
    {
      category: 'Batching & Wrappers',
      alias: 'agent_to_renderer_list_wrapper.json',
      sourcePath: 'specification/v1_0/json/agent_to_renderer_list_wrapper.json',
      rawPublicPath: '/specification/v1_0/json/agent_to_renderer_list_wrapper.json',
    },
    {
      category: 'Batching & Wrappers',
      alias: 'renderer_to_agent_list_wrapper.json',
      sourcePath: 'specification/v1_0/json/renderer_to_agent_list_wrapper.json',
      rawPublicPath: '/specification/v1_0/json/renderer_to_agent_list_wrapper.json',
    },
  ],
  'v0.9.1': [
    {
      category: 'Wire Messages',
      alias: 'server_to_client.json',
      sourcePath: 'specification/v0_9_1/json/server_to_client.json',
      rawPublicPath: '/specification/v0_9_1/server_to_client.json',
    },
    {
      category: 'Wire Messages',
      alias: 'client_to_server.json',
      sourcePath: 'specification/v0_9_1/json/client_to_server.json',
      rawPublicPath: '/specification/v0_9_1/client_to_server.json',
    },
    {
      category: 'Common Types',
      alias: 'common_types.json',
      sourcePath: 'specification/v0_9_1/json/common_types.json',
      rawPublicPath: '/specification/v0_9_1/common_types.json',
    },
    {
      category: 'Data Model',
      alias: 'client_data_model.json',
      sourcePath: 'specification/v0_9_1/json/client_data_model.json',
      rawPublicPath: '/specification/v0_9_1/client_data_model.json',
    },
    {
      category: 'Capabilities',
      alias: 'server_capabilities.json',
      sourcePath: 'specification/v0_9_1/json/server_capabilities.json',
      rawPublicPath: '/specification/v0_9_1/server_capabilities.json',
    },
    {
      category: 'Capabilities',
      alias: 'client_capabilities.json',
      sourcePath: 'specification/v0_9_1/json/client_capabilities.json',
      rawPublicPath: '/specification/v0_9_1/client_capabilities.json',
    },
    {
      category: 'Batching & Wrappers',
      alias: 'server_to_client_list.json',
      sourcePath: 'specification/v0_9_1/json/server_to_client_list.json',
      rawPublicPath: '/specification/v0_9_1/server_to_client_list.json',
    },
    {
      category: 'Batching & Wrappers',
      alias: 'client_to_server_list.json',
      sourcePath: 'specification/v0_9_1/json/client_to_server_list.json',
      rawPublicPath: '/specification/v0_9_1/client_to_server_list.json',
    },
    {
      category: 'Batching & Wrappers',
      alias: 'server_to_client_list_wrapper.json',
      sourcePath: 'specification/v0_9_1/json/server_to_client_list_wrapper.json',
      rawPublicPath: '/specification/v0_9_1/server_to_client_list_wrapper.json',
    },
    {
      category: 'Batching & Wrappers',
      alias: 'client_to_server_list_wrapper.json',
      sourcePath: 'specification/v0_9_1/json/client_to_server_list_wrapper.json',
      rawPublicPath: '/specification/v0_9_1/client_to_server_list_wrapper.json',
    },
  ],
  'v0.8': [
    {
      category: 'Wire Messages',
      alias: 'server_to_client.json',
      sourcePath: 'specification/v0_8/json/server_to_client.json',
      rawPublicPath: '/specification/v0_8/server_to_client.json',
    },
    {
      category: 'Wire Messages',
      alias: 'client_to_server.json',
      sourcePath: 'specification/v0_8/json/client_to_server.json',
      rawPublicPath: '/specification/v0_8/client_to_server.json',
    },
    {
      category: 'Wire Messages',
      alias: 'server_to_client_with_standard_catalog.json',
      sourcePath: 'specification/v0_8/json/server_to_client_with_standard_catalog.json',
      rawPublicPath: '/specification/v0_8/server_to_client_with_standard_catalog.json',
    },
    {
      category: 'Catalogs & Capabilities',
      alias: 'standard_catalog_definition.json',
      sourcePath: 'specification/v0_8/json/standard_catalog_definition.json',
      rawPublicPath: '/specification/v0_8/standard_catalog_definition.json',
    },
    {
      category: 'Catalogs & Capabilities',
      alias: 'catalog_description_schema.json',
      sourcePath: 'specification/v0_8/json/catalog_description_schema.json',
      rawPublicPath: '/specification/v0_8/catalog_description_schema.json',
    },
    {
      category: 'Catalogs & Capabilities',
      alias: 'a2ui_client_capabilities_schema.json',
      sourcePath: 'specification/v0_8/json/a2ui_client_capabilities_schema.json',
      rawPublicPath: '/specification/v0_8/a2ui_client_capabilities_schema.json',
    },
    {
      category: 'Catalogs & Capabilities',
      alias: 'minimal_catalog.json',
      sourcePath: 'specification/v0_8/json/catalogs/minimal/minimal_catalog.json',
      rawPublicPath: '/specification/v0_8/json/catalogs/minimal/minimal_catalog.json',
    },
  ],
};

/**
 * Standalone catalog JSON Schemas presented alongside their respective implementation guides.
 */
export const SPEC_CATALOG_SCHEMAS = {
  'v1.0': [
    {
      category: 'Catalog Schema',
      alias: 'basic_catalog.json',
      sourcePath: 'catalogs/basic/v1/catalog.json',
      rawPublicPath: '/specification/v1_0/catalogs/basic/catalog.json',
      guideRoute: 'specification/v1.0-basic-catalog-implementation-guide',
    },
    {
      category: 'Catalog Schema',
      alias: 'mcp_catalog.json',
      sourcePath: 'catalogs/mcp/v1/catalog.json',
      rawPublicPath: '/specification/v1_0/catalogs/mcp/catalog.json',
      guideRoute: 'guides/mcp-catalog',
    },
  ],
  'v0.9.1': [
    {
      category: 'Catalog Schema',
      alias: 'basic_catalog.json',
      sourcePath: 'specification/v0_9_1/catalogs/basic/catalog.json',
      rawPublicPath: '/specification/v0_9_1/catalogs/basic/catalog.json',
      guideRoute: 'specification/v0.9.1-basic-catalog-implementation-guide',
    },
  ],
};

/**
 * Reverse lookup from repo-relative JSON schema path to `{ version, alias, guideRoute? }`.
 */
export const SCHEMA_SOURCE_TO_EXPLORER = (() => {
  const map = new Map();
  for (const [version, items] of Object.entries(SPEC_SCHEMAS)) {
    for (const item of items) {
      map.set(item.sourcePath, {version, alias: item.alias});
    }
  }
  for (const [version, items] of Object.entries(SPEC_CATALOG_SCHEMAS)) {
    for (const item of items) {
      map.set(item.sourcePath, {version, alias: item.alias, guideRoute: item.guideRoute});
    }
  }
  return map;
})();

export function resolveSchemaExplorerUrl(relRepoPath, rawAnchor = '', basePrefix = '') {
  const normalized = relRepoPath.replace(/\\/g, '/');
  let entry = SCHEMA_SOURCE_TO_EXPLORER.get(normalized);

  // Also map specification/v0_9/... (schemas and basic catalog) to v0.9.1 explorer / guide
  if (!entry && normalized.startsWith('specification/v0_9/')) {
    const as091 = normalized.replace(/^specification\/v0_9\//, 'specification/v0_9_1/');
    entry = SCHEMA_SOURCE_TO_EXPLORER.get(as091);
  }
  if (!entry) return null;

  const cleanPointer = rawAnchor.replace(/^#/, '').replace(/^\/+/, '');
  const hashPart = cleanPointer ? `#${entry.alias}/${cleanPointer}` : `#${entry.alias}`;
  if (entry.guideRoute) {
    return `${basePrefix}/${entry.guideRoute}/${hashPart}`;
  }
  return `${basePrefix}/specification/${entry.version}/schemas/${hashPart}`;
}

function escapeJsonPointerSegment(seg) {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1');
}

const ESC_MAP = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/**
 * Recursive-descent JSON AST parser tracking exact 1-based [startLine, endLine] spans.
 */
export function parseJsonAst(text) {
  let pos = 0;
  let line = 1;
  const len = text.length;
  const numRegex = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

  function skipWs() {
    while (pos < len) {
      const ch = text.charCodeAt(pos);
      if (ch === 10) {
        line++;
        pos++;
      } else if (ch === 13) {
        pos++;
        if (pos < len && text.charCodeAt(pos) === 10) pos++;
        line++;
      } else if (ch === 32 || ch === 9) {
        pos++;
      } else {
        break;
      }
    }
  }

  function parseString() {
    const startLine = line;
    if (text[pos] !== '"') {
      throw new Error(`Expected '"' at pos ${pos} (line ${line})`);
    }
    pos++;
    let value = '';
    while (pos < len) {
      const ch = text[pos];
      if (ch === '"') {
        pos++;
        return {type: 'string', value, startLine, endLine: line};
      }
      if (ch === '\\') {
        pos++;
        const esc = text[pos];
        if (esc === 'u') {
          const hex = text.slice(pos + 1, pos + 5);
          value += String.fromCharCode(parseInt(hex, 16));
          pos += 5;
        } else {
          value += ESC_MAP[esc] ?? esc;
          pos++;
        }
      } else {
        if (ch === '\n') line++;
        value += ch;
        pos++;
      }
    }
    throw new Error(`Unterminated string starting on line ${startLine}`);
  }

  function parseValue() {
    skipWs();
    const startLine = line;
    const ch = text[pos];
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"') return parseString();
    if (ch === 't' && text.startsWith('true', pos)) {
      pos += 4;
      return {type: 'boolean', value: true, startLine, endLine: line};
    }
    if (ch === 'f' && text.startsWith('false', pos)) {
      pos += 5;
      return {type: 'boolean', value: false, startLine, endLine: line};
    }
    if (ch === 'n' && text.startsWith('null', pos)) {
      pos += 4;
      return {type: 'null', value: null, startLine, endLine: line};
    }
    // Number
    numRegex.lastIndex = pos;
    const numMatch = numRegex.exec(text);
    if (numMatch) {
      pos += numMatch[0].length;
      return {type: 'number', value: Number(numMatch[0]), startLine, endLine: line};
    }
    throw new Error(`Unexpected token '${ch}' at pos ${pos} (line ${line})`);
  }

  function parseObject() {
    const startLine = line;
    pos++; // '{'
    const properties = [];
    skipWs();
    if (text[pos] === '}') {
      const endLine = line;
      pos++;
      return {type: 'object', properties, startLine, endLine};
    }
    while (pos < len) {
      skipWs();
      const keyNode = parseString();
      skipWs();
      if (text[pos] !== ':') {
        throw new Error(`Expected ':' after key "${keyNode.value}" on line ${line}`);
      }
      pos++;
      const valueNode = parseValue();
      properties.push({
        key: keyNode.value,
        keyStartLine: keyNode.startLine,
        value: valueNode,
        startLine: keyNode.startLine,
        endLine: valueNode.endLine,
      });
      skipWs();
      if (text[pos] === ',') {
        pos++;
        continue;
      }
      if (text[pos] === '}') {
        const endLine = line;
        pos++;
        return {type: 'object', properties, startLine, endLine};
      }
      throw new Error(`Expected ',' or '}' on line ${line}`);
    }
    throw new Error(`Unterminated object starting on line ${startLine}`);
  }

  function parseArray() {
    const startLine = line;
    pos++; // '['
    const elements = [];
    skipWs();
    if (text[pos] === ']') {
      const endLine = line;
      pos++;
      return {type: 'array', elements, startLine, endLine};
    }
    while (pos < len) {
      elements.push(parseValue());
      skipWs();
      if (text[pos] === ',') {
        pos++;
        continue;
      }
      if (text[pos] === ']') {
        const endLine = line;
        pos++;
        return {type: 'array', elements, startLine, endLine};
      }
      throw new Error(`Expected ',' or ']' on line ${line}`);
    }
    throw new Error(`Unterminated array starting on line ${startLine}`);
  }

  const root = parseValue();
  skipWs();
  return root;
}

const INDEXED_SECTIONS = [
  {key: '$defs', label: 'Definitions ($defs)'},
  {key: 'definitions', label: 'Definitions'},
  {key: 'components', label: 'Components'},
  {key: 'functions', label: 'Functions'},
  {key: 'properties', label: 'Properties'},
];

/**
 * Builds `{ pointers, jumpGroups }` from a raw JSON schema string.
 * `pointers` maps `<json-pointer>` (without leading slash, e.g. `$defs/Child`) to `[startLine, endLine]`.
 */
export function buildPointerIndex(rawText) {
  const normalized = rawText.replace(/\r\n/g, '\n').trimEnd();
  const ast = parseJsonAst(normalized);
  /** @type {Record<string, [number, number]>} */
  const pointers = {};
  /** @type {Array<{label: string, items: Array<{pointer: string, name: string, lines: [number, number]}>}>} */
  const jumpGroups = [];

  if (ast.type !== 'object') {
    return {pointers, jumpGroups, lineCount: normalized.split('\n').length};
  }

  // Recursively index AST object keys and array elements up to depth 6 to support
  // deep JSON pointer permalinks (e.g. allOf/2/properties/* or oneOf/0) across all versions.
  function indexAstNode(node, currentPointer = '', depth = 0) {
    if (depth > 6 || !node) return;
    if (node.type === 'object' && Array.isArray(node.properties)) {
      for (const prop of node.properties) {
        const escaped = escapeJsonPointerSegment(prop.key);
        const childPtr = currentPointer ? `${currentPointer}/${escaped}` : escaped;
        pointers[childPtr] = [prop.startLine, prop.endLine];
        if (escaped !== prop.key) {
          const rawChildPtr = currentPointer ? `${currentPointer}/${prop.key}` : prop.key;
          pointers[rawChildPtr] = [prop.startLine, prop.endLine];
        }
        indexAstNode(prop.value, childPtr, depth + 1);
      }
    } else if (node.type === 'array' && Array.isArray(node.elements)) {
      for (let i = 0; i < node.elements.length; i++) {
        const childPtr = `${currentPointer}/${i}`;
        const elem = node.elements[i];
        pointers[childPtr] = [elem.startLine, elem.endLine];
        indexAstNode(elem, childPtr, depth + 1);
      }
    }
  }

  indexAstNode(ast);

  const propByName = new Map();
  for (const prop of ast.properties) {
    propByName.set(prop.key, prop);
  }

  for (const section of INDEXED_SECTIONS) {
    const sectionProp = propByName.get(section.key);
    if (!sectionProp || sectionProp.value.type !== 'object') continue;

    const groupItems = [];
    for (const entry of sectionProp.value.properties) {
      const escapedEntry = escapeJsonPointerSegment(entry.key);
      const ptr = `${section.key}/${escapedEntry}`;
      pointers[ptr] = [entry.startLine, entry.endLine];
      if (escapedEntry !== entry.key) {
        pointers[`${section.key}/${entry.key}`] = [entry.startLine, entry.endLine];
      }
      groupItems.push({
        pointer: ptr,
        name: entry.key,
        lines: [entry.startLine, entry.endLine],
      });

      // Also index nested `properties/*` inside definitions/components for deeper permalinks
      if (entry.value.type === 'object') {
        const nestedProps = entry.value.properties.find(p => p.key === 'properties');
        if (nestedProps && nestedProps.value.type === 'object') {
          const propsPtr = `${ptr}/properties`;
          pointers[propsPtr] = [nestedProps.startLine, nestedProps.endLine];
          for (const sub of nestedProps.value.properties) {
            const subPtr = `${propsPtr}/${escapeJsonPointerSegment(sub.key)}`;
            pointers[subPtr] = [sub.startLine, sub.endLine];
          }
        }
      }
    }

    if (groupItems.length > 0) {
      jumpGroups.push({
        label: section.label,
        items: groupItems,
      });
    }
  }

  return {
    pointers,
    jumpGroups,
    lineCount: normalized.split('\n').length,
  };
}

const versionSchemasCache = new Map();

/**
 * Loads and indexes all canonical JSON schemas for a given protocol version directly from disk.
 */
export function loadVersionSchemas(version, repoRoot = findRepoRoot()) {
  const cacheKey = `${repoRoot}::${version}`;
  if (versionSchemasCache.has(cacheKey)) {
    return versionSchemasCache.get(cacheKey);
  }

  const specEntries = SPEC_SCHEMAS[version] || [];
  const catalogEntries = SPEC_CATALOG_SCHEMAS[version] || [];
  const entries = [...specEntries, ...catalogEntries];
  if (entries.length === 0) {
    throw new Error(`Unknown specification version: ${version}`);
  }

  const loaded = entries.map(entry => {
    const absPath = path.join(repoRoot, entry.sourcePath);
    const rawText = fs.readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n').trimEnd();
    const parsed = JSON.parse(rawText);
    const {pointers, jumpGroups, lineCount} = buildPointerIndex(rawText);

    return {
      ...entry,
      rawText,
      schemaId: typeof parsed.$id === 'string' ? parsed.$id : null,
      title: typeof parsed.title === 'string' ? parsed.title : null,
      description: typeof parsed.description === 'string' ? parsed.description : null,
      lineCount,
      pointers,
      jumpGroups,
    };
  });

  versionSchemasCache.set(cacheKey, loaded);
  return loaded;
}
