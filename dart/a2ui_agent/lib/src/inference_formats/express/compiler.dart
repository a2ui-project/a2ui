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

import 'schema_helper.dart';
import 'syntax.dart';

/// The surface a block writes to when it names none with `surface(...)`.
const String defaultSurfaceId = 'default_surface';

/// Compiles Express blocks into v0.9 A2UI messages.
///
/// The rules follow `conformance/agent/express/compiler.yaml`, with the
/// messages shaped for v0.9: a surface is created by `createSurface` followed
/// by `updateComponents`, and its initial data by `updateDataModel`.
class ExpressCompiler {
  /// The first of [catalogs] is the default for a surface that does not name
  /// its catalog.
  ExpressCompiler(this.catalogs);

  final List<SchemaCatalog> catalogs;

  late final Map<String, CatalogSchemaHelper> _helpers = {
    for (final SchemaCatalog catalog in catalogs)
      catalog.id: CatalogSchemaHelper(catalog),
  };

  /// Compiles the content of one block, without its sentinel tags.
  ///
  /// Throws [A2uiParseError] if [source] is not valid Express,
  /// [A2uiValidationError] if it names anything the catalogs do not declare,
  /// a component does not match its schema, or the block uses something v0.9
  /// has no message for, and [A2uiCatalogError] if there are no [catalogs].
  List<AgentToRendererMessage> compile(String source) {
    if (catalogs.isEmpty) {
      throw A2uiCatalogError('Compiling Express needs at least one catalog.');
    }
    final List<ExpressStatement> statements = parseExpress(source);
    if (statements.isEmpty) {
      throw A2uiParseError(
        'The Express block has no statements.',
        rawContent: source,
      );
    }
    final List<Map<String, Object?>> envelopes = [
      for (final Object operation in _operations(statements))
        ...switch (operation) {
          _Surface() => _SurfaceCompiler(operation).compile(),
          String() => [
            _envelope('deleteSurface', {'surfaceId': operation}),
          ],
          _ => throw StateError('Unexpected operation $operation'),
        },
    ];
    return AgentToRendererMessage.parseAll(
      envelopes,
      protocolVersion: A2uiProtocolVersion.v0_9,
    ).messages;
  }

  /// Groups [statements] into surfaces and deletions, in block order.
  ///
  /// A deletion is the id of the surface to delete.
  List<Object> _operations(List<ExpressStatement> statements) {
    final operations = <Object>[];
    _Surface? current;
    for (final statement in statements) {
      switch (statement) {
        case ExpressionStatement(
          value: CallNode(name: 'surface') && final CallNode call,
        ):
          final String? catalogId = _stringArgument(call, 1, 'catalogId');
          current = _Surface(
            _stringArgument(call, 0, 'surfaceId') ?? defaultSurfaceId,
            _helper(catalogId),
          );
          operations.add(current);
        case ExpressionStatement(
          value: CallNode(name: 'deleteSurface') && final CallNode call,
        ):
          operations.add(
            _stringArgument(call, 0, 'surfaceId') ??
                (throw A2uiValidationError(
                  'deleteSurface needs the id of the surface to delete.',
                )),
          );
        case ExpressionStatement(value: CallNode(:final String name)):
          throw A2uiValidationError(
            catalogs.any((c) => c.components.containsKey(name))
                ? "Component '$name' must be assigned to a variable, such as "
                      "'root = $name(...)'."
                : "A standalone call to '$name' has no message in protocol "
                      'v0.9. Only surface(...) and deleteSurface(...) may be '
                      'written as statements of their own.',
          );
        case ExpressionStatement():
          throw A2uiValidationError(
            'An expression must be assigned to a variable or a data path.',
          );
        case AssignmentStatement():
          if (current == null) {
            current = _Surface(defaultSurfaceId, _helper(null));
            operations.add(current);
          }
          if (statement.isDataPath) {
            current.data.add((statement.target, statement.value));
          } else {
            current.symbols[statement.target] = statement.value;
          }
      }
    }
    return operations;
  }

  CatalogSchemaHelper _helper(String? catalogId) {
    if (catalogId == null) return _helpers[catalogs.first.id]!;
    return _helpers[catalogId] ??
        (throw A2uiValidationError(
          "Catalog '$catalogId' is not active for this renderer. Active "
          'catalogs: ${_helpers.keys.join(', ')}.',
        ));
  }
}

