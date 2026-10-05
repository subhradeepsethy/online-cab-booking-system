# Repository Guidelines

This working tree is currently a blank project: no source files, tests, assets, build manifests, or Git history are present. Keep this guide current as the implementation is introduced.

## Project Structure & Module Organization

- Put production code in `src/`, grouped by domain or feature rather than file type alone.
- Put automated tests in `tests/`; keep fixtures and test-only data under `tests/fixtures/`.
- Put browser-facing static files in `public/` or `assets/` and documentation at the repository root or in `docs/`.
- Keep generated output in an ignored directory such as `dist/` or `build/`; never commit generated dependencies or secrets.

## Build, Test, and Development Commands

No build, test, or local-development commands are configured yet. When the first toolchain is added, expose repeatable scripts in its manifest (for example, `npm run dev`, `npm run build`, and `npm test`) and document them here and in `README.md`. A pull request should state the exact commands used for verification.

## Coding Style & Naming Conventions

Use the language community's formatter and linter once selected, and commit their configuration with the code. Until then, use spaces rather than tabs, two-space indentation for JSON/YAML/JavaScript-style files, and four-space indentation for Python. Use `PascalCase` for types/classes, `camelCase` for functions and variables, and `kebab-case` for directory names. Keep modules small, names descriptive, and comments focused on non-obvious decisions.

## Testing Guidelines

No testing framework or coverage threshold is configured. Add tests under `tests/` with names that describe the behavior under test, such as `auth.test.ts` or `test_auth.py`, and add the corresponding test command to the project manifest. Cover new behavior and regression cases; record any intentional coverage gap in the pull request.

## Commit & Pull Request Guidelines

There is no existing Git history from which to infer a commit convention. Use short, imperative subjects, for example `Add initial project structure`, and keep each commit focused. Pull requests should explain the change, link related issues, list verification commands, and include screenshots or recordings for user-facing changes.

## Configuration & Security

Do not commit credentials, tokens, private keys, or local environment files. Provide a sanitized `.env.example` when configuration is required, validate inputs at boundaries, and describe required environment variables without exposing their values.
