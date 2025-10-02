export function createAudioVisualization(
  audio: HTMLAudioElement | MediaStream,
  containerOrBarsCount: HTMLElement | number,
  barsWidth = 2,
  barsGap = 2,
): {
  stop: () => void;
  onUpdate: (callback: (values: number[]) => void) => void;
} {
  const audioCtx = new window.AudioContext();

  let frame: number | null = null;
  let barsCount: number;

  // Determine the number of bars
  if (typeof containerOrBarsCount === 'number') {
    barsCount = containerOrBarsCount;
  } else {
    // Calculate based on container width
    const containerWidth = containerOrBarsCount.clientWidth;
    barsCount = Math.floor(containerWidth / (barsWidth + barsGap));
  }

  let onUpdate: ((values: number[]) => void) | null = null;

  const stop = () => {
    frame && cancelAnimationFrame(frame);
  };

  const setUpdateCallback = (callback: (values: number[]) => void) => {
    onUpdate = callback;
    return stop;
  };

  try {
    const source = audio instanceof HTMLAudioElement
      ? audioCtx.createMediaElementSource(audio)
      : audioCtx.createMediaStreamSource(audio);

    const analyser = audioCtx.createAnalyser();

    analyser.fftSize = 512;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    source.connect(analyser);

    // For HTMLAudioElement, we need to reconnect to destination
    // so sound continues to play
    if (audio instanceof HTMLAudioElement) {
      analyser.connect(audioCtx.destination);
    }

    const process = () => {
      frame = requestAnimationFrame(process);
      analyser.getByteFrequencyData(dataArray);

      const values = [];
      const minIndex = Math.floor(bufferLength * 0.05);
      const maxIndex = Math.floor(bufferLength * 0.5); // Cut off ultra-high frequencies

      for (let i = 0; i < barsCount; i++) {
        // Use logarithmic scale
        const logIndex = Math.floor(
          Math.pow(i / barsCount, 2.2) * (maxIndex - minIndex) + minIndex
        );
        const value = dataArray[logIndex];
        // Normalize to 0-1
        values.push(value / 255);
      }

      if (onUpdate) {
        onUpdate(values);
      }
    }

    process();
  } catch (err) {
    console.error('Error accessing audio:', err);
  }

  return {
    stop,
    onUpdate: setUpdateCallback
  };
}
