# **Technical Design for the A2UI Large Language Model Evaluation Framework**

The shift toward agentic systems that interact with users through dynamic interfaces necessitates a fundamental reimagining of how large language models are evaluated. The A2UI project represents a pivotal effort to standardize the declarative generation of user interfaces, moving away from the risks of executable code toward a secure, JSON-based intent protocol. However, the efficacy of an A2UI implementation depends entirely on the model's ability to reliably translate high-level user instructions into valid, contextually aware, and renderable JSON structures. Evaluating this capability requires a framework that is simultaneously rigorous, model-agnostic, and secure within the constraints of an open-source development lifecycle.

The proposed design utilizes the Inspect AI framework as its core orchestration engine, providing a modular architecture of datasets, solvers, and scorers. This document outlines the engineering specifications for the A2UI evaluation framework, drawing architectural inspiration from the `flutter/evals` work while optimizing for a Python-native environment compatible with the Inspect ecosystem. The framework addresses the complex interplay between model performance, secret management in continuous integration (CI) pipelines, and the critical challenge of preventing data contamination in public repositories.

## **Architectural Philosophy and Framework Integration**

The core architecture of the A2UI evaluation framework is built upon the principle of functional isolation, ensuring that the logic governing evaluation is decoupled from the specific models under test and the transport protocols used to deliver UI payloads. This decoupling is essential for the A2UI project, which aims to be framework-agnostic and portable across various rendering environments such as Flutter, React, or native web components.

### **Systematic Mapping to Inspect AI**

The framework adopts the three-pillar architecture of Inspect AI—Tasks, Solvers, and Scorers—to create a unified evaluation pipeline. In this context, a Task defines the high-level evaluation objective, such as "Validating Form Generation" or "Testing Adaptive Layouts".

| Inspect Component | A2UI Implementation Detail                                                 | Primary Responsibility                                            |
| :---------------- | :------------------------------------------------------------------------- | :---------------------------------------------------------------- |
| Dataset           | Encrypted archives resolved into EvalSet JSON.                             | Providing structured prompts and ground-truth UI targets.         |
| Solver            | Uses `A2uiSchemaManager` to inject system prompt, then generates response. | Orchestrating the model's attempt to generate a valid UI payload. |
| Scorer            | A hybrid of SDK-based validation and LLM-as-a-judge.                       | Determining the accuracy and usability of the generated JSON.     |
| Model Provider    | Support for Gemini, OpenAI, Anthropic, and local vLLM.                     | Standardizing API interactions across diverse model families.     |

The interaction flow begins with the resolution of a dataset sample. A solver then prepares the environment, using `A2uiSchemaManager` to provide the model with the correct protocol schemas and a "catalog" of available A2UI components—a critical constraint of the A2UI security model. The model generates a response, which is then parsed and corrected using the SDK's parser tools, and finally passed through a series of Scorers to assess its technical validity and semantic alignment with the user's intent.

### **Integration with A2UI Python SDK**

To ensure consistency between the evaluation framework and the actual agent implementation, the framework integrates the A2UI Python SDK. This reduces duplication of logic and leverages the SDK's robust parsing and validation capabilities.

| SDK Component       | Role in Evaluation                                  | Benefit                                                                                                          |
| :------------------ | :-------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `A2uiSchemaManager` | Generates the system prompt for the Solver.         | Ensures the model receives the correct schema and catalog definitions without manual hardcoding in eval scripts. |
| `A2uiValidator`     | Used in Stage 1 Scorer for schema validation.       | Centralizes validation logic, ensuring evals match runtime validation.                                           |
| `parse_response`    | Used to parse the model's completion.               | Handles extraction of JSON payloads from markdown and handles common LLM formatting artifacts.                   |
| `payload_fixer`     | Applied before validation to correct common errors. | Allows focusing evaluation on intent rather than minor formatting issues that are easily fixed in production.    |

### **Replicating and Enhancing the Eval Lifecycle**

While the `flutter/evals` project provides a useful reference for managing complex datasets, the A2UI framework moves away from Dart-based CLI tools (`devals`) in favor of a native Python implementation within the `a2ui/evals` worktree. This ensures deeper integration with the Python-based Inspect libraries and simplifies the contribution process for the broader machine learning community.

The lifecycle consists of four distinct phases:

1. Resolution: Converting encrypted scenario definitions into runtime Sample objects.
2. Execution: Parallelized model calls orchestrated by Inspect's asynchronous architecture.
3. Scoring: Multi-dimensional grading covering structure, intent, and safety.
4. Analysis: Generating standardized logs for visualization in the Inspect View tool or VS Code extension.

## **Dataset Engineering and Contamination Mitigation**

In an open-source context, the integrity of evaluation data is constantly threatened by model training crawlers that ingest public repositories. If evaluation prompts and their corresponding "gold" answers are indexed, future models will exhibit inflated performance due to memorization rather than actual reasoning capabilities—a phenomenon known as data contamination.

### **The Encryption-at-Rest Strategy**

To satisfy the requirement for both human readability and crawler resistance, the framework implements transparent encryption using **Transcrypt**. Evaluation scenarios are authored in human-readable YAML format but are encrypted at rest in the repository.

| Feature           | Plaintext Storage                 | Transcrypt Encryption (Proposed)             |
| :---------------- | :-------------------------------- | :------------------------------------------- |
| Human Readability | High (Directly visible on GitHub) | High (For authorized contributors with keys) |
| Model Indexing    | Extremely High Risk               | Negligible (Encrypted binary data)           |
| CI Integration    | Trivial                           | Requires secret injection in GitHub Actions  |
| Versioning        | Standard Git diffs                | Handled by Transcrypt transparently          |

### **Implementation: Transparent Encryption with Transcrypt**

