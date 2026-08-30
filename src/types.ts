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
  lengthInMinutes: z.number().int().positive().max(720),
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
