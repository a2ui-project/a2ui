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
import {Renderer} from './rendering/renderer';
import {Catalog} from './rendering/catalog';
import {DEFAULT_CATALOG} from './catalog';
import {Theme} from './rendering/theming';
import {MessageProcessor} from './data/processor';
import {MarkdownRenderer} from './data/markdown';
import {Component} from '@angular/core';
import * as restaurantCardMock from './test_data/mocks/restaurant-card.json';
import * as contactCardMock from './test_data/mocks/contact-card.json';

/**
 * Resolves a component tree from a flat list of component messages.
 * This handles the v0.8 format where children are often referenced by ID.
 */
function resolveComponentTree(messages: any[], rootId: string): any {
  const surfaceUpdate = messages.find(m => m.surfaceUpdate)?.surfaceUpdate;
  if (!surfaceUpdate) return null;

  const componentMap = new Map(surfaceUpdate.components.map((c: any) => [c.id, c]));

  function resolve(idOrNode: any): any {
    if (typeof idOrNode === 'string') {
      const node = componentMap.get(idOrNode);
      return node ? resolve(node) : null;
    }

    if (idOrNode && typeof idOrNode === 'object') {
      // If it's already in the { type, properties } format, just return it
      if (idOrNode.type && idOrNode.properties) return idOrNode;

      // If it's in the { id, component: { Type: { ... } } } format
      if (idOrNode.component) {
        const type = Object.keys(idOrNode.component)[0];
        const properties = {...idOrNode.component[type]};

        // Recursively resolve children
        if (properties.child) {
          properties.child = resolve(properties.child);
        }
        if (properties.children) {
          if (Array.isArray(properties.children)) {
            properties.children = properties.children.map((c: any) => resolve(c));
          } else if (properties.children.explicitList) {
            properties.children = properties.children.explicitList.map((id: string) => resolve(id));
          }
        }

        return {
          id: idOrNode.id,
          type,
          properties,
        };
      }
    }
    return idOrNode;
  }

  return resolve(rootId);
}

@Component({
  template: `<ng-container
    a2ui-renderer
    [surfaceId]="surfaceId"
    [component]="component"
  ></ng-container>`,
  standalone: true,
  imports: [Renderer],
})
class TestHost {
  surfaceId = 'test-surface';
  component: any = null;
}

