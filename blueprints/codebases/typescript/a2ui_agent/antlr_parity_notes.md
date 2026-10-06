# ANTLR parity notes for Express grammar reviewers

Python is the reference implementation of the Express grammar, and TypeScript follows
it. These notes are for reviewing a change to
`specification/inference_formats/express/Express.g4`, or to either hand-written
visitor, so that a difference between the two languages shows up in review rather than
as a conformance failure.

## Two tools, one ATN

The two SDKs generate their parsers from the same `.g4` file with different tools:

```bash
# Python: the official ANTLR 4.13.2 Java tool, via antlr4-tools
antlr4 -Dlanguage=Python3 -visitor -no-listener -o generated Express.g4
# TypeScript: antlr-ng 1.0.10, a TypeScript port of the 4.13.2 tool
antlr-ng -Dlanguage=TypeScript --generate-visitor --generate-listener false -o generated Express.g4
```

The serialized ATN encodes every lexing and parsing decision, and the tool produces
it, not the runtime. `generated_parser.test.ts` in the TypeScript package compares the
TypeScript lexer and parser ATNs, value for value, with Python's checked-in
`express_lexer.py` and `express_parser.py`. So the two languages can only differ in
their runtime libraries and in the hand-written code on top.

Python pins the tool in `python/a2ui_agent/scripts/generate_express_parser.py` and the
runtime in `pyproject.toml`. TypeScript pins `antlr-ng` 1.0.10 and its runtime,
`antlr4ng` 3.0.16, exactly. The official `antlr4` npm runtime isn't used because its
type declarations don't resolve under `"moduleResolution": "nodenext"`, and `antlr-ng`
runs on Node without Java.

## Rules for the visitors

- The generated TypeScript visitor declares each `visitX` as an optional property, not
  a method. Assign overrides as instance properties, never call `super.visitX(ctx)`,
  and use `this.visitChildren(ctx)` for the default. As in Python, the default returns
  the last child's result.
- Error columns are zero-based in both languages, because Python passes ANTLR's
  `charPositionInLine` through unchanged. Match that rather than correcting it.
- Each runtime words syntax errors its own way. Conformance cases assert on the error
  category, line and column, never on the message.

## Reviewer checklist for a grammar change

- Did a parser rule get added? Both visitors need an override for it. Otherwise each
  silently returns the last child's result.
- Did a lexer rule's character class widen beyond ASCII, for example `IDENTIFIER`?
  Python counts code points and JavaScript counts UTF-16 code units, so the two can
  start to disagree.
- Did an ignored token move from `-> skip` to a hidden channel? `getText()` results
  change.
- Did `NUMBER` change, for example by gaining an exponent? Recheck how each SDK turns
  the text into a number, and how each decompiler writes one back.
- Did a string delimiter become non-ASCII? Recheck the slicing in both visitors.
- Were both SDKs regenerated in the same change? The ATN parity test fails until they
  are.
