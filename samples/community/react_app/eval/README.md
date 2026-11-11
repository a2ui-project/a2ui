# ReactApp evals

Two suites for the ReactApp prototype, built on the A2UI eval runner in [`eval/`](../../../../eval/) (Inspect AI, Express strategy):

1. `react_app_v1_0`: twelve ReactApp requests. Each use case in [`docs/use_cases.md`](../docs/use_cases.md) gets three samples (loan explorer, drag-to-reorder itinerary with the `estimateTravelTime` agent function, sales brush with the `querySales` agent function), plus a stopwatch, a color picker and a sortable table that calls a local function.
2. `express_multiline_v1_0`: eight samples that put code, Markdown, a regex, quotes and the `<a2ui>` tags in string values, plus one ReactApp source.

Both suites reuse the runner's Express solver chain (`format_system_prompt`, generation, `compile_format_payload`) and its scorers (`a2ui_scorer` for Stage 1 validation and Stage 2 assertions, `measured_model_graded_qa` for the LLM judge). They add the ReactApp prompt fragment (`react_app_prompt` from `a2ui-react-app`) when a sample's catalogs include the ReactApp catalog, plus a scorer of their own:

| Suite                    | Checks (each one has its own pass rate)                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react_app_v1_0`         | `present` (a ReactApp exists), `compiles` (Sucrase, as the frame runtime does), `typechecks` (TypeScript against `a2ui.d.ts` and `@types/react`; reported, not required), `paths` (the app reads or writes every path the sample expects), `functions` (it calls every function the sample expects), `imports` (only `react` and `a2ui`, a default export, no `"""`), `styling` (primitives, `theme` or `var(--a2ui-*)`, and no color literals) |
| `express_multiline_v1_0` | `parses`, `raw_strings` (every value of three or more lines that can be raw was written `r"""..."""`), `literals` (the expected strings appear verbatim), `roundtrip` (decompiling and recompiling keeps every string byte for byte)                                                                                                                                                                                                            |

A sample passes when Stage 1/2 pass, every hard check passes and the judge grades it C. The generator and the judge are both `gemini-3.5-flash`.

## Running

The suites live in their own uv project, with editable path dependencies on `eval/`, the agent SDK and `a2ui-react-app`. The TypeScript compile and type check run in the worker of [`@a2ui-labs/react-app-compiler`](../typescript/react_app_compiler/), so run `yarn install && yarn build` in `samples/community/react_app` first.

```bash
cd samples/community/react_app/eval
export GEMINI_API_KEY=...
uv run python -m react_app_eval.run --suite all --epochs 3   # writes logs/report.md
uv run python -m react_app_eval.run --suite react_app --epochs 1 --limit 2
uv run pytest                                                # scorers, checker and datasets, no model
uv run inspect view start --log-dir logs                     # browse the traces
```

`--epochs` runs every sample that many times; the report gives the pass rate per run and over all runs, the pass rate of each check, the judge grades, the pass rate per sample and the most frequent failure modes.

## Datasets

The datasets follow the eval runner's [schema](../../../../eval/datasets/dataset_schema.json), plus an `expect` block that the scorers read (paths, functions, literals, `multiline`, `allow_color_literals`); [`react_app_eval/dataset.py`](react_app_eval/dataset.py) documents it. Like `eval/datasets/`, every YAML file in [`datasets/`](datasets/) is encrypted at rest with Transcrypt (see the `.gitattributes` there): unlock the repository with `eval/bin/transcrypt` before reading or editing them, and check that `git diff --cached` shows ciphertext before committing.

The agent functions of the use cases are declared in [`catalogs/agent_functions.json`](catalogs/agent_functions.json).
