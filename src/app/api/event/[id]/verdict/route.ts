import { NextResponse } from "next/server";
import { handleVerdict } from "@/lib/spatial-reasoning";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await handleVerdict(id);
  return NextResponse.json(result);
}
