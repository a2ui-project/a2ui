# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff  |
| :------------------------------- | :------- | :------ | :---- |
| **Pytest Conformance**           | PASS     | PASS    | -     |
| **Overall Pass Rate**            | 83.3%    | 83.3%   | 0.0%  |
| **Algorithmic Schema Pass Rate** | 100.0%   | 100.0%  | 0.0%  |
| **Inference Duration (sec)**     | 8.45s    | 8.28s   | -2.0% |
| **Avg Input Tokens**             | 0        | 0       | -     |
| **Avg Output Tokens**            | 0        | 0       | -     |

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
  (Column
    (data $/products [
      {
        "id": "product1",
        "name": "Awesome Gadget",
        "imageUrl": "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&q=80&w=400"
      },
      {
        "id": "product2",
        "name": "Super Widget",
        "imageUrl": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&q=80&w=400"
      },
      {
        "id": "product3",
        "name": "Elite Headphones",
        "imageUrl": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&q=80&w=400"
      }
    ])
    (Row
      (Text :text "**Product Gallery**" :variant "body")
    )
    (Divider :axis "horizontal")
    (List
      :direction "vertical"
      :children (template :item product
        (Card
          :child (Column
            (Image :url $/product/imageUrl :description $/product/name :variant "mediumFeature")
            (Text :text $/product/name :variant "body")
          )
        )
      )
    )
  )
  </a2ui>
  ```

- **Grader Reasoning (Grade I)**:
  > To assess whether the submission meets the criterion, let's break down the requirements and compare them to the submitted JSON:
  >
  > 1. **Target surfaceId 'main'**:
  >    The submission uses the `createSurface` action and specifies `"surfaceId": "main"`. This successfully targets the 'main' surface.
  > 2. **Contain data model updates**:
  >    The submission includes the `"dataModel"` property inside the `createSurface` action, which is used to initialize/populate the data model for the surface.
  > 3. **Set the data model paths `/user/name` to "John Doe" and `/user/email` to "john.doe@example.com"**:
  >    Inside the `"dataModel"` object, the submission specifies:
  >    ```json
  >    "user": {
  >      "name": "John Doe",
  >      "email": "john.doe@example.com"
  >    }
  >    ```
  >    This structure correctly resolves to the paths `/user/name` with the value `"John Doe"` and `/user/email` with the value `"john.doe@example.com"`.
  >
  > Since all conditions in the criterion are fully satisfied by the submission, it is correct.
  >
  > GRADE: C
