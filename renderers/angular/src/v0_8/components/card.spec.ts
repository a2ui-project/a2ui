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
import {Card} from './card';
import {MessageProcessor} from '../data/processor';
import {Theme} from '../rendering/theming';
import {Catalog} from '../rendering/catalog';
import type {CardNode} from '../types';
import {Directive, Input} from '@angular/core';

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

describe('Card Component', () => {
  let component: Card;
  let fixture: ComponentFixture<Card>;
  let mockTheme: Theme;

  const mockNode: CardNode = {
    id: 'card-1',
    type: 'Card',
    weight: 1,
    properties: {
      child: {id: 'dummy-1', type: 'Text', properties: {text: 'Empty'}},
      children: [],
    },
  };

  beforeEach(async () => {
    mockTheme = new Theme();
    mockTheme.components = {Card: 'card-class'} as any;

    await TestBed.configureTestingModule({
      imports: [Card],
      providers: [
        {provide: MessageProcessor, useValue: {}},
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: {}},
      ],
    })
      .overrideComponent(Card, {
        set: {
          imports: [MockRenderer],
        },
      })
      .compileComponents();

    MockRenderer.instances = []; // Clear tracking

    fixture = TestBed.createComponent(Card);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('component', mockNode);
    fixture.componentRef.setInput('weight', 1);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should apply theme class', () => {
    const divEl = fixture.nativeElement.querySelector('div');
    expect(divEl.className).toContain('card-class');
  });

  it('should render child if provided', () => {
    const childNode = {id: 'child-1', type: 'Text', properties: {}};
    fixture.componentRef.setInput('child', childNode);
    fixture.detectChanges();

    console.log('--- CARD INNER HTML ---');
    console.log(fixture.nativeElement.innerHTML);
    console.log('--- END CARD INNER HTML ---');

    // Use Static instances tracker instead of debug query!
    expect(MockRenderer.instances.length).toBe(1);
  });

  it('should render children if provided', () => {
    const childrenNodes = [
      {id: 'child-1', type: 'Text', properties: {}},
      {id: 'child-2', type: 'Text', properties: {}},
    ];
    fixture.componentRef.setInput('children', childrenNodes);
    fixture.detectChanges();

    expect(MockRenderer.instances.length).toBe(2);
  });
});
