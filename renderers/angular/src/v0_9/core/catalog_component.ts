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

import {ComponentApi} from '@a2ui/web_core/v0_9';
import {Directive, input} from '@angular/core';
import {ComponentApiToProps} from './types';
import {CatalogComponentInstance} from './catalog_component_instance';

/**
 * Base class for A2UI catalog component in Angular.
 *
 * All Angular catalog components should extend this base class,
 * which provides type safe access to props() and other common
 * fields.
 */
@Directive()
export abstract class CatalogComponent<
  Api extends ComponentApi,
> implements CatalogComponentInstance {
  /**
   * Reactive properties resolved from the A2UI ComponentModel.
   */
  readonly props = input<ComponentApiToProps<Api>>({} as ComponentApiToProps<Api>);
  readonly surfaceId = input.required<string>();
  readonly componentId = input.required<string>();
  readonly dataContextPath = input<string>('/');
}
