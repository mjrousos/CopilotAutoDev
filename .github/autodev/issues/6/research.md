# Research: Issue #6 – Placeholder author website in `./samples/author-site`

## 1) Problem summary
Issue #6 requests a placeholder informational website for an author under `./samples/author-site`, with:
- Home page linking to other pages
- Biography page
- Writing samples page
- Announcements/upcoming events page

The implementation should use modern, idiomatic Vue.js patterns.

## 2) Repository findings relevant to implementation
- AutoDev expects research artifacts at issue-specific paths like `.github/autodev/issues/<issue>/research.md` (`.github/scripts/autodev/config.mjs`).
- Research state is constrained to changing only this artifact path (`.github/scripts/autodev/config.mjs`, `getStateChangePolicy`).
- The orchestrator’s tests run with Node’s built-in test runner:
  - `node --test .github/scripts/autodev/test/*.test.mjs`

These constraints mean this Research task should only produce this document, while implementation work will occur later in the Implementation state.

## 3) External research

### Vue project setup and ecosystem
- The official Vue quick start recommends scaffolding with `create-vue` via `npm create vue@latest` (or equivalent package-manager command). This creates a Vue 3 + Vite project and can include optional tooling such as Vue Router, Pinia, Vitest, ESLint, and Prettier.
  - Source: https://vuejs.org/guide/quick-start.html
- Vue Router is the official routing library for Vue single-page applications.
  - Source: https://router.vuejs.org/
- Pinia is the officially recommended state management library for Vue 3.
  - Source: https://pinia.vuejs.org/

### Security practices for Vue apps
- Vue escapes interpolated text by default in templates, reducing XSS risk for normal `{{ }}` rendering.
- `v-html` renders raw HTML and should be avoided for untrusted content.
- Vue recommends never using untrusted content as a template source.
  - Source: https://vuejs.org/guide/best-practices/security.html

## 4) Recommended implementation direction (for Design/Implementation)

### Preferred architecture
Create a Vue 3 SPA in `samples/author-site` using `create-vue` and include Vue Router.

Suggested route structure:
- `/` → Home page with navigation links/cards to all other sections
- `/bio` → Biography page
- `/writing-samples` → Writing samples page
- `/announcements` → Announcements and upcoming events page

### Component structure
- `App.vue`: shell with header/nav/footer and `<RouterView />`
- `src/views/HomeView.vue`
- `src/views/BioView.vue`
- `src/views/WritingSamplesView.vue`
- `src/views/AnnouncementsView.vue`
- `src/router/index.js` (or `.ts` if TypeScript is selected)

### Data/content strategy for placeholders
Use local static data modules (or JSON imports) for initial placeholder content:
- `src/data/bio.js`
- `src/data/writingSamples.js`
- `src/data/announcements.js`

Benefits:
- Clear separation of content from layout
- Easy later replacement with real content
- No backend/API dependencies needed for this issue

### Styling and UX
- Keep styling simple and readable (responsive layout with basic typography and spacing).
- Ensure keyboard-accessible navigation and semantic headings.
- Keep navigation visible on every page.

### Tooling recommendations
During scaffold prompts, include:
- Vue Router (required for multi-page UX in SPA)
- ESLint + Prettier (code consistency)
- Vitest (unit tests for basic rendering and route availability)

Pinia is optional here because this site has mostly static content and minimal shared state.

## 5) Risks and mitigations
- **Risk:** Overengineering for a placeholder site.
  - **Mitigation:** Keep dependencies minimal (Vue + Router + basic lint/test setup only).
- **Risk:** Introducing unsafe raw HTML for richer placeholders.
  - **Mitigation:** Avoid `v-html`; use normal Vue interpolation and static trusted content.
- **Risk:** Route/navigation regressions.
  - **Mitigation:** Add smoke tests to verify each route renders expected page headings.

## 6) Proposed acceptance criteria for implementation
- A Vue app exists under `samples/author-site` and runs with standard scripts (`dev`, `build`, `preview`).
- Four content pages exist: Home, Biography, Writing Samples, Announcements/Events.
- Home page links to all other pages.
- Placeholder content is present on all pages.
- Basic tests confirm pages/routes render.

## 7) Open questions for Design
1. Should this be a pure SPA with router-based views (recommended), or separate HTML entry points?
2. Should TypeScript be enabled during scaffold, or keep JavaScript for minimal complexity?
3. Is a lightweight CSS framework desired, or should styling remain custom/minimal?
4. Should announcements/events be modeled as dated entries sorted by date from day one?

## 8) Decision rationale
Research is sufficient to proceed to Design: the required pages are clear, the recommended Vue scaffolding approach is established, and security/quality guardrails are identified.
