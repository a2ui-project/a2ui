/*
 * Copyright 2026 Google LLC
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

/**
 * @fileoverview Compatibility exports for legacy Events namespace.
 * @deprecated Use named exports from '@a2ui/web_core' instead, or import legacy events from '@a2ui/web_core/v0_8'.
 */

export * from './common/events.js';

/**
 * @deprecated Legacy event detail interface. For v0.8 compatibility, import from '@a2ui/web_core/v0_8'.
 */
export interface BaseEventDetail<EventType extends string> {
  readonly eventType: EventType;
}

/**
 * @deprecated Detailed payload for the legacy `a2ui-validation-input` event. For v0.8 compatibility, import from '@a2ui/web_core/v0_8'.
 */
export interface ValidationEventDetail extends BaseEventDetail<'a2ui-validation-input'> {
  readonly componentId: string;
  readonly value: string;
  readonly valid: boolean;
}

/**
 * @deprecated Event dispatched when an input component's validation state is updated. For v0.8 compatibility, import from '@a2ui/web_core/v0_8'.
 */
export class A2UIValidationEvent extends CustomEvent<ValidationEventDetail> {
  static readonly EVENT_NAME = 'a2ui-validation-input';

  constructor(detail: Omit<ValidationEventDetail, 'eventType'>, eventInitDict?: EventInit) {
    super(A2UIValidationEvent.EVENT_NAME, {
      bubbles: true,
      composed: true,
      ...eventInitDict,
      detail: {
        ...detail,
        eventType: A2UIValidationEvent.EVENT_NAME,
      },
    });
  }
}

declare global {
  interface HTMLElementEventMap {
    'a2ui-validation-input': A2UIValidationEvent;
  }
}
