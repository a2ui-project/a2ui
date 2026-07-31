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
import {Renderer} from './renderer';
import {Catalog} from './catalog';
import {Component, Input} from '@angular/core';

@Component({
  selector: 'test-comp',
  template: '<div>{{ text }}</div>',
  standalone: true,
})
class TestComp {
  @Input() surfaceId?: string;
  @Input() component?: any;
  @Input() weight?: number;
  @Input() text?: string;
}

@Component({
  template: `<ng-container
    a2ui-renderer
    [surfaceId]="surfaceId"
    [component]="component"
  ></ng-container>`,
  standalone: true,
  imports: [Renderer],
})
class TestHost {
  surfaceId = '';
  component: any = null;
}

describe('v0.8 Renderer', () => {
  let fixture: ComponentFixture<TestHost>;
  let mockCatalog: any;

  beforeEach(async () => {
    mockCatalog = {
      TestComp: {type: () => TestComp},
    };

    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [{provide: Catalog, useValue: mockCatalog}],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
  });

  it('should render component from catalog', async () => {
    fixture.componentInstance.surfaceId = 'surf-1';
    fixture.componentInstance.component = {
      type: 'TestComp',
      properties: {text: 'Hello v0.8'},
      weight: 10,
    };

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    expect(compiled.textContent).toContain('Hello v0.8');
  });

  it('should handle async component resolution', async () => {
    mockCatalog['TestComp'] = () => Promise.resolve(TestComp);

    fixture.componentInstance.surfaceId = 'surf-1';
    fixture.componentInstance.component = {
      type: 'TestComp',
      properties: {text: 'Async Hello'},
    };

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    expect(compiled.textContent).toContain('Async Hello');
  });

  it('should error if component type not found', () => {
    const consoleSpy = spyOn(console, 'error');
    fixture.componentInstance.surfaceId = 'surf-1';
    fixture.componentInstance.component = {
      type: 'UnknownComp',
      properties: {},
    };

    fixture.detectChanges();
    expect(consoleSpy).toHaveBeenCalledWith('Unknown component type: UnknownComp');
  });

  it('should handle direct function config in catalog', async () => {
    mockCatalog['TestComp'] = () => TestComp;

    fixture.componentInstance.surfaceId = 'surf-1';
    fixture.componentInstance.component = {
      type: 'TestComp',
      properties: {text: 'Function Hello'},
    };

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    expect(compiled.textContent).toContain('Function Hello');
  });

  it('should inject structural styles into the document head', () => {
    // Check if a style tag with structuralStyles content exists in the head
    const styleTags = document.getElementsByTagName('style');
    let found = false;
    for (let i = 0; i < styleTags.length; i++) {
      // Check for a representative class from structuralStyles
      if (styleTags[i].textContent?.includes('.layout-p-')) {
        found = true;
        break;
      }
    }
    expect(found).toBeTrue();
  });
});

@Component({
  selector: 'comp-with-inputs',
  template: '',
  standalone: true,
})
class CompWithInputs {
  @Input() surfaceId?: string;
  @Input() component?: any;
  @Input() weight?: number;
  @Input() text?: string;
  // Note: No 'children' or 'child' inputs here.
}

describe('v0.8 Renderer Regression Tests', () => {
  let fixture: ComponentFixture<TestHost>;
  let mockCatalog: any;

  beforeEach(async () => {
    mockCatalog = {
      CompWithInputs: {type: () => CompWithInputs},
    };

    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [{provide: Catalog, useValue: mockCatalog}],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
  });

  it('should gracefully handle missing inputs and log a warning', async () => {
    // This test ensures that when a property is present in the node but NOT declared
    // as an input on the component, the Renderer logs a warning rather than throwing NG0303.
    fixture.componentInstance.surfaceId = 'surf-1';
    fixture.componentInstance.component = {
      type: 'CompWithInputs',
      properties: {
        text: 'Hello',
        nonExistentInput: 'should-warn',
      },
    };

    const warnSpy = spyOn(console, 'warn');

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(warnSpy).toHaveBeenCalledWith(
      jasmine.stringMatching(
        /Property "nonExistentInput" could not be set on component CompWithInputs/,
      ),
    );
  });

  it('should pass children and child properties as inputs if supported', async () => {
    const setCapture: any = {};
    @Component({
      selector: 'comp-with-children',
      template: '',
      standalone: true,
    })
    class CompWithChildren {
      @Input() surfaceId?: string;
      @Input() component?: any;
      @Input() weight?: number;
      @Input() set children(v: any) {
        setCapture.children = v;
      }
      @Input() set child(v: any) {
        setCapture.child = v;
      }
    }

    mockCatalog['CompWithChildren'] = {type: () => CompWithChildren};

    fixture.componentInstance.surfaceId = 'surf-1';
    fixture.componentInstance.component = {
      type: 'CompWithChildren',
      properties: {
        children: [{id: 'child-1'}],
        child: {id: 'child-2'},
      },
    };

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(setCapture.children).toEqual([{id: 'child-1'}]);
    expect(setCapture.child).toEqual({id: 'child-2'});
  });

  it('should gracefully handle components with missing properties', async () => {
    // This covers the fix where node.properties might be undefined.
    fixture.componentInstance.surfaceId = 'surf-1';
    fixture.componentInstance.component = {
      type: 'CompWithInputs',
      // Notice: No 'properties' key here.
    };

    expect(() => {
      fixture.detectChanges();
    }).not.toThrow();
  });
});
