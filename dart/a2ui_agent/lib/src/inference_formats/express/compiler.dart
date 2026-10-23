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

import '../../utils/catalogs.dart';
import '../../utils/message_reader.dart';
import 'ast.dart';
import 'schema_helper.dart';

/// The surface a block writes to when it names none with `surface(...)`.
const String defaultSurfaceId = 'default_surface';

/// The message a check written without one carries, such as `Required check
/// failed` for `?required`.
String defaultCheckMessage(String check) =>
    '${check.substring(0, 1).toUpperCase()}${check.substring(1)} check failed';

/// The helpers that belong to no catalog.
const Set<String> _reservedHelpers = {'Event', '_template'};

/// Compiles Express blocks into A2UI messages of the protocol version the
/// catalogs target.
///
/// The rules follow `conformance/agent/express/compiler.yaml`. A block that
/// assigns `root` creates its surface. A block that assigns components but
/// no `root` updates a surface created by an earlier response, so it
/// compiles to `updateComponents` alone.
///
/// For v0.9 a surface is created by `createSurface` followed by
/// `updateComponents`, and its initial data by `updateDataModel`. A surface
/// uses one catalog: the first of [catalogs], or the one its `surface(...)`
/// line names.
///
/// From v1.0 the `createSurface` carries the surface's components and
/// initial data, and a function call written as a statement of its own
/// compiles to `callRendererFunction`. A component or function call may name
/// its catalog with a `catalogId` keyword argument, and a check with a
/// `{catalogId: ...}` argument; one that names none belongs to the one
/// catalog declaring its name. With a single catalog the `createSurface`
/// names that catalog, and a component or call names it only when written
/// with a `catalogId` argument. With several, as
/// `conformance/agent/multi_catalog_formats.yaml` describes, a surface names
/// no catalog, its `surface(...)` line may not name one, and every component
/// and function call carries the id of its catalog.
class ExpressCompiler {
  /// The first of [catalogs] is the default for a surface that does not name
  /// its catalog.
  ///
  /// [catalogs] are linked with one another, as by [linkCatalogs], so a
  /// cross-catalog `$ref` resolves; the catalogs passed in are not changed.
  ExpressCompiler(List<CatalogApi> catalogs)
    : catalogs = linkCatalogs(catalogs);

  /// The catalogs this compiler knows, linked with one another.
  final List<CatalogApi> catalogs;

  late final Map<String, CatalogSchemaHelper> _catalogHelpers = {
    for (final CatalogApi catalog in catalogs)
      catalog.id: CatalogSchemaHelper(catalog),
  };

  /// The protocol version [catalogs] target.
  late final A2uiProtocolVersion _version = catalogsProtocolVersion(catalogs);

  /// Checks each compiled v1.0 message, keeping its validators across
  /// blocks.
  late final MessageReader _reader = MessageReader(catalogs);

  bool get _v1 => _version.isAtLeast(A2uiProtocolVersion.v1_0);

