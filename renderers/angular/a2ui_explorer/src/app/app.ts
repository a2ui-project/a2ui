/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Component} from '@angular/core';
import {DemoComponent} from './demo.component';

/**
 * Root Component of the A2UI Angular Demo app.
 *
 * This component acts as a direct container that embeds the `<a2ui-v0-9-demo>` dashboard.
 * All dynamic canvas layout and agent rendering behavior is handled inside `DemoComponent`.
 */
@Component({
  selector: 'app-root',
  imports: [DemoComponent],
  template: '<a2ui-v0-9-demo></a2ui-v0-9-demo>',
})
export class App {}
