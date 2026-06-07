<template>
  <div class="card">
    <h2 class="title">{{ title }}</h2>
    <p class="body">{{ body }}</p>
  </div>
</template>

<script setup>
defineProps({ title: String, body: String })
</script>

<style scoped>
.card { font-size: 13px; padding: 10px; }
.title { font-size: 10px; }
.body { font-size: 11px; }
@media (min-width: 600px) { .card { padding: 16px; } }
@media (min-width: 768px) { .card { padding: 20px; } }
@media (min-width: 1024px) { .card { padding: 24px; } }
@media (min-width: 1280px) { .card { padding: 32px; } }
.anim { animation: spin 2s infinite; }
</style>
