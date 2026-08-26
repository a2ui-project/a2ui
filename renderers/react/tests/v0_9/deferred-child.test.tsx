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

import React from 'react';
import {it, expect} from 'vitest';
import {render} from '@testing-library/react';
import {Catalog, SurfaceModel} from '@a2ui/web_core/v0_9';
import type {ReactComponentImplementation} from '../../src/v0_9/adapter';
import {DeprecatedUnmarkedReference} from '../../src/v0_9/deferred-child';

it('reports each unmarked reference pair, not conflating look-alike pairs', () => {
  const catalog = new Catalog<ReactComponentImplementation>('x', []);
  const surface = new SurfaceModel<ReactComponentImplementation>('s', catalog);
  const reported: string[] = [];
  surface.onError.subscribe(e => {
    reported.push((e as {code: string}).code);
  });

  render(
    <>
      <DeprecatedUnmarkedReference surface={surface} id="a@b" basePath="/c" />
      <DeprecatedUnmarkedReference surface={surface} id="a" basePath="b@/c" />
    </>,
  );

  expect(reported.filter(code => code === 'UNMARKED_CHILD_REFERENCE')).toHaveLength(2);
});
