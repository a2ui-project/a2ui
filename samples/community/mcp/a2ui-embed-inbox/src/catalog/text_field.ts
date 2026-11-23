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
 * The inbox's `TextField`: the basic catalog TextField with a taller
 * multi-line box (about six lines), so a reply draft is readable without
 * scrolling. Same API and behavior otherwise.
 */

import {css, type CSSResultGroup, type LitElement} from 'lit';

import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import type {WebComponentImplementation} from '@a2ui/web_core/universal';

const basicTextField = basicCatalog.components.get('TextField') as WebComponentImplementation & {
  element: typeof LitElement & {styles?: CSSResultGroup};
};

/** `TextField` element with a six-line `longText` box. */
export class A2uiInboxTextFieldElement extends basicTextField.element {
  static readonly tagName = 'a2ui-inbox-textfield';

  static override styles = [
    basicTextField.element.styles ?? [],
    css`
      textarea.a2ui-textfield {
        min-height: var(--a2ui-inbox-textarea-min-height, 9.5em);
        line-height: 1.4;
        resize: vertical;
      }
    `,
  ];
}

/** `TextField` implementation for the inbox catalog. */
export const A2uiInboxTextField = {
  ...basicTextField,
  tagName: A2uiInboxTextFieldElement.tagName,
  element: A2uiInboxTextFieldElement,
};
