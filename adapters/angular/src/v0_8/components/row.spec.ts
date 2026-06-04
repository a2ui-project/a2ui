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
import {Row} from './row';
import {MessageProcessor} from '../data/processor';
import {Theme} from '../rendering/theming';
import {Catalog} from '../rendering/catalog';
import type {RowNode} from '../types';
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

describe('Row Component', () => {
  let component: Row;
  let fixture: ComponentFixture<Row>;
  let mockTheme: Theme;

  const mockNode: RowNode = {
    id: 'row-1',
    type: 'Row',
    weight: 1,
    properties: {
      children: [{id: 'child-1', type: 'Text', properties: {}}],
    },
  };

  beforeEach(async () => {
    mockTheme = new Theme();
    mockTheme.components = {Row: {'custom-row': true}} as any;

    await TestBed.configureTestingModule({
      imports: [Row],
      providers: [
        {provide: MessageProcessor, useValue: {}},
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: {}},
      ],
    })
      .overrideComponent(Row, {
        set: {
          imports: [MockRenderer],
        },
      })
      .compileComponents();

    MockRenderer.instances = []; // Clear tracking

    fixture = TestBed.createComponent(Row);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('component', mockNode);
    fixture.componentRef.setInput('weight', 1);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should apply alignment and distribution classes', () => {
    const sectionEl = fixture.nativeElement.querySelector('section');
    expect(sectionEl.className).toContain('align-stretch'); // Default
    expect(sectionEl.className).toContain('distribute-start'); // Default

    fixture.componentRef.setInput('alignment', 'center');
    fixture.componentRef.setInput('distribution', 'end');
    fixture.detectChanges();

    expect(sectionEl.className).toContain('align-center');
    expect(sectionEl.className).toContain('distribute-end');
  });

  it('should render child components', () => {
    expect(MockRenderer.instances.length).toBe(1);
  });
});
