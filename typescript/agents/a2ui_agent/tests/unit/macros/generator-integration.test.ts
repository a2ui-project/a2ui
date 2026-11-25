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

import {describe, expect, it} from 'vitest';

import {
  A2uiGenerator,
  CatalogConfig,
  defineMacro,
  MacroExpander,
  param,
  validatePayload,
} from '../../../src/index.js';
import {loadBasicCatalog} from '../../helpers/basic-catalogs.js';

const Greeting = defineMacro({
  name: 'Greeting',
  description: 'A card that greets someone.',
  parameters: {name: param.string({description: 'Who to greet'})},
  render: ({name}) => ({
    component: 'Card',
    child: {component: 'Text', text: `Hello, ${name}!`, variant: 'caption'},
  }),
});

describe('macros with A2uiGenerator', () => {
  it('prompts for a macro, parses it, and lowers it to the base catalog', () => {
    const basic = loadBasicCatalog('1.0');
    const expander = new MacroExpander([Greeting], {onError: 'raise'});
    const generator = new A2uiGenerator([
      new CatalogConfig(expander.transformToInferenceCatalog(basic)),
    ]);
    const processor = generator.createProcessor({supportedCatalogIds: [basic.id]});

    expect(processor.promptSnippet).toContain('Greeting');

    const parts = processor.parseResponse(
      '<a2ui>\nsurface("main")\nroot = Greeting(name="Ada")\n</a2ui>',
    );
    const messages = parts.flatMap(part =>
      part.type === 'a2ui' ? expander.transformToTransport(part.a2ui) : [],
    );

    expect(messages).toEqual([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'main',
          catalogId: basic.id,
          components: [
            {component: 'Text', id: 'root__text_1', text: 'Hello, Ada!', variant: 'caption'},
            {component: 'Card', id: 'root', child: 'root__text_1'},
          ],
        },
      },
    ]);
    validatePayload([basic], messages);
  });
});
