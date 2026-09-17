// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../model/a2ui_schemas.dart';
import '../../model/catalog_item.dart';

import '../../primitives/simple_items.dart';
import '../../widgets/widget_utilities.dart';

final _schema = S.object(
  description: 'Displays an icon from a set of available icons.',
  properties: {
    'name': A2uiSchemas.stringReference(
      description:
          '''The name of the icon to display. This can be a literal string or a reference to a value in the data model ('path', e.g. '/icon/name').''',
      enumValues: AvailableIcons.allAvailable,
    ),
  },
  required: ['name'],
);

enum AvailableIcons {
  accountCircle(Icons.account_circle),
  add(Icons.add),
  arrowBack(Icons.arrow_back),
  arrowForward(Icons.arrow_forward),
  attachFile(Icons.attach_file),
  calendarToday(Icons.calendar_today),
  call(Icons.call),
  camera(Icons.camera_alt),
  check(Icons.check),
  close(Icons.close),
  delete(Icons.delete),
  download(Icons.download),
  edit(Icons.edit),
  error(Icons.error),
  event(Icons.event),
  favorite(Icons.favorite),
  favoriteOff(Icons.favorite_outline),
  folder(Icons.folder),
  help(Icons.help),
  home(Icons.home),
  info(Icons.info_outline),
  locationOn(Icons.location_on),
  lock(Icons.lock_outline),
  lockOpen(Icons.lock_open_outlined),
  mail(Icons.mail_outline),
  menu(Icons.menu),
  moreHoriz(Icons.more_horiz),
  moreVert(Icons.more_vert),
  notifications(Icons.notifications),
  notificationsOff(Icons.notifications_none),
  payment(Icons.payment),
  person(Icons.person),
  phone(Icons.phone),
  photo(Icons.photo),
  print(Icons.print),
  refresh(Icons.refresh),
  search(Icons.search),
  send(Icons.send),
  settings(Icons.settings),
  share(Icons.share),
  shoppingCart(Icons.shopping_cart),
  star(Icons.star),
  starHalf(Icons.star_half_outlined),
  starOff(Icons.star_outline),
  upload(Icons.upload),
  visibility(Icons.visibility),
  visibilityOff(Icons.visibility_off),
  warning(Icons.warning);

  const AvailableIcons(this.iconData);

  final IconData iconData;

  static List<String> get allAvailable =>
      values.map<String>((icon) => icon.name).toList();

  static AvailableIcons? fromName(String name) {
    for (final AvailableIcons iconName in AvailableIcons.values) {
      if (iconName.name == name) {
        return iconName;
      }
    }
    return null;
  }
}

/// A standard icon.
///
/// ### Parameters:
///
/// - `name`: The name of the icon to display.
final icon = CatalogItem(
  name: 'Icon',
  dataSchema: _schema,
  widgetBuilder: (itemContext) {
    return BoundString(
      dataContext: itemContext.dataContext,
      value: (itemContext.data as JsonMap)['name'],
      builder: (context, String? currentValue) {
        final String iconName = currentValue ?? '';
        final IconData icon =
            AvailableIcons.fromName(iconName)?.iconData ?? Icons.broken_image;
        return Icon(icon);
      },
    );
  },
  exampleData: [
    () => '''
      [
        {
          "id": "root",
          "component": "Icon",
          "name": "add"
        }
      ]
    ''',
  ],
);
