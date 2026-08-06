# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff |
| :------------------------------- | :------- | :------ | :--- |
| **Pytest Conformance**           | -        | PASS    | -    |
| **Overall Pass Rate**            | -        | 66.7%   |      |
| **Algorithmic Schema Pass Rate** | -        | 66.7%   |      |
| **Inference Duration (sec)**     | -        | 8.48s   |      |
| **Avg Input Tokens**             | -        | 0       |      |
| **Avg Output Tokens**            | -        | 0       |      |

## Active Git Diff

```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
index 04e587cb..34332eb9 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
@@ -22,17 +22,29 @@ from a2ui.schema.catalog import A2uiCatalog
 class CatalogSchemaHelperWrapper:
     def __init__(self, catalog: Any):
         self.catalog = catalog
+        try:
+            from a2ui.inference_formats.experimental.express.schema_helper import CatalogSchemaHelper
+            self.schema_helper = CatalogSchemaHelper(catalog)
+        except Exception:
+            self.schema_helper = None

     def get_component_properties(self, comp_type: str) -> Dict[str, Any]:
+        if self.schema_helper:
+            return self.schema_helper.get_component_properties(comp_type)
         if hasattr(self.catalog, "get_components"):
             comps = self.catalog.get_components()
             if comp_type in comps:
                 return comps[comp_type].get("properties", {})
-        try:
-            from a2ui.inference_formats.experimental.express.schema_helper import CatalogSchemaHelper
-            return CatalogSchemaHelper(self.catalog).get_component_properties(comp_type)
-        except Exception:
-            return {}
+        return {}
+
+    def get_component_names(self) -> set[str]:
+        if self.schema_helper and hasattr(self.schema_helper, "component_properties"):
+            return set(self.schema_helper.component_properties.keys())
+        if hasattr(self.catalog, "get_components"):
+            comps = self.catalog.get_components()
+            if comps:
+                return set(comps.keys())
+        return set()


 class SExprParser:
@@ -47,11 +59,11 @@ class SExprParser:
         """Tokenizes S-expression string handling parens, brackets, quotes, keywords, and paths."""
         token_spec = [
             ("STRING", r'"(?:\\.|[^"\\])*"'),
-            ("LPAREN", r'[(\[]'),
-            ("RPAREN", r'[\])]'),
+            ("LPAREN", r'[(\[{]'),
+            ("RPAREN", r'[\])}]' ),
             ("KEYWORD", r':\w+'),
             ("PATH", r'\$/?[\w/]+'),
-            ("SYMBOL", r'[^\s()":\[\],]+'),
+            ("SYMBOL", r'[^\s()":\[\],{}]+'),
             ("SKIP", r'[,\s]+'),
         ]
         tok_regex = "|".join(f"(?P<{pair[0]}>{pair[1]})" for pair in token_spec)
@@ -130,12 +142,13 @@ class AtomCompiler:
         """Determines if a string is a valid component type name."""
         if not name or not isinstance(name, str):
             return False
-        if name in ("Card", "Column", "Row", "Text", "Image", "Icon", "Button", "List", "TextField", "ChoicePicker", "Divider", "Container", "Page"):
-            return True
-        if name[0].isupper():
-            return True
-        comp_props = self.schema_helper.get_component_properties(name)
-        return bool(comp_props)
+        if name in ("Event", "data", "set!", "deleteSurface", "callFunction", "template", "formatDate", "formatString", "formatCurrency"):
+            return False
+        known_names = self.schema_helper.get_component_names()
+        if known_names:
+            return name in known_names
+        standard_comps = {"Card", "Column", "Row", "Text", "Image", "Icon", "Button", "List", "TextField", "ChoicePicker", "Divider", "Container", "Page", "Tabs", "Modal", "CheckBox", "Slider", "Switch", "AudioPlayer", "VideoPlayer", "DateTimeInput"}
+        return name in standard_comps

     def compile(
         self, text: str, surface_id: str = "main", is_final: bool = True
@@ -284,20 +297,34 @@ class AtomCompiler:
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
+                        if "template" not in prop_keys and "children" in prop_keys:
+                            comp_dict["children"] = self._compile_template(val, components, data_model)
+                        else:
+                            comp_dict["template"] = self._compile_template(val, components, data_model)
+                    elif val and self._is_component_type(str(val[0])):
+                        child_id = self._compile_component(val, components, data_model)
+                        children.append(child_id)
+                    else:
+                        for child_item in val:
+                            if isinstance(child_item, list) and child_item and self._is_component_type(str(child_item[0])):
+                                child_id = self._compile_component(child_item, components, data_model)
+                                children.append(child_id)
+                            elif isinstance(child_item, str) and child_item not in ("]", ")", "[", "("):
+                                raise ValueError(
+                                    f"Flat adjacency lists and string child ID references ('{child_item}') are disallowed in Atom format. "
+                                    "Child components must be directly nested S-expressions."
+                                )
                 elif key == "child" and isinstance(val, list):
                     child_id = self._compile_component(val, components, data_model)
                     comp_dict["child"] = child_id
+                elif key == "template" and isinstance(val, list):
+                    if "template" not in prop_keys and "children" in prop_keys:
+                        comp_dict["children"] = self._compile_template(val, components, data_model)
+                    else:
+                        comp_dict["template"] = self._compile_template(val, components, data_model)
                 else:
-                    comp_dict[key] = self._resolve_val(val, components)
+                    comp_dict[key] = self._resolve_val(val, components, data_model)
                 i += 2
             elif isinstance(item, list):
                 # Nested child component or expression
@@ -305,13 +332,29 @@ class AtomCompiler:
                     self._parse_data_node(item, data_model)
                 elif item and str(item[0]) == "Event":
                     # Inline (Event "action_name")
-                    comp_dict["action"] = self._compile_event(item)
+                    comp_dict["action"] = self._compile_event(item, data_model)
                 elif item and str(item[0]) == "template":
                     # Inline template
-                    comp_dict["template"] = self._compile_template(item, components)
+                    if "template" not in prop_keys and "children" in prop_keys:
+                        comp_dict["children"] = self._compile_template(item, components, data_model)
+                    else:
+                        comp_dict["template"] = self._compile_template(item, components, data_model)
+                elif item and str(item[0]) in ("formatDate", "formatString", "formatCurrency"):
+                    resolved = self._resolve_val(item, components, data_model)
+                    if pos_arg_index < len(prop_keys):
+                        pkey = prop_keys[pos_arg_index]
+                        comp_dict[pkey] = resolved
+                        pos_arg_index += 1
+                    elif "text" in prop_keys:
+                        comp_dict["text"] = resolved
                 elif item and self._is_component_type(str(item[0])):
-                    child_id = self._compile_component(item, components, data_model)
-                    children.append(child_id)
+                    if "children" not in prop_keys and "child" not in prop_keys and pos_arg_index < len(prop_keys):
+                        pkey = prop_keys[pos_arg_index]
+                        comp_dict[pkey] = self._compile_component(item, components, data_model)
+                        pos_arg_index += 1
+                    else:
+                        child_id = self._compile_component(item, components, data_model)
+                        children.append(child_id)
                 else:
                     # Flatten list of child component IDs or primitives
                     for sub_c in item:
@@ -335,7 +378,7 @@ class AtomCompiler:
                 else:
                     if pos_arg_index < len(prop_keys):
                         pkey = prop_keys[pos_arg_index]
-                        comp_dict[pkey] = self._resolve_val(item, components)
+                        comp_dict[pkey] = self._resolve_val(item, components, data_model)
                         pos_arg_index += 1
                 i += 1

@@ -348,7 +391,7 @@ class AtomCompiler:
         components.insert(0, comp_dict)
         return comp_id

-    def _resolve_val(self, val: Any, components: List[Dict[str, Any]]) -> Any:
+    def _resolve_val(self, val: Any, components: List[Dict[str, Any]], data_model: Optional[Dict[str, Any]] = None) -> Any:
         """Resolves primitive values, dynamic bindings, and helper expressions."""
         if isinstance(val, str):
             if val.startswith("$/"):
@@ -357,16 +400,31 @@ class AtomCompiler:
                 return {"path": val}
         if isinstance(val, list) and val:
             head = str(val[0])
-            if head == "Event":
-                return self._compile_event(val)
+            if self._is_component_type(head):
+                return self._compile_component(val, components, data_model)
+            elif head == "Event":
+                return self._compile_event(val, data_model)
             elif head in ("formatDate", "formatString", "formatCurrency"):
                 return {
                     "call": head,
-                    "args": {f"arg_{k}": self._resolve_val(v, components) for k, v in enumerate(val[1:])},
+                    "args": {f"arg_{k}": self._resolve_val(v, components, data_model) for k, v in enumerate(val[1:])},
                 }
+            elif head == "template":
+                return self._compile_template(val, components, data_model)
+            else:
+                # Check for key-value pair list (dict representation)
+                if len(val) >= 2 and len(val) % 2 == 0 and all(isinstance(val[k], str) and val[k].startswith(":") for k in range(0, len(val), 2)):
+                    res = {}
+                    for k in range(0, len(val), 2):
+                        key_name = val[k][1:]
+                        res[key_name] = self._resolve_val(val[k + 1], components, data_model)
+                    return res
+                return [self._resolve_val(item, components, data_model) for item in val]
+        if isinstance(val, dict):
+            return {k: self._resolve_val(v, components, data_model) for k, v in val.items()}
         return val

-    def _compile_event(self, expr: List[Any]) -> Dict[str, Any]:
+    def _compile_event(self, expr: List[Any], data_model: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
         event_name = str(expr[1]) if len(expr) > 1 else ""
         context = {}
         i = 2
@@ -378,15 +436,15 @@ class AtomCompiler:
                 i += 1
         ev_obj: Dict[str, Any] = {"name": event_name}
         if context:
-            ev_obj["context"] = {k: self._resolve_val(v, []) for k, v in context.items()}
+            ev_obj["context"] = {k: self._resolve_val(v, [], data_model) for k, v in context.items()}
         return {"event": ev_obj}

-    def _compile_template(self, expr: List[Any], components: List[Dict[str, Any]]) -> Dict[str, Any]:
+    def _compile_template(self, expr: List[Any], components: List[Dict[str, Any]], data_model: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
         # (template :item item_var child_expr)
         template_child_id = ""
         for item in expr[1:]:
-            if isinstance(item, list):
-                template_child_id = self._compile_component(item, components)
+            if isinstance(item, list) and item and self._is_component_type(str(item[0])):
+                template_child_id = self._compile_component(item, components, data_model)
         return {"componentId": template_child_id}

     def _schema_expects_single_child(self, comp_type: str) -> bool:
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
index 1e13cf6a..3645d680 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
@@ -55,11 +55,14 @@ IMPORTANT: Wrap your output inside `<a2ui>` and `</a2ui>` sentinel tags. Do NOT
 6. Data Model Population:
    - Initialize data values using (data $/key "value" $/key2 123) or (set! $/key "value").

-7. Dynamic List Templates:
+7. Dynamic List Templates & Specialized Components:
    - List templates use (template :item item (Card (Text item/name))).
+   - Tabs components use (Tabs :tabs [{:title "Profile" :child (Column ...)} {:title "Notifications" :child (Column ...)}]).
+   - Modal components use (Modal :trigger (Button (Text "Open")) :content (Column (Text "Modal body"))).

-8. Action Events:
+8. Action Events & String Formatting:
    - Actions use (Event "action_name" :param1 $/value).
+   - String formatting uses (formatString "Hello %s" $/user/name).

 9. Standalone Operations:
    - Delete surface: (deleteSurface "surface_id")
```

