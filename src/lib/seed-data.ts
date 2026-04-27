// Seed data for a single hackathon room with 6 zones and 12 checklist items

export const ZONES = [
  { name: "entrance", label: "Entrance Area" },
  { name: "stage", label: "Stage Area" },
  { name: "seating", label: "Seating Area" },
  { name: "sponsor_tables", label: "Sponsor Tables" },
  { name: "exits", label: "Exit Areas" },
  { name: "power_area", label: "Power Area" },
] as const;

export type ZoneName = (typeof ZONES)[number]["name"];

export interface ChecklistSeed {
  name: string;
  label: string;
  zone: ZoneName;
  criticality: "critical" | "required" | "nice_to_have";
}

export const CHECKLIST_ITEMS: ChecklistSeed[] = [
  // entrance
  {
    name: "wifi_tested",
    label: "WiFi connectivity tested",
    zone: "entrance",
    criticality: "critical",
  },
  {
    name: "fire_exit_signs",
    label: "Fire exit signs posted and visible",
    zone: "entrance",
    criticality: "critical",
  },
  {
    name: "registration_table",
    label: "Registration table set up",
    zone: "entrance",
    criticality: "required",
  },

  // stage
  {
    name: "microphone_tested",
    label: "Microphone tested and working",
    zone: "stage",
    criticality: "critical",
  },
  {
    name: "projector_working",
    label: "Projector working and visible",
    zone: "stage",
    criticality: "required",
  },
  {
    name: "screen_position",
    label: "Screen positioned correctly",
    zone: "stage",
    criticality: "nice_to_have",
  },

  // seating
  {
    name: "chairs_arranged",
    label: "Chairs arranged for attendees",
    zone: "seating",
    criticality: "required",
  },
  {
    name: "table_count",
    label: "Correct number of tables",
    zone: "seating",
    criticality: "required",
  },

  // sponsor_tables
  {
    name: "sponsor_tables_setup",
    label: "Sponsor tables set up with signage",
    zone: "sponsor_tables",
    criticality: "required",
  },
  {
    name: "power_to_tables",
    label: "Power available at sponsor tables",
    zone: "sponsor_tables",
    criticality: "required",
  },

  // exits
  {
    name: "exit_path_clear",
    label: "Exit paths clear and unobstructed",
    zone: "exits",
    criticality: "critical",
  },

  // power_area
  {
    name: "power_strips_connected",
    label: "Power strips connected and working",
    zone: "power_area",
    criticality: "required",
  },
];
