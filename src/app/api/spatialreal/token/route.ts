import { NextResponse } from "next/server";

const API_KEY = process.env.SPATIALREAL_API_KEY || "";
const CONSOLE_HOST = "console.us-west.spatialwalk.cloud";

export async function POST() {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "SPATIALREAL_API_KEY not configured" },
      { status: 500 }
    );
  }

  // Token expires in 1 hour
  const expireAt = Math.floor(Date.now() / 1000) + 3600;

  try {
    const res = await fetch(
      `https://${CONSOLE_HOST}/v1/console/session-tokens`,
      {
        method: "POST",
        headers: {
          "X-Api-Key": API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expireAt, modelVersion: "" }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `SpatialReal token request failed: ${res.status} ${text}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({ sessionToken: data.sessionToken });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to fetch token: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    );
  }
}
