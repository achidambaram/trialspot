import { NextResponse } from "next/server";
import { distributeTasks } from "@/lib/task-distributor";

export async function POST(request: Request) {
  const body = await request.json();
  const { event_id } = body;

  if (!event_id) {
    return NextResponse.json({ error: "event_id required" }, { status: 400 });
  }

  await distributeTasks(event_id);
  return NextResponse.json({ ok: true });
}
