# **Technical Design for the A2UI Large Language Model Evaluation Framework**

The shift toward agentic systems that interact with users through dynamic interfaces necessitates a fundamental reimagining of how large language models are evaluated. The A2UI project represents a pivotal effort to standardize the declarative generation of user interfaces, moving away from the risks of executable code toward a secure, JSON-based intent protocol. However, the efficacy of an A2UI implementation depends entirely on the model's ability to reliably translate high-level user instructions into valid, contextually aware, and renderable JSON structures. Evaluating this capability requires a framework that is simultaneously rigorous, model-agnostic, and secure within the constraints of an open-source development lifecycle.

The proposed design utilizes the Inspect AI framework as its core orchestration engine, providing a modular architecture of datasets, solvers, and scorers. This document outlines the engineering specifications for the A2UI evaluation framework, drawing architectural inspiration from the `flutter/evals` work while optimizing for a Python-native environment compatible with the Inspect ecosystem. The framework addresses the complex interplay between model performance, secret management in continuous integration (CI) pipelines, and the critical challenge of preventing data contamination in public repositories.

## **Architectural Philosophy and Framework Integration**

The core architecture of the A2UI evaluation framework is built upon the principle of functional isolation, ensuring that the logic governing evaluation is decoupled from the specific models under test and the transport protocols used to deliver UI payloads. This decoupling is essential for the A2UI project, which aims to be framework-agnostic and portable across various rendering environments such as Flutter, React, or native web components.

### **Systematic Mapping to Inspect AI**

The framework adopts the three-pillar architecture of Inspect AI (Tasks, Solvers, and Scorers) to create a unified evaluation pipeline. In this context, a Task defines the high-level evaluation objective, such as "Validating Form Generation" or "Testing Adaptive Layouts".

| Inspect Component | A2UI Implementation Detail                                                                              | Primary Responsibility                                            |
| :---------------- | :------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------- |
| Dataset           | Encrypted YAML files conforming to `datasets/dataset_schema.json`.                                      | Providing structured `messages` turns, catalogs, and UI targets.  |
| Solver            | Uses an `InferenceFormat` to inject system prompt and protocol rules.                                   | Orchestrating the model's attempt to generate a valid UI payload. |
| Scorer            | `a2ui_scorer` (Stage 1 validation, Stage 2 assertions) then `measured_model_graded_qa` (Stage 3 judge). | Determining technical validity and semantic intent quality.       |
| Model Provider    | Gemini, OpenAI, Anthropic, OpenRouter, and local Ollama, vLLM or OpenAI-compatible servers.             | Standardizing API interactions across diverse model families.     |

The interaction flow begins with loading a dataset sample. Each sample names one `catalog` or a list of `catalogs`, an optional domain `system_prompt`, and a list of `messages`. The messages hold the conversation history: user requests, assistant responses, and tool calls. The solver merges the domain system prompt with A2UI protocol instructions and passes the conversational context to the model. The generated UI payload then goes through the three-stage scoring funnel described below.

### **Integration with A2UI Python SDK**

To ensure consistency between the evaluation framework and the actual agent implementation, the framework integrates the A2UI Python SDK. Cross-SDK parity for prompt generation and LLM output parsing is verified deterministically by the repository's conformance suite (`conformance/`), so evaluation runs execute against the Python SDK.

| SDK Component     | Role in Evaluation                                                                           | Benefit                                                                                                          |
| :---------------- | :------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `InferenceFormat` | Generates the system prompt for the Solver (for example `DirectJsonFormat`).                 | Ensures the model receives the correct schema and catalog definitions without manual hardcoding in eval scripts. |
| `CatalogConfig`   | Loads catalog schemas and applies component and function pruning transformers.               | Matches the exact pruned catalog surface an agent exposes at runtime.                                            |
| `Parser`          | Unwraps and compiles A2UI blocks (`unwrap`, `compile`) and checks streaming (`open_stream`). | Extracts and compiles payloads across Direct JSON, Express, Elemental, and Atom formats.                         |
| `RendererState`   | Applies seed and compiled messages (`apply`) and validates surface trees (`check_topology`). | Centralizes Stage 1 schema and topology validation, matching runtime state checks across SDKs.                   |

### **Isolated Validation Runner (`a2ui_eval/runner.py`)**

