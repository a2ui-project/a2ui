/*
 * Copyright 2026 Google LLC
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

import React from 'react';
import {describe, it, expect} from 'vitest';
import {createComponentImplementation} from '../src/adapter';
import {renderA2uiComponent} from './utils';
import {commonType, objectSchema} from './validator';

describe('renderA2uiComponent', () => {
  it('stubs the children the catalog reference map finds, and binds the rest', async () => {
    const Panel = createComponentImplementation(
      {
        name: 'Panel',
        schema: objectSchema({
          title: commonType('DynamicString'),
          child: commonType('ComponentId'),
          items: commonType('ChildList'),
        }),
      },
      ({props, buildChild}) => (
        <section>
          <h1>{String(props.title ?? '')}</h1>
          {props.child ? buildChild(props.child as string) : null}
          {(Array.isArray(props.items) ? props.items : []).map((id: unknown) =>
            typeof id === 'string' ? (
              <React.Fragment key={id}>{buildChild(id)}</React.Fragment>
            ) : null,
          )}
        </section>
      ),
    );

    const {view, updateData} = renderA2uiComponent(
      Panel,
      {title: {path: '/title'}, child: 'only', items: ['first', 'second']},
      {initialData: {title: 'Hello'}},
    );

    expect(view.getByText('Hello')).toBeInTheDocument();
    for (const id of ['only', 'first', 'second']) {
      expect(view.getByTestId(`child-${id}`)).toBeInTheDocument();
    }
    await updateData('/title', 'Updated');
    expect(await view.findByText('Updated')).toBeInTheDocument();
  });
});
