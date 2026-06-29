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
import {Modal} from './modal';
import {MessageProcessor} from '../data/processor';
import {Theme} from '../rendering/theming';
import {Catalog} from '../rendering/catalog';
import type {AnyComponentNode} from '../types';
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

describe('Modal Component', () => {
  let component: Modal;
  let fixture: ComponentFixture<Modal>;
  let mockTheme: Theme;

  const mockEntryPoint: AnyComponentNode = {
    id: 'btn-1',
    type: 'Button',
    properties: {text: 'Open'},
  };
  const mockContent: AnyComponentNode = {
    id: 'text-1',
    type: 'Text',
    properties: {text: 'Hello'},
  };

  beforeEach(async () => {
    mockTheme = new Theme();
    mockTheme.components = {
      Modal: {
        backdrop: 'backdrop-class',
        element: 'modal-element-class',
      },
    } as any;

    await TestBed.configureTestingModule({
      imports: [Modal],
      providers: [
        {provide: MessageProcessor, useValue: {}},
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: {}},
      ],
    })
      .overrideComponent(Modal, {
        set: {
          imports: [MockRenderer],
        },
      })
      .compileComponents();

    MockRenderer.instances = []; // Clear tracking

    fixture = TestBed.createComponent(Modal);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('entryPointChild', mockEntryPoint);
    fixture.componentRef.setInput('contentChild', mockContent);
    fixture.componentRef.setInput('component', {id: 'modal-1', type: 'Modal', weight: 1});
    fixture.componentRef.setInput('weight', 1);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render entry point child initially', () => {
    // Should render 1 MockRenderer for the entry point
    expect(MockRenderer.instances.length).toBe(1);
  });

  it('should not render the overlay when closed', () => {
    const overlayEl = fixture.debugElement.query(By.css('.a2ui-modal-overlay'));
    expect(overlayEl).toBeFalsy();
  });
  it('should not render the backdrop when closed', () => {
    const backdropEl = fixture.debugElement.query(By.css('.backdrop-class'));
    expect(backdropEl).toBeFalsy();
  });

  it('should open modal on entry point click', () => {
    // Trigger click on entry point container or MockRenderer
    // Since MockRenderer is on ng-container, we click the wrapper div
    const entryPointDiv = fixture.debugElement.query(By.css('.a2ui-modal-entry-point'));
    entryPointDiv.nativeElement.click();
    fixture.detectChanges();

    // Now isOpen should be true
    expect((component as any).isOpen()).toBeTrue();

    // Backdrop should exist
    const backdropEl = fixture.debugElement.query(By.css('.backdrop-class'));
    expect(backdropEl).toBeTruthy();

    // Content should be rendered (total 2 MockRenderers now)
    expect(MockRenderer.instances.length).toBe(2);
  });

  it('should close modal on backdrop click', () => {
    component.openModal();
    fixture.detectChanges();

    const backdropEl = fixture.debugElement.query(By.css('.backdrop-class'));
    expect(backdropEl).toBeTruthy();

    // Click backdrop
    backdropEl.nativeElement.click();
    fixture.detectChanges();

    // isOpen should be false
    expect((component as any).isOpen()).toBeFalse();
  });

  it('should NOT close modal on element click', () => {
    component.openModal();
    fixture.detectChanges();

    const elementEl = fixture.debugElement.query(By.css('.modal-element-class'));
    expect(elementEl).toBeTruthy();

    // Click element
    elementEl.nativeElement.click();
    fixture.detectChanges();

    // isOpen should STILL be true
    expect((component as any).isOpen()).toBeTrue();
  });

  it('should use position fixed for overlay', () => {
    component.openModal();
    fixture.detectChanges();

    const overlayEl = fixture.debugElement.query(By.css('.a2ui-modal-overlay'));
    expect(overlayEl).toBeTruthy();

    const style = window.getComputedStyle(overlayEl.nativeElement);
    expect(style.position).toBe('fixed');
  });
});
