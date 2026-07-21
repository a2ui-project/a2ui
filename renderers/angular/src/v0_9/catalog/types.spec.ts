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

import {Component, signal} from '@angular/core';
import {ComponentApi} from '@a2ui/web_core/v0_9';
import {createAngularComponentImplementation} from './types';
import {CatalogComponentInstance} from '../core/catalog_component_instance';
import {z} from 'zod';

@Component({
  selector: 'test-comp',
  template: '',
  standalone: true,
})
class TestComponent implements CatalogComponentInstance {
  readonly props = signal<Record<string, unknown>>({});
  readonly surfaceId = signal('');
  readonly componentId = signal('');
  readonly dataContextPath = signal('');
}

describe('createAngularComponentImplementation', () => {
  it('should map ComponentApi and Angular Component Type correctly', () => {
    const api: ComponentApi = {
      name: 'TestComp',
      schema: z.object({}),
    };

    const impl = createAngularComponentImplementation(api, TestComponent);

    expect(impl.name).toBe('TestComp');
    expect(impl.schema).toEqual(api.schema);
    expect(impl.component).toBe(TestComponent);
  });
});
