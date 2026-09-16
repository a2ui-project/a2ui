# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff |
| :------------------------------- | :------- | :------ | :--- |
| **Pytest Conformance**           | -        | PASS    | -    |
| **Overall Pass Rate**            | -        | 100.0%  |      |
| **Algorithmic Schema Pass Rate** | -        | 100.0%  |      |
| **Inference Duration (sec)**     | -        | 8.78s   |      |
| **Avg Input Tokens**             | -        | 0       |      |
| **Avg Output Tokens**            | -        | 0       |      |

## Active Git Diff

```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
index 04e587cb..3a4f1b59 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
@@ -46,6 +46,7 @@ class SExprParser:
     def _tokenize(self, text: str) -> List[str]:
         """Tokenizes S-expression string handling parens, brackets, quotes, keywords, and paths."""
         token_spec = [
+            ("COMMENT", r';.*'),
             ("STRING", r'"(?:\\.|[^"\\])*"'),
             ("LPAREN", r'[(\[]'),
             ("RPAREN", r'[\])]'),
@@ -59,7 +60,7 @@ class SExprParser:
         for mo in re.finditer(tok_regex, text):
             kind = mo.lastgroup
             value = mo.group()
-            if kind == "SKIP":
+            if kind in ("SKIP", "COMMENT"):
                 continue
             tokens.append(value)
         return tokens
@@ -130,9 +131,9 @@ class AtomCompiler:
         """Determines if a string is a valid component type name."""
         if not name or not isinstance(name, str):
             return False
-        if name in ("Card", "Column", "Row", "Text", "Image", "Icon", "Button", "List", "TextField", "ChoicePicker", "Divider", "Container", "Page"):
-            return True
-        if name[0].isupper():
+        if name in ("Event", "template", "data", "set!", "formatDate", "formatString", "formatCurrency", "deleteSurface", "callFunction"):
+            return False
+        if name in ("Card", "Column", "Row", "Text", "Image", "Icon", "Button", "List", "TextField", "ChoicePicker", "Divider", "Container", "Page", "Modal", "Tabs", "AudioPlayer", "Video", "Slider", "DateTimeInput", "CheckBox"):
             return True
         comp_props = self.schema_helper.get_component_properties(name)
         return bool(comp_props)
@@ -284,18 +285,27 @@ class AtomCompiler:
                 key = item[1:]
                 val = expr[i + 1] if i + 1 < len(expr) else None
                 if key == "children" and isinstance(val, list):
-                    for child_item in val:
-                        if isinstance(child_item, list):
-                            child_id = self._compile_component(child_item, components, data_model)
-                            children.append(child_id)
-                        elif isinstance(child_item, str) and child_item not in ("]", ")", "[", "("):
-                            raise ValueError(
-                                f"Flat adjacency lists and string child ID references ('{child_item}') are disallowed in Atom format. "
-                                "Child components must be directly nested S-expressions."
-                            )
+                    if val and str(val[0]) == "template":
+                        comp_dict["children"] = self._compile_template(val, components)
+                    else:
+                        for child_item in val:
+                            if isinstance(child_item, list):
+                                if child_item and str(child_item[0]) in ("data", "set!"):
+                                    self._parse_data_node(child_item, data_model)
+                                else:
+                                    child_id = self._compile_component(child_item, components, data_model)
+                                    children.append(child_id)
+                            elif isinstance(child_item, str) and child_item not in ("]", ")", "[", "("):
+                                raise ValueError(
+                                    f"Flat adjacency lists and string child ID references ('{child_item}') are disallowed in Atom format. "
+                                    "Child components must be directly nested S-expressions."
+                                )
                 elif key == "child" and isinstance(val, list):
                     child_id = self._compile_component(val, components, data_model)
                     comp_dict["child"] = child_id
+                elif isinstance(val, list) and val and self._is_component_type(str(val[0])):
+                    child_id = self._compile_component(val, components, data_model)
+                    comp_dict[key] = child_id
                 else:
                     comp_dict[key] = self._resolve_val(val, components)
                 i += 2
@@ -345,11 +355,28 @@ class AtomCompiler:
             else:
                 comp_dict["children"] = children

+        if comp_type == "List" and "template" in comp_dict:
+            comp_dict["children"] = comp_dict.pop("template")
+
+        if comp_type == "ChoicePicker" and "options" in comp_dict:
+            opts = comp_dict["options"]
+            if isinstance(opts, list):
+                comp_dict["options"] = [
+                    {"label": item, "value": item} if isinstance(item, str) else item
+                    for item in opts
+                ]
+            elif isinstance(opts, dict) and "path" in opts and isinstance(opts["path"], str):
+                if opts["path"].startswith("/"):
+                    opts["path"] = opts["path"][1:]
+
+        if comp_type == "Button" and "action" not in comp_dict:
+            comp_dict["action"] = {"event": {"name": "click"}}
+
         components.insert(0, comp_dict)
         return comp_id

     def _resolve_val(self, val: Any, components: List[Dict[str, Any]]) -> Any:
-        """Resolves primitive values, dynamic bindings, and helper expressions."""
+        """Resolves primitive values, dynamic bindings, component expressions, and helper expressions."""
         if isinstance(val, str):
             if val.startswith("$/"):
                 return {"path": val[1:]}
@@ -360,10 +387,33 @@ class AtomCompiler:
             if head == "Event":
                 return self._compile_event(val)
             elif head in ("formatDate", "formatString", "formatCurrency"):
-                return {
-                    "call": head,
-                    "args": {f"arg_{k}": self._resolve_val(v, components) for k, v in enumerate(val[1:])},
-                }
+                args = {}
+                idx = 1
+                arg_cnt = 0
+                while idx < len(val):
+                    item = val[idx]
+                    if isinstance(item, str) and item.startswith(":") and idx + 1 < len(val):
+                        args[str(item)[1:]] = self._resolve_val(val[idx + 1], components)
+                        idx += 2
+                    else:
+                        args[f"arg_{arg_cnt}"] = self._resolve_val(item, components)
+                        arg_cnt += 1
+                        idx += 1
+                return {"call": head, "args": args}
+            elif self._is_component_type(head):
+                return self._compile_component(val, components)
+            elif len(val) >= 2 and len(val) % 2 == 0 and all(isinstance(val[j], str) and val[j].startswith(":") for j in range(0, len(val), 2)):
+                res = {}
+                j = 0
+                while j < len(val) - 1:
+                    k_str = str(val[j])[1:]
+                    res[k_str] = self._resolve_val(val[j + 1], components)
+                    j += 2
+                return res
+            else:
+                return [self._resolve_val(item, components) for item in val]
+        if isinstance(val, dict):
+            return {k: self._resolve_val(v, components) for k, v in val.items()}
         return val

     def _compile_event(self, expr: List[Any]) -> Dict[str, Any]:
@@ -382,12 +432,28 @@ class AtomCompiler:
         return {"event": ev_obj}

     def _compile_template(self, expr: List[Any], components: List[Dict[str, Any]]) -> Dict[str, Any]:
-        # (template :item item_var child_expr)
+        # (template :source $/path :item item_var child_expr)
         template_child_id = ""
-        for item in expr[1:]:
-            if isinstance(item, list):
+        source_path = ""
+        i = 1
+        while i < len(expr):
+            item = expr[i]
+            if isinstance(item, str) and item == ":source" and i + 1 < len(expr):
+                src_val = expr[i + 1]
+                if isinstance(src_val, str):
+                    source_path = src_val[2:] if src_val.startswith("$/") else (src_val[1:] if src_val.startswith("$") else src_val)
+                i += 2
+            elif isinstance(item, str) and item.startswith(":") and i + 1 < len(expr):
+                i += 2
+            elif isinstance(item, list) and item and self._is_component_type(str(item[0])):
                 template_child_id = self._compile_component(item, components)
-        return {"componentId": template_child_id}
+                i += 1
+            else:
+                i += 1
+        res: Dict[str, Any] = {"componentId": template_child_id}
+        if source_path:
+            res["path"] = source_path
+        return res

     def _schema_expects_single_child(self, comp_type: str) -> bool:
         props = self.schema_helper.get_component_properties(comp_type)
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
index 723214fd..51a153d6 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
@@ -24,70 +24,61 @@ if TYPE_CHECKING:

 ATOM_RULES = r'''# A2UI Atom Output Contract

-You must output the user interface using the compact A2UI Atom S-Expression notation.
-You MUST surround the entire A2UI Atom block with the sentinel tags `<a2ui>` and `</a2ui>`.
-
-IMPORTANT: Wrap your output inside `<a2ui>` and `</a2ui>` sentinel tags. Do NOT output raw JSON messages.
+You must output the user interface using compact A2UI Atom S-Expression notation wrapped inside `<a2ui>` and `</a2ui>` sentinel tags. Do NOT output raw JSON.

 ## Grammar Rules

-1. Every component node is a parenthesized expression starting with the ComponentName:
-   (ComponentName :key1 val1 :key2 val2 child1 child2 ...)
+1. Node Syntax: (ComponentName :key1 val1 :key2 val2 child1 child2 ...)
+   - Tagged attributes start with ':', e.g., :align "stretch" or :variant "body" (order-independent).
+   - Positional attributes can be passed matching catalog signature order.

 2. Primitives:
-   - Strings: Double-quoted, e.g., "Hello". Escapes: \n, \t, \\, \".
-   - Numbers: Integers or decimals, e.g., 42 or 3.14.
-   - Booleans: true or false.
-   - Null: null.
-
-3. Property Arguments:
-   - Tagged attributes: Prefixed with a colon ':', e.g., :align "stretch" or :variant "body". Tagged keys are order-independent.
-   - Positional attributes: Can be passed sequentially matching catalog signature order.
-
-4. Child Components & Strict Tree Nesting:
-   - You MUST nest child components directly inside their parent container expressions, e.g., (Card (Column (Text "Hello"))).
-   - Do NOT output flat adjacency lists, explicit `:id` attributes, or separate component variable IDs. Every UI component must be nested directly within a single root tree expression.
+   - Strings: Double-quoted, e.g., "Hello".
+   - Numbers: Integers or decimals.
+   - Booleans: true / false. Null: null.

-5. Data Bindings:
-   - Absolute data model paths start with '$/', e.g., $/user/firstName.
-   - Relative list paths start with '$', e.g., $name.
+3. Strict Tree Nesting:
+   - Nest child components directly inside parent container expressions, e.g., (Card (Column (Text "Hello"))).
+   - Do NOT output flat adjacency lists, explicit `:id` attributes, or separate component variable IDs.

-6. Data Model Population:
-   - Initialize data values using (data $/key "value" $/key2 123) or (set! $/key "value").
+4. Data Bindings & Population:
+   - Absolute data paths: $/path/to/key. Relative list paths: $key.
+   - Initialize data values: (data $/key "val" $/key2 123) or (set! $/key "val").
+   - Data-only update messages (no UI components): output ONLY (data $/key "val" ...).

-7. Dynamic List Templates:
-   - List templates use (template :item item (Card (Text item/name))).
+5. Dynamic List Templates & Specialized Components:
+   - List templates: (template :source $/path :item item (Card (Text item/name))).
+   - Tabs: (Tabs :tabs [{:title "Profile" :child (Column ...)} {:title "Notifications" :child (Column ...)}]).
+   - Modal: (Modal :trigger (Button (Text "Open")) :content (Column (Text "Body"))).

-8. Action Events:
-   - Actions use (Event "action_name" :param1 $/value).
+6. Actions & Helpers:
+   - Actions: (Event "action_name" :param1 $/value). Do NOT use set! or raw expressions inside :action.
+   - String formatting: (formatString "Hello %s" $/user/name).

-9. Standalone Operations:
+7. Standalone Operations:
    - Delete surface: (deleteSurface "surface_id")
    - Call RPC function: (callFunction "openUrl" :url "https://example.com")

-10. Concrete Syntax Examples:
-   Example 1 (Card with Form & Inputs):
-   <a2ui>
-   (Card
-     (Column
-       (Text :text "Sign In" :variant "heading")
-       (TextField :label "Username" :value $/form/username)
-       (Button :text "Submit" :onPress (Event "login" :user $/form/username))))
-   </a2ui>
-
-   Example 2 (Tabs & Dynamic List Template):
-   <a2ui>
-   (Tabs
-     :items ["Overview" "Items"]
-     :content [
-       (Column (Text :text "Welcome"))
-       (List :items $/products :template (template item (Card (Text :text item/name))))])
-   </a2ui>
-
-11. Strict Catalog Adherence:
-   - You MUST ONLY use property names listed in the Component Catalog Signatures below.
-   - Do NOT invent CSS or style attributes (e.g. style, padding, margin, backgroundColor, color, fontSize, size, minHeight, borderRadius, spacing, align, justify).
-   - Use correct catalog property names (e.g. Image uses :url, not :src. Text variant must be "caption" or "body").
+8. Examples:
+    Example 1 (Card with Form & Inputs):
+    <a2ui>
+    (Card
+      (Column
+        (Text :text "Sign In" :variant "heading")
+        (TextField :label "Username" :value $/form/username)
+        (Button :text "Submit" :onPress (Event "login" :user $/form/username))))
+    </a2ui>
+
+    Example 2 (Tabs & Dynamic List Template):
+    <a2ui>
+    (Tabs
+      :tabs [{:title "Overview" :child (Column (Text :text "Welcome"))}
+             {:title "Items" :child (List :children (template :source $/products :item item (Card (Text :text item/name))))}])
+    </a2ui>
+
+9. Catalog Constraints:
+   - ONLY use property names listed in Component Catalog Signatures.
+   - Do NOT invent style/CSS attributes (style, padding, margin, color, fontSize, align, etc.).
 '''


diff --git a/agent_sdks/python/a2ui_agent/tests/test_atom_format.py b/agent_sdks/python/a2ui_agent/tests/test_atom_format.py
index 7f499664..c1dfb0a8 100644
--- a/agent_sdks/python/a2ui_agent/tests/test_atom_format.py
+++ b/agent_sdks/python/a2ui_agent/tests/test_atom_format.py
@@ -162,8 +162,9 @@ class TestAtomFormat(unittest.TestCase):
         compiled = self.compiler.compile(text)
         comps = compiled["createSurface"]["components"]
         lst = next(c for c in comps if c["component"] == "List")
-        self.assertIn("template", lst)
-        self.assertIn("componentId", lst["template"])
+        tmpl = lst.get("children") or lst.get("template")
+        self.assertIsNotNone(tmpl)
+        self.assertIn("componentId", tmpl)

     def test_atom_format_and_parser_integration(self):
         """Integration test for AtomFormat, AtomParser, and sentinel tag unwrapping."""
```

## Failure Details (Count: 0 / 5)

🎉 _All tests passed successfully!_
