import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { distributeTasks } from "@/lib/task-distributor";

export async function POST(request: Request) {
  const body = await request.json();
  const { event_id, device_id, name } = body;

  if (!event_id || !device_id) {
    return NextResponse.json(
      { error: "event_id and device_id are required" },
      { status: 400 }
    );
  }

  const db = createServerClient();
  const now = new Date().toISOString();
  const operatorName = name || `Operator ${device_id.slice(0, 6)}`;

  // Upsert operator (same device reconnecting gets updated, not duplicated)
  const { data: operator, error } = await db
    .from("operators")
    .upsert(
      {
        event_id,
        device_id,
        name: operatorName,
        connected_at: now,
        last_seen_at: now,
        is_active: true,
      },
      { onConflict: "event_id,device_id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log activity
  await db.from("activity_events").insert({
    event_id,
    type: "zone_enter",
    payload: {
      source: "operator_joined",
      operator_id: operator.id,
      operator_name: operatorName,
    },
    timestamp: now,
  });

  // Redistribute tasks with new operator
  await distributeTasks(event_id);

  // Get all active operators for the response
  const { data: allOperators } = await db
    .from("operators")
    .select("*")
    .eq("event_id", event_id)
    .eq("is_active", true);

  return NextResponse.json({
    operator,
    total_operators: allOperators?.length || 1,
  });
}
