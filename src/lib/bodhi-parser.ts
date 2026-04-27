import type { ChecklistItem, BodhiParsedUpdate } from "./types";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

// ============================================================
// LLM PARSER (Ollama — local, free, direct REST API)
// ============================================================

interface OllamaResponse {
  message?: { content?: string };
}

async function llmParse(
  rawText: string,
  checklist: ChecklistItem[],
  currentZone: string | null
): Promise<BodhiParsedUpdate> {
  const itemList = checklist
    .map((i) => `  "${i.name}": "${i.label}" (zone: ${i.zone_id}, ${i.criticality})`)
    .join("\n");

  const prompt = `You are an inspection parser. Match the operator's statement to ONE checklist item.

Checklist items:
${itemList}

Operator is in zone: ${currentZone || "none"}
Operator said: "${rawText}"

Respond with ONLY valid JSON, no other text:
{"item_name": "<name or null>", "status": "verified" or "flagged", "note": "<summary>", "confidence": <0-1>}

Rules:
- If no match, set item_name to null and confidence to 0
- If vague ("looks good"), set confidence below 0.5
- If operator reports a problem, set status to "flagged"
- confidence should be 0.8+ for clear matches`;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      format: "json",
    }),
    signal: AbortSignal.timeout(10000), // 10s timeout
  });

  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);

  const data = (await res.json()) as OllamaResponse;
  const content = data.message?.content || "";
  const parsed = JSON.parse(content);

  const matchedItem = parsed.item_name
    ? checklist.find((i) => i.name === parsed.item_name)
    : null;

  return {
    item_id: matchedItem?.id || null,
    status: parsed.status === "flagged" ? "flagged" : "verified",
    zone_hint: currentZone,
    note: parsed.note || rawText.trim(),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    raw_text: rawText,
  };
}

// ============================================================
// KEYWORD FALLBACK (no LLM needed)
// ============================================================

const KEYWORD_MAP: Record<string, string[]> = {
  wifi_tested: ["wifi", "wi-fi", "internet", "connectivity", "network"],
  fire_exit_signs: ["fire exit", "fire sign", "exit sign", "safety sign"],
  registration_table: ["registration", "reg table", "check-in", "checkin"],
  microphone_tested: ["mic", "microphone", "audio", "sound system"],
  projector_working: ["projector", "display", "beamer"],
  screen_position: ["screen position", "screen placed", "screen set"],
  chairs_arranged: ["chair", "seating", "seats", "arranged"],
  table_count: ["table count", "tables", "enough tables"],
  sponsor_tables_setup: ["sponsor", "sponsorship", "signage"],
  power_to_tables: ["power to table", "power at table", "outlet at table"],
  exit_path_clear: ["exit path", "exit clear", "path clear", "unobstructed"],
  power_strips_connected: ["power strip", "extension cord", "strips connected", "plugged in"],
};

const FLAG_WORDS = [
  "broken", "not working", "missing", "blocked", "dead", "failed",
  "no", "isn't", "doesn't", "can't", "problem", "issue", "bad", "wrong",
];

function keywordParse(
  rawText: string,
  checklist: ChecklistItem[],
  currentZone: string | null
): BodhiParsedUpdate {
  const lower = rawText.toLowerCase();

  let bestMatch: ChecklistItem | null = null;
  let bestScore = 0;

  for (const item of checklist) {
    const keywords = KEYWORD_MAP[item.name] || [];
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += kw.length;
    }
    for (const word of item.label.toLowerCase().split(/\s+/)) {
      if (word.length > 3 && lower.includes(word)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  let confidence = 0;
  if (bestScore >= 8) confidence = 0.95;
  else if (bestScore >= 5) confidence = 0.85;
  else if (bestScore >= 3) confidence = 0.7;
  else if (bestScore >= 1) confidence = 0.6;

  const isFlagged = FLAG_WORDS.some((w) => lower.includes(w));

  return {
    item_id: bestMatch?.id || null,
    status: isFlagged ? "flagged" : "verified",
    zone_hint: currentZone,
    note: rawText.trim(),
    confidence,
    raw_text: rawText,
  };
}

// ============================================================
// MAIN — tries Ollama, falls back to keywords
// ============================================================

export async function parseInspection(
  rawText: string,
  checklist: ChecklistItem[],
  currentZone: string | null
): Promise<BodhiParsedUpdate> {
  // Use fast keyword matching — LLM parsing is too slow for real-time voice
  return keywordParse(rawText, checklist, currentZone);
}
