import { toFormBody } from "./serializer.js";
import { collectExercisePrs, mapWorkoutLogToApiPayload, toApiWorkoutPayload, workoutInputSchema, type ExercisePrCollection, type WorkoutInput, type WorkoutLogInput } from "./types.js";
import type { FetchLike } from "./auth.js";

const API_BASE_URL = "https://www.caliverse.app/api/v1";
const MAX_ERROR_BODY_LENGTH = 1_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const PLAN_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PR_SCAN_DAYS = 120;
const PR_SCAN_CONCURRENCY = 5;

export class CaliverseApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly endpoint: string,
    message: string
  ) {
    super(message);
    this.name = "CaliverseApiError";
  }
}

export interface CaliverseApiOptions {
  tokenManager: TokenProvider;
  fetchImpl?: FetchLike;
}

export interface TokenProvider {
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

export class CaliverseApi {
  private readonly fetchImpl: FetchLike;
  private exercises: Promise<unknown> | undefined;

  public constructor(private readonly options: CaliverseApiOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public listExercises(): Promise<unknown> {
    this.exercises ??= this.request("/exercises", { method: "GET" }).catch((error: unknown) => {
      this.exercises = undefined;
      throw error;
    });
    return this.exercises;
  }

  public listMyWorkouts(): Promise<unknown> {
    return this.request("/workouts/mine", { method: "GET" });
  }

  public getWorkout(workoutId: number): Promise<unknown> {
    return this.request(`/workouts/${workoutId}`, { method: "GET" });
  }

  public listCategories(): Promise<unknown> {
    return this.request("/workouts/categories", { method: "GET" });
  }

  public listGroups(): Promise<unknown> {
    return this.request("/workouts/groups", { method: "GET" });
  }

  public listPlans(): Promise<unknown> {
    return this.request("/workouts/plans", { method: "GET" }, false, PLAN_TIMEOUT_MS);
  }

  public listPlansShort(): Promise<unknown> {
    return this.request("/workouts/plans/short?include_mine=1", { method: "GET" });
  }

  public getPlan(planId: number): Promise<unknown> {
    return this.request(`/workouts/plans/${planId}`, { method: "GET" }, false, PLAN_TIMEOUT_MS);
  }

  public async createWorkout(input: WorkoutInput): Promise<unknown> {
    const created = await this.sendWorkout("/workouts/with-supersets", toApiWorkoutPayload(input, null));
    await this.assignCategories(created, input.categoryIds);
    return created;
  }

  public async updateWorkout(workoutId: number, input: WorkoutInput): Promise<unknown> {
    const updated = await this.sendWorkout(`/workouts/${workoutId}/with-supersets`, toApiWorkoutPayload(input, workoutId));
    await this.assignCategories(updated, input.categoryIds);
    return updated;
  }

  public async cloneWorkout(workoutId: number, title: string): Promise<unknown> {
    const existing = await this.getWorkout(workoutId);
    if (typeof existing !== "object" || existing === null) {
      throw new Error("Caliverse returned an invalid workout while cloning.");
    }
    const clone = this.toCloneInput(existing as Record<string, unknown>, title);
    return this.createWorkout(clone);
  }

  public deleteWorkout(workoutId: number): Promise<unknown> {
    return this.request(`/workouts/${workoutId}`, { method: "DELETE" });
  }

  public listMuscleGroups(): Promise<unknown> {
    return this.request("/muscle-groups", { method: "GET" });
  }

  public getProgressSignals(): Promise<unknown> {
    return this.request("/ai-coach/today/progress-signals", { method: "GET" });
  }

  public getMyDay(date: string): Promise<unknown> {
    return this.request(`/users/me/my-day?date=${encodeURIComponent(date)}`, { method: "GET" });
  }

  public async getAvailableEquipment(): Promise<Array<{ id: number; title: string }>> {
    const account = await this.request("/users/me", { method: "GET" });
    if (typeof account !== "object" || account === null || !Array.isArray((account as { available_equipments?: unknown }).available_equipments)) {
      throw new Error("Caliverse returned an invalid account equipment list.");
    }
    return (account as { available_equipments: unknown[] }).available_equipments.flatMap((equipment) => {
      if (typeof equipment !== "object" || equipment === null) {
        return [];
      }
      const { id, title } = equipment as { id?: unknown; title?: unknown };
      return typeof id === "number" && Number.isInteger(id) && id > 0 && typeof title === "string" ? [{ id, title }] : [];
    });
  }

  public getWorkoutFilters(): Promise<unknown> {
    return this.request("/workouts/filters", { method: "GET" });
  }

  public getSubscription(): Promise<unknown> {
    return this.request("/users/subscriptions/verify", { method: "GET" });
  }

  public async getExercisePrs(from: string, to: string): Promise<ExercisePrCollection & { from: string; to: string; daysScanned: number }> {
    const dates = this.dateRange(from, to);
    if (dates.length > MAX_PR_SCAN_DAYS) {
      throw new Error(`Exercise PR scans are limited to ${MAX_PR_SCAN_DAYS} days per request. Split ${from} through ${to} into smaller ranges.`);
    }
    const days: unknown[] = new Array(dates.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < dates.length) {
        const index = nextIndex++;
        days[index] = await this.getMyDay(dates[index]!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PR_SCAN_CONCURRENCY, dates.length) }, worker));
    return { ...collectExercisePrs(days), from, to, daysScanned: dates.length };
  }

