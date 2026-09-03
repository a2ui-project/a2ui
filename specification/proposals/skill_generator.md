# Skill generator for managed agent architectures

_Status: Draft_

_Author: A2UI Team_

_Created: 2026-09-02_

## TL;DR

* **Core addition**: We will add a shared `SkillGenerator` utility class and `python -m a2ui.skill` lightweight execution entry point to the Python Agent SDK (`agent_sdks/python/a2ui_agent`).
* **Key capabilities**: Decomposes `PromptGenerator` to compile component catalogs and inference format rules into unified (`a2ui`) or modular (`a2ui-core` + `a2ui-<catalog>`) `SKILL.md` packages with standard YAML frontmatter.
* **Supported use cases**: Enables offline build-time CI generation, runtime server-side skill generation with Google Antigravity Agent API provisioning, and progressive multi-catalog skill discovery.
* **Future roadmap**: Later, we will port `SkillGenerator` to TypeScript, Kotlin, and Dart Agent SDKs, and introduce a standalone cross-platform `a2ui` CLI tool for development-time workflows.

---

## Background & executive summary

This proposal details the requirements and system design for generating A2UI skills targeting managed agent architectures (such as Google Antigravity API, Vertex AI Agent Builder, Anthropic API with Skills, and Model Context Protocol agent environments).

The feature equips developers with lightweight Python execution tooling and SDK APIs to transform A2UI component catalog definitions and inference format specifications into modular skill packages. These skill packages can be loaded into sandboxed agent environments to direct models in generating valid A2UI payloads at runtime.

---

## Problem statement

Managed agent platforms execute LLM agent loops inside isolated sandboxes. In these environments, application developers cannot directly inject dynamic system instructions into each LLM turn via traditional agent SDK middleware.

Currently, developers building UI-emitting agents on managed platforms face three primary issues:

* **Manual prompt construction**: Developers must manually format component JSON schemas and syntax specifications into markdown instruction files.
* **Schema drift**: When component catalogs or inference formats change, prompt files become outdated, leading to syntax errors during runtime UI generation.
* **Context window inflation**: Including full component catalogs in the main agent prompt consumes significant token budget, even when the user request does not require complex UI generation.

An automated build-time and runtime skill generation pipeline resolves these issues by generating consistent, validated skill definitions directly from authoritative component catalogs and inference format definitions.

---

## Formal use case specification

### Use case 1: Offline build-time / CI skill compilation

A developer defines a custom UI component catalog in JSON. During the application build or CI/CD pipeline, an automated script runs `python -m a2ui.skill` to compile the catalog into checked-in `SKILL.md` packages. These packages are deployed alongside static agent workspace configurations.

### Use case 2: Runtime server-side skill generation & agent API provisioning

An agent backend server generates skills programmatically at runtime based on active user permissions or session state (e.g., enabling specialized financial component catalogs for specific user tiers). The server calls `generate_skill()`, writes the skill package into the session workspace, and provisions the managed agent via API (such as the Google Antigravity Agent API) before starting the conversation. At runtime, the server receives the agent output stream, validates payloads using the SDK `Parser`, and streams valid UI messages to the client.

### Use case 3: Progressive multi-catalog skill discovery

An enterprise application contains multiple component catalogs (e.g., core controls, data visualization charts, enterprise forms). To avoid loading all catalogs into the agent context upfront, the skill generator outputs a modular hierarchy (`a2ui-core` plus catalog-specific skills). The managed agent discovers and loads catalog skills on demand.

---

## Skill naming, description, and metadata model

Every generated skill file includes standard YAML frontmatter used by managed agent platforms to populate their skill index and route user requests.

### 1. Naming design principle

The skill `name` and `description` are exposed directly to the LLM agent during tool/skill discovery. The LLM should perceive the skill simply as an capability to emit user interfaces (`a2ui`), without needing to know internal SDK implementation details such as the transport format (`express` or `direct_json`) or internal schema filenames.

Internal technical details belong in the frontmatter `metadata` section, preserving clean skill names for model routing.

### 2. Default generation rules

* **Skill Name (`name`)**:
  * Unified / Monolithic skill: `a2ui`
  * Modular core skill: `a2ui-core`
  * Modular catalog skill: `a2ui-{catalog_name}` (e.g., `a2ui-forms`, `a2ui-charts`)