/// The string at [index] of [call], or under [name], or null if absent.
String? _stringArgument(CallNode call, int index, String name) {
  final ExpressNode? node =
      call.kwargs[name] ?? (index < call.args.length ? call.args[index] : null);
  if (node == null) return null;
  if (node case LiteralNode(value: final String value)) return value;
  throw A2uiValidationError(
    "Argument '$name' of ${call.name}(...) must be a string literal.",
  );
}

Map<String, Object?> _envelope(String type, Map<String, Object?> body) => {
  'version': A2uiProtocolVersion.v0_9.jsonValue,
  type: body,
};

/// The statements of one surface.
class _Surface {
  _Surface(this.surfaceId, this.helper);

  final String surfaceId;
  final CatalogSchemaHelper helper;

  /// Variables, in the order they are first assigned.
  final Map<String, ExpressNode> symbols = {};

  /// Data path assignments, in block order.
  final List<(String, ExpressNode)> data = [];
}

/// Where a value is being compiled.
class _Context {
  _Context({
    required this.idPrefix,
    required this.hoisted,
    this.isAction = false,
    this.valueBinding,
  });

  /// The id a component written inline here takes.
  final String idPrefix;

  /// Components written inline, to emit after their parent.
  final List<Map<String, Object?>> hoisted;

  /// Whether the value fills an action slot.
  final bool isAction;

  /// The binding of the enclosing component's `value`, which a check tests.
  final Map<String, Object?>? valueBinding;

  _Context child(Object suffix) => _Context(
    idPrefix: '${idPrefix}_$suffix',
    hoisted: hoisted,
    valueBinding: valueBinding,
  );
}

class _SurfaceCompiler {
  _SurfaceCompiler(this.surface)
    : helper = surface.helper,
      _usedIds = {
        for (final MapEntry<String, ExpressNode> symbol
            in surface.symbols.entries)
          if (symbol.value case CallNode(
            :final String name,
          ) when surface.helper.isComponent(name))
            symbol.key,
      };

  final _Surface surface;
  final CatalogSchemaHelper helper;

  /// Component ids taken so far, so that an inline component gets a new one.
  final Set<String> _usedIds;

  /// Variables being substituted, to catch one that refers to itself.
  final Set<String> _resolving = {};

  String get _catalogId => helper.catalog.id;

  List<Map<String, Object?>> compile() {
    final String surfaceId = surface.surfaceId;
    final dataModel = <String, Object?>{};
    for (final (String path, ExpressNode node) in surface.data) {
      final Object? value = _value(
        node,
        _Context(idPrefix: 'data', hoisted: _noHoisting),
      );
      _setPath(dataModel, path, value);
    }
    final Map<String, Object?> dataUpdate = _envelope('updateDataModel', {
      'surfaceId': surfaceId,
      'path': '/',
      'value': dataModel,
    });

    final bool hasComponents = surface.symbols.values.any(
      (node) => node is CallNode && helper.isComponent(node.name),
    );
    if (!surface.symbols.containsKey('root')) {
      if (surface.data.isNotEmpty && !hasComponents) return [dataUpdate];
      throw A2uiValidationError(
        "Surface '$surfaceId' has no 'root'. Assign the top component to "
        "'root', such as 'root = Column([...])'.",
      );
    }

    final components = <Map<String, Object?>>[];
    for (final MapEntry<String, ExpressNode> symbol
        in surface.symbols.entries) {
      final ExpressNode node = symbol.value;
      if (node is CallNode && helper.isComponent(node.name)) {
        components.addAll(_component(symbol.key, node));
      } else if (node is CallNode && !_isKnownCall(node.name)) {
        throw _unknownCall(node.name);
      } else if (symbol.key == 'root') {
        throw A2uiValidationError("'root' must be assigned a component.");
      }
    }
    components.forEach(helper.validator.validateComponent);

    return [
      _envelope('createSurface', {
        'surfaceId': surfaceId,
        'catalogId': _catalogId,
      }),
      _envelope('updateComponents', {
        'surfaceId': surfaceId,
        'components': components,
      }),
      if (surface.data.isNotEmpty) dataUpdate,
    ];
  }

