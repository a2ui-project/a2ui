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

import {A2uiMessage} from '@a2ui/web_core/v0_9';

/**
 * Mock A2UI messages for the restaurant finder demo.
 * Based on the examples in samples/agent/adk/restaurant_finder/a2ui_examples.py
 */

// Sample restaurant data (same as restaurant_data.json)
const restaurantData = [
  {
    name: "Xi'an Famous Foods",
    detail: 'Spicy and savory hand-pulled noodles.',
    imageUrl: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400',
    rating: '★★★★☆',
    infoLink: '[More Info](https://www.xianfoods.com/)',
    address: '81 St Marks Pl, New York, NY 10003',
  },
  {
    name: 'Han Dynasty',
    detail: 'Authentic Szechuan cuisine.',
    imageUrl: 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=400',
    rating: '★★★★☆',
    infoLink: '[More Info](https://www.handynasty.net/)',
    address: '90 3rd Ave, New York, NY 10003',
  },
  {
    name: 'RedFarm',
    detail: 'Modern Chinese with a farm-to-table approach.',
    imageUrl: 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=400',
    rating: '★★★★☆',
    infoLink: '[More Info](https://www.redfarmnyc.com/)',
    address: '529 Hudson St, New York, NY 10014',
  },
  {
    name: 'Mott 32',
    detail: 'Upscale Cantonese dining.',
    imageUrl: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=400',
    rating: '★★★★★',
    infoLink: '[More Info](https://mott32.com/newyork/)',
    address: '111 W 57th St, New York, NY 10019',
  },
  {
    name: 'Hwa Yuan Szechuan',
    detail: 'Famous for its cold noodles with sesame sauce.',
    imageUrl: 'https://images.unsplash.com/photo-1555126634-323283e090fa?w=400',
    rating: '★★★★☆',
    infoLink: '[More Info](https://hwayuannyc.com/)',
    address: '40 E Broadway, New York, NY 10002',
  },
];

/**
 * Creates mock messages for a restaurant list display.
 * This simulates what the agent would return for a "find restaurants" query.
 */
export function createRestaurantListMessages(): A2uiMessage[] {
  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'default',
        catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        theme: {primaryColor: '#FF0000', font: 'Roboto'},
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'default',
        components: [
          {
            id: 'root',
            component: 'Column',
            children: ['title-heading', 'item-list'],
          },
          {
            id: 'title-heading',
            component: 'Text',
            variant: 'h1',
            text: {path: '/title'},
          },
          {
            id: 'item-list',
            component: 'List',
            direction: 'vertical',
            children: {
              componentId: 'item-card-template',
              path: '/items',
            },
          },
          {
            id: 'item-card-template',
            component: 'Card',
            child: 'card-layout',
          },
          {
            id: 'card-layout',
            component: 'Row',
            children: ['template-image', 'card-details'],
          },
          {
            id: 'template-image',
            component: 'Image',
            url: {path: 'imageUrl'},
            weight: 1,
          },
          {
            id: 'card-details',
            component: 'Column',
            children: [
              'template-name',
              'template-rating',
              'template-detail',
              'template-link',
              'template-book-button',
            ],
            weight: 2,
          },
          {
            id: 'template-name',
            component: 'Text',
            variant: 'h3',
            text: {path: 'name'},
          },
          {
            id: 'template-rating',
            component: 'Text',
            text: {path: 'rating'},
          },
          {
            id: 'template-detail',
            component: 'Text',
            text: {path: 'detail'},
          },
          {
            id: 'template-link',
            component: 'Text',
            text: {path: 'infoLink'},
          },
          {
            id: 'template-book-button',
            component: 'Button',
            child: 'book-now-text',
            variant: 'primary',
            action: {
              event: {
                name: 'book_restaurant',
                context: {
                  restaurantName: {path: 'name'},
                  imageUrl: {path: 'imageUrl'},
                  address: {path: 'address'},
                },
              },
            },
          },
          {
            id: 'book-now-text',
            component: 'Text',
            text: 'Book Now',
          },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'default',
        path: '/',
        value: {
          title: 'Top 5 Chinese Restaurants in New York',
          items: restaurantData.map(restaurant => ({
            name: restaurant.name,
            rating: restaurant.rating,
            detail: restaurant.detail,
            infoLink: restaurant.infoLink,
            imageUrl: restaurant.imageUrl,
            address: restaurant.address,
          })),
        },
      },
    },
  ];
}

