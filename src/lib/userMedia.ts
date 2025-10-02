import { tryOnScopeDispose } from '@vueuse/core';
import { ref, shallowRef, watch } from 'vue';

export function useUserMedia(options?: MediaStreamConstraints) {
  const stream = shallowRef<MediaStream | null>(null);
  const isMuted = ref(true);

  const start = async () => {
    if (!navigator) return;
    if (stream.value) return stream.value;

    stream.value = await navigator.mediaDevices.getUserMedia(options);
    if (isMuted.value) pause();

    return stream.value;
  };

  const pause = () => {
    stream.value?.getTracks().forEach(track => track.enabled = false);
  };

  const resume = () => {
    stream.value?.getTracks().forEach(track => track.enabled = true);
  };

  const stop = () => {
    stream.value?.getTracks().forEach(track => track.stop());
    stream.value = null;
  };

  watch(isMuted, async (value) => {
    if (!value) {
      resume();
    } else {
      pause();
    }
  }, {
    immediate: true,
  });

  tryOnScopeDispose(stop);

  return {
    stream,
    isMuted,
    start,
    pause,
    resume,
    stop,
  };
}
