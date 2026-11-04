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

// The Dart side of the agent function scenario, through the example's
// session: a call leaves as a `callAgentFunction` message, the reply's
// `agentFunctionResponse` settles it, and one that the agent fails rejects
// with the agent's error while the surface stays.

import 'dart:async';
import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter_example/chat_app.dart';
import 'package:a2ui_flutter_example/chat_session.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_client.dart';
import 'replies.dart';

/// Opens a session with a surface `s`, calls [function] on the agent, and
/// returns the `callAgentFunction` body the session sent with the pending
/// result.
Future<
  ({
    ChatSession session,
    ControlledClient client,
    Map<Object?, Object?> call,
    Future<Object?> result,
  })
>
callAgent(
  WidgetTester tester,
  String function,
  Map<String, Object?> args,
) async {
  final client = ControlledClient();
  final session = ChatSession(client: client);
  addTearDown(session.dispose);
  await tester.pumpWidget(ChatApp(session: session));

  unawaited(session.send('Make a surface.'));
  await tester.pump();
  client.reply.add(block([createSurface('s'), rootComponent('s', 'Ready')]));
  await client.reply.close();
  await tester.pump();
  expect(find.text('Ready'), findsOneWidget);

  final Future<Object?> result = session.processor.callAgentFunction(
    's',
    FunctionCall(call: function, args: args),
  );
  // The call's outcome is read by the test; an unawaited rejection would
  // otherwise fail it as an unhandled error.
  unawaited(result.then((_) {}, onError: (_) {}));
  await tester.pump();

  expect(client.requests, hasLength(2));
  final sent = jsonDecode(client.requests[1].last.text) as Map;
  final messages = (sent['a2ui'] as Map)['messages'] as List;
  final call =
      (messages.single as Map)['callAgentFunction'] as Map<Object?, Object?>;
  expect(call, {
    'surfaceId': 's',
    'functionCallId': isA<String>(),
    'callFunction': {'@call': function, 'args': args},
  });
  return (session: session, client: client, call: call, result: result);
}

/// Answers the pending call with [response], the body of an
/// `agentFunctionResponse` without its `functionCallId`.
Future<void> answer(
  WidgetTester tester,
  ControlledClient client,
  Map<Object?, Object?> call,
  Map<String, Object?> response,
) async {
  client.reply.add(
    block([
      {
        'version': '1.0',
        'agentFunctionResponse': {
          'functionCallId': call['functionCallId'],
          ...response,
        },
      },
    ]),
  );
  await client.reply.close();
  await tester.pump();
}

void main() {
  testWidgets('a call the agent answers resolves to its value', (tester) async {
    final (
      :ChatSession session,
      :ControlledClient client,
      :Map<Object?, Object?> call,
      :Future<Object?> result,
    ) = await callAgent(tester, 'lookupPrice', {
      'sku': 'sku-100',
    });

    await answer(tester, client, call, {'value': r'$10.00'});

    expect(await result, r'$10.00');
    expect(errorsOf(session), isEmpty);
    expect(find.text('Ready'), findsOneWidget);
    // The response settled the call; nothing else went to the model.
    expect(client.requests, hasLength(2));
  });

  testWidgets('a call the agent fails rejects with the agent\'s error', (
    tester,
  ) async {
    final (
      :ChatSession session,
      :ControlledClient client,
      :Map<Object?, Object?> call,
      :Future<Object?> result,
    ) = await callAgent(
      tester,
      'failingLookup',
      {},
    );

    await answer(tester, client, call, {
      'error': {
        'code': 'EXECUTION_ERROR',
        'message': 'failingLookup always fails.',
      },
    });

    await expectLater(
      result,
      throwsA(
        isA<A2uiRpcError>()
            .having((e) => e.rpcCode, 'rpcCode', RpcErrorCode.executionError)
            .having((e) => e.message, 'message', contains('always fails')),
      ),
    );
    // The surface stays, and the failure is the caller's to handle: the
    // session reports nothing and sends nothing more.
    expect(find.text('Ready'), findsOneWidget);
    expect(errorsOf(session), isEmpty);
    expect(client.requests, hasLength(2));
  });
}
