# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff  |
| :------------------------------- | :------- | :------ | :---- |
| **Pytest Conformance**           | PASS     | PASS    | -     |
| **Overall Pass Rate**            | 100.0%   | 100.0%  | 0.0%  |
| **Algorithmic Schema Pass Rate** | 100.0%   | 100.0%  | 0.0%  |
| **Inference Duration (sec)**     | 8.78s    | 8.79s   | +0.2% |
| **Avg Input Tokens**             | 0        | 0       | -     |
| **Avg Output Tokens**            | 0        | 0       | -     |

## Active Git Diff

```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
index 408cb95e..c8b55a78 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
@@ -514,23 +514,42 @@ class AtomCompiler:

         while i < len(expr):
             item = expr[i]
-            if isinstance(item, list) and item and str(item[0]) in ("data", "dataModel", "set!"):
-                def extract_components(node):
-                    if isinstance(node, list) and node:
-                        if self._is_component_type(str(node[0])):
-                            expr.append(node)
-                            return True
-                        to_remove = []
-                        for sub in node:
-                            if extract_components(sub):
-                                to_remove.append(sub)
-                        for sub in to_remove:
-                            node.remove(sub)
-                    return False
-                extract_components(item)
-                self._parse_data_node(item, data_model)
-                i += 1
-                continue
+            if isinstance(item, list) and item:
+                # Lossless AST simplification: auto-omit/unwrap default key wrappers on container nodes
+                if isinstance(item[0], str) and item[0].startswith(":") and len(item) > 1:
+                    wrapper_key = item[0][1:]
+                    if wrapper_key in ("children", "child", "content", "items", child_list_prop) or self.schema_helper.get_property_type(comp_type, wrapper_key) in ("ChildList", "Child"):
+                        wrapper_contents = item[1:]
+                        if len(wrapper_contents) == 1 and isinstance(wrapper_contents[0], list) and wrapper_contents[0] and not self._is_component_type(str(wrapper_contents[0][0])):
+                            wrapper_contents = wrapper_contents[0]
+                        for sub_w in wrapper_contents:
+                            if isinstance(sub_w, list) and sub_w:
+                                if self._is_component_type(str(sub_w[0])):
+                                    child_id = self._compile_component(sub_w, components, data_model)
+                                    children.append(child_id)
+                                elif str(sub_w[0]) == "template":
+                                    template_data = self._compile_template(sub_w, components)
+                            elif isinstance(sub_w, str) and sub_w not in ("]", ")", "[", "("):
+                                children.append(sub_w)
+                        i += 1
+                        continue
+                if str(item[0]) in ("data", "dataModel", "set!"):
+                    def extract_components(node):
+                        if isinstance(node, list) and node:
+                            if self._is_component_type(str(node[0])):
+                                expr.append(node)
+                                return True
+                            to_remove = []
+                            for sub in node:
+                                if extract_components(sub):
+                                    to_remove.append(sub)
+                            for sub in to_remove:
+                                node.remove(sub)
+                        return False
+                    extract_components(item)
+                    self._parse_data_node(item, data_model)
+                    i += 1
+                    continue
             if isinstance(item, str) and item.startswith(":"):
                 # Tagged keyword attribute :key val
                 key = item[1:]
```

## Failure Details (Count: 0 / 6)

🎉 _All tests passed successfully!_