* **Description (`description`)**: Constructed automatically from catalog metadata (`catalog.get("description")`) or defaults to a high-level UI generation intent:
  * Example: `"Generates interactive user interface components for user requests."`
* **Metadata (`metadata`)**: Preserves internal implementation details for SDK inspection and platform indexers:
  ```yaml
  metadata:
    protocol_version: "0.9.1"
    inference_format: "express"
    catalogs:
      - "basic_catalog"
  ```

### 3. Developer overrides

Developers can override default skill metadata programmatically via `SkillConfig` or via command-line flags to tailor the skill to their application domain:

```python
config = SkillConfig(
    inference_format=express_format,
    name="a2ui-finance",
    description="Generates interactive financial portfolio charts, wire transfer forms, and transaction receipts.",
    tags=["finance", "ui"],
    metadata={"version": "1.2.0"},
)
```

CLI override flags:
```bash
python -m a2ui.skill catalog.json \
    --name a2ui-finance \
    --description "Generates interactive financial portfolio charts and forms."
```

### 4. Agent discovery mechanism

Managed agent platforms read the frontmatter `name` and `description` to populate their available skill index. When a user submits a prompt requiring interactive interface creation (e.g., *"Show me a dashboard of my monthly expenses"*), the agent identifies the `a2ui` skill based on its description and loads the skill to format its response.

---

## Class design and PromptGenerator API decomposition

To prevent code duplication across inference formats, skill generation is designed as a **shared utility** (`SkillGenerator`) operating on `PromptGenerator` instances, rather than requiring each `InferenceFormat` to implement custom skill generation logic.

```
                                +-----------------------------------+
                                |    PromptGenerator (Interface)    |
                                +-----------------------------------+
                                | + generate_base_rules()           |
                                | + generate_catalog_instructions() |
                                | + generate_examples()             |
                                | + generate()                      |
                                +-----------------------------------+
                                                  ^
                                                  | Implements
                         +------------------------+------------------------+
                         |                                                 |
         +-------------------------------+                 +-------------------------------+
         |     ExpressPromptGenerator    |                 |   DirectJsonPromptGenerator   |
         +-------------------------------+                 +-------------------------------+
                         ^                                                 ^
                         |                                                 |
                         +------------------------+------------------------+
                                                  | Consumes
                                      +-----------------------+
                                      |    SkillGenerator     |
                                      |   (Shared Utility)    |
                                      +-----------------------+
                                      | + generate_skill()    |
                                      | + generate_modular()  |
                                      +-----------------------+
```

### PromptGenerator interface refactoring

To support modular skill generation (which requires separating base syntax rules from domain component catalog signatures), the abstract `PromptGenerator` class is refined to expose three granular decomposition methods:

```python
class PromptGenerator(ABC):

    @abstractmethod
    def generate_base_rules(self) -> str:
        """Returns the core syntax contract and grammar rules for the inference format."""
        pass

    @abstractmethod
    def generate_catalog_instructions(self, catalog: Optional[A2uiCatalog] = None) -> str:
        """Returns positional component signatures or JSON schemas for a catalog."""
        pass

    @abstractmethod
    def generate_examples(self, catalog: Optional[A2uiCatalog] = None) -> str:
        """Returns formatted few-shot examples for a catalog."""
        pass

    def generate(
        self,
        role_description: str = "",
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Optional[Union[dict[str, Any], V09Capabilities]] = None,
        allowed_components: Optional[list[str]] = None,
        allowed_messages: Optional[list[str]] = None,
        include_schema: bool = False,
        include_examples: bool = False,
        validate_examples: bool = False,
    ) -> str:
        """Default implementation concatenates base rules, catalog instructions, and examples."""
        parts = [role_description]
        base_rules = self.generate_base_rules()
        if workflow_description:
            base_rules += f"\n\n{workflow_description}"
        parts.append(f"## Workflow Description:\n{base_rules}")

        if ui_description:
            parts.append(f"## UI Description:\n{ui_description}")

        if include_schema:
            parts.append(self.generate_catalog_instructions())

        if include_examples:
            examples_str = self.generate_examples()
            if examples_str:
                parts.append(f"### Examples:\n{examples_str}")

        return "\n\n".join(parts)
```

### Shared SkillGenerator utility logic

The `SkillGenerator` class uses these granular methods to construct unified or modular skill packages:

