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

import {ComponentFixture, TestBed} from '@angular/core/testing';
import {Component, ChangeDetectionStrategy, signal} from '@angular/core';
import {A2uiRendererService, A2UI_RENDERER_CONFIG} from './core/a2ui-renderer.service';
import {SurfaceComponent} from './core/surface.component';
import {BasicCatalog} from './catalog/basic/basic-catalog';
import {A2uiMessage} from '@a2ui/web_core/v0_9';
import {MarkdownRenderer} from './core/markdown';

import restaurantCardMock from './test_data/mocks/restaurant-card.json';
import contactCardMock from './test_data/mocks/contact-card.json';

function normalizeMock(mock: unknown): A2uiMessage[] {
  if (Array.isArray(mock)) return mock as A2uiMessage[];
  if (mock && typeof mock === 'object') {
    const obj = mock as Record<string, unknown>;
    if (Array.isArray(obj['default'])) return obj['default'] as A2uiMessage[];
    return Object.values(obj).filter(
      (v): v is A2uiMessage => typeof v === 'object' && v !== null && 'version' in v,
    );
  }
  return [];
}

@Component({
  template: ' <a2ui-v09-surface [surfaceId]="surfaceId()" [dataContextPath]="basePath()" /> ',
  imports: [SurfaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestHost {
  surfaceId = signal('test-surface');
  basePath = signal('/');
}

describe('v0.9 Angular Renderer Integration', () => {
  let fixture: ComponentFixture<TestHost>;
  let rendererService: A2uiRendererService;
  let actionSpy: jasmine.Spy;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('actionHandler');

    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [
        A2uiRendererService,
        BasicCatalog,
        {
          provide: A2UI_RENDERER_CONFIG,
          useFactory: (basicCatalog: BasicCatalog) => ({
            catalogs: [basicCatalog],
            actionHandler: actionSpy,
          }),
          deps: [BasicCatalog],
        },
        {
          provide: MarkdownRenderer,
          useValue: {
            render: (val: string) => Promise.resolve(val),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    rendererService = TestBed.inject(A2uiRendererService);
  });

  it('should process messages and render nested components into DOM', async () => {
    const messages: A2uiMessage[] = [
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'root',
              component: 'Column',
              children: ['text-1', 'button-1'],
            },
            {
              id: 'text-1',
              component: 'Text',
              text: 'Hello v0.9',
            },
            {
              id: 'button-1',
              component: 'Button',
              child: 'button-text',
            },
            {
              id: 'button-text',
              component: 'Text',
              text: 'Click Me',
            },
          ],
        },
      },
    ];

    rendererService.processMessages(messages);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));

    const columnEl = fixture.nativeElement.querySelector('a2ui-v09-column, a2ui-basic-column');
    expect(columnEl).toBeTruthy();

    const textEl = columnEl!.querySelector('a2ui-v09-text, a2ui-basic-text');
    expect(textEl).toBeTruthy();
    expect(textEl!.textContent).toContain('Hello v0.9');

    const buttonEl = columnEl!.querySelector('a2ui-v09-button, a2ui-basic-button');
    expect(buttonEl).toBeTruthy();
    const nativeBtn = buttonEl!.querySelector('button');
    expect(nativeBtn).toBeTruthy();
    const btnTextEl = buttonEl!.querySelector('a2ui-v09-text, a2ui-basic-text');
    expect(btnTextEl).toBeTruthy();
    expect(btnTextEl!.textContent).toContain('Click Me');
  });

  it('should handle data model updates and reactive data binding', async () => {
    // Initial surface creation with data-bound text
    rendererService.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'test-surface',
          path: '/user',
          value: {},
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: {
                path: '/user/name',
              },
            },
          ],
        },
      },
    ] as A2uiMessage[]);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const textEl = fixture.nativeElement.querySelector('a2ui-v09-text, a2ui-basic-text');
    expect(textEl).toBeTruthy();
    expect(textEl!.textContent?.trim()).toBe('');

    // Update data model
    rendererService.processMessages([
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'test-surface',
          path: '/user/name',
          value: 'Alice',
        },
      },
    ] as A2uiMessage[]);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(textEl!.textContent).toContain('Alice');
  });

  it('should dispatch actions to the action handler', async () => {
    rendererService.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'root',
              component: 'Button',
              child: 'btn-text',
              action: {
                event: {
                  name: 'navigate',
                  context: {url: 'https://example.com'},
                },
              },
            },
            {
              id: 'btn-text',
              component: 'Text',
              text: 'Fire Action',
            },
          ],
        },
      },
    ] as A2uiMessage[]);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const buttonEl = fixture.nativeElement.querySelector('a2ui-v09-button, a2ui-basic-button');
    expect(buttonEl).toBeTruthy();

    const nativeBtn = buttonEl!.querySelector('button');
    expect(nativeBtn).toBeTruthy();
    nativeBtn!.click();

    expect(actionSpy).toHaveBeenCalled();
    const actionArg = actionSpy.calls.mostRecent().args[0];
    expect(actionArg.surfaceId).toBe('test-surface');
    expect(actionArg.name).toBe('navigate');
    expect(actionArg.context).toEqual({url: 'https://example.com'});
    expect(actionArg.sourceComponentId).toBe('root');
    expect(actionArg.timestamp).toBeDefined();
  });

  describe('Regression Mocks', () => {
    it('should render the Restaurant Card regression mock correctly', async () => {
      const mockMessages = normalizeMock(restaurantCardMock);
      rendererService.processMessages(mockMessages);

      fixture.componentInstance.surfaceId.set('gallery-restaurant-card');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const cardEl = fixture.nativeElement.querySelector(
        'a2ui-v09-card, a2ui-card, a2ui-basic-card',
      );
      expect(cardEl).toBeTruthy();
    });

    it('should render the Contact Card regression mock correctly', async () => {
      const mockMessages = normalizeMock(contactCardMock);
      rendererService.processMessages(mockMessages);

      fixture.componentInstance.surfaceId.set('gallery-contact-card');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const cardEl = fixture.nativeElement.querySelector(
        'a2ui-v09-card, a2ui-card, a2ui-basic-card',
      );
      expect(cardEl).toBeTruthy();
    });
  });
});

