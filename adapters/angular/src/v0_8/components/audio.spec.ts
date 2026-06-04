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
import {AudioPlayer} from './audio';
import type {AudioPlayerNode} from '../types';
import {Theme} from '../rendering/theming';
import {MessageProcessor} from '../data/processor';
import {Catalog} from '../rendering/catalog';

describe('AudioPlayer Component', () => {
  let component: AudioPlayer;
  let fixture: ComponentFixture<AudioPlayer>;
  let mockTheme: Theme;
  let mockProcessor: jasmine.SpyObj<MessageProcessor>;

  const mockAudioNode: AudioPlayerNode = {
    id: 'audio-1',
    type: 'AudioPlayer',
    weight: 1,
    properties: {
      url: {literalString: 'https://example.com/audio.mp3'},
    },
  };

  beforeEach(async () => {
    mockProcessor = jasmine.createSpyObj('MessageProcessor', [
      'dispatch',
      'resolvePath',
      'getData',
    ]);
    mockTheme = new Theme();
    mockTheme.additionalStyles = {AudioPlayer: {backgroundColor: 'red'}} as any;

    await TestBed.configureTestingModule({
      imports: [AudioPlayer],
      providers: [
        {provide: MessageProcessor, useValue: mockProcessor},
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: {}},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AudioPlayer);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('component', mockAudioNode);
    fixture.componentRef.setInput('weight', 1);
    fixture.componentRef.setInput('url', mockAudioNode.properties.url);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render audio element with correct src', () => {
    const audioEl = fixture.nativeElement.querySelector('audio');
    expect(audioEl).toBeTruthy();
    expect(audioEl.src).toContain('https://example.com/audio.mp3');
    expect(audioEl.controls).toBeTrue();
  });

  it('should apply additional styles', () => {
    const audioEl = fixture.nativeElement.querySelector('audio');
    expect(audioEl.style.backgroundColor).toBe('red');
  });
});
