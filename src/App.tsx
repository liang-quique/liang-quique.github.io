import { isTauri } from "@tauri-apps/api/core";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
  primaryMonitor,
} from "@tauri-apps/api/window";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  buildAdaptiveSchedule,
  extendActiveTask,
  finishAdaptiveBreak,
  formatCountdown,
  formatDuration,
  formatTimestampAsTime,
  getBreakLabel,
  getDateKey,
  getElapsedSeconds,
  getActiveBreak,
  getFocusCycleSeconds,
  getMealInterruption,
  getMealInterruptionAtTaskBoundary,
  getPlanStartAt,
  getSuggestedStartTime,
  isMealBreakReason,
  loadPlannerState,
  savePlannerState,
  shouldStartMidTaskBreak,
  startAdaptiveBreak,
  startMealBreak,
  startWaitingPlan,
  type DayPlan,
  type PlannerState,
  type PlannerTask,
} from "./planner";

interface DraftTask {
  id: string;
  title: string;
  durationMinutes: string;
  details: string;
}

const EMPTY_DETAILS = "";
const MINI_WINDOW_WIDTH = 160;
const MINI_WINDOW_HEIGHT = 56;
const MINI_WINDOW_PEEK = 10;
const NORMAL_WINDOW_MIN_WIDTH = 1000;
const NORMAL_WINDOW_MIN_HEIGHT = 680;
const NORMAL_WINDOW_WIDTH = 1440;
const NORMAL_WINDOW_HEIGHT = 900;

interface NormalWindowState {
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
  maximized: boolean;
}

interface MiniWindowPlacement {
  shownX: number;
  hiddenX: number;
  y: number;
}

function waitForWindowFrame(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function getMiniWindowPlacement(
  size: PhysicalSize,
): Promise<MiniWindowPlacement | null> {
  const monitor = (await currentMonitor()) ?? (await primaryMonitor());
  if (!monitor) return null;

  const right = monitor.workArea.position.x + monitor.workArea.size.width;
  const y =
    monitor.workArea.position.y +
    Math.round((monitor.workArea.size.height - size.height) / 2);
  const peekWidth = Math.round(MINI_WINDOW_PEEK * monitor.scaleFactor);

  return {
    shownX: right - size.width,
    hiddenX: right - peekWidth,
    y,
  };
}

function makeId() {
  return crypto.randomUUID();
}

function makeDraftTask(): DraftTask {
  return {
    id: makeId(),
    title: "",
    durationMinutes: "45",
    details: EMPTY_DETAILS,
  };
}

function getDurationError(value: string) {
  if (!value.trim()) return "不能为空";

  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 1) return "至少 1 分钟";
  if (minutes > 480) return "最多 480 分钟";
  return "";
}

