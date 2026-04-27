import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function POST(request: Request) {
  const body = await request.json();
  const { operator_id, zone_id } = body;

  if (!operator_id) {
    return NextResponse.json({ error: "operator_id required" }, { status: 400 });
  }

  const db = createServerClient();

  await db
    .from("operators")
    .update({
      current_zone_id: zone_id || null,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", operator_id);

  return NextResponse.json({ ok: true });
}
