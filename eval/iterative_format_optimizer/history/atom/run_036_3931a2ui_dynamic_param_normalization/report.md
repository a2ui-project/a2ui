# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff   |
| :------------------------------- | :------- | :------ | :----- |
| **Pytest Conformance**           | PASS     | PASS    | -      |
| **Overall Pass Rate**            | 100.0%   | 83.3%   | -16.7% |
| **Algorithmic Schema Pass Rate** | 100.0%   | 100.0%  | 0.0%   |
| **Inference Duration (sec)**     | 7.29s    | 8.39s   | +15.1% |
| **Avg Input Tokens**             | 0        | 0       | -      |
| **Avg Output Tokens**            | 0        | 0       | -      |

## Active Git Diff

_No files modified under `agent_sdks`._

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
  (Column :id "root"
    (data $/products [
      (:id "product1" :name "Awesome Gadget" :imageUrl "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500")
      (:id "product2" :name "Super Widget" :imageUrl "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500")
    ])
    (Text :text "Product Gallery" :variant "body")
    (List :direction "horizontal"
      (Card :child (Column
        (Image :url $/products/0/imageUrl :description $/products/0/name :variant "mediumFeature")
        (Text :text $/products/0/name :variant "body")
        (Button :child (Text :text "View Details") :variant "primary" :action (Event "view_product" :productId "product1"))))
      (Card :child (Column
        (Image :url $/products/1/imageUrl :description $/products/1/name :variant "mediumFeature")
        (Text :text $/products/1/name :variant "body")
        (Button :child (Text :text "View Details") :variant "primary" :action (Event "view_product" :productId "product2"))))))
  </a2ui>
  ```

- **Grader Reasoning (Grade I)**:
  > To determine if the submission meets the criterion, let's analyze the submitted JSON code step-by-step:
  >
  > 1. **Target Surface ID**: The criterion states that the payload must target the `surfaceId` 'main'. In the submission, the `"createSurface"` action explicitly specifies `"surfaceId": "main"`. This requirement is met.
  > 2. **Data Model Updates**: The task asks to initialize the surface 'main' and populate its data model. Under the `"createSurface"` command, there is a `"dataModel"` field populated as follows:
  >    ```json
  >    "dataModel": {
  >      "user": {
  >        "name": "John Doe",
  >        "email": "john.doe@example.com"
  >      }
  >    }
  >    ```
  >    This successfully sets the data model paths `/user/name` to `"John Doe"` and `/user/email` to `"john.doe@example.com"`.
  > 3. **Data Bindings**: Additionally, the components inside the surface (e.g., `"node_7"` and `"node_8"`) use these exact paths (`/user/name` and `/user/email`) for their values, showing consistency with the specified data model.
  >
  > The submission successfully satisfies all aspects of the criterion.
  >
  > GRADE: C
