# Inference Format Optimization Report
- **Strategy (Format)**: `express`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table
| Metric | Baseline | Current | Diff |
| :--- | :--- | :--- | :--- |
| **Pytest Conformance** | PASS | PASS | - |
| **Overall Pass Rate** | 95.1% | 83.3% | -11.8% |
| **Algorithmic Schema Pass Rate** | 98.0% | 83.3% | -14.7% |
| **Inference Duration (sec)** | 12.79s | 31.62s | +147.1% |
| **Avg Input Tokens** | 5940 | 5951 | +0.2% |
| **Avg Output Tokens** | 276 | 354 | +28.1% |
| **Avg Reasoning Tokens** | 1795 | 2242 | +24.9% |

## Active Git Diff
```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/compiler.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/compiler.py
index 2d059769..7be0cd46 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/compiler.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/compiler.py
@@ -114,6 +114,67 @@ def _is_check_expression(val: Any) -> bool:
     return False
 
 
+def _schema_expects_number_or_integer(schema: Any) -> Optional[str]:
+    """Checks if a schema expects an integer or number type.
+
+    Returns 'integer', 'number', or None.
+    """
+    if not isinstance(schema, dict):
+        return None
+
+    if "type" in schema:
+        t = schema["type"]
+        if t == "integer":
+            return "integer"
+        if t == "number":
+            return "number"
+        if isinstance(t, list):
+            if "integer" in t:
+                return "integer"
+            if "number" in t:
+                return "number"
+
+    if "$ref" in schema and isinstance(schema["$ref"], str):
+        ref_lower = schema["$ref"].lower()
+        if "integer" in ref_lower or "int" in ref_lower:
+            return "integer"
+        if "number" in ref_lower or "float" in ref_lower:
+            return "number"
+
+    for key in ["allOf", "oneOf", "anyOf"]:
+        if key in schema and isinstance(schema[key], list):
+            for sub in schema[key]:
+                res = _schema_expects_number_or_integer(sub)
+                if res:
+                    return res
+
+    return None
+
+
+def _coerce_numeric_string(val: str, expected_type: str) -> Union[int, float, str]:
+    """Coerces a numeric string to int or float based on expected schema type."""
+    if expected_type == "integer":
+        try:
+            return int(val)
+        except ValueError:
+            try:
+                f_val = float(val)
+                if f_val.is_integer():
+                    return int(f_val)
+                return f_val
+            except ValueError:
+                return val
+    else:  # "number"
+        try:
+            return int(val) if ("." not in val and "e" not in val.lower()) else float(val)
+        except ValueError:
+            try:
+                return float(val)
+            except ValueError:
+                return val
+
+
+
 # ANTLR-generated lexer, parser, and custom visitor are used for compilation.
 
 
@@ -383,14 +444,15 @@ class ExpressCompiler:
                     continue
 
                 enum_vals = self.helper.get_property_enum(comp_name, prop_name)
+                prop_schema = self.helper.get_property_schema(comp_name, prop_name)
                 mapped_val = self._compile_value(
                     arg,
                     raw_symbols,
                     ctx,
                     is_action=(prop_name in ["action", "submitAction"]),
                     enum_vals=enum_vals,
+                    prop_schema=prop_schema,
                 )
-                prop_schema = self.helper.get_property_schema(comp_name, prop_name)
                 if prop_schema and not _schema_allows_databinding(prop_schema):
 
                     def has_databinding(v: Any) -> bool:
@@ -493,7 +555,7 @@ class ExpressCompiler:
                                 compiled_args[prop_name] = None
                                 continue
                             compiled_args[prop_name] = self._compile_value(
-                                c_arg, raw_symbols, ctx
+                                c_arg, raw_symbols, ctx, prop_schema=prop_schema
                             )
                         else:
                             if isinstance(c_arg, str):
@@ -516,6 +578,7 @@ class ExpressCompiler:
         ctx: _CompileContext,
         is_action: bool = False,
         enum_vals: Optional[list[str]] = None,
+        prop_schema: Optional[dict] = None,
     ) -> Any:
         """Compiles an individual AST node value into valid A2UI equivalents.
 
@@ -551,7 +614,14 @@ class ExpressCompiler:
                         )
                     ):
                         return ref_name
-                    return self._compile_value(symbol_val, raw_symbols, ctx, is_action)
+                    return self._compile_value(
+                        symbol_val,
+                        raw_symbols,
+                        ctx,
+                        is_action,
+                        enum_vals=enum_vals,
+                        prop_schema=prop_schema,
+                    )
                 return ref_name
             if "check" in val:
                 check_name = val["check"]
@@ -594,7 +664,7 @@ class ExpressCompiler:
                             if isinstance(c_arg, dict) and c_arg.get("skipped"):
                                 continue
                             compiled_args[prop_name] = self._compile_value(
-                                c_arg, raw_symbols, ctx, is_action
+                                c_arg, raw_symbols, ctx, is_action, prop_schema=prop_schema
                             )
 
                 return {"call": check_name, "args": compiled_args}
@@ -673,11 +743,19 @@ class ExpressCompiler:
                         if idx < len(fn_props):
                             if isinstance(arg, dict) and arg.get("skipped"):
                                 continue
+                            arg_prop_name = fn_props[idx]
+                            fn_prop_schema = self.helper.get_function_property_schema(
+                                fn_name, arg_prop_name
+                            )
                             val_item = self._compile_value(
-                                arg, raw_symbols, ctx, is_action=False
+                                arg,
+                                raw_symbols,
+                                ctx,
+                                is_action=False,
+                                prop_schema=fn_prop_schema,
                             )
                             if val_item is not None:
-                                compiled_args[fn_props[idx]] = val_item
+                                compiled_args[arg_prop_name] = val_item
 
                     # Wrap in functionCall only if inside an action field
                     if is_action:
@@ -705,10 +783,18 @@ class ExpressCompiler:
 
         if isinstance(val, list):
             # If this is a list of elements, compile each element
+            item_schema = (
+                prop_schema.get("items") if isinstance(prop_schema, dict) else None
+            )
             compiled_list = []
             for item in val:
                 comp_item = self._compile_value(
-                    item, raw_symbols, ctx, is_action=False, enum_vals=enum_vals
+                    item,
+                    raw_symbols,
+                    ctx,
+                    is_action=False,
+                    enum_vals=enum_vals,
+                    prop_schema=item_schema,
                 )
                 compiled_list.append(comp_item)
             return compiled_list
@@ -733,6 +819,10 @@ class ExpressCompiler:
                     return enum_map[val.lower()]
             if is_action:
                 return {"call": val, "args": {}}
+            if prop_schema:
+                expected_num_type = _schema_expects_number_or_integer(prop_schema)
+                if expected_num_type:
+                    return _coerce_numeric_string(val, expected_num_type)
             return val
 
         return val
diff --git a/agent_sdks/python/a2ui_agent/tests/express/test_compiler.py b/agent_sdks/python/a2ui_agent/tests/express/test_compiler.py
index 5de08b86..6a960eee 100644
--- a/agent_sdks/python/a2ui_agent/tests/express/test_compiler.py
+++ b/agent_sdks/python/a2ui_agent/tests/express/test_compiler.py
@@ -732,6 +732,27 @@ valueField = TEXTFIELD("Deal Value", $/form/value)"""
         ctx_lower = compiler._compile_value("False", {}, None)
         self.assertIs(ctx_lower, False)
 
+    def test_string_to_number_auto_coercion(self):
+        """Verifies string-to-number auto-coercion when property schema expects an integer or number."""
+        compiler = ExpressCompiler(self.catalog)
+        int_schema = {"type": "integer"}
+        num_schema = {"type": "number"}
+
+        # Integer schema
+        self.assertEqual(compiler._compile_value("42", {}, None, prop_schema=int_schema), 42)
+        self.assertIsInstance(compiler._compile_value("42", {}, None, prop_schema=int_schema), int)
+        self.assertEqual(compiler._compile_value("3.0", {}, None, prop_schema=int_schema), 3)
+        self.assertIsInstance(compiler._compile_value("3.0", {}, None, prop_schema=int_schema), int)
+
+        # Number schema
+        self.assertEqual(compiler._compile_value("3.14", {}, None, prop_schema=num_schema), 3.14)
+        self.assertIsInstance(compiler._compile_value("3.14", {}, None, prop_schema=num_schema), float)
+        self.assertEqual(compiler._compile_value("42", {}, None, prop_schema=num_schema), 42)
+
+        # Non-numeric strings remain strings
+        self.assertEqual(compiler._compile_value("hello", {}, None, prop_schema=int_schema), "hello")
+
 
 if __name__ == "__main__":
     unittest.main()
+
```

