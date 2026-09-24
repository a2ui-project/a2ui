# ANTLR parity notes for Express grammar reviewers

Python is the reference implementation of the Express grammar. TypeScript follows it.
These notes exist so that a reviewer of a change to
`specification/inference_formats/express/Express.g4`, or to either hand-written
visitor, can tell whether the change will behave the same in both languages, instead
of waiting for a conformance failure to say so.

This document was first written before the TypeScript implementation existed, and
revised on 2026-09-23 when the TypeScript toolchain moved to antlr-ng and the
`antlr4ng` runtime. Everything below about Python and the grammar is checked against
the repository. Items that still need a test say so. When the TypeScript Express
implementation lands, this file moves next to it, at
`typescript/a2ui_agent/src/inference_formats/express/`.

---

## Two tools, one ATN

The two SDKs generate their parsers with different tools from the same `.g4` file:

```bash
# Python: the official ANTLR 4.13.2 Java tool, via antlr4-tools
antlr4 -Dlanguage=Python3 -visitor -no-listener -o generated Express.g4
# TypeScript: antlr-ng 1.0.10, a TypeScript port of the 4.13.2 tool, from npm
antlr-ng -Dlanguage=TypeScript --generate-visitor --generate-listener false -o generated Express.g4
```

The serialized ATN, which encodes every lexing and parsing decision the generated
code makes, is produced by the tool, not by the runtime. The two tools are required
to produce identical ATNs, and
`typescript/a2ui_agent/tests/unit/inference_formats/express/generated_parser.test.ts`
enforces it by comparing the TypeScript lexer and parser ATNs, value for value,
against Python's checked-in `express_lexer.py` and `express_parser.py`. That check is
stronger than "same jar", because it tests the output rather than trusting the tool.
The places where the two languages can diverge are therefore narrow: runtime library
differences, the shape of the generated visitor, and the hand-written code that sits
on top. The rest of this document is that list.

