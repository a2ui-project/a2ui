/*
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

import type {CSSResultGroup} from 'lit';
import * as Styles from '@a2ui/web_core/styles/index';

const buildStructuralStyles = (): CSSResultGroup => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const styleSheet = new CSSStyleSheet();
    styleSheet.replaceSync(Styles.structuralStyles);
    return styleSheet;
  } catch (e) {
    throw new Error('Failed to construct structural styles.', {cause: e});
  }
};

export const structuralStyles = buildStructuralStyles();
