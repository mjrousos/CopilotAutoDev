# Research: Create Placeholder Author Website (Issue #20)

## Problem Statement

The issue requests a personal author website located at `./samples/author-site/`. The site must include:

- **Home page** with navigation links to all other pages
- **Biography page**
- **Writing samples page**
- **Announcements & upcoming events page**

Content may be placeholder. The implementation must use **a modern, up-to-date version of Vue.js** and associated idiomatic patterns.

---

## Relevant Existing Repository Code

The repository (`mjrousos/CopilotAutoDev`) is an AutoDev orchestration framework. There is currently:

- No `samples/` directory — it does not yet exist and must be created.
- No prior Vue.js or frontend code in the repository.
- No shared component libraries or design systems to inherit from.

The author-site will be a fully new, self-contained project under `samples/author-site/`.

---

## External Research

### 1. Vue.js Version

**Vue 3.5.x** (specifically 3.5.13 as of mid-2025) is the current stable release. Vue 2 reached End-of-Life on December 31, 2023. All new projects must use Vue 3.

- Source: https://vuejs.org / https://github.com/vuejs/core/blob/main/CHANGELOG.md

### 2. Project Scaffolding

**`create-vue`** (backed by Vite) is the officially recommended scaffolding tool. The legacy `@vue/cli` is in maintenance mode and should not be used for new projects.

```bash
npm create vue@latest author-site
```

Recommended `create-vue` selections:
- Vue Router: **Yes**
- TypeScript: Optional (No for simplicity in a placeholder site)
- Pinia: No (no complex state needed)
- ESLint + Prettier: Yes

- Source: https://vuejs.org/guide/quick-start

### 3. Routing

**Vue Router 4** is the only officially supported router for Vue 3.

Suggested routes:
| Path | Component | Description |
|---|---|---|
| `/` | `HomeView.vue` | Landing page with nav links |
| `/biography` | `BiographyView.vue` | Author bio, background, photo placeholder |
| `/writing` | `WritingView.vue` | Writing samples / excerpts |
| `/events` | `EventsView.vue` | Announcements, upcoming events |

Lazy-loaded routes via `() => import(...)` provide automatic code splitting.

- Source: https://router.vuejs.org

### 4. API Style

**Composition API with `<script setup>`** is the recommended approach for all new Vue 3 projects. It provides:
- Better TypeScript integration
- Cleaner logic reuse via composables
- Less boilerplate than Options API

Options API is still valid and supported; for a small static site, either works, but Composition API is idiomatic for new Vue 3 projects.

- Source: https://vuejs.org/guide/extras/composition-api-faq

### 5. Styling

**Tailwind CSS v4** integrates seamlessly with Vite via `@tailwindcss/vite` plugin (no `postcss.config.js` required). It enables rapid, responsive layout suitable for an author's public-facing site.

Alternative: plain scoped CSS (`<style scoped>`) — zero dependencies, full control, but more boilerplate for consistent layout.

For a placeholder site, **scoped CSS** is simpler and avoids extra dependencies. For a production-quality look, Tailwind is the better choice.

- Source: https://tailwindcss.com/docs/installation/vite

### 6. Project Structure

```
samples/author-site/
├── public/
│   └── favicon.ico
├── src/
│   ├── assets/
│   │   └── main.css
│   ├── components/
│   │   ├── SiteHeader.vue      # Navigation bar
│   │   └── SiteFooter.vue
│   ├── views/
│   │   ├── HomeView.vue
│   │   ├── BiographyView.vue
│   │   ├── WritingView.vue
│   │   └── EventsView.vue
│   ├── router/
│   │   └── index.js
│   ├── App.vue
│   └── main.js
├── index.html
├── vite.config.js
└── package.json
```

### 7. Static Hosting / Deployment

For a simple author website, a **plain Vue 3 SPA** (output of `npm run build`) deployed to any static host is the simplest approach. For better SEO, **Nuxt 3 with `nuxi generate`** (SSG mode) is a stronger choice, but adds setup complexity.

Since the issue asks for a **placeholder** site with no deployment requirement specified, a plain Vue 3 + Vite SPA is the appropriate choice.

If SEO becomes important later, migration to Nuxt 3 SSG is straightforward.

---

## Recommended Implementation Direction

### Approach: Vue 3 + Vite SPA (Plain SPA, no SSG)

1. **Scaffold** with `npm create vue@latest` selecting Vue Router.
2. **Create four view components** under `src/views/`:
   - `HomeView.vue` — welcome message, author name, card/link grid to other pages
   - `BiographyView.vue` — placeholder bio text (name, background, interests)
   - `WritingView.vue` — list of placeholder writing samples (title, excerpt, genre)
   - `EventsView.vue` — list of placeholder upcoming events/announcements
3. **Create shared components** under `src/components/`:
   - `SiteHeader.vue` — `<nav>` with `<RouterLink>` to all four pages
   - `SiteFooter.vue` — copyright line
4. **Wire router** in `src/router/index.js` with lazy-loaded routes.
5. **Style** with scoped CSS in each component (minimal, clean author aesthetic — white background, serif font for headers, readable line length).
6. **All content is placeholder** (lorem ipsum bios, fictional book titles, future event dates).

### Key Implementation Notes

- Use `<script setup>` syntax throughout.
- Use `<RouterLink>` (not `<a href>`) for internal navigation.
- Define placeholder data as `const` arrays in `<script setup>` — no external data store needed.
- Include a `README.md` at `samples/author-site/` explaining how to run the project.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Vue CLI used instead of create-vue | Low | Explicit instruction to use `npm create vue@latest` |
| Options API used instead of Composition API | Low | Explicit instruction in design document |
| `node_modules` committed to repo | Medium | Ensure `.gitignore` excludes `node_modules/` |
| Missing `dist/` in gitignore | Medium | Ensure `.gitignore` excludes `dist/` |
| Router configured for server-side history mode without redirect rules | Low | Use `createWebHashHistory` as fallback, or document redirect requirement |

---

## Open Questions

1. **Author identity**: Should placeholder content use a fictional author name, or a generic "Your Name Here" style? (Recommendation: use a generic fictional name like "Alex Morgan" for realism.)
2. **Styling depth**: Should the site have a polished look using Tailwind CSS, or is minimal scoped CSS sufficient for a placeholder? (Recommendation: scoped CSS is sufficient given placeholder intent.)
3. **Writing samples format**: Should samples be inline text or simulated "read more" links? (Recommendation: short excerpt + placeholder "Read More" button for realism.)
4. **Events format**: Date format, RSVP links? (Recommendation: simple list with date and description, no external links.)
5. **TypeScript**: Should the project use TypeScript? (Recommendation: No, for simplicity in a placeholder site; JS is sufficient.)

---

## Summary

A Vue 3.5 + Vite SPA scaffolded with `create-vue` and Vue Router 4 is the recommended implementation. Four view components (Home, Biography, Writing, Events) and two shared layout components (SiteHeader, SiteFooter) cover all requirements. Composition API with `<script setup>` and scoped CSS are the idiomatic choices. All content will be placeholder. The project lives at `samples/author-site/` and is self-contained with its own `package.json`.
