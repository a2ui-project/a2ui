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
    RULE_arg = 10,
    RULE_named_arg = 11,
    RULE_variable = 12,
    RULE_literal = 13,
    RULE_identifier = 14,
    RULE_string = 15;

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
      TOKEN_COMMENT = 21,
      TOKEN_BLOCK_COMMENT = 22,
      TOKEN_SEMICOLON = 23,
      TOKEN_WS = 24;

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
      state = 35;
      errorHandler.sync(this);
      _la = tokenStream.LA(1)!;
      while ((((_la) & ~0x3f) == 0 && ((1 << _la) & 2096164) != 0)) {
        state = 32;
        statement();
        state = 37;
        errorHandler.sync(this);
        _la = tokenStream.LA(1)!;
      }
      state = 38;
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
      state = 42;
      errorHandler.sync(this);
      switch (interpreter!.adaptivePredict(tokenStream, 1, context)) {
        case 1:
          enterOuterAlt(_localctx, 1);
          state = 40;
          assignment();
          break;
        case 2:
          enterOuterAlt(_localctx, 2);
          state = 41;
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
      state = 46;
      errorHandler.sync(this);
      switch (tokenStream.LA(1)!) {
        case TOKEN_IDENTIFIER:
          state = 44;
          identifier();
          break;
        case TOKEN_PATH:
          state = 45;
          path();
          break;
        default:
          throw NoViableAltException(this);
      }
      state = 48;
      match(TOKEN_T__0);
      state = 49;
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
      state = 58;
      errorHandler.sync(this);
      switch (interpreter!.adaptivePredict(tokenStream, 3, context)) {
        case 1:
          enterOuterAlt(_localctx, 1);
          state = 51;
          array();
          break;
        case 2:
          enterOuterAlt(_localctx, 2);
          state = 52;
          map();
          break;
        case 3:
          enterOuterAlt(_localctx, 3);
          state = 53;
          path();
          break;
        case 4:
          enterOuterAlt(_localctx, 4);
          state = 54;
          check();
          break;
        case 5:
          enterOuterAlt(_localctx, 5);
          state = 55;
          call();
          break;
        case 6:
          enterOuterAlt(_localctx, 6);
          state = 56;
          variable();
          break;
        case 7:
          enterOuterAlt(_localctx, 7);
          state = 57;
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
      state = 60;
      match(TOKEN_T__1);
      state = 72;
      errorHandler.sync(this);
      _la = tokenStream.LA(1)!;
      if ((((_la) & ~0x3f) == 0 && ((1 << _la) & 2096164) != 0)) {
        state = 61;
        expression();
        state = 66;
        errorHandler.sync(this);
        _alt = interpreter!.adaptivePredict(tokenStream, 4, context);
        while (_alt != 2 && _alt != ATN.INVALID_ALT_NUMBER) {
          if (_alt == 1) {
            state = 62;
            match(TOKEN_T__2);
            state = 63;
            expression();
          }
          state = 68;
          errorHandler.sync(this);
          _alt = interpreter!.adaptivePredict(tokenStream, 4, context);
        }
        state = 70;
        errorHandler.sync(this);
        _la = tokenStream.LA(1)!;
        if (_la == TOKEN_T__2) {
          state = 69;
          match(TOKEN_T__2);
        }
      }

      state = 74;
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
      state = 76;
      match(TOKEN_T__4);
      state = 88;
      errorHandler.sync(this);
      _la = tokenStream.LA(1)!;
      if ((((_la) & ~0x3f) == 0 && ((1 << _la) & 1110016) != 0)) {
        state = 77;
        map_entry();
        state = 82;
        errorHandler.sync(this);
        _alt = interpreter!.adaptivePredict(tokenStream, 7, context);
        while (_alt != 2 && _alt != ATN.INVALID_ALT_NUMBER) {
          if (_alt == 1) {
            state = 78;
            match(TOKEN_T__2);
            state = 79;
            map_entry();
          }
          state = 84;
          errorHandler.sync(this);
          _alt = interpreter!.adaptivePredict(tokenStream, 7, context);
        }
        state = 86;
        errorHandler.sync(this);
        _la = tokenStream.LA(1)!;
        if (_la == TOKEN_T__2) {
          state = 85;
          match(TOKEN_T__2);
        }
      }

      state = 90;
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
      state = 94;
      errorHandler.sync(this);
      switch (tokenStream.LA(1)!) {
        case TOKEN_IDENTIFIER:
          state = 92;
          identifier();
          break;
        case TOKEN_RAW_TRIPLE_STRING:
        case TOKEN_TRIPLE_STRING:
        case TOKEN_RAW_STRING:
        case TOKEN_STANDARD_STRING:
          state = 93;
          string();
          break;
        default:
          throw NoViableAltException(this);
      }
      state = 96;
      match(TOKEN_T__6);
      state = 97;
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
      state = 99;
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
      state = 101;
      match(TOKEN_CHECK);
      state = 117;
      errorHandler.sync(this);
      _la = tokenStream.LA(1)!;
      if (_la == TOKEN_T__7) {
        state = 102;
        match(TOKEN_T__7);
        state = 114;
        errorHandler.sync(this);
        _la = tokenStream.LA(1)!;
        if ((((_la) & ~0x3f) == 0 && ((1 << _la) & 2096164) != 0)) {
          state = 103;
          expression();
          state = 108;
          errorHandler.sync(this);
          _alt = interpreter!.adaptivePredict(tokenStream, 11, context);
          while (_alt != 2 && _alt != ATN.INVALID_ALT_NUMBER) {
            if (_alt == 1) {
              state = 104;
              match(TOKEN_T__2);
              state = 105;
              expression();
            }
            state = 110;
            errorHandler.sync(this);
            _alt = interpreter!.adaptivePredict(tokenStream, 11, context);
          }
          state = 112;
          errorHandler.sync(this);
          _la = tokenStream.LA(1)!;
          if (_la == TOKEN_T__2) {
            state = 111;
            match(TOKEN_T__2);
          }
        }

        state = 116;
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
      state = 119;
      identifier();
      state = 120;
      match(TOKEN_T__7);
      state = 132;
      errorHandler.sync(this);
      _la = tokenStream.LA(1)!;
      if ((((_la) & ~0x3f) == 0 && ((1 << _la) & 2096164) != 0)) {
        state = 121;
        arg();
        state = 126;
        errorHandler.sync(this);
        _alt = interpreter!.adaptivePredict(tokenStream, 15, context);
        while (_alt != 2 && _alt != ATN.INVALID_ALT_NUMBER) {
          if (_alt == 1) {
            state = 122;
            match(TOKEN_T__2);
            state = 123;
            arg();
          }
          state = 128;
          errorHandler.sync(this);
          _alt = interpreter!.adaptivePredict(tokenStream, 15, context);
        }
        state = 130;
        errorHandler.sync(this);
        _la = tokenStream.LA(1)!;
        if (_la == TOKEN_T__2) {
          state = 129;
          match(TOKEN_T__2);
        }
      }

      state = 134;
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

  ArgContext arg() {
    dynamic _localctx = ArgContext(context, state);
    enterRule(_localctx, 20, RULE_arg);
    try {
      state = 138;
      errorHandler.sync(this);
      switch (interpreter!.adaptivePredict(tokenStream, 18, context)) {
        case 1:
          enterOuterAlt(_localctx, 1);
          state = 136;
          named_arg();
          break;
        case 2:
          enterOuterAlt(_localctx, 2);
          state = 137;
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
    enterRule(_localctx, 22, RULE_named_arg);
    try {
      enterOuterAlt(_localctx, 1);
      state = 140;
      identifier();
      state = 141;
      match(TOKEN_T__0);
      state = 142;
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
    enterRule(_localctx, 24, RULE_variable);
    try {
      state = 146;
      errorHandler.sync(this);
      switch (tokenStream.LA(1)!) {
        case TOKEN_T__9:
          enterOuterAlt(_localctx, 1);
          state = 144;
          match(TOKEN_T__9);
          break;
        case TOKEN_IDENTIFIER:
          enterOuterAlt(_localctx, 2);
          state = 145;
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
    enterRule(_localctx, 26, RULE_literal);
    try {
      state = 152;
      errorHandler.sync(this);
      switch (tokenStream.LA(1)!) {
        case TOKEN_RAW_TRIPLE_STRING:
        case TOKEN_TRIPLE_STRING:
        case TOKEN_RAW_STRING:
        case TOKEN_STANDARD_STRING:
          enterOuterAlt(_localctx, 1);
          state = 148;
          string();
          break;
        case TOKEN_NUMBER:
          enterOuterAlt(_localctx, 2);
          state = 149;
          match(TOKEN_NUMBER);
          break;
        case TOKEN_BOOLEAN:
          enterOuterAlt(_localctx, 3);
          state = 150;
          match(TOKEN_BOOLEAN);
          break;
        case TOKEN_T__10:
          enterOuterAlt(_localctx, 4);
          state = 151;
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
    enterRule(_localctx, 28, RULE_identifier);
    try {
      enterOuterAlt(_localctx, 1);
      state = 154;
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
    enterRule(_localctx, 30, RULE_string);
    int _la;
    try {
      enterOuterAlt(_localctx, 1);
      state = 156;
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
    24,
    159,
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
    1,
    0,
    5,
    0,
    34,
    8,
    0,
    10,
    0,
    12,
    0,
    37,
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
    43,
    8,
    1,
    1,
    2,
    1,
    2,
    3,
    2,
    47,
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
    59,
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
    65,
    8,
    4,
    10,
    4,
    12,
    4,
    68,
    9,
    4,
    1,
    4,
    3,
    4,
    71,
    8,
    4,
    3,
    4,
    73,
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
    81,
    8,
    5,
    10,
    5,
    12,
    5,
    84,
    9,
    5,
    1,
    5,
    3,
    5,
    87,
    8,
    5,
    3,
    5,
    89,
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
    95,
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
    107,
    8,
    8,
    10,
    8,
    12,
    8,
    110,
    9,
    8,
    1,
    8,
    3,
    8,
    113,
    8,
    8,
    3,
    8,
    115,
    8,
    8,
    1,
    8,
    3,
    8,
    118,
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
    125,
    8,
    9,
    10,
    9,
    12,
    9,
    128,
    9,
    9,
    1,
    9,
    3,
    9,
    131,
    8,
    9,
    3,
    9,
    133,
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
    139,
    8,
    10,
    1,
    11,
    1,
    11,
    1,
    11,
    1,
    11,
    1,
    12,
    1,
    12,
    3,
    12,
    147,
    8,
    12,
    1,
    13,
    1,
    13,
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
    15,
    1,
    15,
    1,
    15,
    0,
    0,
    16,
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
    0,
    1,
    1,
    0,
    12,
    15,
    170,
    0,
    35,
    1,
    0,
    0,
    0,
    2,
    42,
    1,
    0,
    0,
    0,
    4,
    46,
    1,
    0,
    0,
    0,
    6,
    58,
    1,
    0,
    0,
    0,
    8,
    60,
    1,
    0,
    0,
    0,
    10,
    76,
    1,
    0,
    0,
    0,
    12,
    94,
    1,
    0,
    0,
    0,
    14,
    99,
    1,
    0,
    0,
    0,
    16,
    101,
    1,
    0,
    0,
    0,
    18,
    119,
    1,
    0,
    0,
    0,
    20,
    138,
    1,
    0,
    0,
    0,
    22,
    140,
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
    154,
    1,
    0,
    0,
    0,
    30,
    156,
    1,
    0,
    0,
    0,
    32,
    34,
    3,
    2,
    1,
    0,
    33,
    32,
    1,
    0,
    0,
    0,
    34,
    37,
    1,
    0,
    0,
    0,
    35,
    33,
    1,
    0,
    0,
    0,
    35,
    36,
    1,
    0,
    0,
    0,
    36,
    38,
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
    38,
    39,
    5,
    0,
    0,
    1,
    39,
    1,
    1,
    0,
    0,
    0,
    40,
    43,
    3,
    4,
    2,
    0,
    41,
    43,
    3,
    6,
    3,
    0,
    42,
    40,
    1,
    0,
    0,
    0,
    42,
    41,
    1,
    0,
    0,
    0,
    43,
    3,
    1,
    0,
    0,
    0,
    44,
    47,
    3,
    28,
    14,
    0,
    45,
    47,
    3,
    14,
    7,
    0,
    46,
    44,
    1,
    0,
    0,
    0,
    46,
    45,
    1,
    0,
    0,
    0,
    47,
    48,
    1,
    0,
    0,
    0,
    48,
    49,
    5,
    1,
    0,
    0,
    49,
    50,
    3,
    6,
    3,
    0,
    50,
    5,
    1,
    0,
    0,
    0,
    51,
    59,
    3,
    8,
    4,
    0,
    52,
    59,
    3,
    10,
    5,
    0,
    53,
    59,
    3,
    14,
    7,
    0,
    54,
    59,
    3,
    16,
    8,
    0,
    55,
    59,
    3,
    18,
    9,
    0,
    56,
    59,
    3,
    24,
    12,
    0,
    57,
    59,
    3,
    26,
    13,
    0,
    58,
    51,
    1,
    0,
    0,
    0,
    58,
    52,
    1,
    0,
    0,
    0,
    58,
    53,
    1,
    0,
    0,
    0,
    58,
    54,
    1,
    0,
    0,
    0,
    58,
    55,
    1,
    0,
    0,
    0,
    58,
    56,
    1,
    0,
    0,
    0,
    58,
    57,
    1,
    0,
    0,
    0,
    59,
    7,
    1,
    0,
    0,
    0,
    60,
    72,
    5,
    2,
    0,
    0,
    61,
    66,
    3,
    6,
    3,
    0,
    62,
    63,
    5,
    3,
    0,
    0,
    63,
    65,
    3,
    6,
    3,
    0,
    64,
    62,
    1,
    0,
    0,
    0,
    65,
    68,
    1,
    0,
    0,
    0,
    66,
    64,
    1,
    0,
    0,
    0,
    66,
    67,
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
    69,
    71,
    5,
    3,
    0,
    0,
    70,
    69,
    1,
    0,
    0,
    0,
    70,
    71,
    1,
    0,
    0,
    0,
    71,
    73,
    1,
    0,
    0,
    0,
    72,
    61,
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
    74,
    1,
    0,
    0,
    0,
    74,
    75,
    5,
    4,
    0,
    0,
    75,
    9,
    1,
    0,
    0,
    0,
    76,
    88,
    5,
    5,
    0,
    0,
    77,
    82,
    3,
    12,
    6,
    0,
    78,
    79,
    5,
    3,
    0,
    0,
    79,
    81,
    3,
    12,
    6,
    0,
    80,
    78,
    1,
    0,
    0,
    0,
    81,
    84,
    1,
    0,
    0,
    0,
    82,
    80,
    1,
    0,
    0,
    0,
    82,
    83,
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
    85,
    87,
    5,
    3,
    0,
    0,
    86,
    85,
    1,
    0,
    0,
    0,
    86,
    87,
    1,
    0,
    0,
    0,
    87,
    89,
    1,
    0,
    0,
    0,
    88,
    77,
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
    90,
    1,
    0,
    0,
    0,
    90,
    91,
    5,
    6,
    0,
    0,
    91,
    11,
    1,
    0,
    0,
    0,
    92,
    95,
    3,
    28,
    14,
    0,
    93,
    95,
    3,
    30,
    15,
    0,
    94,
    92,
    1,
    0,
    0,
    0,
    94,
    93,
    1,
    0,
    0,
    0,
    95,
    96,
    1,
    0,
    0,
    0,
    96,
    97,
    5,
    7,
    0,
    0,
    97,
    98,
    3,
    6,
    3,
    0,
    98,
    13,
    1,
    0,
    0,
    0,
    99,
    100,
    5,
    16,
    0,
    0,
    100,
    15,
    1,
    0,
    0,
    0,
    101,
    117,
    5,
    17,
    0,
    0,
    102,
    114,
    5,
    8,
    0,
    0,
    103,
    108,
    3,
    6,
    3,
    0,
    104,
    105,
    5,
    3,
    0,
    0,
    105,
    107,
    3,
    6,
    3,
    0,
    106,
    104,
    1,
    0,
    0,
    0,
    107,
    110,
    1,
    0,
    0,
    0,
    108,
    106,
    1,
    0,
    0,
    0,
    108,
    109,
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
    111,
    113,
    5,
    3,
    0,
    0,
    112,
    111,
    1,
    0,
    0,
    0,
    112,
    113,
    1,
    0,
    0,
    0,
    113,
    115,
    1,
    0,
    0,
    0,
    114,
    103,
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
    116,
    1,
    0,
    0,
    0,
    116,
    118,
    5,
    9,
    0,
    0,
    117,
    102,
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
    17,
    1,
    0,
    0,
    0,
    119,
    120,
    3,
    28,
    14,
    0,
    120,
    132,
    5,
    8,
    0,
    0,
    121,
    126,
    3,
    20,
    10,
    0,
    122,
    123,
    5,
    3,
    0,
    0,
    123,
    125,
    3,
    20,
    10,
    0,
    124,
    122,
    1,
    0,
    0,
    0,
    125,
    128,
    1,
    0,
    0,
    0,
    126,
    124,
    1,
    0,
    0,
    0,
    126,
    127,
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
    129,
    131,
    5,
    3,
    0,
    0,
    130,
    129,
    1,
    0,
    0,
    0,
    130,
    131,
    1,
    0,
    0,
    0,
    131,
    133,
    1,
    0,
    0,
    0,
    132,
    121,
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
    134,
    1,
    0,
    0,
    0,
    134,
    135,
    5,
    9,
    0,
    0,
    135,
    19,
    1,
    0,
    0,
    0,
    136,
    139,
    3,
    22,
    11,
    0,
    137,
    139,
    3,
    6,
    3,
    0,
    138,
    136,
    1,
    0,
    0,
    0,
    138,
    137,
    1,
    0,
    0,
    0,
    139,
    21,
    1,
    0,
    0,
    0,
    140,
    141,
    3,
    28,
    14,
    0,
    141,
    142,
    5,
    1,
    0,
    0,
    142,
    143,
    3,
    6,
    3,
    0,
    143,
    23,
    1,
    0,
    0,
    0,
    144,
    147,
    5,
    10,
    0,
    0,
    145,
    147,
    3,
    28,
    14,
    0,
    146,
    144,
    1,
    0,
    0,
    0,
    146,
    145,
    1,
    0,
    0,
    0,
    147,
    25,
    1,
    0,
    0,
    0,
    148,
    153,
    3,
    30,
    15,
    0,
    149,
    153,
    5,
    18,
    0,
    0,
    150,
    153,
    5,
    19,
    0,
    0,
    151,
    153,
    5,
    11,
    0,
    0,
    152,
    148,
    1,
    0,
    0,
    0,
    152,
    149,
    1,
    0,
    0,
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
    155,
    5,
    20,
    0,
    0,
    155,
    29,
    1,
    0,
    0,
    0,
    156,
    157,
    7,
    0,
    0,
    0,
    157,
    31,
    1,
    0,
    0,
    0,
    21,
    35,
    42,
    46,
    58,
    66,
    70,
    72,
    82,
    86,
    88,
    94,
    108,
    112,
    114,
    117,
    126,
    130,
    132,
    138,
    146,
    152,
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
  IdentifierContext? identifier() => getRuleContext<IdentifierContext>(0);
  List<ArgContext> args() => getRuleContexts<ArgContext>();
  ArgContext? arg(int i) => getRuleContext<ArgContext>(i);
  CallContext([ParserRuleContext? parent, int? invokingState])
    : super(parent, invokingState);
  @override
  int get ruleIndex => RULE_call;
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
