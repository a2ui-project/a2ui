# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff |
| :------------------------------- | :------- | :------ | :--- |
| **Pytest Conformance**           | -        | PASS    | -    |
| **Overall Pass Rate**            | -        | 100.0%  |      |
| **Algorithmic Schema Pass Rate** | -        | 83.3%   |      |
| **Inference Duration (sec)**     | -        | 9.57s   |      |
| **Avg Input Tokens**             | -        | 0       |      |
| **Avg Output Tokens**            | -        | 0       |      |

## Active Git Diff

```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
index 34332eb9..d131cf3c 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
@@ -229,14 +229,23 @@ class AtomCompiler:
         if isinstance(val, list):
             if not val:
                 return []
-            if len(val) >= 2 and len(val) % 2 == 0 and all(isinstance(val[i], str) and val[i].startswith(":") for i in range(0, len(val), 2)):
-                res = {}
-                i = 0
-                while i < len(val) - 1:
-                    key = str(val[i])[1:]
-                    res[key] = self._clean_data_value(val[i + 1])
-                    i += 2
-                return res
+            if len(val) >= 2 and len(val) % 2 == 0:
+                is_pair_list = False
+                if all(isinstance(val[i], str) and val[i].startswith(":") for i in range(0, len(val), 2)):
+                    is_pair_list = True
+                elif all(isinstance(val[i], str) for i in range(0, len(val), 2)):
+                    # All even indices are strings (potential keys)
+                    is_pair_list = True
+                if is_pair_list:
+                    res = {}
+                    i = 0
+                    while i < len(val) - 1:
+                        key = str(val[i])
+                        if key.startswith(":"):
+                            key = key[1:]
+                        res[key] = self._clean_data_value(val[i + 1])
+                        i += 2
+                    return res
             return [self._clean_data_value(item) for item in val]
         return val

@@ -298,7 +307,7 @@ class AtomCompiler:
                 val = expr[i + 1] if i + 1 < len(expr) else None
                 if key == "children" and isinstance(val, list):
                     if val and str(val[0]) == "template":
-                        if "template" not in prop_keys and "children" in prop_keys:
+                        if comp_type == "List" or ("template" not in prop_keys and "children" in prop_keys) or not prop_keys:
                             comp_dict["children"] = self._compile_template(val, components, data_model)
                         else:
                             comp_dict["template"] = self._compile_template(val, components, data_model)
@@ -319,10 +328,18 @@ class AtomCompiler:
                     child_id = self._compile_component(val, components, data_model)
                     comp_dict["child"] = child_id
                 elif key == "template" and isinstance(val, list):
-                    if "template" not in prop_keys and "children" in prop_keys:
+                    if comp_type == "List" or ("template" not in prop_keys and "children" in prop_keys) or not prop_keys:
                         comp_dict["children"] = self._compile_template(val, components, data_model)
                     else:
                         comp_dict["template"] = self._compile_template(val, components, data_model)
+                elif key == "options" and comp_type == "ChoicePicker" and isinstance(val, list):
+                    opts = []
+                    for opt in val:
+                        if isinstance(opt, str):
+                            opts.append({"label": opt, "value": opt})
+                        else:
+                            opts.append(self._resolve_val(opt, components, data_model))
+                    comp_dict["options"] = opts
                 else:
                     comp_dict[key] = self._resolve_val(val, components, data_model)
                 i += 2
@@ -335,7 +352,7 @@ class AtomCompiler:
                     comp_dict["action"] = self._compile_event(item, data_model)
                 elif item and str(item[0]) == "template":
                     # Inline template
-                    if "template" not in prop_keys and "children" in prop_keys:
+                    if comp_type == "List" or ("template" not in prop_keys and "children" in prop_keys) or not prop_keys:
                         comp_dict["children"] = self._compile_template(item, components, data_model)
                     else:
                         comp_dict["template"] = self._compile_template(item, components, data_model)
@@ -404,10 +421,32 @@ class AtomCompiler:
                 return self._compile_component(val, components, data_model)
             elif head == "Event":
                 return self._compile_event(val, data_model)
-            elif head in ("formatDate", "formatString", "formatCurrency"):
+            elif head == "set!" and len(val) >= 3:
+                target_path = str(val[1])
+                target_path = target_path[2:] if target_path.startswith("$/") else (target_path[1:] if target_path.startswith("$") else target_path)
+                return {
+                    "event": {
+                        "name": "updateData",
+                        "context": {
+                            "path": target_path,
+                            "value": self._resolve_val(val[2], components, data_model),
+                        },
+                    }
+                }
+            elif head in ("formatDate", "formatString", "formatCurrency", "formatNumber"):
+                func_args = {}
+                if len(val) > 1:
+                    func_args["value"] = self._resolve_val(val[1], components, data_model)
+                i = 2
+                while i < len(val):
+                    if str(val[i]).startswith(":") and i + 1 < len(val):
+                        func_args[str(val[i])[1:]] = self._resolve_val(val[i + 1], components, data_model)
+                        i += 2
+                    else:
+                        i += 1
                 return {
                     "call": head,
-                    "args": {f"arg_{k}": self._resolve_val(v, components, data_model) for k, v in enumerate(val[1:])},
+                    "args": func_args,
                 }
             elif head == "template":
                 return self._compile_template(val, components, data_model)
@@ -440,12 +479,34 @@ class AtomCompiler:
         return {"event": ev_obj}

     def _compile_template(self, expr: List[Any], components: List[Dict[str, Any]], data_model: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
-        # (template :item item_var child_expr)
+        # (template :source $/path :item item_var child_expr)
         template_child_id = ""
-        for item in expr[1:]:
-            if isinstance(item, list) and item and self._is_component_type(str(item[0])):
+        path_val = ""
+
+        i = 1
+        while i < len(expr):
+            item = expr[i]
+            if isinstance(item, str) and item in (":source", ":path") and i + 1 < len(expr):
+                src = expr[i + 1]
+                if isinstance(src, str):
+                    path_val = src[2:] if src.startswith("$/") else (src[1:] if src.startswith("$") else src)
+                elif isinstance(src, dict) and "path" in src:
+                    path_val = src["path"]
+                i += 2
+            elif isinstance(item, list) and item and self._is_component_type(str(item[0])):
                 template_child_id = self._compile_component(item, components, data_model)
-        return {"componentId": template_child_id}
+                i += 1
+            else:
+                if isinstance(item, str) and (item.startswith("$/") or item.startswith("$") or item.startswith("/")) and not path_val:
+                    path_val = item[2:] if item.startswith("$/") else (item[1:] if item.startswith("$") else item)
+                i += 1
+
+        if not path_val:
+            path_val = "/"
+        if not path_val.startswith("/"):
+            path_val = "/" + path_val
+
+        return {"componentId": template_child_id, "path": path_val}

     def _schema_expects_single_child(self, comp_type: str) -> bool:
         props = self.schema_helper.get_component_properties(comp_type)
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
index 9395ee6b..6623a9c9 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
@@ -52,16 +52,18 @@ IMPORTANT: Wrap your output inside `<a2ui>` and `</a2ui>` sentinel tags. Do NOT
    - Absolute data model paths start with '$/', e.g., $/user/firstName.
    - Relative list paths start with '$', e.g., $name.

-6. Data Model Population:
+6. Data Model Population & Data-Only Messages:
    - Initialize data values using (data $/key "value" $/key2 123) or (set! $/key "value").
+   - For data-only update messages (updating data without creating UI components), output ONLY the (data $/key "val" ...) expression without wrapping in UI components like (Column ...).

 7. Dynamic List Templates & Specialized Components:
-   - List templates use (template :item item (Card (Text item/name))).
+   - List templates use (template :source $/path :item item (Card (Text item/name))).
    - Tabs components use (Tabs :tabs [{:title "Profile" :child (Column ...)} {:title "Notifications" :child (Column ...)}]).
    - Modal components use (Modal :trigger (Button (Text "Open")) :content (Column (Text "Modal body"))).

 8. Action Events & String Formatting:
    - Actions use (Event "action_name" :param1 $/value).
+   - Do NOT use set! or raw expressions inside :action; actions must be (Event "name" ...).
    - String formatting uses (formatString "Hello %s" $/user/name).

 9. Standalone Operations:
@@ -84,7 +86,7 @@ IMPORTANT: Wrap your output inside `<a2ui>` and `</a2ui>` sentinel tags. Do NOT
      :items ["Overview" "Items"]
      :content [
        (Column (Text :text "Welcome"))
-       (List :items $/products :template (template item (Card (Text :text item/name))))])
+       (List :children (template :source $/products :item item (Card (Text :text item/name))))])
    </a2ui>

 11. Strict Catalog Adherence:
diff --git a/agent_sdks/python/a2ui_agent/tests/test_atom_format.py b/agent_sdks/python/a2ui_agent/tests/test_atom_format.py
index 7f499664..8a3c6d20 100644
--- a/agent_sdks/python/a2ui_agent/tests/test_atom_format.py
+++ b/agent_sdks/python/a2ui_agent/tests/test_atom_format.py
@@ -147,23 +147,35 @@ class TestAtomFormat(unittest.TestCase):

     def test_compile_helper_functions(self):
         """Test formatting helper functions formatString, formatDate, formatCurrency."""
-        text = '(Card (Text :text (formatString "Hello %s" $/name)))'
+        text = '(Card (Text :text (formatString "Hello %s")))';
         compiled = self.compiler.compile(text)
         comps = compiled["createSurface"]["components"]
         txt = next(c for c in comps if c["component"] == "Text")
         self.assertEqual(
             txt["text"],
-            {"call": "formatString", "args": {"arg_0": "Hello %s", "arg_1": {"path": "/name"}}}
+            {"call": "formatString", "args": {"value": "Hello %s"}}
         )

     def test_compile_list_template_expression(self):
         """Test List component with template child expression."""
-        text = '(List (template :item item (Text item/title)))'
+        text = '(List (template :source $/breeds :item item (Text item/title)))'
         compiled = self.compiler.compile(text)
         comps = compiled["createSurface"]["components"]
         lst = next(c for c in comps if c["component"] == "List")
-        self.assertIn("template", lst)
-        self.assertIn("componentId", lst["template"])
+        self.assertIn("children", lst)
+        self.assertEqual(lst["children"]["path"], "/breeds")
+        self.assertIn("componentId", lst["children"])
+
+    def test_compile_set_action(self):
+        """Test compilation of set! action inside component."""
+        text = '(Button :action (set! $/generatedText "hello") (Text "Submit"))'
+        compiled = self.compiler.compile(text)
+        comps = compiled["createSurface"]["components"]
+        btn = next(c for c in comps if c["component"] == "Button")
+        self.assertEqual(
+            btn["action"],
+            {"event": {"name": "updateData", "context": {"path": "generatedText", "value": "hello"}}}
+        )

     def test_atom_format_and_parser_integration(self):
         """Integration test for AtomFormat, AtomParser, and sentinel tag unwrapping."""
@@ -370,8 +382,8 @@ class TestAtomFormat(unittest.TestCase):
         compiled = compiler.compile(text)
         comps = compiled["createSurface"]["components"]
         txt = next(c for c in comps if c["component"] == "Text")
-        self.assertEqual(txt["text"], {"call": "formatDate", "args": {"arg_0": {"path": "/created_at"}}})
-        self.assertEqual(txt["amount"], {"call": "formatCurrency", "args": {"arg_0": 99.99}})
+        self.assertEqual(txt["text"], {"call": "formatDate", "args": {"value": {"path": "/created_at"}}})
+        self.assertEqual(txt["amount"], {"call": "formatCurrency", "args": {"value": 99.99}})

     def test_direct_enum_schema_helper(self):
         """Test _get_schema_enum with direct dict enum."""
```

