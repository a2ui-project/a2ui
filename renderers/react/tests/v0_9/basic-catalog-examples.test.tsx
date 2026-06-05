/**
 * Copyright 2026 Google LLC
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

/// <reference types="node" />

import {describe, it, expect} from 'vitest';
import {render} from '@testing-library/react';
import React from 'react';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog} from '@a2ui/react/v0_9';
import fs from 'fs';
import path from 'path';

describe('v0.9 Basic Catalog Examples Rendering', () => {
  const examplesDir = path.resolve(
    process.cwd(),
    '../../specification/v0_9/catalogs/basic/examples',
  );

  if (!fs.existsSync(examplesDir)) {
    throw new Error(`Examples directory not found: ${examplesDir}`);
  }

  const files = fs.readdirSync(examplesDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    it(`should successfully render ${file}`, async () => {
      const content = fs.readFileSync(path.join(examplesDir, file), 'utf-8');
      const data = JSON.parse(content);
      const messages = Array.isArray(data) ? data : data.messages || [];

      let surfaceId = file.replace('.json', '');
      const createMsg = messages.find((m: any) => m.createSurface);
      if (createMsg) {
        surfaceId = createMsg.createSurface.surfaceId;
      } else {
        messages.unshift({
          version: 'v0.9',
          createSurface: {
            surfaceId,
            catalogId: basicCatalog.id,
          },
        });
      }

      const processor = new MessageProcessor([basicCatalog as any]);
      processor.processMessages(messages);

      const surface = processor.model.getSurface(surfaceId);
      expect(surface).toBeDefined();

      const {container} = render(
        <React.StrictMode>
          <A2uiSurface surface={surface as any} />
        </React.StrictMode>,
      );

      // Assert that it rendered something and didn't throw
      expect(container.firstChild).toBeTruthy();
    });
  }
});
