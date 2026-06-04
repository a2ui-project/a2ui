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

/**
 * Image component fixtures for visual parity testing.
 * Uses picsum.photos for placeholder images (same as a2ui-composer).
 * The seed parameter ensures consistent images across test runs.
 */

import type {ComponentFixture} from '../types';

// Picsum URLs with seed for consistent images
const placeholderUrl = 'https://picsum.photos/seed/a2ui/150/150';
const avatarUrl = 'https://picsum.photos/seed/avatar/64/64';
const largeUrl = 'https://picsum.photos/seed/large/400/200';

export const imageBasic: ComponentFixture = {
  root: 'img-basic',
  components: [
    {
      id: 'img-basic',
      component: {
        Image: {url: {literalString: placeholderUrl}},
      },
    },
  ],
};

export const imageAvatar: ComponentFixture = {
  root: 'img-avatar',
  components: [
    {
      id: 'img-avatar',
      component: {
        Image: {
          url: {literalString: avatarUrl},
          usageHint: 'avatar',
        },
      },
    },
  ],
};

export const imageHeader: ComponentFixture = {
  root: 'img-header',
  components: [
    {
      id: 'img-header',
      component: {
        Image: {
          url: {literalString: largeUrl},
          usageHint: 'header',
        },
      },
    },
  ],
};

export const imageIcon: ComponentFixture = {
  root: 'img-icon',
  components: [
    {
      id: 'img-icon',
      component: {
        Image: {
          url: {literalString: avatarUrl},
          usageHint: 'icon',
        },
      },
    },
  ],
};

export const imageLargeFeature: ComponentFixture = {
  root: 'img-large',
  components: [
    {
      id: 'img-large',
      component: {
        Image: {
          url: {literalString: largeUrl},
          usageHint: 'largeFeature',
        },
      },
    },
  ],
};

export const imageMediumFeature: ComponentFixture = {
  root: 'img-medium',
  components: [
    {
      id: 'img-medium',
      component: {
        Image: {
          url: {literalString: placeholderUrl},
          usageHint: 'mediumFeature',
        },
      },
    },
  ],
};

export const imageSmallFeature: ComponentFixture = {
  root: 'img-small',
  components: [
    {
      id: 'img-small',
      component: {
        Image: {
          url: {literalString: avatarUrl},
          usageHint: 'smallFeature',
        },
      },
    },
  ],
};

export const imageFixtures = {
  imageBasic,
  imageAvatar,
  imageHeader,
  imageIcon,
  imageLargeFeature,
  imageMediumFeature,
  imageSmallFeature,
};
