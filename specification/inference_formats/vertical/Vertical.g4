/**
 * ANTLR4 grammar for the A2UI Vertical language.
 *
 * Defines the canonical syntax and lexical rules for the A2UI Vertical
 * inference format. Compiles flat, non-nested component constructor and
 * standalone function invocations into standard A2UI messages (v0.9, v0.9.1,
 * and v1.0).
 */
grammar Vertical;

/**
 * Root entrypoint. A Vertical program is a sequence of zero or more top-level calls.
 */
program
    : statement* EOF
    ;

/**
 * Direct component constructor or standalone renderer function invocation.
 * Example: WeatherWidget(city="Seattle", temperature=58)
 */
statement
    : IDENTIFIER '(' (arg (',' arg)* ','?)? ')' ';'?
    ;

/**
 * An argument to a call, which can be named or positional.
 */
arg
    : namedArg
    | positionalArg
    ;

/**
 * A named argument (e.g. 'city="Seattle"' or 'city: "Seattle"').
 */
namedArg
    : (IDENTIFIER | EVENT | string) ('=' | ':') value
    ;

/**
 * A positional argument expression.
 */
positionalArg
    : value
    ;

/**
 * A value passed to an argument.
 */
value
    : literal
    | path
    | event
    | checkRule
    | functionCall
    | array
    | mapLiteral
    ;

/**
 * Literal primitive values.
 */
literal
    : string
    | NUMBER
    | BOOLEAN
    | NULL
    ;

/**
 * Unified parser rule for all supported string literal variants.
 */
string
    : RAW_TRIPLE_STRING
    | TRIPLE_STRING
    | RAW_STRING
    | STANDARD_STRING
    ;

/**
 * Dynamic data binding path starting with '$' (e.g. '$/user/name').
 */
path
    : PATH
    ;

/**
 * An action trigger or event instantiation.
 * Example: Event("openDetails", item="123", userMessage="Opening details")
 */
event
    : EVENT '(' (arg (',' arg)* ','?)? ')'
    ;

/**
 * A validation check rule expression on a checkable input component.
 * Example: ?required or ?regex("^[0-9]+$", "Digits only")
 */
checkRule
    : '?' IDENTIFIER ('(' (arg (',' arg)* ','?)? ')')?
    ;

/**
 * A nested catalog function call expression.
 * Example: formatString("Hello ${/user/name}") or openUrl("https://example.com")
 */
functionCall
    : IDENTIFIER '(' (arg (',' arg)* ','?)? ')'
    ;

/**
 * Array literal of values.
 */
array
    : '[' (value (',' value)* ','?)? ']'
    ;

/**
 * Map / object literal of key-value pairs.
 */
mapLiteral
    : '{' (namedArg (',' namedArg)* ','?)? '}'
    ;

/* --- Lexer Rules --- */

EVENT: 'Event';

RAW_TRIPLE_STRING
    : [rR] '"""' .*? '"""'
    | [rR] '\'\'\'' .*? '\'\'\''
    ;

TRIPLE_STRING
    : '"""' ('\\' . | ~'\\')*? '"""'
    | '\'\'\'' ('\\' . | ~'\\')*? '\'\'\''
    ;

RAW_STRING
    : [rR] '"' ~[\r\n"]* '"'
    | [rR] '\'' ~[\r\n']* '\''
    ;

STANDARD_STRING
    : '"' ('\\' . | ~["\\\r\n])* '"'
    | '\'' ('\\' . | ~['\\\r\n])* '\''
    ;

PATH: '$' ('/' [a-zA-Z0-9_.~%+-]*)* | '$' [a-zA-Z0-9_.~%+-]+ ('/' [a-zA-Z0-9_.~%+-]+)*;

BOOLEAN
    : [tT] [rR] [uU] [eE]
    | [fF] [aA] [lL] [sS] [eE]
    ;

NULL
    : [nN] [uU] [lL] [lL]
    | [nN] [oO] [nN] [eE]
    ;

// UAX 31 identifier: XID_Start or '_', followed by XID_Continue*.
IDENTIFIER: [\p{XID_Start}_] [\p{XID_Continue}]*;

NUMBER
    : [+-]? ([0-9]+ ('.' [0-9]*)? | '.' [0-9]+) ([eE] [+-]? [0-9]+)? '%'?
    ;

COMMENT
    : ('#' | '//') ~[\r\n]* -> channel(HIDDEN)
    | '/*' .*? '*/' -> channel(HIDDEN)
    ;

WS
    : [ \t\r\n]+ -> channel(HIDDEN)
    ;
