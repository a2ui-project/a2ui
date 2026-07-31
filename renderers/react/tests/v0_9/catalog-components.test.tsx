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

    it('Slider updates data', () => {
      const {surface} = renderA2uiComponent(Slider, 's1', {
        label: 'Volume',
        value: {path: '/vol'},
        max: 100,
      });

      fireEvent.change(screen.getByLabelText('Volume'), {target: {value: '75'}});
      expect(surface.dataModel.get('/vol')).toBe(75);
    });

    it('ChoicePicker mutuallyExclusive selection', () => {
      const {surface} = renderA2uiComponent(ChoicePicker, 'cp1', {
        label: 'Pick',
        options: [
          {label: 'A', value: 'a'},
          {label: 'B', value: 'b'},
        ],
        value: {path: '/picked'},
        variant: 'mutuallyExclusive',
      });

      fireEvent.click(screen.getByLabelText('A'));
      expect(surface.dataModel.get('/picked')).toEqual(['a']);

      fireEvent.click(screen.getByLabelText('B'));
      expect(surface.dataModel.get('/picked')).toEqual(['b']);
    });

    it('ChoicePicker filters options', () => {
      renderA2uiComponent(ChoicePicker, 'cp2', {
        label: 'Pick',
        options: [
          {label: 'Apple', value: 'apple'},
          {label: 'Banana', value: 'banana'},
        ],
        value: {path: '/picked'},
        filterable: true,
      });

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

    it('DateTimeInput handles date changes', () => {
      const {surface} = renderA2uiComponent(DateTimeInput, 'dt1', {
        label: 'When',
        value: {path: '/date'},
        enableDate: true,
      });

      fireEvent.change(screen.getByLabelText('When'), {target: {value: '2026-03-20'}});
      expect(surface.dataModel.get('/date')).toBe('2026-03-20');
    });
  });

  describe('Accessibility Attributes', () => {
    it('renders aria-label and aria-description on Button', () => {
      const {view} = renderA2uiComponent(Button, 'btn_a11y', {
        child: 'btn_text',
        accessibility: {label: 'Custom Button Label', description: 'Custom Button Description'},
      });
      const btn = view.container.querySelector('button')!;
      expect(btn.getAttribute('aria-label')).toBe('Custom Button Label');
      expect(btn.getAttribute('aria-description')).toBe('Custom Button Description');
    });

    it('renders aria-label and aria-description on Text', () => {
      const {view} = renderA2uiComponent(Text, 'txt_a11y', {
        text: 'Sample Text',
        accessibility: {label: 'Text Label', description: 'Text Description'},
      });
      const el = view.container.firstElementChild!;
      expect(el.getAttribute('aria-label')).toBe('Text Label');
      expect(el.getAttribute('aria-description')).toBe('Text Description');
    });

    it('renders alt and aria-description on Image', () => {
      const {view} = renderA2uiComponent(Image, 'img_a11y', {
        url: 'https://example.com/pic.png',
        accessibility: {label: 'Accessible Image', description: 'Image Description'},
      });
      const img = view.container.querySelector('img')!;
      expect(img.getAttribute('alt')).toBe('Accessible Image');
      expect(img.getAttribute('aria-description')).toBe('Image Description');
    });

    it('renders aria-label, aria-description and aria-hidden on Icon', () => {
      const {view: view1} = renderA2uiComponent(Icon, 'icon1', {
        name: 'play',
        accessibility: {label: 'Play Icon', description: 'Plays media'},
      });
      const icon1 = view1.container.querySelector('span')!;
      expect(icon1.getAttribute('aria-label')).toBe('Play Icon');
      expect(icon1.getAttribute('aria-description')).toBe('Plays media');
      expect(icon1.getAttribute('aria-hidden')).toBeNull();

      const {view: view2} = renderA2uiComponent(Icon, 'icon2', {
        name: 'play',
      });
      const icon2 = view2.container.querySelector('span')!;
      expect(icon2.getAttribute('aria-hidden')).toBe('true');
    });

    it('renders aria-label and aria-description on Card', () => {
      const {view} = renderA2uiComponent(Card, 'card_a11y', {
        accessibility: {label: 'Card Label', description: 'Card Description'},
      });
      const card = view.container.querySelector('.a2ui-card')!;
      expect(card.getAttribute('aria-label')).toBe('Card Label');
      expect(card.getAttribute('aria-description')).toBe('Card Description');
    });

    it('renders aria-label and aria-description on CheckBox', () => {
      const {view} = renderA2uiComponent(CheckBox, 'cb_a11y', {
        accessibility: {label: 'CheckBox Label', description: 'CheckBox Description'},
      });
      const input = view.container.querySelector('input[type="checkbox"]')!;
      expect(input.getAttribute('aria-label')).toBe('CheckBox Label');
      expect(input.getAttribute('aria-description')).toBe('CheckBox Description');
    });

    it('renders aria-label and aria-description on ChoicePicker', () => {
      const {view} = renderA2uiComponent(ChoicePicker, 'cp_a11y', {
        options: [{label: 'Opt1', value: 'opt1'}],
        accessibility: {label: 'ChoicePicker Label', description: 'ChoicePicker Description'},
      });
      const group = view.container.querySelector('[role="group"]')!;
      expect(group.getAttribute('aria-label')).toBe('ChoicePicker Label');
      expect(group.getAttribute('aria-description')).toBe('ChoicePicker Description');
    });

    it('renders aria-label and aria-description on DateTimeInput', () => {
      const {view} = renderA2uiComponent(DateTimeInput, 'dt_a11y', {
        enableDate: true,
        accessibility: {label: 'DateTime Label', description: 'DateTime Description'},
      });
      const input = view.container.querySelector('input')!;
      expect(input.getAttribute('aria-label')).toBe('DateTime Label');
      expect(input.getAttribute('aria-description')).toBe('DateTime Description');
    });

    it('renders aria-label and aria-description on Slider', () => {
      const {view} = renderA2uiComponent(Slider, 'slider_a11y', {
        accessibility: {label: 'Slider Label', description: 'Slider Description'},
      });
      const input = view.container.querySelector('input[type="range"]')!;
      expect(input.getAttribute('aria-label')).toBe('Slider Label');
      expect(input.getAttribute('aria-description')).toBe('Slider Description');
    });

    it('renders aria-label and aria-description on TextField', () => {
      const {view} = renderA2uiComponent(TextField, 'tf_a11y', {
        accessibility: {label: 'TextField Label', description: 'TextField Description'},
      });
      const input = view.container.querySelector('input')!;
      expect(input.getAttribute('aria-label')).toBe('TextField Label');
      expect(input.getAttribute('aria-description')).toBe('TextField Description');
    });

    it('renders aria-label and aria-description on Video', () => {
      const {view} = renderA2uiComponent(Video, 'video_a11y', {
        url: 'https://example.com/video.mp4',
        accessibility: {label: 'Video Label', description: 'Video Description'},
      });
      const video = view.container.querySelector('video')!;
      expect(video.getAttribute('aria-label')).toBe('Video Label');
      expect(video.getAttribute('aria-description')).toBe('Video Description');
    });

    it('renders aria-label and aria-description on AudioPlayer', () => {
      const {view} = renderA2uiComponent(AudioPlayer, 'audio_a11y', {
        url: 'https://example.com/audio.mp3',
        accessibility: {label: 'Audio Label', description: 'Audio Description'},
      });
      const audio = view.container.querySelector('audio')!;
      expect(audio.getAttribute('aria-label')).toBe('Audio Label');
      expect(audio.getAttribute('aria-description')).toBe('Audio Description');
    });
  });
});
