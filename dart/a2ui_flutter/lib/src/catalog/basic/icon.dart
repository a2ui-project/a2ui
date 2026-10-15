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
import 'package:path_parsing/path_parsing.dart';

import '../../component_implementation.dart';
import '../../component_props.dart';

const Map<String, IconData> _icons = {
  'accountCircle': Icons.account_circle,
  'add': Icons.add,
  'arrowBack': Icons.arrow_back,
  'arrowForward': Icons.arrow_forward,
  'attachFile': Icons.attach_file,
  'calendarToday': Icons.calendar_today,
  'call': Icons.call,
  'camera': Icons.camera,
  'check': Icons.check,
  'close': Icons.close,
  'delete': Icons.delete,
  'download': Icons.download,
  'edit': Icons.edit,
  'event': Icons.event,
  'error': Icons.error,
  'fastForward': Icons.fast_forward,
  'favorite': Icons.favorite,
  'favoriteOff': Icons.favorite_border,
  'folder': Icons.folder,
  'help': Icons.help,
  'home': Icons.home,
  'info': Icons.info,
  'locationOn': Icons.location_on,
  'lock': Icons.lock,
  'lockOpen': Icons.lock_open,
  'mail': Icons.mail,
  'menu': Icons.menu,
  'moreVert': Icons.more_vert,
  'moreHoriz': Icons.more_horiz,
  'notificationsOff': Icons.notifications_off,
  'notifications': Icons.notifications,
  'pause': Icons.pause,
  'payment': Icons.payment,
  'person': Icons.person,
  'phone': Icons.phone,
  'photo': Icons.photo,
  'play': Icons.play_arrow,
  'print': Icons.print,
  'refresh': Icons.refresh,
  'rewind': Icons.fast_rewind,
  'search': Icons.search,
  'send': Icons.send,
  'settings': Icons.settings,
  'share': Icons.share,
  'shoppingCart': Icons.shopping_cart,
  'skipNext': Icons.skip_next,
  'skipPrevious': Icons.skip_previous,
  'star': Icons.star,
  'starHalf': Icons.star_half,
  'starOff': Icons.star_border,
  'stop': Icons.stop,
  'upload': Icons.upload,
  'visibility': Icons.visibility,
  'visibilityOff': Icons.visibility_off,
  'volumeDown': Icons.volume_down,
  'volumeMute': Icons.volume_mute,
  'volumeOff': Icons.volume_off,
  'volumeUp': Icons.volume_up,
  'warning': Icons.warning,
};

/// Builds the basic `Icon` component: the Material icon for `name`, the
/// `svgPath` of `name` drawn on a 24 by 24 view box at the icon theme's size
/// and color, or [Icons.help_outline] for a name it does not know or a path
/// it cannot parse.
Widget buildIcon(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) {
  if (props.value('name') case {'svgPath': final String data}) {
    final Path? path = _parsePath(data);
    if (path != null) return _PathIcon(path);
  }
  return Icon(_icons[props.string('name')] ?? Icons.help_outline);
}

/// [data] as a [Path], or null when it is empty or not valid SVG path data.
Path? _parsePath(String data) {
  if (data.trim().isEmpty) return null;
  final builder = _PathBuilder();
  try {
    writeSvgPathDataToPath(data, builder);
    // path_parsing reports malformed data as a StateError.
    // ignore: avoid_catching_errors
  } on StateError {
    return null;
  }
  return builder.path;
}

class _PathBuilder extends PathProxy {
  final Path path = Path();

  @override
  void moveTo(double x, double y) => path.moveTo(x, y);

  @override
  void lineTo(double x, double y) => path.lineTo(x, y);

  @override
  void cubicTo(
    double x1,
    double y1,
    double x2,
    double y2,
    double x3,
    double y3,
  ) => path.cubicTo(x1, y1, x2, y2, x3, y3);

  @override
  void close() => path.close();
}

class _PathIcon extends StatelessWidget {
  const _PathIcon(this.path);

  final Path path;

  @override
  Widget build(BuildContext context) {
    final IconThemeData theme = IconTheme.of(context);
    final Color color = theme.color ?? const Color(0xFF000000);
    return SizedBox.square(
      dimension: theme.size ?? 24,
      child: CustomPaint(
        painter: _PathPainter(
          path,
          color.withValues(alpha: color.a * (theme.opacity ?? 1)),
        ),
      ),
    );
  }
}

class _PathPainter extends CustomPainter {
  _PathPainter(this.path, this.color);

  final Path path;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    canvas
      ..scale(size.width / 24, size.height / 24)
      ..drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_PathPainter oldDelegate) =>
      !identical(path, oldDelegate.path) || color != oldDelegate.color;
}
