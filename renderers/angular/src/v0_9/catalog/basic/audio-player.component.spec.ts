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
import {AudioPlayerComponent} from './audio-player.component';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentBinder} from '../../core/component-binder.service';
import {setComponentProps, createBoundProperty, ComponentToProps} from '@a2ui/angular/testing';

describe('AudioPlayerComponent', () => {
  let component: AudioPlayerComponent;
  let fixture: ComponentFixture<AudioPlayerComponent>;
  let defaultProps: ComponentToProps<AudioPlayerComponent>;

  beforeEach(async () => {
    const mockRendererService = {
      surfaceGroup: {
        getSurface: jasmine.createSpy('getSurface').and.returnValue({
          componentsModel: new Map(),
          catalog: {
            id: 'mock-catalog',
            components: new Map(),
          },
        }),
      },
    };
    const mockBinder = jasmine.createSpyObj('ComponentBinder', ['bind']);

    await TestBed.configureTestingModule({
      imports: [AudioPlayerComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ComponentBinder, useValue: mockBinder},
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(AudioPlayerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('dataContextPath', '/');

    defaultProps = {
      url: createBoundProperty('https://example.com/audio.mp3'),
      description: createBoundProperty('Test Audio'),
    };
    setComponentProps(fixture, defaultProps);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render audio with url', () => {
    fixture.detectChanges();
    const audio = fixture.nativeElement.querySelector('audio') as HTMLAudioElement;
    expect(audio.src).toBeTruthy();
    const desc = fixture.nativeElement.querySelector('.a2ui-audio-description');
    expect(desc?.textContent?.trim()).toBe('Test Audio');
  });

  it('should not render description if not provided', () => {
    setComponentProps(fixture, {
      ...defaultProps,
      description: createBoundProperty(undefined),
    });
    fixture.detectChanges();
    const desc = fixture.nativeElement.querySelector('.a2ui-audio-description');
    expect(desc).toBeFalsy();
  });

  it('should handle missing props', () => {
    setComponentProps(fixture, {} as ComponentToProps<AudioPlayerComponent>);
    fixture.detectChanges();
    const audio = fixture.nativeElement.querySelector('audio') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBeFalsy();
  });
});
