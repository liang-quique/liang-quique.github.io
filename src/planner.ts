export interface PlannerTask {
  id: string;
  title: string;
  durationMinutes: number;
  details: string;
}

export interface DayPlan {
  dateKey: string;
  startTime: string;
  tasks: PlannerTask[];
}

export interface TimerState {
  elapsedSeconds: number;
  runningSince: number | null;
  isRunning: boolean;
}

export interface TaskTiming {
  startedAt: number;
  completedAt: number | null;
}

export type AdaptiveBreakReason = "task-boundary" | "long-task";
export type MealBreakReason = "lunch" | "dinner";
export type BreakReason = AdaptiveBreakReason | MealBreakReason;

export interface BreakRecord {
  id: string;
  durationMinutes: number;
  startedAt: number;
  completedAt: number | null;
  reason: BreakReason;
  contextTaskId: string | null;
}

export interface FocusCycle {
  accumulatedSeconds: number;
  taskBaselineSeconds: number;
}

export interface PlannerState {
  plan: DayPlan | null;
  waitingForStart: boolean;
  completedTaskIds: string[];
  activeTaskId: string | null;
  timer: TimerState;
  taskTimings: Record<string, TaskTiming>;
  breaks: BreakRecord[];
  activeBreakId: string | null;
  focusCycle: FocusCycle;
}

export interface ScheduleEntry {
  task: PlannerTask;
  startAt: number;
  endAt: number;
}

export interface AdaptiveScheduleEntry {
  id: string;
  kind: "task" | "break";
  task: PlannerTask | null;
  startAt: number;
  endAt: number;
  durationMinutes: number;
  status: "completed" | "active" | "upcoming";
  reason?: BreakReason;
  continuation?: boolean;
}

const STORAGE_KEY = "dayline.web.planner.v1";
const MIN_FOCUS_SECONDS = 45 * 60;
const TARGET_FOCUS_SECONDS = 60 * 60;
const MAX_FOCUS_SECONDS = 75 * 60;
const MEAL_START_FLEX_MINUTES = 10;

interface MealDefinition {
  reason: MealBreakReason;
  label: string;
  startMinutes: number;
  endMinutes: number;
}

export interface MealWindow {
  reason: MealBreakReason;
  label: string;
  nominalStartAt: number;
  nominalEndAt: number;
  earliestStartAt: number;
  latestStartAt: number;
}

export interface MealInterruption {
  reason: MealBreakReason;
  startAt: number;
  endAt: number;
  durationMinutes: number;
}

const MEAL_DEFINITIONS: MealDefinition[] = [
  {
    reason: "lunch",
    label: "午饭",
    startMinutes: 12 * 60,
    endMinutes: 13 * 60 + 30,
  },
  {
    reason: "dinner",
    label: "晚饭",
    startMinutes: 17 * 60 + 30,
    endMinutes: 19 * 60,
  },
];

export function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getSuggestedStartTime(date = new Date()) {
  const rounded = new Date(date);
  rounded.setMinutes(Math.ceil(rounded.getMinutes() / 5) * 5, 0, 0);
  return `${String(rounded.getHours()).padStart(2, "0")}:${String(
    rounded.getMinutes(),
  ).padStart(2, "0")}`;
}

function getTimestampAtMinutes(dateKey: string, minutesAfterMidnight: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const hours = Math.floor(minutesAfterMidnight / 60);
  const minutes = minutesAfterMidnight % 60;
  return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
}

export function getMealWindows(dateKey: string): MealWindow[] {
  return MEAL_DEFINITIONS.map((definition) => {
    const nominalStartAt = getTimestampAtMinutes(
      dateKey,
      definition.startMinutes,
    );
    const nominalEndAt = getTimestampAtMinutes(dateKey, definition.endMinutes);
    return {
      reason: definition.reason,
      label: definition.label,
      nominalStartAt,
      nominalEndAt,
      earliestStartAt:
        nominalStartAt - MEAL_START_FLEX_MINUTES * 60_000,
      latestStartAt:
        nominalStartAt + MEAL_START_FLEX_MINUTES * 60_000,
    };
  });
}

export function isMealBreakReason(
  reason: BreakReason | undefined,
): reason is MealBreakReason {
  return reason === "lunch" || reason === "dinner";
}

export function getBreakLabel(reason: BreakReason | undefined) {
  if (reason === "lunch") return "午饭";
  if (reason === "dinner") return "晚饭";
  return "休息";
}

