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

import {EXAMPLES_V08, EXAMPLES_V09, EXAMPLES_V10} from '../../generated/examples-bundle';
import {Version, getCanvas, loadExample, wait} from '../utils';

describe('Angular Explorer v1.0 Examples & Version Toggle', () => {
  it('should switch between v0.9 and v1.0 via the header version selector', async () => {
    const fixture = await loadExample({name: 'Simple Text', version: Version.V0_9});
    const component = fixture.componentInstance;
    expect(component.version).toBe(Version.V0_9);

    const versionBtns = Array.from(
      fixture.nativeElement.querySelectorAll('.version-btn'),
    ) as HTMLButtonElement[];
    expect(versionBtns.length).toBe(3);

    const v10Btn = versionBtns.find(btn => btn.textContent?.trim() === 'v1.0');
    expect(v10Btn).toBeTruthy();

    v10Btn!.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    expect(component.version).toBe(Version.V1_0);
    expect(v10Btn!.classList.contains('active')).toBeTrue();
    expect(getCanvas().textContent).toContain('Hello, Minimal Catalog!');
  });

  it('should render v1.0 scaffold-simple-text.json', async () => {
    const fixture = await loadExample({name: 'Simple Text', version: '1.0'});
    expect(getCanvas().textContent).toContain('Hello, Minimal Catalog!');
    expect(fixture.componentInstance.messageError).toBeNull();
  });

  it('should render v1.0 email-compose.json', async () => {
    const fixture = await loadExample({name: 'Email Compose', version: '1.0'});
    expect(getCanvas().textContent).toContain('Send');
    expect(fixture.componentInstance.messageError).toBeNull();
  });

  it('should render v1.0 child-list-template.json with template expansion', async () => {
    const fixture = await loadExample({name: 'ChildList Template Expansion', version: '1.0'});
    const text = getCanvas().textContent || '';
    expect(text).toContain('Dynamic Item List');
    expect(text).toContain('Apple');
    expect(text).toContain('Banana');
    expect(text).toContain('Cherry');
    expect(fixture.componentInstance.messageError).toBeNull();
  });

  it('should render v1.0 incremental-dashboard.json cleanly', async () => {
    const fixture = await loadExample({name: 'Incremental Dashboard', version: '1.0'});
    expect(getCanvas()).toBeTruthy();
    expect(fixture.componentInstance.messageError).toBeNull();
  });

  it('should order scaffold examples first and strip the scaffold- prefix from derived names', () => {
    expect(EXAMPLES_V08.slice(0, 6).map(ex => ex.filename)).toEqual([
      'scaffold-simple-text.json',
      'scaffold-row-layout.json',
      'scaffold-interactive-button.json',
      'scaffold-simple-login-form.json',
      'scaffold-complex-layout.json',
      'flight-status.json',
    ]);
    expect(EXAMPLES_V08[0].name).toBe('Simple Text (basic)');

    const expectedScaffoldAndFirst = [
      'scaffold-simple-text.json',
      'scaffold-row-layout.json',
      'scaffold-interactive-button.json',
      'scaffold-simple-login-form.json',
      'scaffold-complex-layout.json',
      'scaffold-formatted-text.json',
      'scaffold-incremental.json',
      'flight-status.json',
    ];
    expect(EXAMPLES_V09.slice(0, 8).map(ex => ex.filename)).toEqual(expectedScaffoldAndFirst);
    expect(EXAMPLES_V10.slice(0, 8).map(ex => ex.filename)).toEqual(expectedScaffoldAndFirst);
  });
});
