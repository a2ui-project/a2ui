# A2UI Templates Specification

## Abstract

This document defines the authoritative specification for the **A2UI Templates System**. 

Templates provide a declarative, human-readable mechanism for authoring reusable UI subtrees in nested YAML or via native programmatic render functions. At generation time, an agent or Large Language Model (LLM) outputs compact, high-level template invocations (such as `UserProfile("u1", "Alice")` or `PayrollSummary("Eng", true)`). The backend SDK expands these invocations into standard, flat A2UI Basic Catalog components in a single synchronous pass before emitting standard A2UI protocol messages (`updateComponents`) to the client.

This architecture achieves three fundamental objectives:
1. **Human Readability**: Layouts are authored as clean, natural tree hierarchies in YAML or native language code, eliminating artificial IDs and flat array boilerplate.
2. **Token Efficiency & Context Optimization**: LLMs emit concise function-like signatures rather than verbose, deeply nested UI component trees, saving prompt context and generation tokens.
3. **Zero Client Overhead**: Client renderers (@a2ui/react, @a2ui/lit, @a2ui/angular, @a2ui/flutter) implement only standard Basic Catalog primitives (`Card`, `Column`, `Row`, `Text`, `Divider`, `Icon`, `Button`). No custom client widgets, dynamic code deployment, or renderer plugins are required.

---

## 1. Architectural Overview & Execution Pipeline

The template engine operates entirely server-side within the A2UI Agent SDK:

```
+-------------------------------------------------------------------------------+
| 1. Authoring & Registration                                                   |
|    - Static YAML files (with multi-doc '---' support & cross-references)      |
|    - Dynamic resolvers (data-binding mode & programmatic AST mode)            |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| 2. Synthetic Catalog Generation                                               |
|    - TemplateProcessor scans registered templates                             |
|    - Synthesizes virtual A2UI Component Catalog JSON schema                   |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| 3. Model Prompt Generation & Inference                                        |
|    - PromptGenerator injects template signatures into system prompt           |
|    - LLM emits compact Express DSL / JSON:                                    |
|      root = TeamRoster("Engineering", [TeamCard("Core", [...])])              |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| 4. Synchronous Template Expansion (TemplateProcessor)                         |
|    - Resolves dynamic callbacks or executes programmatic render functions     |
|    - Substitutes typed parameters & evaluates dot-notation paths              |
|    - Unrolls server loops & plumbs component slot arguments                   |
|    - Assigns deterministic synthetic IDs: {parent}_{slot}_{index}_{type}      |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| 5. Standard A2UI Protocol Emission                                            |
|    - Emits standard createSurface and updateComponents messages               |
|    - Payload contains 100% standard Basic Catalog primitives                  |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| 6. Client Renderer Execution                                                  |
|    - Standard Basic Catalog renderers paint the flat component graph          |
|    - Binds reactive two-way paths to client DataModel                         |
+-------------------------------------------------------------------------------+
```

---

## 2. Template Taxonomy

A2UI defines three template modalities:

### A. Declarative Static Templates (YAML)
Declarative static templates define immutable layout trees authored in YAML files. All parameter placeholders are populated directly from arguments provided by the model or caller.

```yaml
version: "0.1"
templateId: UserProfile
description: Standard identity card for team members.
parameters:
  userId:
    type: string
    description: Unique user identifier.
  userName:
    type: string
    description: Full name of the user.
  role:
    type: string
    description: Position or title within the team.
    default: Team Member

layout:
  component: Card
  child:
    component: Column
    children:
      - component: Icon
        name: person
      - component: Text
        text: ${userName}
        variant: h3
      - component: Text
        text: ${role}
        variant: caption
```

### B. Dynamic Templates: Data-Binding Mode (`resolver + layout`)
Data-binding dynamic templates decouple public model parameters from private or live backend data. 
- **Public Surface**: The model only sees and outputs high-level lookup parameters (e.g. `employeeId: "emp_101"`).
- **Server Resolver**: At expansion time, a backend callback executes (e.g., querying an internal HR database or API) and produces a data dictionary.
- **Layout Inflation**: The resolved dictionary is merged with the caller's arguments and applied to an underlying static YAML layout.

```python
# Server Registration
dynamic_salary = DynamicTemplate(
    template_id="EmployeeSalaryCard",
    resolver=fetch_private_compensation,
    layout=salary_yaml_layout,
    description="Verified compensation card. Pass only employeeId.",
)
```

**Security Rationale**: Confidential numbers (e.g., executive salaries, PII) never enter the model's prompt context window or inference transcript.

