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

/**
 * The Custom Elements of the basic catalog components, by component name,
 * which the v0.9 and v1.0 basic catalogs pair with the component APIs of
 * their own documents.
 */

import {
  A2uiAudioPlayerElement,
  A2uiBasicButtonElement,
  A2uiBasicColumnElement,
  A2uiBasicRowElement,
  A2uiBasicTextElement,
  A2uiBasicTextFieldElement,
  A2uiCardElement,
  A2uiCheckBoxElement,
  A2uiChoicePickerElement,
  A2uiDateTimeInputElement,
  A2uiDividerElement,
  A2uiIconElement,
  A2uiImageElement,
  A2uiListElement,
  A2uiModalElement,
  A2uiSliderElement,
  A2uiTabsElement,
  A2uiVideoElement,
} from '../../universal/basic_catalog/components/index.js';
import type {ComponentApi} from '../../catalog/types.js';
import {
  toWebComponentImplementation,
  type TaggedCustomElementConstructor,
} from '../../universal/to_web_component_implementation.js';
import type {WebComponentImplementation} from '../../universal/web_component_implementation.js';

/** The element of each basic catalog component, by component name. */
export const BASIC_CATALOG_ELEMENTS: Readonly<Record<string, TaggedCustomElementConstructor>> = {
  Text: A2uiBasicTextElement,
  Image: A2uiImageElement,
  Icon: A2uiIconElement,
  Video: A2uiVideoElement,
  AudioPlayer: A2uiAudioPlayerElement,
  Row: A2uiBasicRowElement,
  Column: A2uiBasicColumnElement,
  List: A2uiListElement,
  Card: A2uiCardElement,
  Tabs: A2uiTabsElement,
  Modal: A2uiModalElement,
  Divider: A2uiDividerElement,
  Button: A2uiBasicButtonElement,
  TextField: A2uiBasicTextFieldElement,
  CheckBox: A2uiCheckBoxElement,
  ChoicePicker: A2uiChoicePickerElement,
  Slider: A2uiSliderElement,
  DateTimeInput: A2uiDateTimeInputElement,
};

/**
 * Pairs each component API with the basic catalog element of its name.
 *
 * @throws {Error} If a component has no element.
 */
export function implementComponents(
  apis: Iterable<ComponentApi>,
  catalogId: string,
): WebComponentImplementation[] {
  return [...apis].map(api => {
    const element = Object.hasOwn(BASIC_CATALOG_ELEMENTS, api.name)
      ? BASIC_CATALOG_ELEMENTS[api.name]
      : undefined;
    if (!element) {
      throw new Error(`Catalog '${catalogId}' has no element for component '${api.name}'.`);
    }
    return toWebComponentImplementation(element, api);
  });
}
