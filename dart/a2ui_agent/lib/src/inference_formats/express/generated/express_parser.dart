// Generated from Express.g4 by ANTLR 4.13.2
// ignore_for_file: unused_import, unused_local_variable, prefer_single_quotes
import 'package:antlr4/antlr4.dart';

const int RULE_program = 0,
    RULE_statement = 1,
    RULE_assignment = 2,
    RULE_expression = 3,
    RULE_array = 4,
    RULE_map = 5,
    RULE_map_entry = 6,
    RULE_path = 7,
    RULE_check = 8,
    RULE_call = 9,
    RULE_function_name = 10,
    RULE_arg = 11,
    RULE_named_arg = 12,
    RULE_variable = 13,
    RULE_literal = 14,
    RULE_identifier = 15,
    RULE_string = 16;

class ExpressParser extends Parser {
  static final checkVersion = () =>
      RuntimeMetaData.checkVersion('4.13.2', RuntimeMetaData.VERSION);
  static const int TOKEN_EOF = IntStream.EOF;

  static final List<DFA> _decisionToDFA = List.generate(
    _ATN.numberOfDecisions,
    (i) => DFA(_ATN.getDecisionState(i), i),
  );
  static final PredictionContextCache _sharedContextCache =
      PredictionContextCache();
  static const int TOKEN_T__0 = 1,
      TOKEN_T__1 = 2,
      TOKEN_T__2 = 3,
      TOKEN_T__3 = 4,
      TOKEN_T__4 = 5,
      TOKEN_T__5 = 6,
      TOKEN_T__6 = 7,
      TOKEN_T__7 = 8,
      TOKEN_T__8 = 9,
      TOKEN_T__9 = 10,
      TOKEN_T__10 = 11,
      TOKEN_RAW_TRIPLE_STRING = 12,
      TOKEN_TRIPLE_STRING = 13,
      TOKEN_RAW_STRING = 14,
      TOKEN_STANDARD_STRING = 15,
      TOKEN_PATH = 16,
      TOKEN_CHECK = 17,
      TOKEN_NUMBER = 18,
      TOKEN_BOOLEAN = 19,
      TOKEN_IDENTIFIER = 20,
      TOKEN_SYSTEM_IDENTIFIER = 21,
      TOKEN_COMMENT = 22,
      TOKEN_BLOCK_COMMENT = 23,
      TOKEN_SEMICOLON = 24,
      TOKEN_WS = 25;

  @override
  final List<String> ruleNames = [
    'program',
    'statement',
    'assignment',
    'expression',
    'array',
    'map',
    'map_entry',
    'path',
    'check',
    'call',
    'function_name',
    'arg',
    'named_arg',
    'variable',
    'literal',
    'identifier',
    'string',
  ];

  static final List<String?> _LITERAL_NAMES = [
    null,
    "'='",
    "'['",
    "','",
    "']'",
    "'{'",
    "'}'",
    "':'",
    "'('",
    "')'",
    "'_'",
    "'null'",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "';'",
  ];
  static final List<String?> _SYMBOLIC_NAMES = [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "RAW_TRIPLE_STRING",
    "TRIPLE_STRING",
    "RAW_STRING",
    "STANDARD_STRING",
    "PATH",
    "CHECK",
    "NUMBER",
    "BOOLEAN",
    "IDENTIFIER",
    "SYSTEM_IDENTIFIER",
    "COMMENT",
    "BLOCK_COMMENT",
    "SEMICOLON",
    "WS",
  ];
  static final Vocabulary VOCABULARY = VocabularyImpl(
    _LITERAL_NAMES,
    _SYMBOLIC_NAMES,
  );

  @override
  Vocabulary get vocabulary {
    return VOCABULARY;
  }

  @override
  String get grammarFileName => 'Express.g4';

  @override
  List<int> get serializedATN => _serializedATN;

  @override
  ATN getATN() {
    return _ATN;
  }

  ExpressParser(TokenStream input) : super(input) {
    interpreter = ParserATNSimulator(
      this,
      _ATN,
      _decisionToDFA,
      _sharedContextCache,
    );
  }

