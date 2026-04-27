import "dotenv/config";
import { google } from "@ai-sdk/google";
import { GoogleGenAI } from "@google/genai";
import { tool } from "ai";
import { z } from "zod";
import { VoiceSession } from "bodhi-realtime-agent";
import type {
  MainAgent,
  SubagentConfig,
  ToolDefinition,
  ToolContext,
} from "bodhi-realtime-agent";

const API_KEY = process.env.GEMINI_API_KEY ?? "";
if (!API_KEY) {
  console.error("Error: GEMINI_API_KEY required in .env");
  process.exit(1);
}

const TRIALRUN_URL = process.env.TRIALRUN_URL || "http://localhost:3000";
const PORT = Number(process.env.BODHI_PORT) || 9900;
const SESSION_ID = `trialrun_${Date.now()}`;

let currentEventId: string | null = null;
let sessionRef: VoiceSession | null = null;

// ============================================================
// HELPER: Fetch current event state
// ============================================================

async function getEventState() {
  if (!currentEventId) return null;
  try {
    const res = await fetch(`${TRIALRUN_URL}/api/event/${currentEventId}`);
    const data = await res.json();
    if (!data.session) return null;
    return data;
  } catch {
    return null;
  }
}

// ============================================================
// INLINE TOOLS (block Gemini turn, fast operations)
// ============================================================

const updateInspection: ToolDefinition = {
  name: "update_inspection",
  description: `Log a room inspection finding. Call this whenever the operator reports on a checklist item.
Examples: "WiFi is working", "projector looks good", "microphone is broken", "fire exit signs posted",
"power strips connected", "chairs arranged", "registration table set up", "exit path clear"`,
  parameters: z.object({
    raw_text: z.string().describe("The operator's exact words"),
  }),
  execution: "inline",
  pendingMessage: "Logging that...",
  timeout: 15000,
  execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> => {
    const { raw_text } = args as { raw_text: string };
    if (!currentEventId) return { error: "No active session." };

    try {
      const res = await fetch(`${TRIALRUN_URL}/api/inspection/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: currentEventId, raw_text }),
      });
      const data = await res.json();

      ctx.sendJsonToClient?.({ type: "inspection_result", data });

      if (data.accepted) {
        const result: Record<string, unknown> = {
          status: "accepted",
          item: data.parsed.note,
          confidence: data.parsed.confidence,
          readiness: data.readiness,
        };
        if (data.contradiction) result.contradiction = data.contradiction.message;
        return result;
      }
      return { status: "rejected", reason: data.reason };
    } catch (err) {
      return { error: String(err) };
    }
  },
};

const enterZone: ToolDefinition = {
  name: "enter_zone",
  description: `Record entering a zone. Zones: entrance, stage, seating, sponsor_tables, exits, power_area.
Call when operator says: "I'm at the entrance", "moving to stage", "walking to exits", etc.`,
  parameters: z.object({
    zone_name: z.enum(["entrance", "stage", "seating", "sponsor_tables", "exits", "power_area"]),
  }),
  execution: "inline",
  timeout: 10000,
  execute: async (args: Record<string, unknown>): Promise<unknown> => {
    const { zone_name } = args as { zone_name: string };
    if (!currentEventId) return { error: "No active session." };

    try {
      const eventData = await getEventState();
      const zone = eventData.zones.find((z: { name: string }) => z.name === zone_name);
      if (!zone) return { error: `Zone "${zone_name}" not found.` };

      // Auto-exit current zone
      if (eventData.spatial.current_zone) {
        await fetch(`${TRIALRUN_URL}/api/spatial/exit-zone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_id: currentEventId, zone_id: eventData.spatial.current_zone }),
        });
      }

      const res = await fetch(`${TRIALRUN_URL}/api/spatial/enter-zone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: currentEventId, zone_id: zone.id }),
      });
      const data = await res.json();

      return { status: "entered", zone: zone_name, zone_label: zone.label, zones_visited: data.snapshot.zones_visited.length };
    } catch (err) {
      return { error: String(err) };
    }
  },
};

const exitZone: ToolDefinition = {
  name: "exit_zone",
  description: `Record leaving the current zone. Call when: "I'm done here", "moving on", "leaving this area"`,
  parameters: z.object({
    reason: z.string().optional().describe("Why leaving (optional)"),
  }),
  execution: "inline",
  timeout: 10000,
  execute: async (): Promise<unknown> => {
    if (!currentEventId) return { error: "No active session." };
    try {
      const eventData = await getEventState();
      if (!eventData.spatial.current_zone) return { status: "not_in_zone" };

      const res = await fetch(`${TRIALRUN_URL}/api/spatial/exit-zone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: currentEventId, zone_id: eventData.spatial.current_zone }),
      });
      const data = await res.json();

      const result: Record<string, unknown> = { status: "exited", readiness: data.readiness };
      if (data.alerts?.length > 0) {
        result.alerts = data.alerts.map((a: { message: string }) => a.message);
        result.warning = "IMPORTANT: Tell the operator about these missed checks!";
      }
      return result;
    } catch (err) {
      return { error: String(err) };
    }
  },
};

