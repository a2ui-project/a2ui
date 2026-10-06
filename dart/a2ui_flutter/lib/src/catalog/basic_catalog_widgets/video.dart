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

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:video_player/video_player.dart' as vp;

import '../../model/a2ui_schemas.dart';
import '../../model/catalog_item.dart';
import '../../primitives/logging.dart';
import '../../primitives/simple_items.dart';
import '../../widgets/widget_utilities.dart';
import 'format_duration.dart';

final _schema = S.object(
  description: 'A video player.',
  properties: {
    'url': A2uiSchemas.stringReference(
      description: 'The URL of the video to play.',
    ),
  },
  required: ['url'],
);

// Linux is the only platform without video_player support.
bool get _isVideoSupported =>
    defaultTargetPlatform != TargetPlatform.linux || kIsWeb;

/// A video player.
///
/// ## Parameters:
///
/// - `url`: The URL of the video to play.
final video = CatalogItem(
  name: 'Video',
  dataSchema: _schema,
  widgetBuilder: (itemContext) {
    final Object? url = (itemContext.data as JsonMap)['url'];

    return BoundString(
      dataContext: itemContext.dataContext,
      value: url,
      builder: (context, urlValue) {
        return _VideoPlayerWidget(url: urlValue);
      },
    );
  },
  exampleData: [
    () => '''
      [
        {
          "id": "root",
          "component": "Video",
          "url": "https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4"
        }
      ]
    ''',
  ],
);

class _VideoPlayerWidget extends StatefulWidget {
  const _VideoPlayerWidget({required this.url});

  final String? url;

  @override
  State<_VideoPlayerWidget> createState() => _VideoPlayerWidgetState();
}

class _VideoPlayerWidgetState extends State<_VideoPlayerWidget> {
  vp.VideoPlayerController? _controller;
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    if (!_isVideoSupported) {
      genUiLogger.warning(
        'Video playback is not supported on '
        '${defaultTargetPlatform.name}.',
      );
    }
    _initController();
  }

  @override
  void didUpdateWidget(_VideoPlayerWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.url != oldWidget.url) {
      _disposeController();
      _initController();
    }
  }

  void _initController() {
    final String? url = widget.url;
    if (url == null || url.isEmpty || !_isVideoSupported) return;

    _hasError = false;

    final Uri uri;
    try {
      uri = Uri.parse(url);
    } on FormatException {
      genUiLogger.warning('Invalid video URL: $url');
      _hasError = true;
      return;
    }

    _controller = vp.VideoPlayerController.networkUrl(uri)
      ..initialize()
          .then((_) {
            _controller?.setVolume(0.5);
            if (mounted) setState(() {});
          })
          .catchError((Object error) {
            genUiLogger.warning('Failed to initialize video player', error);
            if (mounted) setState(() => _hasError = true);
          });
  }

  void _disposeController() {
    _controller?.dispose();
    _controller = null;
  }

  @override
  void dispose() {
    _disposeController();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_isVideoSupported) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.videocam_off),
              SizedBox(width: 8),
              Text('Video playback is not supported on this platform.'),
            ],
          ),
        ),
      );
    }

    final vp.VideoPlayerController? controller = _controller;

    if (_hasError) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline),
              SizedBox(width: 8),
              Text('Failed to load video.'),
            ],
          ),
        ),
      );
    }

    if (controller == null || !controller.value.isInitialized) {
      return const AspectRatio(
        aspectRatio: 16 / 9,
        child: Center(child: CircularProgressIndicator()),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        GestureDetector(
          onTap: () => controller.value.isPlaying
              ? controller.pause()
              : controller.play(),
          child: AspectRatio(
            aspectRatio: controller.value.aspectRatio,
            child: Stack(
              alignment: Alignment.center,
              children: [
                vp.VideoPlayer(controller),
                _CenterPlayButton(controller: controller),
              ],
            ),
          ),
        ),
        _BottomControlBar(controller: controller),
      ],
    );
  }
}

class _CenterPlayButton extends StatelessWidget {
  const _CenterPlayButton({required this.controller});

  final vp.VideoPlayerController controller;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<vp.VideoPlayerValue>(
      valueListenable: controller,
      builder: (context, value, child) {
        if (value.isPlaying) return const SizedBox.shrink();
        return Container(
          decoration: const BoxDecoration(
            color: Colors.black54,
            shape: BoxShape.circle,
          ),
          padding: const EdgeInsets.all(12),
          child: const Icon(Icons.play_arrow, color: Colors.white, size: 48),
        );
      },
    );
  }
}

class _BottomControlBar extends StatelessWidget {
  const _BottomControlBar({required this.controller});

  final vp.VideoPlayerController controller;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<vp.VideoPlayerValue>(
      valueListenable: controller,
      builder: (context, value, child) {
        final Duration position = value.position;
        final Duration duration = value.duration;
        final double volume = value.volume;

        return Row(
          children: [
            IconButton(
              icon: Icon(value.isPlaying ? Icons.pause : Icons.play_arrow),
              onPressed: () {
                if (value.isPlaying) {
                  controller.pause();
                } else {
                  controller.play();
                }
              },
            ),
            Text(
              formatDuration(position),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            Expanded(
              child: Slider(
                value: duration.inMilliseconds > 0
                    ? position.inMilliseconds
                          .clamp(0, duration.inMilliseconds)
                          .toDouble()
                    : 0,
                max: duration.inMilliseconds > 0
                    ? duration.inMilliseconds.toDouble()
                    : 1,
                onChanged: (v) {
                  controller.seekTo(Duration(milliseconds: v.toInt()));
                },
              ),
            ),
            Text(
              formatDuration(duration),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(width: 12),
            Icon(
              volume == 0
                  ? Icons.volume_off
                  : volume < 0.5
                  ? Icons.volume_down
                  : Icons.volume_up,
              size: 20,
            ),
            SizedBox(
              width: 100,
              child: SliderTheme(
                data: SliderTheme.of(context).copyWith(
                  overlayShape: SliderComponentShape.noOverlay,
                  padding: EdgeInsets.zero,
                ),
                child: Slider(value: volume, onChanged: controller.setVolume),
              ),
            ),
            const SizedBox(width: 8),
          ],
        );
      },
    );
  }
}
