---
feature_name: agent_renderer_app
module_blueprints:
  - a2ui_agent
  - a2ui_core
dependencies: []
date_added: 2026-10-28
---

# **Agent Renderer App Feature Blueprint**

An app can call the model and render its answer itself, such as a chat that runs in a browser. It then plays both A2UI roles: the agent that reads the model's streamed answer, and the renderer that shows it. This feature lets such an app check and apply each message once, on the renderer's own `MessageProcessor`, and read one streamed answer into its text, surfaces and rejected blocks in the order the model wrote them.

The feature is optional. An SDK implements it only if it has both an agent and a renderer that can run in the same app. An SDK with only one of them does not implement it.

---

## **Requirements**

### **1. The processor's catalogs and a validation config for one call (core)**

- `MessageProcessor.catalogs` holds the catalogs the processor was created with, in priority order. Changing what it returns does not change the processor.
- `ExecutionContext`, the options of one `processMessages` or `processMessagesAsync` call, takes a `validationConfig`. It replaces the processor's own config for that call. The rules it leaves out default to the strict ones, as for `MessageProcessorOptions.validationConfig`.
- The processor's own config is in effect again for the next call that passes none.

### **2. A renderer state on the renderer's processor (agent)**

- `RendererState.of(processor)` makes a state whose catalogs are the processor's `catalogs` and which applies the messages it accepts to that processor.
- The state checks each message by its own rules, whatever validation config the processor was created with, by passing them in each call's `ExecutionContext`.
- A rollback takes a message back out of the processor's model.
- A `callRendererFunction` reaches the processor only once the outermost `apply` or transaction it was applied in succeeds, since a function that ran cannot be rolled back. It is checked in full when it is applied.
- The processor must take its messages from the state only. A message applied around the state is checked by nothing, and a transaction that fails after it cannot undo it.

### **3. A streamed answer (agent)**

- `StreamedAnswer` opens a stream whose state is `RendererState.of(renderer)` and that reads past rejected blocks (`after_rejected_block="continue"`).
- It raises `A2uiCatalogError` if the renderer's catalogs are not the request processor's active catalogs, in the same order.
- Its `parts` are the answer's text, one part per surface the answer created and still holds, and an `ErrorPart` per rejected block, in the order the model wrote them. Text that arrives in pieces is joined into one part until a block comes between. A surface the answer deletes leaves `parts`.

---

## **Detailed Description of Changes**

### **Core: `MessageProcessor.catalogs` and `ExecutionContext`**

```typescript
class MessageProcessor<T extends ComponentApi> {
  /** The catalogs the processor was created with, in priority order. */
  readonly catalogs: Catalog<T>[];
}

/** Options for one call of 'processMessages' or 'processMessagesAsync'. */
export interface ExecutionContext {
  /** Whether the call runs in an active user gesture. */
  isUserActivated?: boolean;
  /**
   * The validation rules for this call, in place of the processor's own. The rules it
   * leaves out default to the strict ones, as for 'MessageProcessorOptions.validationConfig'.
   */
  validationConfig?: ValidationConfig;
}
```

A renderer may be created with strict rules or with none, and neither suits messages that arrive one at a time while a response streams. A validation config passed for one call lets the agent check its outbound messages against the renderer's processor by the agent's rules.

An SDK whose processor takes its per-call options as named parameters, rather than as an `ExecutionContext` object, takes `validationConfig` as one of them.

### **Agent: `RendererState.of`**

```python
class RendererState:
    @classmethod
    def of(cls, processor: MessageProcessor) -> "RendererState":
        """Creates the state of a renderer that renders from processor.

        The state's catalogs are the processor's. It checks each message by its own rules,
        whatever validation config the processor was created with, passing them to the
        processor for that call, and applies the messages it accepts to the processor
        itself. A rollback takes a message back out of the processor's model. A function
        call reaches the processor only once the outermost apply or transaction it was
        applied in succeeds, since a function that ran cannot be rolled back. The processor
        must take its messages from the state only.
        """
```

### **Agent: `StreamedAnswer`**

```python
@dataclass
class AnswerTextPart:
    """Text the model wrote between two surfaces, or before or after them."""
    text: str

@dataclass
class AnswerSurfacePart:
    """A surface the answer created, where the model wrote it."""
    surface: SurfaceModel

AnswerPart = Union[AnswerTextPart, AnswerSurfacePart, ErrorPart]

class StreamedAnswer:
    def __init__(self, processor: A2uiRequestProcessor, *, renderer: MessageProcessor):
        """Opens a stream on processor whose state is RendererState.of(renderer), reading
        past rejected blocks. Raises A2uiCatalogError if renderer's catalogs are not
        processor's active catalogs, in the same order."""

    @property
    def renderer(self) -> MessageProcessor:
        """The processor the answer's surfaces are applied to."""

    @property
    def parts(self) -> Sequence[AnswerPart]:
        """The text, one part per surface the answer created and still holds, and an
        ErrorPart per rejected block, in order. Text that arrives in pieces is joined into
        one part until a block comes between."""

    @property
    def is_in_block(self) -> bool:
        """See ResponseStream.is_in_block."""

    def feed(self, chunk: str) -> None: ...
    def close(self) -> None: ...
```

---

## **Links**

- [#3597](https://github.com/a2ui-project/a2ui/issues/3597): API gaps for an app that is both agent and renderer, item 4.
- [`a2ui_agent.blueprint.md`](../modules/a2ui_agent.blueprint.md): `RendererState`, `ResponseStream`, `ErrorPart` and reading past rejected blocks.
- [`a2ui_core.blueprint.md`](../modules/a2ui_core.blueprint.md#messageprocessor): `MessageProcessor` and `ExecutionContext`.

---

## **Test Cases & Conformance**

- `conformance/agent/streamed_answer.yaml`: reading a streamed answer into a renderer's processor.
- `conformance/core/message_processor_v1_0.yaml`: the `test_v10_call_validation_config_*` cases, whose steps pass a `validationConfig` for one call.

An SDK that does not implement the feature has no runner for `streamed_answer.yaml` and skips the `test_v10_call_validation_config_*` cases, naming this blueprint.

---

## **Implementation Steps**

1. Core: expose `MessageProcessor.catalogs`, add `validationConfig` to the per-call options of `processMessages` and `processMessagesAsync`, and run the `test_v10_call_validation_config_*` cases.
2. Agent: add `RendererState.of`, and hold `callRendererFunction` messages until the outermost `apply` or transaction succeeds.
3. Agent: add `StreamedAnswer` on top of `RendererState.of`, and run `streamed_answer.yaml`.
4. Add `agent_renderer_app` to `implemented_features` in the codebase blueprints of the core and the agent.