`a2ui_eval/runner.py` exposes `generate_prompt` to build format prompts and `parse_and_validate` to parse and validate model completions in a pooled Python worker process, isolating the harness from runaway regexes or parser loops under `DEFAULT_PARSE_TIMEOUT_SEC`.

All format strategies (`direct`, `express`, `elemental`, and `atom`), `skill_mode`, and the `subagent_tool` specialist call `parse_and_validate` with `validate=True` during solver execution. The solver stores the validated messages in `state.metadata["compiled_messages"]`, and the Stage 1 scorer reuses them instead of parsing again.

### **Runner Options**

A sample can ask for more than a single, unpruned catalog. `runner.py` defines `RunnerOptions`, a frozen dataclass that carries everything the inference layer needs beyond the format and version:

- `catalogs`: an ordered tuple of `CatalogSpec`. Each spec holds the catalog `path` and an optional `catalog_id` for documents that state none. `allowed_components` and `allowed_functions` prune the catalog. `examples` lists the few-shot example files for that catalog. The first catalog is the default.
- `allowed_messages`: the message types the model may write, or `None` for all of them.
- `initial_renderer_state`: messages applied to a fresh renderer state before the model's turn is validated, so a turn can update an existing surface.
- `stream_chunk_size`: when set, the runner also feeds the completion through the format's streaming parser in slices of this size. It fails if the streamed parse disagrees with the whole-text parse.

`runner_options_from_metadata` builds these options from the sample metadata that `load_a2ui_dataset` writes (`catalog_specs`, `allowed_messages`, `initial_state`, `stream_chunk_size`) and resolves every path against the repository root.

`generate_prompt` and `parse_and_validate` accept `options`. `generate_prompt` applies them in process, and `parse_and_validate` serializes them with `to_dict()` across the worker pipe. `cache_key()` gives a deterministic string so prompt caches can key on the options.

### **Validation Retries and Pass@K**

`compile_format_payload` accepts `max_validation_retries`. When an attempt fails strict validation and retries remain, the solver sends the validation error back to the model and compiles the new completion. The metadata records `pass_at_1` (the first attempt validated), `pass_at_k` (some attempt within the budget validated) and `validation_retries_used`.

The `subagent_tool` strategy applies the same loop to the specialist call and records `subagent_pass_at_1` and `subagent_validation_retries_used`. The default budget is zero, so a run reports Pass@1 unless a retry budget is requested.

### **Replicating and Enhancing the Eval Lifecycle**

While the `flutter/evals` project provides a useful reference for managing complex datasets, the A2UI framework moves away from Dart-based CLI tools (`devals`) in favor of a native Python implementation within the `a2ui/evals` worktree. This ensures deeper integration with the Python-based Inspect libraries and simplifies the contribution process for the broader machine learning community.

The lifecycle consists of four distinct phases:

1. Resolution: Converting encrypted scenario definitions into runtime Sample objects.
2. Execution: Parallelized model calls orchestrated by Inspect's asynchronous architecture.
3. Scoring: Multi-dimensional grading covering structure, intent, and safety.
4. Analysis: Generating standardized logs for visualization in the Inspect View tool or VS Code extension.

## **Dataset Engineering and Contamination Mitigation**

In an open-source context, the integrity of evaluation data is constantly threatened by model training crawlers that ingest public repositories. If evaluation prompts and their corresponding "gold" answers are indexed, future models will exhibit inflated performance due to memorization rather than actual reasoning capabilities. This is known as data contamination.

### **The Encryption-at-Rest Strategy**

To satisfy the requirement for both human readability and crawler resistance, the framework implements transparent encryption using **Transcrypt**. Evaluation scenarios are authored in human-readable YAML format but are encrypted at rest in the repository.

| Feature           | Plaintext Storage                 | Transcrypt Encryption                        |
| :---------------- | :-------------------------------- | :------------------------------------------- |
| Human Readability | High (Directly visible on GitHub) | High (For authorized contributors with keys) |
| Model Indexing    | Extremely High Risk               | Negligible (Encrypted binary data)           |
| CI Integration    | Trivial                           | Requires secret injection in GitHub Actions  |
| Versioning        | Standard Git diffs                | Handled by Transcrypt transparently          |

### **Dataset Encryption Policy**

The policy is simple: every YAML file under `eval/datasets/` is encrypted, with no exceptions for "small" or "synthetic" samples. The `.gitattributes` file in that directory applies the `crypt` filter to `*.yaml`, so a contributor who has unlocked Transcrypt never has to think about it. Two things stay in plaintext on purpose. `dataset_schema.json` holds no prompts. `eval/examples/example_eval_case.json` is a single reference sample that shows the format to people without the key.

