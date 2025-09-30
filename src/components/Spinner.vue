<script setup lang="ts">
import { ref } from 'vue';

withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg'
    color?: string
    animate?: boolean
    central?: boolean
  }>(),
  {
    size: 'sm',
    color: undefined,
    animate: true,
  },
)

const svg = ref(
  `url("data:image/svg+xml;utf8,${encodeURI('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 20 20"><path d="M10 1c0-.552-.449-1.005-.998-.95a10 10 0 1 0 5.382.962c-.497-.242-1.075.027-1.266.545-.191.518.077 1.088.568 1.343a8 8 0 1 1-4.683-.838C9.55 1.994 10 1.552 10 1Z"/></svg>')}")`,
)
</script>

<template>
  <div
    class="spinner"
    :class="{ ['spinner__no-animate']: !animate, [`spinner__${size}`]: true, ['spinner__central']: central }"
    :style="color ? { color: `var(--${color}-400, currentColor)` } : undefined"
  />
</template>

<style lang="scss" scoped>
.spinner {
  --spinner-size: 3rem;

  display: inline-block;

  width: var(--spinner-size);
  height: var(--spinner-size);

  background: conic-gradient(transparent 30deg, currentcolor);
  mask-image: v-bind(svg);
  mask-repeat: no-repeat;
  mask-size: var(--spinner-size);

  font-size: 0;
  vertical-align: top;

  animation: preloader 0.7s infinite linear;

  @keyframes preloader {
    0% {
      transform: rotate(0);
    }

    100% {
      transform: rotate(360deg);
    }
  }

  &__no-animate {
    animation: none;
  }

  &__central {
    position: absolute;
    top: 50%;
    left: 50%;

    margin: calc(var(--spinner-size) / -2) 0 0 calc(var(--spinner-size) / -2);
  }

  &__md {
    --spinner-size: var(--size-2lg);
  }

  &__lg {
    --spinner-size: var(--size-xl);
  }
}
</style>
