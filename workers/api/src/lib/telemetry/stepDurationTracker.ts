export async function recordStepDuration(
  db: D1Database,
  stepName: string,
  durationMs: number,
  candidateId?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO step_duration_samples (step_name, duration_ms, candidate_id)
       VALUES (?1, ?2, ?3)`,
    )
    .bind(stepName, durationMs, candidateId ?? '')
    .run();
}

export async function getP50Duration(
  db: D1Database,
  stepName: string,
): Promise<number | null> {
  const rows = await db
    .prepare(
      `SELECT duration_ms
         FROM step_duration_samples
        WHERE step_name = ?1
        ORDER BY created_at DESC
        LIMIT 500`,
    )
    .bind(stepName)
    .all<{ duration_ms: number }>();

  const samples = rows.results ?? [];
  if (samples.length === 0) {
    return null;
  }

  const values = samples.map((r) => r.duration_ms).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 0) {
    return (values[mid - 1]! + values[mid]!) / 2;
  }
  return values[mid]!;
}

export async function estimateCompletion(
  db: D1Database,
  remainingSteps: string[],
): Promise<number | null> {
  let total = 0;
  for (const stepName of remainingSteps) {
    const rows = await db
      .prepare(
        `SELECT duration_ms
           FROM step_duration_samples
          WHERE step_name = ?1
          ORDER BY created_at DESC
          LIMIT 500`,
      )
      .bind(stepName)
      .all<{ duration_ms: number }>();

    const samples = rows.results ?? [];
    if (samples.length < 3) {
      return null;
    }

    const values = samples.map((r) => r.duration_ms).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const p50 =
      values.length % 2 === 0
        ? (values[mid - 1]! + values[mid]!) / 2
        : values[mid]!;
    total += p50;
  }
  return total;
}