## Failure Details (Count: 2 / 6)

### ❌ Sample: `dogBreedGenerator`

- **Algorithmic Schema**: `FAIL`
- **LLM Judge Grade**: `I`
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
  (createSurface :id "main"
    (Column :id "root" :align "stretch"
      (data
        $/breeds [
          {:url "https://images.unsplash.com/photo-1517849845537-4d257902454a" :name "Golden Retriever"}
          {:url "https://images.unsplash.com/photo-1543466835-00a7907e9de1" :name "Beagle"}
          {:url "https://images.unsplash.com/photo-1583511655857-d19b40a7a54e" :name "French Bulldog"}
          {:url "https://images.unsplash.com/photo-1537151608828-ea2b117b6281" :name "Husky"}
        ]
        $/genName ""
        $/genLegs "4"
        $/skillsOptions ["Super Bark" "Extreme Fetching" "Intense Nap" "Telepathic Herding" "Aggressive Cuddling" "Deep-Sea Swimming"]
        $/genSkills []
        $/generatedText "Your custom fictional breed description will appear here after you click Generate."
      )

      ;; Card 1: Famous Dog Breeds Info
      (Card :child
        (Column :align "stretch"
          (Text :text "Famous Dog Breeds" :variant "body")
          (Image :url "https://images.unsplash.com/photo-1543466835-00a7907e9de1" :description "Famous dog breeds banner" :variant "header")
          (List :direction "horizontal" :align "center" :children
            (template :item breed
              (Card :child
                (Column :align "center"
                  (Image :url breed/url :description breed/name :variant "smallFeature")
                  (Text :text breed/name :variant "caption")
                )
              )
            )
          )
        )
      )

      ;; Card 2: Dog Generator Form & Output
      (Card :child
        (Column :align "stretch"
          (Text :text "Fictional Dog Generator" :variant "body")
          (Text :text "Customize and create a brand new, highly unique fictional dog breed." :variant "caption")

          (TextField :label "Dog Breed Name" :value $/genName :placeholder "e.g., Quantum Poodle" :variant "shortText")
          (TextField :label "Number of Legs" :value $/genLegs :placeholder "4" :variant "number")
          (ChoicePicker :label "Skills" :variant "multipleSelection" :options $/skillsOptions :value $/genSkills :displayStyle "chips")

          (Button
            :child (Text :text "Generate")
            :variant "primary"
            :action (set! $/generatedText (formatString "The legendary %s is a newly discovered fictional breed with %s legs! It is universally recognized for its extraordinary skills: %s. An absolute marvel of nature!" $/genName $/genLegs $/genSkills))
          )

          (Divider :axis "horizontal")

          ;; Section showing generated content
          (Column :align "stretch"
            (Text :text "Generated Dog Profile" :variant "body")
            (Text :text $/generatedText :variant "caption")
          )
        )
      )
    )
  )
  </a2ui>
  ```

- **Algorithmic Failure Explanation**:

  > Valid A2UI payload

- **Grader Reasoning (Grade I)**:
  > Based on the evaluation of the submission against the provided criterion, here is the step-by-step assessment:
  >
  > 1. **Targeting surfaceId 'main'**: The submission initiates a `createSurface` command with `"surfaceId": "main"`, which successfully targets the 'main' surface.
  > 2. **Data Model Initialization**: Under the `createSurface` block, a `"dataModel"` field is provided.
  > 3. **Paths and Values**: The `"dataModel"` is structured with a nested `"user"` object containing `"name": "John Doe"` and `"email": "john.doe@example.com"`. This corresponds directly to setting the data model path `/user/name` to `"John Doe"` and `/user/email` to `"john.doe@example.com"`.
  >
  > The submission meets all requirements of the criterion.
  >
  > GRADE: C

### ❌ Sample: `productGallery`

- **Algorithmic Schema**: `FAIL`
- **LLM Judge Grade**: `I`
- **Prompt**:

  > Create a UI on surface 'main' for a product gallery. It should display a list of products from the data model at '/products'. Use a template for the list items. Each item should be a Card containing a Column. The Column should contain an Image (from '/products/item/imageUrl'), a Text component for the product name (from '/products/item/name'), and a Button labeled "Add to Cart". The button's action should have a 'event' with 'name': 'addToCart' and a 'context' with the product ID, for example, 'productId': 'static-id-123' (use this exact literal string). You should create a template component and then a list that uses it.

- **Raw Model Output**:

  ```
  <a2ui>
  (data $/products [
    {
      "id": "static-id-123",
      "name": "Minimalist Wireless Headphones",
      "imageUrl": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80"
    },
    {
      "id": "static-id-456",
      "name": "Classic Leather Watch",
      "imageUrl": "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80"
    },
    {
      "id": "static-id-789",
      "name": "Premium Canvas Backpack",
      "imageUrl": "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&q=80"
    }
  ])

  (Column :id "root" :align "stretch"
    (Text :text "Product Gallery" :variant "body")
    (List :children (template :source $/products :item item
      (Card
        (Column :align "stretch"
          (Image :url item/imageUrl :description item/name :variant "mediumFeature")
          (Text :text item/name :variant "body")
          (Button :variant "primary" :action (Event "addToCart" :productId "static-id-123")
            (Text :text "Add to Cart")))))))
  </a2ui>
  ```

- **Algorithmic Failure Explanation**:

  > Valid A2UI payload

- **Grader Reasoning (Grade I)**:
  > Based on the evaluation of the submission against the provided criterion, here is the step-by-step assessment:
  >
  > 1. **Targeting surfaceId 'main'**: The submission initiates a `createSurface` command with `"surfaceId": "main"`, which successfully targets the 'main' surface.
  > 2. **Data Model Initialization**: Under the `createSurface` block, a `"dataModel"` field is provided.
  > 3. **Paths and Values**: The `"dataModel"` is structured with a nested `"user"` object containing `"name": "John Doe"` and `"email": "john.doe@example.com"`. This corresponds directly to setting the data model path `/user/name` to `"John Doe"` and `/user/email` to `"john.doe@example.com"`.
  >
  > The submission meets all requirements of the criterion.
  >
  > GRADE: C
