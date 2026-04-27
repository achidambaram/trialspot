# TrialRun

A real-time room readiness verification system that coordinates multiple operators to inspect event venues using AI-powered computer vision, voice input, and spatial reasoning.

Supervisors monitor progress from a command center dashboard while operators walk through zones on mobile devices, verifying checklist items via camera captures analyzed by Google Gemini and voice commands processed through a real-time WebSocket server.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (React 19, TypeScript) |
| **Styling** | Tailwind CSS 4 |
| **Database & Realtime** | Supabase (PostgreSQL + Realtime subscriptions) |
| **AI Vision** | Google Gemini 2.0 Flash |
| **Voice** | Bodhi Realtime Agent (WebSocket server) |
| **Spatial Computing** | SpatialWalk AvatarKit, SpatialReal API |
| **Validation** | Zod 4 |

---

## Prerequisites

- **Node.js** 18+
- **Supabase** project (free tier works)
- **Google Gemini API key** ([Get one here](https://aistudio.google.com/apikey))
- *(Optional)* SpatialReal credentials for avatar rendering
- *(Optional)* Cloudflare tunnel or similar for exposing the Bodhi voice server

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd trialrun
npm install
```

### 2. Set up Supabase

Create a Supabase project, then run the migration files **in order** in the Supabase SQL Editor:

```
supabase/migration.sql                       # Core schema (sessions, zones, checklist, tasks, activity log)
supabase/migration-002-operators.sql         # Multi-operator support
supabase/migration-003-operator-captures.sql # Operator camera captures
supabase/migration-004-replica-identity.sql  # Realtime optimization
```

### 3. Configure environment variables

Create a `.env.local` file in the project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Google Gemini
GOOGLE_GENERATIVE_AI_API_KEY=your-gemini-api-key
GEMINI_API_KEY=your-gemini-api-key

# SpatialReal (optional - for avatar rendering)
NEXT_PUBLIC_SPATIALREAL_APP_ID=your-app-id
NEXT_PUBLIC_SPATIALREAL_AVATAR_ID=your-avatar-id
SPATIALREAL_API_KEY=your-api-key

# Bodhi Voice Server (optional - for voice input)
NEXT_PUBLIC_BODHI_WS_URL=wss://your-tunnel-url
```

### 4. Set up the Bodhi voice server (optional)

```bash
cd bodhi-server
npm install
```

Create `bodhi-server/.env`:

```env
GEMINI_API_KEY=your-gemini-api-key
GOOGLE_GENERATIVE_AI_API_KEY=your-gemini-api-key
TRIALRUN_URL=http://localhost:3000
BODHI_PORT=9900
```

### 5. Run the application

```bash
# Terminal 1 - Next.js app
npm run dev

# Terminal 2 - Bodhi voice server (optional)
cd bodhi-server
npm run dev
```

The app runs at **http://localhost:3000**.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

---

## How It Works

### Roles

- **Supervisor** - Opens the command center dashboard on a desktop browser. Monitors all operators, views the live activity feed, tracks checklist progress, manages tasks, and triggers the final verdict.
- **Operator** - Opens the operator view on a mobile device. Walks through venue zones, captures images for AI analysis, uses voice commands, and manually verifies checklist items.

### Inspection Flow

1. **Create an event** at the home page (enter event name and room name)
2. The system seeds **6 zones** (entrance, stage, seating, sponsor tables, exits, power area) and **12 checklist items** with criticality levels
3. **Operators register** from their mobile devices and are assigned tasks
4. Operators **enter zones**, **capture images** (analyzed by Gemini), and **verify items** via camera or voice
5. The **spatial reasoning engine** detects missed checks on zone exit and contradictions (e.g., verifying an item in a zone you never visited)
6. The supervisor **triggers a verdict** when inspection is complete - the system evaluates overall readiness

### Readiness Levels

| Status | Meaning |
|---|---|
| **READY** | All critical and required items verified, all zones visited |
| **PARTIAL** | Some required items unverified or zones unvisited |
| **BLOCKED** | Critical items remain unverified |
| **UNKNOWN** | Inspection not yet started |

---

## Sample Use Case: Hackathon Venue Inspection

This walkthrough demonstrates a complete inspection using API calls. Replace `EVENT_ID` and `OPERATOR_ID` with the actual IDs returned.

### Step 1: Create an event

```bash
curl -X POST http://localhost:3000/api/event/create \
  -H "Content-Type: application/json" \
  -d '{"name": "HackSF 2026", "roomName": "Main Hall"}'
```

Returns session data with `id` (your `EVENT_ID`), 6 zones, and 12 checklist items.

### Step 2: Register an operator

```bash
curl -X POST http://localhost:3000/api/operators/register \
  -H "Content-Type: application/json" \
  -d '{"eventId": "EVENT_ID", "name": "Alice", "deviceId": "phone-001"}'
```

### Step 3: Enter a zone

```bash
curl -X POST http://localhost:3000/api/spatial/enter-zone \
  -H "Content-Type: application/json" \
  -d '{"eventId": "EVENT_ID", "zoneId": "ENTRANCE_ZONE_ID", "operatorId": "OPERATOR_ID"}'
```

### Step 4: Capture and analyze an image

```bash
curl -X POST http://localhost:3000/api/vision/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "EVENT_ID",
    "operatorId": "OPERATOR_ID",
    "imageBase64": "<base64-encoded-image>",
    "mimeType": "image/jpeg"
  }'
```

Gemini analyzes the image, auto-detects the zone, identifies verified checklist items, and flags issues.

### Step 5: Submit a voice/text inspection update

```bash
curl -X POST http://localhost:3000/api/inspection/update \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "EVENT_ID",
    "rawText": "The welcome signage is set up and visible at the entrance. Registration desk has power.",
    "currentZone": "entrance"
  }'
```

The parser matches text against checklist items and updates their status.

### Step 6: Exit the zone

```bash
curl -X POST http://localhost:3000/api/spatial/exit-zone \
  -H "Content-Type: application/json" \
  -d '{"eventId": "EVENT_ID", "zoneId": "ENTRANCE_ZONE_ID", "operatorId": "OPERATOR_ID"}'
```

The spatial reasoning engine checks for missed critical/required items and creates tasks if needed.

### Step 7: Trigger the final verdict

```bash
curl -X POST http://localhost:3000/api/event/EVENT_ID/verdict
```

Returns the overall readiness status, any alerts for skipped zones or unverified items, and open tasks.

### Using the UI Instead

1. Open **http://localhost:3000** in a desktop browser
2. Enter an event name and room name, then click **Create Event**
3. The command center dashboard opens with the zone map, checklist, and activity feed
4. Open **http://localhost:3000/event/EVENT_ID/operator** on a mobile device (or use responsive mode in DevTools)
5. Register as an operator, navigate through zones, capture images, and verify items
6. Watch the dashboard update in real-time as operators work

---

## Project Structure

```
src/
  app/
    page.tsx                          # Home - event creation
    event/[id]/
      dashboard.tsx                   # Command center (desktop)
      operator/operator-mobile.tsx    # Operator view (mobile)
      components/                     # Dashboard UI components
    api/                              # API routes
  lib/
    types.ts                          # TypeScript types & enums
    supabase.ts                       # Database clients
    state-engine.ts                   # Readiness computation & validation
    spatial-reasoning.ts              # Contradiction & missed check detection
    bodhi-parser.ts                   # Voice/text inspection parsing
    task-distributor.ts               # Operator task assignment
    seed-data.ts                      # Default zones & checklist items
supabase/                             # SQL migration files
bodhi-server/                         # Voice WebSocket server
```

---

## License

MIT
