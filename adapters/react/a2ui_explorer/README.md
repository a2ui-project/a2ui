# A2UI React Gallery App

This is the reference Gallery Application for the A2UI React renderer. It allows you to explore A2UI samples, inspect the live data model, and step through the message rendering process.

## Prerequisites

This application depends on the following local libraries in this repository:

1. `@a2ui/web_core` (located in `renderers/web_core`)
2. `@a2ui/react` (located in `renderers/react`)

## Building Dependencies

Before running the gallery app, you must build the local renderer library:

```bash
# Navigate to the React renderer library
cd ../..

# Install and build the library
npm install
npm run build
```

_Note: Ensure `@a2ui/web_core` is also built if you have made changes to the core logic._

## Setup and Development

Once the dependencies are built, you can start the gallery app:

```bash
# Navigate to this directory
cd renderers/react/a2ui_explorer

# Install dependencies
npm install

# Start the development server
npm run dev
```

## Building for Production

To create a production build of the gallery app:

```bash
npm run build
```

## Running Tests

To run the integration tests:

```bash
npm test
```

## Gallery Features

- **3-Column Layout**: Left (Sample selection), Center (Live preview & Message stepper), Right (Data model & Action logs).
- **Progressive Stepper**: Use the "Advance" buttons next to each JSON message to see how the UI builds up incrementally.
- **Action Logs**: View real-time logs of actions triggered by user interactions.
- **Data Model Inspector**: Observe how the surface's data model changes as you interact with form fields.
