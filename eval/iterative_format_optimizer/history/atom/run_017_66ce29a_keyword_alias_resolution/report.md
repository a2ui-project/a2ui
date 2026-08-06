# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff   |
| :------------------------------- | :------- | :------ | :----- |
| **Pytest Conformance**           | PASS     | PASS    | -      |
| **Overall Pass Rate**            | 100.0%   | 66.7%   | -33.3% |
| **Algorithmic Schema Pass Rate** | 100.0%   | 83.3%   | -16.7% |
| **Inference Duration (sec)**     | 8.79s    | 9.40s   | +7.0%  |
| **Avg Input Tokens**             | 0        | 0       | -      |
| **Avg Output Tokens**            | 0        | 0       | -      |

## Active Git Diff

```diff
diff --git a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
index c8b55a78..f6b12483 100644
--- a/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
+++ b/agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py
@@ -551,8 +551,30 @@ class AtomCompiler:
                     i += 1
                     continue
             if isinstance(item, str) and item.startswith(":"):
-                # Tagged keyword attribute :key val
+                # Tagged keyword attribute :key val or standalone flag :key
                 key = item[1:]
+
+                # Dynamic S-expression keyword alias resolution for optional layout flags & enums
+                enum_prop_match = None
+                if hasattr(self.schema_helper, "_helper") and self.schema_helper._helper and comp_props:
+                    for p in prop_keys:
+                        p_enums = self.schema_helper._helper.get_property_enum(comp_type, p)
+                        if p_enums and key in p_enums:
+                            enum_prop_match = (p, key)
+                            break
+
+                if enum_prop_match:
+                    comp_dict[enum_prop_match[0]] = enum_prop_match[1]
+                    i += 1
+                    continue
+
+                if key in prop_keys and self.schema_helper.get_property_type(comp_type, key) == "boolean":
+                    next_item = expr[i + 1] if i + 1 < len(expr) else None
+                    if not isinstance(next_item, bool):
+                        comp_dict[key] = True
+                        i += 1
+                        continue
+
                 val = expr[i + 1] if i + 1 < len(expr) else None
                 if key in ("items", "dataset", "source", "path") and key not in prop_keys:
                     items_path_var = self._resolve_val(val, components)
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
  (Column :id "root" :align "stretch" :justify "start"
    (data $/products [
      (:id "product1" :name "Awesome Gadget" :imageUrl "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500")
      (:id "product2" :name "Sleek Headset" :imageUrl "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500")
    ])
    (Text :text "Premium Product Gallery" :variant "body")
    (Divider :axis "horizontal")
    (List :children (template :item item
      (Card :child (Column :children [
        (Image :url $/item/imageUrl :description $/item/name :variant "mediumFeature" :fit "cover")
        (Row :children [
          (Column :children [
            (Text :text $/item/name :variant "body")
          ])
          (Button :child (Text :text "View Details") :variant "primary" :action (Event "view_product" :productId $/item/id))
        ] :justify "spaceBetween" :align "center")
      ]))
    )))
  </a2ui>
  ```

- **Grader Reasoning (Grade I)**:
  > Based on the provided criterion, let's assess the submission step by step:
  >
  > 1. **Target Surface ID**: The criterion requires the payload to target the surfaceId 'main'. Looking at the submitted JSON, inside the `createSurface` action, the `"surfaceId"` is set to `"main"`. This requirement is met.
  > 2. **Data Model Updates**: The task asks to initialize the surface 'main' and populate its data model. The criterion requires the payload to set the data model paths `'/user/name'` to `"John Doe"` and `'/user/email'` to `"john.doe@example.com"`.
  >    In the submission, under `"createSurface"`, there is a `"dataModel"` object:
  >    ```json
  >    "dataModel": {
  >      "user": {
  >        "name": "John Doe",
  >        "email": "john.doe@example.com"
  >      }
  >    }
  >    ```
  >    This correctly maps to the paths `/user/name` and `/user/email` with the requested values. This requirement is met.
  >
  > The submission fully satisfies all parts of the criterion.
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
  (Column :id "root" :children ["settingsTabs" "deleteModal"]
    (data $/profile/name "" $/notifications/email false)
    (Tabs :id "settingsTabs" :tabs [(:title "Profile" :child "profileCol") (:title "# Notifications" :child "notifCol")]
      (Column :id "profileCol" :children ["nameField"]
        (TextField :id "nameField" :label "Name" :value $/profile/name :variant "shortText")
      )
      (Column :id "notifCol" :children ["emailNotifCheck"]
        (CheckBox :id "emailNotifCheck" :label "Enable email notifications" :value $/notifications/email)
      )
    )
    (Modal :id "deleteModal" :trigger "deleteBtn" :content "confirmCol"
      (Button :id "deleteBtn" :child "deleteBtnText" :action (Event "open_delete_modal")
        (Text :id "deleteBtnText" :text "Delete Account")
      )
      (Column :id "confirmCol" :children ["confirmText" "confirmButtonsRow"]
        (Text :id "confirmText" :text "Are you sure you want to delete your account? This action cannot be undone.")
        (Row :id "confirmButtonsRow" :children ["confirmDelBtn" "cancelBtn"]
          (Button :id "confirmDelBtn" :child "confirmDelText" :variant "primary" :action (Event "confirm_delete_account")
            (Text :id "confirmDelText" :text "Confirm Deletion")
          )
          (Button :id "cancelBtn" :child "cancelText" :variant "borderless" :action (Event "cancel_delete_account")
            (Text :id "cancelText" :text "Cancel")
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
  > Based on the provided criterion, let's assess the submission step by step:
  >
  > 1. **Target Surface ID**: The criterion requires the payload to target the surfaceId 'main'. Looking at the submitted JSON, inside the `createSurface` action, the `"surfaceId"` is set to `"main"`. This requirement is met.
  > 2. **Data Model Updates**: The task asks to initialize the surface 'main' and populate its data model. The criterion requires the payload to set the data model paths `'/user/name'` to `"John Doe"` and `'/user/email'` to `"john.doe@example.com"`.
  >    In the submission, under `"createSurface"`, there is a `"dataModel"` object:
  >    ```json
  >    "dataModel": {
  >      "user": {
  >        "name": "John Doe",
  >        "email": "john.doe@example.com"
  >      }
  >    }
  >    ```
  >    This correctly maps to the paths `/user/name` and `/user/email` with the requested values. This requirement is met.
  >
  > The submission fully satisfies all parts of the criterion.
  >
  > GRADE: C
