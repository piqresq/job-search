/** Bump per-dimension sequence; used to hit 80/20 and 70/30 targets over many pipeline runs. */
export async function bumpJsearchRotationSeq(db: D1Database, id: string): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO jsearch_rotation (id, seq) VALUES (?, 1)
       ON CONFLICT(id) DO UPDATE SET seq = seq + 1
       RETURNING seq`,
    )
    .bind(id)
    .first<{ seq: number }>();
  if (typeof row?.seq !== "number") {
    throw new Error(`jsearch_rotation: failed to bump ${id}`);
  }
  return row.seq;
}
