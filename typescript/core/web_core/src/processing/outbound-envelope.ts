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

import {isAtLeastVersion, toCanonicalVersion} from '../common/semver.js';
import type {OutboundActionMessage} from '../rpc/rpc-handler.js';
import type {ActionPayload} from '../state/surface-model.js';

/**
 * Formats an emitted `ActionPayload` into a versioned renderer-to-agent `action`
 * wire envelope.
 *
 * @param action Emitted surface action payload.
 * @param version Surface or fallback protocol version string.
 * @returns The wire envelope for v0.9, v0.9.1, or v1.0+, or `undefined` when
 *   the version is v0.8 or cannot be parsed.
 */
export function toOutboundActionMessage(
  action: ActionPayload,
  version: string | undefined,
): OutboundActionMessage | undefined {
  const canonical = toCanonicalVersion(version);
  if (!canonical) {
    return undefined;
  }

  const body = {
    name: action.name,
    surfaceId: action.surfaceId,
    sourceComponentId: action.sourceComponentId,
    timestamp: action.timestamp,
    context: action.context,
    ...(action.userMessage !== undefined ? {userMessage: action.userMessage} : {}),
    ...(action.catalogId !== undefined ? {catalogId: action.catalogId} : {}),
    ...(action.metadata !== undefined ? {metadata: action.metadata} : {}),
  };

  if (isAtLeastVersion(canonical, '1.0')) {
    return {
      version: '1.0',
      action: body,
    };
  }

  if (canonical === '0.9' || canonical === '0.9.1') {
    return {
      version: canonical === '0.9.1' ? 'v0.9.1' : 'v0.9',
      action: body,
    };
  }

  return undefined;
}
