import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { recomputeReadiness } from "@/lib/state-engine";

export async function POST(request: Request) {
  const body = await request.json();
  const { task_id, status } = body;

  if (!task_id || status !== "resolved") {
    return NextResponse.json(
      { error: "task_id and status: 'resolved' are required" },
      { status: 400 }
    );
  }

  const db = createServerClient();
  const now = new Date().toISOString();

  const { data: task, error } = await db
    .from("tasks")
    .update({ status: "resolved", resolved_at: now })
    .eq("id", task_id)
    .select()
    .single();

  if (error || !task) {
    return NextResponse.json(
      { error: error?.message || "Task not found" },
      { status: 404 }
    );
  }

  // Log activity
  await db.from("activity_events").insert({
    event_id: task.event_id,
    type: "task_resolved",
    payload: { task_id: task.id, title: task.title },
    timestamp: now,
  });

  const readiness = await recomputeReadiness(task.event_id);

  return NextResponse.json({ task, readiness });
}
