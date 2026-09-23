# ANTLR parity notes for Express grammar reviewers

Python is the reference implementation of the Express grammar. TypeScript follows it.
These notes exist so that a reviewer of a change to
`specification/inference_formats/express/Express.g4`, or to either hand-written
visitor, can tell whether the change will behave the same in both languages, instead
of waiting for a conformance failure to say so.

This document is written before the TypeScript implementation exists. Everything
below about Python and the grammar is checked against the repository. Everything
about TypeScript is checked against the published ANTLR 4.13.2 runtime and the
official target documentation, but has not yet been run. Items that still need a
test say so. When the TypeScript Express implementation lands, this file moves next
to it, at `typescript/a2ui_agent/src/inference_formats/express/`.

---

## One tool, two targets

There is a single ANTLR tool, written in Java, and it generates code for every
target. TypeScript is one of its official targets, so both languages are generated
by the same jar from the same `.g4` file:

```bash
antlr4 -Dlanguage=Python3    -visitor -no-listener -o generated Express.g4   # Python
antlr4 -Dlanguage=TypeScript -visitor -no-listener -o generated Express.g4   # TypeScript
```

The TypeScript target is the JavaScript runtime plus type declarations. The ANTLR
documentation states the consequence directly: "Antlr4 TypeScript runtime uses the
JavaScript runtime and adds type files to it. This guarantees the same behaviour and
performance across both target languages."

This matters more than it first appears. The serialized ATN, which encodes every
parse decision the generated parser makes, is produced by the tool, not by the
runtime. Same jar plus same `.g4` means the same ATN and the same parse. The places
where the two languages can diverge are therefore narrow: runtime library
differences, the shape of the generated visitor, and the hand-written code that sits
on top. The rest of this document is that list.

Python pins the tool to 4.13.2 explicitly, in
[pack_specs_hook.py:143](file:///work/google/a2ui/python/a2ui_agent/pack_specs_hook.py#L143),
and pins the runtime to the matching 4.13.x range in
[pyproject.toml:24](file:///work/google/a2ui/python/a2ui_agent/pyproject.toml#L24).
TypeScript must use the same 4.13.2 jar and the `antlr4` npm runtime, whose current
release is also 4.13.2.

Python runs the tool with the working directory set to the grammar's own directory,
at [pack_specs_hook.py:147](file:///work/google/a2ui/python/a2ui_agent/pack_specs_hook.py#L147),
so that generated headers do not embed an absolute machine path. Do the same in the
TypeScript codegen script, or every regeneration will produce a spurious diff.

### Do not use antlr4ng-cli

`antlr4ng` is a well-maintained alternative runtime, but it comes with its own
command line tool, `antlr4ng-cli`, and that package ships
`antlr4-4.13.2-SNAPSHOT-complete.jar`. A snapshot build is not the released 4.13.2
that Python uses. Two different jars means the "same tool, same ATN" argument no
longer holds, and Python stops being a reliable reference. `antlr4ng` also renames
runtime accessors from methods to properties on purpose, which breaks the
line-by-line correspondence between the two visitors that makes review possible.

`antlr4ts` is a third option and is not viable. Its last release,
`0.5.0-alpha.4`, was published on 2021-01-01, and it predates the ANTLR 4.10 change
to the serialized ATN format, so it cannot consume output from the 4.13.2 tool at
all.

---

## Gotchas

### Generated visitor members are lambdas, not methods

The TypeScript target does not emit a visitor interface. It emits a class whose
per-rule members are assigned as lambdas. Python emits ordinary methods on
`ExpressVisitor`.

Subclassing therefore works differently. In Python,
[ExpressAstVisitor](file:///work/google/a2ui/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/visitor.py#L49)
overrides methods on the prototype chain, and `super()` reaches the base. In
TypeScript, a subclass field declaration overwrites an instance property that the
base constructor has already assigned, and `super.visitFoo` is not a method to call.

The practical rule for the port: assign the overrides as instance properties in the
subclass, and do not write `super.visitX(ctx)` anywhere. If the port needs base
behaviour it must call the runtime's `visitChildren` explicitly, which leads directly
to the next item.

Status: verified from the ANTLR target documentation. The exact generated shape
should be pinned by a test once the first generation runs.

### Default visitChildren behaves differently

The two runtimes disagree about what visiting a rule with no override returns.

| | Python 4.13.2 | JavaScript and TypeScript 4.13.2 |
| --- | --- | --- |
| No children | `defaultResult()`, which is `None` | `null` |
| With children | the last child's result | an array of every child's result |
| `defaultResult` | present, overridable | absent |
| `aggregateResult` | present, returns `nextResult` | absent |
| `shouldVisitNextChild` | present, returns `True` | absent |

Python's `ParseTreeVisitor.visitChildren` loops over children and folds them with
`aggregateResult`, whose default returns the newest result, so the effective return
is the last child's value. The JavaScript `ParseTreeVisitor.visitChildren` calls
`visit(ctx.children)`, and `visit` maps over arrays, so the effective return is a
list.

Today this is latent rather than active. The grammar has 16 parser rules and
[visitor.py](file:///work/google/a2ui/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/visitor.py)
overrides all 16, so the inherited default is never reached. That is exactly why it
is dangerous: the first time someone adds a rule to `Express.g4` without adding an
override, Python will quietly return one value and TypeScript will quietly return an
array.

Reviewer action: when a new parser rule appears in a grammar diff, check that both
visitors gained an override for it.

Status: verified by reading both runtimes at tag 4.13.2 and counting the overrides.

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

Two problems are worth knowing about before step 2 starts, because both are easier to
handle in the codegen script than to discover during the build.

The generated TypeScript uses extensionless relative imports, as in
`import MyGrammarLexer from './MyGrammarLexer'`. `@a2ui/agent` is an ES module
compiled with `"moduleResolution": "nodenext"`, which requires explicit `.js`
extensions on relative imports. Expect to append extensions as a post-generation
step.

The `antlr4` package's own type declarations may not resolve. It ships
`src/antlr4/index.d.cts` and a tree of `.d.ts` files, with no `.d.mts` and no
declarations beside `dist/`. Its `exports` map lists the `node` condition before the
`types` condition, so under `nodenext` TypeScript is likely to match `node`, resolve
to `dist/antlr4.node.mjs`, look for a neighbouring `dist/antlr4.node.d.mts`, and fail
to find one. The workaround is a local declaration or a `paths` entry pointing at
`antlr4/src/antlr4/index.d.cts`.

Status: the package contents and the condition order are verified from the published
tarball listing and metadata. The resolution failure itself is predicted and should
be confirmed with a one-file compile probe as the first task of step 2, since it is
cheap to check and changes how the dependency is wired.

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
* Was the generated code regenerated with 4.13.2 for both targets, from the grammar's
  own directory?

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
