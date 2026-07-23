# Research: Modern Vue Author Page (Issue #4)

## Problem Statement

Create an informational personal website for an author under `./samples/author-site`. The site must include:

1. **Home page** — landing page with links to the other sections
2. **Biography page** — information about the author
3. **Writing samples page** — list/display of writing excerpts or published works
4. **Announcements & upcoming events page** — news, book releases, appearances, etc.

Content will be placeholder initially. The app must use a modern, up-to-date version of Vue.js and follow idiomatic patterns.

---

## Relevant Existing Code

The repository contains no existing `samples/` directory. The project has no package configuration, no front-end tooling set up, and no existing Vue code. This is a greenfield implementation inside the monorepo.

The `.github/autodev/` directory houses AutoDev orchestration artifacts; the new site should be entirely self-contained under `./samples/author-site/` and should not modify any AutoDev control files.

---

## Technology Recommendations

### Vue 3 (latest stable)

- **Current stable version:** Vue 3.5.x (3.5.40 as of July 2026). ([Vue npm](https://www.npmjs.com/package/vue), [Vue 3.5 announcement](https://blog.vuejs.org/posts/vue-3-5))
- Vue 3.5 introduced `defineModel` for clean two-way binding, reactive props destructuring, `useTemplateRef` and `useId` helpers, and a 56 % reduction in reactivity memory usage.
- **Composition API with `<script setup>`** is the recommended idiomatic style for all new Vue 3 code. Avoid Options API for new components. ([Vue docs](https://vuejs.org/guide/scaling-up/tooling.html))

### Vite (build tooling)

- **Current stable version:** Vite 6.x.
- Scaffold with:
  ```bash
  npm create vue@latest
  ```
  (This runs `create-vue`, the official Vue scaffolding tool.) Select TypeScript, Vue Router, and ESLint during the wizard.
- Vite provides near-instant HMR, native ESM, and optimal production builds with code splitting.
- `vite.config.ts` should register `@vitejs/plugin-vue` and configure the `@` path alias.

### TypeScript

- Prefer TypeScript (`vue-ts` template) for type-safe component props, router types, and maintainability.
- Use `<script setup lang="ts">` in all Single File Components.

### Vue Router v4

- **Current stable version:** Vue Router 4.x. ([vue-router npm](https://www.npmjs.com/package/vue-router))
- Use `createWebHistory()` for clean URLs (no hash).
- Define routes as lazy-loaded dynamic imports for code splitting:
  ```ts
  { path: '/bio', component: () => import('@/views/BiographyView.vue') }
  ```
- Use named routes to avoid hard-coded path strings throughout the app.

### Styling

**Option A — Tailwind CSS v4 (recommended):** Utility-first CSS that is popular in the Vue ecosystem. Offers responsive breakpoints, dark-mode support, and good defaults out of the box. No component library required for a simple site; components can be composed from utilities. ([Tailwind + Vue guide](https://dev.to/wadizaatour/vue-3-and-tailwind-css-integration-guide-2bl1))

**Option B — Plain CSS / CSS variables:** Lower dependency count; keep a single `main.css` with CSS custom properties for the color palette, then use scoped styles in each `.vue` file. Suitable for a site this size.

Recommendation: **Tailwind CSS v4** gives a professional look with minimal custom CSS and is the community standard for new Vue projects.

### State Management

Pinia is the officially recommended state management library for Vue 3. For a simple multi-page informational site, however, Pinia may be unnecessary; page data (biography text, writing samples, events) can live as static TypeScript data objects or simple `ref`/`reactive` values inside views. If the scope grows (e.g., CMS integration), add Pinia at that point.

### Testing

Vitest (Vite-native) + Vue Test Utils is the recommended testing stack. For the initial implementation, the Design agent should decide the level of test coverage required. Component smoke tests are straightforward with these tools.

---

## Recommended Project Structure

```
samples/author-site/
  public/
    favicon.ico
  src/
    assets/
      main.css           # global styles / Tailwind entry
    components/
      AppHeader.vue      # site-wide navigation bar
      AppFooter.vue      # site-wide footer
      EventCard.vue      # reusable card for an event item
      WritingSampleCard.vue  # reusable card for a writing excerpt
    data/
      biography.ts       # static author bio data
      events.ts          # placeholder announcements/events
      writingSamples.ts  # placeholder writing samples
    router/
      index.ts           # route definitions
    views/
      HomeView.vue        # home page with navigation links
      BiographyView.vue   # author biography
      WritingSamplesView.vue  # writing samples
      EventsView.vue      # announcements & upcoming events
    App.vue              # root component with <RouterView>
    main.ts              # app entry point
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  tsconfig.app.json
  tsconfig.node.json
  tailwind.config.js     # (if Tailwind chosen)
  postcss.config.js      # (if Tailwind chosen)
  .eslintrc.cjs
  .prettierrc
  README.md
```

---

## Implementation Details

### Routing Table

| Route | Name | View Component | Description |
|-------|------|----------------|-------------|
| `/` | `home` | `HomeView.vue` | Landing page with nav cards linking to other pages |
| `/bio` | `biography` | `BiographyView.vue` | Author biography and headshot placeholder |
| `/writing` | `writing-samples` | `WritingSamplesView.vue` | List of writing excerpts with titles, genres, and short blurbs |
| `/events` | `events` | `events` | Announcements and upcoming events |

### Navigation

`AppHeader.vue` should render a persistent top navigation bar using `<RouterLink>` components. It should include the author's name/logo and links to all four pages. Active links should be visually highlighted using Vue Router's `router-link-active` / `router-link-exact-active` CSS classes.

### Placeholder Content Structure

**Biography (`src/data/biography.ts`):**
```ts
export const biography = {
  name: 'Jane Author',
  tagline: 'Novelist | Essayist | Storyteller',
  photo: '/img/author-placeholder.jpg',
  bio: 'Lorem ipsum...',
  socialLinks: [...]
}
```

**Writing Samples (`src/data/writingSamples.ts`):**
```ts
export interface WritingSample {
  id: number
  title: string
  genre: string
  excerpt: string
  publishedDate: string
  link?: string
}
export const writingSamples: WritingSample[] = [...]
```

**Events (`src/data/events.ts`):**
```ts
export interface Event {
  id: number
  title: string
  date: string           // ISO-8601
  location: string
  description: string
  registrationLink?: string
}
export const events: Event[] = [...]
```

### Accessibility Considerations

- Use semantic HTML: `<header>`, `<nav>`, `<main>`, `<article>`, `<section>`, `<footer>`.
- Provide `aria-label` on the `<nav>` element.
- Every image must have descriptive `alt` text (or `alt=""` for decorative images).
- Focus states must be visible; do not suppress the browser outline entirely.
- Color contrast must meet WCAG 2.1 AA (minimum 4.5:1 for normal text).
- Page `<title>` should update per route; use Vue Router's `afterEach` hook or `useHead`/`vueuse/head` to set `document.title`.

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Over-engineering for a simple static site | Medium | Keep Pinia, Vuex, and other heavy deps out of scope; use TypeScript data files |
| Tailwind v4 breaking changes vs v3 | Low | Scaffold fresh with Tailwind v4; use `@tailwindcss/vite` plugin for seamless Vite integration |
| Placeholder content looks unprofessional | Low | Use sensible lorem ipsum with consistent structure; leave clear `TODO` comments |
| Node/npm version incompatibilities | Low | Require Node 20+ (matches this repo's AutoDev environment) |
| Missing `vue-router` HTML5 history server configuration in deployment | Medium | Document that a static server must redirect all requests to `index.html`; Vite preview handles this locally |

---

## Open Questions for Design

1. **CSS framework decision:** Should the design use Tailwind CSS v4 or plain scoped CSS? Tailwind is recommended but adds a dependency.
2. **Dark mode:** Should the site support a dark/light toggle?
3. **Image assets:** Should the implementation include a sample placeholder image (e.g., gray box SVG) or rely solely on CSS backgrounds?
4. **Vitest tests:** Should the initial implementation include component unit tests or integration tests, or defer to a later iteration?
5. **Deployment target:** Static hosting (GitHub Pages, Netlify, etc.) or a Node server? This affects `createWebHistory` vs `createWebHashHistory` and the base path configuration.
6. **Single-column vs multi-column layout:** Should the home page use a card grid, a single centered column, or a hero layout?

---

## Recommended Implementation Direction

1. Scaffold a new Vite + Vue 3 + TypeScript project in `samples/author-site/` using `npm create vue@latest` (no workspace hoisting needed; the site is self-contained).
2. Choose **Tailwind CSS v4** (`@tailwindcss/vite` plugin) for styling.
3. Define the four routes with lazy loading and a shared `AppHeader` / `AppFooter` layout wrapper in `App.vue`.
4. Create TypeScript data modules for biography, writing samples, and events so placeholder content is easy to swap.
5. Implement each view as a straightforward Composition API component consuming the data module.
6. Set the document title on each route change via a global `afterEach` hook.
7. Add an `alt`-text linter rule (Volar / ESLint `vue/html-has-content`) and ensure basic WCAG AA compliance.
8. Include a `README.md` under `samples/author-site/` with setup and development instructions.

---

## References

- Vue 3 Official Docs — https://vuejs.org/guide/
- Vue 3.5 Announcement — https://blog.vuejs.org/posts/vue-3-5
- Vue Router v4 Docs — https://router.vuejs.org/
- Vite Official Guide — https://vite.dev/guide/
- Tailwind CSS v4 Docs — https://tailwindcss.com/docs/installation/using-vite
- create-vue scaffolding tool — https://github.com/vuejs/create-vue
- VueUse Composition Utilities — https://vueuse.org/
- WCAG 2.1 Guidelines — https://www.w3.org/WAI/WCAG21/quickref/
- Feature-Sliced Design for Vue — https://feature-sliced.design/blog/vue-application-architecture
