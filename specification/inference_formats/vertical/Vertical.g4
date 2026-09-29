/**
 * ANTLR4 grammar for the A2UI Vertical language.
 *
 * Defines the syntax and lexical rules for the A2UI Vertical inference format.
 * Compiles flat, non-nested component constructor invocations into independent
 * surfaces within standard A2UI messages.
 */
grammar Vertical;

/**
 * Root entrypoint. A Vertical program is a sequence of zero or more component constructors.
 */
program
    : componentCall* EOF
    ;

/**
 * Direct component constructor invocation.
 * Example: WeatherWidget(city="Seattle", temperature=58)
 */
componentCall
    : IDENTIFIER '(' (arg (',' arg)* ','?)? ')'
    ;

/**
 * An argument to a component constructor, which can be named or positional.
 */
arg
    : namedArg
    | positionalArg
    ;

/**
 * A named argument (e.g. 'city="Seattle"' or 'city: "Seattle"').
 */
namedArg
    : (IDENTIFIER | STRING) ('=' | ':') value
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
    | array
    ;

/**
 * Literal primitive values.
 */
literal
    : STRING
    | NUMBER
    | BOOLEAN
    | NULL
    ;

/**
 * Dynamic data binding path starting with '$' (e.g. '$/user/name').
 */
path
    : PATH
    ;

/**
 * An action trigger or event instantiation.
 * Example: Event("openDetails", item="123")
 */
event
    : EVENT '(' (arg (',' arg)* ','?)? ')'
    ;

/**
 * Array literal of values.
 */
array
    : '[' (value (',' value)* ','?)? ']'
    ;

/* --- Lexer Rules --- */

EVENT: 'Event';

PATH: '$' ('/' [a-zA-Z0-9_.~%+-]+)+;

BOOLEAN
    : [tT] [rR] [uU] [eE]
    | [fF] [aA] [lL] [sS] [eE]
    ;

NULL
    : [nN] [uU] [lL] [lL]
    | [nN] [oO] [nN] [eE]
    ;

IDENTIFIER: [a-zA-Z_][a-zA-Z0-9_]*;

NUMBER
    : [+-]? [0-9]+ ('.' [0-9]+)? ([eE] [+-]? [0-9]+)? '%'?
    ;

STRING
    : '"' (~["\\\r\n] | '\\' .)* '"'
    | '\'' (~['\\\r\n] | '\\' .)* '\''
    | '"""' .*? '"""'
    ;

COMMENT
    : '#' ~[\r\n]* -> channel(HIDDEN)
    | '//' ~[\r\n]* -> channel(HIDDEN)
    | '/*' .*? '*/' -> channel(HIDDEN)
    ;

WS
    : [ \t\r\n]+ -> channel(HIDDEN)
    ;
