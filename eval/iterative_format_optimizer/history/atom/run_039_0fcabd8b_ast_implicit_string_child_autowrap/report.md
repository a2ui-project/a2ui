# Inference Format Optimization Report

- **Strategy (Format)**: `atom`
- **Evaluation Model**: `google/gemini-3.5-flash`

## Summary Table

| Metric                           | Baseline | Current | Diff   |
| :------------------------------- | :------- | :------ | :----- |
| **Pytest Conformance**           | PASS     | PASS    | -      |
| **Overall Pass Rate**            | 100.0%   | 50.0%   | -50.0% |
| **Algorithmic Schema Pass Rate** | 100.0%   | 50.0%   | -50.0% |
| **Inference Duration (sec)**     | 8.05s    | 8.10s   | +0.6%  |
| **Avg Input Tokens**             | 0        | 0       | -      |
| **Avg Output Tokens**            | 0        | 0       | -      |

## Active Git Diff

_No files modified under `agent_sdks`._

## Failure Details (Count: 1 / 2)

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
  (Column
    (data
      $/breeds [
        (:name "Golden Retriever" :url "https://example.com/golden.jpg")
        (:name "Beagle" :url "https://example.com/beagle.jpg")
      ]
      $/skills ["Running", "Sleeping", "Guarding", "Fetch"]
      $/generatedName ""
      $/generatedLegs 0
      $/selectedSkills []
    )
    (Card
      :child "breed_column"
    )
    (Column :id "breed_column" :children ("breed_title" "breed_image" "breed_list"))
    (Text :id "breed_title" :text "Famous Dog breeds")
    (Image :id "breed_image" :url "https://example.com/dog_banner.jpg" :variant "mediumFeature")
    (List
      :id "breed_list"
      :direction "horizontal"
      :children (template :item breed (Image :url $/breed/url :variant "icon"))
    )
    (Card
      :child "generator_column"
    )
    (Column :id "generator_column" :children ("gen_title" "gen_desc" "name_input" "legs_input" "skills_picker" "gen_divider" "gen_button" "result_section"))
    (Text :id "gen_title" :text "Dog Generator")
    (Text :id "gen_desc" :text "Configure your fictional dog breed below.")
    (TextField :id "name_input" :label "Dog breed name" :value $/generatedName)
    (TextField :id "legs_input" :label "Number of legs" :variant "number" :value $/generatedLegs)
    (ChoicePicker
      :id "skills_picker"
      :label "Skills"
      :variant "multipleSelection"
      :options $/skills
      :value $/selectedSkills
    )
    (Divider :id "gen_divider")
    (Button
      :id "gen_button"
      :child "btn_text"
      :variant "primary"
      :action (Event "generate_dog")
    )
    (Text :id "btn_text" :text "Generate")
    (Column
      :id "result_section"
      :children ("res_name" "res_legs")
    )
    (Text :id "res_name" :text (formatString "Breed: ${/generatedName}"))
    (Text :id "res_legs" :text (formatString "Legs: ${/generatedLegs}"))
  )
  </a2ui>
  ```

- **Algorithmic Failure Explanation**:

  > Format compilation/validation failed during solver step.

- **Grader Reasoning (Grade I)**:
  > To assess the submission, we evaluate it against the given criterion step-by-step:
  >
  > 1. **Check for `createSurface` and `surfaceId 'main'`**: The task explicitly asks to generate a `createSurface` message and use a `surfaceId` of `'main'`. The submission fails to wrap the UI in a `createSurface` message and does not include any reference to the `surfaceId` `'main'`.
  > 2. **Check for Validity**: The submission prepends a compilation/validation failure message: `Compilation/validation failed: Component 'root' references non-existent component 'node_1' in field 'children'`. This indicates the payload itself is structurally invalid and failed validation.
  > 3. **Check UI elements**: Although the raw output attempts to define the vertical list with the requested cards ("Famous Dog breeds" and "Dog generator"), the structural errors in the code and the lack of the required `createSurface` container make it invalid.
  >
  > Since the submission fails to provide a valid A2UI payload, does not include the `surfaceId`, and fails to generate the `createSurface` wrapper, it does not meet the criteria.
  >
  > GRADE: I