* **Unified skill assembly**:
  Combines `generate_base_rules()`, `generate_catalog_instructions()`, and `generate_examples()` into a single `SKILL.md` file.

* **Modular skill assembly**:
  * Base skill (`a2ui-core`): Uses `generate_base_rules()` to generate the format's core syntax specification, envelope structure, and streaming rules.
  * Catalog skill (`a2ui-catalog-<name>`): Uses `generate_catalog_instructions(catalog)` and `generate_examples(catalog)` to generate dedicated component documentation for specific domains.

---

## Developer workflow and distribution

### Lightweight workflow options

Rather than installing a global CLI binary into system path directories via `[project.scripts]`, skill generation is exposed through two lightweight execution options built directly into `a2ui-agent-sdk`.

#### Option 1: Direct Python module execution (`python -m a2ui.skill`)

```bash
# Generate a unified skill file
python -m a2ui.skill path/to/catalog.json \
    --inference-format express \
    --output-dir ./skills/a2ui-express

# Generate modular skills (core skill + catalog skills)
python -m a2ui.skill path/to/form_catalog.json path/to/chart_catalog.json \
    --inference-format express \
    --modular \
    --output-dir ./skills/
```

#### Option 2: One-line Python function call (`generate_skill`)

```python
from a2ui.skill import generate_skill

# Generate a skill file from catalog definitions
generate_skill(
    catalog_path="path/to/catalog.json",
    inference_format="express",
    output_dir="./skills/a2ui-express",
    include_examples=True,
)
```

### Module layout within `a2ui-agent-sdk`

```
agent_sdks/python/a2ui_agent/
└── src/
    └── a2ui/
        └── skill/
            ├── __init__.py      # Exports generate_skill() helper function
            ├── __main__.py      # CLI entry point for `python -m a2ui.skill`
            ├── config.py        # SkillConfig data class
            └── generator.py     # SkillGenerator core logic
```

---

## Language support roadmap and multi-language strategy

Skill generation will follow a phased rollout across programming languages and agent SDK environments.

### Phase 1: Python Agent SDK implementation (Initial rollout)

The initial implementation targets the Python Agent SDK (`agent_sdks/python/a2ui_agent`). This initial phase provides immediate capabilities for two major developer workflows:

1. **Python backend servers**: Developers building agent servers in Python can perform runtime skill generation dynamically within their server processes.
2. **Cross-language offline generation**: Developers building backend servers in non-Python languages (e.g., Go, Java, TypeScript, Dart) can run `python -m a2ui.skill` at build time to generate checked-in `SKILL.md` packages for their managed agent platforms.

### Phase 2: Multi-language SDK skill generator porting

Following the Python implementation, the decomposed `PromptGenerator` interface and `SkillGenerator` utility will be ported to all official A2UI Agent SDKs:

* **TypeScript / Node Agent SDK**: Enables Node.js and Express/Fastify agent servers to generate skills programmatically at runtime.
* **Kotlin / Java Agent SDK**: Enables JVM-based agent services (Spring Boot, Ktor) to build and mount skills dynamically.
* **Dart Agent SDK**: Enables Dart and Flutter backend services to build and register skills.

### Phase 3: Standalone cross-platform CLI tool (`a2ui`)

Eventually, an official, standalone `a2ui` CLI tool will be distributed via standard package managers (such as npm, Homebrew, or standalone binary releases). The CLI will unify development-time skill creation, catalog validation, and schema compiling into a developer-first toolchain across all client and server languages:

```bash
# Future standalone CLI workflow
a2ui create skill path/to/catalog.json --format express --out ./skills
```

---

## Required codebase and blueprint changes

### 1. Python Agent SDK changes (`agent_sdks/python/a2ui_agent/`)

* `src/a2ui/prompt/generator.py`: Update `PromptGenerator` abstract base class to add abstract methods `generate_base_rules()`, `generate_catalog_instructions()`, and `generate_examples()`.
* `src/a2ui/inference_formats/direct_json/prompt_generator.py`: Implement the three granular methods on `DirectJsonPromptGenerator`.
* `src/a2ui/inference_formats/experimental/express/prompt_generator.py`: Implement the three granular methods on `ExpressPromptGenerator`.
* `src/a2ui/inference_formats/experimental/elemental/prompt_generator.py`: Implement the three granular methods on `ElementalPromptGenerator`.
* `src/a2ui/inference_formats/experimental/atom/prompt_generator.py`: Implement the three granular methods on `AtomPromptGenerator`.
* `src/a2ui/skill/`: Create module directory containing `config.py` (`SkillConfig`), `generator.py` (`SkillGenerator`), `__main__.py` (CLI parser), and `__init__.py` (exposing `generate_skill`).