  /// Compiles the content of one block, without its sentinel tags.
  ///
  /// Throws [A2uiParseError] if [source] is not valid Express,
  /// [A2uiValidationError] if it names anything the catalogs do not declare,
  /// a component does not match its schema, or the block uses something the
  /// catalogs' version has no message for, and [A2uiCatalogError] if there are
  /// no [catalogs] or they target different versions.
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
    final envelopes = <Map<String, Object?>>[];
    var calls = 0;
    final callIds = <String>{};
    for (final Object operation in _operations(statements)) {
      switch (operation) {
        case _Surface():
          envelopes.addAll(_SurfaceCompiler(this, operation).compile());
        case _StandaloneCall(:final CallNode call, :final _Surface? surface):
          final Map<String, Object?> envelope = _SurfaceCompiler(
            this,
            surface ?? _Surface(defaultSurfaceId, _surfaceHelper(null)),
          ).callRendererFunction(call, ++calls);
          // The renderer answers each call by its id, so no two may share
          // one.
          final id =
              (envelope['callRendererFunction']! as Map)['functionCallId']!
                  as String;
          if (!callIds.add(id)) {
            throw A2uiValidationError(
              "Two function calls of the block have the id '$id'. Give each "
              'a functionCallId of its own.',
            );
          }
          envelopes.add(envelope);
        case String():
          envelopes.add(_envelope('deleteSurface', {'surfaceId': operation}));
      }
    }
    if (!_v1) {
      return AgentToRendererMessage.parseAll(
        envelopes,
        protocolVersion: A2uiProtocolVersion.v0_9,
      ).messages;
    }
    // Each message is checked as a renderer would check it on its own: every
    // component against the catalog it belongs to, and every call against
    // the catalog the call belongs to.
    final surfaces = <String, String?>{};
    return [
      for (final Map<String, Object?> envelope in envelopes)
        _reader.read(envelope, surfaces),
    ];
  }

  /// Groups [statements] into surfaces, deletions and, from v1.0, standalone
  /// function calls, in block order.
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
          current = _Surface(
            _stringArgument(call, 0, 'surfaceId') ?? defaultSurfaceId,
            _surfaceHelper(_stringArgument(call, 1, 'catalogId')),
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
        case ExpressionStatement(value: final CallNode call)
            when _v1 && !_declaresComponent(call):
          // A call before any surface line names the variables of the
          // default surface, which the lines after it may assign.
          current ??= _Surface(defaultSurfaceId, _surfaceHelper(null));
          operations.add(_StandaloneCall(call, current));
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
          current ??= _Surface(defaultSurfaceId, _surfaceHelper(null));
          // The default surface is created on its first assignment, even
          // when a call before it named its variables.
          if (!operations.contains(current)) operations.add(current);
          if (statement.isDataPath) {
            current.data.add((statement.target, statement.value));
          } else {
            current.symbols[statement.target] = statement.value;
          }
      }
    }
    return operations;
  }

  /// The catalog of a surface whose `surface(...)` line names [catalogId],
  /// or null for a v1.0 surface of several catalogs, which has none.
  ///
  /// Throws [A2uiValidationError] if [catalogId] names no active catalog, or
  /// names one when several v1.0 catalogs are active.
  CatalogSchemaHelper? _surfaceHelper(String? catalogId) {
    if (_v1 && catalogs.length > 1) {
      if (catalogId == null) return null;
      throw A2uiValidationError(
        "surface(...) names catalog '$catalogId', but a surface names no "
        'catalog when several catalogs are active. Leave the catalog off the '
        'line, and name it with a catalogId argument only on a component or '
        'function call whose name several catalogs declare.',
      );
    }
    if (catalogId == null) return _catalogHelpers[catalogs.first.id]!;
    return _helper(catalogId);
  }

  CatalogSchemaHelper _helper(String catalogId) =>
      _catalogHelpers[catalogId] ??
      (throw A2uiValidationError(
        "Catalog '$catalogId' is not active for this renderer. Active "
        'catalogs: ${_catalogHelpers.keys.join(', ')}.',
      ));

  /// Whether a v1.0 [call] names a component: of the catalog its `catalogId`
  /// names, or of any active catalog when it names none or one that is not
  /// active, so that the component is compiled and its catalog rejected.
  bool _declaresComponent(CallNode call) {
    final String? catalogId = _catalogArgument(call);
    if (_catalogHelpers[catalogId] case final CatalogSchemaHelper helper) {
      return helper.isComponent(call.name);
    }
    return _catalogHelpers.values.any((h) => h.isComponent(call.name));
  }

  /// The `catalogId` keyword argument of [call], which v1.0 reads; before
  /// v1.0 it is an argument like any other, so this is null.
  ///
  /// Throws [A2uiValidationError] if it is not a string literal.
  String? _catalogArgument(CallNode call) =>
      _v1 ? _stringArgument(call, -1, 'catalogId') : null;

  Map<String, Object?> _envelope(String type, Map<String, Object?> body) => {
    'version': (_v1 ? _version : A2uiProtocolVersion.v0_9).jsonValue,
    type: body,
  };
}