The tools that write datasets enforce the same rule. `bin/import_trace.py` and `bin/expand_cases.py` refuse to write a YAML file anywhere inside the repository other than `eval/datasets/`. A sample that was captured from a real session would otherwise be one careless `--output` away from being public.

Contributors get the password on request from an A2UI team member. The CI workflow receives it as a repository secret and unlocks the datasets before running `main.py`.

### **Implementation: Transparent Encryption with Transcrypt**

Transcrypt is a Bash script that uses OpenSSL to provide transparent encryption via Git clean/smudge filters.

**Why Transcrypt for A2UI:**

- **String-Based Secrets**: Unlike `git-crypt`, which requires a binary key file, Transcrypt can be unlocked using a simple password string. This is highly ergonomic for CI/CD pipelines where the secret is stored as a string environment variable.
- **Zero-Install Contribution**: Transcrypt is a standalone script committed to `eval/bin/`. Contributors do not need to install system-level packages; they run the local script to unlock the repo.
- **Transparency**: Once a developer runs the unlock command, they can use standard Git commands (`add`, `commit`, `push`). The encryption and decryption happen automatically in the background via `.gitattributes`.

**Configuration Strategy:**

1.  **Repository Structure**: The evaluation scenarios are authored in human-readable YAML in `eval/datasets/*.yaml`.
2.  **Filter Definition**: A `.gitattributes` file is placed in the datasets folder: `*.yaml filter=crypt diff=crypt merge=crypt`.
3.  **Key Rotation**: If the evaluation password is compromised, developers can use Transcrypt’s built-in `--rekey` command to rotate the password and re-encrypt all files in a single step.

## **Multi-Model Provider Integration and Configuration**

A primary goal of the A2UI framework is to facilitate objective comparisons across the LLM landscape. The framework must operate seamlessly with Google’s Gemini models while providing equal support for OpenAI, Anthropic, and open-weights models like Llama or Mistral.

### **Standardizing Model API Interactions**

Inspect AI provides built-in providers for the most common lab APIs and for local servers. `main.py` passes the `--model` name straight to Inspect, so the provider prefix selects the client.

| Provider Family | Model prefix                                 | Notes                                                                             |
| :-------------- | :------------------------------------------- | :-------------------------------------------------------------------------------- |
| Google Gemini   | `google/`                                    | Default for inference and for the judge. The only provider run in CI.             |
| OpenAI          | `openai/`                                    | Run on demand.                                                                    |
| Anthropic       | `anthropic/`                                 | Run on demand. Client installed with `uv sync --extra frontier`.                  |
| OpenRouter      | `openrouter/`                                | Run on demand.                                                                    |
| Local servers   | `ollama/`, `vllm/`, `openai-api/<provider>/` | Ollama, vLLM, llama.cpp and LM Studio. `--model-base-url` overrides the endpoint. |

Local servers handle far less concurrency than hosted APIs. `main.py` therefore offers `--profile local` and `--profile offline`. Both lower `--max-samples` and `--max-connections` and raise `--working-limit`; `offline` also disables the judge.

## **Secure Secret Management in CI/CD Pipelines**

Running evaluations in a continuous integration environment presents a risk: the exposure of API keys. To balance security with implementation simplicity, the A2UI framework utilizes standard GitHub Environment Secrets.

### **Environment Variable Strategy**

Instead of complex identity federation, we utilize the standard `secrets` vault provided by GitHub Actions.

- Repository Secrets: API keys (e.g., `GOOGLE_API_KEY`, `OPENAI_API_KEY`) are stored in the GitHub repository settings. These are encrypted at rest and only decrypted during workflow execution.

- Injection: Secrets are injected into the CI environment as standard environment variables, which the Inspect framework automatically detects.

- Protection:
  - Redaction: GitHub automatically masks these secrets in logs.
  - Approvals: For open-source projects, "Environment" secrets can require manual approval from a maintainer before they are made available to a workflow triggered by a fork. This prevents malicious pull requests from exfiltrating keys.

## **Multi-Stage Scoring and Validation Logic**

