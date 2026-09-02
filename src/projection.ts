const EXERCISE_SUMMARY_FIELDS = ["id", "title", "slug", "level", "is_sided", "is_favorite"] as const;
const WORKOUT_SUMMARY_FIELDS = ["id", "title", "private_title", "slug", "level", "length_in_minutes", "is_public", "is_pro", "is_favorite", "is_owned_by_current_user", "owner_type", "type", "system_type", "rating", "rating_count", "image_url"] as const;
const PLAN_SUMMARY_FIELDS = ["id", "title", "slug", "level", "week_count", "minimum_days_per_week", "recommended_workout_count_per_week", "plan_type", "type", "version", "is_pro", "is_owned_by_current_user", "owner_type", "rating", "image_url"] as const;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pick(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const source = record(value);
  return Object.fromEntries(fields.filter((field) => field in source).map((field) => [field, source[field]]));
}

export function omittedKeys(value: unknown, projected: unknown): string[] {
  const source = record(value);
  const selected = record(projected);
  return Object.keys(source).filter((key) => !(key in selected)).sort();
}

export function selectedFields(value: unknown, fields: string[]): Record<string, unknown> {
  return pick(value, fields);
}

export function exerciseSummary(value: unknown): Record<string, unknown> {
  return pick(value, EXERCISE_SUMMARY_FIELDS);
}

export function projectExercise(value: unknown, detail: "summary" | "full", fields?: string[]): unknown {
  if (fields !== undefined) {
    return selectedFields(value, fields);
  }
  return detail === "full" ? value : exerciseSummary(value);
}

function idList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map((item) => record(item).id).filter((id): id is number => typeof id === "number")
    : [];
}

function workoutRef(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return pick(value, ["id", "title", "length_in_minutes"]);
}

function workoutStructure(value: unknown): Record<string, unknown> {
  const source = record(value);
  const result = pick(source, WORKOUT_SUMMARY_FIELDS);
  result.warmup_workout = workoutRef(source.warmup_workout);
  result.cooldown_workout = workoutRef(source.cooldown_workout);
  result.groups = Array.isArray(source.groups) ? source.groups.map((group) => pick(group, ["id"])) : [];
  result.workout_categories = Array.isArray(source.workout_categories)
    ? source.workout_categories.map((category) => pick(category, ["id"]))
    : [];
  result.supersets = Array.isArray(source.supersets) ? source.supersets.map((superset) => {
    const item = record(superset);
    return {
      ...pick(item, ["id", "rest_between_cycles", "order_in_workout", "title"]),
      workout_exercises: Array.isArray(item.workout_exercises) ? item.workout_exercises.map((exercise) => {
        const entry = record(exercise);
        return {
          ...pick(entry, ["id", "set_count", "repetition_count", "repetition_type", "order_in_workout", "rest_time_before_exercise", "description"]),
          exercise: pick(entry.exercise, ["id", "title"])
        };
      }) : []
    };
  }) : [];
  return result;
}

export function workoutSummary(value: unknown): Record<string, unknown> {
  const source = record(value);
  const result = pick(source, WORKOUT_SUMMARY_FIELDS);
  result.category_ids = idList(source.workout_categories);
  result.group_ids = idList(source.groups);
  result.superset_count = Array.isArray(source.supersets) ? source.supersets.length : 0;
  result.exercise_count = Array.isArray(source.supersets)
    ? source.supersets.reduce((count, superset) => {
      const exercises = record(superset).workout_exercises;
      return count + (Array.isArray(exercises) ? exercises.length : 0);
    }, 0)
    : 0;
  return result;
}

export function projectWorkout(value: unknown, detail: "summary" | "structure" | "full", fields?: string[]): unknown {
  if (fields !== undefined) {
    return selectedFields(value, fields);
  }
  if (detail === "full") {
    return value;
  }
  return detail === "summary" ? workoutSummary(value) : workoutStructure(value);
}

export function planSummary(value: unknown): Record<string, unknown> {
  return pick(value, PLAN_SUMMARY_FIELDS);
}

export function projectPlan(value: unknown, detail: "summary" | "full", fields?: string[]): unknown {
  if (fields !== undefined) {
    return selectedFields(value, fields);
  }
  return detail === "full" ? value : planSummary(value);
}

export interface WorkoutSlot {
  section: "warmup" | "main" | "cooldown";
  superset: number | null;
  position: number;
  order_in_superset: number | null;
  exercise_id: number | null;
  title: string | null;
  set_count: number | null;
  repetition_count: number | null;
  repetition_type: string | null;
  rest_time_before_exercise: number | null;
  image_url: string | null;
}

function orderedItems(items: unknown[]): unknown[] {
  return items
    .map((value, index) => ({ value, index, order: record(value).order_in_workout }))
    .sort((left, right) => {
      const leftOrder = typeof left.order === "number" ? left.order : left.index + 1;
      const rightOrder = typeof right.order === "number" ? right.order : right.index + 1;
      return leftOrder - rightOrder || left.index - right.index;
    })
    .map((item) => item.value);
}

function slotValue(value: unknown, section: WorkoutSlot["section"], superset: number | null, position: number): WorkoutSlot {
  const entry = record(value);
  const exercise = record(entry.exercise);
  return {
    section,
    superset,
    position,
    order_in_superset: typeof entry.order_in_workout === "number" ? entry.order_in_workout : null,
    exercise_id: typeof exercise.id === "number" ? exercise.id : null,
    title: typeof exercise.title === "string" ? exercise.title : null,
    set_count: typeof entry.set_count === "number" ? entry.set_count : null,
    repetition_count: typeof entry.repetition_count === "number" ? entry.repetition_count : null,
    repetition_type: typeof entry.repetition_type === "string" ? entry.repetition_type : null,
    rest_time_before_exercise: typeof entry.rest_time_before_exercise === "number" ? entry.rest_time_before_exercise : null,
    image_url: typeof exercise.image_url === "string" ? exercise.image_url : null
  };
}

function workoutExerciseEntries(workout: unknown): unknown[] {
  const source = record(workout);
  if (Array.isArray(source.supersets)) {
    return orderedItems(source.supersets).flatMap((superset) => {
      const item = record(superset);
      return Array.isArray(item.workout_exercises) ? orderedItems(item.workout_exercises) : [];
    });
  }
  // The flat relation has more entries than the nested supersets in observed responses; use it only
  // when no supersets are available.
  return Array.isArray(source.workout_exercises) ? orderedItems(source.workout_exercises) : [];
}

export function workoutSlots(value: unknown, include: "main" | "all" = "main"): WorkoutSlot[] {
  const source = record(value);
  const sections: Array<[WorkoutSlot["section"], unknown]> = [["main", source]];
  if (include === "all") sections.unshift(["warmup", source.warmup_workout]);
  if (include === "all") sections.push(["cooldown", source.cooldown_workout]);
  return sections.flatMap(([section, workout]) => {
    const item = record(workout);
    const supersets = Array.isArray(item.supersets) ? item.supersets : [];
    const exerciseSupersets = new Map<unknown, number>();
    supersets.forEach((superset, index) => {
      const exercises = record(superset).workout_exercises;
      const supersetOrder = record(superset).order_in_workout;
      if (Array.isArray(exercises)) exercises.forEach((exercise) => exerciseSupersets.set(exercise, typeof supersetOrder === "number" ? supersetOrder : index + 1));
    });
    return workoutExerciseEntries(workout).map((entry, index) => slotValue(entry, section, exerciseSupersets.get(entry) ?? null, index + 1));
  });
}
