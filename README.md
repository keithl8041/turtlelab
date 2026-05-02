# turtlelab

A kid-friendly AI turtle playground that turns natural language prompts into safe turtle DSL code, renders the result on canvas, and explains how the code works.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000.

## AI token options

- You can bring your own compatible API token from the splash screen.
- Provider models are selected automatically using app defaults (no manual model picker).
- Tokens are kept only in server memory for the current session and are never persisted.
- In-memory session tokens expire after 6 hours by default (`SESSION_TOKEN_TTL_MS` to override).
- If no token is provided, the app still works with built-in/sample drawing flows.

## Test

```bash
npm test
```