/**
 * Creates mock messages for a booking form.
 * This simulates what the agent would return when user clicks "Book Now".
 */
export function createBookingFormMessages(
  restaurantName: string,
  imageUrl: string,
  address: string,
): A2uiMessage[] {
  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'booking-form',
        catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        theme: {primaryColor: '#FF0000', font: 'Roboto'},
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'booking-form',
        components: [
          {
            id: 'root',
            component: 'Column',
            children: [
              'booking-title',
              'restaurant-image',
              'restaurant-address',
              'party-size-field',
              'datetime-field',
              'dietary-field',
              'submit-button',
            ],
          },
          {
            id: 'booking-title',
            component: 'Text',
            variant: 'h2',
            text: {path: '/title'},
          },
          {
            id: 'restaurant-image',
            component: 'Image',
            url: {path: '/imageUrl'},
          },
          {
            id: 'restaurant-address',
            component: 'Text',
            text: {path: '/address'},
          },
          {
            id: 'party-size-field',
            component: 'TextField',
            label: 'Party Size',
            value: {path: '/partySize'},
            variant: 'number',
          },
          {
            id: 'datetime-field',
            component: 'DateTimeInput',
            label: 'Date & Time',
            value: {path: '/reservationTime'},
            enableDate: true,
            enableTime: true,
          },
          {
            id: 'dietary-field',
            component: 'TextField',
            label: 'Dietary Requirements',
            value: {path: '/dietary'},
          },
          {
            id: 'submit-button',
            component: 'Button',
            child: 'submit-reservation-text',
            variant: 'primary',
            action: {
              event: {
                name: 'submit_booking',
                context: {
                  restaurantName: {path: '/restaurantName'},
                  partySize: {path: '/partySize'},
                  reservationTime: {path: '/reservationTime'},
                  dietary: {path: '/dietary'},
                  imageUrl: {path: '/imageUrl'},
                },
              },
            },
          },
          {
            id: 'submit-reservation-text',
            component: 'Text',
            text: 'Submit Reservation',
          },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'booking-form',
        path: '/',
        value: {
          title: `Book a Table at ${restaurantName}`,
          address: address,
          restaurantName: restaurantName,
          partySize: '2',
          reservationTime: '',
          dietary: '',
          imageUrl: imageUrl,
        },
      },
    },
  ];
}

/**
 * Creates mock messages for a booking confirmation.
 * This simulates what the agent would return after submitting a booking.
 */
export function createConfirmationMessages(
  restaurantName: string,
  partySize: string,
  reservationTime: string,
  dietary: string,
  imageUrl: string,
): A2uiMessage[] {
  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'confirmation',
        catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        theme: {primaryColor: '#FF0000', font: 'Roboto'},
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'confirmation',
        components: [
          {
            id: 'root',
            component: 'Card',
            child: 'confirmation-column',
          },
          {
            id: 'confirmation-column',
            component: 'Column',
            children: [
              'confirm-title',
              'confirm-image',
              'divider1',
              'confirm-details',
              'divider2',
              'confirm-dietary',
              'divider3',
              'confirm-text',
            ],
          },
          {
            id: 'confirm-title',
            component: 'Text',
            variant: 'h2',
            text: {path: '/title'},
          },
          {
            id: 'confirm-image',
            component: 'Image',
            url: {path: '/imageUrl'},
          },
          {
            id: 'confirm-details',
            component: 'Text',
            text: {path: '/bookingDetails'},
          },
          {
            id: 'confirm-dietary',
            component: 'Text',
            text: {path: '/dietaryRequirements'},
          },
          {
            id: 'confirm-text',
            component: 'Text',
            variant: 'h5',
            text: 'We look forward to seeing you!',
          },
          {id: 'divider1', component: 'Divider'},
          {id: 'divider2', component: 'Divider'},
          {id: 'divider3', component: 'Divider'},
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'confirmation',
        path: '/',
        value: {
          title: `Booking Confirmed at ${restaurantName}`,
          bookingDetails: `${partySize} people at ${reservationTime || 'TBD'}`,
          dietaryRequirements: dietary
            ? `Dietary Requirements: ${dietary}`
            : 'No dietary requirements specified',
          imageUrl: imageUrl,
        },
      },
    },
  ];
}
