// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import 'catalog.dart';

/// A JSON Pointer path to a value in the data model.
class DataBinding {
  final String path;
  DataBinding(this.path);

  factory DataBinding.fromJson(Map<String, dynamic> json) {
    return DataBinding(json['path'] as String);
  }

  Map<String, dynamic> toJson() => {'path': path};
}

/// Invokes a named function on the client.
class FunctionCall {
  final String call;
  final Map<String, dynamic> args;
  final A2uiReturnType returnType;

  FunctionCall({
    required this.call,
    required this.args,
    this.returnType = A2uiReturnType.boolean,
  });

  factory FunctionCall.fromJson(Map<String, dynamic> json) {
    return FunctionCall(
      call: json['call'] as String,
      args: json['args'] as Map<String, dynamic>? ?? {},
      returnType: A2uiReturnType.fromJson(
        json['returnType'] as String? ?? 'boolean',
      ),
    );
  }

  Map<String, dynamic> toJson() => {
    'call': call,
    'args': args,
    'returnType': returnType.jsonValue,
  };
}

/// Triggers a server-side event or a local client-side function.
class Action {
  final Map<String, dynamic>? event;
  final FunctionCall? functionCall;

  Action({this.event, this.functionCall});

  factory Action.fromJson(Map<String, dynamic> json) {
    if (json.containsKey('event')) {
      return Action(event: json['event'] as Map<String, dynamic>);
    } else if (json.containsKey('functionCall')) {
      return Action(
        functionCall: FunctionCall.fromJson(
          json['functionCall'] as Map<String, dynamic>,
        ),
      );
    }
    throw ArgumentError('Invalid action JSON: $json');
  }

  Map<String, dynamic> toJson() => {
    if (event != null) 'event': event,
    if (functionCall != null) 'functionCall': functionCall!.toJson(),
  };
}

/// A template for generating a dynamic list of children.
class ChildListTemplate {
  final String componentId;
  final String path;

  ChildListTemplate({required this.componentId, required this.path});

  factory ChildListTemplate.fromJson(Map<String, dynamic> json) {
    return ChildListTemplate(
      componentId: json['componentId'] as String,
      path: json['path'] as String,
    );
  }

  Map<String, dynamic> toJson() => {'componentId': componentId, 'path': path};
}
