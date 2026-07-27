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
import {Renderer} from '../rendering/renderer';
import {Catalog} from '../rendering/catalog';
import {DEFAULT_CATALOG} from '../catalog';
import {Theme} from '../rendering/theming';
import {MessageProcessor} from '../data/processor';
import {MarkdownRenderer} from '../data/markdown';
import {Component} from '@angular/core';

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

describe('Row Component Integration (Real Renderer)', () => {
  let fixture: ComponentFixture<TestHost>;
  let processor: jasmine.SpyObj<MessageProcessor>;

  beforeEach(async () => {
    processor = jasmine.createSpyObj('MessageProcessor', [
      'getData',
      'dispatch',
      'resolvePath',
      'version',
    ]);

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
        Row: {'a2ui-row': true},
        Text: {all: {'a2ui-text': true}},
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

  it('should render children using the real renderer', async () => {
    fixture.componentInstance.component = {
      type: 'Row',
      id: 'row-1',
      properties: {
        children: [
          {
            type: 'Text',
            id: 'child-1',
            properties: {text: {literalString: 'Child 1'}},
          },
          {
            type: 'Text',
            id: 'child-2',
            properties: {text: {literalString: 'Child 2'}},
          },
        ],
      },
    };

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const rowEl = fixture.nativeElement.querySelector('a2ui-row');
    expect(rowEl).toBeTruthy();

    const children = fixture.nativeElement.querySelectorAll('a2ui-text');
    expect(children.length).toBe(2);
    expect(children[0].textContent).toContain('Child 1');
    expect(children[1].textContent).toContain('Child 2');
  });

  it('should pass alignment and distribution to the real Row component', async () => {
    fixture.componentInstance.component = {
      type: 'Row',
      id: 'row-1',
      properties: {
        children: [],
        alignment: 'center',
        distribution: 'space-between',
      },
    };

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const sectionEl = fixture.nativeElement.querySelector('a2ui-row section');
    expect(sectionEl).toBeTruthy();
    expect(sectionEl.className).toContain('align-center');
    expect(sectionEl.className).toContain('distribute-space-between');
  });
});
