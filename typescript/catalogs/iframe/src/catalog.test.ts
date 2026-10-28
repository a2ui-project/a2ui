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

import {
  basicCatalog,
  isWebComponentImplementation,
  MessageProcessor,
  type WebComponentImplementation,
} from '@a2ui/web_core/v1_0';
import catalogJson from './catalog.json' with {type: 'json'};
import {IFRAME_CATALOG_ID, iframeCatalog} from './catalog.js';
import {A2uiWebAppFrameSrcdoc} from './components/web_app_frame_srcdoc.js';
import {A2uiWebAppFrameUrl} from './components/web_app_frame_url.js';
import {parseExampleMessages} from './testing/frame_test_support.js';

describe('iframeCatalog', () => {
  it('is identified by the $id of the catalog schema', () => {
    expect(iframeCatalog.id).toBe(IFRAME_CATALOG_ID);
    expect(iframeCatalog.id).toBe(catalogJson['$id']);
  });

  it('implements every component of the catalog schema, and nothing else', () => {
    expect([...iframeCatalog.components.keys()]).toEqual(Object.keys(catalogJson['components']));
    expect(iframeCatalog.components.get('WebAppFrameUrl')).toBe(A2uiWebAppFrameUrl);
    expect(iframeCatalog.components.get('WebAppFrameSrcdoc')).toBe(A2uiWebAppFrameSrcdoc);
    expect(iframeCatalog.functions.size).toBe(0);
  });

  it('registers universal components with a2ui- prefixed tag names', () => {
    for (const component of iframeCatalog.components.values()) {
      expect(isWebComponentImplementation(component)).withContext(component.name).toBeTrue();
      expect(component.tagName)
        .withContext(component.name)
        .toMatch(/^a2ui-[a-z-]+$/);
    }
  });

  it('renders a frame that names the iframe catalog on a basic catalog surface', () => {
    const processor = new MessageProcessor<WebComponentImplementation>([
      basicCatalog,
      iframeCatalog,
    ]);

    processor.processMessages(
      parseExampleMessages({
        messages: [
          {version: 'v1.0', createSurface: {surfaceId: 'frames', catalogId: basicCatalog.id}},
          {
            version: 'v1.0',
            updateComponents: {
              surfaceId: 'frames',
              components: [
                {
                  id: 'app',
                  component: 'WebAppFrameSrcdoc',
                  catalogId: IFRAME_CATALOG_ID,
                  htmlContent: '<p>App</p>',
                },
              ],
            },
          },
        ],
      }),
    );

    const surface = processor.model.getSurface('frames')!;
    expect(surface.defaultCatalog).toBe(basicCatalog);
    const frame = surface.componentsModel.get('app')!;
    expect(frame.type).toBe('WebAppFrameSrcdoc');
    expect(frame.catalog).toBe(iframeCatalog);
    surface.dispose();
  });
});
