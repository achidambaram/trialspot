import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { ZONES, CHECKLIST_ITEMS } from "@/lib/seed-data";

export async function POST(request: Request) {
  const body = await request.json();
  const { name, room_name } = body;

  if (!name || !room_name) {
    return NextResponse.json(
      { error: "name and room_name are required" },
      { status: 400 }
    );
  }

  const db = createServerClient();

  // Create event session
  const { data: session, error: sessionError } = await db
    .from("event_sessions")
    .insert({ name, room_name, status: "ACTIVE", readiness: "UNKNOWN" })
    .select()
    .single();

  if (sessionError || !session) {
    return NextResponse.json(
      { error: sessionError?.message || "Failed to create session" },
      { status: 500 }
    );
  }

  // Create zones
  const zoneInserts = ZONES.map((z) => ({
    event_id: session.id,
    name: z.name,
    label: z.label,
  }));

  const { data: zones, error: zonesError } = await db
    .from("zones")
    .insert(zoneInserts)
    .select();

  if (zonesError || !zones) {
    return NextResponse.json(
      { error: zonesError?.message || "Failed to create zones" },
      { status: 500 }
    );
  }

  // Build zone name → id map
  const zoneMap = new Map(zones.map((z) => [z.name, z.id]));

  // Create checklist items
  const itemInserts = CHECKLIST_ITEMS.map((item) => ({
    event_id: session.id,
    zone_id: zoneMap.get(item.zone)!,
    name: item.name,
    label: item.label,
    criticality: item.criticality,
    status: "unverified",
  }));

  const { data: items, error: itemsError } = await db
    .from("checklist_items")
    .insert(itemInserts)
    .select();

  if (itemsError) {
    return NextResponse.json(
      { error: itemsError.message },
      { status: 500 }
    );
  }

  // Log session start
  await db.from("activity_events").insert({
    event_id: session.id,
    type: "readiness_changed",
    payload: { readiness: "UNKNOWN", reason: "Session created" },
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({
    session,
    zones,
    items,
  });
}
