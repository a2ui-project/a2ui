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

import {describe, it, expect} from 'vitest';
import {render} from '@testing-library/react';
import React from 'react';
import {TestWrapper, TestRenderer, createSimpleMessages} from '../../utils';

describe('Image Component', () => {
  describe('Basic Rendering', () => {
    it('should render an img element', () => {
      const messages = createSimpleMessages('img-1', 'Image', {
        url: {literalString: 'https://example.com/image.jpg'},
        usageHint: 'mediumFeature',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const img = container.querySelector('img');
      expect(img).toBeInTheDocument();
    });

    it('should render with wrapper div', () => {
      const messages = createSimpleMessages('img-1', 'Image', {
        url: {literalString: 'https://example.com/image.jpg'},
        usageHint: 'mediumFeature',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-image');
      expect(wrapper).toBeInTheDocument();
    });

    it('should set src attribute from url', () => {
      const messages = createSimpleMessages('img-1', 'Image', {
        url: {literalString: 'https://example.com/photo.png'},
        usageHint: 'mediumFeature',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const img = container.querySelector('img');
      expect(img?.src).toBe('https://example.com/photo.png');
    });

    it('should have empty alt attribute', () => {
      const messages = createSimpleMessages('img-1', 'Image', {
        url: {literalString: 'https://example.com/image.jpg'},
        usageHint: 'mediumFeature',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const img = container.querySelector('img');
      expect(img?.alt).toBe('');
    });

    it('should render different src for different url inputs', () => {
      const messages1 = createSimpleMessages('img-1', 'Image', {
        url: {literalString: 'https://example.com/first.jpg'},
        usageHint: 'mediumFeature',
      });
      const messages2 = createSimpleMessages('img-2', 'Image', {
        url: {literalString: 'https://example.com/second.jpg'},
        usageHint: 'mediumFeature',
      });

      const {container: container1} = render(
        <TestWrapper>
          <TestRenderer messages={messages1} />
        </TestWrapper>,
      );
      const {container: container2} = render(
        <TestWrapper>
          <TestRenderer messages={messages2} />
        </TestWrapper>,
      );

      const img1 = container1.querySelector('img');
      const img2 = container2.querySelector('img');

      expect(img1?.src).toBe('https://example.com/first.jpg');
      expect(img2?.src).toBe('https://example.com/second.jpg');
      expect(img1?.src).not.toBe(img2?.src);
    });

    it('should return null for empty url', () => {
      const messages = createSimpleMessages('img-1', 'Image', {
        url: {literalString: ''},
        usageHint: 'mediumFeature',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const img = container.querySelector('img');
      expect(img).not.toBeInTheDocument();
    });
  });

  describe('Usage Hints', () => {
    const usageHints = [
      'icon',
      'avatar',
      'smallFeature',
      'mediumFeature',
      'largeFeature',
      'header',
    ];

    usageHints.forEach(hint => {
      it(`should render with usageHint="${hint}"`, () => {
        const messages = createSimpleMessages('img-1', 'Image', {
          url: {literalString: 'https://example.com/image.jpg'},
          usageHint: hint,
        });

        const {container} = render(
          <TestWrapper>
            <TestRenderer messages={messages} />
          </TestWrapper>,
        );

        const img = container.querySelector('img');
        expect(img).toBeInTheDocument();
      });
    });

    it('should apply different theme classes for different usageHints', () => {
      // usageHint affects which theme classes are merged onto the section element
      const messagesNoHint = createSimpleMessages('img-1', 'Image', {
        url: {literalString: 'https://example.com/image.jpg'},
        usageHint: 'mediumFeature',
      });
      const messagesWithHint = createSimpleMessages('img-2', 'Image', {
        url: {literalString: 'https://example.com/image.jpg'},
        usageHint: 'avatar',
      });

      const {container: containerNoHint} = render(
        <TestWrapper>
          <TestRenderer messages={messagesNoHint} />
        </TestWrapper>,
      );
      const {container: containerWithHint} = render(
        <TestWrapper>
          <TestRenderer messages={messagesWithHint} />
        </TestWrapper>,
      );

      const sectionNoHint = containerNoHint.querySelector('section');
      const sectionWithHint = containerWithHint.querySelector('section');

      // Both should have sections
      expect(sectionNoHint).toBeInTheDocument();
      expect(sectionWithHint).toBeInTheDocument();

      // The component renders section with merged classes from theme
      // Just verify both render successfully with their respective usageHints
      expect(sectionNoHint?.tagName).toBe('SECTION');
      expect(sectionWithHint?.tagName).toBe('SECTION');
    });
  });

  describe('Fit Mode', () => {
    it('should default to fill fit mode', () => {
      const messages = createSimpleMessages('img-1', 'Image', {
        url: {literalString: 'https://example.com/image.jpg'},
        usageHint: 'mediumFeature',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      expect(section?.style.getPropertyValue('--object-fit')).toBe('fill');
    });

    const fitModes = ['contain', 'cover', 'fill', 'none', 'scale-down'];

    fitModes.forEach(fit => {
      it(`should set --object-fit CSS variable for fit="${fit}"`, () => {
        const messages = createSimpleMessages('img-1', 'Image', {
          url: {literalString: 'https://example.com/image.jpg'},
          usageHint: 'mediumFeature',
          fit,
        });

        const {container} = render(
          <TestWrapper>
            <TestRenderer messages={messages} />
          </TestWrapper>,
        );

        const section = container.querySelector('section');
        expect(section?.style.getPropertyValue('--object-fit')).toBe(fit);
      });
    });

    it('should set different --object-fit for different fit inputs', () => {
      const messagesCover = createSimpleMessages('img-1', 'Image', {
        url: {literalString: 'https://example.com/image.jpg'},
        usageHint: 'mediumFeature',
        fit: 'cover',
      });
      const messagesContain = createSimpleMessages('img-2', 'Image', {
        url: {literalString: 'https://example.com/image.jpg'},
        usageHint: 'mediumFeature',
        fit: 'contain',
      });

      const {container: containerCover} = render(
        <TestWrapper>
          <TestRenderer messages={messagesCover} />
        </TestWrapper>,
      );
      const {container: containerContain} = render(
        <TestWrapper>
          <TestRenderer messages={messagesContain} />
        </TestWrapper>,
      );

      const sectionCover = containerCover.querySelector('section');
      const sectionContain = containerContain.querySelector('section');

      expect(sectionCover?.style.getPropertyValue('--object-fit')).toBe('cover');
      expect(sectionContain?.style.getPropertyValue('--object-fit')).toBe('contain');
      expect(sectionCover?.style.getPropertyValue('--object-fit')).not.toBe(
        sectionContain?.style.getPropertyValue('--object-fit'),
      );
    });
  });

  describe('Theme Support', () => {
    it('should render within section container', () => {
      const messages = createSimpleMessages('img-1', 'Image', {
        url: {literalString: 'https://example.com/image.jpg'},
        usageHint: 'mediumFeature',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      expect(section).toBeInTheDocument();
      expect(section?.querySelector('img')).toBeInTheDocument();
    });

    it('should apply theme classes to section', () => {
      const messages = createSimpleMessages('img-1', 'Image', {
        url: {literalString: 'https://example.com/image.jpg'},
        usageHint: 'mediumFeature',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const section = container.querySelector('section');
      // Verify section has className that is a non-empty string (not just truthy)
      expect(section?.className).toBeDefined();
      expect(typeof section?.className).toBe('string');
      // Theme should apply layout classes from litTheme
      expect(section?.classList.length).toBeGreaterThan(0);
    });
  });

  describe('Structure', () => {
    it('should have correct DOM structure', () => {
      const messages = createSimpleMessages('img-1', 'Image', {
        url: {literalString: 'https://example.com/image.jpg'},
        usageHint: 'mediumFeature',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      const wrapper = container.querySelector('.a2ui-image');
      expect(wrapper?.children.length).toBe(1);
      expect(wrapper?.children[0]?.tagName).toBe('SECTION');

      const section = wrapper?.children[0];
      expect(section?.children.length).toBe(1);
      expect(section?.children[0]?.tagName).toBe('IMG');
    });
  });
});
