import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { computeSpatialSnapshot, recomputeReadiness } from "@/lib/state-engine";
import { handleZoneExit } from "@/lib/spatial-reasoning";

export async function POST(request: Request) {
  const body = await request.json();
  const { event_id, zone_id, operator_id } = body;

  if (!event_id || !zone_id) {
    return NextResponse.json(
      { error: "event_id and zone_id are required" },
      { status: 400 }
    );
  }

  const db = createServerClient();
  const now = new Date().toISOString();

  // Compute dwell time from last enter event
  const { data: lastEnter } = await db
    .from("user_path_events")
    .select("timestamp")
    .eq("event_id", event_id)
    .eq("zone_id", zone_id)
    .eq("action", "enter")
    .order("timestamp", { ascending: false })
    .limit(1)
    .single();

  const dwellMs = lastEnter
    ? new Date(now).getTime() - new Date(lastEnter.timestamp).getTime()
    : null;

  // Record zone exit
  await db.from("user_path_events").insert({
    event_id,
    zone_id,
    action: "exit",
    timestamp: now,
    dwell_ms: dwellMs,
  });

  // Log activity
  const { data: zone } = await db
    .from("zones")
    .select("label")
    .eq("id", zone_id)
    .single();

  await db.from("activity_events").insert({
    event_id,
    type: "zone_exit",
    payload: { zone_id, zone_label: zone?.label, dwell_ms: dwellMs },
    timestamp: now,
  });

  // Clear operator's current zone
  if (operator_id) {
    await db
      .from("operators")
      .update({ current_zone_id: null, last_seen_at: now })
      .eq("id", operator_id);
  }

  // Run spatial reasoning — detect missed checks
  const alerts = await handleZoneExit(event_id, zone_id);

  // Recompute readiness
  const readiness = await recomputeReadiness(event_id);

  // Return updated snapshot
  const { data: zones } = await db
    .from("zones")
    .select("*")
    .eq("event_id", event_id);

  const snapshot = await computeSpatialSnapshot(event_id, zones || []);

  return NextResponse.json({ snapshot, alerts, readiness });
}