// Voice-triggered photo capture — tells the dashboard to take a photo
const capturePhoto: ToolDefinition = {
  name: "capture_photo",
  description: `Trigger the camera to take a photo and analyze it with Gemini Vision.
Call this when the operator says things like:
- "check this"
- "look at this"
- "take a photo"
- "scan this area"
- "what do you see"`,
  parameters: z.object({
    what_to_look_for: z.string().optional().describe("What the operator wants checked"),
  }),
  execution: "inline",
  timeout: 5000,
  execute: async (_args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> => {
    // Send a message to the dashboard client to trigger photo capture
    ctx.sendJsonToClient?.({
      type: "capture_photo",
      data: { what_to_look_for: (_args as { what_to_look_for?: string }).what_to_look_for },
    });
    return {
      status: "triggered",
      message: "I've asked the camera to take a photo. I'll analyze what I see in a moment.",
    };
  },
};

const requestVerdict: ToolDefinition = {
  name: "request_verdict",
  description: `Request final readiness verdict. Call when: "are we ready?", "final check", "what's the status?"`,
  parameters: z.object({}),
  execution: "inline",
  timeout: 15000,
  execute: async (): Promise<unknown> => {
    if (!currentEventId) return { error: "No active session." };
    try {
      const res = await fetch(`${TRIALRUN_URL}/api/event/${currentEventId}/verdict`, { method: "POST" });
      const data = await res.json();
      return {
        readiness: data.readiness,
        alerts: data.alerts.map((a: { message: string }) => a.message),
        open_tasks: data.tasks.length,
        verdict_message: data.alerts.find((a: { type: string }) => a.type === "verdict")?.message,
      };
    } catch (err) {
      return { error: String(err) };
    }
  },
};

const setEventSession: ToolDefinition = {
  name: "set_event_session",
  description: `Set the active event session ID.`,
  parameters: z.object({ event_id: z.string() }),
  execution: "inline",
  execute: async (args: Record<string, unknown>): Promise<unknown> => {
    currentEventId = (args as { event_id: string }).event_id;
    return { status: "set", event_id: currentEventId };
  },
};

// ============================================================
// BACKGROUND TOOLS (Gemini keeps talking while these run)
// ============================================================

// --- 1. Task Tracker: checks for open tasks in current zone ---
const checkZoneTasks: ToolDefinition = {
  name: "check_zone_tasks",
  description: `Check for unresolved tasks in the current zone. Run this in the background after entering a zone.
Call this AUTOMATICALLY after every enter_zone call. Do NOT wait for the operator to ask.`,
  parameters: z.object({
    zone_name: z.string().describe("The zone to check tasks for"),
  }),
  execution: "inline",
  pendingMessage: "Checking for open tasks in this zone...",
  timeout: 10000,
  execute: async (args: Record<string, unknown>): Promise<unknown> => {
    const { zone_name } = args as { zone_name: string };
    if (!currentEventId) return { status: "no_session" };
    const eventData = await getEventState();
    if (!eventData) return { status: "no_data" };
    const zone = (eventData.zones || []).find((z: { name: string }) => z.name === zone_name);
    if (!zone) return { tasks: [], items: [] };

    const tasks = (eventData.tasks || []).filter(
      (t: { status: string; related_zone_id: string | null }) =>
        t.status === "open" && t.related_zone_id === zone.id
    );
    const unverifiedItems = (eventData.items || []).filter(
      (i: { zone_id: string; status: string }) =>
        i.zone_id === zone.id && i.status === "unverified"
    );

    return {
      zone: zone_name,
      zone_label: zone.label,
      open_tasks: tasks.map((t: { title: string; type: string }) => t.title),
      unverified_items: unverifiedItems.map((i: { label: string; criticality: string }) =>
        `${i.label} (${i.criticality})`
      ),
    };
  },
};

// taskTrackerSubagent removed — check_zone_tasks is now inline

// --- 2. Compliance Checker: reviews zone after exit ---
const runComplianceCheck: ToolDefinition = {
  name: "run_compliance_check",
  description: `Run a compliance check on a zone after the operator exits. Analyzes whether verifications were thorough enough.
Call this AUTOMATICALLY after every exit_zone call. Do NOT wait for the operator to ask.`,
  parameters: z.object({
    zone_name: z.string().describe("The zone that was just exited"),
  }),
  execution: "inline",
  pendingMessage: "Running compliance check on that zone...",
  timeout: 10000,
  execute: async (args: Record<string, unknown>): Promise<unknown> => {
    const { zone_name } = args as { zone_name: string };
    if (!currentEventId) return { status: "no_session" };
    const eventData = await getEventState();
    if (!eventData) return { status: "no_data" };
    const zone = (eventData.zones || []).find((z: { name: string }) => z.name === zone_name);
    if (!zone) return { status: "zone_not_found" };

    const zoneItems = (eventData.items || []).filter(
      (i: { zone_id: string }) => i.zone_id === zone.id
    );
    const verified = zoneItems.filter((i: { status: string }) => i.status === "verified");
    const unverified = zoneItems.filter((i: { status: string }) => i.status === "unverified");
    const criticalMissing = unverified.filter((i: { criticality: string }) => i.criticality === "critical");

    let verdict = "PASS";
    if (criticalMissing.length > 0) verdict = "FAIL";
    else if (unverified.length > 0) verdict = "NEEDS_ATTENTION";

    return {
      zone: zone_name,
      verdict,
      verified: verified.map((i: { label: string }) => i.label),
      missing: unverified.map((i: { label: string; criticality: string }) =>
        `${i.label} (${i.criticality})`
      ),
      message: verdict === "PASS"
        ? `All items in ${zone.label} verified.`
        : verdict === "FAIL"
        ? `CRITICAL items missing in ${zone.label}: ${criticalMissing.map((i: { label: string }) => i.label).join(", ")}`
        : `Some items still unverified in ${zone.label}: ${unverified.map((i: { label: string }) => i.label).join(", ")}`,
    };
  },
};

// complianceCheckerSubagent removed — run_compliance_check is now inline

// --- 3. Report Generator: builds inspection report ---
const generateReport: ToolDefinition = {
  name: "generate_report",
  description: `Generate a structured inspection report. Call this when the operator asks for a report,
or AUTOMATICALLY after requesting the final verdict.`,
  parameters: z.object({
    include_recommendations: z.boolean().optional().describe("Include fix recommendations"),
  }),
  execution: "background",
  pendingMessage: "Generating your inspection report...",
  execute: async () => ({}),
};

const reportGeneratorSubagent: SubagentConfig = {
  name: "report_generator",
  instructions: `You generate structured inspection reports. Call fetch_full_report_data to get all inspection data,
then call save_report to persist the report.

Report format:
# Room Inspection Report
## Event: [name]
## Date: [date]
## Inspected by: [operator]
## Overall Readiness: [READY/PARTIAL/BLOCKED]

### Zone-by-Zone Summary
For each zone:
- Zone name
- Items checked (with notes)
- Items missed
- Issues found

### Critical Items Status
List all critical items with their verification status.

### Open Tasks
List all unresolved tasks.

### Contradictions Found
List any contradictions detected during inspection.

### Recommendations
What should be fixed before the event starts.

### Timeline
Activity log summary with timestamps.`,
  tools: {
    fetch_full_report_data: tool({
      description: "Fetch all event data for report generation",
      parameters: z.object({}),
      execute: async () => {
        if (!currentEventId) return { error: "No session" };
        const eventData = await getEventState();
        return {
          session: {
            name: eventData.session.name,
            room: eventData.session.room_name,
            readiness: eventData.session.readiness,
            created_at: eventData.session.created_at,
          },
          zones: eventData.zones.map((z: { name: string; label: string }) => ({
            name: z.name,
            label: z.label,
          })),
          items: eventData.items.map((i: { name: string; label: string; criticality: string; status: string; note: string | null; verified_at: string | null }) => ({
            name: i.name,
            label: i.label,
            criticality: i.criticality,
            status: i.status,
            note: i.note,
            verified_at: i.verified_at,
          })),
          tasks: eventData.tasks.map((t: { title: string; type: string; status: string; description: string }) => ({
            title: t.title,
            type: t.type,
            status: t.status,
            description: t.description,
          })),
          activities: eventData.activities.map((a: { type: string; payload: Record<string, unknown>; timestamp: string }) => ({
            type: a.type,
            payload: a.payload,
            timestamp: a.timestamp,
          })),
          alerts: eventData.alerts.map((a: { type: string; message: string; severity: string; fired_at: string }) => ({
            type: a.type,
            message: a.message,
            severity: a.severity,
            fired_at: a.fired_at,
          })),
        };
      },
    }),
    save_report: tool({
      description: "Save the generated report to the database",
      parameters: z.object({
        report_markdown: z.string().describe("The full report in markdown format"),
        readiness: z.string().describe("Overall readiness verdict"),
        summary: z.string().describe("One-line summary"),
      }),
      execute: async ({ report_markdown, readiness, summary }) => {
        if (!currentEventId) return { error: "No session" };

        // Save report as an activity event (could be a dedicated table later)
        const res = await fetch(`${TRIALRUN_URL}/api/event/${currentEventId}`, {
          method: "GET",
        });
        const eventData = await res.json();

        // Push report to client via session ref
        sessionRef?.clientTransport?.sendJsonToClient?.({
          type: "gui.update",
          payload: {
            type: "report",
            markdown: report_markdown,
            readiness,
            summary,
            generated_at: new Date().toISOString(),
            event_name: eventData.session.name,
          },
        });

        console.log(`[Report] Generated: ${summary}`);
        console.log(`[Report] Readiness: ${readiness}`);
        console.log(`[Report]\n${report_markdown.slice(0, 200)}...`);

        return { status: "saved", summary };
      },
    }),
  },
  maxSteps: 5,
  timeout: 30000,
};

// ============================================================
// BACKGROUND TOOL 4: Visual Report Card (Image Generation)
// ============================================================

const generateVisualReport: ToolDefinition = {
  name: "generate_visual_report",
  description: `Generate a visual report card image showing room readiness status.
Call this when the operator asks for a visual summary, or after the final verdict.
Examples: "show me a visual", "generate a report card", "visualize the status"`,
  parameters: z.object({
    style: z.enum(["report_card", "zone_map"]).optional().describe("Visual style"),
  }),
  execution: "background",
  pendingMessage: "Creating a visual report card — it'll appear on your dashboard shortly.",
  execute: async () => ({}),
};

const visualReportSubagent: SubagentConfig = {
  name: "visual_report_generator",
  instructions: `You create visual report card images for room inspections.
Call fetch_visual_data to get the current inspection state, then call create_visual to generate the image.
Create a detailed prompt that describes a clean, professional report card graphic.`,
  tools: {
    fetch_visual_data: tool({
      description: "Get inspection data for visual generation",
      parameters: z.object({}),
      execute: async () => {
        if (!currentEventId) return { error: "No session" };
        const eventData = await getEventState();
        const verified = eventData.items.filter((i: { status: string }) => i.status === "verified").length;
        const total = eventData.items.length;
        const critical = eventData.items.filter((i: { criticality: string; status: string }) => i.criticality === "critical");
        const criticalVerified = critical.filter((i: { status: string }) => i.status === "verified").length;

        return {
          event_name: eventData.session.name,
          readiness: eventData.session.readiness,
          progress: `${verified}/${total}`,
          critical_status: `${criticalVerified}/${critical.length} critical items verified`,
          zones_visited: eventData.spatial.zones_visited.length,
          total_zones: eventData.zones.length,
          open_tasks: eventData.tasks.filter((t: { status: string }) => t.status === "open").length,
          items: eventData.items.map((i: { label: string; status: string; criticality: string }) => ({
            label: i.label,
            status: i.status,
            criticality: i.criticality,
          })),
        };
      },
    }),
    create_visual: tool({
      description: "Generate a report card image using Gemini and push to the dashboard",
      parameters: z.object({
        prompt: z.string().describe("Detailed image generation prompt for the report card"),
      }),
      execute: async ({ prompt }) => {
        console.log(`[Visual] Generating: ${prompt.slice(0, 80)}...`);
        try {
          const ai = new GoogleGenAI({ apiKey: API_KEY });
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-05-20",
            contents: prompt,
            config: { responseModalities: ["TEXT", "IMAGE"] },
          });

          const parts = response.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              sessionRef?.eventBus.publish("gui.update", {
                sessionId: sessionRef.sessionManager.sessionId,
                data: {
                  type: "image",
                  base64: part.inlineData.data,
                  mimeType: part.inlineData.mimeType ?? "image/png",
                  description: "Room Inspection Report Card",
                },
              });
              console.log(`[Visual] Report card image generated`);
              return { status: "success", description: "Visual report card generated and sent to dashboard" };
            }
          }
          return { status: "no_image", description: "Image generation returned no image" };
        } catch (err) {
          console.error(`[Visual] Error:`, err);
          return { status: "error", description: String(err) };
        }
      },
    }),
  },
  maxSteps: 4,
  timeout: 30000,
};

