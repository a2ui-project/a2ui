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

/**
 * The directives an Angular catalog component uses to mark elements for its
 * host's accessibility attributes (see `bindHostAccessibility` in
 * `@a2ui/web_core/v0_9/universal`). Each host element, `ComponentHostComponent`
 * or `AngularWcHost`, provides its own `A2UI_ACCESSIBILITY_TARGETS`, so a
 * directive marks an element for the nearest host above it.
 */

import {
  DestroyRef,
  Directive,
  ElementRef,
  InjectionToken,
  type Provider,
  inject,
} from '@angular/core';
import {peekValue, setValue, type Signal} from '@a2ui/web_core/v0_9';
import {type AccessibilityTargets, createAccessibilityTargets} from '@a2ui/web_core/v0_9/universal';

/** The accessibility targets of the host element the current component renders in. */
export const A2UI_ACCESSIBILITY_TARGETS = new InjectionToken<AccessibilityTargets>(
  'A2UI_ACCESSIBILITY_TARGETS',
);

/** Provides a host element's own accessibility targets. */
export function provideAccessibilityTargets(): Provider {
  return {provide: A2UI_ACCESSIBILITY_TARGETS, useFactory: createAccessibilityTargets};
}

/** Puts the directive's element in one of its host's target slots while it exists. */
function markElement(slotOf: (targets: AccessibilityTargets) => Signal<Element | null>): void {
  const targets = inject(A2UI_ACCESSIBILITY_TARGETS, {optional: true});
  if (!targets) return;
  const slot = slotOf(targets);
  const element = inject<ElementRef<Element>>(ElementRef).nativeElement;
  setValue(slot, element);
  inject(DestroyRef).onDestroy(() => {
    if (peekValue(slot) === element) {
      setValue(slot, null);
    }
  });
}

/**
 * Marks the element that carries the component's `accessibility.label`,
 * `accessibility.description` and validation state, such as its input
 * (`<input a2uiAccessibilityTarget>`). It gets `aria-invalid` while a check
 * fails. Without it, the component's host element is labelled as a
 * `role="group"` and no element gets the validation state.
 */
@Directive({selector: '[a2uiAccessibilityTarget]'})
export class AccessibilityTargetDirective {
  constructor() {
    markElement(targets => targets.target);
  }
}

/**
 * Marks the element that shows the component's validation errors. While there
 * are errors, the `a2uiAccessibilityTarget` element gets `aria-describedby`
 * pointing at it, and it gets an `id` if it has none.
 */
@Directive({selector: '[a2uiValidationErrors]'})
export class ValidationErrorsDirective {
  constructor() {
    markElement(targets => targets.errors);
  }
}