function PlanEditor({
  plan,
  onSave,
  onClose,
}: {
  plan: DayPlan | null;
  onSave: (startTime: string, tasks: PlannerTask[]) => void;
  onClose?: () => void;
}) {
  const [startTime, setStartTime] = useState(
    plan?.startTime ?? getSuggestedStartTime(),
  );
  const [drafts, setDrafts] = useState<DraftTask[]>(
    plan?.tasks.length
      ? plan.tasks.map((task) => ({
          ...task,
          durationMinutes: String(task.durationMinutes),
        }))
      : [makeDraftTask()],
  );
  const [error, setError] = useState("");
  const taskNameInputs = useRef(new Map<string, HTMLInputElement>());

  const totalMinutes = drafts.reduce(
    (total, task) => total + (Number(task.durationMinutes) || 0),
    0,
  );
  const startsLater =
    getPlanStartAt({
      dateKey: getDateKey(),
      startTime,
      tasks: [],
    }) > Date.now();

  function updateTask(id: string, patch: Partial<DraftTask>) {
    setError("");
    setDrafts((current) =>
      current.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    );
  }

  function insertTaskAt(index: number) {
    const task = makeDraftTask();
    setError("");
    setDrafts((current) => [
      ...current.slice(0, index),
      task,
      ...current.slice(index),
    ]);
    window.requestAnimationFrame(() => {
      taskNameInputs.current.get(task.id)?.focus();
    });
  }

  function moveTask(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= drafts.length) return;
    setDrafts((current) => {
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  function save() {
    const namedDrafts = drafts.filter((task) => task.title.trim());

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) { setError("请填写有效的计划开始时间。"); return; }
    if (!namedDrafts.length) {
      setError("至少填写一个任务名称，才能开始今天。");
      return;
    }

    if (namedDrafts.some((task) => getDurationError(task.durationMinutes))) {
      setError("请补全标有提示的任务时长。");
      return;
    }

    const cleaned = namedDrafts.map((task) => ({
        ...task,
        title: task.title.trim(),
        details: task.details.trim(),
        durationMinutes: Number(task.durationMinutes),
      }));

    setError("");
    onSave(startTime, cleaned);
  }

  return (
    <div className="editor-backdrop" role="dialog" aria-modal="true" aria-label="编辑今日计划">
      <section className="plan-editor">
        <header className="editor-header">
          <div>
            <p className="eyebrow">今日计划</p>
            <h1>{plan ? "调整今天的节奏" : "先把今天安放好"}</h1>
            <p className="editor-intro">
              写下要完成的事和预计时间。程序会自动安排 45–75 分钟专注周期，并为午饭和晚饭留出时间。
            </p>
          </div>
          {onClose && (
            <button className="icon-button close-button" onClick={onClose} aria-label="关闭">
              ×
            </button>
          )}
        </header>

        <div className="plan-meta">
          <label>
            <span>计划开始</span>
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>
          <div className="total-duration">
            <span>预计投入</span>
            <strong>{formatDuration(totalMinutes)}</strong>
          </div>
        </div>

        <div className="draft-list">
          <div className="draft-insert-row">
            <i aria-hidden="true" />
            <button
              type="button"
              onClick={() => insertTaskAt(0)}
              aria-label="在第一项之前添加任务"
              title="在第一项之前添加任务"
            >
              <span aria-hidden="true">＋</span> 在此添加
            </button>
            <i aria-hidden="true" />
          </div>
          {drafts.map((task, index) => (
            <Fragment key={task.id}>
              <article className="draft-card">
                <div className="draft-order">{String(index + 1).padStart(2, "0")}</div>
                <div className="draft-fields">
                  <label className="task-name-field">
                    <span>任务名称</span>
                    <input
                      ref={(element) => {
                        if (element) {
                          taskNameInputs.current.set(task.id, element);
                        } else {
                          taskNameInputs.current.delete(task.id);
                        }
                      }}
                      value={task.title}
                      placeholder="例如：完成数学作业"
                      onChange={(event) =>
                        updateTask(task.id, { title: event.target.value })
                      }
                    />
                  </label>
                  <label className="duration-field">
                    <span className="field-label-row">
                      <span>预计分钟</span>
                      {getDurationError(task.durationMinutes) && (
                        <small id={`duration-error-${task.id}`}>
                          {getDurationError(task.durationMinutes)}
                        </small>
                      )}
                    </span>
                    <input
                      type="number"
                      min="1"
                      max="480"
                      value={task.durationMinutes}
                      aria-label="预计分钟"
                      aria-invalid={Boolean(getDurationError(task.durationMinutes))}
                      aria-describedby={
                        getDurationError(task.durationMinutes)
                          ? `duration-error-${task.id}`
                          : undefined
                      }
                      onChange={(event) =>
                        updateTask(task.id, {
                          durationMinutes: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="details-field">
                    <span>具体内容</span>
                    <textarea
                      rows={4}
                      value={task.details}
                      placeholder="例如：完成第 3 章练习 1–12 题"
                      onChange={(event) =>
                        updateTask(task.id, { details: event.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="draft-actions" aria-label="调整任务顺序">
                  <button
                    className="icon-button"
                    disabled={index === 0}
                    onClick={() => moveTask(index, -1)}
                    aria-label="上移任务"
                  >
                    ↑
                  </button>
                  <button
                    className="icon-button"
                    disabled={index === drafts.length - 1}
                    onClick={() => moveTask(index, 1)}
                    aria-label="下移任务"
                  >
                    ↓
                  </button>
                  <button
                    className="icon-button remove-button"
                    disabled={drafts.length === 1}
                    onClick={() =>
                      setDrafts((current) =>
                        current.filter((item) => item.id !== task.id),
                      )
                    }
                    aria-label="删除任务"
                  >
                    ×
                  </button>
                </div>
              </article>
              <div className="draft-insert-row">
                <i aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => insertTaskAt(index + 1)}
                  aria-label={
                    index === drafts.length - 1
                      ? "在末尾添加任务"
                      : `在第 ${index + 2} 项之前添加任务`
                  }
                  title={
                    index === drafts.length - 1
                      ? "在末尾添加任务"
                      : `在第 ${index + 2} 项之前添加任务`
                  }
                >
                  <span aria-hidden="true">＋</span> 在此添加
                </button>
                <i aria-hidden="true" />
              </div>
            </Fragment>
          ))}
        </div>

        <footer className="editor-footer">
          <p className={error ? "form-message error" : "form-message"}>
            {error || (startsLater
              ? `计划将在 ${startTime} 自动开始，也可以稍后手动提前开始。`
              : "计划会立即开始，后续时间、休息和饭点将按实际进度调整。")}
          </p>
          <button className="primary-button start-button" onClick={save}>
            {startsLater
              ? plan
                ? "保存并等待开始"
                : "创建并等待开始"
              : plan
                ? "保存并立即开始"
                : "立即开始今天"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function App() {
  const [planner, setPlanner] = useState<PlannerState>(() => loadPlannerState());
  const [now, setNow] = useState(() => Date.now());
  const [editorOpen, setEditorOpen] = useState(() => !loadPlannerState().plan);
  const [timeUpPromptOpen, setTimeUpPromptOpen] = useState(false);
  const [extensionMinutes, setExtensionMinutes] = useState(15);
  const [miniMode, setMiniMode] = useState(false);
  const [miniRevealed, setMiniRevealed] = useState(false);
  const normalWindowState = useRef<NormalWindowState | null>(null);
  const miniAnimationToken = useRef(0);
  const miniHideTimer = useRef<number | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    try { savePlannerState(planner); } catch { window.dispatchEvent(new Event("dayline-storage-error")); }
  }, [planner]);

  useEffect(() => {
    document.documentElement.classList.toggle("mini-mode", miniMode);
    return () => document.documentElement.classList.remove("mini-mode");
  }, [miniMode]);

  useEffect(() => {
    return () => {
      miniAnimationToken.current += 1;
      if (miniHideTimer.current !== null) {
        window.clearTimeout(miniHideTimer.current);
      }
    };
  }, []);

  const activeTask =
    planner.plan?.tasks.find((task) => task.id === planner.activeTaskId) ?? null;
  const activeBreak = getActiveBreak(planner);
  const scheduledStartAt = planner.plan ? getPlanStartAt(planner.plan) : null;
  const waitingSeconds =
    planner.waitingForStart && scheduledStartAt
      ? Math.max(0, Math.ceil((scheduledStartAt - now) / 1000))
      : 0;
  const elapsedSeconds = getElapsedSeconds(planner.timer, now);
  const remainingSeconds = activeTask
    ? Math.max(0, activeTask.durationMinutes * 60 - elapsedSeconds)
    : 0;

  useEffect(() => {
    if (
      !planner.waitingForStart ||
      !scheduledStartAt ||
      now < scheduledStartAt
    ) return;

    const startedAt = Date.now();
    setPlanner((current) => {
      const startedState = startWaitingPlan(current, startedAt);
      const mealInterruption = getMealInterruptionAtTaskBoundary(
        startedState,
        startedAt,
      );
      return mealInterruption
        ? startMealBreak(startedState, mealInterruption)
        : startedState;
    });
    setNow(startedAt);
  }, [now, planner.waitingForStart, scheduledStartAt]);
  const breakRemainingSeconds = activeBreak
    ? Math.max(
        0,
        activeBreak.durationMinutes * 60 -
          Math.floor((now - activeBreak.startedAt) / 1000),
      )
    : 0;
  const activeMeal = activeBreak && isMealBreakReason(activeBreak.reason)
    ? activeBreak
    : null;
  const pendingMealInterruption = getMealInterruption(planner, now);

  useEffect(() => {
    if (!pendingMealInterruption) return;
    setTimeUpPromptOpen(false);
    setPlanner((current) =>
      startMealBreak(current, pendingMealInterruption),
    );
  }, [pendingMealInterruption]);

  useEffect(() => {
    if (
      !activeTask ||
      activeBreak ||
      pendingMealInterruption ||
      !planner.timer.isRunning ||
      remainingSeconds > 0
    ) return;
    setPlanner((current) => ({
      ...current,
      timer: {
        elapsedSeconds: activeTask.durationMinutes * 60,
        runningSince: null,
        isRunning: false,
      },
    }));
    setExtensionMinutes(15);
    setTimeUpPromptOpen(true);
  }, [
    activeBreak,
    activeTask,
    pendingMealInterruption,
    planner.timer.isRunning,
    remainingSeconds,
  ]);

  useEffect(() => {
    if (!shouldStartMidTaskBreak(planner, now)) return;
    setPlanner((current) => startAdaptiveBreak(current, now, "long-task"));
  }, [now, planner]);

  useEffect(() => {
    if (!activeBreak || breakRemainingSeconds > 0) return;
    const resumedAt = Date.now();
    setPlanner((current) => finishAdaptiveBreak(current, resumedAt));
    setNow(resumedAt);
  }, [activeBreak, breakRemainingSeconds]);

  const schedule = useMemo(
    () => buildAdaptiveSchedule(planner, now),
    [planner, now],
  );
  const totalMinutes =
    planner.plan?.tasks.reduce((sum, task) => sum + task.durationMinutes, 0) ?? 0;
  const upcomingBreaks = schedule.filter(
    (entry) =>
      entry.kind === "break" &&
      entry.status !== "completed" &&
      !isMealBreakReason(entry.reason),
  );
  const plannedRestMinutes = upcomingBreaks.reduce(
    (sum, entry) => sum + entry.durationMinutes,
    0,
  );
  const upcomingMeals = schedule.filter(
    (entry) =>
      entry.kind === "break" &&
      entry.status !== "completed" &&
      isMealBreakReason(entry.reason),
  );
  const currentSchedule = schedule.find(
    (entry) => entry.status === "active",
  );
  const progress = activeTask
    ? Math.min(100, (elapsedSeconds / (activeTask.durationMinutes * 60)) * 100)
    : 100;
  const breakProgress = activeBreak
    ? Math.min(
        100,
        ((activeBreak.durationMinutes * 60 - breakRemainingSeconds) /
          (activeBreak.durationMinutes * 60)) *
          100,
      )
    : 0;
  const displayProgress = planner.waitingForStart
    ? 0
    : activeBreak
      ? breakProgress
      : progress;
  const date = new Date(now);
  const clockText = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const dateText = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
  const miniCountdownSeconds = planner.waitingForStart
    ? waitingSeconds
    : activeBreak
      ? breakRemainingSeconds
      : remainingSeconds;
  const miniTaskName = activeMeal
    ? `${getBreakLabel(activeMeal.reason)} · ${activeTask?.title ?? "当前任务"}`
    : activeBreak
      ? `休息 · ${activeTask?.title ?? "当前任务"}`
      : activeTask?.title ??
        (planner.plan ? "今日任务已完成" : "尚未安排任务");
  const miniStateClass = planner.waitingForStart
    ? "waiting"
    : activeMeal
      ? "meal"
      : activeBreak
        ? "rest"
        : planner.timer.isRunning
          ? "running"
          : "paused";

  function savePlan(startTime: string, tasks: PlannerTask[]) {
    if (
      planner.plan &&
      !window.confirm("保存修改后，今天的完成状态和倒计时会重新开始。继续吗？")
    ) {
      return;
    }

    const plan: DayPlan = {
      dateKey: getDateKey(),
      startTime,
      tasks,
    };
    const savedAt = Date.now();
    const waitingForStart =
      tasks.length > 0 && getPlanStartAt(plan) > savedAt;
    const nextPlanner: PlannerState = {
      plan,
      waitingForStart,
      completedTaskIds: [],
      activeTaskId: tasks[0]?.id ?? null,
      timer: {
        elapsedSeconds: 0,
        runningSince: tasks.length && !waitingForStart ? savedAt : null,
        isRunning: tasks.length > 0 && !waitingForStart,
      },
      taskTimings: tasks[0] && !waitingForStart
        ? {
            [tasks[0].id]: {
              startedAt: savedAt,
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
    const mealInterruption = waitingForStart
      ? null
      : getMealInterruptionAtTaskBoundary(nextPlanner, savedAt);
    setPlanner(
      mealInterruption
        ? startMealBreak(nextPlanner, mealInterruption)
        : nextPlanner,
    );
    setNow(savedAt);
    setTimeUpPromptOpen(false);
    setEditorOpen(false);
  }

  function toggleTimer() {
    if (
      !activeTask ||
      planner.waitingForStart ||
      activeBreak ||
      remainingSeconds <= 0
    ) return;
    setPlanner((current) => {
      if (current.timer.isRunning) {
        return {
          ...current,
          timer: {
            elapsedSeconds: getElapsedSeconds(current.timer, Date.now()),
            runningSince: null,
            isRunning: false,
          },
        };
      }
      return {
        ...current,
        timer: {
          ...current.timer,
          runningSince: Date.now(),
          isRunning: true,
        },
      };
    });
  }

  function completeCurrentTask() {
    if (!planner.plan || planner.waitingForStart || !activeTask) return;
    const completedAt = Date.now();

    setTimeUpPromptOpen(false);

    setPlanner((current) => {
      if (!current.plan || !current.activeTaskId) return current;

      const focusCycleSeconds = getFocusCycleSeconds(current, completedAt);
      const completedTaskIds = Array.from(
        new Set([...current.completedTaskIds, current.activeTaskId]),
      );
      const nextTask = current.plan.tasks.find(
        (task) => !completedTaskIds.includes(task.id),
      );
      const knownTiming = current.taskTimings[current.activeTaskId];
      const inferredStartedAt =
        completedAt - getElapsedSeconds(current.timer, completedAt) * 1000;
      const taskTimings = {
        ...current.taskTimings,
        [current.activeTaskId]: {
          startedAt: knownTiming?.startedAt ?? inferredStartedAt,
          completedAt,
        },
      };

      const nextState: PlannerState = {
        ...current,
        completedTaskIds,
        activeTaskId: nextTask?.id ?? null,
        taskTimings,
        focusCycle: {
          accumulatedSeconds: focusCycleSeconds,
          taskBaselineSeconds: 0,
        },
        timer: {
          elapsedSeconds: 0,
          runningSince: null,
          isRunning: false,
        },
      };

      if (!nextTask) return nextState;

      const mealInterruption = getMealInterruptionAtTaskBoundary(
        nextState,
        completedAt,
      );
      if (mealInterruption) {
        return startMealBreak(nextState, mealInterruption);
      }

      if (focusCycleSeconds >= 45 * 60) {
        return startAdaptiveBreak(nextState, completedAt, "task-boundary");
      }

      return {
        ...nextState,
        taskTimings: {
          ...nextState.taskTimings,
          [nextTask.id]: {
            startedAt: completedAt,
            completedAt: null,
          },
        },
        timer: {
          elapsedSeconds: 0,
          runningSince: completedAt,
          isRunning: true,
        },
      };
    });
    setNow(completedAt);
  }

  function finishCurrentBreak() {
    if (!activeBreak) return;
    const resumedAt = Date.now();
    setPlanner((current) => finishAdaptiveBreak(current, resumedAt));
    setNow(resumedAt);
  }

  function startPlanImmediately() {
    if (!planner.plan || !planner.waitingForStart) return;
    const startedAt = Date.now();
    setPlanner((current) => {
      if (!current.plan) return current;
      const startedState = startWaitingPlan(
        {
          ...current,
          plan: {
            ...current.plan,
            startTime: formatTimestampAsTime(startedAt),
          },
        },
        startedAt,
      );
      const mealInterruption = getMealInterruptionAtTaskBoundary(
        startedState,
        startedAt,
      );
      return mealInterruption
        ? startMealBreak(startedState, mealInterruption)
        : startedState;
    });
    setNow(startedAt);
  }

  function extendCurrentTask() {
    if (!activeTask) return;

    const minutes = Math.max(
      1,
      Math.min(240, Math.round(Number(extensionMinutes) || 15)),
    );
    const resumedAt = Date.now();
    setPlanner((current) =>
      extendActiveTask(current, activeTask.id, minutes, resumedAt),
    );
    setExtensionMinutes(minutes);
    setTimeUpPromptOpen(false);
    setNow(resumedAt);
  }

  async function slideMiniWindow(revealed: boolean) {
    if (!isTauri()) return;

    const token = miniAnimationToken.current + 1;
    miniAnimationToken.current = token;
    const appWindow = getCurrentWindow();
    const [position, size] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
    ]);
    const placement = await getMiniWindowPlacement(size);
    if (!placement) return;

    const targetX = revealed ? placement.shownX : placement.hiddenX;
    const targetY = placement.y;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const frames = reducedMotion ? 1 : 12;

    for (let frame = 1; frame <= frames; frame += 1) {
      if (miniAnimationToken.current !== token) return;
      const progress = frame / frames;
      const eased = 1 - Math.pow(1 - progress, 3);
      const x = Math.round(position.x + (targetX - position.x) * eased);
      const y = Math.round(position.y + (targetY - position.y) * eased);
      await appWindow.setPosition(new PhysicalPosition(x, y));
      if (frame < frames) await waitForWindowFrame(12);
    }
  }

  async function restoreNormalWindow() {
    if (!isTauri()) return;

    miniAnimationToken.current += 1;
    const appWindow = getCurrentWindow();
    const savedWindow = normalWindowState.current;

    await appWindow.setAlwaysOnTop(false);
    await appWindow.setSkipTaskbar(false);
    await appWindow.setResizable(true);
    await appWindow.setDecorations(true);
    await appWindow.setShadow(true);
    await appWindow.setMinSize(
      new LogicalSize(NORMAL_WINDOW_MIN_WIDTH, NORMAL_WINDOW_MIN_HEIGHT),
    );

    if (savedWindow?.maximized) {
      await appWindow.setSize(
        new LogicalSize(NORMAL_WINDOW_WIDTH, NORMAL_WINDOW_HEIGHT),
      );
      await appWindow.center();
      await appWindow.maximize();
      return;
    }

    if (savedWindow) {
      await appWindow.setSize(
        new PhysicalSize(savedWindow.size.width, savedWindow.size.height),
      );
      await appWindow.setPosition(
        new PhysicalPosition(
          savedWindow.position.x,
          savedWindow.position.y,
        ),
      );
      return;
    }

    await appWindow.setSize(
      new LogicalSize(NORMAL_WINDOW_WIDTH, NORMAL_WINDOW_HEIGHT),
    );
    await appWindow.center();
  }

  async function enterMiniMode() {
    setMiniRevealed(false);
    setMiniMode(true);
    if (!isTauri()) return;

    const appWindow = getCurrentWindow();
    try {
      const [position, size, maximized] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.innerSize(),
        appWindow.isMaximized(),
      ]);
      normalWindowState.current = {
        position: {
          x: position.x,
          y: position.y,
        },
        size: {
          width: size.width,
          height: size.height,
        },
        maximized,
      };

      if (maximized) await appWindow.unmaximize();
      await appWindow.setMinSize(null);
      await appWindow.setDecorations(false);
      await appWindow.setShadow(true);
      await appWindow.setResizable(false);
      await appWindow.setAlwaysOnTop(true);
      await appWindow.setSkipTaskbar(true);
      await appWindow.setSize(
        new LogicalSize(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT),
      );

      const miniSize = await appWindow.outerSize();
      const placement = await getMiniWindowPlacement(miniSize);
      if (placement) {
        await appWindow.setPosition(
          new PhysicalPosition(placement.hiddenX, placement.y),
        );
      }
    } catch (error) {
      console.error("无法进入迷你模式", error);
      setMiniMode(false);
      await restoreNormalWindow();
    }
  }

  async function expandFromMini() {
    if (miniHideTimer.current !== null) {
      window.clearTimeout(miniHideTimer.current);
      miniHideTimer.current = null;
    }
    setMiniRevealed(false);
    setMiniMode(false);
    try {
      await restoreNormalWindow();
    } catch (error) {
      console.error("无法恢复完整窗口", error);
    }
  }

  function revealMiniWindow() {
    if (miniHideTimer.current !== null) {
      window.clearTimeout(miniHideTimer.current);
      miniHideTimer.current = null;
    }
    setMiniRevealed(true);
    void slideMiniWindow(true);
  }

  function scheduleMiniWindowHide() {
    if (miniHideTimer.current !== null) {
      window.clearTimeout(miniHideTimer.current);
    }
    miniHideTimer.current = window.setTimeout(() => {
      setMiniRevealed(false);
      void slideMiniWindow(false);
      miniHideTimer.current = null;
    }, 260);
  }

  if (miniMode) {
    return (
      <main
        className={`mini-shell ${miniStateClass}${miniRevealed ? " is-revealed" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`迷你计时窗口，${miniTaskName}，点击恢复完整窗口`}
        title="点击恢复完整窗口"
        onPointerEnter={revealMiniWindow}
        onPointerLeave={scheduleMiniWindowHide}
        onClick={() => void expandFromMini()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void expandFromMini();
          }
        }}
      >
        <span className="mini-edge-cue" aria-hidden="true" />
        <div className="mini-content">
          <div
            className="mini-countdown"
            aria-label={`倒计时 ${formatCountdown(miniCountdownSeconds)}`}
          >
            {formatCountdown(miniCountdownSeconds)}
          </div>
          <div className="mini-task-name" title={miniTaskName}>
            {miniTaskName}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="panel clock-panel">
        <div className="panel-label-row">
          <p className="panel-label">当前时间</p>
          <span className="live-mark">LIVE</span>
        </div>
        <div className="clock-value" aria-label={`当前时间 ${clockText}`}>
          {clockText}
        </div>
        <p className="date-value">{dateText}</p>
        <div className="minute-rail" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, index) => (
            <i key={index} className={index === date.getMinutes() % 12 ? "active" : ""} />
          ))}
        </div>
      </section>

      <section className="panel schedule-panel">
        <header className="schedule-header">
          <div>
            <p className="eyebrow">{planner.plan?.dateKey ?? getDateKey()}</p>
            <h2>今日日程</h2>
            <p className="summary-line">
              {planner.plan?.tasks.length ?? 0} 个任务 · 工作 {formatDuration(totalMinutes)}
              {upcomingBreaks.length > 0 &&
                ` · 休息 ${upcomingBreaks.length} 次 / ${formatDuration(plannedRestMinutes)}`}
              {upcomingMeals.length > 0 &&
                ` · 用餐 ${upcomingMeals.length} 次`}
              {` · 已完成 ${planner.completedTaskIds.length}`}
            </p>
          </div>
          <div className="schedule-actions">
            <button
              className="mini-toggle-button" hidden={!isTauri()}
              type="button"
              aria-label="切换到迷你窗口"
              title="迷你窗口"
              onClick={() => void enterMiniMode()}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="3" />
                <path d="M7 10h6m-2.25-2.25L13 10l-2.25 2.25" />
              </svg>
            </button>
            <button className="quiet-button" onClick={() => setEditorOpen(true)}>
              编辑日程
            </button>
          </div>
        </header>

        <div className="schedule-list">
          {schedule.map((entry) => {
            const isActive = entry.status === "active";
            const isCompleted = entry.status === "completed";
            const isBreak = entry.kind === "break";
            const isMeal = isMealBreakReason(entry.reason);
            const isWaitingFirst =
              planner.waitingForStart &&
              entry.kind === "task" &&
              entry.task?.id === planner.activeTaskId &&
              !entry.continuation;
            return (
              <article
                className={`schedule-row${isActive ? " active" : ""}${isCompleted ? " completed" : ""}${isBreak ? " break-row" : ""}${isMeal ? " meal-row" : ""}${isWaitingFirst ? " waiting" : ""}`}
                key={entry.id}
              >
                <time>
                  {formatTimestampAsTime(entry.startAt)} — {formatTimestampAsTime(entry.endAt)}
                </time>
                <span className="timeline-node" aria-hidden="true" />
                <strong>
                  {isBreak
                    ? getBreakLabel(entry.reason)
                    : `${entry.task?.title ?? "任务"}${entry.continuation ? " · 继续" : ""}`}
                </strong>
                <span className="duration-copy">
                  {isCompleted && !isBreak
                    ? "已完成"
                    : formatDuration(entry.durationMinutes)}
                </span>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel countdown-panel">
        <div className="panel-label-row">
          <p className="panel-label">
            {planner.waitingForStart
              ? "距离计划开始"
              : activeMeal
                ? `${getBreakLabel(activeMeal.reason)}剩余`
                : activeBreak
                ? "休息剩余"
                : "当前任务剩余"}
          </p>
          {activeTask && (
            <span className={`state-pill${planner.waitingForStart ? " waiting" : activeMeal ? " running meal" : activeBreak ? " running rest" : planner.timer.isRunning ? " running" : ""}`}>
              {planner.waitingForStart
                ? "等待中"
                : activeMeal
                  ? "用餐中"
                  : activeBreak
                ? "休息中"
                : remainingSeconds === 0
                ? "时间到"
                : planner.timer.isRunning
                  ? "进行中"
                  : "已暂停"}
            </span>
          )}
        </div>
        <div className={`countdown-value${activeMeal ? " meal-value" : activeBreak ? " rest-value" : ""}`}>
          {formatCountdown(
            planner.waitingForStart
              ? waitingSeconds
              : activeBreak
                ? breakRemainingSeconds
                : remainingSeconds,
          )}
        </div>
        <h2 className="current-task-name">
          {planner.waitingForStart
            ? `${formatTimestampAsTime(scheduledStartAt!)} 开始 · ${activeTask?.title ?? "第一项任务"}`
            : activeMeal
              ? `${getBreakLabel(activeMeal.reason)}时间，任务暂停`
              : activeBreak
            ? "离开屏幕，活动一下"
            : activeTask ?? planner.plan
              ? activeTask?.title ?? "今天已完成"
              : "尚未安排"}
        </h2>
        <div className="progress-scale" aria-label={`${planner.waitingForStart ? "等待" : activeMeal ? "用餐" : activeBreak ? "休息" : "任务"}进度 ${Math.round(displayProgress)}%`}>
          <div className="progress-track">
            <div className={`progress-fill${activeMeal ? " meal" : activeBreak ? " rest" : ""}`} style={{ width: `${displayProgress}%` }} />
          </div>
          <div className="scale-ticks" aria-hidden="true">
            {Array.from({ length: 25 }).map((_, index) => <i key={index} />)}
          </div>
        </div>
        <p className="expected-end">
          {planner.waitingForStart && scheduledStartAt
            ? `计划将在 ${formatTimestampAsTime(scheduledStartAt)} 自动开始`
            : currentSchedule
            ? activeMeal
              ? `${getBreakLabel(activeMeal.reason)}至 ${formatTimestampAsTime(currentSchedule.endAt)}，期间不安排任务`
              : activeBreak
              ? `休息至 ${formatTimestampAsTime(currentSchedule.endAt)}，随后继续工作`
              : `本段至 ${formatTimestampAsTime(currentSchedule.endAt)}${schedule.some((entry) => entry.kind === "break" && entry.startAt === currentSchedule.endAt) ? "，随后休息" : ""}`
            : planner.plan
              ? "所有任务均已完成"
              : "建立计划后从第一项开始计时"}
        </p>
      </section>

      <section className="panel detail-panel">
        <div className="detail-heading">
          <div>
            <p className="panel-label">{planner.waitingForStart || activeBreak ? "当前状态" : "当前工作"}</p>
            <h2>{planner.waitingForStart ? "等待开始" : activeMeal ? getBreakLabel(activeMeal.reason) : activeBreak ? "休息一下" : activeTask?.title ?? (planner.plan ? "今日完成" : "等待计划")}</h2>
          </div>
          {planner.plan && !activeBreak && !planner.waitingForStart && (
            <span className="task-position">
              {activeTask
                ? `${String(planner.plan.tasks.findIndex((task) => task.id === activeTask.id) + 1).padStart(2, "0")} / ${String(planner.plan.tasks.length).padStart(2, "0")}`
                : `${String(planner.plan.tasks.length).padStart(2, "0")} / ${String(planner.plan.tasks.length).padStart(2, "0")}`}
            </span>
          )}
        </div>

        <div className={`detail-card${!activeTask || activeBreak || planner.waitingForStart ? " empty" : ""}${activeMeal ? " meal-card" : activeBreak ? " rest-card" : ""}${planner.waitingForStart ? " waiting-card" : ""}`}>
          {planner.waitingForStart ? (
            <div className="waiting-guidance">
              <span className="waiting-mark" aria-hidden="true" />
              <strong>{formatTimestampAsTime(scheduledStartAt!)} 自动开始</strong>
              <p>第一项是“{activeTask?.title}”。在开始前可以准备材料，倒计时不会提前消耗任务时间。</p>
            </div>
          ) : activeMeal ? (
            <div className="meal-guidance">
              <span className="meal-mark" aria-hidden="true" />
              <strong>{getBreakLabel(activeMeal.reason)} · {activeMeal.durationMinutes} 分钟</strong>
              <p>这段时间不安排任务。用餐结束后，当前任务会从中断处自动继续。</p>
            </div>
          ) : activeBreak ? (
            <div className="rest-guidance">
              <span className="rest-orbit" aria-hidden="true" />
              <strong>{activeBreak.durationMinutes} 分钟恢复时间</strong>
              <p>站起来走动、看看远处或喝点水。休息结束后会自动继续当前任务。</p>
            </div>
          ) : activeTask ? (
            activeTask.details.trim() ? (
              <p className="detail-freeform">{activeTask.details}</p>
            ) : (
              <p>这项任务还没有填写具体内容。</p>
            )
          ) : (
            <div className="empty-state">
              <strong>{planner.plan ? "做得很好，今天到这里。" : "先列出今天要完成的事情。"}</strong>
              <p>{planner.plan ? "完成的任务已保存在今天的记录中。" : "设置每项任务的时间和内容，然后开始。"}</p>
            </div>
          )}
        </div>

        <div className="detail-actions">
          {planner.waitingForStart ? (
            <button className="primary-button" onClick={startPlanImmediately}>
              立即开始
            </button>
          ) : activeMeal ? (
            <button className="secondary-button" disabled>
              用餐结束后自动继续
            </button>
          ) : activeBreak ? (
            <button className="secondary-button" onClick={finishCurrentBreak}>
              提前结束休息
            </button>
          ) : activeTask ? (
            <>
              <button
                className="secondary-button"
                onClick={toggleTimer}
                disabled={remainingSeconds === 0}
              >
                {remainingSeconds === 0
                  ? "等待完成"
                  : planner.timer.isRunning
                    ? "暂停"
                    : "继续"}
              </button>
              <button className="primary-button" onClick={completeCurrentTask}>
                完成任务
              </button>
            </>
          ) : (
            <button className="primary-button" onClick={() => setEditorOpen(true)}>
              {planner.plan ? "安排新的一天" : "创建今日计划"}
            </button>
          )}
        </div>
      </section>

      {editorOpen && (
        <PlanEditor
          plan={planner.plan}
          onSave={savePlan}
          onClose={planner.plan ? () => setEditorOpen(false) : undefined}
        />
      )}

      {timeUpPromptOpen && activeTask && !activeBreak && !planner.waitingForStart && (
        <div
          className="time-up-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="time-up-title"
        >
          <section className="time-up-dialog">
            <p className="eyebrow">预设时间结束</p>
            <h2 id="time-up-title">{activeTask.title}</h2>
            <p className="time-up-copy">
              这项任务已经达到预设时长。现在完成，或为它增加一段时间。
            </p>

            <label className="extension-control">
              <span>延时时长</span>
              <span className="extension-input">
                <input
                  type="number"
                  min="1"
                  max="240"
                  step="5"
                  value={extensionMinutes}
                  onChange={(event) =>
                    setExtensionMinutes(Number(event.target.value))
                  }
                  aria-label="延时分钟数"
                />
                <span>分钟</span>
              </span>
            </label>

            <div className="time-up-actions">
              <button className="secondary-button" onClick={completeCurrentTask}>
                完成任务
              </button>
              <button className="primary-button" onClick={extendCurrentTask}>
                延时 {Math.max(1, Math.min(240, Math.round(Number(extensionMinutes) || 15)))} 分钟
              </button>
            </div>
            <p className="time-up-note">延时后，后续任务会自动整体后移。</p>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
