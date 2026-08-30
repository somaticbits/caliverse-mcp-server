import { toFormBody } from "./serializer.js";
import { toApiWorkoutPayload, type WorkoutInput } from "./types.js";
import type { FetchLike } from "./auth.js";

const API_BASE_URL = "https://www.caliverse.app/api/v1";
const MAX_ERROR_BODY_LENGTH = 1_000;

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

  public constructor(private readonly options: CaliverseApiOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public listExercises(): Promise<unknown> {
    return this.request("/exercises", { method: "GET" });
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
    return this.request("/workouts/plans", { method: "GET" });
  }

  public getPlan(planId: number): Promise<unknown> {
    return this.request(`/workouts/plans/${planId}`, { method: "GET" });
  }

  public async createWorkout(input: WorkoutInput): Promise<unknown> {
    const created = await this.sendWorkout("/workouts/with-supersets", toApiWorkoutPayload(input, null));
    await this.assignCategoriesIfPresent(created, input.categoryIds);
    return created;
  }

  public async updateWorkout(workoutId: number, input: WorkoutInput): Promise<unknown> {
    const updated = await this.sendWorkout(`/workouts/${workoutId}/with-supersets`, toApiWorkoutPayload(input, workoutId));
    await this.assignCategoriesIfPresent(updated, input.categoryIds);
    return updated;
  }

  public async cloneWorkout(workoutId: number, title: string): Promise<unknown> {
    const existing = await this.getWorkout(workoutId);
    if (typeof existing !== "object" || existing === null) {
      throw new Error("Caliverse returned an invalid workout while cloning.");
    }
    const clone = structuredClone(existing) as Record<string, unknown>;
    delete clone.id;
    clone.title = title;
    clone.is_public = 0;
    clone.is_pro = 0;
    return this.request("/workouts/with-supersets", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: toFormBody(clone)
    });
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

  private async assignCategoriesIfPresent(workout: unknown, categoryIds: number[]): Promise<void> {
    if (categoryIds.length === 0) {
      return;
    }
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

  private async request(endpoint: string, init: RequestInit, retried = false): Promise<unknown> {
    const token = await this.options.tokenManager.getIdToken(retried);
    const response = await this.fetchImpl(`${API_BASE_URL}${endpoint}`, {
      ...init,
      headers: {
        accept: "application/json",
        "X-USER-ID-TOKEN": token,
        ...init.headers
      },
      signal: AbortSignal.timeout(20_000)
    });

    if (response.status === 401 && !retried) {
      return this.request(endpoint, init, true);
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
