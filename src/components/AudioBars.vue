<script setup lang="ts">
import { ref, onBeforeUnmount, watch, useTemplateRef } from 'vue';
import { createAudioVisualization } from '../lib/audioVisualizer';

const props = withDefaults(defineProps<{
  audio: HTMLAudioElement | MediaStream | null
  barWidth?: number
  barGap?: number
  barColor?: string
  barCount?: number
  animated?: boolean
  rounded?: boolean
}>(), {
  barWidth: 2,
  barGap: 2,
  barColor: 'currentColor',
  barCount: undefined,
  animated: false,
  rounded: false,
});

const container = useTemplateRef<HTMLElement>('container');
const bars = ref<number[]>([]);

let visualizer: ReturnType<typeof createAudioVisualization> | null = null;

const setupVisualizer = () => {
  if (!container.value || !props.audio) return;

  // Stop previous visualizer if exists
  if (visualizer) {
    visualizer.stop();
  }

  const options = props.barCount
    ? props.barCount
    : container.value;

  visualizer = createAudioVisualization(
    props.audio,
    options,
    props.barWidth,
    props.barGap,
  );

  visualizer.onUpdate((values: number[]) => {
    bars.value = values;
  });
};

watch(
  () => [
    props.audio,
    container.value,
  ],
  () => {
    setupVisualizer();
  }, {
    immediate: true,
  },
);

onBeforeUnmount(() => {
  if (visualizer) {
    visualizer.stop();
    visualizer = null;
  }
});
</script>

<template>
  <div
    ref="container"
    class="audio-bars"
    :style="{
      '--bar-width': `${props.barWidth}px`,
      '--bar-gap': `${props.barGap}px`,
      '--bar-color': props.barColor,
    }"
  >
    <div
      v-for="(value, index) in bars"
      :key="index"
      class="audio-bar"
      :class="{ 'animated': props.animated, 'rounded': props.rounded }"
      :style="{
        height: `${value * 100}%`,
      }"
    />
  </div>
</template>

<style lang="scss" scoped>
.audio-bars {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: var(--bar-gap);
}

.audio-bar {
  width: var(--bar-width);
  min-height: var(--bar-width);

  background-color: var(--bar-color);

  &.animated {
    transition: height 0.05s ease-out;
  }

  &.rounded {
    border-radius: var(--bar-width);
  }
}
</style>
