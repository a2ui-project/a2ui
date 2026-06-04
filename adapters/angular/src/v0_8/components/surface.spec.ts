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
import {Surface} from './surface';
import {MessageProcessor} from '../data/processor';
import type {AnyComponentNode, Surface as SurfaceType} from '../types';
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

describe('Surface Component', () => {
  let component: Surface;
  let fixture: ComponentFixture<Surface>;
  let mockProcessor: jasmine.SpyObj<MessageProcessor>;
  let surfacesMap: Map<string, SurfaceType>;

  const mockRootComponent: AnyComponentNode = {
    id: 'root-1',
    type: 'Column',
    properties: {},
  };
  const mockSurfaceData: SurfaceType = {
    id: 'surface-1',
    componentTree: mockRootComponent,
  } as any;

  beforeEach(async () => {
    surfacesMap = new Map();
    mockProcessor = jasmine.createSpyObj('MessageProcessor', ['getSurfaces', 'version']);
    mockProcessor.getSurfaces.and.returnValue(surfacesMap);

    await TestBed.configureTestingModule({
      imports: [Surface],
      providers: [{provide: MessageProcessor, useValue: mockProcessor}],
    })
      .overrideComponent(Surface, {
        set: {
          imports: [MockRenderer],
        },
      })
      .compileComponents();

    MockRenderer.instances = []; // Clear tracking

    fixture = TestBed.createComponent(Surface);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');

    // fixture.detectChanges(); // Removed to allow tests to set up state first
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render root component from surfaceInput if provided', () => {
    fixture.componentRef.setInput('surface', mockSurfaceData);
    fixture.detectChanges();

    expect(MockRenderer.instances.length).toBe(1);
    expect(MockRenderer.instances[0].component).toBe(mockRootComponent);
    expect(MockRenderer.instances[0].surfaceId).toBe('surface-1');
  });

  it('should render root component from processor if surfaceInput is null', () => {
    surfacesMap.set('surface-1', mockSurfaceData);
    fixture.componentRef.setInput('surface', null);
    fixture.detectChanges();

    // Trigger computed update if needed, detectChanges should handle it
    expect(MockRenderer.instances.length).toBe(1);
    expect(MockRenderer.instances[0].component).toBe(mockRootComponent);
  });

  it('should NOT render anything if surface or componentTree is missing', () => {
    fixture.componentRef.setInput('surface', null);
    fixture.detectChanges();

    expect(MockRenderer.instances.length).toBe(0);
  });
});