/// The string at [index] of [call], or under [name], or null if absent.
///
/// A negative [index] reads [name] only.
String? _stringArgument(CallNode call, int index, String name) {
  final ExpressNode? node =
      call.kwargs[name] ??
      (index >= 0 && index < call.args.length ? call.args[index] : null);
  if (node == null) return null;
  if (node case LiteralNode(value: final String value)) return value;
  throw A2uiValidationError(
    "Argument '$name' of ${call.name}(...) must be a string literal.",
  );
}

/// The component id of [call]: its `id` keyword argument, or [defaultId] when
/// it has none.
String _componentId(
  String defaultId,
  CallNode call, {
  required bool atLeastV10,
}) {
  if (!call.kwargs.containsKey('id')) return defaultId;
  final String? explicitId = _stringArgument(call, -1, 'id');
  if (explicitId == null || explicitId.isEmpty) {
    throw A2uiValidationError(
      "Argument 'id' of ${call.name}(...) must be a non-empty string literal.",
    );
  }
  if (atLeastV10 && !isValidUax31Identifier(explicitId)) {
    throw A2uiValidationError(
      "Component id '$explicitId' in ${call.name}(...) is not a valid UAX 31 "
      'identifier.',
    );
  }
  return explicitId;
}

/// The statements of one surface.
class _Surface {
  _Surface(this.surfaceId, this.helper);

  final String surfaceId;

  /// The surface's catalog, or null for a v1.0 surface of several catalogs,
  /// whose components and calls each name their own.
  final CatalogSchemaHelper? helper;

  /// Variables, in the order they are first assigned.
  final Map<String, ExpressNode> symbols = {};

  /// Data path assignments, in block order.
  final List<(String, ExpressNode)> data = [];
}

/// A function call written as a statement of its own, and the surface whose
/// variables it may name.
class _StandaloneCall {
  _StandaloneCall(this.call, this.surface);

  final CallNode call;
  final _Surface? surface;
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
  _SurfaceCompiler(this.compiler, this.surface) {
    for (final MapEntry<String, ExpressNode> symbol
        in surface.symbols.entries) {
      if (symbol.value case final CallNode call when _isComponent(call)) {
        final String id = _componentId(symbol.key, call, atLeastV10: _v1);
        if (!_usedIds.add(id)) {
          throw A2uiValidationError("Duplicate component id '$id'.");
        }
      }
    }
  }

  final ExpressCompiler compiler;
  final _Surface surface;

  /// Component ids taken so far, which an inline component's may not repeat.
  final Set<String> _usedIds = {};

  /// Variables being substituted, to catch one that refers to itself.
  final Set<String> _resolving = {};

  bool get _v1 => compiler._v1;

  /// The key of a data binding: `@path` from v1.0 and `path` before.
  String get _pathKey => _v1 ? '@path' : 'path';

  /// The key of a function call: `@call` from v1.0 and `call` before.
  String get _callKey => _v1 ? '@call' : 'call';

  /// The catalogs a name that names none is looked up in, for errors.
  String get _catalogNames => surface.helper == null
      ? 'any active catalog (${compiler._catalogHelpers.keys.join(', ')})'
      : "catalog '${surface.helper!.catalog.id}'";

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
    final Map<String, Object?> dataUpdate = compiler._envelope(
      'updateDataModel',
      {'surfaceId': surfaceId, 'path': '/', 'value': dataModel},
    );

