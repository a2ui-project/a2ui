1. **The fallback rejects mixed boolean/object arguments despite the message’s assurance**

   **Severity:** blocker  
   **Commit:** `c3d8923a`, message lines 23–25; `dart/a2ui_core/lib/src/resolution/data_context.dart:1205–1215`.

   The message says an argument whose schema expects an object containing `valid` “still matches.” Both validation attempts operate on the **entire argument map**, however.

   Consider a function with `flag: DynamicBoolean` and `status: object`, receiving:

   ```json
   {
     "flag": {"valid": true},
     "status": {"valid": false, "note": "checked"}
   }
   ```

   These are resolved arguments, with `flag` obtained through a binding. The converted attempt fails because `status` becomes `false`. The original attempt fails because `flag` remains an object. Both `Catalog.invoke` and the RPC handler therefore reject this valid combination. The tests cover boolean and object positions separately, missing their combination.

   **Smallest fix:** Convert validation results according to each schema position, preserving object positions. Add a mixed-position regression test. Until that is implemented, replace the assurance with: “The fallback preserves object arguments only when the entire original argument map matches.”

2. **The accessibility message places Slider’s live region on two different nodes**

   **Severity:** blocker  
   **Commit:** `e2514ce2`, message lines 27–35.

   Lines 27–28 say: “On a TextField or Slider the region is the control’s own node.” Lines 34–35 instead say Slider’s attributes “land on a parent node of the focusable control.”

   The latter matches the implementation and the changed codebase blueprint: `NodeView` wraps the component, while `slider.dart` builds the visible label as a `Text` sibling above the Flutter `Slider`. Announcing that label does not mean the live region is the slider control’s own node.

   **Smallest fix:** Replace the first explanation with: “On a TextField the region is the control’s own node. On a Slider the region contains the separate label above the focusable control, so changes to that label are announced.”

3. **The final blueprint-coverage claim omits an unrecorded deviation**

   **Severity:** blocker  
   **Commit:** `e2514ce2`, message lines 42–46; `blueprints/codebases/dart/a2ui_flutter/codebase.blueprint.md:22–27`.

   The message claims coverage of the blueprint’s v1.0 sections “apart from the deviations the codebase blueprint records.” The module blueprint’s §8 explicitly requires a v1.0 `createSurface` carrying `theme` to render identically to one without it.

   Core instead rejects that field: `AgentToRendererMessage.fromJson` checks `_createSurfaceV1Keys`, which excludes `theme`. Commit 4 correctly describes this rejection, but the codebase blueprint does not record it.

   **Smallest fix:** Add a codebase-blueprint deviation: “Core rejects a v1.0 `createSurface` carrying `theme`, rather than ignoring it as the module blueprint’s ‘Theme ignored’ test requests.” Alternatively, narrow the message’s blanket coverage claim.

4. **Accepted DynamicBoolean arguments still reach custom functions as objects**

   **Severity:** should-fix  
   **Commit:** `c3d8923a`, `data_context.dart:1205–1215`; callers at `data_context.dart:1173` and `rpc_handler.dart:403`.

   The message accurately acknowledges: “Only the check uses the replacement.” That leaves a protocol defect. Rule 1 explicitly says functions with DynamicBoolean arguments “receive and return plain booleans.”

   After this change, a custom function declaring a DynamicBoolean argument passes validation with a resolved `{"valid": true}`, but `args['flag'] as bool` still throws, and `args['flag'] == true` incorrectly returns false. Both execution paths pass the original arguments. The built-in combinators work because they separately call `validityOf`; that does not satisfy the custom-function contract. The new echo test actually asserts preservation of the result object.

   **Smallest fix:** Share schema-directed argument normalization between validation and execution in both callers. Preserve object-typed arguments and v0.9 behavior. Add tests asserting the value received by a custom DynamicBoolean function through invocation and RPC.

I checked all 12 messages against their individual diffs. No additional discrepancies found in commits **1, 3–11**. In particular:

- Commit 2 correctly describes the version gate, extensible boolean-`valid` objects, built-in combinator behavior, and the historical argument-check/RPC changes.
- Commit 8’s failed-poster fallback uses the current readiness state and has a regression test covering failure before video initialization.
- Commit 10’s Button tooltip selects errors before hints and leaves warning/info checks nonblocking.
- The 43/44 example counts, 17 heading-bearing examples, import dependency in commit 11, and blueprint path-only history are accurate.
- All messages satisfy the stated trailer, punctuation, Conventional Commit, and attribution rules.

I used read-only inspection only. I did not run Flutter, Dart, tests, formatters, or cherry-picks; platform behavior and clean application of the port were not runtime-verified.
