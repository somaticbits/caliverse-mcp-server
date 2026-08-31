import { z } from "zod";

export const repetitionTypeSchema = z.enum(["count", "time"]);

export const workoutExerciseSchema = z.object({
  exerciseId: z.number().int().positive(),
  setCount: z.number().int().positive(),
  repetitionCount: z.number().int().positive(),
  repetitionType: repetitionTypeSchema.default("count"),
  orderInWorkout: z.number().int().positive(),
  restTimeBeforeExercise: z.number().int().nonnegative().default(0),
  description: z.string().max(2_000).optional()
});

export const workoutSupersetSchema = z.object({
  supersetId: z.number().int().positive().nullable().optional(),
  restBetweenCycles: z.number().int().nonnegative().default(0),
  orderInWorkout: z.number().int().positive(),
  title: z.string().max(200).default(""),
  exercises: z.array(workoutExerciseSchema).min(1)
});

export const workoutInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  privateTitle: z.string().trim().max(200).optional(),
  isPublic: z.boolean().default(false),
  isPro: z.boolean().default(false),
  lengthInMinutes: z.coerce.number().int().positive().max(720),
  // The server's permitted values are discovered from the user's existing workouts.
  level: z.string().trim().min(1).max(100),
  warmupWorkoutId: z.number().int().positive().nullable().optional(),
  cooldownWorkoutId: z.number().int().positive().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  groupIds: z.array(z.number().int().positive()).default([]),
  categoryIds: z.array(z.number().int().positive()).default([]),
  supersets: z.array(workoutSupersetSchema).min(1)
});

export type WorkoutInput = z.infer<typeof workoutInputSchema>;

export interface ApiWorkoutExercise {
  exercise_id: number;
  set_count: number;
  repetition_count: number;
  repetition_type: "count" | "time";
  order_in_workout: number;
  rest_time_before_exercise: number;
  description?: string;
}

export interface ApiWorkoutSuperset {
  superset_id: number | null;
  rest_between_cycles: number;
  order_in_workout: number;
  title: string;
  workout_exercises: ApiWorkoutExercise[];
}

export interface ApiWorkoutPayload {
  workout_id: number | null;
  title: string;
  private_title: string | undefined;
  is_public: 0 | 1;
  is_pro: 0 | 1;
  length_in_minutes: number;
  level: string;
  warmup_workout_id: number | null;
  cooldown_workout_id: number | null;
  image_url: string | null;
  image_file: null;
  workout_group_ids: number[];
  workout_supersets: ApiWorkoutSuperset[];
}

const PLAIN_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Normalizes a timestamp into Caliverse's naive "YYYY-MM-DD HH:mm:ss" wall-clock format.
 * A string already in that exact format is assumed to already be local time and is passed
 * through unchanged. Any other parseable value (e.g. an ISO 8601 timestamp) is formatted
 * using this process's local timezone, which is appropriate because this server always runs
 * on the same machine, in the same timezone, as the account owner triggering it.
 */
export function toCaliverseDateTime(value: string): string {
  if (PLAIN_DATETIME_PATTERN.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`"${value}" is not a valid date. Use "YYYY-MM-DD HH:mm:ss" (local time) or an ISO 8601 timestamp.`);
  }
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
}

/** Today's local date as "YYYY-MM-DD", matching the format Caliverse's day/calendar endpoints expect. */
export function todayDateString(now: () => Date = () => new Date()): string {
  const date = now();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const workoutLogSetSchema = z.object({
  repetitionCount: z.number().int().nonnegative(),
  addedWeightKg: z.number().nonnegative().default(0),
  restSecondsBefore: z.number().int().nonnegative().default(0),
  startedAt: z.string().trim().min(1).optional(),
  finishedAt: z.string().trim().min(1).optional()
});

export const workoutLogExerciseSchema = z.object({
  exerciseId: z.number().int().positive(),
  sets: z.array(workoutLogSetSchema).min(1)
});

export const workoutLogInputSchema = z.object({
  workoutId: z.number().int().positive(),
  startedAt: z.string().trim().min(1),
  finishedAt: z.string().trim().min(1),
  exercises: z.array(workoutLogExerciseSchema).min(1)
});

export type WorkoutLogInput = z.infer<typeof workoutLogInputSchema>;

export interface ApiWorkoutExerciseLog {
  order_in_workout: number;
  started_at: string;
  finished_at: string;
  rest_seconds_before: number;
  repetition_count: number;
  added_weight: number;
  added_weight_unit: 1;
  set_in_exercise: number;
  workout_exercise_id: number;
}

export interface ApiWorkoutLogPayload {
  workout_id: number;
  started_at: string;
  finished_at: string;
  workout_exercise_logs: ApiWorkoutExerciseLog[];
}

interface WorkoutExerciseSlot {
  workoutExerciseId: number;
  orderInWorkout: number;
  exerciseId: number;
}

function logRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Caliverse returned an invalid ${context} while logging a completed workout.`);
  }
  return value as Record<string, unknown>;
}

function logPositiveInt(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Caliverse workout is missing a valid ${context}.`);
  }
  return value;
}

