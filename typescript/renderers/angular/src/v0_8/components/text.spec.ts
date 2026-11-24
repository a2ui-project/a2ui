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

import {ComponentFixture, TestBed} from '@angular/core/testing';
import {Text} from './text';
import {MessageProcessor} from '../data/processor';
import {Theme} from '../rendering/theming';
import {Catalog} from '../rendering/catalog';
import {MarkdownRenderer} from '../data/markdown';
import {By} from '@angular/platform-browser';

describe('Text Component', () => {
  let component: Text;
  let fixture: ComponentFixture<Text>;
  let mockTheme: Theme;
  let mockMarkdownRenderer: jasmine.SpyObj<MarkdownRenderer>;

  beforeEach(async () => {
    mockTheme = new Theme();
    mockTheme.components = {
      Text: {
        all: {'base-all': true},
        h1: {'style-h1': true},
        h2: {'style-h2': true},
        body: {'style-body': true},
        caption: {'style-caption': true},
      },
    } as any;

    mockMarkdownRenderer = jasmine.createSpyObj('MarkdownRenderer', ['render']);
    mockMarkdownRenderer.render.and.callFake((markdown: string) =>
      Promise.resolve(`<div class="rendered">${markdown}</div>`),
    );

    await TestBed.configureTestingModule({
      imports: [Text],
      providers: [
        {provide: MessageProcessor, useValue: {}},
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: {}},
        {provide: MarkdownRenderer, useValue: mockMarkdownRenderer},
      ],
    })
      // Text component uses ChangeDetectionStrategy.OnPush originally!
      .compileComponents();

    fixture = TestBed.createComponent(Text);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('surfaceId', 'surface-1');
    fixture.componentRef.setInput('component', {id: 'text-1', type: 'Text', weight: 1});
    fixture.componentRef.setInput('weight', 1);
    fixture.componentRef.setInput('text', {literalString: 'Hello World'});
    fixture.componentRef.setInput('usageHint', 'body');

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render content from MarkdownRenderer', async () => {
    fixture.detectChanges(); // Wait for async pipe
    await fixture.whenStable();
    fixture.detectChanges();

    const sectionEl = fixture.debugElement.query(By.css('section'));
    expect(sectionEl).toBeTruthy();
    expect(sectionEl.nativeElement.innerHTML).toContain('class="rendered"');
    expect(sectionEl.nativeElement.textContent).toContain('Hello World');
  });

  it('should format text based on usageHint BEFORE calling MarkdownRenderer', async () => {
    fixture.componentRef.setInput('usageHint', 'h1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockMarkdownRenderer.render).toHaveBeenCalledWith('# Hello World', jasmine.any(Object));

    fixture.componentRef.setInput('usageHint', 'caption');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockMarkdownRenderer.render).toHaveBeenCalledWith('*Hello World*', jasmine.any(Object));
  });

  it('should apply correct classes based on usageHint', () => {
    const sectionEl = fixture.debugElement.query(By.css('section'));
    expect(sectionEl.nativeElement.className).toContain('base-all');
    expect(sectionEl.nativeElement.className).toContain('style-body'); // Initially set in beforeEach

    fixture.componentRef.setInput('usageHint', 'h1');
    fixture.detectChanges();
    expect(sectionEl.nativeElement.className).toContain('style-h1');
    expect(sectionEl.nativeElement.className).not.toContain('style-body');
  });

  describe('additionalStyles.Text', () => {
    function createTextWithStyles(
      textStyles: NonNullable<Theme['additionalStyles']>['Text'],
      usageHint: string | null = 'body',
    ): ComponentFixture<Text> {
      mockTheme.additionalStyles = {Text: textStyles};
      const styledFixture = TestBed.createComponent(Text);
      styledFixture.componentRef.setInput('surfaceId', 'surface-1');
      styledFixture.componentRef.setInput('component', {id: 'text-2', type: 'Text', weight: 1});
      styledFixture.componentRef.setInput('weight', 1);
      styledFixture.componentRef.setInput('text', {literalString: 'Styled'});
      styledFixture.componentRef.setInput('usageHint', usageHint);
      styledFixture.detectChanges();
      return styledFixture;
    }

    it('should apply styles from a 7-key hinted map without h6', () => {
      const styledFixture = createTextWithStyles(
        {
          h1: {color: 'rgb(10, 20, 30)'},
          h2: {},
          h3: {},
          h4: {},
          h5: {},
          body: {color: 'rgb(40, 50, 60)'},
          caption: {},
        },
        'h1',
      );
      const sectionEl = styledFixture.debugElement.query(By.css('section'));
      expect(sectionEl.nativeElement.style.color).toBe('rgb(10, 20, 30)');

      styledFixture.componentRef.setInput('usageHint', null);
      styledFixture.detectChanges();
      expect(sectionEl.nativeElement.style.color).toBe('rgb(40, 50, 60)');
    });

    it('should apply partial hinted styles and fall back to empty styles on unconfigured hints', () => {
      const styledFixture = createTextWithStyles({h1: {color: 'rgb(200, 10, 10)'}}, 'h1');
      const sectionEl = styledFixture.debugElement.query(By.css('section'));
      expect(sectionEl.nativeElement.style.color).toBe('rgb(200, 10, 10)');

      styledFixture.componentRef.setInput('usageHint', 'body');
      styledFixture.detectChanges();
      expect(sectionEl.nativeElement.style.color).toBe('');
    });

    it('should apply flat style maps and ignore empty or malformed mixed maps', () => {
      const flatFixture = createTextWithStyles({color: 'rgb(1, 2, 3)'}, 'h2');
      expect(flatFixture.debugElement.query(By.css('section')).nativeElement.style.color).toBe(
        'rgb(1, 2, 3)',
      );

      const undefHintFlatFixture = createTextWithStyles(
        {color: 'rgb(1, 2, 3)', body: undefined} as unknown as Record<string, string>,
        'h2',
      );
      expect(
        undefHintFlatFixture.debugElement.query(By.css('section')).nativeElement.style.color,
      ).toBe('rgb(1, 2, 3)');

      const mixedFixture = createTextWithStyles(
        {h1: {color: 'rgb(1, 2, 3)'}, body: '16px'} as unknown as Record<string, string>,
        'h1',
      );
      expect(mixedFixture.debugElement.query(By.css('section')).nativeElement.style.color).toBe('');

      const emptyFixture = createTextWithStyles({}, 'body');
      expect(emptyFixture.debugElement.query(By.css('section')).nativeElement.style.color).toBe('');
    });
  });
});