Python pins the tool to 4.13.2 explicitly, in
[pack_specs_hook.py:143](file:///work/google/a2ui/python/a2ui_agent/pack_specs_hook.py#L143),
and pins the runtime to the matching 4.13.x range in
[pyproject.toml:24](file:///work/google/a2ui/python/a2ui_agent/pyproject.toml#L24).
TypeScript pins `antlr-ng` at exactly 1.0.10 as a devDependency and `antlr4ng` at
exactly 3.0.16 as a runtime dependency; `antlr-ng` itself depends on exactly that
`antlr4ng` version.

### Why not the official tool and runtime

The first attempt used the official 4.13.2 jar with the official `antlr4` npm
runtime. The generated code was fine, and its ATN matched Python's, but the runtime's
own type declarations do not resolve under this package's `"moduleResolution":
"nodenext"`: its `types` entry is `index.d.cts`, which re-exports subdirectories
whose `.d.ts` files are ESM (the package is `"type": "module"`) and use
extensionless relative re-exports such as `export * from './ATN'`. The compile
produced 216 errors, all missing exports from those subdirectories. The official tool
also needs Java, which the npm `antlr4` package does not ship.

`antlr4ng` declares `exports.types` as `dist/index.d.ts` and writes `.js` extensions
on every relative re-export, so it resolves under `nodenext` without workarounds.
`antlr-ng` runs under Node, so the toolchain needs no Java.

`antlr4ng-cli` remains unsuitable. It ships `antlr4-4.13.2-SNAPSHOT-complete.jar`,
a snapshot rather than a release, and still needs Java; `antlr-ng` replaces it.

`antlr4ts` is not viable. Its last release, `0.5.0-alpha.4`, was published on
2021-01-01, and it predates the ANTLR 4.10 change to the serialized ATN format, so it
cannot consume output from a 4.13.2 tool at all.

`antlr4ng` renames some runtime accessors from methods to properties, for example
`parser.numberOfSyntaxErrors`. The TypeScript visitor therefore does not read
line-by-line against Python's. That affects review convenience, not behaviour.

---

## Gotchas

### Generated visitor members are optional properties, not methods

The generated `ExpressVisitor<Result>` extends `antlr4ng`'s
`AbstractParseTreeVisitor<Result>` and declares one optional property per rule, such
as `visitProgram?: (ctx: ProgramContext) => Result`. Each context's `accept` calls
the property if it is set and falls back to `visitChildren` otherwise. Python emits
ordinary methods on `ExpressVisitor`.

Subclassing therefore works differently. In Python,
[ExpressAstVisitor](file:///work/google/a2ui/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/visitor.py#L49)
overrides methods on the prototype chain, and `super()` reaches the base. In
TypeScript, declaring a method where the base declares a property is a type error,
and there is no `super.visitFoo` to call.

The practical rule for the port: assign the overrides as instance properties in the
subclass, and do not write `super.visitX(ctx)` anywhere. If the port needs base
behaviour it calls `this.visitChildren(ctx)`, which behaves as in Python (next item).

Status: verified from the generated `ExpressVisitor.ts` and `ExpressParser.ts`.

### Default visitChildren matches Python

This was the largest divergence under the official JavaScript runtime, whose
`visitChildren` returns an array of every child's result and which has no
`defaultResult`, `aggregateResult`, or `shouldVisitNextChild`. `antlr4ng` follows the
Java and Python design instead.

| | Python 4.13.2 | `antlr4ng` 3.0.16 |
| --- | --- | --- |
| No children | `defaultResult()`, which is `None` | `defaultResult()`, which is `null` |
| With children | the last child's result | the last child's result |
| `defaultResult` | present, overridable | present, `protected` |
| `aggregateResult` | present, returns `nextResult` | present, returns `nextResult` |
| `shouldVisitNextChild` | present, returns `True` | present, returns `true` |

The grammar has 16 parser rules and
[visitor.py](file:///work/google/a2ui/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/visitor.py)
overrides all 16, so the inherited default is not reached today. If a rule is added
without an override, both languages now return the last child's result.

Reviewer action: when a new parser rule appears in a grammar diff, still check that
both visitors gained an override for it. A silent last-child default is rarely what
the compiler wants.

Status: verified by reading `AbstractParseTreeVisitor` in the installed
`antlr4ng@3.0.16` (`dist/index.mjs`) and Python's `Tree.py` at 4.13.2.

### Numbers lose their Python int and float distinction

`NUMBER` at
[Express.g4:157](file:///work/google/a2ui/specification/inference_formats/express/Express.g4#L157)
is `'-'? [0-9]+ ('.' [0-9]+)?`, with no exponent form.
[visitor.py:173-175](file:///work/google/a2ui/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/visitor.py#L173-L175)
turns it into `float(val) if "." in val else int(val)`.

JavaScript has one numeric type, so a naive `Number(val)` diverges twice. Input
`3.0` becomes Python `3.0` and serializes as `3.0`, but becomes JavaScript `3` and
serializes as `3`. An integer above 2^53 stays exact in Python and is rounded in
JavaScript. Both differences reach the wire payload, which is what conformance
compares.

The port needs a deliberate decision here rather than `Number(val)`, and cases at
both boundaries.

Status: verified from the grammar and the visitor. Needs a test.

### String escape handling needs the Unicode flag

[visitor.py:46](file:///work/google/a2ui/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/visitor.py#L46)
unescapes with `re.sub(r"\\([\s\S])", repl, val)`. Python strings are sequences of
code points, so `[\s\S]` captures one whole character even outside the basic
multilingual plane.

JavaScript strings are UTF-16 code units. Without the `u` flag, `/\\([\s\S])/g`
captures a lone surrogate when a backslash precedes an astral character, and the
replacement splits the pair. Use the `u` flag.

The surrounding slicing is safe by accident rather than by design: the delimiters
being stripped in
[visitor.py:184-196](file:///work/google/a2ui/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/visitor.py#L184-L196)
are all ASCII, so counting code points and counting code units give the same answer.
If a future grammar change introduces a non-ASCII delimiter, that stops being true.

Status: verified. Needs a test with an emoji or other astral character after a
backslash.

### IDENTIFIER is ASCII-only, and the prose disagrees

[Express.g4:163](file:///work/google/a2ui/specification/inference_formats/express/Express.g4#L163)
is `[a-zA-Z_] [a-zA-Z0-9_]*`, while the Express specification prose calls for UAX #31
identifiers. The grammar wins, and both implementations inherit the same restriction,
so there is no parity problem today.

It becomes one the moment anybody widens the character class to fix the mismatch.
That change would push the two runtimes onto their differing notions of a character,
so treat a widening of `IDENTIFIER` as a parity-affecting change and not a typo fix.

Status: verified. No action unless the grammar changes.

### Error columns are zero-based on purpose

[compiler.py:268-270](file:///work/google/a2ui/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/compiler.py#L268-L270)
assigns ANTLR's `charPositionInLine` straight into `SyntaxError.offset`, and
[parser.py:94](file:///work/google/a2ui/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/parser.py#L94)
reads it back out into `A2uiCompilationError.column`. ANTLR counts columns from zero;
Python's `SyntaxError.offset` is conventionally one-based. The two conventions are
mixed, and the zero-based value is what ends up in the error the caller sees and what
conformance expects.

Do not correct this in the port. Match it.

Status: verified by reading both files.

### Only the first error is used, so listener order matters

The compiler installs one `ExpressErrorListener` on both the lexer and the parser
after calling `removeErrorListeners()` on each, then reads `errors[0]` and nothing
else. The first error also sets `first_error_line`, which decides how many statements
survive.

Lexer and parser errors interleave according to when the parser pulls tokens from the
stream. Both runtimes fill the token stream lazily in the same way, so the order
should match, but "should" is doing real work in that sentence and the consequence of
being wrong is a different truncation point rather than a visible error.

Status: reasoned, not verified. Worth a case with a lexer error and a parser error on
different lines.

### getText is safe here

Every ignored token in the grammar uses `-> skip`: `COMMENT`, `BLOCK_COMMENT`,
`SEMICOLON`, and `WS`, at
[Express.g4:166-169](file:///work/google/a2ui/specification/inference_formats/express/Express.g4#L166-L169).
Skipped tokens never enter the token stream in either runtime, so `getText()` cannot
pick them up and the two languages agree.

This would change if a future grammar revision moved any of them to
`-> channel(HIDDEN)` in order to preserve comments. Treat that as a parity-affecting
change.

Status: verified from the grammar.

### Error message text is not a stable contract

Both runtimes produce their own wording for syntax errors, and the strings are not
guaranteed to match across targets. Conformance cases should assert on the error
category, line, and column, not on the message.

Status: reasoned. Relevant when extending the harness error-category map.

---

## Build integration

Both problems predicted here before step 2 were settled by running it on 2026-09-23.

Relative imports: `antlr-ng` writes `.js`-suffixed relative imports
(`import { ExpressVisitor } from "./ExpressVisitor.js"`), as does the official 4.13.2
tool, so no post-generation step is needed under `nodenext`.

Runtime types: the official `antlr4` runtime's declarations did fail under
`nodenext`, for the reason given in "Why not the official tool and runtime" above,
which is what moved the toolchain to `antlr4ng`. With `antlr4ng`, the generated
files type-check cleanly under this package's `tsconfig.check.json`.

`antlr-ng` defaults to `--exact-output-dir`, so output goes straight into `-o`
regardless of the grammar's path, and its generated files carry no header that embeds
a path or timestamp. Regeneration is byte-for-byte deterministic. ESLint already
ignores `**/generated/**`, and the package's `.prettierignore` covers Prettier.

---

## Reviewer checklist for a grammar change

* Did a parser rule get added? Both visitors need an override, or the two languages
  will disagree about what the rule returns.
* Did a lexer rule change its character class? Check whether it moved from ASCII-only
  to something wider.
* Did an ignored token move from `-> skip` to a hidden channel? `getText()` results
  change.
* Did `NUMBER` gain an exponent or a larger range? Revisit the integer and float
  split.
* Did a string delimiter become non-ASCII? Revisit the slicing in the visitors.
* Were both SDKs regenerated in the same change? The TypeScript ATN parity test fails
  until they are.

---

## Verification log

Checked on 2026-09-22 against `feat/ts-agent` at commit `4e91ad9a`.

Read from the repository: the grammar's lexer rules, including `NUMBER` at line 157,
`IDENTIFIER` at line 163, and the four `-> skip` rules at lines 166 to 169; all 16
overrides in `visitor.py` against the 16 `visitChildren` defaults in
`generated/express_visitor.py`; the escape substitution at `visitor.py:46`; the number
conversion at `visitor.py:173-175`; the error listener setup and `err.offset = col` at
`compiler.py:255-272`; the column read at `parser.py:94`; the ANTLR pins at
`pyproject.toml:24` and `42-43`; and the tool version and working directory at
`pack_specs_hook.py:143` and `147`.

Read from upstream ANTLR at tag 4.13.2: `doc/targets.md`, which lists TypeScript as a
target; `doc/typescript-target.md`, for the `-Dlanguage=TypeScript` invocation, the
statement that the TypeScript runtime is the JavaScript runtime plus type files, and
the lambda-based visitor and listener generation;
`runtime/JavaScript/src/antlr4/tree/ParseTreeVisitor.js`; and
`runtime/Python3/src/antlr4/tree/Tree.py`. The same target document on the `dev`
branch is byte-identical to the tagged copy apart from trailing whitespace, so the
instructions are current and not specific to that release.

Read from npm: `antlr4` at version 4.13.2, BSD-3-Clause, `"type": "module"`, types
declared at `src/antlr4/index.d.cts`, with the `node` condition ahead of `types` in
its `exports` map, and 1,204,823 downloads in the week ending 2026-09-21; the file
listing of the 4.13.2 tarball, which contains four bundles under `dist/` and 68
declaration files under `src/antlr4/`, with no `.d.mts`; `antlr4ng` at 3.0.16 with
182,538 downloads over the same week; the file listing of `antlr4ng-cli` at 2.0.0,
which contains `antlr4-4.13.2-SNAPSHOT-complete.jar`; and `antlr4ts` at
`0.5.0-alpha.4`, whose npm record was last modified on 2022-06-13 and whose latest
version was published on 2021-01-01.

The npm registry was read over HTTPS rather than with the `npm` client, which is
blocked in this environment by a registry proxy.

Revised on 2026-09-23 after running step 2. The official jar's TypeScript output had
the same parser ATN as Python and identical `.interp` files; the `antlr4@4.13.2`
runtime then failed to type-check under `nodenext` with 216 errors. `antlr-ng@1.0.10`
output, installed with `antlr4ng@3.0.16`, has a parser ATN (1,416 values) and lexer
ATN (1,985 values) identical to Python's including signs, identical `.interp` and
`.tokens` files, compiles cleanly under `nodenext`, and parses a sample program with
zero syntax errors under vitest. A first version of the ATN comparison dropped minus
signs from both sides; the vitest version compared signed values against the
generated array, caught the lexer ATN's `-1`, and the Python-side extraction was
fixed to read signed values.
