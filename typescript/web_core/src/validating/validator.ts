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

import {A2uiValidationError} from '../errors.js';
import {AgentToRendererMessageSchema} from '../v1_0/schema/agent-to-renderer.js';
import {
  ComponentRefMap,
  IntegrityOptions,
  STANDARD_REF_MAP,
  validateComponentIntegrity,
  validateRecursionAndPaths,
} from './integrity-checker.js';
import {analyzeTopology, TopologyOptions} from './topology-analyzer.js';

export interface ValidationConfig extends IntegrityOptions, TopologyOptions {}

export const STRICT_VALIDATION: ValidationConfig = {
  allowOrphanComponents: false,
  allowDanglingReferences: false,
  allowMissingRoot: false,
};

export const RELAXED_VALIDATION: ValidationConfig = {
  allowOrphanComponents: true,
  allowDanglingReferences: true,
  allowMissingRoot: true,
};

/**
 * High-level validator for auditing A2UI message streams, components, and graph topology.
 */
export class A2uiValidator {
  /**
   * Validates a list of protocol messages against Zod message envelope schemas.
   */
  public validateProtocolEnvelope(messages: Array<Record<string, any>>): void {
    if (!Array.isArray(messages)) {
      throw new A2uiValidationError('Message stream must be an array of objects');
    }

    for (let idx = 0; idx < messages.length; idx++) {
      const msg = messages[idx];
      if (typeof msg !== 'object' || msg === null) {
        throw new A2uiValidationError(`Message must be an object at index ${idx}`);
      }

      const parseResult = AgentToRendererMessageSchema.safeParse(msg);
      if (!parseResult.success) {
        throw new A2uiValidationError(
          `Validation failed for message at index ${idx}: ${parseResult.error.message}`,
        );
      }
    }
  }

  /**
   * Validates component list integrity and graph topology.
   */
  public validateComponents(
    components: Array<Record<string, any>>,
    refFieldsMap: ComponentRefMap = STANDARD_REF_MAP,
    config: ValidationConfig = STRICT_VALIDATION,
  ): void {
    validateComponentIntegrity(components, refFieldsMap, config);
    analyzeTopology(components, refFieldsMap, config);
    validateRecursionAndPaths(components);
  }

  /**
   * Validates an entire A2UI payload (envelope, components, topology, and path syntax).
   */
  public validate(
    messages: Array<Record<string, any>> | Record<string, any>,
    refFieldsMap: ComponentRefMap = STANDARD_REF_MAP,
    config: ValidationConfig = STRICT_VALIDATION,
  ): void {
    const msgList = Array.isArray(messages) ? messages : [messages];
    this.validateProtocolEnvelope(msgList);

    for (const msg of msgList) {
      validateRecursionAndPaths(msg);

      const updateComps = msg.updateComponents?.components;
      if (Array.isArray(updateComps)) {
        this.validateComponents(updateComps, refFieldsMap, config);
      }
    }
  }
}
