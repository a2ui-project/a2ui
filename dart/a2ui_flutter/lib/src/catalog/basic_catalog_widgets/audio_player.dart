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

import 'dart:async';

import 'package:audioplayers/audioplayers.dart' as ap;
import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../model/a2ui_schemas.dart';
import '../../model/catalog_item.dart';
import '../../primitives/logging.dart';
import '../../primitives/simple_items.dart';
import '../../widgets/widget_utilities.dart';
import 'format_duration.dart';

final _schema = S.object(
  description: 'An audio player component that plays audio from a given URL.',
  properties: {
    'url': A2uiSchemas.stringReference(
      description: 'The URL of the audio to play.',
    ),
    'description': A2uiSchemas.stringReference(
      description: 'A description of the audio, such as a title or summary.',
    ),
  },
  required: ['url'],
);

/// A simple audio player.
///
/// ## Parameters:
///
/// - `url`: The URL of the audio to play.
/// - `description`: An optional description of the audio.
final audioPlayer = CatalogItem(
  name: 'AudioPlayer',
  dataSchema: _schema,
  widgetBuilder: (itemContext) {
    final data = itemContext.data as JsonMap;
    final Object? url = data['url'];
    final Object? description = data['description'];

    return BoundString(
      dataContext: itemContext.dataContext,
      value: url,
      builder: (context, urlValue) {
        return BoundString(
          dataContext: itemContext.dataContext,
          value: description,
          builder: (context, descriptionValue) {
            return _AudioPlayerWidget(
              url: urlValue,
              description: descriptionValue,
            );
          },
        );
      },
    );
  },
  exampleData: [
    () => '''
      [
        {
          "id": "root",
          "component": "AudioPlayer",
          "url": "https://upload.wikimedia.org/wikipedia/commons/d/db/Minuet_in_G_%28Beethoven%29%2C_piano.ogg",
          "description": "Beethoven — Minuet in G (public domain)"
        }
      ]
    ''',
  ],
);

class _AudioPlayerWidget extends StatefulWidget {
  const _AudioPlayerWidget({required this.url, this.description});

  final String? url;
  final String? description;

  @override
  State<_AudioPlayerWidget> createState() => _AudioPlayerWidgetState();
}

class _AudioPlayerWidgetState extends State<_AudioPlayerWidget> {
  late final ap.AudioPlayer _player;
  late final List<StreamSubscription<dynamic>> _subscriptions;
  bool _isPlaying = false;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;
  double _volume = 0.5;

  @override
  void initState() {
    super.initState();
    _player = ap.AudioPlayer();
    _player.setVolume(_volume);

    void onStreamError(Object error, StackTrace stackTrace) {
      genUiLogger.warning('Audio player stream error', error, stackTrace);
    }

    _subscriptions = [
      _player.onPlayerStateChanged.listen((state) {
        if (mounted) {
          setState(() {
            _isPlaying = state == ap.PlayerState.playing;
          });
        }
      }, onError: onStreamError),
      _player.onPositionChanged.listen((position) {
        if (mounted) {
          setState(() => _position = position);
        }
      }, onError: onStreamError),
      _player.onDurationChanged.listen((duration) {
        if (mounted) {
          setState(() => _duration = duration);
        }
      }, onError: onStreamError),
    ];

    _setSource();
  }

  @override
  void didUpdateWidget(_AudioPlayerWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.url != oldWidget.url) {
      _player.stop();
      _position = Duration.zero;
      _duration = Duration.zero;
      _setSource();
    }
  }

  void _setSource() {
    final String? url = widget.url;
    if (url != null && url.isNotEmpty) {
      _player.setSource(ap.UrlSource(url)).catchError((Object error) {
        genUiLogger.warning('Failed to set audio source: $url', error);
      });
    }
  }

  @override
  void dispose() {
    for (final StreamSubscription<dynamic> sub in _subscriptions) {
      sub.cancel();
    }
    _player.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    const contentPadding = EdgeInsets.all(12);

    return Card(
      child: Padding(
        padding: contentPadding,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (widget.description != null && widget.description!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  widget.description!,
                  style: theme.textTheme.titleSmall,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            Row(
              children: [
                IconButton(
                  icon: Icon(_isPlaying ? Icons.pause : Icons.play_arrow),
                  onPressed: widget.url != null && widget.url!.isNotEmpty
                      ? () {
                          if (_isPlaying) {
                            _player.pause();
                          } else {
                            _player.resume();
                          }
                        }
                      : null,
                ),
                Text(
                  formatDuration(_position),
                  style: theme.textTheme.bodySmall,
                ),
                Expanded(
                  child: Slider(
                    value: _duration.inMilliseconds > 0
                        ? _position.inMilliseconds
                              .clamp(0, _duration.inMilliseconds)
                              .toDouble()
                        : 0,
                    max: _duration.inMilliseconds > 0
                        ? _duration.inMilliseconds.toDouble()
                        : 1,
                    onChanged: (value) {
                      _player.seek(Duration(milliseconds: value.toInt()));
                    },
                  ),
                ),
                Text(
                  formatDuration(_duration),
                  style: theme.textTheme.bodySmall,
                ),
                const SizedBox(width: 12),
                Icon(
                  _volume == 0
                      ? Icons.volume_off
                      : _volume < 0.5
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
                    child: Slider(
                      value: _volume,
                      onChanged: (value) {
                        setState(() => _volume = value);
                        _player.setVolume(value);
                      },
                    ),
                  ),
                ),
                SizedBox(width: contentPadding.right),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
