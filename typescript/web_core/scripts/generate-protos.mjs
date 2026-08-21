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

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import protobuf from 'protobufjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceRoot = path.resolve(__dirname, '../../..');
const specProtoDir = path.resolve(workspaceRoot, 'specification/v1_0/proto');
const catalogProtoDir = path.resolve(workspaceRoot, 'specification/v1_0/catalogs/basic');
const outputDir = path.resolve(__dirname, '../src/v1_0/proto');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, {recursive: true});
}

console.log('Compiling Protobuf definitions from specification/v1_0/proto...');

const root = new protobuf.Root();
root.resolvePath = (origin, target) => {
  if (path.isAbsolute(target) || target.startsWith('.')) {
    return origin ? path.resolve(path.dirname(origin), target) : path.resolve(target);
  }
  if (target.startsWith('google/protobuf/')) {
    // Look up in protobufjs bundled google definitions
    const protobufjsRoot = path.dirname(
      fileURLToPath(import.meta.resolve('protobufjs/package.json')),
    );
    return path.resolve(protobufjsRoot, 'google/protobuf', path.basename(target));
  }
  return path.resolve(specProtoDir, target);
};

const protoFiles = [
  path.resolve(specProtoDir, 'common_types.proto'),
  path.resolve(specProtoDir, 'agent_to_renderer.proto'),
  path.resolve(specProtoDir, 'renderer_to_agent.proto'),
  path.resolve(specProtoDir, 'agent_to_renderer_list.proto'),
  path.resolve(specProtoDir, 'agent_to_renderer_list_wrapper.proto'),
  path.resolve(catalogProtoDir, 'catalog.proto'),
];

for (const file of protoFiles) {
  if (fs.existsSync(file)) {
    root.loadSync(file);
  } else {
    console.warn(`Warning: proto file not found: ${file}`);
  }
}

const protoJson = root.toJSON({keepComments: true});
const jsonOutputPath = path.resolve(outputDir, 'a2ui-proto.json');
fs.writeFileSync(jsonOutputPath, JSON.stringify(protoJson, null, 2), 'utf-8');
console.log(`Generated static proto descriptor at ${jsonOutputPath}`);

const tsIndexContent = `// Copyright 2024 Google LLC
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

// Auto-generated Protobuf descriptor bindings. Do not edit manually.

import protobuf from 'protobufjs';
import protoJson from './a2ui-proto.json' with { type: 'json' };

export const protoRoot = protobuf.Root.fromJSON(protoJson as unknown as protobuf.INamespace);

export const AgentToRendererMessageType = protoRoot.lookupType('a2ui.v1_0.AgentToRendererMessage');
export const RendererToAgentMessageType = protoRoot.lookupType('a2ui.v1_0.RendererToAgentMessage');
export const AgentToRendererListWrapperType = protoRoot.lookupType('a2ui.v1_0.AgentToRendererListWrapper');
export const AgentToRendererMessageListType = protoRoot.lookupType('a2ui.v1_0.AgentToRendererMessageList');
export const ComponentType = protoRoot.lookupType('a2ui.v1_0.Component');

export { protoJson };
`;

const tsIndexPath = path.resolve(outputDir, 'index.ts');
fs.writeFileSync(tsIndexPath, tsIndexContent, 'utf-8');
console.log(`Generated TypeScript proto bindings at ${tsIndexPath}`);
