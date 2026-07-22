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

import {ComponentFixture, TestBed} from '@angular/core/testing';
import {Component, ChangeDetectionStrategy} from '@angular/core';
import {A2uiRendererService, A2UI_RENDERER_CONFIG} from './core/a2ui-renderer.service';
import {SurfaceComponent} from './core/surface.component';
import {BasicCatalog} from './catalog/basic/basic-catalog';
import {A2uiMessage} from '@a2ui/web_core/v0_9';
import {MarkdownRenderer} from './core/markdown';

import * as restaurantCardMock from './test_data/mocks/restaurant-card.json';
import * as contactCardMock from './test_data/mocks/contact-card.json';

@Component({
  template: `
    <div id="test-host">
      <a2ui-v09-surface [surfaceId]="surfaceId"></a2ui-v09-surface>
    </div>
  `,
  standalone: true,
  imports: [SurfaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestHost {
  surfaceId = 'test-surface';
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

  it('should render a basic component tree from protocol messages', async () => {
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
              children: ['text-id', 'button-id'],
            },
            {
              id: 'text-id',
              component: 'Text',
              text: 'Hello v0.9',
            },
            {
              id: 'button-id',
              component: 'Button',
              child: 'button-text-id',
            },
            {
              id: 'button-text-id',
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

    const columnEl = fixture.nativeElement.querySelector('a2ui-v09-column');
    expect(columnEl).toBeTruthy();

    const textEl = fixture.nativeElement.querySelector('a2ui-v09-text');
    expect(textEl).toBeTruthy();
    expect(textEl.textContent).toContain('Hello v0.9');

    const buttonEl = fixture.nativeElement.querySelector('a2ui-v09-button button');
    expect(buttonEl).toBeTruthy();
    expect(buttonEl.textContent).toContain('Click Me');
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
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: {path: '/user/name'},
            },
          ],
        },
      },
    ] as A2uiMessage[]);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    let textEl = fixture.nativeElement.querySelector('a2ui-v09-text');
    expect(textEl.textContent.trim()).toBe('');

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

    textEl = fixture.nativeElement.querySelector('a2ui-v09-text');
    expect(textEl.textContent).toContain('Alice');
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

    const button = fixture.nativeElement.querySelector('button');
    button.click();

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
      const mockMessages = (restaurantCardMock as any).default || restaurantCardMock;
      rendererService.processMessages(mockMessages);

      fixture.componentInstance.surfaceId = 'gallery-restaurant-card';
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const cardEl = fixture.nativeElement.querySelector('a2ui-v09-card');
      expect(cardEl).toBeTruthy();

      const imageEl = fixture.nativeElement.querySelector('a2ui-v09-image img');
      expect(imageEl).toBeTruthy();
      expect(imageEl.src).toContain('unsplash.com');

      const nameEl = fixture.nativeElement.querySelector('a2ui-v09-text');
      // The first text should be the name
      expect(nameEl.textContent).toContain('The Italian Kitchen');

      const rows = fixture.nativeElement.querySelectorAll('a2ui-v09-row');
      expect(rows.length).toBeGreaterThanOrEqual(3);
    });

    it('should render the Contact Card regression mock correctly', async () => {
      const mockMessages = (contactCardMock as any).default || contactCardMock;
      rendererService.processMessages(mockMessages);

      fixture.componentInstance.surfaceId = 'gallery-contact-card';
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const cardEl = fixture.nativeElement.querySelector('a2ui-v09-card');
      expect(cardEl).toBeTruthy();

      const nameEl = fixture.nativeElement.querySelector('a2ui-v09-text');
      expect(nameEl.textContent).toContain('David Park');

      const avatarEl = fixture.nativeElement.querySelector('a2ui-v09-image img');
      expect(avatarEl).toBeTruthy();
      expect(avatarEl.src).toContain('unsplash.com');

      const dividerEl = fixture.nativeElement.querySelector('a2ui-v09-divider');
      expect(dividerEl).toBeTruthy();
    });
  });
});

// TODO: Replace this by actual 0.9.1 tests by loading from the examples.
// Note that this cannot be done now, because the v0_9_1 examples have the wrong
// "version" field ("0.9" instead of "0.9.1").
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
    fixture.componentInstance.surfaceId = 'v091-surface';
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const textEl = fixture.nativeElement.querySelector('a2ui-v09-text');
    expect(textEl).toBeTruthy();
    expect(textEl.textContent).toContain('Hello from v0.9.1!');
  });
});
