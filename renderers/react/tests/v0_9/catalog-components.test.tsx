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

import {describe, it, expect, vi} from 'vitest';
import {screen, fireEvent, act} from '@testing-library/react';
import {ComponentModel} from '@a2ui/web_core/v0_9';
import {renderA2uiComponent} from '../utils';

import {
  Text,
  Image,
  Icon,
  Video,
  AudioPlayer,
  Row,
  Column,
  List,
  Card,
  Tabs,
  Divider,
  Modal,
  Button,
  TextField,
  CheckBox,
  ChoicePicker,
  Slider,
  DateTimeInput,
} from '../../src/v0_9/catalog/basic';

describe('Basic Catalog Components', () => {
  describe('Text', () => {
    it('renders static text', () => {
      renderA2uiComponent(Text, 't1', {text: 'Hello World'});
      expect(screen.getByText('Hello World')).toBeDefined();
    });

    it('renders reactive text from data model', async () => {
      const {updateData} = renderA2uiComponent(
        Text,
        't1',
        {text: {path: '/msg'}},
        {initialData: {msg: 'Initial'}},
      );

      expect(screen.getByText('Initial')).toBeDefined();

      await act(async () => {
        await updateData('/msg', 'Updated');
      });

      expect(screen.getByText('Updated')).toBeDefined();
    });

    it('renders with correct heading tag based on variant', () => {
      const {view} = renderA2uiComponent(Text, 't1', {text: 'Title', variant: 'h1'});
      const h1 = view.container.querySelector('div.h1 h1');
      expect(h1).not.toBeNull();
      expect(h1?.textContent).toBe('Title');
    });
  });

  describe('Image', () => {
    it('renders image with url and object-fit', () => {
      const {view} = renderA2uiComponent(Image, 'i1', {
        url: 'https://example.com/img.png',
        fit: 'cover',
      });
      const img = view.container.querySelector('img') as HTMLImageElement;
      expect(img.src).toBe('https://example.com/img.png');
      expect(img.style.objectFit).toBe('cover');
    });

    it('renders image with description as alt text', () => {
      const {view} = renderA2uiComponent(Image, 'i1', {
        url: 'url',
        description: 'A beautiful sunset',
      });
      const img = view.container.querySelector('img') as HTMLImageElement;
      expect(img.alt).toBe('A beautiful sunset');
    });

    it('applies variant-specific styling (avatar)', () => {
      const {view} = renderA2uiComponent(Image, 'i1', {
        url: 'url',
        variant: 'avatar',
      });
      const img = view.container.querySelector('img') as HTMLImageElement;
      expect(img.style.borderRadius).toBe('50%');
      expect(img.style.width).toBe('var(--a2ui-image-avatar-size, 40px)');
    });
  });

  describe('Icon', () => {
    it('renders material icon by name', () => {
      const {view} = renderA2uiComponent(Icon, 'ic1', {name: 'settings'});
      expect(view.container.textContent).toContain('settings');
      expect(view.container.querySelector('.material-symbols-outlined')).not.toBeNull();
    });

    it('converts camelCase icon names to snake_case', () => {
      const {view} = renderA2uiComponent(Icon, 'ic1', {name: 'shoppingCart'});
      expect(view.container.textContent).toContain('shopping_cart');
    });

    it.each([
      ['play', 'play_arrow'],
      ['rewind', 'fast_rewind'],
      ['favoriteOff', 'favorite_border'],
      ['starOff', 'star_border'],
    ])('maps "%s" to "%s"', (specName, materialName) => {
      const {view} = renderA2uiComponent(Icon, 'ic1', {name: specName});
      expect(view.container.textContent).toContain(materialName);
    });
  });

  describe('Video', () => {
    it('renders video element with source and controls', () => {
      const {view} = renderA2uiComponent(Video, 'v1', {url: 'vid.mp4'});
      const video = view.container.querySelector('video') as HTMLVideoElement;
      expect(video.src).toContain('vid.mp4');
      expect(video.controls).toBe(true);
    });
  });

  describe('AudioPlayer', () => {
    it('renders audio element and description', () => {
      renderA2uiComponent(AudioPlayer, 'a1', {
        url: 'audio.mp3',
        description: 'Listen to this',
      });
      expect(screen.getByText('Listen to this')).toBeDefined();
      const audio = document.querySelector('audio') as HTMLAudioElement;
      expect(audio.src).toContain('audio.mp3');
    });

    it('associates description with audio element via aria-describedby', () => {
      const {view} = renderA2uiComponent(AudioPlayer, 'a1', {
        url: 'audio.mp3',
        description: 'Listen to this',
      });
      const audio = view.container.querySelector('audio') as HTMLAudioElement;
      const describedBy = audio.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      const descElement = view.container.querySelector(`#${describedBy}`);
      expect(descElement).not.toBeNull();
      expect(descElement?.textContent).toBe('Listen to this');
    });

    it('does not set aria-describedby if description is missing', () => {
      const {view} = renderA2uiComponent(AudioPlayer, 'a1', {
        url: 'audio.mp3',
      });
      const audio = view.container.querySelector('audio') as HTMLAudioElement;
      expect(audio.getAttribute('aria-describedby')).toBeNull();
    });
  });

  describe('Button', () => {
    it('dispatches action on click', async () => {
      const {surface} = renderA2uiComponent(Button, 'b1', {
        action: {event: {name: 'submit_clicked'}},
        child: 'label1',
      });

      const actionSpy = vi.fn();
      surface.onAction.subscribe(actionSpy);

      fireEvent.click(screen.getByRole('button'));

      expect(actionSpy).toHaveBeenCalledWith(expect.objectContaining({name: 'submit_clicked'}));
    });

    it('is disabled when isValid is false (via checks)', async () => {
      const {updateData} = renderA2uiComponent(
        Button,
        'b1',
        {
          action: {event: {name: 'submit'}},
          checks: [
            {
              call: 'required',
              args: {value: {path: '/name'}},
              message: 'Name is required',
            },
          ],
        },
        {initialData: {name: ''}},
      );

      const button = screen.getByRole('button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);

      await act(async () => {
        await updateData('/name', 'Alice');
      });

      expect(button.disabled).toBe(false);
    });

    it('delegates child rendering to buildChild', () => {
      const {buildChild} = renderA2uiComponent(Button, 'b1', {child: 'inner1'});
      expect(buildChild).toHaveBeenCalledWith('inner1');
      expect(screen.getByTestId('child-inner1')).toBeDefined();
    });

    it('binds accessibility label and description', () => {
      const {view} = renderA2uiComponent(Button, 'b1', {
        child: 'btn',
        accessibility: {label: 'Custom Label', description: 'Custom Description'},
      });
      const button = screen.getByRole('button');
      expect(button.getAttribute('aria-label')).toBe('Custom Label');
      const descId = button.getAttribute('aria-describedby');
      expect(descId).not.toBeNull();
      const descElement = view.container.querySelector(`#${descId}`);
      expect(descElement).not.toBeNull();
      expect(descElement?.textContent).toBe('Custom Description');
    });
  });

  describe('TextField', () => {
    it('updates data model on change', () => {
      const {surface} = renderA2uiComponent(TextField, 'f1', {
        label: 'Name',
        value: {path: '/user/name'},
      });

      const input = screen.getByLabelText('Name');
      fireEvent.change(input, {target: {value: 'Bob'}});

      expect(surface.dataModel.get('/user/name')).toBe('Bob');
    });

    it('shows validation error message', async () => {
      const {updateData} = renderA2uiComponent(
        TextField,
        'f1',
        {
          label: 'Email',
          value: {path: '/email'},
          checks: [{call: 'required', args: {value: {path: '/email'}}, message: 'Required!'}],
        },
        {initialData: {email: ''}},
      );

      expect(screen.getByText('Required!')).toBeDefined();

      await act(async () => {
        await updateData('/email', 'test@test.com');
      });

      expect(screen.queryByText('Required!')).toBeNull();
    });

    it('binds accessibility label, description, and validation errors', () => {
      const {view} = renderA2uiComponent(
        TextField,
        'f1',
        {
          label: 'Name',
          value: {path: '/name'},
          accessibility: {label: 'A11y Name', description: 'Enter your name'},
          checks: [{call: 'required', args: {value: {path: '/name'}}, message: 'Name is required'}],
        },
        {initialData: {name: ''}},
      );

      const input = screen.getByLabelText('Name') as HTMLInputElement;
      expect(input.getAttribute('aria-label')).toBe('A11y Name');
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const describedBy = input.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      const ids = describedBy!.split(' ');
      expect(ids.length).toBe(2);

      const descElement = view.container.querySelector(`#${ids[0]}`);
      expect(descElement).not.toBeNull();
      expect(descElement?.textContent).toBe('Enter your name');

      const errorElement = view.container.querySelector(`#${ids[1]}`);
      expect(errorElement).not.toBeNull();
      expect(errorElement?.textContent).toBe('Name is required');
    });
  });

  describe('Layout and Structural Components', () => {
    it('Row renders multiple children', () => {
      const {buildChild} = renderA2uiComponent(Row, 'r1', {
        children: ['c1', 'c2'],
      });

      expect(buildChild).toHaveBeenCalledWith('c1');
      expect(buildChild).toHaveBeenCalledWith('c2');
      expect(screen.getByTestId('child-c1')).toBeDefined();
      expect(screen.getByTestId('child-c2')).toBeDefined();
    });

    it('Column renders children vertically', () => {
      const {buildChild, view} = renderA2uiComponent(Column, 'col1', {
        children: ['c1'],
      });
      expect(buildChild).toHaveBeenCalledWith('c1');
      expect(view.container.firstChild).toHaveStyle({flexDirection: 'column'});
    });

    it('List supports dynamic templates with scoped data context', () => {
      renderA2uiComponent(
        List,
        'list1',
        {
          children: {componentId: 'itemComp', path: '/items'},
        },
        {
          initialData: {items: [{n: 'A'}, {n: 'B'}]},
          additionalImpls: [Text],
          additionalComponents: [new ComponentModel('itemComp', 'Text', {text: {path: 'n'}})],
        },
      );

      expect(screen.getByText('A')).toBeDefined();
      expect(screen.getByText('B')).toBeDefined();
    });

    it('Card renders its child', () => {
      const {buildChild} = renderA2uiComponent(Card, 'card1', {child: 'c1'});
      expect(buildChild).toHaveBeenCalledWith('c1');
      expect(screen.getByTestId('child-c1')).toBeDefined();
    });

    it('Tabs switches active tab content', () => {
      renderA2uiComponent(Tabs, 'tabs1', {
        tabs: [
          {title: 'Home', child: 'home_c'},
          {title: 'Settings', child: 'settings_c'},
        ],
      });

      expect(screen.getByTestId('child-home_c')).toBeDefined();
      expect(screen.queryByTestId('child-settings_c')).toBeNull();

      fireEvent.click(screen.getByText('Settings'));

      expect(screen.queryByTestId('child-home_c')).toBeNull();
      expect(screen.getByTestId('child-settings_c')).toBeDefined();
    });

    it('conforms to WAI-ARIA tab pattern', () => {
      const {view} = renderA2uiComponent(Tabs, 'tabs1', {
        tabs: [
          {title: 'Home', child: 'home_c'},
          {title: 'Settings', child: 'settings_c'},
        ],
      });

      const tablist = screen.getByRole('tablist');
      expect(tablist).toBeDefined();

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(2);
      expect(tabs[0].getAttribute('aria-selected')).toBe('true');
      expect(tabs[1].getAttribute('aria-selected')).toBe('false');

      const homeTabPanel = screen.getByRole('tabpanel');
      expect(homeTabPanel).toBeDefined();
      expect(homeTabPanel.getAttribute('aria-labelledby')).toBe(tabs[0].id);
      expect(tabs[0].getAttribute('aria-controls')).toBe(homeTabPanel.id);
    });

    it('Modal opens content on trigger click', () => {
      renderA2uiComponent(Modal, 'm1', {
        trigger: 't1',
        content: 'c1',
      });

      expect(screen.getByTestId('child-t1')).toBeDefined();
      expect(screen.queryByTestId('child-c1')).toBeNull();

      fireEvent.click(screen.getByTestId('child-t1'));

      expect(screen.getByTestId('child-c1')).toBeDefined();
    });

    it('conforms to accessible modal dialog behavior', () => {
      const {view} = renderA2uiComponent(Modal, 'm1', {
        trigger: 't1',
        content: 'c1',
        accessibility: {label: 'Confirm Modal', description: 'Confirm description'},
      });

      fireEvent.click(screen.getByTestId('child-t1'));

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeDefined();
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.getAttribute('aria-label')).toBe('Confirm Modal');
      const descId = dialog.getAttribute('aria-describedby');
      expect(descId).not.toBeNull();
      expect(view.container.querySelector(`#${descId}`)).not.toBeNull();

      const closeBtn = screen.getByLabelText('Close');
      expect(closeBtn).toBeDefined();

      // Escape key closes modal
      fireEvent.keyDown(dialog, {key: 'Escape', code: 'Escape'});
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('Modal does not restore focus on mount, but restores it on close', () => {
      const triggerBtn = new ComponentModel('btn_trigger', 'Button', {
        child: 'btn_label',
        accessibility: {label: 'Open Modal'},
      });

      const {view} = renderA2uiComponent(
        Modal,
        'm1',
        {
          trigger: 'btn_trigger',
          content: 'c1',
        },
        {
          additionalComponents: [triggerBtn],
          additionalImpls: [Button],
        },
      );

      const button = screen.getByRole('button', {name: 'Open Modal'});
      expect(button).toBeDefined();

      // Focus an external element to ensure Modal doesn't steal it on mount
      const externalInput = document.createElement('input');
      document.body.appendChild(externalInput);
      externalInput.focus();
      expect(document.activeElement).toBe(externalInput);

      // Trigger a re-render of the component to make sure it doesn't focus on subsequent renders either
      // (Actually renderA2uiComponent doesn't easily let us force update without data change,
      // but the mount effect is what we are testing).
      expect(document.activeElement).toBe(externalInput);

      // Open the modal
      fireEvent.click(button);
      const closeBtn = screen.getByLabelText('Close');
      expect(document.activeElement).toBe(closeBtn);

      // Close the modal
      fireEvent.click(closeBtn);
      // Focus should be restored to the trigger button
      expect(document.activeElement).toBe(button);

      document.body.removeChild(externalInput);
    });

    it('Divider renders a themed line', () => {
      const {view} = renderA2uiComponent(Divider, 'd1', {axis: 'horizontal'});
      expect(view.container.firstChild).toHaveStyle({height: 'var(--a2ui-border-width, 1px)'});
    });
  });

  describe('Input Components', () => {
    it('CheckBox updates data', () => {
      const {surface} = renderA2uiComponent(CheckBox, 'cb1', {
        label: 'Agree',
        value: {path: '/agreed'},
      });

      fireEvent.click(screen.getByLabelText('Agree'));
      expect(surface.dataModel.get('/agreed')).toBe(true);
    });

    it('binds accessibility label, description, and validation errors', async () => {
      const {view} = renderA2uiComponent(
        CheckBox,
        'cb1',
        {
          label: 'Agree',
          value: {path: '/agreed'},
          accessibility: {label: 'A11y Label', description: 'A11y Desc'},
          checks: [
            {call: 'required', args: {value: {path: '/agreed'}}, message: 'Agreed is required'},
          ],
        },
        {initialData: {agreed: null}},
      );

      const checkbox = screen.getByLabelText('Agree') as HTMLInputElement;
      expect(checkbox.getAttribute('aria-label')).toBe('A11y Label');
      expect(checkbox.getAttribute('aria-invalid')).toBe('true');
      const describedBy = checkbox.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      const ids = describedBy!.split(' ');
      expect(ids.length).toBe(2);

      const descElement = view.container.querySelector(`#${ids[0]}`);
      expect(descElement).not.toBeNull();
      expect(descElement?.textContent).toBe('A11y Desc');

      const errorElement = view.container.querySelector(`#${ids[1]}`);
      expect(errorElement).not.toBeNull();
      expect(errorElement?.textContent).toBe('Agreed is required');
    });

    it('Slider updates data', () => {
      const {surface} = renderA2uiComponent(Slider, 's1', {
        label: 'Volume',
        value: {path: '/vol'},
        max: 100,
      });

      fireEvent.change(screen.getByLabelText('Volume'), {target: {value: '75'}});
      expect(surface.dataModel.get('/vol')).toBe(75);
    });

    it('binds accessibility label, description, and validation errors', () => {
      const {view} = renderA2uiComponent(
        Slider,
        's1',
        {
          label: 'Volume',
          value: {path: '/vol'},
          accessibility: {label: 'A11y Vol', description: 'Set audio volume'},
          checks: [{call: 'required', args: {value: {path: '/vol'}}, message: 'Vol is required'}],
        },
        {initialData: {vol: null}},
      );

      const input = screen.getByLabelText('Volume') as HTMLInputElement;
      expect(input.getAttribute('aria-label')).toBe('A11y Vol');
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const describedBy = input.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      const ids = describedBy!.split(' ');
      expect(ids.length).toBe(2);

      const descElement = view.container.querySelector(`#${ids[0]}`);
      expect(descElement).not.toBeNull();
      expect(descElement?.textContent).toBe('Set audio volume');

      const errorElement = view.container.querySelector(`#${ids[1]}`);
      expect(errorElement).not.toBeNull();
      expect(errorElement?.textContent).toBe('Vol is required');
    });

    it('ChoicePicker mutuallyExclusive selection', () => {
      const {view, surface} = renderA2uiComponent(ChoicePicker, 'cp1', {
        label: 'Pick',
        options: [
          {label: 'A', value: 'a'},
          {label: 'B', value: 'b'},
        ],
        value: {path: '/picked'},
        variant: 'mutuallyExclusive',
      });

      const labels = view.container.querySelectorAll('label');
      expect(labels.length).toBe(2);
      const inputs = view.container.querySelectorAll('input[type="radio"]');
      expect(inputs.length).toBe(2);

      const id0 = inputs[0].getAttribute('id');
      const id1 = inputs[1].getAttribute('id');
      expect(id0).not.toBeNull();
      expect(id1).not.toBeNull();

      expect(labels[0].getAttribute('for')).toBe(id0);
      expect(labels[1].getAttribute('for')).toBe(id1);

      fireEvent.click(screen.getByLabelText('A'));
      expect(surface.dataModel.get('/picked')).toEqual(['a']);

      fireEvent.click(screen.getByLabelText('B'));
      expect(surface.dataModel.get('/picked')).toEqual(['b']);
    });

    it('ChoicePicker filters options', () => {
      const {view} = renderA2uiComponent(ChoicePicker, 'cp2', {
        label: 'Pick',
        options: [
          {label: 'Apple', value: 'apple'},
          {label: 'Banana', value: 'banana'},
        ],
        value: {path: '/picked'},
        filterable: true,
      });

      const labels = view.container.querySelectorAll('label');
      expect(labels.length).toBe(2);
      const inputs = view.container.querySelectorAll('input[type="checkbox"]');
      expect(inputs.length).toBe(2);

      const id0 = inputs[0].getAttribute('id');
      const id1 = inputs[1].getAttribute('id');
      expect(id0).not.toBeNull();
      expect(id1).not.toBeNull();

      expect(labels[0].getAttribute('for')).toBe(id0);
      expect(labels[1].getAttribute('for')).toBe(id1);

      expect(screen.getByText('Apple')).toBeDefined();
      expect(screen.getByText('Banana')).toBeDefined();

      fireEvent.change(screen.getByPlaceholderText('Filter options...'), {
        target: {value: 'App'},
      });

      expect(screen.getByText('Apple')).toBeDefined();
      expect(screen.queryByText('Banana')).toBeNull();
    });

    it('ChoicePicker renders chips and handles selection', () => {
      const {surface} = renderA2uiComponent(ChoicePicker, 'cp3', {
        label: 'Pick',
        options: [
          {label: 'A', value: 'a'},
          {label: 'B', value: 'b'},
        ],
        value: {path: '/picked'},
        displayStyle: 'chips',
      });

      fireEvent.click(screen.getByText('A'));
      expect(surface.dataModel.get('/picked')).toEqual(['a']);
    });

    it('binds group roles, labels, and validation errors', () => {
      const {view} = renderA2uiComponent(
        ChoicePicker,
        'cp1',
        {
          label: 'Pick',
          options: [
            {label: 'A', value: 'a'},
            {label: 'B', value: 'b'},
          ],
          value: {path: '/picked'},
          accessibility: {label: 'A11y Picker', description: 'Pick options'},
          checks: [
            {call: 'required', args: {value: {path: '/picked'}}, message: 'Selection required'},
          ],
        },
        {initialData: {picked: []}},
      );

      const group = screen.getByRole('group');
      expect(group).toBeDefined();
      expect(group.getAttribute('aria-label')).toBe('A11y Picker');
      expect(group.getAttribute('aria-invalid')).toBe('true');
      const describedBy = group.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      const ids = describedBy!.split(' ');
      expect(ids.length).toBe(2);

      const descElement = view.container.querySelector(`#${ids[0]}`);
      expect(descElement).not.toBeNull();
      expect(descElement?.textContent).toBe('Pick options');

      const errorElement = view.container.querySelector(`#${ids[1]}`);
      expect(errorElement).not.toBeNull();
      expect(errorElement?.textContent).toBe('Selection required');
    });

    it('ChoicePicker binds radiogroup role for mutuallyExclusive variant', () => {
      renderA2uiComponent(ChoicePicker, 'cp1', {
        label: 'Pick',
        options: [{label: 'A', value: 'a'}],
        value: {path: '/picked'},
        variant: 'mutuallyExclusive',
      });

      const group = screen.getByRole('radiogroup');
      expect(group).toBeDefined();
    });

    it('DateTimeInput handles date changes', () => {
      const {surface} = renderA2uiComponent(DateTimeInput, 'dt1', {
        label: 'When',
        value: {path: '/date'},
        enableDate: true,
      });

      fireEvent.change(screen.getByLabelText('When'), {target: {value: '2026-03-20'}});
      expect(surface.dataModel.get('/date')).toBe('2026-03-20');
    });

    it('binds accessibility label, description, and validation errors', () => {
      const {view} = renderA2uiComponent(
        DateTimeInput,
        'dt1',
        {
          label: 'When',
          value: {path: '/date'},
          enableDate: true,
          accessibility: {label: 'A11y Date', description: 'Enter date'},
          checks: [{call: 'required', args: {value: {path: '/date'}}, message: 'Date is required'}],
        },
        {initialData: {date: ''}},
      );

      const input = screen.getByLabelText('When') as HTMLInputElement;
      expect(input.getAttribute('aria-label')).toBe('A11y Date');
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const describedBy = input.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      const ids = describedBy!.split(' ');
      expect(ids.length).toBe(2);

      const descElement = view.container.querySelector(`#${ids[0]}`);
      expect(descElement).not.toBeNull();
      expect(descElement?.textContent).toBe('Enter date');

      const errorElement = view.container.querySelector(`#${ids[1]}`);
      expect(errorElement).not.toBeNull();
      expect(errorElement?.textContent).toBe('Date is required');
    });
  });
});
