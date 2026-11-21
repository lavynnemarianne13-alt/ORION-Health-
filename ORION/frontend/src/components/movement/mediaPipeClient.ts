import { apiRequest, apiUrl } from '../../services/apiClient';
import type { PoseDetector, PoseResult } from './poseClient';

const PACKAGE_VERSION = '0.10.21';
const runtime = import.meta.env.VITE_MEDIAPIPE_RUNTIME || `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${PACKAGE_VERSION}`;
const LITE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

function absolute(url: string) { return new URL(url, window.location.href).href; }

export async function createMediaPipeDetector(): Promise<PoseDetector> {
  let modelAssetPath = LITE_MODEL;
  let variant = 'lite';
  try {
    const model = await apiRequest<{ asset: `/${string}` }>('/api/v1/pose/mediapipe');
    modelAssetPath = absolute(apiUrl(model.asset));
    variant = 'full';
  } catch {
    // Standalone browser tracking can still load the official Lite model.
  }
  const landmarksVersion = `mediapipe-pose-${variant}-${PACKAGE_VERSION}`;
  const bundleUrl = absolute(`${runtime}/vision_bundle.mjs`);
  const { FilesetResolver, PoseLandmarker } = await import(/* @vite-ignore */ bundleUrl);
  const fileset = await FilesetResolver.forVisionTasks(absolute(`${runtime}/wasm`));
  const options = {
    baseOptions: { modelAssetPath, delegate: 'CPU' as const },
    runningMode: 'VIDEO' as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.55,
    minPosePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
  };

  if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
    const worker = new Worker(`${import.meta.env.BASE_URL}mediapipe-worker.js`);
    let receiver: { resolve: (result: PoseResult) => void; reject: (error: Error) => void } | undefined;
    const fail = (error: Error) => { receiver?.reject(error); receiver = undefined; };
    worker.onmessage = (event: MessageEvent<{ result?: PoseResult; error?: string }>) => {
      if (event.data.error) fail(new Error(event.data.error));
      else { receiver?.resolve(event.data.result ?? { landmarks: [] }); receiver = undefined; }
    };
    worker.onerror = () => fail(new Error('The MediaPipe worker could not run.'));
    const send = (message: object, transfer: Transferable[] = []) => new Promise<PoseResult>((resolve, reject) => {
      receiver = { resolve, reject };
      worker.postMessage(message, transfer);
    });
    const timeout = window.setTimeout(() => fail(new Error('MediaPipe worker initialization timed out.')), 20_000);
    try {
      await send({ bundle: absolute(bundleUrl), fileset, options });
      let closed = false;
      return {
        landmarksVersion,
        async detectForVideo(video, timestamp) {
          const frame = await createImageBitmap(video);
          if (closed) { frame.close(); return { landmarks: [] }; }
          return send({ frame, timestamp }, [frame]);
        },
        close() {
          closed = true;
          worker.terminate();
          fail(new Error('MediaPipe tracking stopped.'));
        },
      };
    } catch (error) {
      console.warn('MediaPipe worker unavailable, using browser-thread tracking.', error);
      worker.terminate();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  const detector = await PoseLandmarker.createFromOptions(fileset, options);
  return {
    landmarksVersion,
    detectForVideo: (video: HTMLVideoElement, timestamp: number) => ({ landmarks: detector.detectForVideo(video, timestamp).landmarks }),
    close: () => detector.close(),
  };
}
