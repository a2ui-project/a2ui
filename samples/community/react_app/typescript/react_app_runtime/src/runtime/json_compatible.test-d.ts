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

/**
 * Type-level tests of the data model typings in `a2ui.d.ts`, run by `tsc --noEmit` (the `test`
 * script). Each `@ts-expect-error` line must fail to type-check; every other line must pass.
 */

import {getData, setData, subscribe, useData, type JsonValue} from 'a2ui';

interface Stop {
  name: string;
  minutes?: number;
  tags: string[];
}

export async function typeChecks(): Promise<void> {
  // Interfaces and type aliases of JSON values work as `T`, optional fields included.
  const stops: Stop[] = [{name: 'Louvre', tags: []}];
  await setData<Stop[]>('/stops', stops);
  await setData('/stops', stops);
  const [rate, setRate] = useData('/loan/rate', 5);
  setRate(rate + 1);
  setRate(previous => previous * 2);
  const [stop] = useData<Stop | null>('/stop', null);
  void stop?.name;
  await setData('/any', {nested: [1, 'two', null, {deep: true}]});
  const json: JsonValue = {a: [1]};
  await setData('/json', json);
  const [list, setList] = useData<JsonValue[]>('/list', []);
  setList([...list, 'x']);
  const read: Stop | undefined = await getData<Stop>('/stop');
  void read;
  subscribe<Stop>('/stop', value => void value?.tags);

  // Values JSON can't carry don't type-check.
  // @ts-expect-error A Date isn't JSON.
  await setData('/when', new Date());
  // @ts-expect-error A function isn't JSON.
  await setData('/callback', () => 1);
  // @ts-expect-error A Map isn't JSON.
  await setData('/map', new Map<string, number>());
  // @ts-expect-error A nested Date isn't JSON either.
  await setData('/trip', {start: new Date()});
  // @ts-expect-error An interface with a Date field isn't JSON.
  useData<{at: Date}>('/at', {at: new Date()});
}