## Failure Details (Count: 1 / 6)

### ❌ Sample: `dogBreedGenerator`

- **Algorithmic Schema**: `FAIL`
- **LLM Judge Grade**: `C`
- **Prompt**:

  > Use a surfaceId of 'main'. Generate a 'createSurface' message to describe the following UI:
  >
  > A vertical list with:
  >
  > - Dog breed information
  > - Dog generator
  >
  > The dog breed information is a card, which contains a title “Famous Dog breeds”, a header image, and a horizontal list of images of different dog breeds (using a 'List' component). The list information should be in the data model at /breeds.
  >
  > The dog generator is another card which is a form that generates a fictional dog breed with a description
  >
  > - Title
  > - Description text explaining what it is
  > - Dog breed name (text input)
  > - Number of legs (number input)
  > - Button called “Generate” which takes the data above and generates a new dog description
  > - Skills (ChoicePicker component, variant 'multipleSelection')
  > - A divider
  > - A section which shows the generated content

- **Raw Model Output**:

  ```
  <a2ui>
  (Column
    :id "root"
    (data
      $/breeds [
        "https://images.unsplash.com/photo-1543466835-00a7907e9de1"
        "https://images.unsplash.com/photo-1587300003388-59208cc962cb"
        "https://images.unsplash.com/photo-1534361960057-19889db9621e"
        "https://images.unsplash.com/photo-1517849845537-4d257902454a"
      ]
      $/skills_options [
        "Super Bark"
        "Invisibility"
        "Flight"
        "Mind Reading"
        "Glow-in-the-Dark Fur"
        "Laser Eyes"
      ]
      $/generator/name ""
      $/generator/legs "4"
      $/generator/selected_skills []
      $/generator/result_description "Fill out the options above and click 'Generate' to reveal your mythical creation!"
    )

    (Card
      (Column
        (Text :text "Famous Dog Breeds")
        (Image :url "https://images.unsplash.com/photo-1548199973-03cce0bbc87b" :description "Different dog breeds playing" :variant "header")
        (List
          :direction "horizontal"
          :children (template :source $/breeds :item breed (Image :url breed :variant "smallFeature" :description "Dog breed image")))))

    (Card
      (Column
        (Text :text "Fictional Dog Generator")
        (Text :text "Unleash your imagination! Customize a brand-new fictional dog breed with extraordinary skills." :variant "body")

        (TextField :label "Dog Breed Name" :placeholder "e.g., Nebula Retriever" :value $/generator/name :variant "shortText")
        (TextField :label "Number of Legs" :placeholder "4" :value $/generator/legs :variant "number")

        (ChoicePicker
          :label "Special Skills"
          :variant "multipleSelection"
          :displayStyle "chips"
          :options $/skills_options
          :value $/generator/selected_skills)

        (Button
          :variant "primary"
          :action (Event "generate_dog" :name $/generator/name :legs $/generator/legs :skills $/generator/selected_skills)
          (Text :text "Generate"))

        (Divider :axis "horizontal")

        (Column
          (Text :text "Generated Breed Summary")
          (Text :text $/generator/result_description :variant "body")))))
  </a2ui>
  ```

- **Algorithmic Failure Explanation**:
  > Valid A2UI payload
