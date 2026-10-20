import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceTiming, newSessionTiming, sessionDurations } from '../src/index.ts';

test('timing separates work, human waiting and idle without counting transitions twice', () => {
  const t = newSessionTiming(1000);
  advanceTiming(t, 'idle', 1000);
  advanceTiming(t, 'thinking', 3000);
  advanceTiming(t, 'working', 8000);
  advanceTiming(t, 'waiting', 18000);
  advanceTiming(t, 'asking', 22000);
  advanceTiming(t, 'thinking', 25000);
  advanceTiming(t, 'idle', 30000);
  assert.deepEqual(sessionDurations(t, 34000), {
    lifeMs: 33000, workMs: 20000, waitMs: 7000, idleMs: 6000, unobservedMs: 0,
  });
  const copy = structuredClone(t);
  sessionDurations(t, 40000);
  assert.deepEqual(t, copy);
});

test('end freezes lifetime; resuming and paused observation leave a visible gap', () => {
  const t = newSessionTiming(1000);
  advanceTiming(t, 'working', 1000);
  advanceTiming(t, 'ended', 6000);
  advanceTiming(t, 'ended', 9000);
  assert.equal(sessionDurations(t, 20000).lifeMs, 5000);
  advanceTiming(t, 'thinking', 16000);
  assert.deepEqual(sessionDurations(t, 19000), {
    lifeMs: 18000, workMs: 8000, waitMs: 0, idleMs: 0, unobservedMs: 10000,
  });
  advanceTiming(t, undefined, 20000);
  advanceTiming(t, 'working', 25000);
  assert.equal(sessionDurations(t, 28000).unobservedMs, 15000);
});

test('clock rollback never creates negative durations or double-counts an interval', () => {
  const t = newSessionTiming(10000);
  advanceTiming(t, 'working', 10000);
  advanceTiming(t, 'working', 15000);
  advanceTiming(t, 'working', 12000);
  assert.equal(sessionDurations(t, 13000).workMs, 5000);
  advanceTiming(t, 'idle', 17000);
  assert.equal(t.workMs, 7000);
});
