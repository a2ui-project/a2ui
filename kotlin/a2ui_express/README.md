# A2UI Express for Kotlin (`a2ui-express`)

Standalone, zero-ANTLR Kotlin/JVM implementation of **A2UI Express** targeting **A2UI v1.0** (`com.google.a2ui.core.*`, `com.google.a2ui.agent.*`, `com.google.a2ui.agent.inferenceformats.express`).

## Overview

`kotlin/a2ui_express/` provides full A2UI v1.0 Express compilation, decompilation, system prompt generation, one-shot response parsing, incremental streaming (`ExpressResponseStream` with progressive string healing and pre-`root` gating), multi-catalog namespace resolution, and surface state verification (`RendererState` + `validatePayload`) with minimal runtime dependencies for straightforward `google3` / Blaze integration.

### Runtime Dependencies

- `org.jetbrains.kotlin:kotlin-stdlib`
- `org.jetbrains.kotlinx:kotlinx-serialization-json`

No ANTLR runtime, Jackson, `networknt` JSON Schema validator, ADK, or A2A libraries are required on the runtime classpath.

## Building, Formatting, and Testing

Requires JDK 21–25 (for example `JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64` when the host default `java` is JDK 27+):

```bash
cd kotlin/a2ui_express

# Run unit, golden round-trip, and v1.0 conformance suites
JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64 ./gradlew test

# Check Google Kotlin formatting (ktfmt)
JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64 ./gradlew ktfmtCheck

# Inspect runtime dependency tree
JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64 ./gradlew dependencies --configuration runtimeClasspath
```

To emit an executed-case manifest JSONL file for `conformance/scripts/check_executed_cases.py`:

```bash
cd kotlin/a2ui_express
A2UI_CONFORMANCE_MANIFEST_DIR=/tmp/a2ui-manifest \
  JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64 ./gradlew test
```

## Public Facade Packages

- `com.google.a2ui.core.catalog`: `Catalog` (`CatalogApi`), `ComponentApi`, `SchemaComponentApi`, `FunctionApi`, `SchemaFunctionApi`, `FunctionReturnType`, `AllowedCallers`, `AgentFunction`, and `DerivedCatalogEntry`.
- `com.google.a2ui.core.common`: `ProtocolVersion`, `Uax31Identifier`, and `A2uiMetadata`.
- `com.google.a2ui.core.exceptions`: `A2uiError`, `A2uiErrorDetail`, `A2uiValidationError`, `A2uiCatalogError`, `A2uiIntegrityError`, `A2uiRecursionError`, and `A2uiParseError`.
- `com.google.a2ui.core.schema`: `AgentToRendererMessage` sealed hierarchy, `FunctionCall`, `FunctionResponse`, and `FunctionError`.
- `com.google.a2ui.agent` / `parser` / `prompt` / `utils` / `catalogtransformers`: `InferenceFormat`, `InferenceFormatFactory`, `PromptGenerator`, `Parser`, `ResponseStream<out P : StreamPart>`, `StreamPart` / `ResponsePart` (`TextPart`, `A2uiPart`, `ErrorPart`), `A2uiCompilationError`, `RendererState`, `validatePayload`, and `CatalogTransformer` (`ComponentPruningTransformer`, `FunctionPruningTransformer`).
- `com.google.a2ui.agent.inferenceformats.express`: `ExpressFormat`, `ExpressFormatFactory`, `ExpressParser`, `ExpressCompiler`, `ExpressDecompiler`, `ExpressResponseStream`, and Express compilation error subclasses.