  bool _isKnownCall(String name) =>
      helper.isComponent(name) ||
      helper.isFunction(name) ||
      name == 'Event' ||
      name == '_template';

  A2uiValidationError _unknownCall(String name) => A2uiValidationError(
    "'$name' is neither a component nor a function of catalog "
    "'$_catalogId'.",
  );

  /// Compiles one component, followed by the components written inline in
  /// it.
  List<Map<String, Object?>> _component(String id, CallNode call) {
    final String name = call.name;
    final List<String> properties = helper.properties(name);

    final checks = <CheckNode>[];
    final assigned = <(String, ExpressNode)>[];
    var position = 0;
    for (final ExpressNode arg in call.args) {
      if (_checksOf(arg) case final List<CheckNode> found) {
        checks.addAll(found);
        continue;
      }
      if (position >= properties.length) {
        throw A2uiValidationError(
          '$name takes at most ${properties.length} positional arguments '
          "(${properties.join(', ')}), but component '$id' passes "
          '${call.args.length}.',
        );
      }
      assigned.add((properties[position++], arg));
    }
    for (final MapEntry<String, ExpressNode> kwarg in call.kwargs.entries) {
      if (_checksOf(kwarg.value) case final List<CheckNode> found) {
        checks.addAll(found);
        continue;
      }
      if (!properties.contains(kwarg.key)) {
        throw A2uiValidationError(
          "$name has no property '${kwarg.key}'. Its properties are: "
          '${properties.join(', ')}.',
        );
      }
      if (assigned.any((a) => a.$1 == kwarg.key)) {
        throw A2uiValidationError(
          "Property '${kwarg.key}' of component '$id' is given twice.",
        );
      }
      assigned.add((kwarg.key, kwarg.value));
    }

    final component = <String, Object?>{'id': id, 'component': name};
    final hoisted = <Map<String, Object?>>[];
    Map<String, Object?>? valueBinding;
    for (final (String property, ExpressNode node) in assigned) {
      if (node is SkippedNode) continue;
      final Map<String, Object?>? schema = helper.propertySchema(
        name,
        property,
      );
      Object? value = _value(
        node,
        _Context(
          idPrefix: '${id}_$property',
          hoisted: hoisted,
          isAction: isAction(schema),
        ),
      );
      if (value is List && expectsOptionObjects(schema)) {
        value = [
          for (final Object? option in value)
            option is String ? {'label': option, 'value': option} : option,
        ];
      }
      // A property written as null is left out, like one skipped with `_`.
      if (value == null) continue;
      component[property] = value;
      if (property == 'value' && _isBinding(value)) {
        valueBinding = value as Map<String, Object?>;
      }
    }

    if (checks.isNotEmpty) {
      final context = _Context(
        idPrefix: '${id}_checks',
        hoisted: hoisted,
        valueBinding: valueBinding,
      );
      component['checks'] = [
        for (final CheckNode check in checks) _checkRule(check, context),
      ];
    }
    return [component, ...hoisted];
  }

  /// The checks [node] holds, if it is a check or a non-empty list of them.
  List<CheckNode>? _checksOf(ExpressNode node) => switch (node) {
    CheckNode() => [node],
    ArrayNode(:final List<ExpressNode> items)
        when items.isNotEmpty && items.every((i) => i is CheckNode) =>
      items.cast<CheckNode>(),
    _ => null,
  };

  Map<String, Object?> _checkRule(CheckNode check, _Context context) {
    final (Map<String, Object?> condition, String? message) = _check(
      check,
      context,
    );
    final String name = check.name;
    return {
      'condition': condition,
      'message':
          message ??
          '${name.substring(0, 1).toUpperCase()}${name.substring(1)} check '
              'failed.',
    };
  }