Transcrypt is a Bash script that uses OpenSSL to provide transparent encryption via Git clean/smudge filters.

**Why Transcrypt for A2UI:**

- **String-Based Secrets**: Unlike `git-crypt`, which requires a binary key file, Transcrypt can be unlocked using a simple password string. This is highly ergonomic for CI/CD pipelines where the secret is stored as a string environment variable.
- **Zero-Install Contribution**: Transcrypt is a standalone script that can be committed to the `evals/bin/` directory. Contributors do not need to install system-level packages; they simply run the local script to unlock the repo.
- **Transparency**: Once a developer runs the unlock command, they can use standard Git commands (`add`, `commit`, `push`). The encryption and decryption happen automatically in the background via `.gitattributes`.

**Configuration Strategy:**

1.  **Repository Structure**: The evaluation scenarios are authored in human-readable YAML in `evals/datasets/*.yaml`.
2.  **Filter Definition**: A `.gitattributes` file is placed in the datasets folder: `*.yaml filter=crypt diff=crypt merge=crypt`.
3.  **Key Rotation**: If the evaluation password is compromised, developers can use Transcrypt’s built-in `--rekey` command to rotate the password and re-encrypt all files in a single step.

## **Multi-Model Provider Integration and Configuration**

A primary goal of the A2UI framework is to facilitate objective comparisons across the LLM landscape. The framework must operate seamlessly with Google’s Gemini models while providing equal support for OpenAI, Anthropic, and open-weights models like Llama or Mistral.

### **Standardizing Model API Interactions**

Inspect AI provides built-in providers for the most common lab APIs, which the A2UI framework leverages to maintain a consistent interface.

| Provider Family | Configuration Mechanism            | A2UI Specific Integration                               |
| :-------------- | :--------------------------------- | :------------------------------------------------------ |
| Google Gemini   | `google-genai` Python package      | Uses built-in grounding for A2UI documentation.         |
| OpenAI          | `openai` Python package            | Leverages prompt caching for cost reduction.            |
| Anthropic       | `anthropic` Python package         | Supports Claude 3.5's "Computer Use" capabilities.      |
| Open Models     | `vllm` or `ollama` local providers | Enables testing on internal or private infrastructures. |

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

Evaluating an A2UI response requires more than just checking if the output is valid JSON. It must be assessed for structural integrity, semantic accuracy, and usability.

### **Stage 1: Structural & Schema Validation (Programmatic)**

The first line of defense is a non-LLM based programmatic scorer. Using the `A2uiValidator` from the A2UI Python SDK, this scorer validates the generated JSON for schema compliance and hierarchy validity. Before validation, the output is processed by `parse_response` and `payload_fixer` to handle common LLM formatting quirks. This stage provides a binary "Pass/Fail" based on strict adherence to the protocol.

### **Stage 2: Programmatic Semantic Checks**

Before escalating to an expensive LLM judge, the framework performs simple, rule-based checks to verify baseline correctness against the prompt's specific requirements. For example, if the prompt requests a "form with an email field and a submit button", this stage programmatically verifies that the generated JSON contains a component mapping to an email input and a button, and that they are bound to appropriate data model paths. This reduces the load on the LLM judge and ensures basic compliance.

### **Stage 3: Intent Alignment & Quality (LLM-as-a-judge)**

The final stage uses a high-capacity "grader" model to assess how well the generated UI meets the user's intent beyond simple component presence (e.g., layout appropriateness, accessibility hints). The grader is provided with a rubric and asked to provide a score on a Likert scale (1-5) along with a detailed rationale.

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

- Smoke Test (PR Trigger): A small subset of critical UI scenarios is run on every pull request.
- Nightly Benchmark: A full suite of hundreds of scenarios is run every 24 hours to detect "silent drift" in model performance.
- Cost Optimization: The framework uses cheaper models (e.g., Gemini Flash) for structural validation and only escalates to larger models for final semantic grading.

By implementing these strategies, the A2UI project ensures that its evaluation data remains resistant to model memorization while providing a transparent and accessible framework for contributors to measure model performance accurately across the LLM landscape.
**References**

- [A2UI Repository](https://github.com/a2ui-project/a2ui)
- [AI Evaluation: 7 Core Components Enterprises Must Get Right \- Innodata](https://innodata.com/ai-evaluation-7-core-components-enterprises-must-get-right/)
- [AI Testing 101: A Practical Guide to Skills, Basics & Getting Started \- GSD Council](https://www.gsdcouncil.org/blogs/ai-testing-101-a-practical-guide-to-skills-basics-getting-started)
- [An Open-Source Data Contamination Report for Large Language Models \- ACL Anthology](https://aclanthology.org/2024.findings-emnlp.30.pdf)
- [A Survey on Data Contamination for Large Language Models \- arXiv](https://arxiv.org/html/2502.14425v2)
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
- [Search-Time Data Contamination \- arXiv](https://arxiv.org/html/2508.13180v1)
- [Secret Breach Detection in Source Code with Large Language Models \- arXiv](https://arxiv.org/html/2504.18784v2)
- [Standard Tools \- Inspect AI](https://inspect.aisi.org.uk/tools-standard)
- [Stop Uploading Test Data in Plain Text \- ResearchGate](https://www.researchgate.net/publication/376392896_Stop_Uploading_Test_Data_in_Plain_Text_Practical_Strategies_for_Mitigating_Data_Contamination_by_Evaluation_Benchmarks)
- [The Definitive Guide to LLM Evaluation \- Arize AI](https://arize.com/llm-evaluation/)
- [Using Models \- Inspect AI](https://inspect.aisi.org.uk/models.html)
- [What's the recommended way to store secrets in GitHub Actions? \- GitHub Discussions](https://github.com/orgs/community/discussions/187776)