### C. Dynamic Templates: Programmatic Render Mode (`render_fn`)
Programmatic dynamic templates bypass static YAML layouts entirely. Instead, a developer writes a native function in the host language (Python, Dart, etc.) that accepts parameters and directly returns a UI component tree.

```python
def render_payroll_summary(department: str = "Engineering", includeBonus: bool = True) -> dict:
    total_base = sum(e.salary for e in db.get_dept(department))
    total_bonus = sum(e.bonus for e in db.get_dept(department))
    
    rows = []
    for emp in db.get_dept(department):
        cols = [
            {"component": "Text", "text": emp.name, "variant": "body"},
            {"component": "Text", "text": f"${emp.salary:,}", "variant": "body"}
        ]
        if includeBonus:
            cols.append({"component": "Text", "text": f"${emp.bonus:,}", "variant": "body"})
        rows.append({"component": "Row", "justify": "spaceBetween", "children": cols})

    return {
        "component": "Card",
        "child": {
            "component": "Column",
            "children": [
                {"component": "Text", "text": f"Payroll Summary: {department}", "variant": "h2"},
                {"component": "Divider", "axis": "horizontal"},
                *rows,
                {"component": "Divider", "axis": "horizontal"},
                {"component": "Text", "text": f"Total Budget: ${total_base + (total_bonus if includeBonus else 0):,}", "variant": "h3"}
            ]
        }
    }

payroll_tmpl = DynamicTemplate(
    template_id="PayrollSummary",
    render=render_payroll_summary,
    description="Dynamic payroll calculation matrix.",
)
```

**Advantages**:
- Full host language power: arbitrary `for` loops, mathematical calculations, currency formatting, conditionals, and recursion.
- Polymorphic return values: accepts raw dictionaries/maps, dataclasses, or typesafe fluent builder objects (`Card()`, `Column()`).

---

## 3. Loop Processing: Server Unrolling vs. Client Data Model

A critical question in template design is: **When does the template engine unroll loops vs. when are collections handled by the client runtime?**

### Comparison Matrix

| Dimension | Server-Side Template Unrolling | Client-Side DataModel Loop |
| :--- | :--- | :--- |
| **Execution Point** | Backend SDK (`TemplateProcessor`) during template expansion. | Client Renderer runtime during paint/state updates. |
| **Data Source** | Static YAML literals, LLM invocation arguments, or server resolver output. | Client `DataModel` tree (e.g. `/session/cart/items`). |
| **Component Output** | Emits $N$ concrete Basic Catalog component nodes with synthesized unique IDs. | Emits a single repeater/collection component with a `DataBinding` path. |
| **Client Requirement** | Zero. Standard Basic Catalog renderers render it like any other static UI. | Requires client-side repeater support or SDK session re-renders. |
| **Dynamic Mutation** | Immutable once generated unless the agent emits a new `updateComponents` message. | Reactively re-renders when the client data model updates (e.g. via button events). |

### Example 1: Server-Side Template Loop Unrolling
A template author specifies a loop over a parameter array:

#### Template Definition:
```yaml
version: "0.1"
templateId: TeamGoalList
parameters:
  teamName: {type: string}
  goals: {type: array}
layout:
  component: Card
  child:
    component: Column
    children:
      - component: Text
        text: "Objectives: ${teamName}"
        variant: h2
      - component: Column
        children:
          loop:
            param: goals
            as: goal
            item:
              component: Row
              justify: spaceBetween
              children:
                - component: Text
                  text: ${goal.title}
                - component: Text
                  text: ${goal.priority}
                  variant: caption
```

#### Model Invocation:
```text
root = TeamGoalList("Core Team", [
  {title: "Ship Protocol", priority: "High"},
  {title: "Write Tests", priority: "Medium"}
])
```