    final bool hasComponents = surface.symbols.values.any(
      (node) => node is CallNode && _isComponent(node),
    );
    // Assigning `root` creates the surface. Components without it update a
    // surface created by an earlier response.
    final bool creates = surface.symbols.containsKey('root');
    if (!creates && !hasComponents) {
      if (surface.data.isNotEmpty) return [dataUpdate];
      throw A2uiValidationError(
        "Surface '$surfaceId' has no components and no data. Assign the top "
        "component to 'root', such as 'root = Column([...])'.",
      );
    }

    final components = <Map<String, Object?>>[];
    for (final MapEntry<String, ExpressNode> symbol
        in surface.symbols.entries) {
      final ExpressNode node = symbol.value;
      if (node is CallNode && _isComponent(node)) {
        components.addAll(_component(symbol.key, node));
      } else if (node is CallNode && !_isKnownCall(node)) {
        throw _unknownCall(node);
      } else if (symbol.key == 'root') {
        throw A2uiValidationError("'root' must be assigned a component.");
      }
    }

    if (!_v1) {
      final CatalogSchemaHelper helper = surface.helper!;
      components.forEach(helper.validator.validateComponent);
      return [
        if (creates)
          compiler._envelope('createSurface', {
            'surfaceId': surfaceId,
            'catalogId': helper.catalog.id,
          }),
        compiler._envelope('updateComponents', {
          'surfaceId': surfaceId,
          'components': components,
        }),
        if (surface.data.isNotEmpty) dataUpdate,
      ];
    }
    if (creates) {
      return [
        compiler._envelope('createSurface', {
          'surfaceId': surfaceId,
          if (surface.helper case final CatalogSchemaHelper helper)
            'catalogId': helper.catalog.id,
          'components': components,
          if (surface.data.isNotEmpty) 'dataModel': dataModel,
        }),
      ];
    }
    return [
      compiler._envelope('updateComponents', {
        'surfaceId': surfaceId,
        'components': components,
      }),
      if (surface.data.isNotEmpty) dataUpdate,
    ];
  }

  /// The `callRendererFunction` that [call], the [index]th function call of
  /// its block written as a statement of its own, compiles to.
  ///
  /// The call carries the id of its catalog, which the message requires,
  /// and the id its `functionCallId` keyword argument gives, or else
  /// `call_<index>`.
  Map<String, Object?> callRendererFunction(CallNode call, int index) {
    final String name = call.name;
    if (_reservedHelpers.contains(name)) {
      throw A2uiValidationError(
        '$name(...) is written as an argument, not as a statement of its own.',
      );
    }
    final String functionCallId =
        _stringArgument(call, -1, 'functionCallId') ?? 'call_$index';
    if (functionCallId.isEmpty) {
      throw A2uiValidationError(
        "The functionCallId of the call to '$name' is empty.",
      );
    }
    final (CatalogSchemaHelper helper, _) = _resolve(
      name,
      compiler._catalogArgument(call),
      component: false,
    );
    final hoisted = <Map<String, Object?>>[];
    final functionCall =
        _call(
              CallNode(
                name,
                call.args,
                {...call.kwargs}..remove('functionCallId'),
              ),
              _Context(idPrefix: functionCallId, hoisted: hoisted),
            )!
            as Map<String, Object?>;
    if (hoisted.isNotEmpty) {
      throw A2uiValidationError(
        "The call to '$name' written as a statement of its own passes a "
        'component, which only a component can hold.',
      );
    }
    return compiler._envelope('callRendererFunction', {
      'functionCallId': functionCallId,
      'callFunction': {
        'catalogId': helper.catalog.id,
        '@call': name,
        'args': functionCall['args'],
      },
    });
  }

  /// Whether [call] names a component of its catalog.
  bool _isComponent(CallNode call) => _v1
      ? compiler._declaresComponent(call)
      : surface.helper!.isComponent(call.name);

  /// Whether a function named [name] belongs to the catalog [catalogId]
  /// names, or else to the surface's catalog, or from v1.0 to any active
  /// catalog when the surface has none.
  bool _isFunction(String name, String? catalogId) {
    if (catalogId != null) {
      return compiler._catalogHelpers[catalogId]?.isFunction(name) ?? false;
    }
    if (surface.helper case final CatalogSchemaHelper helper when !_v1) {
      return helper.isFunction(name);
    }
    return compiler._catalogHelpers.values.any((h) => h.isFunction(name));
  }

  bool _isKnownCall(CallNode call) =>
      _isComponent(call) ||
      _isFunction(call.name, compiler._catalogArgument(call)) ||
      (_reservedHelpers.contains(call.name) &&
          compiler._catalogArgument(call) == null);

  A2uiValidationError _unknownCall(CallNode call) {
    final String name = call.name;
    final String? catalogId = compiler._catalogArgument(call);
    if (_reservedHelpers.contains(name) && catalogId != null) {
      return A2uiValidationError(
        "'$name' belongs to no catalog, so it takes no catalogId.",
      );
    }
    return A2uiValidationError(
      "'$name' is neither a component nor a function of "
      '${catalogId == null ? _catalogNames : "catalog '$catalogId'"}.',
    );
  }

  /// The catalog a component, or a function when [component] is false,
  /// named [name] belongs to, and the `catalogId` the compiled item carries.
  ///
  /// Before v1.0 that is the surface's catalog, and the item carries none.
  /// From v1.0 it is the catalog [catalogId] names, which the item carries,
  /// or else the one catalog declaring [name], which it carries when several
  /// catalogs are active.
  ///
  /// Throws [A2uiValidationError] if [catalogId] names a catalog that is not
  /// active or does not declare [name], or it names none and no active
  /// catalog, or several, declare [name].
  (CatalogSchemaHelper, String?) _resolve(
    String name,
    String? catalogId, {
    required bool component,
  }) {
    final kind = component ? 'component' : 'function';
    bool declares(CatalogSchemaHelper helper) =>
        component ? helper.isComponent(name) : helper.isFunction(name);
    if (!_v1) {
      final CatalogSchemaHelper helper = surface.helper!;
      if (!declares(helper)) {
        throw A2uiValidationError(
          "Catalog '${helper.catalog.id}' declares no $kind named '$name'.",
        );
      }
      return (helper, null);
    }
    if (catalogId != null) {
      final CatalogSchemaHelper helper = compiler._helper(catalogId);
      if (!declares(helper)) {
        throw A2uiValidationError(
          "Catalog '$catalogId' declares no $kind named '$name'.",
        );
      }
      return (helper, catalogId);
    }
    final List<CatalogSchemaHelper> declaring = [
      ...compiler._catalogHelpers.values.where(declares),
    ];
    if (declaring.length > 1) {
      throw A2uiValidationError(
        "The ${kind}s named '$name' of catalogs "
        "${declaring.map((h) => "'${h.catalog.id}'").join(' and ')} could "
        'each be meant. Name the catalog with a catalogId argument.',
      );
    }
    if (declaring.isEmpty) {
      throw A2uiValidationError(
        "No active catalog declares a $kind named '$name'. Active catalogs: "
        '${compiler._catalogHelpers.keys.join(', ')}.',
      );
    }
    final CatalogSchemaHelper helper = declaring.single;
    return (helper, surface.helper == null ? helper.catalog.id : null);
  }

  /// Compiles one component, followed by the components written inline in
  /// it.
  List<Map<String, Object?>> _component(String defaultId, CallNode call) {
    final String id = _componentId(defaultId, call, atLeastV10: _v1);
    final String name = call.name;
    final (CatalogSchemaHelper helper, String? catalogId) = _resolve(
      name,
      compiler._catalogArgument(call),
      component: true,
    );
    final List<String> properties = helper.properties(name);

    final checks = <CheckNode>[];
    final assigned = <(String, ExpressNode)>[];
    var position = 0;
    final posArgs = <ExpressNode>[];
    for (final ExpressNode arg in call.args) {
      if (_checksOf(arg) case final List<CheckNode> found) {
        checks.addAll(found);
        continue;
      }
      posArgs.add(arg);
    }
    final List<String> required = helper.requiredProperties(name);
    for (var argIdx = 0; argIdx < posArgs.length; argIdx++) {
      final ExpressNode arg = posArgs[argIdx];
      if (position >= properties.length) {
        throw A2uiValidationError(
          '$name takes at most ${properties.length} positional arguments '
          "(${properties.join(', ')}), but component '$id' passes "
          '${posArgs.length}.',
        );
      }
      if (arg is LiteralNode &&
          arg.value is num &&
          !helper.acceptsNumber(
            helper.propertySchema(name, properties[position]),
          )) {
        var moved = false;
        if (argIdx == posArgs.length - 1) {
          final numericLater = <int>[
            for (int later = position + 1; later < properties.length; later++)
              if (!call.kwargs.containsKey(properties[later]) &&
                  helper.acceptsNumber(
                    helper.propertySchema(name, properties[later]),
                  ))
                later,
          ];
          if (numericLater.length == 1) {
            final int target = numericLater.single;
            bool canSkip(int idx) {
              final String prop = properties[idx];
              if (required.contains(prop)) return false;
              return enumOf(helper.propertySchema(name, prop)) != null;
            }

            if ([
              for (int idx = position; idx < target; idx++) idx,
            ].every(canSkip)) {
              position = target;
              moved = true;
            }
          }
        }
        if (!moved &&
            !required.contains(properties[position]) &&
            helper.commonTypesLoaded) {
          throw A2uiValidationError(
            "Positional argument ${argIdx + 1} for component '$name' is a "
            'number, which is not valid for optional property '
            "'${properties[position]}'.",
          );
        }
      }
      assigned.add((properties[position++], arg));
    }
    for (final MapEntry<String, ExpressNode> kwarg in call.kwargs.entries) {
      if (kwarg.key == 'id') continue;
      if (_v1 && kwarg.key == 'catalogId') continue;
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
    if (checks.isNotEmpty && !helper.isCheckable(name)) {
      throw A2uiValidationError(
        "$name does not take checks, but component '$id' is given "
        '${checks.map((c) => '?${c.name}').join(', ')}. Remove the checks, '
        'or use a component whose schema declares checks.',
      );
    }

    final component = <String, Object?>{
      'id': id,
      'component': name,
      'catalogId': ?catalogId,
    };
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
    return {
      'condition': condition,
      'message': message ?? defaultCheckMessage(check.name),
    };
  }

  /// A check as a function call, and the message written after its
  /// arguments, if any.
  ///
  /// When the function's first parameter is `value`, the enclosing
  /// component's bound value fills it, and the written arguments fill the
  /// parameters after it. A string left over, or one written where a number
  /// or boolean belongs, is the message. From v1.0 an argument
  /// `{catalogId: ...}` names the catalog of the function.
  (Map<String, Object?>, String?) _check(CheckNode check, _Context context) {
    final String name = check.name;
    final (List<ExpressNode> written, String? catalogId) = _checkArguments(
      check,
    );
    if (!_v1 && !surface.helper!.isFunction(name)) {
      throw A2uiValidationError(
        "Check '?$name' names no function of catalog "
        "'${surface.helper!.catalog.id}'.",
      );
    }
    final (CatalogSchemaHelper helper, String? writtenCatalog) = _resolve(
      name,
      catalogId,
      component: false,
    );
    final List<String> parameters = helper.parameters(name);
    final args = <String, Object?>{};
    var first = 0;
    final Map<String, Object?>? binding = context.valueBinding;
    if (binding != null &&
        parameters.isNotEmpty &&
        parameters.first == 'value' &&
        !(written.isNotEmpty && written.first is PathNode)) {
      args['value'] = binding;
      first = 1;
    }
    String? message;
    for (final (int index, ExpressNode arg) in written.indexed) {
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
    return (
      {_callKey: name, 'catalogId': ?writtenCatalog, 'args': args},
      message,
    );
  }

  /// The arguments of [check], less the v1.0 `{catalogId: ...}` argument
  /// naming its catalog, and that catalog, or null.
  ///
  /// Throws [A2uiValidationError] if that argument's `catalogId` is not a
  /// string literal.
  (List<ExpressNode>, String?) _checkArguments(CheckNode check) {
    if (!_v1) return (check.args, null);
    for (final (int index, ExpressNode arg) in check.args.indexed) {
      if (arg case MapNode(
        entries: {'catalogId': final ExpressNode node},
      ) when arg.entries.length == 1) {
        if (node case LiteralNode(value: final String catalogId)) {
          return ([...check.args]..removeAt(index), catalogId);
        }
        throw A2uiValidationError(
          "Argument 'catalogId' of ?${check.name}(...) must be a string "
          'literal.',
        );
      }
    }
    return (check.args, null);
  }

  Object? _value(ExpressNode node, _Context context) => switch (node) {
    LiteralNode(:final Object? value) => value,
    PathNode(:final String path) => {_pathKey: path},
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
    if (node is CallNode && _isComponent(node)) {
      return _componentId(name, node, atLeastV10: _v1);
    }
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
    if (_isComponent(call)) {
      if (identical(context.hoisted, _noHoisting)) {
        throw A2uiValidationError(
          'A data path cannot be assigned a component.',
        );
      }
      final String id;
      if (call.kwargs.containsKey('id')) {
        id = _componentId(context.idPrefix, call, atLeastV10: _v1);
        if (!_usedIds.add(id)) {
          throw A2uiValidationError("Duplicate component id '$id'.");
        }
      } else {
        id = _newId(context.idPrefix);
      }
      context.hoisted.addAll(_component(id, call));
      return id;
    }
    final String? catalogId = compiler._catalogArgument(call);
    switch (name) {
      case '_template' || 'Event' when catalogId != null:
        throw _unknownCall(call);
      case '_template':
        return _template(call, context);
      case 'Event':
        return _event(call, context);
      case 'surface' || 'deleteSurface':
        throw A2uiValidationError(
          '$name(...) must be written as a statement of its own.',
        );
    }
    if (!_isFunction(name, catalogId)) throw _unknownCall(call);
    final (CatalogSchemaHelper helper, String? writtenCatalog) = _resolve(
      name,
      catalogId,
      component: false,
    );

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
      if (_v1 && kwarg.key == 'catalogId') continue;
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
    final functionCall = <String, Object?>{
      _callKey: name,
      'catalogId': ?writtenCatalog,
      'args': args,
    };
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
        final CallNode node => _isComponent(node),
        _ => false,
      },
      final CallNode node => _isComponent(node),
      _ => false,
    };
    if (!isComponent) {
      throw A2uiValidationError(
        'The second argument of _template must be a component.',
      );
    }
    // A child list template keeps the plain `path` key in every version.
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

  /// [id], the id an inline component takes from where it is written, such
  /// as `root_child` for the child of `root`.
  ///
  /// Throws [A2uiValidationError] if a variable or another inline component
  /// has it already, rather than overwriting one of the two.
  String _newId(String id) {
    if (!_usedIds.add(id)) {
      throw A2uiValidationError(
        "An inline component takes the id '$id', which another component "
        'has already. Rename the variable, or assign the inline component to '
        'a variable of its own.',
      );
    }
    return id;
  }

  bool _isBinding(Object? value) =>
      value is Map && value.length == 1 && value[_pathKey] is String;
}

/// Marks a context in which a component cannot be written.
final List<Map<String, Object?>> _noHoisting = List.unmodifiable(
  <Map<String, Object?>>[],
);

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
