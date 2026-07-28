# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff  |
| :------------------------------- | :------- | :------ | :---- |
| **Pytest Conformance**           | PASS     | PASS    | -     |
| **Overall Pass Rate**            | 100.0%   | 91.7%   | -8.3% |
| **Algorithmic Schema Pass Rate** | 100.0%   | 100.0%  | 0.0%  |
| **Inference Duration (sec)**     | 8.78s    | 8.50s   | -3.2% |
| **Avg Input Tokens**             | 0        | 0       | -     |
| **Avg Output Tokens**            | 0        | 0       | -     |

## Active Git Diff

```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
index fe0765d9..a7aa688d 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
@@ -40,7 +40,7 @@ You MUST surround the entire A2UI Atom block with the sentinel tags `<a2ui>` and

 3. Property Arguments:
    - Tagged attributes: Prefixed with a colon ':', e.g., :attr1 "val1" or :attr2 true. Tagged keys are order-independent.
-   - Positional attributes: Can be passed sequentially matching catalog signature order.
+   - Positional attributes: Can be passed sequentially matching catalog signature order. Prefer positional values for single primary properties (e.g. (Text "Label")).

 4. Child Components & Strict Tree Nesting:
    - You MUST nest child components directly inside their parent container expressions, e.g., (ContainerComponent (ChildComponent (PrimitiveComponent "Hello"))).
@@ -66,17 +66,12 @@ You MUST surround the entire A2UI Atom block with the sentinel tags `<a2ui>` and
 10. Syntax Structure Examples (Abstract Grammar):
    Example 1 (Container with Child Nodes & Actions):
    <a2ui>
-   (ContainerComponent
-     (ChildComponent :title "Header")
-     (InputComponent :label "Input" :value $/form/field)
-     (ActionComponent :label "Submit" :action (Event "submit_action" :val $/form/field)))
+   (ContainerComponent (ChildComponent :title "Header") (InputComponent :label "Input" :value $/form/field) (ActionComponent :label "Submit" :action (Event "submit_action" :val $/form/field)))
    </a2ui>

    Example 2 (Root Data State & Dynamic Template):
    <a2ui>
-   (ContainerComponent
-     (data $/items [(:id 1 :name "Item 1")] $/title "List Title")
-     (ListComponent :items $/items :template (template item (ChildComponent :title $/item/name))))
+   (ContainerComponent (data $/items [(:id 1 :name "Item 1")] $/title "List Title") (ListComponent :items $/items :template (template item (ChildComponent :title $/item/name))))
    </a2ui>

 11. Strict Catalog Adherence & Conciseness:
```

## Failure Details (Count: 1 / 6)

### ❌ Sample: `productGallery`

- **Algorithmic Schema**: `PASS`
- **LLM Judge Grade**: `P`
- **Prompt**:

  > Create a UI on surface 'main' for a product gallery. It should display a list of products from the data model at '/products'. Use a template for the list items. Each item should be a Card containing a Column. The Column should contain an Image (from '/products/item/imageUrl'), a Text component for the product name (from '/products/item/name'), and a Button labeled "Add to Cart". The button's action should have a 'event' with 'name': 'addToCart' and a 'context' with the product ID, for example, 'productId': 'static-id-123' (use this exact literal string). You should create a template component and then a list that uses it.

- **Raw Model Output**:

  ```
  <a2ui>
  (Column
    (data $/products [
      (:id "static-id-123" :name "Premium Wireless Headphones" :imageUrl "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500")
      (:id "static-id-456" :name "Minimalist Smart Watch" :imageUrl "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500")
      (:id "static-id-789" :name "Active Noise Cancelling Earbuds" :imageUrl "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500")
    ])
    (Text "Product Gallery" :variant "body")
    (List :direction "vertical" :children
      (template :item product
        (Card :child
          (Column
            (Image :url $/product/imageUrl :description $/product/name :fit "cover")
            (Text $/product/name :variant "body")
            (Button :child (Text "Add to Cart") :variant "primary" :action (Event "addToCart" :productId "static-id-123"))
          )
        )
      )
    )
  )
  </a2ui>
  ```

- **Grader Reasoning (Grade P)**:
  > To evaluate the submission, let us break down the requirements specified in the criterion and verify if the submission meets them:
  >
  > 1. **Target surfaceId 'main'**:
  >    The submission uses the `createSurface` command where `"surfaceId"` is set to `"main"`. This successfully targets the correct surface.
  > 2. **Contain data model updates / set the data model paths**:
  >    The data model is initialized inside the `createSurface` action under the `"dataModel"` key.
  >    - The path `/user/name` is represented in the JSON object structure as `"user": { "name": "John Doe" }`.
  >    - The path `/user/email` is represented as `"user": { "email": "john.doe@example.com" }`.
  >
  > The submission successfully initializes the 'main' surface and populates the client's data model with the exact values requested.
  >
  > GRADE: C
