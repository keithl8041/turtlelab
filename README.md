# turtlelab

A kid-friendly AI turtle playground that turns natural language prompts into safe turtle DSL code, renders the result on canvas, and explains how the code works.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000.

## Development with hot reloading

Start both the backend and the Vite dev server together with one command:

```bash
npm run dev
```

Open http://localhost:5173. Vite automatically reloads the browser whenever you save changes to `public/app.js`, `public/styles.css`, or `public/index.html`. API calls to `/api/*` are proxied to the backend running on port 3000.

## Application Insights

Backend and frontend telemetry are instrumented through Azure Application Insights.

Set the connection string with:

```bash
APPLICATIONINSIGHTS_CONNECTION_STRING="InstrumentationKey=...;IngestionEndpoint=..."
```

If not set, the app uses the current built-in project connection string.

Telemetry covers:

- Server token-session flow (`/api/session/token-status`, `/api/session/token`, `/api/session/token/logout`)
- AI request lifecycle (`ai_request_started`, `ai_request_failed`, `ai_request_succeeded`, `ai_request_exception`)
- Client API telemetry from browser to server (`/api/telemetry`) with correlation ID headers (`X-Correlation-Id`)
- Prompt generation outcomes (`generate_completed` and client-side `generate_*` events)

## AI token options

- You can bring your own compatible API token from the splash screen.
- Provider models are selected automatically using app defaults (no manual model picker).
- Tokens are kept only in server memory for the current session and are never persisted.
- In-memory session tokens expire after 6 hours by default (`SESSION_TOKEN_TTL_MS` to override).
- If no token is provided, the app still works with built-in/sample drawing flows.

## Community gallery and admin

- Users can submit their current drawing (code, prompt, and AI metadata) from the **Community** tab.
- Submissions include name and email for admin follow-up; email addresses are never returned by the public gallery API.
- Public gallery data is available at `GET /api/gallery` and only shows **accepted** entries.
- Admin portal is available at `/admin` and requires `ADMIN_PORTAL_PASSWORD` for API actions.
- Admin APIs:
  - `GET /api/admin/submissions`
  - `POST /api/admin/submissions/:id/decision` with `{ "decision": "accept" | "reject" }`
- When accepted, entries receive AI-generated tags (with a local fallback tagger).
- Configure Azure Table storage using:

```bash
COMMUNITY_GALLERY_TABLE_SAS_URL="https://<account>.table.core.windows.net/<table>?<sas>"
COMMUNITY_GALLERY_TABLE_PARTITION="gallery"
```

- Optional admin notification webhook:

```bash
ADMIN_NOTIFICATION_WEBHOOK_URL="https://<logic-app-or-webhook-endpoint>"
```

## Test

```bash
npm test
```