#### Expanded Output Sent to Client:
The engine unrolls the loop into concrete, synthetic child components:
```json
[
  {"id": "root", "component": "Card", "child": "root_child_column"},
  {"id": "root_child_column", "component": "Column", "children": ["root_child_column_children_0_text", "root_child_column_children_1_column"]},
  {"id": "root_child_column_children_0_text", "component": "Text", "text": "Objectives: Core Team", "variant": "h2"},
  {"id": "root_child_column_children_1_column", "component": "Column", "children": [
    "root_child_column_children_1_column_goals_0_row",
    "root_child_column_children_1_column_goals_1_row"
  ]},
  {"id": "root_child_column_children_1_column_goals_0_row", "component": "Row", "justify": "spaceBetween", "children": [
    "root_child_column_children_1_column_goals_0_row_children_0_text",
    "root_child_column_children_1_column_goals_0_row_children_1_text"
  ]},
  {"id": "root_child_column_children_1_column_goals_0_row_children_0_text", "component": "Text", "text": "Ship Protocol"},
  {"id": "root_child_column_children_1_column_goals_0_row_children_1_text", "component": "Text", "text": "High", "variant": "caption"},
  {"id": "root_child_column_children_1_column_goals_1_row", "component": "Row", "justify": "spaceBetween", "children": [
    "root_child_column_children_1_column_goals_1_row_children_0_text",
    "root_child_column_children_1_column_goals_1_row_children_1_text"
  ]},
  {"id": "root_child_column_children_1_column_goals_1_row_children_0_text", "component": "Text", "text": "Write Tests"},
  {"id": "root_child_column_children_1_column_goals_1_row_children_1_text", "component": "Text", "text": "Medium", "variant": "caption"}
]
```

---

## 4. Relationship to the A2UI Data Model

Templates and the A2UI Data Model operate in complementary scopes:
- **Templates** expand during **server-side inference / response formulation**.
- **Data Model** operates during **client-side runtime interaction & reactivity**.

Templates interact with the client Data Model in three distinct patterns:

### Pattern 1: Dynamic Path Plumbing (Path Interpolation)
Templates can accept path prefixes or IDs as parameters, constructing reactive client-side binding paths:

```yaml
version: "0.1"
templateId: BoundLiveMetric
parameters:
  metricKey: {type: string}
  label: {type: string}
layout:
  component: Card
  child:
    component: Column
    children:
      - component: Text
        text: ${label}
      - component: Text
        text:
          path: "/system/metrics/${metricKey}/currentValue"
```

**Expanded Output:**
```json
{
  "id": "root_val",
  "component": "Text",
  "text": {
    "path": "/system/metrics/cpuLoad/currentValue"
  }
}
```
*Client Behavior*: The client renderer attaches a live subscriber to `/system/metrics/cpuLoad/currentValue`. When telemetry updates arrive via `updateDataModel`, the component automatically re-renders without server roundtrips.

### Pattern 2: Direct `DataBinding` Passthrough
When a template parameter has `type: object`, an agent or caller can pass an explicit A2UI binding object:

#### Model Invocation:
```text
root = MetricCard("Memory Used", {path: "/device/mem_percent"})
```

#### Template Layout:
```yaml
version: "0.1"
templateId: MetricCard
parameters:
  title: {type: string}
  val: {type: object}
layout:
  component: Column
  children:
    - component: Text
      text: ${title}
    - component: Text
      text: ${val}
```

**Expanded Output:**
Because `${val}` is an exact-match substitution, the dictionary type is strictly preserved:
```json
{
  "component": "Text",
  "text": {"path": "/device/mem_percent"}
}
```

### Pattern 3: Hardcoded Session State References
Templates can embed constant client bindings for global session preferences:

```yaml
layout:
  component: Text
  text:
    path: "/session/currentUser/displayName"
```

---

## 5. The Synthetic Catalog System

To make templates discoverable and invoke-able by LLMs, the backend converts registered templates into a **Synthetic Component Catalog**.

### The Catalog Synthesis Algorithm
When `TemplateProcessor(templates)` is initialized:
1. It copies the base catalog (e.g. Basic Catalog v0.9.1).
2. For each registered `StaticTemplate` and `DynamicTemplate`:
   - It registers a new component definition under `components[templateId]`.
   - It maps semantic parameter definitions to JSON schema properties:
     - `string` $\rightarrow$ `{"type": "string"}`
     - `number` / `integer` $\rightarrow$ `{"type": "number"}` / `{"type": "integer"}`
     - `boolean` $\rightarrow$ `{"type": "boolean"}`
     - `enum` $\rightarrow$ `{"type": "string", "enum": param.values}`
     - `object` $\rightarrow$ `{"type": "object", "properties": ...}`
     - `array` $\rightarrow$ `{"type": "array", "items": ...}`
     - `child` $\rightarrow$ `{"$ref": "#/$defs/ComponentReference"}`
     - `children` $\rightarrow$ `{"$ref": "#/$defs/ComponentReferenceList"}`
   - It copies the `description` to provide context for the model.
3. The synthetic catalog is passed to `PromptGenerator` (Express, Elemental, Atom, Direct JSON), which automatically writes the syntax rules and documentation into the system prompt.

