# @a2ui/conformance-timing

Runs the timing cases of the A2UI conformance suites (the YAML test cases under `conformance/`) for the TypeScript packages. It is a private workspace and is not published.

A timing case times an operation rather than checking what it returns, so that an operation whose cost grows with the square of its payload fails a test. The cases use two actions, both described in [`conformance/conformance_schema.json`](../../conformance/conformance_schema.json):

1. `measure_growth` times the operation on the payload written at two sizes, n and 4n, and fails when the time at 4n is more than `max_ratio` times the time at n.
2. `measure_overhead` times the operation against a baseline on one payload, and fails when it takes more than `max_ratio` times as long.

[`conformance/agent/direct_json/scaling.yaml`](../../conformance/agent/direct_json/scaling.yaml) explains the measure and how a harness times a case. This package does the parts every harness shares: it reads a suite, writes a case's payload at a size, runs each operation once untimed and then at least five times in turn, and compares the median times. A package supplies the operation to time.

## Usage

```js
import {loadConformanceSuite, measureGrowth} from '@a2ui/conformance-timing';

for (const testCase of loadConformanceSuite('core/message_processor_scaling.yaml')) {
  // `prepare` returns the operation to time on the payload written at `size`.
  // Work done in `prepare` itself, such as decoding the payload, is not timed.
  measureGrowth(testCase, (payload, size) => {
    const messages = JSON.parse(payload);
    return () => processMessages(messages);
  });
}
```

`measureGrowth` and `measureOverhead` throw an `AssertionError` when the ratio is above the case's `max_ratio`, and otherwise return the median times. When Node runs with `--expose-gc`, garbage is collected before each timed run.

Times depend on the machine and its load, so a package runs these cases in a script of their own, `test:timing`, rather than in `test`, and one at a time. See [`typescript/core/web_core/tests/timing`](../core/web_core/tests/timing) for a runner.

## Development

```bash
yarn test
yarn lint
yarn format:check
```