describe('v0.8 Angular Renderer Integration', () => {
  let fixture: ComponentFixture<TestHost>;
  let processor: jasmine.SpyObj<MessageProcessor>;

  beforeEach(async () => {
    processor = jasmine.createSpyObj('MessageProcessor', [
      'getData',
      'dispatch',
      'resolvePath',
      'version',
    ]);
    // Default mock behavior for getData
    processor.getData.and.callFake((node: any, path: string, surfaceId?: string) => {
      if (path === '/name') return 'The Italian Kitchen';
      return `resolved:${path}`;
    });

    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [
        {provide: MessageProcessor, useValue: processor},
        {provide: Catalog, useValue: DEFAULT_CATALOG},
        {
          provide: MarkdownRenderer,
          useValue: {
            render: (val: string) => Promise.resolve(val),
          },
        },
        Theme,
      ],
    }).compileComponents();
    const theme = TestBed.inject(Theme);
    theme.update({
      components: {
        Text: {
          all: {'a2ui-text': true},
          h1: {'a2ui-text-h1': true},
          h2: {'a2ui-text-h2': true},
          h3: {'a2ui-text-h3': true},
          h4: {'a2ui-text-h4': true},
          h5: {'a2ui-text-h5': true},
          body: {'common-body': true},
          caption: {'caption-style': true},
        },
        Card: {'a2ui-card': true},
        Row: {'a2ui-row': true},
        Column: {'a2ui-column': true},
        Image: {all: {'a2ui-image': true}, avatar: {'avatar-style': true}},
        Divider: {'a2ui-divider': true},
        Icon: {'a2ui-icon': true},
        Button: {'a2ui-button': true},
      } as any,
      elements: {} as any,
      markdown: {
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
      },
    });

    fixture = TestBed.createComponent(TestHost);
  });

  it('should inject structural styles and they should be effective', () => {
    fixture.componentInstance.component = {
      type: 'Row',
      id: 'row-1',
      properties: {children: []},
    };
    fixture.detectChanges();

    const rowEl = fixture.nativeElement.querySelector('a2ui-row section');
    if (rowEl) {
      const style = window.getComputedStyle(rowEl);
      // Verify that structural styles are applied (Row should be display: flex)
      // Note: In JSDOM this might return empty if styles isn't parsed,
      // but Karma/ChromeHeadless will return 'flex'.
      expect(style.display).toBe('flex');
    }
  });

  it('should render a Restaurant Card using real components and catalog', async () => {
    // Partial mock of the restaurant card component structure
    fixture.componentInstance.component = {
      type: 'Card',
      id: 'root',
      properties: {
        child: {
          type: 'Column',
          id: 'main-col',
          properties: {
            children: [
              {
                type: 'Text',
                id: 'name',
                properties: {
                  text: {path: '/name'},
                  usageHint: 'h2',
                },
              },
            ],
          },
        },
      },
    };

    // Mock data resolution for the name
    processor.getData.and.callFake((node: any, path: string, surfaceId?: string) => {
      if (path === '/name') return 'The Italian Kitchen';
      return `resolved:${path}`;
    });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const textEl = fixture.nativeElement.querySelector('a2ui-text section');
    expect(textEl).toBeTruthy();
    expect(textEl.textContent).toContain('The Italian Kitchen');

    // Check that it's rendered as h2 (via usageHint -> style classes)
    // The Text component adds classes based on usageHint
    expect(textEl.className).toContain('a2ui-text-h2');
  });

  it('should handle the v0.8 component wrapper format (unwrapping)', async () => {
    // In v0.8, components are often wrapped: { "Text": { ... } }
    fixture.componentInstance.component = {
      id: 'wrapper-test',
      component: {
        Text: {
          text: {literalString: 'Wrapped Text'},
        },
      },
    };

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The Renderer should have unwrapped this
    const textEl = fixture.nativeElement.querySelector('a2ui-text section');
    expect(textEl).toBeTruthy();
    expect(textEl.textContent).toContain('Wrapped Text');
  });

  it('should be resilient to unknown component properties', async () => {
    fixture.componentInstance.component = {
      type: 'Text',
      id: 'text-1',
      properties: {
        text: {literalString: 'Resilient'},
        unknownProp: 'should not crash',
      },
    };

    const warnSpy = spyOn(console, 'warn');

    // This should NOT throw even though Text doesn't have unknownProp input
    expect(() => {
      fixture.detectChanges();
    }).not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
  });

  describe('Regression Mocks', () => {
    it('should render the Restaurant Card regression mock correctly', async () => {
      const mockData = (restaurantCardMock as any).default || restaurantCardMock;
      const beginMsg = mockData.find((m: any) => m.beginRendering);
      const dataMsg = mockData.find((m: any) => m.dataModelUpdate);
      const rootId = beginMsg?.beginRendering.root;
      const componentTree = resolveComponentTree(mockData, rootId!);

      // Mock data resolution from the mock's own data model
      const contents = dataMsg?.dataModelUpdate.contents || [];
      const dataModel = new Map(
        contents.map((item: any) => [
          item.key,
          item.valueString || item.valueImage || item.valueBoolean || item.valueNumber,
        ]),
      );
      processor.getData.and.callFake((node: any, path: string) => {
        const key = path.startsWith('/') ? path.substring(1) : path;
        return dataModel.has(key) ? dataModel.get(key) : `resolved:${path}`;
      });

      fixture.componentInstance.component = componentTree;
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // Verify structure
      const cardEl = fixture.nativeElement.querySelector('a2ui-card');
      expect(cardEl).toBeTruthy();

      const imageEl = fixture.nativeElement.querySelector('a2ui-image img');
      expect(imageEl).toBeTruthy();
      expect(imageEl.src).toContain('unsplash.com');

      const nameEl = fixture.nativeElement.querySelector('a2ui-text section');
      expect(nameEl).toBeTruthy();
      expect(nameEl.textContent).toContain('The Italian Kitchen');

      const ratingRow = fixture.nativeElement.querySelectorAll('a2ui-row');
      // Should find several rows (name-row, rating-row, details-row)
      expect(ratingRow.length).toBeGreaterThanOrEqual(3);
    });

    it('should render the Contact Card regression mock correctly', async () => {
      const mockData = (contactCardMock as any).default || contactCardMock;
      const beginMsg = mockData.find((m: any) => m.beginRendering);
      const dataMsg = mockData.find((m: any) => m.dataModelUpdate);
      const rootId = beginMsg?.beginRendering.root;
      const componentTree = resolveComponentTree(mockData, rootId!);

      // Mock data resolution from the mock's own data model
      const contents = dataMsg?.dataModelUpdate.contents || [];
      const dataModel = new Map(
        contents.map((item: any) => [
          item.key,
          item.valueString || item.valueImage || item.valueBoolean || item.valueNumber,
        ]),
      );
      processor.getData.and.callFake((node: any, path: string) => {
        const key = path.startsWith('/') ? path.substring(1) : path;
        return dataModel.has(key) ? dataModel.get(key) : `resolved:${path}`;
      });

      fixture.componentInstance.component = componentTree;
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // Verify structure
      const cardEl = fixture.nativeElement.querySelector('a2ui-card');
      expect(cardEl).toBeTruthy();

      const nameEl = fixture.nativeElement.querySelector('a2ui-text section');
      expect(nameEl).toBeTruthy();
      expect(nameEl.textContent).toContain('David Park');

      const avatarEl = fixture.nativeElement.querySelector('a2ui-image img');
      expect(avatarEl).toBeTruthy();
      expect(avatarEl.src).toContain('unsplash.com');

      const dividerEl = fixture.nativeElement.querySelector('a2ui-divider');
      expect(dividerEl).toBeTruthy();
    });
  });
});
