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
import {List} from './list';
import {MessageProcessor} from '../data/processor';
import {Theme} from '../rendering/theming';
import {Catalog} from '../rendering/catalog';
import type {ListNode} from '../types';
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

describe('List Component', () => {
  let component: List;
  let fixture: ComponentFixture<List>;
  let mockTheme: Theme;

  const mockNode: ListNode = {
    id: 'list-1',
    type: 'List',
    weight: 1,
    properties: {
      children: [{id: 'child-1', type: 'Text', properties: {}}],
    },
  };

  beforeEach(async () => {
    mockTheme = new Theme();
    mockTheme.components = {List: 'list-class'} as any;

    await TestBed.configureTestingModule({
      imports: [List],
      providers: [
        {provide: MessageProcessor, useValue: {}},
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: {}},
      ],
    })
      .overrideComponent(List, {
        set: {
          imports: [MockRenderer],
        },
      })
      .compileComponents();

    MockRenderer.instances = []; // Clear tracking

    fixture = TestBed.createComponent(List);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('component', mockNode);
    fixture.componentRef.setInput('weight', 1);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should apply direction attribute', () => {
    expect(fixture.nativeElement.getAttribute('direction')).toBe('vertical'); // Default

    fixture.componentRef.setInput('direction', 'horizontal');
    fixture.detectChanges();

    expect(fixture.nativeElement.getAttribute('direction')).toBe('horizontal');
  });

  it('should render child components wrapped in list-item', () => {
    expect(MockRenderer.instances.length).toBe(1);

    const itemEl = fixture.debugElement.query(By.css('.a2ui-list-item'));
    expect(itemEl).toBeTruthy();
  });
});
