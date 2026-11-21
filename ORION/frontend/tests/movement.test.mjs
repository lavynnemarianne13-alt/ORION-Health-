import assert from 'node:assert/strict';
import test from 'node:test';
import { ExerciseRepCounter } from '../src/components/movement/exerciseCounter.ts';
import { MovementAssessment } from '../src/components/movement/movementAssessment.ts';
import { mapOrionKeypoints } from '../src/components/movement/orionKeypoints.ts';

function assess(code, angles) {
  const counter = new ExerciseRepCounter(code, 'left');
  const assessment = new MovementAssessment();
  let frame = 0;
  for (const [angle, secondKnee] of angles) {
    for (let i = 0; i < 9; i++) {
      const metrics = angle === null ? null : {
        leftKnee: angle, rightKnee: secondKnee ?? angle,
        leftElbow: angle, rightElbow: angle,
        leftShoulder: angle, rightShoulder: angle, visiblePoints: 12,
      };
      assessment.update(code, metrics, counter.update(metrics, frame++ * 125));
    }
  }
  return assessment.report();
}

test('maps only anatomically matching Orion points and preserves their confidence', () => {
  const points = Array.from({ length: 15 }, (_, index) => ({ x: index / 15, y: 0.5, visibility: index / 15 }));
  const [mapped] = mapOrionKeypoints(points).landmarks;
  assert.equal(mapped.length, 33);
  assert.equal(mapped[11], points[1]);
  assert.equal(mapped[16], points[6]);
  assert.equal(mapped[25], points[9]);
  assert.equal(mapped[28], points[12]);
  assert.equal(mapped[0].visibility, 0);
  assert.equal(mapped[31].visibility, 0);
  assert.deepEqual(mapOrionKeypoints(points.slice(0, 14)).landmarks, []);
});

for (const [exercise, start, target, shallow] of [
  ['squat', 176, 91, 125],
  ['curl', 175, 64, 100],
  ['shoulder', 12, 82, 60],
  ['knee', 95, 174, 138],
]) {
  test(exercise + ' accepts a full simulated cycle and flags a short one', () => {
    const good = assess(exercise, [[start], [target], [start]]);
    assert.equal(good.repetitions, 1);
    assert.equal(good.valid_repetitions, 1);
    assert.deepEqual(good.feedback, []);
    const short = assess(exercise, [[start], [shallow], [start]]);
    assert.equal(short.repetitions, 1);
    assert.equal(short.valid_repetitions, 0);
    assert.deepEqual(short.feedback, ['range_or_tempo']);
  });
}

test('squat rule rejects an asymmetric bottom in a simulated cycle', () => {
  const result = assess('squat', [[176], [81, 105], [176]]);
  assert.equal(result.repetitions, 1);
  assert.equal(result.valid_repetitions, 0);
  assert.deepEqual(result.feedback, ['squat_asymmetry']);
});

test('a long tracking gap clears the unfinished cycle without creating an attempt', () => {
  const result = assess('squat', [[176], [91], [null], [176]]);
  assert.equal(result.repetitions, 0);
  assert.equal(result.valid_repetitions, 0);
  assert.ok(result.tracking_quality < 1);
});
