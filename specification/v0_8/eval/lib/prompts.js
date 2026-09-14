"use strict";
/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.prompts = void 0;
const basic_schema_matcher_1 = require("./basic_schema_matcher");
const message_type_matcher_1 = require("./message_type_matcher");
const surface_update_schema_matcher_1 = require("./surface_update_schema_matcher");
const schemaPath = '../../json/server_to_client_with_standard_catalog.json';
exports.prompts = [
    {
        name: 'deleteSurface',
        description: 'A DeleteSurface message to remove a UI surface.',
        schemaPath,
        promptText: "Generate a JSON message containing a deleteSurface for the surface 'dashboard-surface-1'.",
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('deleteSurface'),
            new basic_schema_matcher_1.BasicSchemaMatcher('deleteSurface'),
            new basic_schema_matcher_1.BasicSchemaMatcher('deleteSurface.surfaceId', 'dashboard-surface-1'),
        ],
    },
    {
        name: 'dogBreedGenerator',
        description: 'A prompt to generate a UI for a dog breed information and generator tool.',
        schemaPath,
        promptText: `Generate a JSON message containing a surfaceUpdate to describe the following UI:

A root node has already been created with ID "root".

A vertical list with:
Dog breed information
Dog generator

The dog breed information is a card, which contains a title “Famous Dog breeds”, a header image, and a carousel of different dog breeds. The carousel information should be in the data model at /carousel.

The dog generator is another card which is a form that generates a fictional dog breed with a description
- Title
- Description text explaining what it is
- Dog breed name (text input)
- Number of legs (number input)
- Skills (checkboxes)
- Button called “Generate” which takes the data above and generates a new dog description
- A divider
- A section which shows the generated content
`,
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Column'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Image'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'Dog breed name', true),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'Number of legs', true),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Generate'),
        ],
    },
    {
        name: 'loginForm',
        description: 'A simple login form with username, password, a "remember me" checkbox, and a submit button.',
        schemaPath,
        promptText: 'Generate a JSON message containing a surfaceUpdate for a login form. It should have a "Login" heading, two text fields for username and password (bound to /login/username and /login/password), a checkbox for "Remember Me" (bound to /login/rememberMe), and a "Sign In" button. The button should trigger a \'login\' action, passing the username, password, and rememberMe status in the dynamicContext.',
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Login'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'username', true),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'password', true),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('CheckBox', 'label', 'Remember Me'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Sign In'),
        ],
    },
    {
        name: 'productGallery',
        description: 'A gallery of products using a list with a template.',
        schemaPath,
        promptText: "Generate a JSON message containing a surfaceUpdate for a product gallery. It should display a list of products from the data model at '/products'. Use a template for the list items. Each item should be a Card containing an Image (from '/products/item/imageUrl'), a Text component for the product name (from '/products/item/name'), and a Button labeled \"Add to Cart\". The button's action should be 'addToCart' and include a staticContext with the product ID, for example, 'productId': 'product123'. You should create a template component and then a list that uses it.",
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Column'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Card'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Image'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Add to Cart'),
        ],
    },
    {
        name: 'productGalleryData',
        description: 'A DataModelUpdate message to populate the product gallery data.',
        schemaPath,
        promptText: `Generate a JSON message containing a dataModelUpdate to populate the data model for the product gallery. The update should target the path '/products' and include at least two products. Each product in the map should have keys 'id', 'name', and 'imageUrl'. For example:
    {
      "key": "product1",
      "valueMap": [
        { "key": "id", "valueString": "product1" },
        { "key": "name", "valueString": "Awesome Gadget" },
        { "key": "imageUrl", "valueString": "https://example.com/gadget.jpg" }
      ]
    }`,
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('dataModelUpdate'),
            new basic_schema_matcher_1.BasicSchemaMatcher('dataModelUpdate.path', '/products'),
            new basic_schema_matcher_1.BasicSchemaMatcher('dataModelUpdate.contents.0.key'), // Check that the first product key exists
            new basic_schema_matcher_1.BasicSchemaMatcher('dataModelUpdate.contents.0.valueMap'), // Check that valueMap exists
        ],
    },
    {
        name: 'settingsPage',
        description: 'A settings page with tabs and a modal dialog.',
        schemaPath,
        promptText: 'Generate a JSON message containing a surfaceUpdate for a user settings page. Use a Tabs component with two tabs: "Profile" and "Notifications". The "Profile" tab should contain a simple column with a text field for the user\'s name. The "Notifications" tab should contain a checkbox for "Enable email notifications". Also, include a Modal component. The modal\'s entry point should be a button labeled "Delete Account", and its content should be a column with a confirmation text and two buttons: "Confirm Deletion" and "Cancel".',
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'name', true),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('CheckBox', 'label', 'Enable email notifications'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Delete Account'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Confirm Deletion'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Cancel'),
        ],
    },
    {
        name: 'dataModelUpdate',
        description: 'A DataModelUpdate message to update user data.',
        schemaPath,
        promptText: "Generate a JSON message with a 'dataModelUpdate' property. This is used to update the client's data model. The scenario is that a user has just logged in, and we need to populate their profile information. Create a single data model update message to set '/user/name' to \"John Doe\" and '/user/email' to \"john.doe@example.com\".",
        matchers: [new message_type_matcher_1.MessageTypeMatcher('dataModelUpdate')],
    },
    {
        name: 'uiRoot',
        description: 'A UIRoot message to set the initial UI and data roots.',
        schemaPath,
        promptText: 'Generate a JSON message with a \'beginRendering\' property. This message tells the client where to start rendering the UI. Set the UI root to a component with ID "mainLayout".',
        matchers: [new message_type_matcher_1.MessageTypeMatcher('beginRendering')],
    },
    {
        name: 'animalKingdomExplorer',
        description: 'A simple, explicit UI to display a hierarchy of animals.',
        schemaPath,
        promptText: `Generate a JSON message with a surfaceUpdate property for a simplified UI explorer for the Animal Kingdom.

The UI must have a main 'Heading' with the text "Simple Animal Explorer".

Below the heading, create a 'Tabs' component with exactly three tabs: "Mammals", "Birds", and "Reptiles".

Each tab's content should be a 'Column'. The first item in each column must be a 'TextField' with the label "Search...". Below the search field, display the hierarchy for that tab using nested 'Card' components.

The exact hierarchy to create is as follows:

**1. "Mammals" Tab:**
   - A 'Card' for the Class "Mammalia".
   - Inside the "Mammalia" card, create two 'Card's for the following Orders:
     - A 'Card' for the Order "Carnivora". Inside this, create 'Card's for these three species: "Lion", "Tiger", "Wolf".
     - A 'Card' for the Order "Artiodactyla". Inside this, create 'Card's for these two species: "Giraffe", "Hippopotamus".

**2. "Birds" Tab:**
   - A 'Card' for the Class "Aves".
   - Inside the "Aves" card, create three 'Card's for the following Orders:
     - A 'Card' for the Order "Accipitriformes". Inside this, create a 'Card' for the species: "Bald Eagle".
     - A 'Card' for the Order "Struthioniformes". Inside this, create a 'Card' for the species: "Ostrich".
     - A 'Card' for the Order "Sphenisciformes". Inside this, create a 'Card' for the species: "Penguin".

**3. "Reptiles" Tab:**
   - A 'Card' for the Class "Reptilia".
   - Inside the "Reptilia" card, create two 'Card's for the following Orders:
     - A 'Card' for the Order "Crocodilia". Inside this, create a 'Card' for the species: "Nile Crocodile".
     - A 'Card' for the Order "Squamata". Inside this, create 'Card's for these two species: "Komodo Dragon", "Ball Python".

Each species card must contain a 'Row' with an 'Image' and a 'Text' component for the species name. Do not add any other components.

Each Class and Order card must contain a 'Column' with a 'Text' component with the name, and then the children cards below.

IMPORTANT: Do not skip any of the classes, orders, or species above. Include every item that is mentioned.
`,
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Simple Animal Explorer'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'Search...'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Class: Mammalia'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Order: Carnivora'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Lion'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Tiger'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Wolf'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Order: Artiodactyla'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Giraffe'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Hippopotamus'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Class: Aves'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Order: Accipitriformes'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Bald Eagle'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Order: Struthioniformes'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Ostrich'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Order: Sphenisciformes'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Penguin'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Class: Reptilia'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Order: Crocodilia'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Nile Crocodile'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Order: Squamata'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Komodo Dragon'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Ball Python'),
        ],
    },
    {
        name: 'recipeCard',
        description: 'A UI to display a recipe with ingredients and instructions.',
        schemaPath,
        promptText: "Generate a JSON message with a surfaceUpdate property for a recipe card. It should have a 'Heading' for the recipe title, \"Classic Lasagna\". Below the title, an 'Image' of the lasagna. Then, a 'Row' containing two 'Column's. The first column has a 'Text' heading \"Ingredients\" and a 'List' of ingredients. The second column has a 'Text' heading \"Instructions\" and a 'List' of step-by-step instructions. Finally, a 'Button' at the bottom labeled \"Watch Video Tutorial\".",
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Classic Lasagna'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Image'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Ingredients'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Column'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Instructions'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Watch Video Tutorial'),
        ],
    },
    {
        name: 'musicPlayer',
        description: 'A simple music player UI.',
        schemaPath,
        promptText: "Generate a JSON message with a surfaceUpdate property for a music player. It should be a 'Card' containing a 'Column'. Inside the column, there's an 'Image' for the album art, a 'Text' for the song title \"Bohemian Rhapsody\", another 'Text' for the artist \"Queen\", a 'Slider' for the song progress, and a 'Row' with three 'Button's: \"Previous\", \"Play\", and \"Next\".",
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Column'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Image'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Bohemian Rhapsody'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Queen'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Slider'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Previous'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Play'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Next'),
        ],
    },
    {
        name: 'weatherForecast',
        description: 'A UI to display the weather forecast.',
        schemaPath,
        promptText: "Generate a JSON message with a surfaceUpdate property for a weather forecast UI. It should have a 'Heading' with the city name, \"New York\". Below it, a 'Row' with the current temperature as a 'Text' component (\"68°F\") and an 'Image' for the weather icon (e.g., a sun). Below that, a 'Divider'. Then, a 'List' component to display the 5-day forecast. Each item in the list should be a 'Row' with the day, an icon, and high/low temperatures.",
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'New York'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', '68°F'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Image'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('List'),
        ],
    },
    {
        name: 'surveyForm',
        description: 'A customer feedback survey form.',
        schemaPath,
        promptText: 'Generate a JSON message with a surfaceUpdate property for a survey form. It should have a \'Heading\' "Customer Feedback". Then a \'MultipleChoice\' question "How would you rate our service?" with options "Excellent", "Good", "Average", "Poor". Then a \'CheckBox\' section for "What did you like?" with options "Product Quality", "Price", "Customer Support". Finally, a \'TextField\' with the label "Any other comments?" and a \'Button\' labeled "Submit Feedback".',
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Customer Feedback'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('MultipleChoice', 'options', 'Excellent'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('CheckBox', 'label', 'Product Quality'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'Any other comments?'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Submit Feedback'),
        ],
    },
    {
        name: 'flightBooker',
        description: 'A form to search for flights.',
        schemaPath,
        promptText: 'Generate a JSON message with a surfaceUpdate property for a flight booking form. It should have a \'Heading\' "Book a Flight". Use a \'Row\' for two \'TextField\'s: "Departure City" and "Arrival City". Below that, another \'Row\' for two \'DateTimeInput\'s: "Departure Date" and "Return Date". Add a \'CheckBox\' for "One-way trip". Finally, a \'Button\' labeled "Search Flights".',
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Book a Flight'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'Departure City'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'Arrival City'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('DateTimeInput'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('CheckBox', 'label', 'One-way trip'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Search Flights'),
        ],
    },
    {
        name: 'dashboard',
        description: 'A simple dashboard with statistics.',
        schemaPath,
        promptText: 'Generate a JSON message with a surfaceUpdate property for a simple dashboard. It should have a \'Heading\' "Sales Dashboard". Below, a \'Row\' containing three \'Card\'s. The first card has a \'Text\' "Revenue" and another \'Text\' "$50,000". The second card has "New Customers" and "1,200". The third card has "Conversion Rate" and "4.5%".',
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Sales Dashboard'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Column'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Revenue'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', '$50,000'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'New Customers'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', '1,200'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Conversion Rate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', '4.5%'),
        ],
    },
    {
        name: 'contactCard',
        description: 'A UI to display contact information.',
        schemaPath,
        promptText: "Generate a JSON message with a surfaceUpdate property for a contact card. It should be a 'Card' with a 'Row'. The row contains an 'Image' (as an avatar) and a 'Column'. The column contains a 'Text' for the name \"Jane Doe\", a 'Text' for the email \"jane.doe@example.com\", and a 'Text' for the phone number \"(123) 456-7890\". Below the main row, add a 'Button' labeled \"View on Map\".",
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Column'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Image'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Jane Doe'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'jane.doe@example.com'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', '(123) 456-7890'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'View on Map'),
        ],
    },
    {
        name: 'calendarEventCreator',
        description: 'A form to create a new calendar event.',
        schemaPath,
        promptText: 'Generate a JSON message with a surfaceUpdate property for a calendar event creation form. It should have a \'Heading\' "New Event". Include a \'TextField\' for the "Event Title". Use a \'Row\' for two \'DateTimeInput\'s for "Start Time" and "End Time". Add a \'CheckBox\' labeled "All-day event". Finally, a \'Row\' with two \'Button\'s: "Save" and "Cancel".',
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'New Event'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'Event Title'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('DateTimeInput'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('CheckBox', 'label', 'All-day event'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Save'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Cancel'),
        ],
    },
    {
        name: 'checkoutPage',
        description: 'A simplified e-commerce checkout page.',
        schemaPath,
        promptText: 'Generate a JSON message with a surfaceUpdate property for a checkout page. It should have a \'Heading\' "Checkout". Create a \'Column\' for "Shipping Information" with \'TextField\'s for "Full Name" and "Address". Create another \'Column\' for "Payment Information" with \'TextField\'s for "Card Number" and "Expiry Date". Add a \'Divider\'. Show an order summary with a \'Text\' component: "Total: $99.99". Finally, a \'Button\' labeled "Place Order".',
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Checkout'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'Full Name'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'Address'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'Card Number'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('TextField', 'label', 'Expiry Date'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Total: $99.99'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Place Order'),
        ],
    },
    {
        name: 'socialMediaPost',
        description: 'A component representing a social media post.',
        schemaPath,
        promptText: "Generate a JSON message with a surfaceUpdate property for a social media post. It should be a 'Card' containing a 'Column'. The first item is a 'Row' with an 'Image' (user avatar) and a 'Text' (username \"user123\"). Below that, a 'Text' component for the post content: \"Enjoying the beautiful weather today!\". Then, an 'Image' for the main post picture. Finally, a 'Row' with three 'Button's: \"Like\", \"Comment\", and \"Share\".",
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Column'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'user123'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Enjoying the beautiful weather today!'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Image'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Like'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Comment'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Share'),
        ],
    },
    {
        name: 'eCommerceProductPage',
        description: 'A detailed product page for an e-commerce website.',
        schemaPath,
        promptText: `Generate a JSON message with a surfaceUpdate property for a product details page.
The main layout should be a 'Row'.
The left side of the row is a 'Column' containing a large main 'Image' of the product, and below it, a 'Row' of three smaller thumbnail 'Image' components.
The right side of the row is another 'Column' for product information:
- A 'Heading' for the product name, "Premium Leather Jacket".
- A 'Text' component for the price, "$299.99".
- A 'Divider'.
- A 'Text' heading "Select Size", followed by a 'MultipleChoice' component with options "S", "M", "L", "XL".
- A 'Text' heading "Select Color", followed by another 'MultipleChoice' component with options "Black", "Brown", "Red".
- A 'Button' with the label "Add to Cart".
- A 'Text' component for the product description below the button.`,
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Premium Leather Jacket'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', '$299.99'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Image'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('MultipleChoice', 'options', 'S'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('MultipleChoice', 'options', 'Black'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Add to Cart'),
        ],
    },
    {
        name: 'interactiveDashboard',
        description: 'A dashboard with filters and data cards.',
        schemaPath,
        promptText: `Generate a JSON message with a surfaceUpdate property for an interactive analytics dashboard.
At the top, a 'Heading' "Company Dashboard".
Below the heading, a 'Card' containing a 'Row' of filter controls:
- A 'DateTimeInput' with a label for "Start Date".
- A 'DateTimeInput' with a label for "End Date".
- A 'Button' labeled "Apply Filters".
Below the filters card, a 'Row' containing two 'Card's for key metrics:
- The first 'Card' has a 'Heading' "Total Revenue" and a 'Text' component showing "$1,234,567".
- The second 'Card' has a 'Heading' "New Users" and a 'Text' component showing "4,321".
Finally, a large 'Card' at the bottom with a 'Heading' "Revenue Over Time" and a placeholder 'Image' to represent a line chart.`,
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Company Dashboard'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('DateTimeInput'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Button', 'label', 'Apply Filters'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Total Revenue'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', '$1,234,567'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'New Users'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', '4,321'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Revenue Over Time'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Image'),
        ],
    },
    {
        name: 'travelItinerary',
        description: 'A multi-day travel itinerary display.',
        schemaPath,
        promptText: `Generate a JSON message with a surfaceUpdate property for a travel itinerary for a trip to Paris.
It should have a main 'Heading' "Paris Adventure".
Below, use a 'List' to display three days. Each item in the list should be a 'Card'.
- The first 'Card' (Day 1) should contain a 'Heading' "Day 1: Arrival & Eiffel Tower", and a 'List' of activities for that day: "Check into hotel", "Lunch at a cafe", "Visit the Eiffel Tower".
- The second 'Card' (Day 2) should contain a 'Heading' "Day 2: Museums & Culture", and a 'List' of activities: "Visit the Louvre Museum", "Walk through Tuileries Garden", "See the Arc de Triomphe".
- The third 'Card' (Day 3) should contain a 'Heading' "Day 3: Art & Departure", and a 'List' of activities: "Visit Musée d'Orsay", "Explore Montmartre", "Depart from CDG".
Each activity in the inner lists should be a 'Row' containing a 'CheckBox' (to mark as complete) and a 'Text' component with the activity description.`,
        matchers: [
            new message_type_matcher_1.MessageTypeMatcher('surfaceUpdate'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Paris Adventure'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Day 1: Arrival & Eiffel Tower'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Day 2: Museums & Culture'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Heading', 'text', 'Day 3: Art & Departure'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Column'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('CheckBox'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Visit the Eiffel Tower'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Visit the Louvre Museum'),
            new surface_update_schema_matcher_1.SurfaceUpdateSchemaMatcher('Text', 'text', 'Explore Montmartre'),
        ],
    },
];
