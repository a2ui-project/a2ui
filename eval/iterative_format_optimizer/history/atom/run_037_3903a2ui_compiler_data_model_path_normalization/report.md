# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff   |
| :------------------------------- | :------- | :------ | :----- |
| **Pytest Conformance**           | PASS     | PASS    | -      |
| **Overall Pass Rate**            | 100.0%   | 66.7%   | -33.3% |
| **Algorithmic Schema Pass Rate** | 100.0%   | 83.3%   | -16.7% |
| **Inference Duration (sec)**     | 7.29s    | 8.48s   | +16.4% |
| **Avg Input Tokens**             | 0        | 0       | -      |
| **Avg Output Tokens**            | 0        | 0       | -      |

## Active Git Diff

_No files modified under `agent_sdks`._

## Failure Details (Count: 2 / 6)

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
    :children [
      (data $/products [
        (:id "product1" :name "Awesome Gadget" :imageUrl "https://picsum.photos/id/26/300/300")
        (:id "product2" :name "Super Widget" :imageUrl "https://picsum.photos/id/48/300/300")
      ])
      (Text :text "Product Gallery" :variant "body")
      (Divider :axis "horizontal")
      (List
        :direction "horizontal"
        :children (template :item product
          (Card
            :child (Column
              :children [
                (Image :url $/product/imageUrl :description $/product/name :variant "mediumFeature")
                (Text :text $/product/name :variant "body")
              ]
            )
          )
        )
      )
    ]
  )
  </a2ui>
  ```

- **Grader Reasoning (Grade I)**:
  > To determine if the submission meets the criterion, let's analyze it step-by-step:
  >
  > 1. **Target Surface ID**: The criterion requires the payload to target the surfaceId `'main'`.
  >    - Looking at the submission, we see `"createSurface": { "surfaceId": "main", ... }`. This successfully targets the surface `'main'`.
  > 2. **Data Model Updates/Initialization**: The task asks to initialize the surface 'main' and populate its data model with specific paths.
  >    - The submission includes a `"dataModel"` block inside the `createSurface` action.
  >    - Within `"dataModel"`, there is a `"user"` object containing `"name": "John Doe"` and `"email": "john.doe@example.com"`.
  >    - This structure corresponds to setting the data model path `/user/name` to `"John Doe"` and `/user/email` to `"john.doe@example.com"`.
  >    - The UI components within the submission also correctly bind their text values to these paths (e.g., `{"path": "/user/name"}` and `{"path": "/user/email"}`).
  >
  > The submission fully satisfies all aspects of the criterion.
  >
  > GRADE: C

### ❌ Sample: `settingsPage`

- **Algorithmic Schema**: `FAIL`
- **LLM Judge Grade**: `I`
- **Prompt**:

  > Create a UI on surface 'main' for a user settings page. Use a Tabs component with two tabs: "Profile" and "# Notifications". The "Profile" tab should contain a simple column with a text field for the user's name. The "# Notifications" tab should contain a checkbox for "Enable email notifications". Also, include a Modal component. The modal's trigger should be a button labeled "Delete Account", and its content should be a column with a confirmation text and two buttons: "Confirm Deletion" and "Cancel".

- **Raw Model Output**:

  ```
  <a2ui>
  (Column
    :id "root"
    :children [
      (data $/profile/name "Jane Doe" $/notifications/email true)
      (Text :text "User Settings" :variant "body")
      (Tabs :tabs [
        (:title "Profile" :child (Column :children [
          (TextField :label "Name" :value $/profile/name :variant "shortText")
        ]))
        (:title "# Notifications" :child (Column :children [
          (CheckBox :label "Enable email notifications" :value $/notifications/email)
        ]))
      ])
      (Divider :axis "horizontal")
      (Modal
        :trigger (Button :child (Text :text "Delete Account") :variant "default")
        :content (Column :children [
          (Text :text "Are you sure you want to delete your account? This action cannot be undone." :variant "body")
          (Row :children [
            (Button :child (Text :text "Confirm Deletion") :variant "primary" :action (Event "confirm_delete"))
            (Button :child (Text :text "Cancel") :variant "borderless" :action (Event "cancel_delete"))
          ])
        ])
      )
    ]
  )
  </a2ui>
  ```

- **Algorithmic Failure Explanation**:

  > Valid A2UI payload

- **Grader Reasoning (Grade I)**:
  > To determine if the submission meets the criterion, let's analyze it step-by-step:
  >
  > 1. **Target Surface ID**: The criterion requires the payload to target the surfaceId `'main'`.
  >    - Looking at the submission, we see `"createSurface": { "surfaceId": "main", ... }`. This successfully targets the surface `'main'`.
  > 2. **Data Model Updates/Initialization**: The task asks to initialize the surface 'main' and populate its data model with specific paths.
  >    - The submission includes a `"dataModel"` block inside the `createSurface` action.
  >    - Within `"dataModel"`, there is a `"user"` object containing `"name": "John Doe"` and `"email": "john.doe@example.com"`.
  >    - This structure corresponds to setting the data model path `/user/name` to `"John Doe"` and `/user/email` to `"john.doe@example.com"`.
  >    - The UI components within the submission also correctly bind their text values to these paths (e.g., `{"path": "/user/name"}` and `{"path": "/user/email"}`).
  >
  > The submission fully satisfies all aspects of the criterion.
  >
  > GRADE: C
