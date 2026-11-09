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
 * The `accessibility` attributes of components implemented in React. Their
 * `a2ui-react-<name>` host sets `aria-live` and `aria-hidden` on itself, and
 * puts `label` and `description` on the element passed to `accessibilityRef`,
 * or on itself as a `role="group"` when the component passes none.
 */

import {describe, it, expect} from 'vitest';
import {act, render, waitFor} from '@testing-library/react';
import {z} from 'zod';
import {Catalog, CommonSchemas, ComponentModel, SurfaceModel} from '@a2ui/web_core/v0_9';
import {basicCatalog as webCoreBasicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  A2uiSurface,
  createBinderlessComponentImplementation,
  createComponentImplementation,
  type ReactCatalogComponent,
} from '../../src';

/** Passes no `accessibilityRef`, so its host is labelled. */
const Card = createComponentImplementation(
  {name: 'Card', schema: z.object({title: CommonSchemas.DynamicString.optional()})},
  ({props}) => <div data-testid="card">{String(props.title ?? '')}</div>,
);

/** Labels its input, and drops the input when `showInput` is `false`. */
const Field = createComponentImplementation(
  {name: 'Field', schema: z.object({showInput: z.boolean().optional()})},
  ({props, accessibilityRef}) => (
    <div data-testid="field">
      {props.showInput === false ? null : <input data-testid="input" ref={accessibilityRef} />}
    </div>
  ),
);

/** A binderless component that labels its button. */
const RawButton = createBinderlessComponentImplementation(
  {name: 'RawButton', schema: z.object({})},
  ({accessibilityRef}) => (
    <button data-testid="button" ref={accessibilityRef}>
      Go
    </button>
  ),
);

/** An input that shows its validation errors below it. */
const CheckedField = createComponentImplementation(
  {
    name: 'CheckedField',
    schema: z.object({
      value: CommonSchemas.DynamicString.optional(),
      checks: CommonSchemas.Checkable.shape.checks,
    }),
  },
  ({props, accessibilityRef, validationErrorsRef}) => (
    <div>
      <input data-testid="input" ref={accessibilityRef} />
      {props.validationErrors?.length ? (
        <div data-testid="errors" ref={validationErrorsRef}>
          {props.validationErrors.join(' ')}
        </div>
      ) : null}
    </div>
  ),
);

const Column = webCoreBasicCatalog.components.get('Column')!;

const catalog = new Catalog<ReactCatalogComponent>('a11y', '0.9', [
  Card,
  Field,
  CheckedField,
  RawButton,
  Column,
]);

function surfaceWith(id: string, ...components: ComponentModel[]) {
  const surface = new SurfaceModel<ReactCatalogComponent>(id, catalog);
  for (const component of components) {
    surface.componentsModel.addComponent(component);
  }
  return surface;
}

function host(container: HTMLElement, tagName: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(tagName);
  if (!element) {
    throw new Error(`no ${tagName}`);
  }
  return element;
}

