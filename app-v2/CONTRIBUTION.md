# AppV2 Contribution Guide

## Scope
This guide defines the architecture and implementation rules for `app-v2`.

## Core Principles
- Keep features isolated by domain (`sessions`, `session-viewer`, `model-configs`, etc.).
- Keep repositories focused on persistence and data access only.
- Keep view behavior inside components/subcomponents.
- Prefer small components with explicit responsibilities over large monolith classes.

## Feature Boundaries
- `features/sessions`
  - Owns session selection/list concerns.
  - Owns URL hash navigation for selected session (`#session=<id>`).
  - Owns list/table rendering and row-level interactions.
- `features/session-viewer`
  - Owns active session timeline rendering.
  - Owns segment-level timeline interactions and editing UX.
  - Must consume session selection from `features/sessions`.
- Repositories are shared contracts and should not be edited for view-only tasks.

## Component Pattern
Use component + subcomponent composition.

Required pattern:
- Parent component orchestrates data fetching and child instantiation.
- Child subcomponents own their own `createElement`, events, and local view state.
- Subcomponents expose `root` for append by parent.
- If needed, subcomponents may expose additional appendable elements (e.g. `extraElements`).
- For rich view interactions, use `Binder + Component` inside the same feature:
  - Binder: DOM structure/refs and basic event wiring.
  - Component: state transitions, validation, and feature behavior.
  - Binder must not depend on repositories.
  - Repository access should stay in component/orchestrator layer.

Implemented examples:
- `SessionsComponent` -> `SessionTableRowComponent`
- `SessionViewerComponent` -> `SessionViewerSegmentComponent`
- `SessionViewerSegmentComponent` -> `SessionViewerSegmentBinder`

## Editing UX Rules
- Session table row name:
  - Single click on row: select session.
  - Double click on title: edit title.
  - Single click on edit icon: edit title.
- Segment row:
  - Single click on row: select row.
  - Double click on segment text: enter edit mode.
  - Single click on edit icon: enter edit mode.
  - Save only on explicit check button.
  - Cancel only on explicit X button.

## CSS Organization
Use feature-local CSS close to feature code.

Current structure:
- `src/features/sessions/styles/sessions.css`
- `src/features/session-viewer/styles/session-viewer.css`

Global/base CSS should contain only cross-feature primitives and global layout foundations.
Do not move feature-specific selectors back into `src/styles/base.css`.

## Logging Architecture
Use the centralized logger only.

Rules:
- Use `import { logger } from "@logger"` in app code.
- Never instantiate `Logger` directly in features/components/helpers.
- The logger singleton is bound once at app bootstrap (`AppController`) to `System Logs` UI.
- `console.log` is allowed only inside `src/features/system-logs/logger.ts`.
- Replace any `console.error/warn/info/debug/log` in feature code with `logger.log(...)` or `logger.error(...)`.

Criteria for where to add logs:
- Log at action boundaries:
  - User-triggered actions (button click flows, toggles, start/stop operations).
  - Controller lifecycle (`initialize`, recovery start/end, backend switch).
- Log at state transitions:
  - Session status changes (`decoding -> active`, `recording -> saving`, etc.).
  - Backend/model selection changes.
- Log around external I/O:
  - HTTP requests and failures.
  - Storage/repository writes with meaningful side effects.
  - Audio decode/merge operations and recovery merges.
- Log important success/failure checkpoints:
  - Start + completion of long/critical operations.
  - Error cases with `logger.error(message, error)`.

What to avoid:
- Do not log inside tight loops/hot render paths per item/frame.
- Do not log sensitive raw payloads or large blobs/text bodies.
- Do not duplicate equivalent messages in multiple layers for the same event.

Message style:
- Keep messages short, factual, and searchable.
- Include stable identifiers when available (`sessionId`, backend id, model name).
- Prefer one clear log per transition instead of many micro-logs.

## File Organization
When adding feature UI behavior:
- Add or update files inside the feature folder first.
- Add subcomponents when a single class starts to mix concerns.
- Keep helper logic in `helpers/` inside the same feature.
- Keep feature-specific binders inside that feature (for example:
  `src/features/session-viewer/binders/*`).
- Keep `src/binders` for app-level concerns only:
  - `dom.ts`
  - `app-layout-binder.ts`

## Naming Conventions
- Components: `*Component`
- Row subcomponents: `*RowComponent` or `*TableRowComponent`
- Viewer item subcomponents: `*SegmentComponent`
- DOM binders: `*Binder`
- Feature exports should be centralized in each feature `index.ts`.

## Review Checklist
Before merging:
1. Is view logic inside feature components (not repositories)?
2. Are row/item interactions isolated in subcomponents?
3. Is CSS placed in the same feature tree?
4. Are feature boundaries respected (`sessions` vs `session-viewer`)?
5. Does `npm run -s build` pass in `app-v2`?
