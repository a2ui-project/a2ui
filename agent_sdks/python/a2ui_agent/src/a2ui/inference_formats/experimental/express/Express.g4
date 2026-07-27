/**
 * ANTLR4 grammar for the A2UI Express language.
 *
 * Defines the syntax and lexical rules for A2UI Express DSL.
 * Compiles plain-text declarations, assignments, and nested function calls
 * into a structured abstract syntax tree (AST).
 */
grammar Express;

/**
 * Root entrypoint. A program is a sequence of zero or more statements.
 */
program
    : statement* EOF
    ;

/**
 * A statement is either a variable assignment or a standalone expression.
 */
statement
    : assignment
    | expression
    ;

/**
 * Assigns an expression to a variable or a data path target.
 */
assignment
    : (identifier | path) '=' expression
    ;

/**
 * Represents a parsed value, complex structure, or nested call.
 */
expression
    : array
    | map
    | path
    | check
    | call
    | variable
    | literal
    ;

/**
 * A list of expressions enclosed in square brackets with an optional trailing comma.
 * Note: Commas are only permitted when preceded by a valid expression (prevents empty '[,]').
 */
array
    : '[' (expression (',' expression)* ','?)? ']'
    ;

/**
 * A key-value dictionary enclosed in curly braces with an optional trailing comma.
 * Note: Commas are only permitted when preceded by a valid map entry.
 */
map
    : '{' (map_entry (',' map_entry)* ','?)? '}'
    ;

/**
 * A single key-value entry within a map literal.
 */
map_entry
    : (identifier | string) ':' expression
    ;

/**
 * A dynamic data binding path starting with '$'.
 * Resolves to the path value in the data model (e.g. '$/form/name').
 */
path
    : PATH
    ;

/**
 * A validation check rule starting with '?'.
 * Optionally accepts a parenthesized list of parameter expressions.
 */
check
    : CHECK ('(' (expression (',' expression)* ','?)? ')')?
    ;

/**
 * A component constructor or function call.
 * Accepts positional expressions and optional trailing commas.
 */
call
    : identifier '(' (expression (',' expression)* ','?)? ')'
    ;

/**
 * A variable reference, or the special skipped argument sentinel '_'.
 */
variable
    : '_'
    | identifier
    ;

/**
 * A primitive literal value.
 */
literal
    : string
    | NUMBER
    | BOOLEAN
    | 'null'
    ;

/**
 * A plain alphanumeric identifier.
 */
identifier
    : IDENTIFIER
    ;

/**
 * A unified parser rule for all supported string literal variants.
 * Splitting strings into distinct lexer tokens allows the AST visitor to apply
 * targeted unescaping and prefix-stripping logic.
 */
string
    : RAW_TRIPLE_STRING
    | TRIPLE_STRING
    | RAW_STRING
    | STANDARD_STRING
    ;

// =============================================================================
// Lexer Rules
// =============================================================================

// String literals: must match triple-quoted forms before single-quoted forms.
RAW_TRIPLE_STRING : [rR] '"""' .*? '"""' ;
TRIPLE_STRING     : '"""' ( '\\' . | ~'\\' )*? '"""' ;
RAW_STRING        : [rR] '"' ~[\r\n"]* '"' ;
STANDARD_STRING   : '"' ( '\\' . | ~'\\' )*? '"' ;

// Data path literal (e.g. '$/user/id')
PATH : '$' [a-zA-Z0-9_/]* ;

// Validation check identifier (e.g. '?required')
CHECK : '?' [a-zA-Z_] [a-zA-Z0-9_]* ;

// Numeric literal supporting negatives and decimals
NUMBER : '-'? [0-9]+ ('.' [0-9]+)? ;

// Boolean literal
BOOLEAN : 'true' | 'false' ;

// Plain alphanumeric identifier
IDENTIFIER : [a-zA-Z_] [a-zA-Z0-9_]* ;

// Ignored elements: skipped completely at the lexer level.
COMMENT : ( '#' | '//' ) ~[\r\n]* -> skip ;
BLOCK_COMMENT : '/*' .*? '*/' -> skip ;
SEMICOLON : ';' -> skip ; // Semicolons act as statement separators but are skipped like whitespace.
WS : [ \t\r\n]+ -> skip ;
