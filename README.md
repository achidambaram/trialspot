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
- **Cloudflare Tunnel** (`cloudflared`) for exposing the app over HTTPS (required for mobile camera access)
  - Install: `brew install cloudflared` (macOS) or see [Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)

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
TRIALRUN_URL=https://your-cloudflare-tunnel-url.trycloudflare.com
BODHI_PORT=9900
```

### 5. Run the application

The app requires a Cloudflare tunnel because mobile devices need HTTPS to access the camera. The Next.js config already allows `*.trycloudflare.com` origins.

```bash
# Terminal 1 - Next.js dev server
npm run dev

# Terminal 2 - Cloudflare tunnel (exposes the app over HTTPS)
cloudflared tunnel --url https://your-tunnel-url.trycloudflare.com
```

This gives you a public URL like `https://random-words.trycloudflare.com`. Use this URL to access the app from any device.

```bash
# Terminal 3 - Bodhi voice server (optional, for voice input)
cd bodhi-server
npm run dev

# Terminal 4 - Tunnel for Bodhi server (if using voice)
cloudflared tunnel --url http://localhost:9900
```

Update `NEXT_PUBLIC_BODHI_WS_URL` in `.env.local` with the Bodhi tunnel URL (use `wss://` prefix).

> **Note:** Cloudflare tunnel URLs change each restart. Update `.env.local` and restart the dev server when they change.

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
- **Operator** - Opens the operator view on a mobile device. Walks through venue zones, captures images for AI analysis, and uses voice commands to verify checklist items.

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

### Setup

1. Open the tunnel URL on a **desktop browser** — enter event name (e.g. "HackSF 2026") and room name (e.g. "Main Hall"), then click **Create Event**
2. The command center dashboard opens — leave this open to watch progress in real-time
3. Open the same tunnel URL on a **mobile phone** — it auto-redirects to the operator view
4. Enter your name and tap **Join**

### Walkthrough Script

Follow this script zone by zone. Use voice commands (tap the microphone) or the camera (tap **Capture** while pointing at the area). The system parses your speech, matches it to checklist items, and updates their status on the dashboard in real-time.

**Zone 1 — Entrance Area**

> *"I am at the entrance."*
> *"WiFi is connected and working."*
> *"Fire exit signs are posted and clearly visible."*
> *"Registration table is set up and ready."*
> *"I'm done here, exiting the entrance."*

**Zone 2 — Stage Area**

> *"I am at the stage area."*
> *"The microphone is tested and working."*
> *"Projector is on and visible from the audience."*
> *"Screen is positioned correctly."*
> *"Exiting the stage area."*

**Zone 3 — Seating Area**

> *"I am in the seating area."*
> *"Chairs are arranged for attendees."*
> *"Table count looks correct, all tables are in place."*
> *"Exiting the seating area."*

**Zone 4 — Sponsor Tables**

> *"I am at the sponsor tables."*
> *"Sponsor tables are set up with signage."*
> *"Power is available at the sponsor tables."*
> *"Exiting sponsor tables."*

**Zone 5 — Exit Areas**

> *"I am at the exit areas."*
> *"Exit paths are clear and unobstructed."*
> *"Exiting the exit area."*

**Zone 6 — Power Area**

> *"I am in the power area."*
> *"Power strips are connected and working."*
> *"Exiting the power area."*

### Triggering the Verdict

Back on the desktop dashboard, click **Request Verdict**. The system:
- Checks for any skipped zones or unverified critical items
- Generates alerts and tasks for anything missing
- Sets the overall readiness to **READY**, **PARTIAL**, or **BLOCKED**

If all items were verified across all zones, the readiness will be **READY**.

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