### Surface Isolation Boundary
```
[LLM Agent] <---> [Synthetic Catalog (Templates + Primitives)] <---> [TemplateProcessor]
                                                                            |
                                                                   (Expands to Primitives)
                                                                            |
                                                                            v
[Client Renderer] <---------------- (Standard Basic Catalog Only) <----------+
```
The synthetic catalog is an ephemeral compile-time construct. The client renderer is completely unaware that templates exist.

---

## 6. Parameter Expressions & Substitution Engine

The template substitution engine replaces expressions according to strict typing and evaluation rules.

### Rule 1: Exact Match Substitution (Type Preserving)
If a string field value exactly matches the parameter token regex `^\$\{([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\}$`:
- The entire field is replaced by the native runtime value of the parameter.
- **Integers remain integers**: `level: ${userLevel}` $\rightarrow$ `level: 4` (not `"4"`).
- **Booleans remain booleans**: `checked: ${isActive}` $\rightarrow$ `checked: true` (not `"true"`).
- **Objects and Arrays remain native structures**: `items: ${memberList}` $\rightarrow$ `items: [{...}, {...}]`.

### Rule 2: Embedded String Interpolation
If a parameter token appears alongside other characters (e.g. `"Hello, ${userName}!"` or `"${dept} - ${code}"`):
- All tokens are replaced by their string representations.
- Evaluates to a native string.

### Rule 3: Deep Dot-Notation for Structured Objects
Templates natively support deep dot-notation paths on object parameters:

#### Invocation:
```text
root = AccountCard({
  account: {
    id: "acc_99",
    profile: {name: "Alpha Corp", tier: "Enterprise"}
  }
})
```

#### Template Layout:
```yaml
version: "0.1"
templateId: AccountCard
parameters:
  account: {type: object}
layout:
  component: Card
  child:
    component: Text
    text: "${account.profile.name} (${account.profile.tier})"
```

**Expanded Output:**
```json
{
  "component": "Text",
  "text": "Alpha Corp (Enterprise)"
}
```

### Rule 4: String Format AST Expressions
For complex string formatting across multiple languages:
```yaml
format: "Level {lvl} ({pts} points)"
args:
  lvl: ${level}
  pts: ${experiencePoints}
```

### Rule 5: Token Escaping
To emit a literal `${foo}` string without triggering parameter substitution, escape the leading dollar sign with a backslash:
- `\${keep_literal}` $\rightarrow$ evaluates to literal `"${keep_literal}"`.

### Rule 6: Missing Values & Defaults
- If an argument is omitted but has a declared `default` in its parameter schema, the `default` is used.
- If an argument is omitted, has no `default`, and is not required: the property is omitted from the synthesized component (it is not emitted as `null`).
- If an argument is required and missing: expansion raises a `TemplateParameterError`.

---

## 7. Deterministic Synthetic ID Generation Algorithm

To guarantee collision-free component IDs across multiple template instances and deep nesting, implementations in all languages (Python, Dart, TypeScript) must implement the following deterministic naming rules:

### ID Synthesis Specification

```
Let instance_id be the ID passed to expand_template(instance_id, template_id, params)

1. Root Node:
   id = instance_id

2. Single Child Slot (e.g. card.child):
   id = "{parent_id}_{slot_name}_{normalized_type}"
   (where normalized_type is the component or template type converted to lowercase)
   Example: "root_child_column"

3. Multi-Child List Slot (e.g. column.children[i]):
   id = "{parent_id}_{slot_name}_{i}_{normalized_type}"
   (where normalized_type is the component or template type converted to lowercase)
   Example: "root_children_0_text", "root_children_1_button"

4. Loop Iteration Item (e.g. loop over param "members", iteration index i):
   id = "{parent_id}_{param_name}_{i}_{normalized_type}"
   (where normalized_type is the component or template type converted to lowercase)
   Example: "team_col_members_0_userprofile"

5. Authored Explicit IDs:
   If a component in the template specifies an explicit id (e.g. id: "hero_img"):
   id = "{instance_id}_{authored_id}"
   Example: "my_card_hero_img"
```

This guarantees that two instances of the same template (`card_1` and `card_2`) on the same surface will never produce colliding component IDs.

---

## 8. Higher-Order Container Templates (`child` and `children` Slots)

Templates can define structural containers that receive caller-provided components.

