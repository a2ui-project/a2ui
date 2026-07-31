/**
 * Copyright 2025 Google LLC
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

import {BaseEventDetail} from './base.js';

/**
 * Detailed payload for the `a2ui-validation-input` event.
 */
export interface ValidationEventDetail extends BaseEventDetail<'a2ui-validation-input'> {
  /**
   * The ID of the component that is being validated.
   */
  readonly componentId: string;

  /**
   * The current value of the input component.
   */
  readonly value: string;

  /**
   * Whether the current value matches the validation constraints.
   */
  readonly valid: boolean;
}

/**
 * Event dispatched when an input component's validation state is updated.
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