### 2. Specification and blueprint updates

* `blueprints/modules/agent_sdk_python.blueprint.md`: Add compliance specifications for `a2ui.skill` module interfaces.
* `blueprints/codebases/agent_sdks/python/codebase.blueprint.md`: Update commit hash and compliance status tracking.

---

## Conformance test specification

Skill generation must be verified by language-agnostic conformance tests to guarantee output stability across SDK updates.

### Test structure

* Test suite path: `agent_sdks/python/a2ui_agent/tests/conformance/test_skill_generator.py`
* Golden test data directory: `conformance/test_data/skills/`
  * `express_basic_monolithic.skill.md`
  * `express_core.skill.md`
  * `express_basic_catalog.skill.md`
  * `direct_json_basic_monolithic.skill.md`

### Test cases

1. **Monolithic Skill Generation Conformance**:
   Loads `basic_catalog.json` with `ExpressFormat`. Invokes `SkillGenerator`. Asserts generated string matches `express_basic_monolithic.skill.md` character-for-character.
2. **Modular Skill Generation Conformance**:
   Invokes `SkillGenerator` in modular mode. Asserts core output matches `express_core.skill.md` and catalog output matches `express_basic_catalog.skill.md`.
3. **Metadata & Custom Overrides Conformance**:
   Passes custom `name`, `description`, and `metadata` dictionary. Verifies frontmatter parses as valid YAML and contains expected custom values.

---

## Sample application design: Google Antigravity agent server + TypeScript client

This sample app demonstrates runtime skill generation, provisioning into Google Antigravity Managed Agent API, server-side payload interception/validation, and client-side web rendering.

### 1. Python Managed Agent Backend (`server.py`)

The backend initializes an Antigravity Agent, writes A2UI skills into its workspace at runtime, and streams validated A2UI payloads to the web client.

```python
import asyncio
from fastapi import FastAPI, WebSocket
from google.antigravity import Agent, LocalAgentConfig
from a2ui.skill import generate_skill
from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog

app = FastAPI()

# 1. Load catalogs and setup runtime skill generation
basic_catalog = A2uiCatalog.from_json_file("catalogs/basic_catalog.json")
enterprise_catalog = A2uiCatalog.from_json_file("catalogs/enterprise_catalog.json")
express_format = ExpressFormat(supported_catalogs=[basic_catalog, enterprise_catalog])

# Generate skills into agent workspace at runtime
generate_skill(
    catalogs=[basic_catalog, enterprise_catalog],
    inference_format=express_format,
    modular=True,
    output_dir="./agent_workspace/.skills"
)

# 2. Provision Google Antigravity Agent
agent_config = LocalAgentConfig(
    save_dir="./agent_workspace",
    system_instruction="You are an enterprise assistant. Output UI using A2UI skills when requested."
)
antigravity_agent = Agent(config=agent_config)

# 3. WebSocket endpoint streaming validated A2UI to TypeScript client
@app.websocket("/ws/chat")
async def chat_endpoint(websocket: WebSocket):
    await websocket.accept()
    async with antigravity_agent.create_conversation() as conversation:
        while True:
            user_msg = await websocket.receive_text()
            
            # Send message to Antigravity sandbox
            turn_stream = conversation.send_message(user_msg)
            
            # Intercept and validate agent output stream
            async for chunk in turn_stream:
                if chunk.text:
                    # Parse Express DSL chunks into A2UI JSON envelopes
                    validated_messages = express_format.parser.parse_incremental(chunk.text)
                    for msg in validated_messages:
                        await websocket.send_json(msg)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

### 2. TypeScript Client (`client.ts`)

The web client connects to the backend WebSocket stream and renders components using `@a2ui/lit` or `@a2ui/web-core`.

```typescript
import { SurfaceManager } from '@a2ui/web-core';
import '@a2ui/lit';

const surfaceManager = new SurfaceManager();
const ws = new WebSocket('ws://localhost:8000/ws/chat');

ws.onmessage = (event) => {
  const messagePayload = JSON.parse(event.data);
  // Apply incoming A2UI payload (createSurface, updateComponents, updateDataModel)
  surfaceManager.applyMessage(messagePayload);
};

