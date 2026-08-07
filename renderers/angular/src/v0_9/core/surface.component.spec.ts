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
import {SurfaceComponent} from './surface.component';
import {provideA2Ui} from './a2ui-renderer.service';
import {
  ComponentContext,
  MessageProcessor,
  SurfaceModel,
  WebComponentImplementation,
} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {AngularCatalog} from '../catalog/types';

describe('SurfaceComponent', () => {
  let component: SurfaceComponent;
  let fixture: ComponentFixture<SurfaceComponent>;
  let processor: MessageProcessor<WebComponentImplementation>;
  let surface: SurfaceModel<WebComponentImplementation>;

  beforeEach(async () => {
    processor = new MessageProcessor<WebComponentImplementation>([basicCatalog]);
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: 'Hello from test',
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;

    await TestBed.configureTestingModule({
      imports: [SurfaceComponent],
      providers: [provideA2Ui({catalogs: [new AngularCatalog()]})],
    }).compileComponents();

    fixture = TestBed.createComponent(SurfaceComponent);
    component = fixture.componentInstance;
  });

  it('should create and mount root custom element when surface is provided', async () => {
    fixture.componentRef.setInput('surface', surface);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component).toBeTruthy();
    const rootEl = fixture.nativeElement.querySelector('a2ui-basic-text') as HTMLElement & {
      context?: ComponentContext;
    };
    expect(rootEl).toBeTruthy();
    expect(rootEl!.context).toBeDefined();
    expect(rootEl!.context!.componentModel.id).toBe('root');
  });

  it('should clear element on destroy', async () => {
    fixture.componentRef.setInput('surface', surface);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('a2ui-basic-text')).toBeTruthy();

    fixture.destroy();
    expect(fixture.nativeElement.innerHTML).toBe('');
  });
});
