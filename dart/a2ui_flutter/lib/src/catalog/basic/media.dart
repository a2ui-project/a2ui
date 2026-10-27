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

// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

/// Plays the media at [url] with a play button and a progress bar, below the
/// video frame when [showVideo] is true.
class MediaPlayer extends StatefulWidget {
  /// Creates a player for [url]. A null or empty one loads nothing, and a URL
  /// that is not `http` or `https` shows a failure.
  const MediaPlayer({
    super.key,
    required this.url,
    this.showVideo = false,
    this.posterUrl,
  });

  /// The URL of the media.
  final String? url;

  /// Whether to show the video frame.
  final bool showVideo;

  /// The URL of an `http` or `https` image the video frame shows until
  /// playback starts, unless the media fails.
  final String? posterUrl;

  @override
  State<MediaPlayer> createState() => _MediaPlayerState();
}

class _MediaPlayerState extends State<MediaPlayer> {
  VideoPlayerController? _controller;
  bool _failed = false;

  /// Whether the media at the current URL has been played.
  bool _played = false;

  @override
  void initState() {
    super.initState();
    _open();
  }

  @override
  void didUpdateWidget(MediaPlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.url == oldWidget.url) return;
    unawaited(_controller?.dispose());
    _open();
  }

  @override
  void dispose() {
    unawaited(_controller?.dispose());
    super.dispose();
  }

  void _open() {
    final String url = widget.url ?? '';
    final Uri? uri = url.startsWith('http://') || url.startsWith('https://')
        ? Uri.tryParse(url)
        : null;
    _failed = url.isNotEmpty && uri == null;
    _played = false;
    final VideoPlayerController? controller = _controller = uri == null
        ? null
        : VideoPlayerController.networkUrl(uri);
    controller?.initialize().catchError((Object _) {
      if (mounted && identical(_controller, controller)) {
        setState(() => _failed = true);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final VideoPlayerController? controller = _controller;
    if (controller == null) return _build(context, null, _failed);
    return ValueListenableBuilder(
      valueListenable: controller,
      builder: (context, value, _) =>
          _build(context, controller, _failed || value.hasError),
    );
  }

  Widget _build(
    BuildContext context,
    VideoPlayerController? controller,
    bool failed,
  ) {
    final VideoPlayerValue? value = failed ? null : controller?.value;
    final bool ready = value?.isInitialized ?? false;
    final bool playing = value?.isPlaying ?? false;
    final bool started =
        ready && (_played || playing || value!.position > Duration.zero);
    final Color errorColor = Theme.of(context).colorScheme.error;
    final Widget blank = ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: failed ? const Icon(Icons.videocam_off) : null,
    );
    final String poster = widget.posterUrl ?? '';
    final bool hasPoster =
        !failed &&
        (poster.startsWith('http://') || poster.startsWith('https://'));
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.showVideo)
          AspectRatio(
            aspectRatio: ready ? value!.aspectRatio : 16 / 9,
            child: started || (ready && !hasPoster)
                ? VideoPlayer(controller!)
                : hasPoster
                ? Image.network(
                    poster,
                    fit: BoxFit.cover,
                    excludeFromSemantics: true,
                    errorBuilder: (context, error, stackTrace) =>
                        ready ? VideoPlayer(controller!) : blank,
                  )
                : blank,
          ),
        Row(
          children: [
            if (failed)
              Icon(Icons.error_outline, color: errorColor)
            else
              IconButton(
                tooltip: playing ? 'Pause' : 'Play',
                icon: Icon(playing ? Icons.pause : Icons.play_arrow),
                onPressed: !ready
                    ? null
                    : playing
                    ? controller!.pause
                    : () {
                        _played = true;
                        unawaited(controller!.play());
                      },
              ),
            Expanded(
              child: value == null || controller == null
                  ? const LinearProgressIndicator(value: 0)
                  : VideoProgressIndicator(controller, allowScrubbing: true),
            ),
          ],
        ),
      ],
    );
  }
}