describe('React host accessibility', () => {
  it('labels the host as a group when the component passes no accessibilityRef', () => {
    const surface = surfaceWith(
      'group',
      new ComponentModel(
        'root',
        'Card',
        {
          title: 'Deal',
          accessibility: {label: 'Featured Deal', description: 'Ends today', live: 'polite'},
        },
        catalog,
      ),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    const card = host(container, 'a2ui-react-card');
    expect(card.getAttribute('role')).toBe('group');
    expect(card.getAttribute('aria-label')).toBe('Featured Deal');
    expect(card.getAttribute('aria-description')).toBe('Ends today');
    expect(card.getAttribute('aria-live')).toBe('polite');
  });

  it('labels a host under a Lit parent', async () => {
    const surface = surfaceWith(
      'under-lit',
      new ComponentModel('root', 'Column', {children: ['card']}, catalog),
      new ComponentModel('card', 'Card', {accessibility: {label: 'Featured Deal'}}, catalog),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      const card = host(container, 'a2ui-basic-column a2ui-react-card');
      expect(card.getAttribute('role')).toBe('group');
      expect(card.getAttribute('aria-label')).toBe('Featured Deal');
    });
  });

  it('hides a host and makes it inert', () => {
    const surface = surfaceWith(
      'hidden',
      new ComponentModel('root', 'Card', {accessibility: {hidden: true}}, catalog),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    const card = host(container, 'a2ui-react-card');
    expect(card.getAttribute('aria-hidden')).toBe('true');
    expect(card.inert).toBe(true);
    expect(card.hasAttribute('role')).toBe(false);
  });

  it('sets no attributes for a component without accessibility', () => {
    const surface = surfaceWith('none', new ComponentModel('root', 'Card', {}, catalog));

    const {container} = render(<A2uiSurface surface={surface} />);

    const card = host(container, 'a2ui-react-card');
    for (const name of ['role', 'aria-label', 'aria-description', 'aria-live', 'aria-hidden']) {
      expect(card.hasAttribute(name)).toBe(false);
    }
  });

  it('puts the label and description on the accessibilityRef element', () => {
    const surface = surfaceWith(
      'target',
      new ComponentModel(
        'root',
        'Field',
        {accessibility: {label: 'Email', description: 'Work address', live: 'polite'}},
        catalog,
      ),
    );

    const {container, getByTestId} = render(<A2uiSurface surface={surface} />);

    const input = getByTestId('input');
    expect(input.getAttribute('aria-label')).toBe('Email');
    expect(input.getAttribute('aria-description')).toBe('Work address');
    const field = host(container, 'a2ui-react-field');
    expect(field.hasAttribute('role')).toBe(false);
    expect(field.hasAttribute('aria-label')).toBe(false);
    expect(field.hasAttribute('aria-description')).toBe(false);
    expect(field.getAttribute('aria-live')).toBe('polite');
  });

  it('puts the label on the accessibilityRef element of a binderless component', () => {
    const surface = surfaceWith(
      'binderless',
      new ComponentModel('root', 'RawButton', {accessibility: {label: 'Submit form'}}, catalog),
    );

    const {container, getByTestId} = render(<A2uiSurface surface={surface} />);

    expect(getByTestId('button').getAttribute('aria-label')).toBe('Submit form');
    expect(host(container, 'a2ui-react-rawbutton').hasAttribute('aria-label')).toBe(false);
  });

  it('moves the label to the host when the accessibilityRef element unmounts', () => {
    const surface = surfaceWith(
      'unmount-target',
      new ComponentModel('root', 'Field', {accessibility: {label: 'Email'}}, catalog),
    );
    const {container, queryByTestId} = render(<A2uiSurface surface={surface} />);
    const input = queryByTestId('input')!;

    act(() => {
      surface.componentsModel.get('root')!.properties = {
        showInput: false,
        accessibility: {label: 'Email'},
      };
    });

    expect(queryByTestId('input')).toBeNull();
    expect(input.hasAttribute('aria-label')).toBe(false);
    const field = host(container, 'a2ui-react-field');
    expect(field.getAttribute('role')).toBe('group');
    expect(field.getAttribute('aria-label')).toBe('Email');
  });

  it('follows a label bound to the data model', () => {
    const surface = surfaceWith(
      'bound',
      new ComponentModel('root', 'Card', {accessibility: {label: {path: '/label'}}}, catalog),
    );
    surface.dataModel.set('/label', 'Before');
    const {container} = render(<A2uiSurface surface={surface} />);
    const card = host(container, 'a2ui-react-card');
    expect(card.getAttribute('aria-label')).toBe('Before');

    act(() => {
      surface.dataModel.set('/label', 'After');
    });

    expect(card.getAttribute('aria-label')).toBe('After');
  });

  it('removes the group role and label when accessibility is removed', () => {
    const surface = surfaceWith(
      'removed',
      new ComponentModel('root', 'Card', {accessibility: {label: 'Featured Deal'}}, catalog),
    );
    const {container} = render(<A2uiSurface surface={surface} />);
    const card = host(container, 'a2ui-react-card');
    expect(card.getAttribute('role')).toBe('group');

    act(() => {
      surface.componentsModel.get('root')!.properties = {};
    });

    expect(card.hasAttribute('role')).toBe(false);
    expect(card.hasAttribute('aria-label')).toBe(false);
  });

  it('keeps a role the app set in place of the group role', () => {
    const surface = surfaceWith(
      'own-role',
      new ComponentModel('root', 'Card', {accessibility: {label: 'Featured Deal'}}, catalog),
    );
    const {container} = render(<A2uiSurface surface={surface} />);
    const card = host(container, 'a2ui-react-card');
    card.setAttribute('role', 'region');

    act(() => {
      surface.componentsModel.get('root')!.properties = {accessibility: {}};
    });

    expect(card.getAttribute('role')).toBe('region');
  });

  describe('validation state', () => {
    function checkedSurface(id: string, ok: boolean) {
      const surface = surfaceWith(
        id,
        new ComponentModel(
          'root',
          'CheckedField',
          {checks: [{condition: {path: '/ok'}, message: 'Fix this'}]},
          catalog,
        ),
      );
      surface.dataModel.set('/ok', ok);
      return surface;
    }

    it('marks the accessibilityRef element invalid and describes it by the errors', () => {
      const {getByTestId} = render(<A2uiSurface surface={checkedSurface('invalid', false)} />);

      const input = getByTestId('input');
      const errors = getByTestId('errors');
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(errors.id).not.toBe('');
      expect(input.getAttribute('aria-describedby')).toBe(errors.id);
    });

    it('sets no validation attributes while the checks pass', () => {
      const {getByTestId} = render(<A2uiSurface surface={checkedSurface('valid', true)} />);

      const input = getByTestId('input');
      expect(input.hasAttribute('aria-invalid')).toBe(false);
      expect(input.hasAttribute('aria-describedby')).toBe(false);
    });

    it('removes the validation attributes when the checks start to pass', () => {
      const surface = checkedSurface('fixed', false);
      const {getByTestId, queryByTestId} = render(<A2uiSurface surface={surface} />);
      const input = getByTestId('input');
      expect(input.getAttribute('aria-invalid')).toBe('true');

      act(() => {
        surface.dataModel.set('/ok', true);
      });

      expect(queryByTestId('errors')).toBeNull();
      expect(input.hasAttribute('aria-invalid')).toBe(false);
      expect(input.hasAttribute('aria-describedby')).toBe(false);
    });

    it('keeps an id the errors element already has', () => {
      const WithId = createComponentImplementation(
        {name: 'WithId', schema: z.object({checks: CommonSchemas.Checkable.shape.checks})},
        ({accessibilityRef, validationErrorsRef}) => (
          <>
            <input data-testid="input" ref={accessibilityRef} />
            <div id="my-errors" ref={validationErrorsRef} />
          </>
        ),
      );
      const withIdCatalog = new Catalog<ReactCatalogComponent>('with-id', '0.9', [WithId]);
      const surface = new SurfaceModel<ReactCatalogComponent>('with-id', withIdCatalog);
      surface.componentsModel.addComponent(
        new ComponentModel(
          'root',
          'WithId',
          {checks: [{condition: {path: '/ok'}, message: 'Fix this'}]},
          withIdCatalog,
        ),
      );
      surface.dataModel.set('/ok', false);

      const {getByTestId} = render(<A2uiSurface surface={surface} />);

      expect(getByTestId('input').getAttribute('aria-describedby')).toBe('my-errors');
    });
  });
});
