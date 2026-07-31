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

import {Injectable} from '@angular/core';
import type {Theme as ThemeType} from '../types';

@Injectable({
  providedIn: 'root',
})
export class Theme {
  components: ThemeType['components'] = {} as ThemeType['components'];
  elements: ThemeType['elements'] = {} as ThemeType['elements'];
  markdown: ThemeType['markdown'] = {
    p: [],
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    ul: [],
    ol: [],
    li: [],
    a: [],
    strong: [],
    em: [],
  };
  additionalStyles?: ThemeType['additionalStyles'];

  update(theme: ThemeType) {
    this.components = theme.components;
    this.elements = theme.elements;
    this.markdown = theme.markdown;
    this.additionalStyles = theme.additionalStyles;
  }
}
