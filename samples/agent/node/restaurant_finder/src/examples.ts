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

import fs from 'fs';
import path from 'path';

import {type AgentToRendererMessage, basicCatalog, ExpressDecompiler} from '@a2ui/agent';

import type {A2uiFormat} from './config.js';
import {getPackageRootDir} from './tools.js';
import type {VersionProfile} from './versions.js';

export interface LoadedExamples {
  /** Example text by file basename: raw JSON for Direct JSON, a wrapped block for Express. */
  exampleBlocks: Record<string, string>;
  /** Every example, delimited, as the prompt generator expects them. */
  catalogExamplesString: string;
}

/** Reads a JSON file holding a list of A2UI messages. */
export function readMessages(filePath: string): AgentToRendererMessage[] {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AgentToRendererMessage[];
}

/** Writes A2UI messages as a model would in the given format, wrapped in its tags. */
export function toResponseText(
  profile: VersionProfile,
  format: A2uiFormat,
  messages: AgentToRendererMessage[],
): string {
  if (format === 'direct_json') {
    return `<a2ui-json>\n${JSON.stringify(messages, null, 2)}\n</a2ui-json>`;
  }
  const decompiler = new ExpressDecompiler(basicCatalog(profile.version), profile.version);
  return decompiler.wrapDecompiledBlocks([decompiler.decompile(messages)]);
}

/**
 * Loads the examples in examples/<version>/, decompiled to Express when that is the
 * format. They are validated by the tests, not here.
 */
export function loadExamples(
  profile: VersionProfile,
  format: A2uiFormat,
  packageRoot: string = getPackageRootDir(),
): LoadedExamples {
  const examplesDir = path.join(packageRoot, 'examples', profile.version);
  if (!fs.existsSync(examplesDir)) {
    throw new Error(`Examples directory not found at ${examplesDir}`);
  }

  const files = fs
    .readdirSync(examplesDir)
    .filter(f => f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    throw new Error(`No example files found in ${examplesDir}`);
  }

  const exampleBlocks: Record<string, string> = {};
  for (const file of files) {
    const fullPath = path.join(examplesDir, file);
    exampleBlocks[path.parse(file).name] =
      format === 'direct_json'
        ? fs.readFileSync(fullPath, 'utf-8')
        : toResponseText(profile, format, readMessages(fullPath));
  }

  const catalogExamplesString = Object.entries(exampleBlocks)
    .map(([name, content]) => `---BEGIN ${name}---\n${content}\n---END ${name}---`)
    .join('\n\n');
  return {exampleBlocks, catalogExamplesString};
}
