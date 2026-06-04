# A2UI Composer

A tool for building A2UI widgets, powered by copilot kit. Run it yourself, or just go to https://a2ui-editor.ag-ui.com

![A2UI Composer](images/composer.png)

## Using the composer

Just ask the composer to build you a widget, have it make any changes you want, copy the json, and paste it into your components that you give to your a2ui enabled agent!

<video src="images/demo.mp4" controls width="100%"></video>

## Running the composer

You need a `GOOGLE_GENERATIVE_AI_API_KEY` (or `GEMINI_API_KEY`) or `OPENAI_API_KEY` in a `.env.local` file in this directory.

Example `.env.local`:

```env
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key_here
# OR
GEMINI_API_KEY=your_gemini_api_key_here
# OR
OPENAI_API_KEY=your_openai_api_key_here
```

### Build Dependencies

Since the composer depends on shared renderers in this repository, you must build them first:

```bash
# Build markdown-it renderer
cd ../../adapters/markdown/markdown-it
npm install
npm run build

# Build web-core renderer
cd ../../web_core
npm install
npm run build

# Build lit renderer
cd ../lit
npm install
npm run build

# Back to composer
cd ../../tools/composer
```

Then, just install, build, and run!

```bash
pnpm i && pnpm build
pnpm dev
```

## Testing

To run the tests:

```bash
pnpm test
```

To run tests in watch mode:

```bash
pnpm test:watch
```
