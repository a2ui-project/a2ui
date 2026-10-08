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

import {
  CatalogApi,
  MessageProcessor,
  STRICT_VALIDATION,
  A2uiValidationError,
  A2uiCatalogError,
  A2uiError,
} from '../internal/web-core.js';
import {toWireProtocolVersion} from './protocol-version.js';
import {validateEnvelope} from './envelope-validation.js';

/**
 * Checks that catalogs target the same release line and returns it.
 *
 * @throws {A2uiCatalogError} If no catalogs are provided or they target different protocol versions.
 */
export function checkParserCatalogs(catalogs: CatalogApi[]): string {
  if (!catalogs || catalogs.length === 0) {
    throw new A2uiCatalogError('Parser requires at least one catalog.');
  }

  const releaseLines = new Set<string>();
  for (const catalog of catalogs) {
    const wireVersion = toWireProtocolVersion(catalog.protocolVersion || 'v1.0');
    let releaseLine = wireVersion;
    if (wireVersion === 'v0.9.1' || wireVersion === 'v0.9') {
      releaseLine = 'v0.9';
    }
    releaseLines.add(releaseLine);
  }

  if (releaseLines.size > 1) {
    throw new A2uiCatalogError(
      `The catalogs target incompatible protocol versions: ${Array.from(releaseLines).sort().join(', ')}.`,
    );
  }

  return toWireProtocolVersion(catalogs[0].protocolVersion || 'v1.0');
}

/**
 * Validates a parsed payload against the active catalogs.
 */
export function validatePayload(catalogs: CatalogApi[], payload: unknown[]): void {
  const wireProtocolVersion = checkParserCatalogs(catalogs);
  if (!Array.isArray(payload)) {
    throw new A2uiValidationError('Payload is not a JSON array.');
  }
  if (payload.length === 0) {
    return;
  }

  const releaseLine =
    wireProtocolVersion === 'v0.9.1' || wireProtocolVersion === 'v0.9'
      ? 'v0.9'
      : wireProtocolVersion;

  const validVersions = new Set<string>();
  if (releaseLine === 'v0.9') {
    validVersions.add('v0.9');
    validVersions.add('v0.9.1');
  } else if (releaseLine === 'v1.0') {
    validVersions.add('v1.0');
  } else {
    validVersions.add(wireProtocolVersion);
  }

  const createSurfaceTargets = new Set<string>();
  const messagesBySurfaceId = new Map<string, unknown[]>();

  for (let i = 0; i < payload.length; i++) {
    const item = payload[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new A2uiValidationError(`Message ${i} is not a JSON object.`);
    }

    validateEnvelope(item as any, releaseLine);
    const version = (item as any).version;
    if (typeof version !== 'string' || !validVersions.has(version)) {
      if (version === undefined || version === null) {
        throw new A2uiValidationError(
          `Message ${i} states no version, which ${releaseLine} messages require.`,
        );
      }
      const accepted = Array.from(validVersions)
        .sort()
        .map(v => `'${v}'`)
        .join(' or ');
      throw new A2uiValidationError(
        `Message ${i} states version '${version}', but the catalogs target ${releaseLine}, whose messages state ${accepted}.`,
      );
    }

    const actions = [
      'createSurface',
      'updateComponents',
      'updateDataModel',
      'deleteSurface',
    ].filter(a => a in item);
    if (actions.length === 1) {
      const action = actions[0];
      const surfaceId = (item as any)[action]?.surfaceId;
      if (typeof surfaceId === 'string') {
        if (action === 'createSurface') {
          createSurfaceTargets.add(surfaceId);
        }
        let surfaceMsgs = messagesBySurfaceId.get(surfaceId);
        if (!surfaceMsgs) {
          surfaceMsgs = [];
          messagesBySurfaceId.set(surfaceId, surfaceMsgs);
        }
        surfaceMsgs.push(item);
      }
    }
  }

  // To validate messages for created surfaces, we need them in order.
  // Actually, we can just process the whole payload directly if it creates all surfaces,
  // but we need to remove the update-only surface messages because those will fail.
  const fullValidationMessages: unknown[] = [];
  for (const item of payload) {
    const actions = [
      'createSurface',
      'updateComponents',
      'updateDataModel',
      'deleteSurface',
    ].filter(a => a in (item as any));
    let isUpdateOnlyForSurface = false;
    if (actions.length === 1) {
      const surfaceId = (item as any)[actions[0]]?.surfaceId;
      if (typeof surfaceId === 'string' && !createSurfaceTargets.has(surfaceId)) {
        isUpdateOnlyForSurface = true;
      }
    }
    if (!isUpdateOnlyForSurface) {
      fullValidationMessages.push(item);
    }
  }

  if (fullValidationMessages.length > 0) {
    try {
      const processor = new MessageProcessor(catalogs as any, undefined, {
        validationConfig: STRICT_VALIDATION,
      });
      processor.processMessages(fullValidationMessages as any);
    } catch (e: any) {
      if (e instanceof A2uiValidationError) {
        throw e;
      } else if (e instanceof A2uiError) {
        throw new A2uiValidationError(e.message, (e as any).details);
      }
      throw e;
    }
  }

  for (const [surfaceId, messages] of messagesBySurfaceId.entries()) {
    if (!createSurfaceTargets.has(surfaceId)) {
      validateUpdateOnlySurface(catalogs, releaseLine, surfaceId, messages as any);
    }
  }
}

function validateUpdateOnlySurface(
  catalogs: CatalogApi[],
  protocolVersion: string,
  surfaceId: string,
  messages: any[],
): void {
  const componentTypes = new Set<string>();
  for (const msg of messages) {
    for (const action of ['updateComponents', 'surfaceUpdate']) {
      const components = msg[action]?.components;
      if (Array.isArray(components)) {
        for (const comp of components) {
          if (comp && typeof comp === 'object' && !comp.catalogId) {
            const compType = comp.component;
            if (typeof compType === 'string') {
              componentTypes.add(compType);
            } else if (compType && typeof compType === 'object') {
              for (const key of Object.keys(compType)) {
                componentTypes.add(key);
              }
            }
          }
        }
      }
    }
  }

  let candidates = catalogs.filter(catalog => {
    for (const compType of componentTypes) {
      if (!catalog.components.has(compType)) {
        return false;
      }
    }
    return true;
  });
  if (candidates.length === 0) candidates = [catalogs[0]];

  const errors: A2uiValidationError[] = [];
  for (const catalog of candidates) {
    const synthVersion = messages[0].version || protocolVersion;
    const synthMsg = {
      version: synthVersion,
      createSurface: {
        surfaceId: surfaceId,
        catalogId: catalog.id,
      },
    };

    const toValidate = [synthMsg, ...messages];

    try {
      const processor = new MessageProcessor(catalogs as any, undefined, {
        validationConfig: {
          allowDanglingReferences: true,
          allowMissingRoot: true,
          allowOrphanComponents: true,
        },
      });
      processor.processMessages(toValidate as any);
      return;
    } catch (e: any) {
      if (e instanceof A2uiValidationError) {
        errors.push(e);
      } else if (e instanceof A2uiError) {
        errors.push(new A2uiValidationError(e.message, (e as any).details));
      } else {
        throw e;
      }
    }
  }

  if (errors.length > 0) {
    throw errors[0];
  }
}
