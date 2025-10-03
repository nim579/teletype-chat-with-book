<script setup lang="ts">
import { computed, useTemplateRef } from "vue";

const props = withDefaults(defineProps<{
  level: number;            // 0..1
  size?: number;            // диаметр контента (px)
  ringCount?: number;       // сколько колец
  color?: string;           // цвет колец
}>(), {
  size: undefined,
  ringCount: 7,
  color: "#000000",
});

const content = useTemplateRef<HTMLElement>('content');

const clamped = computed(() => Math.max(0, Math.min(1, props.level)));

const contentSize = computed(() => props.size || content.value?.clientWidth || 100);

const styleVars = computed(() => {
  const L = clamped.value;
  const maxScale = 1 + 0.65 * L;                 // как далеко «разбегаются» кольца
  const duration = 1.6 - 1.0 * L;                // скорость волн (чем выше L, тем быстрее)
  const alpha = 0.06 + 0.3 * L;                 // прозрачность линий
  const spread = Math.round(contentSize.value * 1);   // поле вокруг аватара под волны

  return {
    "--ring-count": String(props.ringCount),
    "--ring-color": props.color,
    "--max-scale": String(maxScale),
    "--ring-alpha": String(alpha),
    "--dur": `${duration}s`,
    "--spread": `${spread}px`,
    "--content-size": `${contentSize.value}px`,
  } as Record<string, string>;
});

const silent = computed(() => clamped.value < 0.02);
</script>

<template>
<div class="voice-wrap" :style="styleVars" :class="{ silent }">
  <div class="content">
    <slot ref="content" />
  </div>

  <!-- Кольца (чистый CSS) -->
  <div class="rings">
    <div v-for="i in ringCount" :key="i" class="ring" :style="{ '--i': String(i - 1) }" />
  </div>
</div>
</template>

<style scoped>
.voice-wrap {
  position: relative;
  /* width: var(--content-size);
  height: var(--content-size); */
  display: grid;
  place-items: center;
}

.content {
  position: relative;
  z-index: 2;
  /* width: var(--content-size);
  height: var(--content-size); */
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0 2px 20px rgba(0, 0, 0, .12);
}

/* Контейнер колец: выносим за края аватара на --spread */
.rings {
  position: absolute;
  z-index: 1;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

/* Одно «кольцо» — это тонкая окружность, масштабируем её и гасим прозрачность */
.ring {
  position: absolute;
  width: calc(100% - 2px);
  height: calc(100% - 2px);
  border-radius: 50%;
  border: 2px solid var(--ring-color);
  opacity: var(--ring-alpha);
  transform: scale(1);
  transform-origin: center;
  filter: drop-shadow(0 0 4px color-mix(in oklab, var(--ring-color) 60%, white 40%));
  animation: ripple var(--dur) linear infinite;
  /* лестница задержек создаёт ощущение «распространения» */
  animation-delay: calc((var(--i) / var(--ring-count)) * var(--dur));
}

/* Глобальная анимация волны */
@keyframes ripple {
  0% {
    transform: scale(1);
    opacity: var(--ring-alpha);
  }

  90% {
    transform: scale(var(--max-scale));
    opacity: 0;
  }

  100% {
    transform: scale(var(--max-scale));
    opacity: 0;
  }
}

/* Когда тишина — всё замораживаем и прячем мягко */
.silent .ring {
  animation-play-state: paused;
  opacity: 0;
  transition: opacity .25s ease;
}
</style>
