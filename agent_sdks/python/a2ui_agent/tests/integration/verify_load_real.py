# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import sys

from a2ui.schema.manager import A2uiSchemaManager
from a2ui.schema.constants import CATALOG_COMPONENTS_KEY, VERSION_0_8, VERSION_0_9
from a2ui.schema.common_modifiers import remove_strict_validation
from a2ui.basic_catalog.provider import BasicCatalog


def verify():
  print('Verifying A2uiSchemaManager...')
  try:
    manager = A2uiSchemaManager(
        version=VERSION_0_8,
        catalogs=[BasicCatalog.get_config(VERSION_0_8)],
        schema_modifiers=[remove_strict_validation],
    )
    catalog = manager.get_selected_catalog()
    catalog_components = catalog.catalog_schema[CATALOG_COMPONENTS_KEY]
    print(f'Successfully loaded {VERSION_0_8}: {len(catalog_components)} components')
    print(f'Components found: {list(catalog_components.keys())[:5]}...')

    a2ui_message = [
        {'beginRendering': {'surfaceId': 'contact-card', 'root': 'main_card'}},
        {
            'surfaceUpdate': {
                'surfaceId': 'contact-card',
                'components': [
                    {
                        'id': 'profile_image',
                        'component': {
                            'Image': {
                                'url': {'path': '/imageUrl'},
                                'usageHint': 'avatar',
                                'fit': 'cover',
                            }
                        },
                    },
                    {
                        'id': 'user_heading',
                        'weight': 1,
                        'component': {
                            'Text': {'text': {'path': '/name'}, 'usageHint': 'h2'}
                        },
                    },
                    {
                        'id': 'description_text_1',
                        'component': {'Text': {'text': {'path': '/title'}}},
                    },
                    {
                        'id': 'description_text_2',
                        'component': {'Text': {'text': {'path': '/team'}}},
                    },
                    {
                        'id': 'description_column',
                        'component': {
                            'Column': {
                                'children': {
                                    'explicitList': [
                                        'user_heading',
                                        'description_text_1',
                                        'description_text_2',
                                    ]
                                },
                                'alignment': 'center',
                            }
                        },
                    },
                    {
                        'id': 'calendar_icon',
                        'component': {
                            'Icon': {'name': {'literalString': 'calendarToday'}}
                        },
                    },
                    {
                        'id': 'calendar_primary_text',
                        'component': {
                            'Text': {'usageHint': 'h5', 'text': {'path': '/calendar'}}
                        },
                    },
                    {
                        'id': 'calendar_secondary_text',
                        'component': {'Text': {'text': {'literalString': 'Calendar'}}},
                    },
                    {
                        'id': 'calendar_text_column',
                        'component': {
                            'Column': {
                                'children': {
                                    'explicitList': [
                                        'calendar_primary_text',
                                        'calendar_secondary_text',
                                    ]
                                },
                                'distribution': 'start',
                                'alignment': 'start',
                            }
                        },
                    },
                    {
                        'id': 'info_row_1',
                        'component': {
                            'Row': {
                                'children': {
                                    'explicitList': [
                                        'calendar_icon',
                                        'calendar_text_column',
                                    ]
                                },
                                'distribution': 'start',
                                'alignment': 'start',
                            }
                        },
                    },
                    {
                        'id': 'location_icon',
                        'component': {
                            'Icon': {'name': {'literalString': 'locationOn'}}
                        },
                    },
                    {
                        'id': 'location_primary_text',
                        'component': {
                            'Text': {'usageHint': 'h5', 'text': {'path': '/location'}}
                        },
                    },
                    {
                        'id': 'location_secondary_text',
                        'component': {'Text': {'text': {'literalString': 'Location'}}},
                    },
                    {
                        'id': 'location_text_column',
                        'component': {
                            'Column': {
                                'children': {
                                    'explicitList': [
                                        'location_primary_text',
                                        'location_secondary_text',
                                    ]
                                },
                                'distribution': 'start',
                                'alignment': 'start',
                            }
                        },
                    },
                    {
                        'id': 'info_row_2',
                        'component': {
                            'Row': {
                                'children': {
                                    'explicitList': [
                                        'location_icon',
                                        'location_text_column',
                                    ]
                                },
                                'distribution': 'start',
                                'alignment': 'start',
                            }
                        },
                    },
                    {
                        'id': 'mail_icon',
                        'component': {'Icon': {'name': {'literalString': 'mail'}}},
                    },
                    {
                        'id': 'mail_primary_text',
                        'component': {
                            'Text': {'usageHint': 'h5', 'text': {'path': '/email'}}
                        },
                    },
                    {
                        'id': 'mail_secondary_text',
                        'component': {'Text': {'text': {'literalString': 'Email'}}},
                    },
                    {
                        'id': 'mail_text_column',
                        'component': {
                            'Column': {
                                'children': {
                                    'explicitList': [
                                        'mail_primary_text',
                                        'mail_secondary_text',
                                    ]
                                },
                                'distribution': 'start',
                                'alignment': 'start',
                            }
                        },
                    },
                    {
                        'id': 'info_row_3',
                        'component': {
                            'Row': {
                                'children': {
                                    'explicitList': ['mail_icon', 'mail_text_column']
                                },
                                'distribution': 'start',
                                'alignment': 'start',
                            }
                        },
                    },
                    {'id': 'div', 'component': {'Divider': {}}},
                    {
                        'id': 'call_icon',
                        'component': {'Icon': {'name': {'literalString': 'call'}}},
                    },
                    {
                        'id': 'call_primary_text',
                        'component': {
                            'Text': {'usageHint': 'h5', 'text': {'path': '/mobile'}}
                        },
                    },
                    {
                        'id': 'call_secondary_text',
                        'component': {'Text': {'text': {'literalString': 'Mobile'}}},
                    },
                    {
                        'id': 'call_text_column',
                        'component': {
                            'Column': {
                                'children': {
                                    'explicitList': [
                                        'call_primary_text',
                                        'call_secondary_text',
                                    ]
                                },
                                'distribution': 'start',
                                'alignment': 'start',
                            }
                        },
                    },
                    {
                        'id': 'info_row_4',
                        'component': {
                            'Row': {
                                'children': {
                                    'explicitList': ['call_icon', 'call_text_column']
                                },
                                'distribution': 'start',
                                'alignment': 'start',
                            }
                        },
                    },
                    {
                        'id': 'info_rows_column',
                        'weight': 1,
                        'component': {
                            'Column': {
                                'children': {
                                    'explicitList': [
                                        'info_row_1',
                                        'info_row_2',
                                        'info_row_3',
                                        'info_row_4',
                                    ]
                                },
                                'alignment': 'stretch',
                            }
                        },
                    },
                    {
                        'id': 'button_1_text',
                        'component': {'Text': {'text': {'literalString': 'Follow'}}},
                    },
                    {
                        'id': 'button_1',
                        'component': {
                            'Button': {
                                'child': 'button_1_text',
                                'primary': True,
                                'action': {'name': 'follow_contact'},
                            }
                        },
                    },
                    {
                        'id': 'button_2_text',
                        'component': {'Text': {'text': {'literalString': 'Message'}}},
                    },
                    {
                        'id': 'button_2',
                        'component': {
                            'Button': {
                                'child': 'button_2_text',
                                'primary': False,
                                'action': {'name': 'send_message'},
                            }
                        },
                    },
                    {
                        'id': 'action_buttons_row',
                        'component': {
                            'Row': {
                                'children': {'explicitList': ['button_1', 'button_2']},
                                'distribution': 'center',
                                'alignment': 'center',
                            }
                        },
                    },
                    {
                        'id': 'link_text',
                        'component': {
                            'Text': {
                                'text': {
                                    'literalString': '[View Full Profile](/profile)'
                                }
                            }
                        },
                    },
                    {
                        'id': 'link_text_wrapper',
                        'component': {
                            'Row': {
                                'children': {'explicitList': ['link_text']},
                                'distribution': 'center',
                                'alignment': 'center',
                            }
                        },
                    },
                    {
                        'id': 'main_column',
                        'component': {
                            'Column': {
                                'children': {
                                    'explicitList': [
                                        'profile_image',
                                        'description_column',
                                        'div',
                                        'info_rows_column',
                                        'action_buttons_row',
                                        'link_text_wrapper',
                                    ]
                                },
                                'alignment': 'stretch',
                            }
                        },
                    },
                    {
                        'id': 'main_card',
                        'component': {'Card': {'child': 'main_column'}},
                    },
                ],
            }
        },
        {
            'dataModelUpdate': {
                'surfaceId': 'contact-card',
                'path': '/',
                'contents': [
                    {'key': 'name', 'valueString': 'Casey Smith'},
                    {'key': 'title', 'valueString': 'Digital Marketing Specialist'},
                    {'key': 'team', 'valueString': 'Growth Team'},
                    {'key': 'location', 'valueString': 'New York'},
                    {'key': 'email', 'valueString': 'casey.smith@example.com'},
                    {'key': 'mobile', 'valueString': '+1 (415) 222-3333'},
                    {'key': 'calendar', 'valueString': 'In a meeting'},
                    {
                        'key': 'imageUrl',
                        'valueString': 'http://localhost:10003/static/profile2.png',
                    },
                    {
                        'key': 'contacts',
                        'valueMap': [{
                            'key': 'contact1',
                            'valueMap': [{'key': 'name', 'valueString': 'Casey Smith'}],
                        }],
                    },
                ],
            }
        },
    ]
    catalog.validator.validate(a2ui_message)
    print('Validation successful')
  except Exception as e:
    print(f'Failed to load {VERSION_0_8}: {e}')
    sys.exit(1)

  try:
    manager = A2uiSchemaManager(
        version=VERSION_0_9,
        catalogs=[BasicCatalog.get_config(VERSION_0_9)],
        schema_modifiers=[remove_strict_validation],
    )
    catalog = manager.get_selected_catalog()
    catalog_components = catalog.catalog_schema[CATALOG_COMPONENTS_KEY]
    print(f'Successfully loaded {VERSION_0_9}: {len(catalog_components)} components')
    print(f'Components found: {list(catalog_components.keys())}...')

    a2ui_message = [
        {
            'version': 'v0.9',
            'createSurface': {
                'surfaceId': 'contact_form_1',
                'catalogId': (
                    'https://a2ui.dev/specification/v0_9/catalogs/basic/catalog.json'
                ),
            },
        },
        {
            'version': 'v0.9',
            'updateComponents': {
                'surfaceId': 'contact_form_1',
                'components': [
                    {'id': 'root', 'component': 'Card', 'child': 'form_container'},
                    {
                        'id': 'form_container',
                        'component': 'Column',
                        'children': [
                            'header_row',
                            'name_row',
                            'email_group',
                            'phone_group',
                            'pref_group',
                            'divider_1',
                            'newsletter_checkbox',
                            'submit_button',
                        ],
                        'justify': 'start',
                        'align': 'stretch',
                    },
                    {
                        'id': 'header_row',
                        'component': 'Row',
                        'children': ['header_icon', 'header_text'],
                        'align': 'center',
                    },
                    {'id': 'header_icon', 'component': 'Icon', 'name': 'mail'},
                    {
                        'id': 'header_text',
                        'component': 'Text',
                        'text': '# Contact Us',
                        'variant': 'h2',
                        'fakeProperty': 'should be allowed',
                    },
                    {
                        'id': 'name_row',
                        'component': 'Row',
                        'children': ['first_name_group', 'last_name_group'],
                        'justify': 'spaceBetween',
                    },
                    {
                        'id': 'first_name_group',
                        'component': 'Column',
                        'children': ['first_name_label', 'first_name_field'],
                        'weight': 1,
                    },
                    {
                        'id': 'first_name_label',
                        'component': 'Text',
                        'text': 'First Name',
                        'variant': 'caption',
                    },
                    {
                        'id': 'first_name_field',
                        'component': 'TextField',
                        'label': 'First Name',
                        'value': {'path': '/contact/firstName'},
                        'variant': 'shortText',
                    },
                    {
                        'id': 'last_name_group',
                        'component': 'Column',
                        'children': ['last_name_label', 'last_name_field'],
                        'weight': 1,
                    },
                    {
                        'id': 'last_name_label',
                        'component': 'Text',
                        'text': 'Last Name',
                        'variant': 'caption',
                    },
                    {
                        'id': 'last_name_field',
                        'component': 'TextField',
                        'label': 'Last Name',
                        'value': {'path': '/contact/lastName'},
                        'variant': 'shortText',
                    },
                    {
                        'id': 'email_group',
                        'component': 'Column',
                        'children': ['email_label', 'email_field'],
                    },
                    {
                        'id': 'email_label',
                        'component': 'Text',
                        'text': 'Email Address',
                        'variant': 'caption',
                    },
                    {
                        'id': 'email_field',
                        'component': 'TextField',
                        'label': 'Email',
                        'value': {'path': '/contact/email'},
                        'variant': 'shortText',
                        'checks': [
                            {
                                'condition': {
                                    'call': 'required',
                                    'args': {'value': {'path': '/contact/email'}},
                                },
                                'message': 'Email is required.',
                            },
                            {
                                'condition': {
                                    'call': 'email',
                                    'args': {'value': {'path': '/contact/email'}},
                                },
                                'message': 'Please enter a valid email address.',
                            },
                        ],
                    },
                    {
                        'id': 'phone_group',
                        'component': 'Column',
                        'children': ['phone_label', 'phone_field'],
                    },
                    {
                        'id': 'phone_label',
                        'component': 'Text',
                        'text': 'Phone Number',
                        'variant': 'caption',
                    },
                    {
                        'id': 'phone_field',
                        'component': 'TextField',
                        'label': 'Phone',
                        'value': {'path': '/contact/phone'},
                        'variant': 'shortText',
                        'checks': [{
                            'condition': {
                                'call': 'regex',
                                'args': {
                                    'value': {'path': '/contact/phone'},
                                    'pattern': '^\\d{10}$',
                                },
                            },
                            'message': 'Phone number must be 10 digits.',
                        }],
                    },
                    {
                        'id': 'pref_group',
                        'component': 'Column',
                        'children': ['pref_label', 'pref_picker'],
                    },
                    {
                        'id': 'pref_label',
                        'component': 'Text',
                        'text': 'Preferred Contact Method',
                        'variant': 'caption',
                    },
                    {
                        'id': 'pref_picker',
                        'component': 'ChoicePicker',
                        'variant': 'mutuallyExclusive',
                        'options': [
                            {'label': 'Email', 'value': 'email'},
                            {'label': 'Phone', 'value': 'phone'},
                            {'label': 'SMS', 'value': 'sms'},
                        ],
                        'value': {'path': '/contact/preference'},
                    },
                    {'id': 'divider_1', 'component': 'Divider', 'axis': 'horizontal'},
                    {
                        'id': 'newsletter_checkbox',
                        'component': 'CheckBox',
                        'label': 'Subscribe to our newsletter',
                        'value': {'path': '/contact/subscribe'},
                    },
                    {
                        'id': 'submit_button_label',
                        'component': 'Text',
                        'text': 'Send Message',
                    },
                    {
                        'id': 'submit_button',
                        'component': 'Button',
                        'child': 'submit_button_label',
                        'variant': 'primary',
                        'action': {
                            'event': {
                                'name': 'submitContactForm',
                                'context': {
                                    'formId': 'contact_form_1',
                                    'isNewsletterSubscribed': {
                                        'path': '/contact/subscribe'
                                    },
                                },
                            }
                        },
                    },
                ],
            },
        },
        {
            'version': 'v0.9',
            'updateDataModel': {
                'surfaceId': 'contact_form_1',
                'path': '/contact',
                'value': {
                    'firstName': 'John',
                    'lastName': 'Doe',
                    'email': 'john.doe@example.com',
                    'phone': '1234567890',
                    'preference': ['email'],
                    'subscribe': True,
                },
            },
        },
        {'version': 'v0.9', 'deleteSurface': {'surfaceId': 'contact_form_1'}},
    ]
    catalog.validator.validate(a2ui_message)
    print('Validation successful')
  except Exception as e:
    print(f'Failed to load {VERSION_0_9}: {e}')
    sys.exit(1)


if __name__ == '__main__':
  verify()
