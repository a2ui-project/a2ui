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

import {inject, provideZonelessChangeDetection, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';

import {
  A2uiRendererService,
  BasicCatalog,
  provideA2Ui,
  provideMarkdownRenderer,
} from '@a2ui/angular/v0_9';
import {A2uiMessage} from '@a2ui/web_core/v0_9';

import {App} from './app';
import {Client} from './client';

class StubClient {
  private readonly renderer = inject(A2uiRendererService);
  readonly isLoading = signal(false);
  readonly handleAction = jasmine.createSpy('handleAction');
  readonly makeRequest = jasmine
    .createSpy<Client['makeRequest']>('makeRequest')
    .and.callFake(async () => {
      const messages: A2uiMessage[] = [
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 'restaurant-surface',
            catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
          },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'restaurant-surface',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: 'Golden Dragon Bistro',
              },
            ],
          },
        },
      ];
      this.renderer.processMessages(messages);
      return [];
    });
}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        provideA2Ui(() => ({
          catalogs: [new BasicCatalog()],
          actionHandler: () => {},
        })),
        provideMarkdownRenderer((val: string) => Promise.resolve(val)),
        {provide: Client, useClass: StubClient},
      ],
    }).compileComponents();
  });

  it('creates the app and renders the initial search form', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeInstanceOf(App);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.app-title')?.textContent).toBe('Restaurant Finder');

    const input = compiled.querySelector('input[name="body"]') as HTMLInputElement | null;
    expect(input?.value).toBe('Top 5 Chinese restaurants in New York.');
  });

  it('renders surface content when the stubbed client processes v0.9 messages', async () => {
    const fixture = TestBed.createComponent(App);
    const client = TestBed.inject(Client) as unknown as StubClient;
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const form = compiled.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new SubmitEvent('submit', {bubbles: true, cancelable: true}));

    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(client.makeRequest).toHaveBeenCalledOnceWith('Top 5 Chinese restaurants in New York.');

    const surfaceEl = compiled.querySelector('a2ui-v09-surface');
    expect(surfaceEl).toBeInstanceOf(HTMLElement);

    const textEl = compiled.querySelector('a2ui-v09-text');
    expect(textEl?.textContent).toContain('Golden Dragon Bistro');
  });
});