## Failure Details (Count: 1 / 6)
### ❌ Sample: `productGallery`
- **Algorithmic Schema**: `FAIL`
- **LLM Judge Grade**: `I`
- **Prompt**:
  > Create a UI on surface 'main' for a product gallery. It should display a list of products from the data model at '/products'. Use a template for the list items. Each item should be a Card containing a Column. The Column should contain an Image (from '/products/item/imageUrl'), a Text component for the product name (from '/products/item/name'), and a Button labeled "Add to Cart". The button's action should have a 'event' with 'name': 'addToCart' and a 'context' with the product ID, for example, 'productId': 'static-id-123' (use this exact literal string). You should create a template component and then a list that uses it.

- **Raw Model Output**:
  ```
  <a2ui>
  $/products = [
    {
      "id": "prod-1",
      "name": "Wireless Noise-Canceling Headphones",
      "imageUrl": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500"
    },
    {
      "id": "prod-2",
      "name": "Minimalist Leather Backpack",
      "imageUrl": "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500"
    },
    {
      "id": "prod-3",
      "name": "Mechanical Gaming Keyboard",
      "imageUrl": "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=500"
    }
  ]
  
  root = productList
  productList = List(_template($/products, productCard), "vertical")
  productCard = Card(productCol)
  productCol = Column([productImage, productName, addToCartBtn])
  productImage = Image($imageUrl, $name, "cover", "mediumFeature")
  productName = Text($name)
  btnText = Text("Add to Cart")
  addToCartBtn = Button(btnText, "primary", Event("addToCart", {productId: "static-id-123"}))
  </a2ui>
  ```

- **Algorithmic Failure Explanation**:
  > Valid A2UI payload

- **LLM Judge Explanation**:
  > To determine whether the submission meets the criterion, let's analyze it step-by-step:
  > 
  > 1. **Target surfaceId 'main'**: 
  >    The submission uses the `createSurface` action and correctly specifies the `"surfaceId"` as `"main"`. This successfully targets the correct surface.
  > 
  > 2. **Contain data model updates / set paths `/user/name` and `/user/email`**: 
  >    The submission includes a `"dataModel"` block inside the `"createSurface"` action:
  >    ```json
  >    "dataModel": {
  >      "user": {
  >        "name": "John Doe",
  >        "email": "john.doe@example.com"
  >      }
  >    }
  >    ```
  >    This structure maps to the hierarchical paths `/user/name` (with the value `"John Doe"`) and `/user/email` (with the value `"john.doe@example.com"`). 
  > 
  > All aspects of the criterion are successfully met.
  > 
  > GRADE: C
