import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { parseInspection } from "@/lib/bodhi-parser";
import {
  acceptInspectionUpdate,
  computeSpatialSnapshot,
  recomputeReadiness,
} from "@/lib/state-engine";
import { handleContradictionCheck } from "@/lib/spatial-reasoning";

export async function POST(request: Request) {
  const body = await request.json();
  const { event_id, raw_text } = body;

  if (!event_id || !raw_text) {
    return NextResponse.json(
      { error: "event_id and raw_text are required" },
      { status: 400 }
    );
  }

  const db = createServerClient();

  // Fetch checklist + zones + spatial state
  const [{ data: items }, { data: zones }] = await Promise.all([
    db.from("checklist_items").select("*").eq("event_id", event_id),
    db.from("zones").select("*").eq("event_id", event_id),
  ]);

  const snapshot = await computeSpatialSnapshot(event_id, zones || []);

  // Parse via Bodhi simulation
  const parsed = await parseInspection(raw_text, items || [], snapshot.current_zone);

  // State Engine validates and persists
  const result = await acceptInspectionUpdate(event_id, parsed);

  // Run spatial reasoning (contradiction check) if accepted
  let contradictionAlert = null;
  if (result.accepted && parsed.item_id) {
    const item = (items || []).find((i) => i.id === parsed.item_id);
    if (item) {
      contradictionAlert = await handleContradictionCheck(
        event_id,
        parsed,
        item,
        snapshot
      );
    }
  }

  const readiness = result.accepted
    ? await recomputeReadiness(event_id)
    : undefined;

  return NextResponse.json({
    parsed,
    accepted: result.accepted,
    reason: result.reason,
    readiness,
    contradiction: contradictionAlert,
  });
}
