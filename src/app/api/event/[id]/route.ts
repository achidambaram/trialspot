import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { computeSpatialSnapshot } from "@/lib/state-engine";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = createServerClient();

  const [
    { data: session },
    { data: zones },
    { data: items },
    { data: tasks },
    { data: activities },
    { data: alerts },
    { data: operators },
    { data: captures },
  ] = await Promise.all([
    db.from("event_sessions").select("*").eq("id", id).single(),
    db.from("zones").select("*").eq("event_id", id),
    db.from("checklist_items").select("*").eq("event_id", id),
    db.from("tasks").select("*").eq("event_id", id).order("created_at", { ascending: false }),
    db.from("activity_events").select("*").eq("event_id", id).order("timestamp", { ascending: true }),
    db.from("alerts").select("*").eq("event_id", id).order("fired_at", { ascending: true }),
    db.from("operators").select("*").eq("event_id", id).eq("is_active", true).order("connected_at", { ascending: true }),
    db.from("operator_captures").select("*").eq("event_id", id).order("captured_at", { ascending: false }).limit(50),
  ]);

  if (!session) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const snapshot = await computeSpatialSnapshot(id, zones || []);

  return NextResponse.json({
    session,
    zones: zones || [],
    items: items || [],
    tasks: tasks || [],
    activities: activities || [],
    alerts: alerts || [],
    spatial: snapshot,
    operators: operators || [],
    captures: captures || [],
  });
}