  /// A check as a function call, and the message written after its
  /// arguments, if any.
  ///
  /// When the function's first parameter is `value`, the enclosing
  /// component's bound value fills it, and the written arguments fill the
  /// parameters after it. A string left over, or one written where a number
  /// or boolean belongs, is the message.
  (Map<String, Object?>, String?) _check(CheckNode check, _Context context) {
    final String name = check.name;
    if (!helper.isFunction(name)) {
      throw A2uiValidationError(
        "Check '?$name' names no function of catalog '$_catalogId'.",
      );
    }
    final List<String> parameters = helper.parameters(name);
    final args = <String, Object?>{};
    var first = 0;
    final Map<String, Object?>? binding = context.valueBinding;
    if (binding != null &&
        parameters.isNotEmpty &&
        parameters.first == 'value' &&
        !(check.args.isNotEmpty && check.args.first is PathNode)) {
      args['value'] = binding;
      first = 1;
    }
    String? message;
    for (final (int index, ExpressNode arg) in check.args.indexed) {
      final int target = index + first;
      final String? text = switch (arg) {
        LiteralNode(value: final String value) => value,
        _ => null,
      };
      if (target >= parameters.length) {
        if (text == null) {
          throw A2uiValidationError(
            "Check '?$name' takes ${parameters.length} arguments "
            "(${parameters.join(', ')}) and a message.",
          );
        }
        message = text;
        continue;
      }
      final String parameter = parameters[target];
      final Object? type = helper.parameterSchema(name, parameter)?['type'];
      if (text != null &&
          (type == 'integer' || type == 'number' || type == 'boolean')) {
        message = text;
        break;
      }
      if (arg is SkippedNode) continue;
      if (_value(arg, context.child(index)) case final Object value) {
        args[parameter] = value;
      }
    }
    return ({'call': name, 'args': args}, message);
  }

  Object? _value(ExpressNode node, _Context context) => switch (node) {
    LiteralNode(:final Object? value) => value,
    PathNode(:final String path) => {'path': path},
    SkippedNode() => throw A2uiValidationError(
      "'_' can only stand in for an argument.",
    ),
    ArrayNode(:final List<ExpressNode> items) => [
      for (final (int index, ExpressNode item) in items.indexed)
        _value(item, context.child(index)),
    ],
    MapNode(:final Map<String, ExpressNode> entries) => {
      for (final MapEntry<String, ExpressNode> entry in entries.entries)
        entry.key: _value(entry.value, context.child(entry.key)),
    },
    VariableNode(:final String name) => _variable(name, context),
    CheckNode() => _check(node, context).$1,
    CallNode() => _call(node, context),
  };

  /// A variable holding a component is its id; any other is substituted.
  Object? _variable(String name, _Context context) {
    final ExpressNode node =
        surface.symbols[name] ??
        (throw A2uiValidationError(
          "Variable '$name' is not assigned in surface "
          "'${surface.surfaceId}'.",
        ));
    if (node is CallNode && helper.isComponent(node.name)) return name;
    if (!_resolving.add(name)) {
      throw A2uiValidationError("Variable '$name' refers to itself.");
    }
    try {
      return _value(node, context);
    } finally {
      _resolving.remove(name);
    }
  }

  Object? _call(CallNode call, _Context context) {
    final String name = call.name;
    if (helper.isComponent(name)) {
      if (identical(context.hoisted, _noHoisting)) {
        throw A2uiValidationError(
          'A data path cannot be assigned a component.',
        );
      }
      final String id = _newId(context.idPrefix);
      context.hoisted.addAll(_component(id, call));
      return id;
    }
    switch (name) {
      case '_template':
        return _template(call, context);
      case 'Event':
        return _event(call, context);
      case 'surface' || 'deleteSurface':
        throw A2uiValidationError(
          '$name(...) must be written as a statement of its own.',
        );
    }
    if (!helper.isFunction(name)) throw _unknownCall(name);

    final List<String> parameters = helper.parameters(name);
    if (call.args.length > parameters.length) {
      throw A2uiValidationError(
        "Function '$name' takes at most ${parameters.length} arguments "
        "(${parameters.join(', ')}), but ${call.args.length} are given.",
      );
    }
    final args = <String, Object?>{};
    for (final (int index, ExpressNode arg) in call.args.indexed) {
      if (arg is SkippedNode) continue;
      final String parameter = parameters[index];
      if (_value(arg, context.child(parameter)) case final Object value) {
        args[parameter] = value;
      }
    }
    for (final MapEntry<String, ExpressNode> kwarg in call.kwargs.entries) {
      if (!parameters.contains(kwarg.key)) {
        throw A2uiValidationError(
          "Function '$name' has no parameter '${kwarg.key}'. Its parameters "
          "are: ${parameters.join(', ')}.",
        );
      }
      // The parameter is known, so a positional argument at its index is
      // the same parameter given a second time.
      if (parameters.indexOf(kwarg.key) < call.args.length) {
        throw A2uiValidationError(
          "Parameter '${kwarg.key}' of '$name' is given twice.",
        );
      }
      if (kwarg.value is SkippedNode) continue;
      if (_value(kwarg.value, context.child(kwarg.key))
          case final Object value) {
        args[kwarg.key] = value;
      }
    }
    final functionCall = <String, Object?>{'call': name, 'args': args};
    return context.isAction ? {'functionCall': functionCall} : functionCall;
  }

