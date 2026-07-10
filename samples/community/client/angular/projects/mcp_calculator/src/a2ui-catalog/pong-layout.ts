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
import {CatalogComponent, ComponentHostComponent} from '@a2ui/angular/v0_9';
import {Component, computed} from '@angular/core';

@Component({
  selector: 'a2ui-pong-layout',
  standalone: true,
  imports: [ComponentHostComponent],
  template: `
    <div
      style="display: flex; flex-direction: row; width: 100%; max-width: 900px; margin: 0 auto; background: #000; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1);"
    >
      <div
        style="width: 200px; border-right: 1px solid #e8eaed; display: flex; flex-direction: column; background: #ffffff; z-index: 1;"
      >
        @if (scoreboardComponent()) {
          <a2ui-v09-component-host
            [componentKey]="scoreboardComponent()"
            [surfaceId]="surfaceId()"
          ></a2ui-v09-component-host>
        }
      </div>
      <div style="flex: 1; min-height: 440px; position: relative;">
        @if (mcpComponent()) {
          <a2ui-v09-component-host
            [componentKey]="mcpComponent()"
            [surfaceId]="surfaceId()"
          ></a2ui-v09-component-host>
        }
      </div>
    </div>
  `,
})
export class PongLayout extends CatalogComponent<any> {
  protected readonly mcpComponent = computed(() => this.props()['mcpComponent']?.value());
  protected readonly scoreboardComponent = computed(() =>
    this.props()['scoreboardComponent']?.value(),
  );
}
