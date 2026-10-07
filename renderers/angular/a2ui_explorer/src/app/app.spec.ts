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

import {TestBed} from '@angular/core/testing';
import {App} from './app';
import {provideMarkdownRenderer} from '@a2ui/angular';

describe('App', () => {
  beforeEach(async () => {
    if (typeof window !== 'undefined') {
      window.location.hash = '';
      try {
        localStorage.clear();
        window.history.replaceState(null, '', window.location.pathname);
      } catch {
        // Ignore in restricted environments
      }
    }
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideMarkdownRenderer()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeInstanceOf(App);

    fixture.detectChanges(); // Trigger ngOnInit

    const compiled = fixture.nativeElement as HTMLElement;
    const canvasFrame = compiled.querySelector('.canvas-frame');
    expect(canvasFrame).toBeInstanceOf(HTMLElement);
  });

  it('should render combined header title, sidebar header, and example info in right panel', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.canvas-header h1')?.textContent).toBe('A2UI Angular Explorer');
    expect(compiled.querySelector('.sidebar-header h3')?.textContent).toContain('Examples');
    expect(compiled.querySelector('.inspect-header h2')?.textContent).toBeTruthy();
  });

  it('should toggle left sidebar collapse and expand', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const leftSidebar = compiled.querySelector('.sidebar') as HTMLElement;
    const collapseBtn = compiled.querySelector('.collapse-left-btn') as HTMLButtonElement;

    expect(leftSidebar.classList.contains('collapsed')).toBeFalse();
    expect(collapseBtn).toBeInstanceOf(HTMLButtonElement);

    collapseBtn.click();
    fixture.detectChanges();

    expect(leftSidebar.classList.contains('collapsed')).toBeTrue();

    const expandBtn = compiled.querySelector('.expand-left-btn') as HTMLButtonElement;
    expect(expandBtn).toBeInstanceOf(HTMLButtonElement);

    expandBtn.click();
    fixture.detectChanges();

    expect(leftSidebar.classList.contains('collapsed')).toBeFalse();
  });

  it('should toggle right inspector sidebar collapse and expand', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const inspectArea = compiled.querySelector('.inspect-area') as HTMLElement;
    const collapseBtn = compiled.querySelector('.collapse-right-btn') as HTMLButtonElement;

    expect(inspectArea.classList.contains('collapsed')).toBeFalse();
    expect(collapseBtn).toBeInstanceOf(HTMLButtonElement);

    collapseBtn.click();
    fixture.detectChanges();

    expect(inspectArea.classList.contains('collapsed')).toBeTrue();

    const expandBtn = compiled.querySelector('.expand-right-btn') as HTMLButtonElement;
    expect(expandBtn).toBeInstanceOf(HTMLButtonElement);

    expandBtn.click();
    fixture.detectChanges();

    expect(inspectArea.classList.contains('collapsed')).toBeFalse();
  });

  it('should navigate to next and previous examples with j and k keys', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const activeBefore = compiled.querySelector('.example-list li.active .ex-name')?.textContent;

    // Press 'j' -> Next example
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'j'}));
    fixture.detectChanges();

    const activeAfterJ = compiled.querySelector('.example-list li.active .ex-name')?.textContent;
    expect(activeAfterJ).not.toEqual(activeBefore);

    // Press 'k' -> Previous example
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'k'}));
    fixture.detectChanges();

    const activeAfterK = compiled.querySelector('.example-list li.active .ex-name')?.textContent;
    expect(activeAfterK).toEqual(activeBefore);
  });

  it('should not navigate with j and k when typing in textarea', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const activeBefore = compiled.querySelector('.example-list li.active .ex-name')?.textContent;
    const textarea = compiled.querySelector('textarea') as HTMLTextAreaElement;

    // Dispatch keydown from textarea
    textarea.focus();
    const event = new KeyboardEvent('keydown', {key: 'j', bubbles: true});
    textarea.dispatchEvent(event);
    fixture.detectChanges();

    const activeAfter = compiled.querySelector('.example-list li.active .ex-name')?.textContent;
    expect(activeAfter).toEqual(activeBefore);
  });

  it('should load v1.0 examples when A2UI_VERSION is provided as Version.V1_0 and switch versions in-place', async () => {
    if (typeof window !== 'undefined') {
      window.location.hash = '';
    }
    const {A2UI_VERSION, Version} = await import('./types');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideMarkdownRenderer(), {provide: A2UI_VERSION, useValue: Version.V1_0}],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const activeBtn = compiled.querySelector('.version-btn.active') as HTMLButtonElement;
    expect(activeBtn?.textContent?.trim()).toBe('v1.0');
    const items = compiled.querySelectorAll('.example-list li');
    expect(items.length).toBeGreaterThan(0);

    const v09Btn = compiled.querySelector('.version-btn[data-version="0.9"]') as HTMLButtonElement;
    v09Btn.click();
    fixture.detectChanges();

    const updatedActiveBtn = compiled.querySelector('.version-btn.active') as HTMLButtonElement;
    expect(updatedActiveBtn?.textContent?.trim()).toBe('v0.9');
  });
});
