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

import {SurfaceComponent} from '@a2ui/angular';
import {ChangeDetectionStrategy, Component, inject} from '@angular/core';

import {Client} from './client';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  imports: [SurfaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly client = inject(Client);

  protected async handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!(event.target instanceof HTMLFormElement)) {
      return;
    }
    const query = new FormData(event.target).get('query');
    if (typeof query === 'string' && query.trim()) {
      await this.client.sendQuery(query.trim());
    }
  }

  protected catalogName(catalogId: string | undefined): string {
    if (!catalogId) return 'no default catalog';
    return catalogId.endsWith('dashboard_catalog.json') ? 'dashboard catalog' : 'basic catalog';
  }
}
