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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../binding/node_props_accessors.dart';
import '../component_implementation.dart';

IconData _parseIcon(String? name) => switch (name) {
  'accountCircle' => Icons.account_circle,
  'add' => Icons.add,
  'arrowBack' => Icons.arrow_back,
  'arrowForward' => Icons.arrow_forward,
  'attachFile' => Icons.attach_file,
  'calendarToday' => Icons.calendar_today,
  'call' => Icons.call,
  'camera' => Icons.camera_alt,
  'check' => Icons.check,
  'close' => Icons.close,
  'delete' => Icons.delete,
  'download' => Icons.download,
  'edit' => Icons.edit,
  'event' => Icons.event,
  'error' => Icons.error,
  'fastForward' => Icons.fast_forward,
  'favorite' => Icons.favorite,
  'favoriteOff' => Icons.favorite_outline,
  'folder' => Icons.folder,
  'help' => Icons.help_outline,
  'home' => Icons.home,
  'info' => Icons.info_outline,
  'locationOn' => Icons.location_on,
  'lock' => Icons.lock_outline,
  'lockOpen' => Icons.lock_open,
  'mail' => Icons.mail_outline,
  'menu' => Icons.menu,
  'moreVert' => Icons.more_vert,
  'moreHoriz' => Icons.more_horiz,
  'notifications' => Icons.notifications,
  'notificationsOff' => Icons.notifications_off,
  'pause' => Icons.pause,
  'payment' => Icons.payment,
  'person' => Icons.person,
  'phone' => Icons.phone,
  'photo' => Icons.photo,
  'play' => Icons.play_arrow,
  'print' => Icons.print,
  'refresh' => Icons.refresh,
  'rewind' => Icons.fast_rewind,
  'search' => Icons.search,
  'send' => Icons.send,
  'settings' => Icons.settings,
  'share' => Icons.share,
  'shoppingCart' => Icons.shopping_cart,
  'skipNext' => Icons.skip_next,
  'skipPrevious' => Icons.skip_previous,
  'star' => Icons.star,
  'starHalf' => Icons.star_half,
  'starOff' => Icons.star_outline,
  'stop' => Icons.stop,
  'upload' => Icons.upload,
  'visibility' => Icons.visibility,
  'visibilityOff' => Icons.visibility_off,
  'volumeDown' => Icons.volume_down,
  'volumeMute' => Icons.volume_mute,
  'volumeOff' => Icons.volume_off,
  'volumeUp' => Icons.volume_up,
  'warning' => Icons.warning,
  _ => Icons.help_outline,
};

/// The basic catalog `Icon` component implementation.
final flutterIconImplementation = FlutterComponentImplementation(
  name: 'Icon',
  schema: Schema.combined(
    allOf: [
      CommonSchemas.checkable,
      Schema.object(
        properties: {'name': CommonSchemas.dynamicString},
        required: ['name'],
      ),
    ],
  ),
  builder: (context, node, buildChild) {
    final String? name = node.stringValue('name');
    final IconData iconData = _parseIcon(name);
    return Icon(iconData);
  },
);
