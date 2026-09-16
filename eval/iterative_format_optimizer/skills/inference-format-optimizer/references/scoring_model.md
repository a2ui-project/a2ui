# Formal Scoring Model & Decision Guardrails

This reference details the quantitative decision model, correctness guardrails, efficiency caps, and composite score formula ($S_{\text{opt}}$) for A2UI format optimizations.

---

## 1. Correctness Guardrails (Non-Negotiable)

Every candidate format iteration must pass all correctness guardrails. If any guardrail fails, the iteration **MUST BE REVERTED**:

1. **Pytest Unit Conformance**: Must be `PASS` (100% unit tests passing).
2. **Algorithmic Schema Pass Rate (`SchemaAcc`)**: Pass rate of output payloads against the target catalog JSON schema (`a2ui_scorer`). Must be $\ge$ Baseline.
3. **Quality Score (`QualityScore`)**: Model-graded QA semantic intent match (`measured_model_graded_qa`). Must be $\ge$ Baseline.

---

## 2. Efficiency Regression Caps (Non-Negotiable REVERT Triggers)

An iteration **MUST BE REVERTED** if any of the following efficiency caps are exceeded relative to baseline/previous run:

- **Code Output Tokens**: Increases by **> 5%** (prevents format verbosity expansion).
- **Streaming Latency (`Non-reasoning Output Time`)**: Increases by **> 10%** (prevents code streaming bottlenecks).
- **Reasoning Tokens**: Increases by **> 15%** (prevents prompt instruction search space ambiguity).

---

## 3. Composite Optimization Score ($S_{\text{opt}}$)

The composite score $S_{\text{opt}}$ balances accuracy gains against token and latency overheads:

\[
S\_{\text{opt}} = 0.50 \cdot \text{SchemaAcc} + 0.30 \cdot \text{QualityScore} - 0.15 \cdot \left(\frac{\text{CodeTok}}{\text{BaseCodeTok}}\right) - 0.05 \cdot \left(\frac{\text{ReasonTok}}{\text{BaseReasonTok}}\right) - 0.03 \cdot \left(\frac{\text{InputTok}}{\text{BaseInputTok}}\right)
\]

### Decision Rule:

- If $S_{\text{opt}}(\text{Current}) > S_{\text{opt}}(\text{Baseline})$ $\rightarrow$ **KEEP CHANGE** (`--status KEEP`)
- If $S_{\text{opt}}(\text{Current}) \le S_{\text{opt}}(\text{Baseline})$ $\rightarrow$ **REVERT CHANGE** (`--status REVERT`)
