# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff |
| :------------------------------- | :------- | :------ | :--- |
| **Pytest Conformance**           | -        | PASS    | -    |
| **Overall Pass Rate**            | -        | 83.3%   |      |
| **Algorithmic Schema Pass Rate** | -        | 100.0%  |      |
| **Inference Duration (sec)**     | -        | 8.56s   |      |
| **Avg Input Tokens**             | -        | 0       |      |
| **Avg Output Tokens**            | -        | 0       |      |

## Active Git Diff

```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
index 6ad0dac9..a63c2550 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
@@ -25,9 +25,7 @@ if TYPE_CHECKING:
 ATOM_RULES = r'''# A2UI Atom Output Contract

 You must output the user interface using the compact A2UI Atom S-Expression notation.
-You MUST surround the entire A2UI Atom block with the sentinel tags `<a2ui>` and `</a2ui>`.
-
-IMPORTANT: Wrap your output inside `<a2ui>` and `</a2ui>` sentinel tags. Do NOT output raw JSON messages.
+You MUST surround the entire A2UI Atom block with the sentinel tags `<a2ui>` and `</a2ui>`. Do NOT output raw JSON messages.

 ## Grammar Rules

@@ -78,13 +76,12 @@ IMPORTANT: Wrap your output inside `<a2ui>` and `</a2ui>` sentinel tags. Do NOT
    <a2ui>
    (ContainerComponent
      (data $/items [{"id": 1, "name": "Item 1"}] $/title "List Title")
-     (ListComponent :items $/items :template (template item (ChildComponent :title $/item/name))))
+     (ListComponent :items $/items :template (template :item item (ChildComponent :title $/item/name))))
    </a2ui>

 11. Strict Catalog Adherence:
-   - You MUST ONLY use property names listed in the Component Catalog Signatures below.
-   - Do NOT invent CSS or style attributes (e.g. style, padding, margin, backgroundColor, color, fontSize, size, minHeight, borderRadius, spacing, align, justify).
-   - Strictly adhere to the exact property names and allowed enum values listed in the Component Catalog Signatures.
+   - Use ONLY exact property names and allowed enum values listed in Component Catalog Signatures.
+   - Do NOT invent CSS or style attributes (e.g. style, padding, margin, backgroundColor, color, fontSize).
 '''
```

## Failure Details (Count: 1 / 6)

### ❌ Sample: `productGalleryData`

- **Algorithmic Schema**: `PASS`
- **LLM Judge Grade**: `I`
- **Prompt**:

  > Initialize surface 'main' and populate the data model for the product gallery. The update should target the path '/products' and include at least two products. Each product in the map should have keys 'id', 'name', and 'imageUrl'. For example:
  > {
  > "product1": {
  > "id": "product1",
  > "name": "Awesome Gadget",
  > "imageUrl": "https://example.com/gadget.jpg"
  > }
  > }

- **Raw Model Output**:

  ```
  <a2ui>
  (Column :id "root" :justify "start" :align "stretch"
    (data $/products {
      "product1": {
        "id": "product1",
        "name": "Awesome Gadget",
        "imageUrl": "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500"
      },
      "product2": {
        "id": "product2",
        "name": "Premium Headphones",
        "imageUrl": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500"
      }
    })
    (Text :text "# Product Gallery" :variant "body")
    (Divider :axis "horizontal")
    (Row :justify "spaceAround" :align "center"
      (Card :child (Column :justify "start" :align "center"
        (Image :url $/products/product1/imageUrl :description "Awesome Gadget" :variant "mediumFeature")
        (Text :text $/products/product1/name :variant "body")
        (Button :child (Text :text "View Details") :variant "primary" :action (Event "view_product" :id "product1"))))
      (Card :child (Column :justify "start" :align "center"
        (Image :url $/products/product2/imageUrl :description "Premium Headphones" :variant "mediumFeature")
        (Text :text $/products/product2/name :variant "body")
        (Button :child (Text :text "View Details") :variant "primary" :action (Event "view_product" :id "product2"))))))
  </a2ui>
  ```

- **Grader Reasoning (Grade I)**:
  > To assess the submission, we will evaluate it against the given criterion step-by-step:
  >
  > 1. **Target Surface ID**: The criterion requires the payload to target `surfaceId` 'main'. In the submission, inside the `createSurface` object, the `"surfaceId"` is explicitly set to `"main"`. This requirement is successfully met.
  > 2. **Data Model Updates/Population**: The criterion requires the payload to contain data model updates, specifically setting `/user/name` to `"John Doe"` and `/user/email` to `"john.doe@example.com"`.
  >    In the submission, within the `createSurface` action, the `"dataModel"` block is populated as follows:
  >    ```json
  >    "dataModel": {
  >      "user": {
  >        "name": "John Doe",
  >        "email": "john.doe@example.com"
  >      }
  >    }
  >    ```
  >    This structure successfully initializes and sets the data model paths `/user/name` to `"John Doe"` and `/user/email` to `"john.doe@example.com"`.
  >
  > Since the submission perfectly fulfills all specified criteria, it is considered correct.
  >
  > GRADE: C