  public getScheduleCalendar(dateFrom: string, dateTo: string): Promise<unknown> {
    return this.request(`/workouts/schedules/calendar?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`, { method: "GET" });
  }

  public getCoachProfile(): Promise<unknown> {
    return this.request("/ai-coach/profile", { method: "GET" });
  }

  public getCoachToday(): Promise<unknown> {
    return this.request("/ai-coach/today", { method: "GET" });
  }

  public getCoachHistory(from: string, to: string): Promise<unknown> {
    return this.request(`/ai-coach/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: "GET" });
  }

  public getActivePlan(): Promise<unknown> {
    return this.request("/workouts/plans/mine/active", { method: "GET" });
  }

  public getProgressionTree(exerciseId: number): Promise<unknown> {
    return this.request(`/exercises/${exerciseId}/progression-tree`, { method: "GET" });
  }

  public getMyWorkoutRating(workoutId: number): Promise<unknown> {
    return this.request(`/workouts/${workoutId}/rating`, { method: "GET" });
  }

  public listFavoriteWorkouts(): Promise<unknown> {
    return this.request("/workouts/favorite", { method: "GET" });
  }

  public getLogFeedbackOptions(): Promise<unknown> {
    return this.request("/workouts/log/feedback/options", { method: "GET" });
  }

  public async logWorkoutCompletion(input: WorkoutLogInput): Promise<unknown> {
    const workout = await this.getWorkout(input.workoutId);
    const payload = mapWorkoutLogToApiPayload(workout, input);
    return this.postJson("/workouts/log/finish-with-exercises", payload);
  }

  public deleteWorkoutLog(logId: number): Promise<unknown> {
    return this.request(`/workouts/log/${logId}`, { method: "DELETE" });
  }

  private async sendWorkout(endpoint: string, payload: object): Promise<unknown> {
    return this.request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: toFormBody(payload)
    });
  }

  private async postJson(endpoint: string, payload: object): Promise<unknown> {
    return this.request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  private async assignCategories(workout: unknown, categoryIds: number[]): Promise<void> {
    if (typeof workout !== "object" || workout === null || typeof (workout as { id?: unknown }).id !== "number") {
      throw new Error("Workout was created, but its ID was not returned; categories were not assigned.");
    }
    await this.request("/workouts/categories/assign", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: toFormBody({
        workout_id: (workout as { id: number }).id,
        workout_category_id_list: categoryIds
      })
    });
  }

  private toCloneInput(workout: Record<string, unknown>, title: string): WorkoutInput {
    const groups = Array.isArray(workout.groups) ? workout.groups : [];
    const categories = Array.isArray(workout.workout_categories) ? workout.workout_categories : [];
    const supersets = Array.isArray(workout.supersets) ? workout.supersets : [];

    return workoutInputSchema.parse({
      title,
      privateTitle: typeof workout.private_title === "string" ? workout.private_title : undefined,
      isPublic: false,
      isPro: false,
      lengthInMinutes: workout.length_in_minutes,
      level: workout.level,
      warmupWorkoutId: this.readId(workout.warmup_workout),
      cooldownWorkoutId: this.readId(workout.cooldown_workout),
      imageUrl: typeof workout.image_url === "string" ? workout.image_url : null,
      groupIds: groups.map((group) => this.readId(group)).filter((id): id is number => id !== undefined),
      categoryIds: categories.map((category) => this.readId(category)).filter((id): id is number => id !== undefined),
      supersets: supersets.map((superset) => {
        const item = this.asRecord(superset, "superset");
        const exercises = Array.isArray(item.workout_exercises) ? item.workout_exercises : [];
        return {
          supersetId: this.readId(item),
          restBetweenCycles: item.rest_between_cycles,
          orderInWorkout: item.order_in_workout,
          title: typeof item.title === "string" ? item.title : "",
          exercises: exercises.map((exercise) => {
            const exerciseItem = this.asRecord(exercise, "workout exercise");
            return {
              exerciseId: this.readId(exerciseItem.exercise) ?? exerciseItem.exercise_id,
              setCount: exerciseItem.set_count,
              repetitionCount: exerciseItem.repetition_count,
              repetitionType: exerciseItem.repetition_type,
              orderInWorkout: exerciseItem.order_in_workout,
              restTimeBeforeExercise: exerciseItem.rest_time_before_exercise,
              description: typeof exerciseItem.description === "string" ? exerciseItem.description : undefined
            };
          })
        };
      })
    });
  }

  private asRecord(value: unknown, context: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
      throw new Error(`Caliverse returned an invalid ${context} while cloning.`);
    }
    return value as Record<string, unknown>;
  }

  private readId(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value;
    }
    if (typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "number") {
      const id = (value as { id: number }).id;
      return Number.isInteger(id) && id > 0 ? id : undefined;
    }
    return undefined;
  }

  private dateRange(from: string, to: string): string[] {
    const parse = (value: string): Date => {
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new Error(`"${value}" is not a valid YYYY-MM-DD date.`);
      }
      return date;
    };
    const start = parse(from);
    const end = parse(to);
    if (start > end) {
      throw new Error("Exercise PR scan start date must be on or before the end date.");
    }
    const dates: string[] = [];
    for (const current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
      dates.push(current.toISOString().slice(0, 10));
    }
    return dates;
  }

  private async request(endpoint: string, init: RequestInit, retried = false, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const token = await this.options.tokenManager.getIdToken(retried);
    const response = await this.fetchImpl(`${API_BASE_URL}${endpoint}`, {
      ...init,
      headers: {
        accept: "application/json",
        "X-USER-ID-TOKEN": token,
        ...init.headers
      },
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (response.status === 401 && !retried) {
      return this.request(endpoint, init, true, timeoutMs);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new CaliverseApiError(response.status, endpoint, `Caliverse API response from ${endpoint} exceeds the ${MAX_RESPONSE_BYTES}-byte safety limit.`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new CaliverseApiError(response.status, endpoint, `Caliverse API response from ${endpoint} exceeds the ${MAX_RESPONSE_BYTES}-byte safety limit.`);
    }
    if (!response.ok) {
      throw new CaliverseApiError(
        response.status,
        endpoint,
        `Caliverse API request to ${endpoint} failed (HTTP ${response.status}): ${text.slice(0, MAX_ERROR_BODY_LENGTH)}`
      );
    }
    if (text.length === 0) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new CaliverseApiError(response.status, endpoint, `Caliverse API returned invalid JSON from ${endpoint}.`);
    }
  }
}
