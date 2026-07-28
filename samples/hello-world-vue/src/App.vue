<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
  <main>
    <div class="hero">
      <img src="./assets/vue-logo.svg" alt="Vue.js logo" class="logo" />
      <h1>Hello, World!</h1>
      <p class="subtitle">Welcome to your first Vue.js app.</p>
    </div>

    <div class="card">
      <p>Edit <code>src/App.vue</code> to get started.</p>
    </div>

    <div class="card">
      <p>Interactive counter:</p>
      <button @click="count++">Count is {{ count }}</button>
    </div>

    <div class="links">
      <a href="https://vuejs.org/" target="_blank" rel="noopener">Vue Docs</a>
      <a href="https://vite.dev/" target="_blank" rel="noopener">Vite</a>
    </div>
  </main>
</template>

<style scoped>
main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rem;
  padding: 4rem 2rem;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.logo {
  width: 100px;
  height: 100px;
}

h1 {
  font-size: 3rem;
  font-weight: 700;
  color: var(--color-heading);
  margin: 0;
}

.subtitle {
  font-size: 1.2rem;
  color: var(--color-text);
  margin: 0;
}

.card {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1.5rem 2rem;
  text-align: center;
}

button {
  background: #42b883;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 0.6rem 1.4rem;
  font-size: 1rem;
  cursor: pointer;
  margin-top: 0.5rem;
  transition: background 0.2s;
}

button:hover {
  background: #33a06f;
}

.links {
  display: flex;
  gap: 1.5rem;
}

.links a {
  color: #42b883;
  text-decoration: none;
  font-weight: 500;
}

.links a:hover {
  text-decoration: underline;
}
</style>
