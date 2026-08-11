# Inference Format Optimization Report
- **Strategy (Format)**: `express`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table
| Metric | Baseline | Current | Diff |
| :--- | :--- | :--- | :--- |
| **Pytest Conformance** | PASS | PASS | - |
| **Overall Pass Rate** | 95.1% | 83.3% | -11.8% |
| **Algorithmic Schema Pass Rate** | 98.0% | 100.0% | +2.0% |
| **Inference Duration (sec)** | 12.79s | 31.56s | +146.7% |
| **Avg Input Tokens** | 5940 | 5951 | +0.2% |
| **Avg Output Tokens** | 276 | 302 | +9.4% |
| **Avg Reasoning Tokens** | 1795 | 2421 | +34.9% |

## Active Git Diff
```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/compiler.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/compiler.py
index 2d059769..50d58567 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/compiler.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/express/compiler.py
@@ -114,6 +114,28 @@ def _is_check_expression(val: Any) -> bool:
     return False
 
 
+def _is_child_list_property(schema: Any) -> bool:
+    """Checks if a property's schema expects a list of component IDs (ChildList)."""
+    if not isinstance(schema, dict):
+        return False
+    if "$ref" in schema:
+        ref = schema["$ref"]
+        if isinstance(ref, str) and "ChildList" in ref:
+            return True
+    if schema.get("type") == "array" and "items" in schema:
+        items = schema["items"]
+        if isinstance(items, dict):
+            if "$ref" in items and isinstance(items["$ref"], str):
+                ref = items["$ref"]
+                if "ComponentId" in ref or "Child" in ref or "ChildList" in ref:
+                    return True
+    for key in ["allOf", "oneOf", "anyOf"]:
+        if key in schema and isinstance(schema[key], list):
+            if any(_is_child_list_property(sub) for sub in schema[key]):
+                return True
+    return False
+
+
 # ANTLR-generated lexer, parser, and custom visitor are used for compilation.
 
 
@@ -430,6 +452,13 @@ class ExpressCompiler:
                             f" property '{prop_name}' of component '{comp_name}'."
                             f" Allowed values are: {enum_vals}"
                         )
+                prop_type = self.helper.get_property_type(comp_name, prop_name)
+                if (
+                    prop_type == "ChildList"
+                    or (prop_schema and _is_child_list_property(prop_schema))
+                ) and isinstance(mapped_val, str):
+                    mapped_val = [mapped_val]
+
                 comp_dict[prop_name] = mapped_val
 
                 if (
diff --git a/agent_sdks/python/a2ui_agent/tests/express/test_compiler.py b/agent_sdks/python/a2ui_agent/tests/express/test_compiler.py
index 5de08b86..46389055 100644
--- a/agent_sdks/python/a2ui_agent/tests/express/test_compiler.py
+++ b/agent_sdks/python/a2ui_agent/tests/express/test_compiler.py
@@ -732,6 +732,16 @@ valueField = TEXTFIELD("Deal Value", $/form/value)"""
         ctx_lower = compiler._compile_value("False", {}, None)
         self.assertIs(ctx_lower, False)
 
+    def test_single_component_id_string_auto_wrapping(self):
+        """Verifies auto-wrapping single component ID strings into list containers when property expects list of component IDs."""
+        compiler = ExpressCompiler(self.catalog)
+        dsl = """root = Column(singleChild)
+singleChild = Text("Hello World")"""
+        envelope = compiler.compile(dsl)
+        components = envelope["createSurface"]["components"]
+        root_comp = next(c for c in components if c["id"] == "root")
+        self.assertEqual(root_comp["children"], ["singleChild"])
+
 
 if __name__ == "__main__":
     unittest.main()
```

## Failure Details (Count: 1 / 6)
### ❌ Sample: `productGalleryData`
- **Algorithmic Schema**: `PASS`
- **LLM Judge Grade**: `I`
- **Prompt**:
  > Initialize surface 'main' and populate the data model for the product gallery. The update should target the path '/products' and include at least two products. Each product in the map should have keys 'id', 'name', and 'imageUrl'. For example:
  > {
  >   "product1": {
  >     "id": "product1",
  >     "name": "Awesome Gadget",
  >     "imageUrl": "https://example.com/gadget.jpg"
  >   }
  > }
  > 

- **Raw Model Output**:
  ```
  <a2ui>
  $/products = [
    {id: "product1", name: "Awesome Gadget", imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500"},
    {id: "product2", name: "Premium Headphones", imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500"}
  ]
  root = Column([headerText, divider, productList])
  headerText = Text("# Product Gallery", "body")
  divider = Divider("horizontal")
  productList = List(_template($/products, productTemplate), "horizontal")
  productTemplate = Card(productCardCol)
  productCardCol = Column([productImg, productNameTxt, viewBtn])
  productImg = Image($imageUrl, $name, "cover", "mediumFeature")
  productNameTxt = Text($name, "body")
  viewBtn = Button(btnText, "primary", Event("view_product", {id: $id}))
  btnText = Text("View Details")
  </a2ui>
  ```

- **LLM Judge Explanation**:
  > Based on the provided criterion and task description, let's evaluate the submission step by step:
  > 
  > 1. **Targeting `surfaceId` 'main'**: 
  >    The submitted payload initializes a surface using the `createSurface` action, and the `surfaceId` is explicitly set to `"main"`. This successfully targets the required surface.
  > 
  > 2. **Setting the Data Model Paths**:
  >    The task requires setting the data model path `/user/name` to `"John Doe"` and `/user/email` to `"john.doe@example.com"`.
  >    In the submission, under `dataModel`, we see:
  >    ```json
  >    "dataModel": {
  >      "user": {
  >        "name": "John Doe",
  >        "email": "john.doe@example.com"
  >      }
  >    }
  >    ```
  >    This correctly maps to the JSON paths `/user/name` and `/user/email` with the specified string values.
  > 
  > 3. **Overall compliance**: 
  >    The submission successfully initializes the surface 'main' and populates the data model as requested in a single payload.
  > 
  > GRADE: C