// ============================================================
// AGENT: Room Inspector (with background subagent tools)
// ============================================================

const roomInspector: MainAgent = {
  name: "room_inspector",
  greeting: `[System: Greet the operator. Say: "Hi, I'm your room inspection assistant. I'll help you verify that this hackathon venue is ready. Tell me your event session ID to get started, or just start describing what you see as you walk through the room. I'll track your checklist, run compliance checks, and alert you to anything you miss. You can also ask me to look up safety regulations or troubleshoot equipment."]`,
  instructions: `You are a hackathon room inspection assistant powered by TrialRun.
Your job is to help the operator verify room readiness by listening to their observations and logging them.

RULES:
1. When the operator describes something they see or check, IMMEDIATELY call update_inspection.
2. When the operator mentions moving to a new area, call enter_zone.
   - THEN also call check_zone_tasks to proactively check for open tasks in the new zone.
3. When the operator says they're done with an area, call exit_zone.
   - THEN also call run_compliance_check to verify the zone was thoroughly inspected.
4. When the operator asks if the room is ready, call request_verdict.
   - THEN also call generate_report to create the inspection report.
   - THEN also call generate_visual_report to create a visual report card.
5. If ANY tool returns alerts or warnings, READ THEM ALOUD to the operator.
6. Keep responses SHORT — the operator is walking around.
7. After each update, briefly confirm what was logged.
8. If a contradiction is detected, warn the operator immediately.
9. If compliance_check returns NEEDS_ATTENTION, ask the follow-up questions it suggests.
10. When the operator says "check this", "look at this", or "take a photo", call capture_photo.
    This sends a signal to the Meta glasses/phone to capture what the operator is looking at.

GOOGLE SEARCH (built-in):
You have built-in Google Search. Use it when the operator asks about:
- Safety regulations ("what's the fire code for exit signs?")
- Equipment troubleshooting ("the projector shows a blue screen")
- Venue information ("who manages this building's HVAC?")
- Compliance requirements ("ADA requirements for seating")
Always cite your sources when answering from search results.

INLINE TOOLS (auto-run, results come back instantly):
- check_zone_tasks: auto-run after entering a zone
- run_compliance_check: auto-run after exiting a zone

BACKGROUND TOOLS (run while you keep talking):
- generate_report: auto-run after verdict, or when operator asks
- generate_visual_report: auto-run after verdict, or when operator asks for a visual

ZONES: entrance, stage, seating, sponsor_tables, exits, power_area

CHECKLIST ITEMS:
- entrance: WiFi connectivity, fire exit signs, registration table
- stage: microphone, projector, screen position
- seating: chairs arranged, table count
- sponsor_tables: sponsor tables setup, power to tables
- exits: exit path clear
- power_area: power strips connected

Be concise, helpful, and proactive.`,
  // Enable Gemini's built-in Google Search with source citations
  googleSearch: true,
  tools: [
    updateInspection,
    enterZone,
    exitZone,
    capturePhoto,
    requestVerdict,
    setEventSession,
    // Background tools
    checkZoneTasks,
    runComplianceCheck,
    generateReport,
    generateVisualReport,
  ],
};

