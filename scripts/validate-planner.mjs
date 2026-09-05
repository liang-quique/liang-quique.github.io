import assert from "node:assert/strict";
import {
  buildAdaptiveSchedule,
  getMealInterruption,
  getMealInterruptionAtTaskBoundary,
  startMealBreak,
} from "../src/planner.ts";

function at(hours, minutes) {
  return new Date(2026, 6, 26, hours, minutes, 0, 0).getTime();
}

function makeTask(id, durationMinutes) {
  return {
    id,
    title: id,
    durationMinutes,
    details: "",
  };
}

function makeState(startTime, durations, now = at(9, 0)) {
  const tasks = durations.map((duration, index) =>
    makeTask(`T${index + 1}`, duration),
  );
  return {
    plan: {
      dateKey: "2026-07-26",
      startTime,
      tasks,
    },
    waitingForStart: false,
    completedTaskIds: [],
    activeTaskId: tasks[0]?.id ?? null,
    timer: {
      elapsedSeconds: 0,
      runningSince: now,
      isRunning: true,
    },
    taskTimings: tasks[0]
      ? {
          [tasks[0].id]: {
            startedAt: now,
            completedAt: null,
          },
        }
      : {},
    breaks: [],
    activeBreakId: null,
    focusCycle: {
      accumulatedSeconds: 0,
      taskBaselineSeconds: 0,
    },
  };
}

function compactSchedule(state, now) {
  return buildAdaptiveSchedule(state, now).map((entry) => {
    if (entry.reason === "lunch") return `L${entry.durationMinutes}`;
    if (entry.reason === "dinner") return `D${entry.durationMinutes}`;
    if (entry.kind === "break") return `R${entry.durationMinutes}`;
    return `T${entry.durationMinutes}`;
  });
}

assert.deepEqual(
  compactSchedule(makeState("09:00", [120]), at(9, 0)),
  ["T60", "R15", "T60"],
  "120 分钟长任务应在约 60 分钟处休息，并保持在 45–75 分钟窗口内",
);

assert.deepEqual(
  compactSchedule(makeState("09:00", [75]), at(9, 0)),
  ["T75"],
  "75 分钟任务允许在最长专注窗口内一次完成",
);

assert.deepEqual(
  compactSchedule(makeState("09:00", [76]), at(9, 0)),
  ["T60", "R15", "T16"],
  "超过 75 分钟的任务必须拆分并安排休息",
);

assert.deepEqual(
  compactSchedule(makeState("09:00", [30, 20, 30]), at(9, 0)),
  ["T30", "T20", "R10", "T30"],
  "累计专注达到 45 分钟后，应优先在任务边界休息",
);

assert.deepEqual(
  compactSchedule(makeState("11:00", [120], at(11, 0)), at(11, 0)),
  ["T60", "L90", "T60"],
  "跨越午饭时段的长任务必须被午饭中断",
);

assert.deepEqual(
  compactSchedule(
    makeState("11:20", [30, 30], at(11, 20)),
    at(11, 20),
  ),
  ["T30", "L90", "T30"],
  "11:50 的任务边界应允许午饭提前 10 分钟开始",
);

assert.deepEqual(
  compactSchedule(
    makeState("11:30", [35, 30], at(11, 30)),
    at(11, 30),
  ),
  ["T35", "L90", "T30"],
  "12:05 的任务边界应允许午饭推迟 5 分钟开始",
);

assert.deepEqual(
  compactSchedule(makeState("17:00", [90], at(17, 0)), at(17, 0)),
  ["T30", "D90", "T60"],
  "跨越晚饭时段的任务必须在 17:30 中断",
);

const noonState = makeState("11:00", [120], at(11, 0));
const noonInterruption = getMealInterruption(noonState, at(12, 0));
assert.ok(noonInterruption, "到达午饭时间时应生成运行时中断");
assert.equal(noonInterruption.startAt, at(12, 0));
assert.equal(noonInterruption.endAt, at(13, 30));
const pausedForLunch = startMealBreak(noonState, noonInterruption);
assert.equal(pausedForLunch.timer.elapsedSeconds, 60 * 60);
assert.equal(pausedForLunch.timer.isRunning, false);

const nearBoundaryState = {
  ...makeState("11:00", [65, 30], at(11, 0)),
  timer: {
    elapsedSeconds: 60 * 60,
    runningSince: at(12, 0),
    isRunning: true,
  },
};
assert.equal(
  getMealInterruption(nearBoundaryState, at(12, 0)),
  null,
  "任务能在 10 分钟浮动范围内结束时不应立刻打断",
);
const interruptionAtExpectedEnd = getMealInterruption(
  nearBoundaryState,
  at(12, 5),
);
assert.ok(interruptionAtExpectedEnd);
assert.equal(interruptionAtExpectedEnd.startAt, at(12, 5));
assert.equal(interruptionAtExpectedEnd.endAt, at(13, 35));

const boundaryState = {
  ...nearBoundaryState,
  activeTaskId: "T2",
  completedTaskIds: ["T1"],
  timer: {
    elapsedSeconds: 0,
    runningSince: null,
    isRunning: false,
  },
};
const shiftedLunch = getMealInterruptionAtTaskBoundary(
  boundaryState,
  at(12, 5),
);
assert.ok(shiftedLunch);
assert.equal(shiftedLunch.startAt, at(12, 5));
assert.equal(shiftedLunch.endAt, at(13, 35));

console.log("Planner validation passed: 12 scenarios.");
