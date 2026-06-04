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
import {Component, input} from '@angular/core';
import {By} from '@angular/platform-browser';
import {ModalComponent} from './modal.component';
import {ComponentModel} from '@a2ui/web_core/v0_9';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder} from '../../core/component-binder.service';
import {setComponentProps, createBoundProperty, ComponentToProps} from '../../core/test-utils';

@Component({
  selector: 'dummy-text-for-modal',
  template: '<div>{{text}}</div>',
  standalone: true,
})
class DummyTextComponent {
  text?: string;
  props = input<Record<string, unknown>>();
  surfaceId = input<string>();
  componentId = input<string>();
  dataContextPath = input<string>();
}

describe('ModalComponent', () => {
  let component: ModalComponent;
  let fixture: ComponentFixture<ModalComponent>;
  let defaultProps: ComponentToProps<ModalComponent>;

  beforeEach(async () => {
    const mockRendererService = {
      surfaceGroup: {
        getSurface: jasmine.createSpy('getSurface').and.returnValue({
          componentsModel: new Map([
            ['trigger-btn', new ComponentModel('trigger-btn', 'Text', {text: {value: 'Open'}})],
            [
              'modal-content',
              new ComponentModel('modal-content', 'Text', {text: {value: 'Modal'}}),
            ],
          ]),
          catalog: {
            id: 'mock-catalog',
            components: new Map([['Text', {type: 'Text', component: DummyTextComponent}]]),
          },
        }),
      },
    };
    const mockBinder = jasmine.createSpyObj('ComponentBinder', ['bind']);

    await TestBed.configureTestingModule({
      imports: [ModalComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('dataContextPath', '/');

    defaultProps = {} as ComponentToProps<ModalComponent>;
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render trigger and open modal on click', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      trigger: createBoundProperty({id: 'trigger-btn', basePath: '/'}),
      content: createBoundProperty({id: 'modal-content', basePath: '/'}),
    });
    fixture.detectChanges();
    const triggerHost = fixture.debugElement.query(
      By.css('.a2ui-modal-trigger a2ui-v09-component-host'),
    );
    expect(triggerHost.componentInstance.componentKey()).toEqual({
      id: 'trigger-btn',
      basePath: '/',
    });

    expect(fixture.nativeElement.querySelector('.a2ui-modal-overlay')).toBeFalsy();

    fixture.nativeElement.querySelector('.a2ui-modal-trigger').click();
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('.a2ui-modal-overlay');
    expect(overlay).toBeTruthy();
    const contentHost = fixture.debugElement.query(
      By.css('.a2ui-modal-overlay a2ui-v09-component-host'),
    );
    expect(contentHost.componentInstance.componentKey()).toEqual({
      id: 'modal-content',
      basePath: '/',
    });
  });

  it('should close modal when close button clicked', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      trigger: createBoundProperty({id: 'trigger-btn', basePath: '/'}),
      content: createBoundProperty({id: 'modal-content', basePath: '/'}),
    });
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.a2ui-modal-trigger').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.a2ui-modal-overlay')).toBeTruthy();

    fixture.nativeElement.querySelector('.a2ui-modal-close').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.a2ui-modal-overlay')).toBeFalsy();
  });

  it('should close modal when overlay clicked', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      trigger: createBoundProperty({id: 'trigger-btn', basePath: '/'}),
      content: createBoundProperty({id: 'modal-content', basePath: '/'}),
    });
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.a2ui-modal-trigger').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.a2ui-modal-overlay')).toBeTruthy();

    fixture.nativeElement.querySelector('.a2ui-modal-overlay').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.a2ui-modal-overlay')).toBeFalsy();
  });

  it('should handle missing trigger or content', () => {
    fixture.detectChanges();
    expect(component.trigger()).toBeUndefined();
    expect(component.content()).toBeUndefined();
    expect(fixture.nativeElement.querySelector('a2ui-v09-component-host')).toBeFalsy();
  });
});
