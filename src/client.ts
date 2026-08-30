import { toFormBody } from "./serializer.js";
import { toApiWorkoutPayload, workoutInputSchema, type WorkoutInput } from "./types.js";
import type { FetchLike } from "./auth.js";

const API_BASE_URL = "https://www.caliverse.app/api/v1";
const MAX_ERROR_BODY_LENGTH = 1_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const PLAN_TIMEOUT_MS = 60_000;

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

  private async sendWorkout(endpoint: string, payload: object): Promise<unknown> {
    return this.request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: toFormBody(payload)
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

    const text = await response.text();
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
