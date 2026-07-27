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
 * Tabs component fixtures for visual parity testing.
 */

import type {ComponentFixture} from '../types';

export const tabsBasic: ComponentFixture = {
  root: 'tabs-basic',
  components: [
    // Tab 1 content
    {id: 'tab1-content', component: {Text: {text: {literalString: 'Content for Tab 1'}}}},
    // Tab 2 content
    {id: 'tab2-content', component: {Text: {text: {literalString: 'Content for Tab 2'}}}},
    // Tabs
    {
      id: 'tabs-basic',
      component: {
        Tabs: {
          tabItems: [
            {title: {literalString: 'Tab 1'}, child: 'tab1-content'},
            {title: {literalString: 'Tab 2'}, child: 'tab2-content'},
          ],
        },
      },
    },
  ],
};

export const tabsMultiple: ComponentFixture = {
  root: 'tabs-multi',
  components: [
    // Tab contents
    {
      id: 'tabm1-content',
      component: {Text: {text: {literalString: 'Overview content goes here.'}}},
    },
    {
      id: 'tabm2-content',
      component: {Text: {text: {literalString: 'Details and specifications.'}}},
    },
    {
      id: 'tabm3-content',
      component: {Text: {text: {literalString: 'Reviews from users.'}}},
    },
    {id: 'tabm4-content', component: {Text: {text: {literalString: 'Related items.'}}}},
    // Tabs
    {
      id: 'tabs-multi',
      component: {
        Tabs: {
          tabItems: [
            {title: {literalString: 'Overview'}, child: 'tabm1-content'},
            {title: {literalString: 'Details'}, child: 'tabm2-content'},
            {title: {literalString: 'Reviews'}, child: 'tabm3-content'},
            {title: {literalString: 'Related'}, child: 'tabm4-content'},
          ],
        },
      },
    },
  ],
};

export const tabsComplex: ComponentFixture = {
  root: 'tabs-complex',
  data: {
    '/tabs/notify': true,
    '/tabs/dark': false,
  },
  components: [
    // Profile tab content
    {
      id: 'profile-avatar',
      component: {
        Image: {
          url: {literalString: 'https://picsum.photos/seed/user/64/64'},
          usageHint: 'avatar',
        },
      },
    },
    {
      id: 'profile-name',
      component: {Text: {text: {literalString: 'John Doe'}, usageHint: 'h3'}},
    },
    {
      id: 'profile-bio',
      component: {Text: {text: {literalString: 'Software developer and UI enthusiast.'}}},
    },
    {
      id: 'profile-col',
      component: {
        Column: {children: {explicitList: ['profile-avatar', 'profile-name', 'profile-bio']}},
      },
    },
    // Settings tab content
    {
      id: 'settings-title',
      component: {Text: {text: {literalString: 'Preferences'}, usageHint: 'h3'}},
    },
    {
      id: 'settings-cb1',
      component: {
        CheckBox: {
          label: {literalString: 'Enable notifications'},
          value: {path: '/tabs/notify'},
        },
      },
    },
    {
      id: 'settings-cb2',
      component: {
        CheckBox: {label: {literalString: 'Dark mode'}, value: {path: '/tabs/dark'}},
      },
    },
    {
      id: 'settings-col',
      component: {
        Column: {children: {explicitList: ['settings-title', 'settings-cb1', 'settings-cb2']}},
      },
    },
    // Activity tab content
    {
      id: 'activity-title',
      component: {Text: {text: {literalString: 'Recent Activity'}, usageHint: 'h3'}},
    },
    {id: 'activity-1', component: {Text: {text: {literalString: 'Completed task A'}}}},
    {id: 'activity-2', component: {Text: {text: {literalString: 'Updated profile'}}}},
    {id: 'activity-3', component: {Text: {text: {literalString: 'Joined project B'}}}},
    {
      id: 'activity-col',
      component: {
        Column: {
          children: {explicitList: ['activity-title', 'activity-1', 'activity-2', 'activity-3']},
        },
      },
    },
    // Tabs
    {
      id: 'tabs-complex',
      component: {
        Tabs: {
          tabItems: [
            {title: {literalString: 'Profile'}, child: 'profile-col'},
            {title: {literalString: 'Settings'}, child: 'settings-col'},
            {title: {literalString: 'Activity'}, child: 'activity-col'},
          ],
        },
      },
    },
  ],
};

export const tabsFixtures = {
  tabsBasic,
  tabsMultiple,
  tabsComplex,
};
