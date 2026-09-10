# A2UI macro expansion conformance test suite

This directory contains language-agnostic conformance tests for A2UI macro expansion and parsing implementations.

## Purpose

Macro conformance tests verify that SDK implementations across languages (Python, TypeScript, Dart):

1. Correctly detect macro component invocations within A2UI message envelopes (`createSurface`, `updateComponents`, `surfaceUpdate`).
2. Expand macros into standard A2UI primitives according to their template definitions.
3. Preserve the macro invocation ID as the root ID of the expanded subtree, ensuring parent references remain valid.
4. Coerce parameters properly, including string IDs into child component slots, ID sequences into child lists, and path dictionaries into data bindings.
5. Recursively expand nested macros.
6. Leave non-macro components completely untouched.

## Test case schema

Each YAML document in this directory contains a list of test cases conforming to the following structure:

```yaml
- name: string # Unique test identifier (e.g. test_expand_simple_macro)
  description: string # Clear explanation of what is verified
  macros:
    - name: string # Macro component name
      parameters: # Parameter declarations
        <param>:
          type: string # Schema type (string, integer, boolean, component, component_list, binding)
          default: any # Optional default value
      template: # Expansion template definition
        component: string # Root component name
        <props>: any # Component properties and slots
  input_messages: [object] # Input A2UI wire messages containing macro components
  expected_messages: [object] # Expected A2UI wire messages after macro expansion
```