describe('v0.9.1 Angular Renderer Integration', () => {
  let fixture: ComponentFixture<TestHost>;
  let rendererService: A2uiRendererService;
  let actionSpy: jasmine.Spy;

  beforeEach(async () => {
    actionSpy = jasmine.createSpy('actionHandler');

    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [
        A2uiRendererService,
        BasicCatalog,
        {
          provide: A2UI_RENDERER_CONFIG,
          useFactory: (basicCatalog: BasicCatalog) => ({
            catalogs: [basicCatalog],
            actionHandler: actionSpy,
          }),
          deps: [BasicCatalog],
        },
        {
          provide: MarkdownRenderer,
          useValue: {
            render: (val: string) => Promise.resolve(val),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    rendererService = TestBed.inject(A2uiRendererService);
  });

  it('should process and render v0.9.1 messages', async () => {
    const v091Messages: A2uiMessage[] = [
      {
        version: 'v0.9.1',
        createSurface: {
          surfaceId: 'v091-surface',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        },
      },
      {
        version: 'v0.9.1',
        updateComponents: {
          surfaceId: 'v091-surface',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: 'Hello from v0.9.1!',
            },
          ],
        },
      },
    ];

    rendererService.processMessages(v091Messages);
    fixture.componentInstance.surfaceId.set('v091-surface');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));

    const textEl = fixture.nativeElement.querySelector('a2ui-v09-text, a2ui-basic-text');
    expect(textEl).toBeTruthy();
    expect(textEl!.textContent).toContain('Hello from v0.9.1!');
  });
});
