import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { computeSpatialSnapshot, recomputeReadiness } from "@/lib/state-engine";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

export async function POST(request: Request) {
  const body = await request.json();
  const { event_id, image_base64, mime_type, operator_id } = body;

  if (!event_id || !image_base64) {
    return NextResponse.json(
      { error: "event_id and image_base64 are required" },
      { status: 400 }
    );
  }

  const db = createServerClient();

  // Fetch current event state
  const [{ data: items }, { data: zones }, { data: session }] = await Promise.all([
    db.from("checklist_items").select("*").eq("event_id", event_id),
    db.from("zones").select("*").eq("event_id", event_id),
    db.from("event_sessions").select("*").eq("id", event_id).single(),
  ]);

  if (!session) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const snapshot = await computeSpatialSnapshot(event_id, zones || []);

  // Build checklist context for Gemini
  const checklistContext = (items || [])
    .map((i) => `- "${i.name}" (${i.label}) [zone: ${zones?.find(z => z.id === i.zone_id)?.name}] [${i.criticality}] [${i.status}]`)
    .join("\n");

  const zoneList = (zones || []).map((z) => z.name).join(", ");

  // Call Gemini Vision API
  const prompt = `You are analyzing a photo taken during a hackathon venue inspection.

ZONES in this venue: ${zoneList}
Currently in zone: ${snapshot.current_zone ? zones?.find(z => z.id === snapshot.current_zone)?.name : "none"}

CHECKLIST ITEMS:
${checklistContext}

Analyze this image and respond with ONLY valid JSON:
{
  "detected_zone": "<zone name if you can identify it, or null>",
  "verified_items": [
    {"item_name": "<checklist item name>", "confidence": <0-1>, "note": "<what you see>"}
  ],
  "issues_found": [
    {"description": "<issue description>", "severity": "low|medium|high", "zone_hint": "<zone name if applicable>"}
  ],
  "scene_description": "<brief description of what's in the image>"
}

Rules:
- Only include verified_items if you can CLEARLY see evidence of that item in the image
- Be conservative with confidence — only 0.8+ if the evidence is unambiguous
- Flag any safety issues you spot (trip hazards, blocked exits, missing signs, etc.)
- For detected_zone, look for visual cues (stage equipment, entrance doors, power outlets, tables, exit signs)`;

  try {
    const parts: GeminiPart[] = [
      { text: prompt },
      {
        inlineData: {
          mimeType: mime_type || "image/jpeg",
          data: image_base64,
        },
      },
    ];

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Gemini API error: ${errText}` }, { status: 502 });
    }

    const geminiData: GeminiResponse = await res.json();
    const responseText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const analysis = JSON.parse(responseText);

    const now = new Date().toISOString();
    const results: {
      zone_entered: string | null;
      items_verified: string[];
      issues: string[];
      scene: string;
    } = {
      zone_entered: null,
      items_verified: [],
      issues: [],
      scene: analysis.scene_description || "",
    };

    // Auto-detect zone
    if (analysis.detected_zone) {
      const detectedZone = (zones || []).find(
        (z) => z.name === analysis.detected_zone
      );
      if (detectedZone && snapshot.current_zone !== detectedZone.id) {
        // Exit current zone if in one
        if (snapshot.current_zone) {
          await db.from("user_path_events").insert({
            event_id,
            zone_id: snapshot.current_zone,
            action: "exit",
            timestamp: now,
          });
        }
        // Enter detected zone
        await db.from("user_path_events").insert({
          event_id,
          zone_id: detectedZone.id,
          action: "enter",
          timestamp: now,
        });
        await db.from("activity_events").insert({
          event_id,
          type: "zone_enter",
          payload: {
            zone_id: detectedZone.id,
            zone_label: detectedZone.label,
            source: "meta_glasses_vision",
          },
          timestamp: now,
        });
        results.zone_entered = detectedZone.label;
      }
    }

    // Auto-verify checklist items
    for (const verified of analysis.verified_items || []) {
      if (verified.confidence < 0.7) continue; // Only accept high-confidence visual matches

      const item = (items || []).find((i) => i.name === verified.item_name);
      if (!item || item.status === "verified") continue;

      const currentSnapshot = await computeSpatialSnapshot(event_id, zones || []);

      await db
        .from("checklist_items")
        .update({
          status: "verified",
          verified_at: now,
          verified_in_zone: currentSnapshot.current_zone,
          note: `[Photo verified] ${verified.note}`,
        })
        .eq("id", item.id);

      await db.from("activity_events").insert({
        event_id,
        type: "inspection_update",
        payload: {
          item_id: item.id,
          item_name: item.name,
          item_label: item.label,
          status: "verified",
          note: `[Photo verified] ${verified.note}`,
          confidence: verified.confidence,
          source: "meta_glasses_vision",
        },
        timestamp: now,
      });

      // Auto-resolve related open tasks
      await db
        .from("tasks")
        .update({ status: "resolved", resolved_at: now })
        .eq("event_id", event_id)
        .eq("related_item_id", item.id)
        .eq("status", "open");

      results.items_verified.push(item.label);
    }

    // Log issues
    for (const issue of analysis.issues_found || []) {
      await db.from("activity_events").insert({
        event_id,
        type: "inspection_update",
        payload: {
          source: "meta_glasses_vision",
          issue: issue.description,
          severity: issue.severity,
          zone_hint: issue.zone_hint,
        },
        timestamp: now,
      });

      // Create task for high-severity issues
      if (issue.severity === "high") {
        await db.from("tasks").insert({
          event_id,
          type: "missing_item",
          status: "open",
          title: `Visual issue: ${issue.description}`,
          description: `Detected by camera: ${issue.description}`,
          created_at: now,
        });
      }

      results.issues.push(issue.description);
    }

    // Store capture for command center feeds
    await db.from("operator_captures").insert({
      event_id,
      operator_id: operator_id || null,
      image_base64,
      mime_type: mime_type || "image/jpeg",
      scene_description: results.scene || null,
      zone_detected: analysis.detected_zone || null,
      items_verified: results.items_verified,
      issues: results.issues,
    });

    // Recompute readiness
    const readiness = await recomputeReadiness(event_id);

    // Log the vision analysis
    await db.from("activity_events").insert({
      event_id,
      type: "inspection_update",
      payload: {
        source: "meta_glasses_vision",
        scene: analysis.scene_description,
        items_found: results.items_verified.length,
        issues_found: results.issues.length,
        zone_detected: analysis.detected_zone,
      },
      timestamp: now,
    });

    return NextResponse.json({
      analysis,
      results,
      readiness,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Vision analysis failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
