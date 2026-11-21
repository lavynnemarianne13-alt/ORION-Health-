export type PoseLandmark = { x: number; y: number; visibility?: number };
export type PoseDetection = { class: string; confidence: number; box: [number, number, number, number] };
export type PoseResult = { landmarks: PoseLandmark[][]; detection?: PoseDetection | null };
export type PoseDetector = {
  landmarksVersion: string;
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => PoseResult | Promise<PoseResult>;
  close: () => void;
};

const poseEdges: [number, number][] = [
  [11,12], [11,13], [13,15], [12,14], [14,16],
  [11,23], [12,24], [23,24], [23,25], [25,27],
  [24,26], [26,28], [27,29], [28,30]
];

function visible(point: PoseLandmark | undefined): point is PoseLandmark {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 0) >= 0.55;
}

/** Planar (2D) joint angle, not a clinical range-of-motion measurement. */
export function angle2D(points: PoseLandmark[], first: number, joint: number, last: number): number | null {
  const a = points[first], b = points[joint], c = points[last];
  if (!visible(a) || !visible(b) || !visible(c)) return null;
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const denominator = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (denominator < 0.000001) return null;
  const cosine = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / denominator));
  return Math.round(Math.acos(cosine) * 180 / Math.PI);
}

export function poseMetrics(points: PoseLandmark[], frameAspectRatio: number) {
  // Convert both axes to units of frame height before measuring an angle.
  const projected = points.map(point => ({ ...point, x: point.x * frameAspectRatio }));
  const leftKnee = angle2D(projected, 23, 25, 27);
  const rightKnee = angle2D(projected, 24, 26, 28);
  const leftElbow = angle2D(projected, 11, 13, 15);
  const rightElbow = angle2D(projected, 12, 14, 16);
  // Shoulder elevation (hip–shoulder–elbow), 2D projection only.
  const leftShoulder = angle2D(projected, 23, 11, 13);
  const rightShoulder = angle2D(projected, 24, 12, 14);
  const viewable = points.filter(point => visible(point));
  const averageVisibility = viewable.length ? viewable.reduce((sum, point) => sum + (point.visibility ?? 1), 0) / viewable.length : null;
  return { leftKnee, rightKnee, leftElbow, rightElbow, leftShoulder, rightShoulder, averageVisibility, visiblePoints: viewable.length };
}

export function clearPoseOverlay(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function drawPoseOverlay(canvas: HTMLCanvasElement, video: HTMLVideoElement, points: PoseLandmark[], color = '#71d7ff', detection?: PoseDetection | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !video.videoWidth || !video.videoHeight) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  const dx = (width - video.videoWidth * scale) / 2;
  const dy = (height - video.videoHeight * scale) / 2;
  const position = (point: PoseLandmark) => ({ x: dx + point.x * video.videoWidth * scale, y: dy + point.y * video.videoHeight * scale });
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (const [a, b] of poseEdges) {
    if (!visible(points[a]) || !visible(points[b])) continue;
    const p = position(points[a]), q = position(points[b]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
  }
  ctx.fillStyle = color;
  if (detection) {
    const [left, top, right, bottom] = detection.box;
    const a = position({ x: left, y: top });
    const b = position({ x: right, y: bottom });
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.font = '12px sans-serif';
    ctx.fillText(`${detection.class} ${Math.round(detection.confidence * 100)}%`, a.x, Math.max(14, a.y - 4));
  }
  points.forEach((point, index) => {
    if (index < 11 || !visible(point)) return;
    const p = position(point);
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, 2 * Math.PI); ctx.fill();
  });
}
