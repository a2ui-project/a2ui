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

import '@a2ui/lit';
import type {A2uiSurface} from '@a2ui/lit';
import {createAjvValidator} from '@a2ui/validator-ajv';
import {MessageProcessor} from '@a2ui/web_core';
import type {ProcessableMessagePayload} from '@a2ui/web_core/processing';
import type {WebComponentImplementation} from '@a2ui/web_core/universal';
import {createDemoCatalogs, invalidMessages, surfaceMessages, updateMessages} from './catalogs.js';
import {implement} from './elements.js';

const validator = createAjvValidator();
const catalogs = createDemoCatalogs<WebComponentImplementation>(validator, implement);
const processor = new MessageProcessor<WebComponentImplementation>(
  [catalogs.zod, catalogs.json],
  undefined,
  {validator},
);

const send = (messages: readonly unknown[]) =>
  processor.processMessages(messages as unknown as ProcessableMessagePayload);

send(surfaceMessages('zod', catalogs.zod.id, 'zod 4 catalog (@a2ui/schema-zod4)'));
send(surfaceMessages('json', catalogs.json.id, 'JSON Schema catalog (fromJsonSchema)'));

for (const id of ['zod', 'json']) {
  const el = document.getElementById(`surface-${id}`) as A2uiSurface;
  el.surface = processor.model.getSurface(id)! as A2uiSurface['surface'];
}

const log = document.getElementById('log')!;

document.getElementById('update')!.addEventListener('click', () => {
  send(updateMessages('zod'));
  send(updateMessages('json'));
  log.textContent = 'Sent updateDataModel {status: "Shipped", ready: true} to both surfaces.';
});

document.getElementById('invalid')!.addEventListener('click', () => {
  try {
    send(invalidMessages('zod'));
    log.textContent = 'The invalid message was accepted (unexpected).';
  } catch (e) {
    log.textContent = `Rejected: ${(e as Error).message}`;
  }
});
