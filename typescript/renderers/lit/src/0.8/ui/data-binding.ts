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

import type {ReactiveController} from 'lit';
import {SignalMap} from 'signal-utils/map';

import {A2uiMessageProcessor} from '@a2ui/web_core/data/model-processor';
import type {DataValue} from '@a2ui/web_core/types/types';

import type {Root} from './root.js';

const connectedRoots = new Set<Root>();

function effectiveSurfaceId(el: Root): string {
  return el.surfaceId ?? A2uiMessageProcessor.DEFAULT_SURFACE_ID;
}

/**
 * Registers a `Root` element in the connected-roots set while attached to the DOM.
 */
export function registerBoundRoot(
  host: Root,
): Required<Pick<ReactiveController, 'hostConnected' | 'hostDisconnected'>> {
  const controller = {
    hostConnected() {
      connectedRoots.add(host);
    },
    hostDisconnected() {
      connectedRoots.delete(host);
    },
  };
  host.addController(controller);
  return controller;
}

/**
 * Writes a bound value to `host.processor` and schedules Lit updates on `host`
 * and on connected `Root` elements sharing the same processor and surface.
 *
 * When `host.processor` uses `SignalMap` (`createSignalA2uiMessageProcessor`),
 * `SignalWatcher` already schedules fine-grained updates on dependent elements,
 * so peer broadcast is skipped. `<a2ui-surface>` hosts are also skipped so
 * surface wrapper re-renders do not reallocate child component arrays on input
 * events. Custom elements that do not extend `Root` must mix in `SignalWatcher`
 * and use `createSignalA2uiMessageProcessor` for automatic reactivity.
 */
export function setBoundData(host: Root, path: string, value: DataValue): void {
  if (!host.processor || !host.component) {
    return;
  }
  const surfaceId = effectiveSurfaceId(host);
  host.processor.setData(host.component, path, value, surfaceId);
  host.requestUpdate();
  if (!host.isConnected || (host.processor.opts.mapCtor as unknown) === SignalMap) {
    return;
  }
  for (const peer of connectedRoots) {
    if (
      peer !== host &&
      peer.localName !== 'a2ui-surface' &&
      peer.processor === host.processor &&
      effectiveSurfaceId(peer) === surfaceId
    ) {
      peer.requestUpdate();
    }
  }
}
