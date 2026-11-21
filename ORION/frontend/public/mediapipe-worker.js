/* global self */
let poseLandmarker;

self.onmessage = async ({ data }) => {
  try {
    if (data.bundle) {
      const { PoseLandmarker } = await import(data.bundle);
      poseLandmarker = await PoseLandmarker.createFromOptions(data.fileset, data.options);
      self.postMessage({ ready: true });
      return;
    }
    const result = poseLandmarker.detectForVideo(data.frame, data.timestamp);
    self.postMessage({ result: { landmarks: result.landmarks } });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    data.frame?.close();
  }
};
