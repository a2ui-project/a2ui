/**
 * Copyright 2026 kokoro-ele
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, {useMemo, useState} from 'react';
import {render, Box, Text} from 'ink';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, basename} from 'node:path';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog, type InkComponentImplementation} from '../src/v0_9/index.js';

type Messages = Parameters<MessageProcessor<InkComponentImplementation>['processMessages']>[0];

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, '../../../specification/v0_9_1/catalogs/basic/examples');

function listExamples(): string[] {
  return readdirSync(examplesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => basename(f, '.json'))
    .sort();
}

function resolveExampleFile(name: string): string {
  const files = readdirSync(examplesDir).filter(f => f.endsWith('.json'));
  const exact = files.find(f => basename(f, '.json') === name);
  if (exact) return exact;
  const partial = files.find(f => basename(f, '.json').includes(name));
  if (partial) return partial;
  throw new Error(
    `Unknown example "${name}".\nAvailable:\n${listExamples()
      .map(e => `  - ${e}`)
      .join('\n')}`,
  );
}

function loadExample(name: string): {name: string; messages: Messages} {
  const file = resolveExampleFile(name);
  const raw = JSON.parse(readFileSync(join(examplesDir, file), 'utf8'));
  return {name: (raw.name as string) ?? file, messages: raw.messages as Messages};
}

function App({exampleName}: {exampleName: string}) {
  const [actions, setActions] = useState<string[]>([]);

  const {name, surface} = useMemo(() => {
    const example = loadExample(exampleName);
    const processor = new MessageProcessor<InkComponentImplementation>(
      [basicCatalog],
      async action => {
        const line = `${new Date().toLocaleTimeString()} ${action.name} ← ${action.sourceComponentId}`;
        setActions(prev => [...prev.slice(-2), line]);
      },
    );
    processor.processMessages(structuredClone(example.messages));
    const surface = [...processor.model.surfacesMap.values()][0];
    if (!surface) {
      throw new Error('No surface created from example messages');
    }
    return {name: example.name, surface};
  }, [exampleName]);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="magenta">
        A2UI Ink — {name}
      </Text>
      <Text dimColor>
        Tab focus · Enter/Space activate · ←/→ tabs/slider · Esc modal · Ctrl+C quit
      </Text>
      <Box marginTop={1} borderStyle="round" borderColor="gray" padding={1} flexDirection="column">
        <A2uiSurface surface={surface} />
      </Box>
      {actions.length > 0 ? (
        <Box flexDirection="column">
          <Text bold dimColor>
            actions dispatched to agent:
          </Text>
          {actions.map(line => (
            <Text key={line} color="yellow">
              ⚡ {line}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

const arg = process.argv[2];
if (!arg || arg === '--list' || arg === 'list') {
  console.log(listExamples().join('\n'));
  process.exit(0);
}

render(<App exampleName={arg} />);
