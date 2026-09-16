# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff |
| :------------------------------- | :------- | :------ | :--- |
| **Pytest Conformance**           | PASS     | FAIL    | -    |
| **Overall Pass Rate**            | 100.0%   | N/A     | -    |
| **Algorithmic Schema Pass Rate** | 100.0%   | N/A     | -    |

## Pytest Unit Test Failure

`FAILED agent_sdks/python/a2ui_agent/tests/test_atom_format.py::TestAtomFormat::test_compiler_primitives_and_relative_paths`
`KeyError: 'extra'`
`self.assertEqual(txt["extra"], None)`

Auto-omitting optional null properties broke existing compiler specification contract. Reverted change immediately.