  ProgramContext program() {
    dynamic _localctx = ProgramContext(context, state);
    enterRule(_localctx, 0, RULE_program);
    int _la;
    try {
      enterOuterAlt(_localctx, 1);
      state = 37;
      errorHandler.sync(this);
      _la = tokenStream.LA(1)!;
      while ((((_la) & ~0x3f) == 0 && ((1 << _la) & 4193316) != 0)) {
        state = 34;
        statement();
        state = 39;
        errorHandler.sync(this);
        _la = tokenStream.LA(1)!;
      }
      state = 40;
      match(TOKEN_EOF);
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  StatementContext statement() {
    dynamic _localctx = StatementContext(context, state);
    enterRule(_localctx, 2, RULE_statement);
    try {
      state = 44;
      errorHandler.sync(this);
      switch (interpreter!.adaptivePredict(tokenStream, 1, context)) {
        case 1:
          enterOuterAlt(_localctx, 1);
          state = 42;
          assignment();
          break;
        case 2:
          enterOuterAlt(_localctx, 2);
          state = 43;
          expression();
          break;
      }
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  AssignmentContext assignment() {
    dynamic _localctx = AssignmentContext(context, state);
    enterRule(_localctx, 4, RULE_assignment);
    try {
      enterOuterAlt(_localctx, 1);
      state = 48;
      errorHandler.sync(this);
      switch (tokenStream.LA(1)!) {
        case TOKEN_IDENTIFIER:
          state = 46;
          identifier();
          break;
        case TOKEN_PATH:
          state = 47;
          path();
          break;
        default:
          throw NoViableAltException(this);
      }
      state = 50;
      match(TOKEN_T__0);
      state = 51;
      expression();
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  ExpressionContext expression() {
    dynamic _localctx = ExpressionContext(context, state);
    enterRule(_localctx, 6, RULE_expression);
    try {
      state = 60;
      errorHandler.sync(this);
      switch (interpreter!.adaptivePredict(tokenStream, 3, context)) {
        case 1:
          enterOuterAlt(_localctx, 1);
          state = 53;
          array();
          break;
        case 2:
          enterOuterAlt(_localctx, 2);
          state = 54;
          map();
          break;
        case 3:
          enterOuterAlt(_localctx, 3);
          state = 55;
          path();
          break;
        case 4:
          enterOuterAlt(_localctx, 4);
          state = 56;
          check();
          break;
        case 5:
          enterOuterAlt(_localctx, 5);
          state = 57;
          call();
          break;
        case 6:
          enterOuterAlt(_localctx, 6);
          state = 58;
          variable();
          break;
        case 7:
          enterOuterAlt(_localctx, 7);
          state = 59;
          literal();
          break;
      }
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  ArrayContext array() {
    dynamic _localctx = ArrayContext(context, state);
    enterRule(_localctx, 8, RULE_array);
    int _la;
    try {
      int _alt;
      enterOuterAlt(_localctx, 1);
      state = 62;
      match(TOKEN_T__1);
      state = 74;
      errorHandler.sync(this);
      _la = tokenStream.LA(1)!;
      if ((((_la) & ~0x3f) == 0 && ((1 << _la) & 4193316) != 0)) {
        state = 63;
        expression();
        state = 68;
        errorHandler.sync(this);
        _alt = interpreter!.adaptivePredict(tokenStream, 4, context);
        while (_alt != 2 && _alt != ATN.INVALID_ALT_NUMBER) {
          if (_alt == 1) {
            state = 64;
            match(TOKEN_T__2);
            state = 65;
            expression();
          }
          state = 70;
          errorHandler.sync(this);
          _alt = interpreter!.adaptivePredict(tokenStream, 4, context);
        }
        state = 72;
        errorHandler.sync(this);
        _la = tokenStream.LA(1)!;
        if (_la == TOKEN_T__2) {
          state = 71;
          match(TOKEN_T__2);
        }
      }

      state = 76;
      match(TOKEN_T__3);
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  MapContext map() {
    dynamic _localctx = MapContext(context, state);
    enterRule(_localctx, 10, RULE_map);
    int _la;
    try {
      int _alt;
      enterOuterAlt(_localctx, 1);
      state = 78;
      match(TOKEN_T__4);
      state = 90;
      errorHandler.sync(this);
      _la = tokenStream.LA(1)!;
      if ((((_la) & ~0x3f) == 0 && ((1 << _la) & 1110016) != 0)) {
        state = 79;
        map_entry();
        state = 84;
        errorHandler.sync(this);
        _alt = interpreter!.adaptivePredict(tokenStream, 7, context);
        while (_alt != 2 && _alt != ATN.INVALID_ALT_NUMBER) {
          if (_alt == 1) {
            state = 80;
            match(TOKEN_T__2);
            state = 81;
            map_entry();
          }
          state = 86;
          errorHandler.sync(this);
          _alt = interpreter!.adaptivePredict(tokenStream, 7, context);
        }
        state = 88;
        errorHandler.sync(this);
        _la = tokenStream.LA(1)!;
        if (_la == TOKEN_T__2) {
          state = 87;
          match(TOKEN_T__2);
        }
      }

      state = 92;
      match(TOKEN_T__5);
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  Map_entryContext map_entry() {
    dynamic _localctx = Map_entryContext(context, state);
    enterRule(_localctx, 12, RULE_map_entry);
    try {
      enterOuterAlt(_localctx, 1);
      state = 96;
      errorHandler.sync(this);
      switch (tokenStream.LA(1)!) {
        case TOKEN_IDENTIFIER:
          state = 94;
          identifier();
          break;
        case TOKEN_RAW_TRIPLE_STRING:
        case TOKEN_TRIPLE_STRING:
        case TOKEN_RAW_STRING:
        case TOKEN_STANDARD_STRING:
          state = 95;
          string();
          break;
        default:
          throw NoViableAltException(this);
      }
      state = 98;
      match(TOKEN_T__6);
      state = 99;
      expression();
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  PathContext path() {
    dynamic _localctx = PathContext(context, state);
    enterRule(_localctx, 14, RULE_path);
    try {
      enterOuterAlt(_localctx, 1);
      state = 101;
      match(TOKEN_PATH);
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  CheckContext check() {
    dynamic _localctx = CheckContext(context, state);
    enterRule(_localctx, 16, RULE_check);
    int _la;
    try {
      int _alt;
      enterOuterAlt(_localctx, 1);
      state = 103;
      match(TOKEN_CHECK);
      state = 119;
      errorHandler.sync(this);
      _la = tokenStream.LA(1)!;
      if (_la == TOKEN_T__7) {
        state = 104;
        match(TOKEN_T__7);
        state = 116;
        errorHandler.sync(this);
        _la = tokenStream.LA(1)!;
        if ((((_la) & ~0x3f) == 0 && ((1 << _la) & 4193316) != 0)) {
          state = 105;
          expression();
          state = 110;
          errorHandler.sync(this);
          _alt = interpreter!.adaptivePredict(tokenStream, 11, context);
          while (_alt != 2 && _alt != ATN.INVALID_ALT_NUMBER) {
            if (_alt == 1) {
              state = 106;
              match(TOKEN_T__2);
              state = 107;
              expression();
            }
            state = 112;
            errorHandler.sync(this);
            _alt = interpreter!.adaptivePredict(tokenStream, 11, context);
          }
          state = 114;
          errorHandler.sync(this);
          _la = tokenStream.LA(1)!;
          if (_la == TOKEN_T__2) {
            state = 113;
            match(TOKEN_T__2);
          }
        }

        state = 118;
        match(TOKEN_T__8);
      }
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  CallContext call() {
    dynamic _localctx = CallContext(context, state);
    enterRule(_localctx, 18, RULE_call);
    int _la;
    try {
      int _alt;
      enterOuterAlt(_localctx, 1);
      state = 121;
      function_name();
      state = 122;
      match(TOKEN_T__7);
      state = 134;
      errorHandler.sync(this);
      _la = tokenStream.LA(1)!;
      if ((((_la) & ~0x3f) == 0 && ((1 << _la) & 4193316) != 0)) {
        state = 123;
        arg();
        state = 128;
        errorHandler.sync(this);
        _alt = interpreter!.adaptivePredict(tokenStream, 15, context);
        while (_alt != 2 && _alt != ATN.INVALID_ALT_NUMBER) {
          if (_alt == 1) {
            state = 124;
            match(TOKEN_T__2);
            state = 125;
            arg();
          }
          state = 130;
          errorHandler.sync(this);
          _alt = interpreter!.adaptivePredict(tokenStream, 15, context);
        }
        state = 132;
        errorHandler.sync(this);
        _la = tokenStream.LA(1)!;
        if (_la == TOKEN_T__2) {
          state = 131;
          match(TOKEN_T__2);
        }
      }

      state = 136;
      match(TOKEN_T__8);
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  Function_nameContext function_name() {
    dynamic _localctx = Function_nameContext(context, state);
    enterRule(_localctx, 20, RULE_function_name);
    try {
      state = 140;
      errorHandler.sync(this);
      switch (tokenStream.LA(1)!) {
        case TOKEN_IDENTIFIER:
          enterOuterAlt(_localctx, 1);
          state = 138;
          identifier();
          break;
        case TOKEN_SYSTEM_IDENTIFIER:
          enterOuterAlt(_localctx, 2);
          state = 139;
          match(TOKEN_SYSTEM_IDENTIFIER);
          break;
        default:
          throw NoViableAltException(this);
      }
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  ArgContext arg() {
    dynamic _localctx = ArgContext(context, state);
    enterRule(_localctx, 22, RULE_arg);
    try {
      state = 144;
      errorHandler.sync(this);
      switch (interpreter!.adaptivePredict(tokenStream, 19, context)) {
        case 1:
          enterOuterAlt(_localctx, 1);
          state = 142;
          named_arg();
          break;
        case 2:
          enterOuterAlt(_localctx, 2);
          state = 143;
          expression();
          break;
      }
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  Named_argContext named_arg() {
    dynamic _localctx = Named_argContext(context, state);
    enterRule(_localctx, 24, RULE_named_arg);
    try {
      enterOuterAlt(_localctx, 1);
      state = 146;
      identifier();
      state = 147;
      match(TOKEN_T__0);
      state = 148;
      expression();
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  VariableContext variable() {
    dynamic _localctx = VariableContext(context, state);
    enterRule(_localctx, 26, RULE_variable);
    try {
      state = 152;
      errorHandler.sync(this);
      switch (tokenStream.LA(1)!) {
        case TOKEN_T__9:
          enterOuterAlt(_localctx, 1);
          state = 150;
          match(TOKEN_T__9);
          break;
        case TOKEN_IDENTIFIER:
          enterOuterAlt(_localctx, 2);
          state = 151;
          identifier();
          break;
        default:
          throw NoViableAltException(this);
      }
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  LiteralContext literal() {
    dynamic _localctx = LiteralContext(context, state);
    enterRule(_localctx, 28, RULE_literal);
    try {
      state = 158;
      errorHandler.sync(this);
      switch (tokenStream.LA(1)!) {
        case TOKEN_RAW_TRIPLE_STRING:
        case TOKEN_TRIPLE_STRING:
        case TOKEN_RAW_STRING:
        case TOKEN_STANDARD_STRING:
          enterOuterAlt(_localctx, 1);
          state = 154;
          string();
          break;
        case TOKEN_NUMBER:
          enterOuterAlt(_localctx, 2);
          state = 155;
          match(TOKEN_NUMBER);
          break;
        case TOKEN_BOOLEAN:
          enterOuterAlt(_localctx, 3);
          state = 156;
          match(TOKEN_BOOLEAN);
          break;
        case TOKEN_T__10:
          enterOuterAlt(_localctx, 4);
          state = 157;
          match(TOKEN_T__10);
          break;
        default:
          throw NoViableAltException(this);
      }
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  IdentifierContext identifier() {
    dynamic _localctx = IdentifierContext(context, state);
    enterRule(_localctx, 30, RULE_identifier);
    try {
      enterOuterAlt(_localctx, 1);
      state = 160;
      match(TOKEN_IDENTIFIER);
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  StringContext string() {
    dynamic _localctx = StringContext(context, state);
    enterRule(_localctx, 32, RULE_string);
    int _la;
    try {
      enterOuterAlt(_localctx, 1);
      state = 162;
      _la = tokenStream.LA(1)!;
      if (!((((_la) & ~0x3f) == 0 && ((1 << _la) & 61440) != 0))) {
        errorHandler.recoverInline(this);
      } else {
        if (tokenStream.LA(1)! == IntStream.EOF) matchedEOF = true;
        errorHandler.reportMatch(this);
        consume();
      }
    } on RecognitionException catch (re) {
      _localctx.exception = re;
      errorHandler.reportError(this, re);
      errorHandler.recover(this, re);
    } finally {
      exitRule();
    }
    return _localctx;
  }

  static const List<int> _serializedATN = [
    4,
    1,
    25,
    165,
    2,
    0,
    7,
    0,
    2,
    1,
    7,
    1,
    2,
    2,
    7,
    2,
    2,
    3,
    7,
    3,
    2,
    4,
    7,
    4,
    2,
    5,
    7,
    5,
    2,
    6,
    7,
    6,
    2,
    7,
    7,
    7,
    2,
    8,
    7,
    8,
    2,
    9,
    7,
    9,
    2,
    10,
    7,
    10,
    2,
    11,
    7,
    11,
    2,
    12,
    7,
    12,
    2,
    13,
    7,
    13,
    2,
    14,
    7,
    14,
    2,
    15,
    7,
    15,
    2,
    16,
    7,
    16,
    1,
    0,
    5,
    0,
    36,
    8,
    0,
    10,
    0,
    12,
    0,
    39,
    9,
    0,
    1,
    0,
    1,
    0,
    1,
    1,
    1,
    1,
    3,
    1,
    45,
    8,
    1,
    1,
    2,
    1,
    2,
    3,
    2,
    49,
    8,
    2,
    1,
    2,
    1,
    2,
    1,
    2,
    1,
    3,
    1,
    3,
    1,
    3,
    1,
    3,
    1,
    3,
    1,
    3,
    1,
    3,
    3,
    3,
    61,
    8,
    3,
    1,
    4,
    1,
    4,
    1,
    4,
    1,
    4,
    5,
    4,
    67,
    8,
    4,
    10,
    4,
    12,
    4,
    70,
    9,
    4,
    1,
    4,
    3,
    4,
    73,
    8,
    4,
    3,
    4,
    75,
    8,
    4,
    1,
    4,
    1,
    4,
    1,
    5,
    1,
    5,
    1,
    5,
    1,
    5,
    5,
    5,
    83,
    8,
    5,
    10,
    5,
    12,
    5,
    86,
    9,
    5,
    1,
    5,
    3,
    5,
    89,
    8,
    5,
    3,
    5,
    91,
    8,
    5,
    1,
    5,
    1,
    5,
    1,
    6,
    1,
    6,
    3,
    6,
    97,
    8,
    6,
    1,
    6,
    1,
    6,
    1,
    6,
    1,
    7,
    1,
    7,
    1,
    8,
    1,
    8,
    1,
    8,
    1,
    8,
    1,
    8,
    5,
    8,
    109,
    8,
    8,
    10,
    8,
    12,
    8,
    112,
    9,
    8,
    1,
    8,
    3,
    8,
    115,
    8,
    8,
    3,
    8,
    117,
    8,
    8,
    1,
    8,
    3,
    8,
    120,
    8,
    8,
    1,
    9,
    1,
    9,
    1,
    9,
    1,
    9,
    1,
    9,
    5,
    9,
    127,
    8,
    9,
    10,
    9,
    12,
    9,
    130,
    9,
    9,
    1,
    9,
    3,
    9,
    133,
    8,
    9,
    3,
    9,
    135,
    8,
    9,
    1,
    9,
    1,
    9,
    1,
    10,
    1,
    10,
    3,
    10,
    141,
    8,
    10,
    1,
    11,
    1,
    11,
    3,
    11,
    145,
    8,
    11,
    1,
    12,
    1,
    12,
    1,
    12,
    1,
    12,
    1,
    13,
    1,
    13,
    3,
    13,
    153,
    8,
    13,
    1,
    14,
    1,
    14,
    1,
    14,
    1,
    14,
    3,
    14,
    159,
    8,
    14,
    1,
    15,
    1,
    15,
    1,
    16,
    1,
    16,
    1,
    16,
    0,
    0,
    17,
    0,
    2,
    4,
    6,
    8,
    10,
    12,
    14,
    16,
    18,
    20,
    22,
    24,
    26,
    28,
    30,
    32,
    0,
    1,
    1,
    0,
    12,
    15,
    176,
    0,
    37,
    1,
    0,
    0,
    0,
    2,
    44,
    1,
    0,
    0,
    0,
    4,
    48,
    1,
    0,
    0,
    0,
    6,
    60,
    1,
    0,
    0,
    0,
    8,
    62,
    1,
    0,
    0,
    0,
    10,
    78,
    1,
    0,
    0,
    0,
    12,
    96,
    1,
    0,
    0,
    0,
    14,
    101,
    1,
    0,
    0,
    0,
    16,
    103,
    1,
    0,
    0,
    0,
    18,
    121,
    1,
    0,
    0,
    0,
    20,
    140,
    1,
    0,
    0,
    0,
    22,
    144,
    1,
    0,
    0,
    0,
    24,
    146,
    1,
    0,
    0,
    0,
    26,
    152,
    1,
    0,
    0,
    0,
    28,
    158,
    1,
    0,
    0,
    0,
    30,
    160,
    1,
    0,
    0,
    0,
    32,
    162,
    1,
    0,
    0,
    0,
    34,
    36,
    3,
    2,
    1,
    0,
    35,
    34,
    1,
    0,
    0,
    0,
    36,
    39,
    1,
    0,
    0,
    0,
    37,
    35,
    1,
    0,
    0,
    0,
    37,
    38,
    1,
    0,
    0,
    0,
    38,
    40,
    1,
    0,
    0,
    0,
    39,
    37,
    1,
    0,
    0,
    0,
    40,
    41,
    5,
    0,
    0,
    1,
    41,
    1,
    1,
    0,
    0,
    0,
    42,
    45,
    3,
    4,
    2,
    0,
    43,
    45,
    3,
    6,
    3,
    0,
    44,
    42,
    1,
    0,
    0,
    0,
    44,
    43,
    1,
    0,
    0,
    0,
    45,
    3,
    1,
    0,
    0,
    0,
    46,
    49,
    3,
    30,
    15,
    0,
    47,
    49,
    3,
    14,
    7,
    0,
    48,
    46,
    1,
    0,
    0,
    0,
    48,
    47,
    1,
    0,
    0,
    0,
    49,
    50,
    1,
    0,
    0,
    0,
    50,
    51,
    5,
    1,
    0,
    0,
    51,
    52,
    3,
    6,
    3,
    0,
    52,
    5,
    1,
    0,
    0,
    0,
    53,
    61,
    3,
    8,
    4,
    0,
    54,
    61,
    3,
    10,
    5,
    0,
    55,
    61,
    3,
    14,
    7,
    0,
    56,
    61,
    3,
    16,
    8,
    0,
    57,
    61,
    3,
    18,
    9,
    0,
    58,
    61,
    3,
    26,
    13,
    0,
    59,
    61,
    3,
    28,
    14,
    0,
    60,
    53,
    1,
    0,
    0,
    0,
    60,
    54,
    1,
    0,
    0,
    0,
    60,
    55,
    1,
    0,
    0,
    0,
    60,
    56,
    1,
    0,
    0,
    0,
    60,
    57,
    1,
    0,
    0,
    0,
    60,
    58,
    1,
    0,
    0,
    0,
    60,
    59,
    1,
    0,
    0,
    0,
    61,
    7,
    1,
    0,
    0,
    0,
    62,
    74,
    5,
    2,
    0,
    0,
    63,
    68,
    3,
    6,
    3,
    0,
    64,
    65,
    5,
    3,
    0,
    0,
    65,
    67,
    3,
    6,
    3,
    0,
    66,
    64,
    1,
    0,
    0,
    0,
    67,
    70,
    1,
    0,
    0,
    0,
    68,
    66,
    1,
    0,
    0,
    0,
    68,
    69,
    1,
    0,
    0,
    0,
    69,
    72,
    1,
    0,
    0,
    0,
    70,
    68,
    1,
    0,
    0,
    0,
    71,
    73,
    5,
    3,
    0,
    0,
    72,
    71,
    1,
    0,
    0,
    0,
    72,
    73,
    1,
    0,
    0,
    0,
    73,
    75,
    1,
    0,
    0,
    0,
    74,
    63,
    1,
    0,
    0,
    0,
    74,
    75,
    1,
    0,
    0,
    0,
    75,
    76,
    1,
    0,
    0,
    0,
    76,
    77,
    5,
    4,
    0,
    0,
    77,
    9,
    1,
    0,
    0,
    0,
    78,
    90,
    5,
    5,
    0,
    0,
    79,
    84,
    3,
    12,
    6,
    0,
    80,
    81,
    5,
    3,
    0,
    0,
    81,
    83,
    3,
    12,
    6,
    0,
    82,
    80,
    1,
    0,
    0,
    0,
    83,
    86,
    1,
    0,
    0,
    0,
    84,
    82,
    1,
    0,
    0,
    0,
    84,
    85,
    1,
    0,
    0,
    0,
    85,
    88,
    1,
    0,
    0,
    0,
    86,
    84,
    1,
    0,
    0,
    0,
    87,
    89,
    5,
    3,
    0,
    0,
    88,
    87,
    1,
    0,
    0,
    0,
    88,
    89,
    1,
    0,
    0,
    0,
    89,
    91,
    1,
    0,
    0,
    0,
    90,
    79,
    1,
    0,
    0,
    0,
    90,
    91,
    1,
    0,
    0,
    0,
    91,
    92,
    1,
    0,
    0,
    0,
    92,
    93,
    5,
    6,
    0,
    0,
    93,
    11,
    1,
    0,
    0,
    0,
    94,
    97,
    3,
    30,
    15,
    0,
    95,
    97,
    3,
    32,
    16,
    0,
    96,
    94,
    1,
    0,
    0,
    0,
    96,
    95,
    1,
    0,
    0,
    0,
    97,
    98,
    1,
    0,
    0,
    0,
    98,
    99,
    5,
    7,
    0,
    0,
    99,
    100,
    3,
    6,
    3,
    0,
    100,
    13,
    1,
    0,
    0,
    0,
    101,
    102,
    5,
    16,
    0,
    0,
    102,
    15,
    1,
    0,
    0,
    0,
    103,
    119,
    5,
    17,
    0,
    0,
    104,
    116,
    5,
    8,
    0,
    0,
    105,
    110,
    3,
    6,
    3,
    0,
    106,
    107,
    5,
    3,
    0,
    0,
    107,
    109,
    3,
    6,
    3,
    0,
    108,
    106,
    1,
    0,
    0,
    0,
    109,
    112,
    1,
    0,
    0,
    0,
    110,
    108,
    1,
    0,
    0,
    0,
    110,
    111,
    1,
    0,
    0,
    0,
    111,
    114,
    1,
    0,
    0,
    0,
    112,
    110,
    1,
    0,
    0,
    0,
    113,
    115,
    5,
    3,
    0,
    0,
    114,
    113,
    1,
    0,
    0,
    0,
    114,
    115,
    1,
    0,
    0,
    0,
    115,
    117,
    1,
    0,
    0,
    0,
    116,
    105,
    1,
    0,
    0,
    0,
    116,
    117,
    1,
    0,
    0,
    0,
    117,
    118,
    1,
    0,
    0,
    0,
    118,
    120,
    5,
    9,
    0,
    0,
    119,
    104,
    1,
    0,
    0,
    0,
    119,
    120,
    1,
    0,
    0,
    0,
    120,
    17,
    1,
    0,
    0,
    0,
    121,
    122,
    3,
    20,
    10,
    0,
    122,
    134,
    5,
    8,
    0,
    0,
    123,
    128,
    3,
    22,
    11,
    0,
    124,
    125,
    5,
    3,
    0,
    0,
    125,
    127,
    3,
    22,
    11,
    0,
    126,
    124,
    1,
    0,
    0,
    0,
    127,
    130,
    1,
    0,
    0,
    0,
    128,
    126,
    1,
    0,
    0,
    0,
    128,
    129,
    1,
    0,
    0,
    0,
    129,
    132,
    1,
    0,
    0,
    0,
    130,
    128,
    1,
    0,
    0,
    0,
    131,
    133,
    5,
    3,
    0,
    0,
    132,
    131,
    1,
    0,
    0,
    0,
    132,
    133,
    1,
    0,
    0,
    0,
    133,
    135,
    1,
    0,
    0,
    0,
    134,
    123,
    1,
    0,
    0,
    0,
    134,
    135,
    1,
    0,
    0,
    0,
    135,
    136,
    1,
    0,
    0,
    0,
    136,
    137,
    5,
    9,
    0,
    0,
    137,
    19,
    1,
    0,
    0,
    0,
    138,
    141,
    3,
    30,
    15,
    0,
    139,
    141,
    5,
    21,
    0,
    0,
    140,
    138,
    1,
    0,
    0,
    0,
    140,
    139,
    1,
    0,
    0,
    0,
    141,
    21,
    1,
    0,
    0,
    0,
    142,
    145,
    3,
    24,
    12,
    0,
    143,
    145,
    3,
    6,
    3,
    0,
    144,
    142,
    1,
    0,
    0,
    0,
    144,
    143,
    1,
    0,
    0,
    0,
    145,
    23,
    1,
    0,
    0,
    0,
    146,
    147,
    3,
    30,
    15,
    0,
    147,
    148,
    5,
    1,
    0,
    0,
    148,
    149,
    3,
    6,
    3,
    0,
    149,
    25,
    1,
    0,
    0,
    0,
    150,
    153,
    5,
    10,
    0,
    0,
    151,
    153,
    3,
    30,
    15,
    0,
    152,
    150,
    1,
    0,
    0,
    0,
    152,
    151,
    1,
    0,
    0,
    0,
    153,
    27,
    1,
    0,
    0,
    0,
    154,
    159,
    3,
    32,
    16,
    0,
    155,
    159,
    5,
    18,
    0,
    0,
    156,
    159,
    5,
    19,
    0,
    0,
    157,
    159,
    5,
    11,
    0,
    0,
    158,
    154,
    1,
    0,
    0,
    0,
    158,
    155,
    1,
    0,
    0,
    0,
    158,
    156,
    1,
    0,
    0,
    0,
    158,
    157,
    1,
    0,
    0,
    0,
    159,
    29,
    1,
    0,
    0,
    0,
    160,
    161,
    5,
    20,
    0,
    0,
    161,
    31,
    1,
    0,
    0,
    0,
    162,
    163,
    7,
    0,
    0,
    0,
    163,
    33,
    1,
    0,
    0,
    0,
    22,
    37,
    44,
    48,
    60,
    68,
    72,
    74,
    84,
    88,
    90,
    96,
    110,
    114,
    116,
    119,
    128,
    132,
    134,
    140,
    144,
    152,
    158,
  ];

  static final ATN _ATN = ATNDeserializer().deserialize(_serializedATN);
}

class ProgramContext extends ParserRuleContext {
  TerminalNode? EOF() => getToken(ExpressParser.TOKEN_EOF, 0);
  List<StatementContext> statements() => getRuleContexts<StatementContext>();
  StatementContext? statement(int i) => getRuleContext<StatementContext>(i);
  ProgramContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_program;
}

class StatementContext extends ParserRuleContext {
  AssignmentContext? assignment() => getRuleContext<AssignmentContext>(0);
  ExpressionContext? expression() => getRuleContext<ExpressionContext>(0);
  StatementContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_statement;
}

class AssignmentContext extends ParserRuleContext {
  ExpressionContext? expression() => getRuleContext<ExpressionContext>(0);
  IdentifierContext? identifier() => getRuleContext<IdentifierContext>(0);
  PathContext? path() => getRuleContext<PathContext>(0);
  AssignmentContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_assignment;
}

class ExpressionContext extends ParserRuleContext {
  ArrayContext? array() => getRuleContext<ArrayContext>(0);
  MapContext? map() => getRuleContext<MapContext>(0);
  PathContext? path() => getRuleContext<PathContext>(0);
  CheckContext? check() => getRuleContext<CheckContext>(0);
  CallContext? call() => getRuleContext<CallContext>(0);
  VariableContext? variable() => getRuleContext<VariableContext>(0);
  LiteralContext? literal() => getRuleContext<LiteralContext>(0);
  ExpressionContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_expression;
}

class ArrayContext extends ParserRuleContext {
  List<ExpressionContext> expressions() => getRuleContexts<ExpressionContext>();
  ExpressionContext? expression(int i) => getRuleContext<ExpressionContext>(i);
  ArrayContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_array;
}

class MapContext extends ParserRuleContext {
  List<Map_entryContext> map_entrys() => getRuleContexts<Map_entryContext>();
  Map_entryContext? map_entry(int i) => getRuleContext<Map_entryContext>(i);
  MapContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_map;
}

class Map_entryContext extends ParserRuleContext {
  ExpressionContext? expression() => getRuleContext<ExpressionContext>(0);
  IdentifierContext? identifier() => getRuleContext<IdentifierContext>(0);
  StringContext? string() => getRuleContext<StringContext>(0);
  Map_entryContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_map_entry;
}

class PathContext extends ParserRuleContext {
  TerminalNode? PATH() => getToken(ExpressParser.TOKEN_PATH, 0);
  PathContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_path;
}

class CheckContext extends ParserRuleContext {
  TerminalNode? CHECK() => getToken(ExpressParser.TOKEN_CHECK, 0);
  List<ExpressionContext> expressions() => getRuleContexts<ExpressionContext>();
  ExpressionContext? expression(int i) => getRuleContext<ExpressionContext>(i);
  CheckContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_check;
}

class CallContext extends ParserRuleContext {
  Function_nameContext? function_name() =>
      getRuleContext<Function_nameContext>(0);
  List<ArgContext> args() => getRuleContexts<ArgContext>();
  ArgContext? arg(int i) => getRuleContext<ArgContext>(i);
  CallContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_call;
}

class Function_nameContext extends ParserRuleContext {
  IdentifierContext? identifier() => getRuleContext<IdentifierContext>(0);
  TerminalNode? SYSTEM_IDENTIFIER() =>
      getToken(ExpressParser.TOKEN_SYSTEM_IDENTIFIER, 0);
  Function_nameContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_function_name;
}

class ArgContext extends ParserRuleContext {
  Named_argContext? named_arg() => getRuleContext<Named_argContext>(0);
  ExpressionContext? expression() => getRuleContext<ExpressionContext>(0);
  ArgContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_arg;
}

class Named_argContext extends ParserRuleContext {
  IdentifierContext? identifier() => getRuleContext<IdentifierContext>(0);
  ExpressionContext? expression() => getRuleContext<ExpressionContext>(0);
  Named_argContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_named_arg;
}

class VariableContext extends ParserRuleContext {
  IdentifierContext? identifier() => getRuleContext<IdentifierContext>(0);
  VariableContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_variable;
}

class LiteralContext extends ParserRuleContext {
  StringContext? string() => getRuleContext<StringContext>(0);
  TerminalNode? NUMBER() => getToken(ExpressParser.TOKEN_NUMBER, 0);
  TerminalNode? BOOLEAN() => getToken(ExpressParser.TOKEN_BOOLEAN, 0);
  LiteralContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_literal;
}

class IdentifierContext extends ParserRuleContext {
  TerminalNode? IDENTIFIER() => getToken(ExpressParser.TOKEN_IDENTIFIER, 0);
  IdentifierContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_identifier;
}

class StringContext extends ParserRuleContext {
  TerminalNode? RAW_TRIPLE_STRING() =>
      getToken(ExpressParser.TOKEN_RAW_TRIPLE_STRING, 0);
  TerminalNode? TRIPLE_STRING() =>
      getToken(ExpressParser.TOKEN_TRIPLE_STRING, 0);
  TerminalNode? RAW_STRING() => getToken(ExpressParser.TOKEN_RAW_STRING, 0);
  TerminalNode? STANDARD_STRING() =>
      getToken(ExpressParser.TOKEN_STANDARD_STRING, 0);
  StringContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_string;
}