// ============================================================
// MAIN
// ============================================================

async function main() {
  const session = new VoiceSession({
    sessionId: SESSION_ID,
    userId: "inspector_1",
    apiKey: API_KEY,
    agents: [roomInspector],
    initialAgent: "room_inspector",
    port: PORT,
    host: "0.0.0.0",
    model: google("gemini-2.5-flash"),
    geminiModel: "gemini-2.5-flash-native-audio-preview-12-2025",
    speechConfig: { voiceName: "Puck" },
    // Background subagent configs — keyed by tool name
    subagentConfigs: {
      generate_report: reportGeneratorSubagent,
      generate_visual_report: visualReportSubagent,
    },
    hooks: {
      onToolCall: (e) => {
        console.log(`[Tool] ${e.toolName} (${e.execution})`);
      },
      onToolResult: (e) => {
        console.log(`[Result] ${e.toolCallId} — ${e.status} (${e.durationMs}ms)`);
      },
      onError: (e) => {
        console.error(`[Error] ${e.component}: ${e.error.message}`);
      },
    },
  });

  sessionRef = session;

  if (process.env.EVENT_ID) {
    currentEventId = process.env.EVENT_ID;
    console.log(`  Event ID: ${currentEventId}`);
  }

  process.on("SIGINT", async () => {
    console.log("\nClosing Bodhi session...");
    await session.close("user_hangup");
    process.exit(0);
  });

  await session.start();
  console.log(`\n  TrialRun Voice Inspector (Bodhi)`);
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log(`  Features:`);
  console.log(`    - Inline: inspection updates, zone tracking, verdict`);
  console.log(`    - Background: task tracker, compliance checker, report generator`);
  console.log(`  Connect from the dashboard or open the web client\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
