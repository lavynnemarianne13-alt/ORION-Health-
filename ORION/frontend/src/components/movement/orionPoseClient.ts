import { apiRequest } from '../../services/apiClient';
import { mapOrionKeypoints } from './orionKeypoints';
import type { PoseDetection, PoseDetector, PoseLandmark } from './poseClient';

export async function createOrionPoseDetector(): Promise<PoseDetector> {
  const model = await apiRequest<{ landmarks_version: string }>('/api/v1/pose/model');
  const frameCanvas = document.createElement('canvas');
  const context = frameCanvas.getContext('2d');
  if (!context) throw new Error('Could not initialize camera frame capture.');
  const controller = new AbortController();

  return {
    landmarksVersion: model.landmarks_version,
    async detectForVideo(video) {
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      frameCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      frameCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      context.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
      const image = await new Promise<Blob>((resolve, reject) => {
        frameCanvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('Could not encode the camera frame.'));
        }, 'image/jpeg', 0.8);
      });
      const { keypoints, detection } = await apiRequest<{ keypoints: PoseLandmark[]; detection: PoseDetection | null }>('/api/v1/pose/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: image,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      return { ...mapOrionKeypoints(keypoints), detection };
    },
    close() {
      controller.abort();
    },
  };
}
