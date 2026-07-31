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
import {Tabs} from './tabs';
import {MessageProcessor} from '../data/processor';
import {Theme} from '../rendering/theming';
import {Catalog} from '../rendering/catalog';
import {Directive, Input} from '@angular/core';
import {By} from '@angular/platform-browser';

@Directive({
  selector: '[a2ui-renderer]',
  standalone: true,
})
class MockRenderer {
  @Input() surfaceId!: string;
  @Input() component!: any;

  static instances: MockRenderer[] = [];
  constructor() {
    MockRenderer.instances.push(this);
  }
}

describe('Tabs Component', () => {
  let component: Tabs;
  let fixture: ComponentFixture<Tabs>;
  let mockTheme: Theme;

  const mockTabItems = [
    {
      title: {literalString: 'Tab 1'} as any,
      child: {id: 'child-1', type: 'Text', properties: {text: 'Content 1'}},
    },
    {
      title: {literalString: 'Tab 2'} as any,
      child: {id: 'child-2', type: 'Text', properties: {text: 'Content 2'}},
    },
  ];

  beforeEach(async () => {
    mockTheme = new Theme();
    mockTheme.components = {
      Tabs: {
        container: 'tabs-container',
        controls: {
          all: 'tabs-controls-all',
          selected: {'tabs-controls-selected': true},
        },
      },
    } as any;

    await TestBed.configureTestingModule({
      imports: [Tabs],
      providers: [
        {
          provide: MessageProcessor,
          useValue: {resolvePrimitive: (p: any) => p?.literalString || p},
        },
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: {}},
      ],
    })
      .overrideComponent(Tabs, {
        set: {
          imports: [MockRenderer],
        },
      })
      .compileComponents();

    MockRenderer.instances = []; // Clear tracking

    fixture = TestBed.createComponent(Tabs);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('component', {id: 'tabs-1', type: 'Tabs', weight: 1});
    fixture.componentRef.setInput('weight', 1);
    fixture.componentRef.setInput('tabItems', mockTabItems);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render tab buttons with titles', () => {
    const buttonEls = fixture.debugElement.queryAll(By.css('button'));
    expect(buttonEls.length).toBe(2);
    expect(buttonEls[0].nativeElement.textContent.trim()).toBe('Tab 1');
    expect(buttonEls[1].nativeElement.textContent.trim()).toBe('Tab 2');
  });

  it('should initially select first tab and render its child', () => {
    expect((component as any).selectedIndex()).toBe(0);

    expect(MockRenderer.instances.length).toBe(1);
    expect(MockRenderer.instances[0].component.id).toBe('child-1');

    const buttonEls = fixture.debugElement.queryAll(By.css('button'));
    // Checks selected class
    expect(buttonEls[0].nativeElement.className).toContain('tabs-controls-selected');
    expect(buttonEls[1].nativeElement.className).not.toContain('tabs-controls-selected');
  });

  it('should update selected tab on click and render new child', () => {
    const buttonEls = fixture.debugElement.queryAll(By.css('button'));
    buttonEls[1].nativeElement.click();
    fixture.detectChanges();

    expect((component as any).selectedIndex()).toBe(1);

    expect(MockRenderer.instances.length).toBe(1); // Still 1 active at a time
    expect(MockRenderer.instances[0].component.id).toBe('child-2');

    expect(buttonEls[0].nativeElement.className).not.toContain('tabs-controls-selected');
    expect(buttonEls[1].nativeElement.className).toContain('tabs-controls-selected');
  });
});
