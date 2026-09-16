# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff    |
| :------------------------------- | :------- | :------ | :------ |
| **Pytest Conformance**           | PASS     | PASS    | -       |
| **Overall Pass Rate**            | 100.0%   | 0.0%    | -100.0% |
| **Algorithmic Schema Pass Rate** | 100.0%   | 0.0%    | -100.0% |
| **Inference Duration (sec)**     | 8.79s    | 0.00s   | -100.0% |
| **Avg Input Tokens**             | 0        | 0       | -       |
| **Avg Output Tokens**            | 0        | 0       | -       |

## Active Git Diff

```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
index fe0765d9..5c661142 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
@@ -145,7 +145,7 @@ class AtomPromptGenerator(PromptGenerator):
         return "\n\n".join(parts)

     def generate_component_signatures(self) -> str:
-        """Compiles component definitions into S-expression signatures."""
+        """Compiles component definitions into S-expression signatures with compact flag formatting."""
         if not self.schema_helper:
             return ""
         signatures = []
@@ -162,18 +162,25 @@ class AtomPromptGenerator(PromptGenerator):
                 is_req = p in reqs
                 opt_suffix = "" if is_req else "?"
                 p_schema = self.schema_helper.get_property_schema(name, p)
+                p_type = self.schema_helper.get_property_type(name, p)
+                enum_vals = _get_schema_enum(p_schema)
+
+                type_tag = ""
+                if enum_vals and len(enum_vals) <= 3:
+                    type_tag = f"<{'/'.join(enum_vals)}>"
+                elif p_type == "boolean" or (isinstance(p_schema, dict) and p_schema.get("type") == "boolean"):
+                    type_tag = "<bool>"

-                arg_label = f":{p}{opt_suffix}"
+                arg_label = f":{p}{opt_suffix}{type_tag}"
                 ordered_args.append(arg_label)

                 p_desc = p_schema.get("description") if isinstance(p_schema, dict) else None
-                enum_vals = _get_schema_enum(p_schema)

-                if p_desc or enum_vals:
+                if p_desc or (enum_vals and len(enum_vals) > 3):
                     p_line_parts = []
                     if p_desc:
                         p_line_parts.append(p_desc)
-                    if enum_vals:
+                    if enum_vals and len(enum_vals) > 3:
                         enum_vals_str = ", ".join([f"'{v}'" for v in enum_vals])
                         p_line_parts.append(f"Must be one of: {enum_vals_str}")
                     prop_details.append(f"  - :{p}: {' '.join(p_line_parts)}")
@@ -187,7 +194,7 @@ class AtomPromptGenerator(PromptGenerator):
         return "\n".join(signatures)

     def generate_function_signatures(self) -> str:
-        """Compiles function definitions into S-expression signatures."""
+        """Compiles function definitions into S-expression signatures with compact flag formatting."""
         if not self.schema_helper:
             return ""
         signatures = []
@@ -202,18 +209,19 @@ class AtomPromptGenerator(PromptGenerator):
                 is_req = p in reqs
                 opt_suffix = "" if is_req else "?"
                 p_schema = self.schema_helper.get_property_schema(name, p)
+                enum_vals = _get_schema_enum(p_schema)

-                arg_label = f":{p}{opt_suffix}"
+                type_tag = f"<{'/'.join(enum_vals)}>" if (enum_vals and len(enum_vals) <= 3) else ""
+                arg_label = f":{p}{opt_suffix}{type_tag}"
                 ordered_args.append(arg_label)

                 p_desc = p_schema.get("description") if isinstance(p_schema, dict) else None
-                enum_vals = _get_schema_enum(p_schema)

-                if p_desc or enum_vals:
+                if p_desc or (enum_vals and len(enum_vals) > 3):
                     p_line_parts = []
                     if p_desc:
                         p_line_parts.append(p_desc)
-                    if enum_vals:
+                    if enum_vals and len(enum_vals) > 3:
                         enum_vals_str = ", ".join([f"'{v}'" for v in enum_vals])
                         p_line_parts.append(f"Must be one of: {enum_vals_str}")
                     prop_details.append(f"  - :{p}: {' '.join(p_line_parts)}")
```

## Failure Details (Count: 0 / 0)

🎉 _All tests passed successfully!_