export function createEmptyState(): PlannerState {
  return {
    plan: null,
    waitingForStart: false,
    completedTaskIds: [],
    activeTaskId: null,
    timer: {
      elapsedSeconds: 0,
      runningSince: null,
      isRunning: false,
    },
    taskTimings: {},
    breaks: [],
    activeBreakId: null,
    focusCycle: {
      accumulatedSeconds: 0,
      taskBaselineSeconds: 0,
    },
  };
}

export function loadPlannerState(): PlannerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyState();

    const parsed = JSON.parse(raw) as PlannerState;
    if (parsed.plan?.dateKey !== getDateKey()) return createEmptyState();
    return {
      ...parsed,
      waitingForStart: parsed.waitingForStart ?? false,
      taskTimings: parsed.taskTimings ?? {},
      breaks: parsed.breaks ?? [],
      activeBreakId: parsed.activeBreakId ?? null,
      focusCycle: parsed.focusCycle ?? {
        accumulatedSeconds: 0,
        taskBaselineSeconds: 0,
      },
    };
  } catch {
    return createEmptyState();
  }
}

export function savePlannerState(state: PlannerState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getPlanStartAt(plan: DayPlan) {
  const [year, month, day] = plan.dateKey.split("-").map(Number);
  const [hours, minutes] = plan.startTime.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
}

export function buildSchedule(
  plan: DayPlan,
  taskTimings: Record<string, TaskTiming>,
): ScheduleEntry[] {
  let cursor = getPlanStartAt(plan);

  return plan.tasks.map((task) => {
    const timing = taskTimings[task.id];
    const startAt = timing?.startedAt ?? cursor;
    const endAt = timing?.completedAt ?? startAt + task.durationMinutes * 60_000;
    const entry = {
      task,
      startAt,
      endAt,
    };
    cursor = entry.endAt;
    return entry;
  });
}

export function formatTimestampAsTime(timestamp: number) {
  const date = new Date(timestamp);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatCountdown(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const totalMinutes = safeSeconds === 0 ? 0 : Math.ceil(safeSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return [hours, minutes]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分` : `${hours} 小时`;
}

export function getElapsedSeconds(timer: TimerState, now: number) {
  const liveSeconds =
    timer.isRunning && timer.runningSince
      ? Math.floor((now - timer.runningSince) / 1000)
      : 0;
  return timer.elapsedSeconds + Math.max(0, liveSeconds);
}

export function getActiveBreak(state: PlannerState) {
  return (
    state.breaks.find((item) => item.id === state.activeBreakId) ?? null
  );
}

export function getFocusCycleSeconds(state: PlannerState, now: number) {
  const taskSeconds = getElapsedSeconds(state.timer, now);
  return (
    state.focusCycle.accumulatedSeconds +
    Math.max(0, taskSeconds - state.focusCycle.taskBaselineSeconds)
  );
}

export function chooseBreakDuration(
  focusSeconds: number,
  reason: AdaptiveBreakReason,
) {
  return reason === "long-task" || focusSeconds >= 65 * 60 ? 15 : 10;
}

export function startAdaptiveBreak(
  state: PlannerState,
  now: number,
  reason: AdaptiveBreakReason,
): PlannerState {
  if (!state.plan || !state.activeTaskId || state.activeBreakId) return state;

  const elapsedSeconds = getElapsedSeconds(state.timer, now);
  const focusSeconds = getFocusCycleSeconds(state, now);
  const durationMinutes = chooseBreakDuration(focusSeconds, reason);
  const breakRecord: BreakRecord = {
    id: crypto.randomUUID(),
    durationMinutes,
    startedAt: now,
    completedAt: null,
    reason,
    contextTaskId: state.activeTaskId,
  };

  return {
    ...state,
    breaks: [...state.breaks, breakRecord],
    activeBreakId: breakRecord.id,
    timer: {
      elapsedSeconds,
      runningSince: null,
      isRunning: false,
    },
  };
}

function hasRecordedMeal(state: PlannerState, reason: MealBreakReason) {
  return state.breaks.some((item) => item.reason === reason);
}

function createMealInterruption(
  window: MealWindow,
  startAt: number,
  preserveFullDuration = true,
): MealInterruption {
  const boundedShift = Math.max(
    -MEAL_START_FLEX_MINUTES * 60_000,
    Math.min(
      MEAL_START_FLEX_MINUTES * 60_000,
      startAt - window.nominalStartAt,
    ),
  );
  const shiftedEndAt = window.nominalEndAt + boundedShift;
  const endAt = preserveFullDuration
    ? shiftedEndAt
    : Math.max(startAt + 60_000, window.nominalEndAt);
  return {
    reason: window.reason,
    startAt,
    endAt,
    durationMinutes: Math.max(1, Math.ceil((endAt - startAt) / 60_000)),
  };
}

export function getMealInterruption(
  state: PlannerState,
  now: number,
): MealInterruption | null {
  if (
    !state.plan ||
    !state.activeTaskId ||
    state.waitingForStart ||
    state.activeBreakId
  ) {
    return null;
  }

  const activeTask = state.plan.tasks.find(
    (task) => task.id === state.activeTaskId,
  );
  if (!activeTask) return null;

  const remainingSeconds = Math.max(
    0,
    activeTask.durationMinutes * 60 - getElapsedSeconds(state.timer, now),
  );

  for (const window of getMealWindows(state.plan.dateKey)) {
    if (
      hasRecordedMeal(state, window.reason) ||
      now < window.nominalStartAt ||
      now >= window.nominalEndAt
    ) {
      continue;
    }

    const canReachTaskBoundaryWithinFlex =
      state.timer.isRunning &&
      now < window.latestStartAt &&
      remainingSeconds > 0 &&
      now + remainingSeconds * 1000 <= window.latestStartAt;
    if (canReachTaskBoundaryWithinFlex) continue;

    if (remainingSeconds === 0 && now <= window.latestStartAt) {
      return createMealInterruption(window, now);
    }

    return createMealInterruption(window, window.nominalStartAt);
  }

  return null;
}

export function getMealInterruptionAtTaskBoundary(
  state: PlannerState,
  completedAt: number,
): MealInterruption | null {
  if (!state.plan || !state.activeTaskId || state.activeBreakId) return null;

  for (const window of getMealWindows(state.plan.dateKey)) {
    if (hasRecordedMeal(state, window.reason)) continue;

    if (
      completedAt >= window.earliestStartAt &&
      completedAt <= window.latestStartAt
    ) {
      return createMealInterruption(window, completedAt);
    }

    if (
      completedAt > window.latestStartAt &&
      completedAt < window.nominalEndAt
    ) {
      return createMealInterruption(window, completedAt, false);
    }
  }

  return null;
}

export function startMealBreak(
  state: PlannerState,
  interruption: MealInterruption,
): PlannerState {
  if (
    !state.plan ||
    !state.activeTaskId ||
    state.activeBreakId ||
    hasRecordedMeal(state, interruption.reason)
  ) {
    return state;
  }

  const breakRecord: BreakRecord = {
    id: crypto.randomUUID(),
    durationMinutes: interruption.durationMinutes,
    startedAt: interruption.startAt,
    completedAt: null,
    reason: interruption.reason,
    contextTaskId: state.activeTaskId,
  };

  return {
    ...state,
    breaks: [...state.breaks, breakRecord],
    activeBreakId: breakRecord.id,
    timer: {
      elapsedSeconds: getElapsedSeconds(
        state.timer,
        interruption.startAt,
      ),
      runningSince: null,
      isRunning: false,
    },
  };
}

export function finishAdaptiveBreak(state: PlannerState, now: number) {
  const activeBreak = getActiveBreak(state);
  if (!state.plan || !state.activeTaskId || !activeBreak) return state;

  const activeTiming = state.taskTimings[state.activeTaskId];
  return {
    ...state,
    breaks: state.breaks.map((item) =>
      item.id === activeBreak.id ? { ...item, completedAt: now } : item,
    ),
    activeBreakId: null,
    taskTimings: activeTiming
      ? state.taskTimings
      : {
          ...state.taskTimings,
          [state.activeTaskId]: {
            startedAt: now,
            completedAt: null,
          },
        },
    focusCycle: {
      accumulatedSeconds: 0,
      taskBaselineSeconds: state.timer.elapsedSeconds,
    },
    timer: {
      ...state.timer,
      runningSince: now,
      isRunning: true,
    },
  };
}

export function startWaitingPlan(
  state: PlannerState,
  startedAt: number,
): PlannerState {
  if (!state.plan || !state.waitingForStart || !state.activeTaskId) {
    return state;
  }

  return {
    ...state,
    waitingForStart: false,
    taskTimings: {
      ...state.taskTimings,
      [state.activeTaskId]: {
        startedAt,
        completedAt: null,
      },
    },
    timer: {
      elapsedSeconds: 0,
      runningSince: startedAt,
      isRunning: true,
    },
  };
}

export function shouldStartMidTaskBreak(state: PlannerState, now: number) {
  if (!state.plan || !state.activeTaskId || state.activeBreakId) return false;
  const activeTask = state.plan.tasks.find(
    (task) => task.id === state.activeTaskId,
  );
  if (!activeTask || !state.timer.isRunning) return false;

  const elapsedSeconds = getElapsedSeconds(state.timer, now);
  const remainingSeconds = Math.max(
    0,
    activeTask.durationMinutes * 60 - elapsedSeconds,
  );
  const mealIsApproaching = getMealWindows(state.plan.dateKey).some(
    (window) =>
      !hasRecordedMeal(state, window.reason) &&
      now >= window.earliestStartAt &&
      now < window.nominalEndAt,
  );
  return (
    !mealIsApproaching &&
    getFocusCycleSeconds(state, now) >= TARGET_FOCUS_SECONDS &&
    remainingSeconds > 15 * 60
  );
}

function forecastBreakMinutes(
  focusSeconds: number,
  reason: AdaptiveBreakReason,
) {
  return chooseBreakDuration(focusSeconds, reason);
}

function getForecastMealAtBoundary(
  mealWindows: MealWindow[],
  scheduledReasons: Set<MealBreakReason>,
  cursor: number,
) {
  for (const window of mealWindows) {
    if (
      scheduledReasons.has(window.reason) ||
      cursor < window.earliestStartAt ||
      cursor >= window.nominalEndAt
    ) {
      continue;
    }

    if (cursor <= window.latestStartAt) {
      return createMealInterruption(window, cursor);
    }

    return createMealInterruption(window, cursor, false);
  }

  return null;
}

function getForecastMealConflict(
  mealWindows: MealWindow[],
  scheduledReasons: Set<MealBreakReason>,
  cursor: number,
  candidateEnd: number,
) {
  for (const window of mealWindows) {
    if (
      scheduledReasons.has(window.reason) ||
      candidateEnd < window.earliestStartAt ||
      cursor >= window.nominalEndAt
    ) {
      continue;
    }

    if (
      candidateEnd >= window.earliestStartAt &&
      candidateEnd <= window.latestStartAt
    ) {
      return null;
    }

    if (candidateEnd > window.latestStartAt) {
      return createMealInterruption(window, window.nominalStartAt);
    }
  }

  return null;
}

function mealStartIsApproaching(
  mealWindows: MealWindow[],
  scheduledReasons: Set<MealBreakReason>,
  cursor: number,
) {
  return mealWindows.some(
    (window) =>
      !scheduledReasons.has(window.reason) &&
      cursor >= window.earliestStartAt &&
      cursor < window.nominalEndAt,
  );
}

export function buildAdaptiveSchedule(
  state: PlannerState,
  now: number,
): AdaptiveScheduleEntry[] {
  if (!state.plan) return [];

  const entries: AdaptiveScheduleEntry[] = [];
  const includedBreakIds = new Set<string>();

  for (const task of state.plan.tasks) {
    if (!state.completedTaskIds.includes(task.id)) continue;
    const timing = state.taskTimings[task.id];
    if (!timing?.completedAt) continue;

    const internalBreaks = state.breaks
      .filter(
        (item) =>
          item.contextTaskId === task.id &&
          item.completedAt &&
          item.startedAt >= timing.startedAt &&
          item.startedAt <= timing.completedAt!,
      )
      .sort((a, b) => a.startedAt - b.startedAt);
    let cursor = timing.startedAt;

    internalBreaks.forEach((item, index) => {
      if (item.startedAt > cursor) {
        entries.push({
          id: `${task.id}-history-${index}`,
          kind: "task",
          task,
          startAt: cursor,
          endAt: item.startedAt,
          durationMinutes: Math.max(1, Math.round((item.startedAt - cursor) / 60_000)),
          status: "completed",
          continuation: index > 0,
        });
      }
      entries.push({
        id: item.id,
        kind: "break",
        task: null,
        startAt: item.startedAt,
        endAt: item.completedAt!,
        durationMinutes: item.durationMinutes,
        status: "completed",
        reason: item.reason,
      });
      includedBreakIds.add(item.id);
      cursor = item.completedAt!;
    });

    if (timing.completedAt > cursor) {
      entries.push({
        id: `${task.id}-history-final`,
        kind: "task",
        task,
        startAt: cursor,
        endAt: timing.completedAt,
        durationMinutes: Math.max(1, Math.round((timing.completedAt - cursor) / 60_000)),
        status: "completed",
        continuation: internalBreaks.length > 0,
      });
    }
  }

  for (const item of state.breaks) {
    if (!item.completedAt || includedBreakIds.has(item.id)) continue;
    entries.push({
      id: item.id,
      kind: "break",
      task: null,
      startAt: item.startedAt,
      endAt: item.completedAt,
      durationMinutes: item.durationMinutes,
      status: "completed",
      reason: item.reason,
    });
  }
  entries.sort((a, b) => a.startAt - b.startAt);

  const activeTaskIndex = state.plan.tasks.findIndex(
    (task) => task.id === state.activeTaskId,
  );
  if (activeTaskIndex < 0) return entries;

  const activeBreak = getActiveBreak(state);
  let cursor = state.waitingForStart ? getPlanStartAt(state.plan) : now;
  let focusSeconds = activeBreak ? 0 : getFocusCycleSeconds(state, now);
  let firstForecastEntry = true;
  const mealWindows = getMealWindows(state.plan.dateKey);
  const scheduledMealReasons = new Set<MealBreakReason>(
    state.breaks
      .filter((item) => isMealBreakReason(item.reason))
      .map((item) => item.reason as MealBreakReason),
  );

  function appendForecastMeal(interruption: MealInterruption) {
    entries.push({
      id: `forecast-meal-${interruption.reason}`,
      kind: "break",
      task: null,
      startAt: interruption.startAt,
      endAt: interruption.endAt,
      durationMinutes: interruption.durationMinutes,
      status:
        !state.waitingForStart &&
        interruption.startAt <= now &&
        now < interruption.endAt
          ? "active"
          : "upcoming",
      reason: interruption.reason,
    });
    scheduledMealReasons.add(interruption.reason);
    cursor = Math.max(cursor, interruption.endAt);
    focusSeconds = 0;
    firstForecastEntry = false;
  }

  if (activeBreak) {
    const plannedEnd = activeBreak.startedAt + activeBreak.durationMinutes * 60_000;
    entries.push({
      id: activeBreak.id,
      kind: "break",
      task: null,
      startAt: activeBreak.startedAt,
      endAt: plannedEnd,
      durationMinutes: activeBreak.durationMinutes,
      status: "active",
      reason: activeBreak.reason,
    });
    includedBreakIds.add(activeBreak.id);
    if (isMealBreakReason(activeBreak.reason)) {
      scheduledMealReasons.add(activeBreak.reason);
    }
    cursor = Math.max(now, plannedEnd);
    firstForecastEntry = false;
  }

  for (let index = activeTaskIndex; index < state.plan.tasks.length; index += 1) {
    const task = state.plan.tasks[index];
    let remainingSeconds =
      index === activeTaskIndex
        ? Math.max(0, task.durationMinutes * 60 - getElapsedSeconds(state.timer, now))
        : task.durationMinutes * 60;
    let segmentIndex = 0;

    while (remainingSeconds > 0) {
      const isOngoingActiveSegment =
        index === activeTaskIndex &&
        segmentIndex === 0 &&
        !activeBreak &&
        !state.waitingForStart &&
        getElapsedSeconds(state.timer, now) > 0;
      const mealAtBoundary = isOngoingActiveSegment
        ? null
        : getForecastMealAtBoundary(
            mealWindows,
            scheduledMealReasons,
            cursor,
          );
      if (mealAtBoundary) {
        appendForecastMeal(mealAtBoundary);
        continue;
      }

      if (
        focusSeconds >= TARGET_FOCUS_SECONDS &&
        remainingSeconds > 15 * 60 &&
        !mealStartIsApproaching(
          mealWindows,
          scheduledMealReasons,
          cursor,
        )
      ) {
        const durationMinutes = forecastBreakMinutes(focusSeconds, "long-task");
        entries.push({
          id: `forecast-break-${task.id}-${segmentIndex}`,
          kind: "break",
          task: null,
          startAt: cursor,
          endAt: cursor + durationMinutes * 60_000,
          durationMinutes,
          status: "upcoming",
          reason: "long-task",
        });
        cursor += durationMinutes * 60_000;
        focusSeconds = 0;
      }

      const roomUntilMax = MAX_FOCUS_SECONDS - focusSeconds;
      const canFinishBeforeMax =
        remainingSeconds <= roomUntilMax || remainingSeconds <= 15 * 60;
      const segmentSeconds = canFinishBeforeMax
        ? remainingSeconds
        : Math.max(60, TARGET_FOCUS_SECONDS - focusSeconds);
      let actualSegmentSeconds = segmentSeconds;
      let segmentEnd = cursor + actualSegmentSeconds * 1000;
      const mealConflict = getForecastMealConflict(
        mealWindows,
        scheduledMealReasons,
        cursor,
        segmentEnd,
      );
      if (mealConflict && mealConflict.startAt <= cursor) {
        appendForecastMeal(mealConflict);
        continue;
      }
      if (mealConflict && mealConflict.startAt < segmentEnd) {
        segmentEnd = mealConflict.startAt;
        actualSegmentSeconds = Math.max(
          0,
          Math.round((segmentEnd - cursor) / 1000),
        );
      }
      if (actualSegmentSeconds <= 0) {
        if (mealConflict) {
          appendForecastMeal(mealConflict);
          continue;
        }
        break;
      }
      entries.push({
        id: `forecast-task-${task.id}-${segmentIndex}`,
        kind: "task",
        task,
        startAt: cursor,
        endAt: segmentEnd,
        durationMinutes: Math.max(
          1,
          Math.round(actualSegmentSeconds / 60),
        ),
        status:
          firstForecastEntry && !activeBreak && !state.waitingForStart
            ? "active"
            : "upcoming",
        continuation: segmentIndex > 0 || index === activeTaskIndex && getElapsedSeconds(state.timer, now) > 0,
      });
      firstForecastEntry = false;
      cursor = segmentEnd;
      focusSeconds += actualSegmentSeconds;
      remainingSeconds -= actualSegmentSeconds;
      segmentIndex += 1;

      if (remainingSeconds > 0) {
        const mealAtSplit = getForecastMealAtBoundary(
          mealWindows,
          scheduledMealReasons,
          cursor,
        );
        if (mealAtSplit) {
          appendForecastMeal(mealAtSplit);
          continue;
        }

        const durationMinutes = forecastBreakMinutes(focusSeconds, "long-task");
        entries.push({
          id: `forecast-break-${task.id}-${segmentIndex}`,
          kind: "break",
          task: null,
          startAt: cursor,
          endAt: cursor + durationMinutes * 60_000,
          durationMinutes,
          status: "upcoming",
          reason: "long-task",
        });
        cursor += durationMinutes * 60_000;
        focusSeconds = 0;
      }
    }

    const hasMoreTasks = index < state.plan.tasks.length - 1;
    const mealAtTaskBoundary = hasMoreTasks
      ? getForecastMealAtBoundary(
          mealWindows,
          scheduledMealReasons,
          cursor,
        )
      : null;
    if (mealAtTaskBoundary) {
      appendForecastMeal(mealAtTaskBoundary);
    }

    if (hasMoreTasks && focusSeconds >= MIN_FOCUS_SECONDS) {
      const durationMinutes = forecastBreakMinutes(focusSeconds, "task-boundary");
      entries.push({
        id: `forecast-boundary-${task.id}`,
        kind: "break",
        task: null,
        startAt: cursor,
        endAt: cursor + durationMinutes * 60_000,
        durationMinutes,
        status: "upcoming",
        reason: "task-boundary",
      });
      cursor += durationMinutes * 60_000;
      focusSeconds = 0;
    }
  }

  return entries;
}

export function extendActiveTask(
  state: PlannerState,
  taskId: string,
  extensionMinutes: number,
  resumedAt: number,
): PlannerState {
  if (!state.plan || state.activeTaskId !== taskId) return state;

  const activeTask = state.plan.tasks.find((task) => task.id === taskId);
  if (!activeTask) return state;

  const safeExtension = Math.max(1, Math.min(240, Math.round(extensionMinutes)));

  return {
    ...state,
    plan: {
      ...state.plan,
      tasks: state.plan.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              durationMinutes: task.durationMinutes + safeExtension,
            }
          : task,
      ),
    },
    timer: {
      elapsedSeconds: activeTask.durationMinutes * 60,
      runningSince: resumedAt,
      isRunning: true,
    },
  };
}
