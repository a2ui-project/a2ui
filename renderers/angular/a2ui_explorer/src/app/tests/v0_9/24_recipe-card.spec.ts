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

describe('Example: Recipe Card', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Recipe Card');
    textContent = getCanvas().textContent;
  });

  it('should render tab titles', async () => {
    expect(textContent).toContain('Overview');
    expect(textContent).toContain('Ingredients');
    expect(textContent).toContain('Instructions');
  });

  it('should render Overview content', async () => {
    expect(textContent).toContain('Mediterranean Quinoa Bowl');
    expect(textContent).toContain('4.9');
    expect(textContent).toContain('15 min prep');
    expect(textContent).toContain('20 min cook');
    expect(textContent).toContain('Serves 4');
  });

  it('should render icon', async () => {
    expect(fixture.nativeElement.querySelector('.a2ui-icon')).toBeTruthy();
  });

  it('should switch to Ingredients tab', async () => {
    const tabs = [...fixture.nativeElement.querySelectorAll('.a2ui-tab-button')] as HTMLElement[];
    const tab = tabs.find(t => t.textContent.includes('Ingredients'))!;
    expect(tab).withContext('Should find Ingredients tab').toBeTruthy();

    tab.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    const ingredientsText = getCanvas().textContent;
    expect(ingredientsText).toContain('1 cup quinoa');
    expect(ingredientsText).toContain('1 cucumber, diced');
  });

  it('should switch to Instructions tab', async () => {
    const tabs = [...fixture.nativeElement.querySelectorAll('.a2ui-tab-button')] as HTMLElement[];
    const tab = tabs.find(t => t.textContent.includes('Instructions'))!;
    expect(tab).withContext('Should find Instructions tab').toBeTruthy();

    tab.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    const instructionsText = getCanvas().textContent;
    expect(instructionsText).toContain('Rinse quinoa and bring to a boil in water.');
    expect(instructionsText).toContain('Mix with diced vegetables.');
  });
});