  /// `_template(path, component)`: a child list generated from a list in the
  /// data model.
  Map<String, Object?> _template(CallNode call, _Context context) {
    if (call.args.length != 2 || call.kwargs.isNotEmpty) {
      throw A2uiParseError(
        '_template takes exactly two arguments: a data path and the '
        'component to repeat, such as _template(\$/items, itemRow).',
      );
    }
    final ExpressNode path = call.args[0];
    if (path is! PathNode) {
      throw A2uiParseError(
        'The first argument of _template must be a data path starting with '
        r"'$'.",
      );
    }
    final ExpressNode template = call.args[1];
    final bool isComponent = switch (template) {
      VariableNode(:final String name) => switch (surface.symbols[name]) {
        CallNode(name: final String type) => helper.isComponent(type),
        _ => false,
      },
      CallNode(:final String name) => helper.isComponent(name),
      _ => false,
    };
    if (!isComponent) {
      throw A2uiValidationError(
        'The second argument of _template must be a component.',
      );
    }
    return {
      'componentId': _value(template, context.child('template')),
      'path': path.path,
    };
  }

  /// `Event(name, context?)`: an action sent to the agent.
  Map<String, Object?> _event(CallNode call, _Context context) {
    ExpressNode? argument(int index, String name) =>
        call.kwargs[name] ??
        (index < call.args.length ? call.args[index] : null);

    final ExpressNode? nameNode = argument(0, 'name');
    final Object? eventName = nameNode == null
        ? null
        : _value(nameNode, context.child('name'));
    if (eventName is! String) {
      throw A2uiValidationError('Event needs a name, such as Event("submit").');
    }
    final ExpressNode? contextNode = argument(1, 'context');
    final Object? eventContext = contextNode == null
        ? null
        : _value(contextNode, context.child('context'));
    if (eventContext != null && eventContext is! Map) {
      throw A2uiValidationError(
        'The context of Event must be a map, such as '
        'Event("submit", {id: \$/item/id}).',
      );
    }
    return {
      'event': {
        'name': eventName,
        if (eventContext is Map && eventContext.isNotEmpty)
          'context': eventContext,
      },
    };
  }

  String _newId(String prefix) {
    var id = prefix;
    for (var n = 2; _usedIds.contains(id); n++) {
      id = '${prefix}_$n';
    }
    _usedIds.add(id);
    return id;
  }
}

/// Marks a context in which a component cannot be written.
final List<Map<String, Object?>> _noHoisting = List.unmodifiable(
  <Map<String, Object?>>[],
);

bool _isBinding(Object? value) =>
    value is Map && value.length == 1 && value['path'] is String;

/// Sets [value] at [path], a data path such as `/user/name`, in [model].
void _setPath(Map<String, Object?> model, String path, Object? value) {
  final List<String> keys = [
    for (final String key in path.split('/'))
      if (key.isNotEmpty) key,
  ];
  if (keys.isEmpty) {
    // Every map the compiler builds has string keys, so this is the only
    // check needed.
    if (value is! Map<String, Object?>) {
      throw A2uiValidationError(
        r'Only a map can be assigned to the whole data model, $/.',
      );
    }
    model.addAll(value);
    return;
  }
  var current = model;
  for (final String key in keys.take(keys.length - 1)) {
    // A map assigned earlier is copied rather than written into: its value
    // type may be narrower than Object?, as it is for an Event's map.
    final Object? existing = current[key];
    final child = existing is Map
        ? Map<String, Object?>.from(existing)
        : <String, Object?>{};
    current = current[key] = child;
  }
  current[keys.last] = value;
}
