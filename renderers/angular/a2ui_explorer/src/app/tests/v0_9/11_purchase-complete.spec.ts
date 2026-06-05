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

describe('Example: Purchase Complete', () => {
  let fixture: ComponentFixture<DemoComponent>;
  let component: DemoComponent;
  let textContent: string;

  beforeEach(async () => {
    fixture = await loadExample('Purchase Complete');
    component = fixture.componentInstance;
    textContent = getCanvas().textContent;
  });

  it('should render text content', async () => {
    expect(textContent).toContain('Purchase Complete');
    expect(textContent).toContain('Wireless Headphones Pro');
    expect(textContent).toContain('Arrives Dec 18 - Dec 20');
    expect(textContent).toContain('Sold by:');
    expect(textContent).toContain('TechStore Official');
    expect(textContent).toContain('View Order Details');

    // Check for formatted currency
    expect(textContent).toContain('199.99');
  });

  it('should render image', async () => {
    const img = fixture.nativeElement.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=100&h=100&fit=crop',
    );
  });

  it('should render icons', async () => {
    expect(textContent).toContain('check');
    expect(textContent).toContain('arrow_forward');
  });

  it('should handle button click', async () => {
    const button = fixture.nativeElement.querySelector('.a2ui-button');
    expect(button).withContext('Should find View Order Details button').toBeTruthy();

    button.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.eventsLog.length).toBe(1);
    expect(component.eventsLog[0].action.name).toBe('view_details');
  });
});
