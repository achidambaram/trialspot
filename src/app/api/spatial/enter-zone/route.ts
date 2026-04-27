import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { computeSpatialSnapshot } from "@/lib/state-engine";

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

  // Record zone entry
  await db.from("user_path_events").insert({
    event_id,
    zone_id,
    action: "enter",
    timestamp: now,
  });

  // Log activity
  const { data: zone } = await db
    .from("zones")
    .select("label")
    .eq("id", zone_id)
    .single();

  await db.from("activity_events").insert({
    event_id,
    type: "zone_enter",
    payload: { zone_id, zone_label: zone?.label },
    timestamp: now,
  });

  // Update operator's current zone
  if (operator_id) {
    await db
      .from("operators")
      .update({ current_zone_id: zone_id, last_seen_at: now })
      .eq("id", operator_id);
  }

  // Return updated snapshot
  const { data: zones } = await db
    .from("zones")
    .select("*")
    .eq("event_id", event_id);

  const snapshot = await computeSpatialSnapshot(event_id, zones || []);

  return NextResponse.json({ snapshot });
}
