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
import {Video} from './video';
import type {VideoNode} from '../types';
import {Theme} from '../rendering/theming';
import {MessageProcessor} from '../data/processor';
import {Catalog} from '../rendering/catalog';

describe('Video Component', () => {
  let component: Video;
  let fixture: ComponentFixture<Video>;
  let mockTheme: Theme;
  let mockProcessor: jasmine.SpyObj<MessageProcessor>;

  const mockVideoNode: VideoNode = {
    id: 'video-1',
    type: 'Video',
    weight: 1,
    properties: {
      url: {literalString: 'https://example.com/video.mp4'},
    },
  };

  beforeEach(async () => {
    mockProcessor = jasmine.createSpyObj('MessageProcessor', [
      'dispatch',
      'resolvePath',
      'getData',
    ]);
    mockTheme = new Theme();
    mockTheme.components = {Video: {'vid-class': true}} as any;
    mockTheme.additionalStyles = {Video: {borderColor: 'blue'}} as any;

    await TestBed.configureTestingModule({
      imports: [Video],
      providers: [
        {provide: MessageProcessor, useValue: mockProcessor},
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: {}},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Video);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('component', mockVideoNode);
    fixture.componentRef.setInput('weight', 1);
    fixture.componentRef.setInput('url', mockVideoNode.properties.url);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render video element with correct src when url is provided', () => {
    const videoEl = fixture.nativeElement.querySelector('video');
    expect(videoEl).toBeTruthy();
    expect(videoEl.src).toContain('https://example.com/video.mp4');
    expect(videoEl.controls).toBeTrue();
  });

  it('should apply theme classes and styles to section', () => {
    const sectionEl = fixture.nativeElement.querySelector('section');
    expect(sectionEl).toBeTruthy();
    expect(sectionEl.className).toContain('vid-class');
    expect(sectionEl.style.borderColor).toBe('blue');
  });

  it('should not render anything if url is null', () => {
    fixture.componentRef.setInput('url', null);
    fixture.detectChanges();
    const sectionEl = fixture.nativeElement.querySelector('section');
    expect(sectionEl).toBeNull();
  });
});
