# Repository Guidelines

## Build, Test, and Development Commands

Run `yarn install` once, then `yarn dev` for the web server (Next.js watches on port 3001). Build artifacts with `yarn build`;

## Coding Style & Naming Conventions

TypeScript and modern React are mandatory; prefer function components and colocate UI logic in `app/components`. Follow Prettier's defaults (two-space indentation, single quotes) by running `yarn format` before commits. Component files use PascalCase (e.g., `AgentPanel.tsx`); hooks and utilities use camelCase in `*.ts`. The shared ESLint preset (`packages/eslint-config`) enforces `turbo/no-undeclared-env-vars`, so surface new env variables via typed helpers.

## Testing Guidelines

There is no bundled unit-test runner yet, so treat linting and type-checking as minimum CI gates. Keep test fixtures (JSON, mock responses) alongside the code they exercise to match existing samples.

## Commit & Pull Request Guidelines

Existing history uses short imperative subjects ("Add themed a2ui surface"); continue that pattern and reference issues in the footer as needed. Each PR should state scope, testing evidence, and any UI screenshots or terminal output that prove the agent path. Link design docs and flag follow-ups; ensure CI (`yarn build`) is green before requesting review.

## Security & Configuration

Never commit `.env` files or API keys; use `.env.local` for web and `.env` inside sample agents. Document any new secrets in `README.md`
