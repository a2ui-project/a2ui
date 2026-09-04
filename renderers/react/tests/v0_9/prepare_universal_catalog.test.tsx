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

import {describe, it, expect} from 'vitest';
import React from 'react';
import {z} from 'zod';
import {Catalog} from '@a2ui/web_core/v0_9';
import {prepareUniversalCatalog} from '../../src/v0_9/catalog/prepare_universal_catalog';
import {createComponentImplementation} from '../../src/v0_9/adapter';

describe('prepareUniversalCatalog', () => {
  it('automatically adapts native React components in a Catalog', () => {
    const CustomApi = {
      name: 'CustomBox',
      schema: z.object({}),
    };
    const CustomBox = createComponentImplementation(CustomApi, () => <div>Box</div>);
    const catalog = new Catalog('test-cat', [CustomBox], []);

    expect((catalog.components.get('CustomBox') as any).tagName).toBeUndefined();

    prepareUniversalCatalog(catalog);

    const adapted = catalog.components.get('CustomBox') as any;
    expect(adapted.tagName).toBeDefined();
    expect(adapted.tagName).toContain('a2ui-react-custombox');
  });

  it('preserves components that already have tagName', () => {
    const customWc = {
      name: 'ExistingWc',
      schema: z.object({}),
      tagName: 'my-custom-wc',
    };
    const catalog = new Catalog('test-cat-wc', [customWc], []);
    prepareUniversalCatalog(catalog);
    expect((catalog.components.get('ExistingWc') as any).tagName).toBe('my-custom-wc');
  });

  it('is idempotent and caches preparation via WeakSet', () => {
    const CustomApi = {
      name: 'IdempotentBox',
      schema: z.object({}),
    };
    const CustomBox = createComponentImplementation(CustomApi, () => <div>Idempotent</div>);
    const catalog = new Catalog('test-cat-idempotent', [CustomBox], []);

    prepareUniversalCatalog(catalog);
    const firstTagName = (catalog.components.get('IdempotentBox') as any).tagName;

    // Running again should not throw or change the tag
    prepareUniversalCatalog(catalog);
    expect((catalog.components.get('IdempotentBox') as any).tagName).toBe(firstTagName);
  });

  it('is catalog-agnostic and does not depend on basicCatalog', () => {
    const DomainApi = {
      name: 'DomainSpecificWidget',
      schema: z.object({title: z.string()}),
    };
    const DomainWidget = createComponentImplementation(DomainApi, ({props}) => (
      <div>{props.title}</div>
    ));
    const domainCatalog = new Catalog('domain-catalog', [DomainWidget], []);

    prepareUniversalCatalog(domainCatalog);

    const adapted = domainCatalog.components.get('DomainSpecificWidget') as any;
    expect(adapted.tagName).toBeDefined();
    expect(adapted.tagName).toContain('a2ui-react-domainspecificwidget');
  });
});