/**
 * Flattens a fetched workout's supersets into an ordered list of exercise slots, in the exact
 * order they appear in the workout. Each slot's `workoutExerciseId` and `orderInWorkout` come
 * directly from Caliverse and are required by the completion-logging endpoint, but are internal
 * implementation details the caller of `logWorkoutCompletion` should not need to know.
 */
function extractWorkoutExerciseSlots(workout: Record<string, unknown>): WorkoutExerciseSlot[] {
  const supersets = Array.isArray(workout.supersets) ? workout.supersets : [];
  return supersets.flatMap((superset) => {
    const supersetRecord = logRecord(superset, "superset");
    const workoutExercises = Array.isArray(supersetRecord.workout_exercises) ? supersetRecord.workout_exercises : [];
    return workoutExercises.map((workoutExercise) => {
      const item = logRecord(workoutExercise, "workout exercise");
      const exercise = logRecord(item.exercise, "workout exercise's exercise reference");
      return {
        workoutExerciseId: logPositiveInt(item.id, "workout exercise id"),
        orderInWorkout: logPositiveInt(item.order_in_workout, "workout exercise order"),
        exerciseId: logPositiveInt(exercise.id, "exercise id")
      };
    });
  });
}

/**
 * Maps a friendly `WorkoutLogInput` (keyed by library exercise IDs) onto the exact payload shape
 * Caliverse's mobile app sends to `/workouts/log/finish-with-exercises`, resolving each exercise
 * to its position-specific `workout_exercise_id` from the fetched workout. If the same exercise
 * appears in multiple slots within the workout (e.g. repeated across supersets), each logged
 * exercise entry consumes the next unused matching slot, in workout order.
 */
export function mapWorkoutLogToApiPayload(workout: unknown, input: WorkoutLogInput): ApiWorkoutLogPayload {
  const workoutRecord = logRecord(workout, "workout");
  const workoutId = logPositiveInt(workoutRecord.id, "workout id");
  if (workoutId !== input.workoutId) {
    throw new Error(`Fetched workout ${workoutId} does not match the requested workout ${input.workoutId}.`);
  }

  const slots = extractWorkoutExerciseSlots(workoutRecord);
  const usedWorkoutExerciseIds = new Set<number>();
  const sessionStartedAt = toCaliverseDateTime(input.startedAt);
  const sessionFinishedAt = toCaliverseDateTime(input.finishedAt);

  const workoutExerciseLogs = input.exercises.flatMap((exerciseInput) => {
    const slot = slots.find((candidate) => candidate.exerciseId === exerciseInput.exerciseId && !usedWorkoutExerciseIds.has(candidate.workoutExerciseId));
    if (slot === undefined) {
      const remaining = slots.filter((candidate) => !usedWorkoutExerciseIds.has(candidate.workoutExerciseId)).map((candidate) => candidate.exerciseId);
      throw new Error(`Exercise ${exerciseInput.exerciseId} was not found in workout ${input.workoutId}. Remaining exercise IDs in this workout: ${remaining.length > 0 ? remaining.join(", ") : "(none)"}.`);
    }
    usedWorkoutExerciseIds.add(slot.workoutExerciseId);

    return exerciseInput.sets.map((set, index) => ({
      order_in_workout: slot.orderInWorkout,
      started_at: set.startedAt === undefined ? sessionStartedAt : toCaliverseDateTime(set.startedAt),
      finished_at: set.finishedAt === undefined ? sessionFinishedAt : toCaliverseDateTime(set.finishedAt),
      rest_seconds_before: set.restSecondsBefore,
      repetition_count: set.repetitionCount,
      added_weight: set.addedWeightKg,
      added_weight_unit: 1 as const,
      set_in_exercise: index + 1,
      workout_exercise_id: slot.workoutExerciseId
    }));
  });

  return {
    workout_id: input.workoutId,
    started_at: sessionStartedAt,
    finished_at: sessionFinishedAt,
    workout_exercise_logs: workoutExerciseLogs
  };
}

export function toApiWorkoutPayload(input: WorkoutInput, workoutId: number | null): ApiWorkoutPayload {
  return {
    workout_id: workoutId,
    title: input.title,
    private_title: input.privateTitle,
    is_public: input.isPublic ? 1 : 0,
    is_pro: input.isPro ? 1 : 0,
    length_in_minutes: input.lengthInMinutes,
    level: input.level,
    warmup_workout_id: input.warmupWorkoutId ?? null,
    cooldown_workout_id: input.cooldownWorkoutId ?? null,
    image_url: input.imageUrl ?? null,
    image_file: null,
    workout_group_ids: input.groupIds,
    workout_supersets: input.supersets.map((superset) => ({
      superset_id: superset.supersetId ?? null,
      rest_between_cycles: superset.restBetweenCycles,
      order_in_workout: superset.orderInWorkout,
      title: superset.title,
      workout_exercises: superset.exercises.map((exercise) => ({
        exercise_id: exercise.exerciseId,
        set_count: exercise.setCount,
        repetition_count: exercise.repetitionCount,
        repetition_type: exercise.repetitionType,
        order_in_workout: exercise.orderInWorkout,
        rest_time_before_exercise: exercise.restTimeBeforeExercise,
        ...(exercise.description === undefined ? {} : { description: exercise.description })
      }))
    }))
  };
}
