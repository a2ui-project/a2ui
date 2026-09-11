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

import {TestBed, ComponentFixture} from '@angular/core/testing';
import {CustomGridComponent} from './custom-grid.component';
import {signal} from '@angular/core';

describe('CustomGridComponent', () => {
  let fixture: ComponentFixture<CustomGridComponent>;
  let component: CustomGridComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomGridComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomGridComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should render title and description when provided', () => {
    fixture.componentRef.setInput('props', {
      title: {value: signal('My 4x4 Grid'), onUpdate: () => {}, raw: 'My 4x4 Grid'},
      description: {
        value: signal('Sample container layout'),
        onUpdate: () => {},
        raw: 'Sample container layout',
      },
      children: {value: signal([]), onUpdate: () => {}, raw: []},
    });
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('componentId', 'grid-1');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.grid-title')?.textContent).toContain('My 4x4 Grid');
    expect(compiled.querySelector('.grid-description')?.textContent).toContain(
      'Sample container layout',
    );
  });

  it('should render 4 grid slots and display empty placeholders when no children provided', () => {
    fixture.componentRef.setInput('props', {
      children: {value: signal([]), onUpdate: () => {}, raw: []},
    });
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('componentId', 'grid-1');
    fixture.detectChanges();

    const cells = fixture.nativeElement.querySelectorAll('.grid-cell');
    expect(cells.length).toBe(4);

    const emptyPlaceholders = fixture.nativeElement.querySelectorAll('.empty-placeholder');
    expect(emptyPlaceholders.length).toBe(4);
  });
});
