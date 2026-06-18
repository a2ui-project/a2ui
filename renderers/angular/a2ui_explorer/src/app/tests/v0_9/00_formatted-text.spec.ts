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

import {ComponentFixture} from '@angular/core/testing';
import {DemoComponent} from '../../demo.component';
import {getCanvas, loadExample, wait} from '../utils';

describe('Example: Formatted Text', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Formatted Text');
    textContent = getCanvas().textContent || '';
  });

  it('should render expected text content', async () => {
    expect(textContent).toContain('Type something:');
    expect(textContent).toContain('Formatted output:');
  });

  it('should update result text when typing in the input field', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();

    input.value = 'hello world';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    await wait(10);

    const updatedText = getCanvas().textContent || '';
    expect(updatedText).toContain('You typed: hello world');
  });
});
