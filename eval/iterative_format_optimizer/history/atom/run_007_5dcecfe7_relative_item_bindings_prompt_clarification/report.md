# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff |
| :------------------------------- | :------- | :------ | :--- |
| **Pytest Conformance**           | -        | PASS    | -    |
| **Overall Pass Rate**            | -        | 66.7%   |      |
| **Algorithmic Schema Pass Rate** | -        | 83.3%   |      |
| **Inference Duration (sec)**     | -        | 9.33s   |      |
| **Avg Input Tokens**             | -        | 0       |      |
| **Avg Output Tokens**            | -        | 0       |      |

## Active Git Diff

```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
index 6ad0dac9..71e26db6 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/prompt_generator.py
@@ -50,13 +50,13 @@ IMPORTANT: Wrap your output inside `<a2ui>` and `</a2ui>` sentinel tags. Do NOT

 5. Data Bindings:
    - Absolute data model paths start with '$/', e.g., $/user/firstName.
-   - Relative template item fields start with '$/item_var/field', e.g. $/item/name.
+   - Relative template item fields start with '$/item_var/field', e.g. $/item/name (where 'item_var' matches the template item variable declared via :item item_var).

 6. Data Model Population:
    - Initialize or populate data model state exclusively using the (data $/path1 "val1" $/path2 123) block at the root level.

 7. Dynamic List Templates:
-   - List templates use (template :item item (ChildComponent $/item/name)) or (ListComponent :children (template :item item (ChildComponent $/item/name))).
+   - List templates use (template :item item (ChildComponent :prop $/item/name)) or (ListComponent :items $/items :template (template :item item (ChildComponent :prop $/item/name))).

 8. Action Events:
    - Actions use (Event "action_name" :param1 $/value).
@@ -78,7 +78,7 @@ IMPORTANT: Wrap your output inside `<a2ui>` and `</a2ui>` sentinel tags. Do NOT
    <a2ui>
    (ContainerComponent
      (data $/items [{"id": 1, "name": "Item 1"}] $/title "List Title")
-     (ListComponent :items $/items :template (template item (ChildComponent :title $/item/name))))
+     (ListComponent :items $/items :template (template :item item (ChildComponent :title $/item/name))))
    </a2ui>

 11. Strict Catalog Adherence:
```

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
    (data $/products {
      "product1": {
        "id": "product1",
        "name": "Premium Wireless Headphones",
        "imageUrl": "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600"
      },
      "product2": {
        "id": "product2",
        "name": "Minimalist Smart Watch",
        "imageUrl": "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600"
      }
    })
    (Text :text "Product Gallery" :variant "body")
    (Row
      (Card :child (Column
        (Image :url $/products/product1/imageUrl :description $/products/product1/name :fit "cover" :variant "mediumFeature")
        (Text :text $/products/product1/name :variant "body")
      ))
      (Card :child (Column
        (Image :url $/products/product2/imageUrl :description $/products/product2/name :fit "cover" :variant "mediumFeature")
        (Text :text $/products/product2/name :variant "body")
      ))
    )
  )
  </a2ui>
  ```

- **Grader Reasoning (Grade I)**:
  > To assess the submission against the given criterion, let's break down the requirements step-by-step:
  >
  > 1. **Target surfaceId 'main'**:
  >    The submitted JSON contains a `createSurface` action with the property `"surfaceId": "main"`. This successfully targets the correct surface ID.
  > 2. **Contain data model updates setting `/user/name` to "John Doe" and `/user/email` to "john.doe@example.com"**:
  >    Within the `createSurface` action, there is a `dataModel` object:
  >    ```json
  >    "dataModel": {
  >      "user": {
  >        "name": "John Doe",
  >        "email": "john.doe@example.com"
  >      }
  >    }
  >    ```
  >    This correctly populates the data model such that the path `/user/name` resolves to `"John Doe"` and `/user/email` resolves to `"john.doe@example.com"`.
  >
  > The submission successfully meets all parts of the criterion.
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
  (Column "root" :children ["tabs", "delete_modal"]
    ;; Initialize user settings state
    (data $/profile/name "Jane Doe" $/notifications/email true)

    ;; Settings Tabs
    (Tabs "tabs" :tabs [{"title": "Profile", "child": "profile_col"}, {"title": "# Notifications", "child": "notifications_col"}]

      ;; Profile Tab Pane
      (Column "profile_col" :children ["profile_name_input"]
        (TextField "profile_name_input" :label "Name" :value $/profile/name :placeholder "Enter your name"))

      ;; Notifications Tab Pane
      (Column "notifications_col" :children ["email_notif_check"]
        (CheckBox "email_notif_check" :label "Enable email notifications" :value $/notifications/email)))

    ;; Account Deletion Modal
    (Modal "delete_modal" :trigger "delete_btn" :content "confirm_col"

      ;; Trigger Button
      (Button "delete_btn" :child "delete_btn_text" :action (Event "open_delete_modal")
        (Text "delete_btn_text" :text "Delete Account"))

      ;; Confirmation Content
      (Column "confirm_col" :children ["confirm_text", "confirm_actions_row"]
        (Text "confirm_text" :text "Are you sure you want to delete your account? This action cannot be undone.")
        (Row "confirm_actions_row" :children ["confirm_btn", "cancel_btn"]
          (Button "confirm_btn" :variant "primary" :child "confirm_btn_text" :action (Event "confirm_deletion")
            (Text "confirm_btn_text" :text "Confirm Deletion"))
          (Button "cancel_btn" :child "cancel_btn_text" :action (Event "cancel_deletion")
            (Text "cancel_btn_text" :text "Cancel"))))))
  </a2ui>
  ```

- **Algorithmic Failure Explanation**:

  > Valid A2UI payload

- **Grader Reasoning (Grade I)**:
  > To assess the submission against the given criterion, let's break down the requirements step-by-step:
  >
  > 1. **Target surfaceId 'main'**:
  >    The submitted JSON contains a `createSurface` action with the property `"surfaceId": "main"`. This successfully targets the correct surface ID.
  > 2. **Contain data model updates setting `/user/name` to "John Doe" and `/user/email` to "john.doe@example.com"**:
  >    Within the `createSurface` action, there is a `dataModel` object:
  >    ```json
  >    "dataModel": {
  >      "user": {
  >        "name": "John Doe",
  >        "email": "john.doe@example.com"
  >      }
  >    }
  >    ```
  >    This correctly populates the data model such that the path `/user/name` resolves to `"John Doe"` and `/user/email` resolves to `"john.doe@example.com"`.
  >
  > The submission successfully meets all parts of the criterion.
  >
  > GRADE: C