Evaluating an A2UI response requires more than checking that the output is valid JSON. The framework scores each sample through a gated funnel of three stages. A sample that fails a stage does not reach the next one, so the expensive judge only sees payloads that are already structurally correct. The stages are implemented in `a2ui_eval/scorers.py` as two Inspect scorers that run in order: `a2ui_scorer` (Stages 1 and 2) and `measured_model_graded_qa` (Stage 3).

### **Stage 1: Structural & Schema Validation (Programmatic)**

The Python evaluation runner parses the completion and runs strict validation against the active catalogs, with the sample's `RunnerOptions` applied. When a format solver has already compiled the payload, the scorer reuses `state.metadata["compiled_messages"]` instead of parsing the completion again. A solver failure (a timeout or a parse error recorded by the solver) is scored as a Stage 1 failure. The result is binary: the payload is either a valid set of A2UI messages or it is not.

### **Stage 2: Deterministic Assertions**

`evaluate_stage2_assertions` checks the compiled messages against the sample's `assertions` block, parsed into `Stage2Assertions`. The checks are name lookups over the compiled payload and involve no model:

| Assertion              | Passes when                                                                 |
| :--------------------- | :-------------------------------------------------------------------------- |
| `required_components`  | Every listed component type appears at least once.                          |
| `forbidden_components` | No listed component type appears.                                           |
| `required_bindings`    | Every listed data model path (such as `/booking/date`) is bound or written. |
| `required_actions`     | Every listed action event name is dispatched by some component.             |
| `message_types`        | The payload contains only the listed message types.                         |
| `catalog_ids`          | Every listed catalog id is named by some surface or component.              |

An empty or missing `assertions` block asserts nothing, so Stage 2 passes. `a2ui_scorer` records the combined Stage 1 and 2 verdict in `state.metadata["a2ui_stage12_passed"]` and lists every failed assertion in its explanation.

### **Stage 3: Intent Alignment & Quality (LLM-as-a-judge)**

`measured_model_graded_qa` wraps Inspect's `model_graded_qa`. The grading model receives the compiled payload and the sample's `target` rubric. It returns one of three grades: `C` (correct), `P` (partially correct) or `I` (incorrect). The scorer also records the judge's token usage and duration in the sample metadata.

The judge is gated on the earlier stages. When `a2ui_stage12_passed` is `False`, the scorer returns `I` without calling the model. When the run was started with `--no-judge`, the scorer never calls the model and returns `C` for a sample that passed Stages 1 and 2. This makes an offline run against a local model possible with no judge credentials, at the cost of measuring structure only.

### **What Counts as a Pass**

`bin/report_evals.py` defines the pass rate that the CI threshold is applied to. A sample passes only when `a2ui_scorer` passed and the judge graded it `C`. A `P` is not a pass. For logs that predate Stage 2 and lack per-sample scores for both scorers, `extract_accuracy` falls back to the accuracy metric of the first scorer.

## **Framework Testing and Quality Assurance Plan**

The evaluation framework itself is a critical piece of software that must be tested for reliability and consistency.

### **Tier 1: Unit and Functional Testing**

- Parser Testing: Ensuring the dataset resolver correctly handles decryption and variable injection.
- Scorer Calibration: Testing the scorers themselves by providing them with "known-good" and "known-bad" A2UI JSON samples to ensure consistency.
- Edge Case Handling: Testing scorers with malformed or extreme inputs (e.g., circular references in the UI graph, massive payloads, or invalid UTF-8 characters in strings) to ensure they fail gracefully with useful error messages rather than crashing the evaluation run.

### **Tier 2: Integration and Consistency Testing**

- Cross-Model Parity: Running identical tests across Gemini and GPT-4o to ensure the framework does not exhibit "provider bias".
- Consistency Analysis: Measuring the "Consistency Score" of the framework by running the same evaluation multiple times at varying temperatures to check for variance in results.

### **Tier 3: Human-in-the-loop Calibration (The "Golden Set")**

The framework maintains a "Golden Set" of approximately 200 evaluation samples that have been manually graded by experts. The automated scores are compared against these human scores to target an agreement rate of over 85-90% before a scorer is considered production-ready.

## **Operational Strategy and Deployment**

The A2UI evaluation framework is integrated into the development process using a tiered approach to manage costs and resources.

- Smoke tier: samples tagged `smoke` can be run for fast feedback through `bin/run_ci_evals.py --tier smoke`.
- Nightly benchmark: the full suite runs every 24 hours to detect "silent drift" in model performance.
- Cost control: Stage 1 and 2 reject invalid payloads before any judge call. `--no-judge` removes the judge for structural runs.