### Example: `SectionCard` Container
```yaml
version: "0.1"
templateId: SectionCard
parameters:
  title: {type: string}
  headerAction: {type: child}
  children: {type: children}

layout:
  component: Card
  child:
    component: Column
    children:
      - component: Row
        justify: spaceBetween
        align: center
        children:
          - component: Text
            text: ${title}
            variant: h2
          - component: Column
            children: ${headerAction}
      - component: Divider
        axis: horizontal
      - component: Column
        children: ${children}
```

#### Model Invocation:
```text
root = SectionCard(
  "Project Status",
  Button("Refresh", {action: "reload"}),
  [
    Text("Phase 1: Complete"),
    Text("Phase 2: In Progress")
  ]
)
```

The template engine replaces `${headerAction}` with the synthesized single child node, and concatenates the `${children}` component list into the body column.

---

## 9. Error Handling, Cycle Guards & Safety

### Recursion & Circular Reference Detection
Templates can invoke other templates. However, circular references (`A` invokes `B`, which invokes `A`) must be caught immediately to prevent stack overflow.

- **Call Stack Tracking**: The `TemplateProcessor` maintains an active `_call_stack: Set[str]` throughout expansion.
- **Cycle Guard**: Before expanding any template, if `template_id in _call_stack`, expansion terminates immediately with `TemplateCycleError: Circular template reference detected: A -> B -> A`.
- **Maximum Depth Guard**: An absolute limit (`MAX_EXPANSION_DEPTH = 32`) enforces termination even in non-identical runaway recursion.

### Standard Error Hierarchy
1. `TemplateNotFoundError`: Attempted to expand a `templateId` not present in the catalog.
2. `TemplateParameterError`: Missing required parameter or invalid parameter type.
3. `TemplateCycleError`: Circular reference detected during expansion.
4. `TemplateDepthExceededError`: Expansion exceeded maximum recursion depth.
5. `TemplateResolverError`: Exception raised by a dynamic template resolver function.

---

## 10. Multi-Document YAML Streams (`---`)

To streamline template maintenance, multiple templates can be defined in a single `.yaml` file separated by `---`:

- **Order Independent**: Templates can reference templates declared later in the file (forward references).
- **Batch Registration**: Loading a multi-doc file registers all defined templates atomically into the `TemplateProcessor`.

---

## 11. Template Versioning & Schema Evolution

To ensure robust backward compatibility as template syntax and AST features evolve across future protocol releases, every template definition must declare a top-level `version` field.

### Versioning Rules:
1. **Mandatory Version Field**: Every YAML document (and each document within multi-doc streams separated by `---`) must include `version: "0.1"`.
2. **Strict Schema Validation**: The canonical JSON schema enforces `"version": {"type": "string", "const": "0.1"}`. Attempting to inflate a template with an unsupported version raises an explicit `TemplateVersionError` / `ValueError`.
3. **Future Extensibility**: As new template language capabilities are standardized (e.g. conditional slot rendering, client-expanded template directives), new version identifiers (such as `"0.2"` or `"1.0"`) allow engines to select the appropriate parser/evaluator without breaking legacy templates.

---

## 12. Conformance Checklist for SDK Implementations

An implementation of the A2UI Template Engine in any language (Python, Dart, TypeScript, Go, etc.) is conformant if and only if it satisfies the following test requirements:

- [ ] **Template Versioning**: Validates that all ingested templates declare `version: "0.1"` and rejects unsupported version strings.
- [ ] **Multi-Document Ingestion**: Parses single-doc and multi-doc (`---`) YAML streams.
- [ ] **Forward Reference Resolution**: Expands templates regardless of registration order.
- [ ] **Strict Native Type Preservation**: Exact `${param}` substitutions preserve `int`, `float`, `bool`, `dict`, and `list` types.
- [ ] **Dot-Notation Path Traversal**: Resolves arbitrary depth paths (e.g. `${user.details.address.zip}`).
- [ ] **Inline and Named Loop Expansion**: Accurately unrolls arrays into synthesized component subtrees with indexed child IDs.
- [ ] **Deterministic Synthetic IDs**: Emits canonical hierarchical IDs matching the `{parent}_{slot}_{index}_{type}` specification.
- [ ] **Two-Way DataModel Passthrough**: Preserves `{path: "..."}` dictionary bindings without string conversion.
- [ ] **Cycle and Recursion Safeguards**: Catches circular references and depth violations with explicit exceptions.
- [ ] **Synthetic Catalog Generation**: Generates valid A2UI JSON schema catalogs matching input parameter definitions.
- [ ] **Polymorphic Dynamic Templates**: Supports both resolver-based static bindings and programmatic render functions.

