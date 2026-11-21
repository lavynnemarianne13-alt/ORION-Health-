import type { PoseLandmark, PoseResult } from './poseClient';

// Orion's head and duplicate hand/wrist annotations have no separately matched joint here.
const jointPairs = [
  [1, 11], [2, 12], [3, 13], [4, 14], [5, 15], [6, 16],
  [7, 23], [8, 24], [9, 25], [10, 26], [11, 27], [12, 28],
] as const;

export function mapOrionKeypoints(points: PoseLandmark[]): PoseResult {
  if (points.length !== 15) return { landmarks: [] };
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [source, target] of jointPairs) landmarks[target] = points[source];
  return { landmarks: [landmarks] };
}