// Render root surface in DOM
const container = document.getElementById('ui-root');
surfaceManager.mount(container);

function sendMessage(text: string) {
  ws.send(text);
}
```

---

## Concrete skill examples

### Example 1: Monolithic Skill (`a2ui/SKILL.md`)

```markdown
---
name: a2ui
description: Generates interactive UI components for user requests. Use when creating interactive forms, cards, and structured user interfaces.
metadata:
  protocol_version: "0.9.1"
  inference_format: "express"
  catalogs:
    - "basic_catalog"
---

# A2UI Express DSL Output Contract

You must output the user interface using A2UI Express.

IMPORTANT: You MUST always surround the entire A2UI Express block with the sentinel tags `<a2ui>` and `</a2ui>`.

The host compiler will compile your A2UI Express output into the correct JSON envelopes automatically.

## Grammar Rules

1. Component constructors can be assigned to variables or nested inline inside parent component arguments:
   header = ComponentA(prop1="val1")
   root = ComponentB([header, ComponentC("Click", action=Event("submit"))])

2. The interface tree must have a single entry point assigned to the reserved variable 'root'.

3. Primitives:
   - Strings: Quoted with `"` or `"""`.
   - Numbers: write as integers or decimals, e.g., 42
   - Booleans: write true or false
   - Null values: write null

4. Lists: represent as arrays, e.g., [child1, child2].

5. Data bindings: prefix absolute paths in the data model with '$', e.g., $/user/firstName.

6. Action events: represent server-side actions using the Event helper:
   Event("save_deal", {rep: $/form/rep})

## Positional Component Signatures

Use these exact positional signatures to instantiate components. Do not output property keys:
• Button(text, action, variant?, disabled?)
  - Description: Standard clickable action button.
  - text: Button label string
  - action: Required action event or function call
  - variant: 'primary', 'secondary', 'text'
• Text(text, usage?)
  - Description: Display text element.
  - text: Text string content
  - usage: 'heading', 'subheading', 'body'
• Column(children, align?)
  - Description: Vertical layout container.
  - children: List of child component variables or constructors

## Positional Function Signatures

Use these exact positional signatures to instantiate check rules or logic functions:
• required(message?)
  - Description: Validates that a field is non-empty.

### Examples:

```
<a2ui>
welcomeText = Text("Welcome to the Portal", usage="heading")
submitBtn = Button("Submit", action=Event("submit_form"))
root = Column([welcomeText, submitBtn])
</a2ui>
```
```

### Example 2: Modular Core Skill (`a2ui-core/SKILL.md`)

```markdown
---
name: a2ui-core
description: Core A2UI protocol instructions and Express syntax rules. Load when generating user interface payloads.
metadata:
  protocol_version: "0.9.1"
  inference_format: "express"
---

# A2UI Express Core Protocol

You output user interface specifications using A2UI Express markup enclosed inside `<a2ui>` and `</a2ui>` sentinel tags.

## Grammar Rules

1. Assign component constructors to variables or nest them inline inside parent arguments.
2. The root of the layout tree MUST be assigned to the variable `root`.
3. Reference dynamic data paths using `$/path/to/value`.
4. Define user actions using `Event("action_name", {param: value})`.
5. Specify target surfaces using `surface("surface-id")`.
```

### Example 3: Modular Catalog Skill (`a2ui-catalog-basic/SKILL.md`)

```markdown
---
name: a2ui-catalog-basic
description: Basic UI component catalog containing text, button, card, and layout container signatures.
metadata:
  protocol_version: "0.9.1"
  inference_format: "express"
  catalog: "basic_catalog"
---

# Basic Component Catalog Signatures

Use these exact positional signatures to instantiate components:

• Button(text, action, variant?, disabled?)
  - Description: Standard clickable action button.
  - text: Button label string
  - action: Required action event or function call
  - variant: Must be one of: 'primary', 'secondary', 'text'

• Text(text, usage?)
  - Description: Display text element.
  - text: Text string content

• Column(children, align?)
  - Description: Vertical flex container.

### Examples:

```
<a2ui>
header = Text("Settings", usage="heading")
saveBtn = Button("Save Changes", action=Event("save_settings"), variant="primary")
root = Column([header, saveBtn])
</a2ui>
```
```