By implementing these strategies, the A2UI project ensures that its evaluation data remains resistant to model memorization while providing a transparent and accessible framework for contributors to measure model performance accurately across the LLM landscape.
**References**

- [A2UI Repository](https://github.com/a2ui-project/a2ui)
- [AI Evaluation: 7 Core Components Enterprises Must Get Right \- Innodata](https://innodata.com/ai-evaluation-7-core-components-enterprises-must-get-right/)
- [AI Testing 101: A Practical Guide to Skills, Basics & Getting Started \- GSD Council](https://www.gsdcouncil.org/blogs/ai-testing-101-a-practical-guide-to-skills-basics-getting-started)
- [An Open-Source Data Contamination Report for Large Language Models \- ACL Anthology](https://aclanthology.org/2024.findings-emnlp.30.pdf)
- [A Survey on Data Contamination for Large Language Models \- arXiv](https://arxiv.org/abs/2502.14425v2)
- [Best Practices for Managing Secrets in GitHub Actions \- Blacksmith](https://www.blacksmith.sh/blog/best-practices-for-managing-secrets-in-github-actions)
- [Confidentiality/Ethics \- The Dataverse Project](https://dataverse.org/book/confidentiality-ethics)
- [Eliminating Trust in the Cloud: Evaluation of a Zero-Knowledge Encrypted Git Service](https://www.diva-portal.org/smash/get/diva2:1996117/FULLTEXT01.pdf)
- [Enhancing CI/CD Security: Managing Secrets in GitHub Actions for Software Developers \- DevActivity](https://devactivity.com/insights/enhancing-ci-cd-security-managing-secrets-in-github-actions-for-software-developers/)
- [Eval awareness in Claude Opus 4.6's BrowseComp performance \- Anthropic](https://www.anthropic.com/engineering/eval-awareness-browsecomp)
- [flutter/evals](https://github.com/flutter/evals)
- [How to Build Privacy-Preserving Evaluation Benchmarks with Synthetic Data \- NVIDIA](https://developer.nvidia.com/blog/how-to-build-privacy-preserving-evaluation-benchmarks-with-synthetic-data/)
- [How to safely store API keys in a GitHub project? \- GitHub Discussions](https://github.com/orgs/community/discussions/188310)
- [How to securely handle API keys and secrets in a GitHub repository? \- GitHub Discussions](https://github.com/orgs/community/discussions/190912)
- [How to Test and Evaluate AI? \- GitHub Pages](https://testing-ai-standards.github.io/cross-gov-ai-testing-framework/)
- [Inspect AI](https://inspect.aisi.org.uk/)
- [LatestEval: Addressing Data Contamination in Language Model Evaluation \- AAAI Publications](https://ojs.aaai.org/index.php/AAAI/article/view/29822/31427)
- [LLM Evaluation: Frameworks, Metrics, and Best Practices \- SuperAnnotate](https://www.superannotate.com/blog/llm-evaluation-guide)
- [LLM Evaluation: Key Concepts & Best Practices \- Nexla](https://nexla.com/ai-readiness/llm-evaluation/)
- [LLM Testing: A Practical Guide to Automated Testing for LLM Applications \- Langfuse](https://langfuse.com/blog/2025-10-21-testing-llm-applications)
- [Model Providers \- Inspect AI](https://inspect.aisi.org.uk/providers.html)
- [Search-Time Data Contamination \- arXiv](https://arxiv.org/abs/2508.13180v1)
- [Secret Breach Detection in Source Code with Large Language Models \- arXiv](https://arxiv.org/abs/2504.18784v2)
- [Standard Tools \- Inspect AI](https://inspect.aisi.org.uk/tools-standard)
- [Stop Uploading Test Data in Plain Text \- ResearchGate](https://www.researchgate.net/publication/376392896_Stop_Uploading_Test_Data_in_Plain_Text_Practical_Strategies_for_Mitigating_Data_Contamination_by_Evaluation_Benchmarks)
- [The Definitive Guide to LLM Evaluation \- Arize AI](https://arize.com/llm-evaluation/)
- [Using Models \- Inspect AI](https://inspect.aisi.org.uk/models.html)
- [What's the recommended way to store secrets in GitHub Actions? \- GitHub Discussions](https://github.com/orgs/community/discussions/187776)
