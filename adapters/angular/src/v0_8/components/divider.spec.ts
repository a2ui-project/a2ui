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
import {Divider} from './divider';
import {Theme} from '../rendering/theming';
import {MessageProcessor} from '../data/processor';
import type {DividerNode} from '../types';

describe('Divider Component', () => {
  let component: Divider;
  let fixture: ComponentFixture<Divider>;
  let mockTheme: Theme;

  const mockNode: DividerNode = {
    id: 'div-1',
    type: 'Divider',
    weight: 1,
    properties: {},
  };

  beforeEach(async () => {
    mockTheme = new Theme();
    mockTheme.components = {Divider: 'divider-class'} as any;

    await TestBed.configureTestingModule({
      imports: [Divider],
      providers: [
        {provide: Theme, useValue: mockTheme},
        {provide: MessageProcessor, useValue: {}},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Divider);
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
    const hrEl = fixture.nativeElement.querySelector('hr');
    expect(hrEl.className).toContain('divider-class');
  });
});
