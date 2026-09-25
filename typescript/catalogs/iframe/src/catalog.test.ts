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

import example from '../../../../catalogs/iframe/examples/01_url-frame.json' with {type: 'json'};
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {
  isWebComponentImplementation,
  type WebComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
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

  it('is enough on its own to process the messages of the catalog examples', () => {
    const processor = new MessageProcessor<WebComponentImplementation>([iframeCatalog]);

    processor.processMessages(parseExampleMessages(example));

    const surface = processor.model.getSurface('gallery-iframe-url-frame')!;
    expect(surface.catalog).toBe(iframeCatalog);
    expect(surface.componentsModel.get('order_tracker')?.type).toBe('WebAppFrameUrl');
    surface.dispose();
  });
});
