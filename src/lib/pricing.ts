// ============================================================
// KECC COMPLETE PRICE BOOK — Knoxville, TN Market
// Positioning: Average to Slightly Above Average
// Built: March 2026
// All prices protect 20%+ minimum margin after subcontracting
// Residential monthly cap target: ~$500/mo max
// Commercial monthly cap target: ~$750/mo max
// ============================================================

export type ServiceType = "residential" | "commercial" | "both";
export type PricingModel = "flat" | "per_unit" | "tiered" | "hourly" | "per_sqft" | "per_lf" | "per_acre" | "mulch";

export interface PriceTier {
  label: string;
  min: number;
  max?: number;
  price: number;
}

export interface FrequencyDiscount {
  frequency: string;
  label: string;
  multiplierPerMonth: number;
  discountPct: number;
  annualMultiplier: number;
}

export interface ServiceDefinition {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  serviceType: ServiceType;
  tags: string[];
  pricingModel: PricingModel;
  unitLabel: string;
  tiers: PriceTier[];
  frequencies: FrequencyDiscount[];
  notes?: string;
  subCostPct: number;
  minimum?: number; // optional minimum charge per visit/job (0 or undefined = no minimum)
}

// ============================================================
// FREQUENCY PRESETS
// ============================================================
const FREQ_ONETIME: FrequencyDiscount = { frequency: "onetime", label: "One-Time", multiplierPerMonth: 0, discountPct: 0, annualMultiplier: 1 };
const FREQ_WEEKLY: FrequencyDiscount = { frequency: "weekly", label: "Weekly", multiplierPerMonth: 4.33, discountPct: 12, annualMultiplier: 12 };
const FREQ_BIWEEKLY: FrequencyDiscount = { frequency: "biweekly", label: "Bi-Weekly", multiplierPerMonth: 2.17, discountPct: 10, annualMultiplier: 12 };
const FREQ_MONTHLY: FrequencyDiscount = { frequency: "monthly", label: "Monthly", multiplierPerMonth: 1, discountPct: 8, annualMultiplier: 12 };
const FREQ_BIMONTHLY: FrequencyDiscount = { frequency: "bimonthly", label: "Bi-Monthly", multiplierPerMonth: 0.5, discountPct: 6, annualMultiplier: 12 };
const FREQ_QUARTERLY: FrequencyDiscount = { frequency: "quarterly", label: "Quarterly", multiplierPerMonth: 0.33, discountPct: 5, annualMultiplier: 12 };
const FREQ_ANNUAL: FrequencyDiscount = { frequency: "annual", label: "Annual", multiplierPerMonth: 0.083, discountPct: 3, annualMultiplier: 12 };

// Lawn-specific frequencies (seasonal — 9 months active March-November)
const FREQ_LAWN_WEEKLY: FrequencyDiscount = { frequency: "weekly", label: "Weekly", multiplierPerMonth: 4.33, discountPct: 12, annualMultiplier: 9 };
const FREQ_LAWN_BIWEEKLY: FrequencyDiscount = { frequency: "biweekly", label: "Bi-Weekly", multiplierPerMonth: 2.17, discountPct: 10, annualMultiplier: 9 };
const FREQ_LAWN_MONTHLY: FrequencyDiscount = { frequency: "monthly", label: "Monthly", multiplierPerMonth: 1, discountPct: 8, annualMultiplier: 9 };

// ============================================================
// COMPLETE SERVICE DEFINITIONS
// Knoxville market-realistic pricing
// subCostPct = what you pay a sub (0.78 = 78%, leaving 22% margin)
// ============================================================

export const services: ServiceDefinition[] = [
  // ──────────────────────────────────────────
  // LAWN CARE
  // ──────────────────────────────────────────
  {
    id: "lawn_mowing_res",
    name: "Lawn Mowing (Full Service)",
    category: "Lawn Care",
    subcategory: "Mowing",
    serviceType: "residential",
    tags: ["onetime", "standalonesub", "subaddin"],
    pricingModel: "per_acre",
    unitLabel: "per cut",
    tiers: [
      { label: "Per Acre", min: 0, price: 100 },
    ],
    frequencies: [
      FREQ_ONETIME,
      { ...FREQ_LAWN_WEEKLY, discountPct: 12 },
      { ...FREQ_LAWN_BIWEEKLY, discountPct: 10 },
      { ...FREQ_LAWN_MONTHLY, discountPct: 8 },
    ],
    notes: "Full-service cut includes mowing, edging, string trimming, blowing. Weed management and shrub trimming rolled into per-cut price for subscription clients. One-time cuts do NOT include weed/shrub work. Rate is per mowable acre — enter exact acreage for accurate pricing.",
    subCostPct: 0.78,
  },
  {
    id: "lawn_mowing_comm",
    name: "Lawn Mowing (Full Service)",
    category: "Lawn Care",
    subcategory: "Mowing",
    serviceType: "commercial",
    tags: ["onetime", "standalonesub", "subaddin"],
    pricingModel: "per_acre",
    unitLabel: "per cut",
    tiers: [
      { label: "Per Acre", min: 0, price: 120 },
    ],
    frequencies: [
      FREQ_ONETIME,
      { ...FREQ_LAWN_WEEKLY, discountPct: 12 },
      { ...FREQ_LAWN_BIWEEKLY, discountPct: 10 },
      { ...FREQ_LAWN_MONTHLY, discountPct: 8 },
    ],
    notes: "Commercial properties priced slightly higher due to liability, presentation standards, and scheduling requirements. Rate is per mowable acre — enter exact acreage for accurate pricing.",
    subCostPct: 0.78,
  },
  {
    id: "lawn_edging",
    name: "Edging (Standalone)",
    category: "Lawn Care",
    subcategory: "Edging",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "flat",
    unitLabel: "per visit",
    tiers: [
      { label: "Standard yard", min: 0, price: 25 },
      { label: "Large yard", min: 0, price: 40 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Edging is included in full-service mowing subscriptions. This is for standalone one-time edging requests only.",
    subCostPct: 0.78,
  },
  {
    id: "lawn_leaf",
    name: "Leaf Management",
    category: "Lawn Care",
    subcategory: "Leaf Management",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per visit",
    tiers: [
      { label: "Under ¼ acre", min: 0, max: 0.25, price: 65 },
      { label: "¼ – ½ acre", min: 0.25, max: 0.5, price: 100 },
      { label: "½ – 1 acre", min: 0.5, max: 1, price: 150 },
      { label: "1+ acre", min: 1, max: 99, price: 225 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Full-season cleanup priced separately. Haul-away adds $40-$75.",
    subCostPct: 0.78,
  },
  {
    id: "lawn_weeding",
    name: "Weeding (Standalone)",
    category: "Lawn Care",
    subcategory: "Weeding",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per visit",
    tiers: [
      { label: "Under ¼ acre", min: 0, max: 0.25, price: 60 },
      { label: "¼ – ½ acre", min: 0.25, max: 0.5, price: 85 },
      { label: "½ – 1 acre", min: 0.5, max: 1, price: 125 },
      { label: "1+ acre", min: 1, max: 99, price: 185 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Weeding included as-needed in lawn care subscriptions. This is for standalone one-time requests.",
    subCostPct: 0.78,
  },
  {
    id: "lawn_shrub",
    name: "Shrub Trimming (Standalone)",
    category: "Lawn Care",
    subcategory: "Shrub Trimming",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "per_unit",
    unitLabel: "per bush",
    tiers: [
      { label: "Small bush", min: 0, price: 12 },
      { label: "Medium bush", min: 0, price: 22 },
      { label: "Large bush", min: 0, price: 40 },
      { label: "Extra large / hedge (per hour)", min: 0, price: 45 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Shrub trimming included as-needed in lawn care subscriptions. Debris haul-away adds $40.",
    subCostPct: 0.78,
  },

  // ──────────────────────────────────────────
  // PRESSURE WASHING
  // ──────────────────────────────────────────
  {
    id: "pw_bin_cleaning",
    name: "Bin Cleaning",
    category: "Pressure Washing",
    subcategory: "Bin Cleaning",
    serviceType: "residential",
    tags: ["onetime", "subaddin"],
    pricingModel: "per_unit",
    unitLabel: "per bin",
    tiers: [
      { label: "1 bin", min: 1, price: 30 },
      { label: "Additional bin", min: 2, price: 15 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_MONTHLY, FREQ_BIMONTHLY, FREQ_QUARTERLY, FREQ_ANNUAL],
    notes: "Quarterly is the standard subscription frequency for bin cleaning.",
    subCostPct: 0.75,
  },
  {
    id: "pw_house_wash",
    name: "House Wash",
    category: "Pressure Washing",
    subcategory: "House/Building Wash",
    serviceType: "residential",
    tags: ["onetime", "subaddin"],
    pricingModel: "per_sqft",
    unitLabel: "sqft",
    tiers: [
      { label: "Soft wash ($0.15/sqft, $175 min)", min: 175, price: 0.15 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_QUARTERLY, FREQ_ANNUAL],
    notes: "Soft wash method. $0.15/sqft, $175 minimum. Annual is the typical subscription frequency.",
    subCostPct: 0.78,
  },
  {
    id: "pw_building_wash",
    name: "Building Wash",
    category: "Pressure Washing",
    subcategory: "House/Building Wash",
    serviceType: "commercial",
    tags: ["onetime", "subaddin"],
    pricingModel: "per_sqft",
    unitLabel: "sqft",
    tiers: [
      { label: "Commercial wash ($0.12/sqft, $275 min)", min: 275, price: 0.12 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_QUARTERLY, FREQ_ANNUAL],
    notes: "Commercial building wash. $0.12/sqft, $275 minimum. Annual is typical subscription frequency.",
    subCostPct: 0.78,
  },
  {
    id: "pw_flatwork_res",
    name: "Flatwork (Driveway/Patio/Sidewalk)",
    category: "Pressure Washing",
    subcategory: "Flatwork",
    serviceType: "residential",
    tags: ["onetime", "subaddin"],
    pricingModel: "per_sqft",
    unitLabel: "sqft",
    tiers: [
      { label: "Flatwork ($0.22/sqft, $85 min)", min: 85, price: 0.22 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_QUARTERLY, FREQ_ANNUAL],
    notes: "$0.22/sqft, $85 minimum. Covers driveways, patios, sidewalks.",
    subCostPct: 0.78,
  },
  {
    id: "pw_flatwork_comm",
    name: "Flatwork / Sidewalk Wash",
    category: "Pressure Washing",
    subcategory: "Flatwork",
    serviceType: "commercial",
    tags: ["onetime", "subaddin"],
    pricingModel: "per_sqft",
    unitLabel: "sqft",
    tiers: [
      { label: "Commercial flatwork ($0.18/sqft, $100 min)", min: 100, price: 0.18 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_QUARTERLY, FREQ_ANNUAL],
    notes: "$0.18/sqft, $100 minimum. Commercial sidewalks, entryways, lot areas.",
    subCostPct: 0.78,
  },
  {
    id: "pw_brick_upcharge",
    name: "Brick/Stone Upcharge",
    category: "Pressure Washing",
    subcategory: "Brick/Stone",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "flat",
    unitLabel: "upcharge %",
    tiers: [
      { label: "Brick exterior (+20%)", min: 0, price: 20 },
      { label: "Natural stone (+25%)", min: 0, price: 25 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Applied as a percentage upcharge on top of the house/building wash price.",
    subCostPct: 0.78,
  },
  {
    id: "pw_graffiti",
    name: "Graffiti Removal",
    category: "Pressure Washing",
    subcategory: "Graffiti Removal",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per job",
    tiers: [
      { label: "Small (under 25 sqft)", min: 0, max: 25, price: 100 },
      { label: "Medium (25-75 sqft)", min: 25, max: 75, price: 200 },
      { label: "Large (75-150 sqft)", min: 75, max: 150, price: 325 },
      { label: "XL (150+ sqft)", min: 150, max: 9999, price: 500 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "$50 minimum mobilization fee included in all tiers.",
    subCostPct: 0.78,
  },
  {
    id: "pw_dumpster_pad",
    name: "Dumpster Pad / Enclosure Cleaning",
    category: "Pressure Washing",
    subcategory: "Dumpster Pad",
    serviceType: "commercial",
    tags: ["onetime", "subaddin"],
    pricingModel: "tiered",
    unitLabel: "per pad",
    tiers: [
      { label: "Single dumpster enclosure", min: 0, max: 1, price: 110 },
      { label: "Double dumpster enclosure", min: 1, max: 2, price: 165 },
      { label: "Restaurant / grease area", min: 0, max: 1, price: 200 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_MONTHLY, FREQ_BIMONTHLY, FREQ_QUARTERLY],
    notes: "First-time / heavy buildup cleaning: add 25%. Quarterly is the standard subscription frequency.",
    subCostPct: 0.78,
  },

  // ──────────────────────────────────────────
  // ROOF CLEANING
  // ──────────────────────────────────────────
  {
    id: "roof_asphalt",
    name: "Roof Cleaning - Asphalt Shingle",
    category: "Roof Cleaning",
    subcategory: "Asphalt",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "per_sqft",
    unitLabel: "sqft",
    tiers: [
      { label: "Asphalt soft wash ($0.22/sqft, $275 min)", min: 275, price: 0.22 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "$0.22/sqft, $275 minimum. Soft wash only. Heavy moss/algae adds 15-25%.",
    subCostPct: 0.78,
  },
  {
    id: "roof_metal",
    name: "Roof Cleaning - Metal",
    category: "Roof Cleaning",
    subcategory: "Metal",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "per_sqft",
    unitLabel: "sqft",
    tiers: [
      { label: "Metal roof wash ($0.18/sqft, $225 min)", min: 225, price: 0.18 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "$0.18/sqft, $225 minimum. Pressure wash safe for metal roofs.",
    subCostPct: 0.78,
  },

  // ──────────────────────────────────────────
  // WINDOW CLEANING
  // ──────────────────────────────────────────
  {
    id: "window_ext_only",
    name: "Window Cleaning - Exterior Only",
    category: "Window Cleaning",
    subcategory: "Exterior Only",
    serviceType: "both",
    tags: ["onetime", "standalonesub", "subaddin"],
    pricingModel: "per_unit",
    unitLabel: "per pane",
    tiers: [
      { label: "1st floor pane", min: 0, price: 5 },
      { label: "2nd floor pane", min: 0, price: 7 },
      { label: "3rd floor pane", min: 0, price: 10 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_BIWEEKLY, FREQ_MONTHLY, FREQ_QUARTERLY],
    notes: "Bi-weekly is the most frequent offering. Monthly and quarterly also available.",
    subCostPct: 0.75,
  },
  {
    id: "window_int_ext",
    name: "Window Cleaning - Interior & Exterior",
    category: "Window Cleaning",
    subcategory: "Interior & Exterior",
    serviceType: "both",
    tags: ["onetime", "standalonesub", "subaddin"],
    pricingModel: "per_unit",
    unitLabel: "per pane",
    tiers: [
      { label: "1st floor pane", min: 0, price: 8 },
      { label: "2nd floor pane", min: 0, price: 11 },
      { label: "3rd floor pane", min: 0, price: 15 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_BIWEEKLY, FREQ_MONTHLY, FREQ_QUARTERLY],
    subCostPct: 0.75,
  },
  {
    id: "window_solar",
    name: "Solar Panel Cleaning",
    category: "Window Cleaning",
    subcategory: "Solar Panels",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "per_unit",
    unitLabel: "per panel",
    tiers: [
      { label: "Per panel", min: 0, price: 5 },
      { label: "Minimum charge (under 10 panels)", min: 0, price: 75 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_QUARTERLY, FREQ_ANNUAL],
    notes: "Minimum charge $75. 2nd story roof access adds $30 flat.",
    subCostPct: 0.75,
  },
  {
    id: "window_screen",
    name: "Screen Cleaning (Add-On)",
    category: "Window Cleaning",
    subcategory: "Screen Clean",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "per_unit",
    unitLabel: "per screen",
    tiers: [
      { label: "Per screen", min: 0, price: 3 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Add-on to window cleaning. Not sold standalone.",
    subCostPct: 0.75,
  },
  {
    id: "window_multi_story",
    name: "Multi-Story Window Access",
    category: "Window Cleaning",
    subcategory: "Multi-Story",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "per_unit",
    unitLabel: "upcharge per pane",
    tiers: [
      { label: "3rd story upcharge per pane", min: 0, price: 3 },
      { label: "4+ story (ladder/lift required) per pane", min: 0, price: 8 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Already reflected in per-pane pricing for 2nd/3rd floor. This covers additional access equipment needs.",
    subCostPct: 0.75,
  },

  // ──────────────────────────────────────────
  // GUTTER CLEANING
  // ──────────────────────────────────────────
  {
    id: "gutter_clean",
    name: "Gutter Cleaning",
    category: "Gutter Cleaning",
    subcategory: "Clean",
    serviceType: "both",
    tags: ["onetime", "subaddin"],
    pricingModel: "tiered",
    unitLabel: "per home/building",
    tiers: [
      { label: "1-story, under 150 LF", min: 0, max: 150, price: 120 },
      { label: "1-story, 150-200 LF", min: 150, max: 200, price: 150 },
      { label: "2-story, under 150 LF", min: 0, max: 150, price: 165 },
      { label: "2-story, 150-200 LF", min: 150, max: 200, price: 200 },
      { label: "2-story, 200+ LF", min: 200, max: 9999, price: 250 },
      { label: "Commercial (custom by LF)", min: 0, max: 9999, price: 1.25 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_QUARTERLY, FREQ_ANNUAL],
    notes: "Quarterly is standard subscription frequency. Heavy clog surcharge: +25%.",
    subCostPct: 0.78,
  },
  {
    id: "gutter_service",
    name: "Gutter Service (Install/Repair/Guards)",
    category: "Gutter Cleaning",
    subcategory: "Service",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per job",
    tiers: [
      { label: "Re-securing (first section)", min: 0, max: 1, price: 60 },
      { label: "Re-securing (each additional)", min: 1, max: 99, price: 35 },
      { label: "Minor repair (per section)", min: 0, max: 1, price: 95 },
      { label: "Gutter guards (per LF, basic mesh)", min: 0, max: 9999, price: 7 },
      { label: "Gutter guards (per LF, premium)", min: 0, max: 9999, price: 14 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Custom quotes for full replacements. Guard installation is per linear foot.",
    subCostPct: 0.78,
  },
  {
    id: "gutter_dryer_vent",
    name: "Dryer Vent Cleaning",
    category: "Gutter Cleaning",
    subcategory: "Dryer Vent",
    serviceType: "residential",
    tags: ["subaddin"],
    pricingModel: "tiered",
    unitLabel: "per vent",
    tiers: [
      { label: "Ground level / 1st floor exit", min: 0, price: 120 },
      { label: "2nd story wall exit", min: 0, price: 145 },
      { label: "Roof termination exit", min: 0, price: 175 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_ANNUAL],
    notes: "Annual is the standard subscription frequency. Fire prevention service.",
    subCostPct: 0.78,
  },

  // ──────────────────────────────────────────
  // PET WASTE REMOVAL
  // ──────────────────────────────────────────
  {
    id: "pet_waste_onetime",
    name: "Pet Waste - One-Time Cleanup",
    category: "Pet Waste Removal",
    subcategory: "One-Time",
    serviceType: "residential",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per visit",
    tiers: [
      { label: "Standard cleanup (1-2 dogs)", min: 0, max: 2, price: 50 },
      { label: "Standard cleanup (3+ dogs)", min: 3, max: 99, price: 70 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Standard one-time cleanup for yards not excessively neglected.",
    subCostPct: 0.75,
  },
  {
    id: "pet_waste_onetime_heavy",
    name: "Pet Waste - One-Time Heavy Cleanup",
    category: "Pet Waste Removal",
    subcategory: "One-Time Heavy",
    serviceType: "residential",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per visit",
    tiers: [
      { label: "Heavy cleanup (1-2 dogs)", min: 0, max: 2, price: 75 },
      { label: "Heavy cleanup (3+ dogs)", min: 3, max: 99, price: 100 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "For neglected yards — 2+ weeks of buildup.",
    subCostPct: 0.75,
  },
  {
    id: "pet_waste_1pet",
    name: "Pet Waste - 1 Pet Subscription",
    category: "Pet Waste Removal",
    subcategory: "1 Pet",
    serviceType: "residential",
    tags: ["standalonesub", "subaddin"],
    pricingModel: "flat",
    unitLabel: "per visit",
    tiers: [
      { label: "1 pet", min: 0, price: 15 },
    ],
    frequencies: [
      FREQ_ONETIME,
      { ...FREQ_WEEKLY, discountPct: 12 },
      { ...FREQ_BIWEEKLY, discountPct: 8 },
      { ...FREQ_MONTHLY, discountPct: 5 },
    ],
    notes: "Per-visit price. Weekly = best value.",
    subCostPct: 0.75,
  },
  {
    id: "pet_waste_2pet",
    name: "Pet Waste - 2 Pet Subscription",
    category: "Pet Waste Removal",
    subcategory: "2 Pets",
    serviceType: "residential",
    tags: ["standalonesub", "subaddin"],
    pricingModel: "flat",
    unitLabel: "per visit",
    tiers: [
      { label: "2 pets", min: 0, price: 22 },
    ],
    frequencies: [
      FREQ_ONETIME,
      { ...FREQ_WEEKLY, discountPct: 12 },
      { ...FREQ_BIWEEKLY, discountPct: 8 },
      { ...FREQ_MONTHLY, discountPct: 5 },
    ],
    subCostPct: 0.75,
  },
  {
    id: "pet_waste_3pet",
    name: "Pet Waste - 3+ Pet Subscription",
    category: "Pet Waste Removal",
    subcategory: "3+ Pets",
    serviceType: "residential",
    tags: ["standalonesub", "subaddin"],
    pricingModel: "flat",
    unitLabel: "per visit",
    tiers: [
      { label: "3+ pets", min: 0, price: 30 },
    ],
    frequencies: [
      FREQ_ONETIME,
      { ...FREQ_WEEKLY, discountPct: 12 },
      { ...FREQ_BIWEEKLY, discountPct: 8 },
      { ...FREQ_MONTHLY, discountPct: 5 },
    ],
    subCostPct: 0.75,
  },

  // ──────────────────────────────────────────
  // SNOW / ICE
  // ──────────────────────────────────────────
  {
    id: "snow_ice_prevention_res",
    name: "Ice Prevention (Residential)",
    category: "Snow/Ice",
    subcategory: "Ice Prevention",
    serviceType: "residential",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per event",
    tiers: [
      { label: "Driveway under 50 ft + sidewalks", min: 0, max: 50, price: 50 },
      { label: "Driveway over 50 ft + sidewalks", min: 50, max: 999, price: 75 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Per-event pricing. Includes driveway + sidewalk salt treatment.",
    subCostPct: 0.78,
  },
  {
    id: "snow_ice_prevention_comm",
    name: "Ice Prevention (Commercial)",
    category: "Snow/Ice",
    subcategory: "Ice Prevention",
    serviceType: "commercial",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per event",
    tiers: [
      { label: "Small (under 3,000 sqft)", min: 0, max: 3000, price: 125 },
      { label: "Large (over 3,000 sqft)", min: 3000, max: 99999, price: 225 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Includes sidewalks and entry areas. Per-event pricing.",
    subCostPct: 0.78,
  },
  {
    id: "snow_removal_res",
    name: "Snow Removal (Residential)",
    category: "Snow/Ice",
    subcategory: "Snow Removal",
    serviceType: "residential",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per event",
    tiers: [
      { label: "Driveway under 50 ft", min: 0, max: 50, price: 55 },
      { label: "Driveway over 50 ft", min: 50, max: 999, price: 85 },
      { label: "Sidewalk upcharge", min: 0, max: 1, price: 25 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Per-event pricing. Knoxville is event-driven — 4-6 inches average annual snowfall.",
    subCostPct: 0.78,
  },

  // ──────────────────────────────────────────
  // HANDYMAN
  // ──────────────────────────────────────────
  {
    id: "handyman_paint_touch",
    name: "Painting - Touch Up",
    category: "Handyman",
    subcategory: "Painting",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "flat",
    unitLabel: "per job",
    tiers: [
      { label: "Minor touch-up (1-2 hrs)", min: 0, price: 125 },
      { label: "Moderate touch-up (2-4 hrs)", min: 0, price: 225 },
    ],
    frequencies: [FREQ_ONETIME],
    subCostPct: 0.78,
  },
  {
    id: "handyman_paint_door",
    name: "Painting - Front Door",
    category: "Handyman",
    subcategory: "Painting",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "flat",
    unitLabel: "per door",
    tiers: [
      { label: "Front door (exterior side)", min: 0, price: 150 },
      { label: "Front door (both sides + frame)", min: 0, price: 225 },
    ],
    frequencies: [FREQ_ONETIME],
    subCostPct: 0.78,
  },
  {
    id: "handyman_paint_full",
    name: "Painting - Full Exterior",
    category: "Handyman",
    subcategory: "Painting",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "per_sqft",
    unitLabel: "sqft",
    tiers: [
      { label: "Standard siding ($1.75/sqft, $2,200 min)", min: 2200, price: 1.75 },
      { label: "Brick exterior ($2.25/sqft, $2,800 min)", min: 2800, price: 2.25 },
      { label: "Stucco ($2.00/sqft, $2,500 min)", min: 2500, price: 2.00 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Per sqft pricing — always subcontracted. Includes prep, prime, 2 coats. Customer provides color choice.",
    subCostPct: 0.80,
  },
  {
    id: "handyman_holiday_lights",
    name: "Holiday Light Installation",
    category: "Handyman",
    subcategory: "Home Service",
    serviceType: "residential",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per home",
    tiers: [
      { label: "Small home / roofline only (under 100 LF)", min: 0, max: 100, price: 225 },
      { label: "Standard home (100-200 LF)", min: 100, max: 200, price: 375 },
      { label: "Large home (200-300 LF)", min: 200, max: 300, price: 525 },
      { label: "XL / custom (300+ LF)", min: 300, max: 9999, price: 700 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Includes installation + takedown. Customer provides lights, or add 35% for lights-included.",
    subCostPct: 0.78,
  },
  {
    id: "handyman_security_cam",
    name: "Security Camera Installation",
    category: "Handyman",
    subcategory: "Home Service",
    serviceType: "residential",
    tags: ["onetime"],
    pricingModel: "per_unit",
    unitLabel: "per camera",
    tiers: [
      { label: "Wireless camera (labor only)", min: 0, price: 75 },
      { label: "Wired camera (labor only)", min: 0, price: 125 },
      { label: "Minimum charge", min: 0, price: 100 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Labor only — customer provides camera equipment. Minimum $100.",
    subCostPct: 0.78,
  },
  {
    id: "handyman_exterior_tuneup",
    name: "Exterior Tune-Up (Hourly)",
    category: "Handyman",
    subcategory: "Exterior Tune-Ups",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "hourly",
    unitLabel: "per hour",
    tiers: [
      { label: "General handyman rate", min: 0, price: 55 },
      { label: "Minimum service charge (1 hr)", min: 0, price: 55 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Covers adjustments, small repairs, light bulb changeouts, siding repair, etc. $55/hr, 1-hour minimum.",
    subCostPct: 0.78,
  },
  {
    id: "handyman_exterior_inspection",
    name: "Exterior Inspection & Adjustments",
    category: "Handyman",
    subcategory: "Exterior Tune-Ups",
    serviceType: "both",
    tags: ["subaddin"],
    pricingModel: "flat",
    unitLabel: "per visit",
    tiers: [
      { label: "Exterior inspection (included in TCEP)", min: 0, price: 0 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_QUARTERLY],
    notes: "FREE — included as a value-add in Total Care Exterior Plans. Quarterly frequency.",
    subCostPct: 0,
  },
  {
    id: "handyman_siding_repair",
    name: "Siding Repair",
    category: "Handyman",
    subcategory: "Exterior Tune-Ups",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per job",
    tiers: [
      { label: "Minor (1-2 panels)", min: 0, max: 2, price: 175 },
      { label: "Moderate (3-6 panels)", min: 3, max: 6, price: 325 },
      { label: "Major (7+ panels)", min: 7, max: 99, price: 525 },
    ],
    frequencies: [FREQ_ONETIME],
    subCostPct: 0.78,
  },

  // ──────────────────────────────────────────
  // PARKING LOT
  // ──────────────────────────────────────────
  {
    id: "parking_sweeping",
    name: "Parking Lot Sweeping",
    category: "Parking Lot",
    subcategory: "Sweeping",
    serviceType: "commercial",
    tags: ["subaddin"],
    pricingModel: "tiered",
    unitLabel: "per sweep",
    tiers: [
      { label: "Small (under 15,000 sqft / ~40 spaces)", min: 0, max: 15000, price: 65 },
      { label: "Medium (15,000-50,000 sqft / ~40-140 spaces)", min: 15000, max: 50000, price: 100 },
      { label: "Large (50,000-100,000 sqft / ~140-280 spaces)", min: 50000, max: 100000, price: 150 },
      { label: "XL (100,000+ sqft / 280+ spaces)", min: 100000, max: 9999999, price: 225 },
    ],
    frequencies: [FREQ_ONETIME, FREQ_WEEKLY, FREQ_BIWEEKLY, FREQ_MONTHLY],
    notes: "Weekly is most frequent offering. Manual push sweeping for smaller lots; truck for larger.",
    subCostPct: 0.78,
  },
  {
    id: "parking_reseal",
    name: "Parking Lot Resealing",
    category: "Parking Lot",
    subcategory: "Resealing",
    serviceType: "commercial",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per job",
    tiers: [
      { label: "Small lot (under 5,000 sqft)", min: 0, max: 5000, price: 1200 },
      { label: "Medium lot (5,000-15,000 sqft)", min: 5000, max: 15000, price: 2800 },
      { label: "Large lot (15,000-50,000 sqft)", min: 15000, max: 50000, price: 6000 },
      { label: "XL lot (50,000+ sqft)", min: 50000, max: 9999999, price: 11000 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Light repair and sealcoating. Not full repaving. Crack sealing adds 20-30%.",
    subCostPct: 0.80,
  },
  {
    id: "parking_restripe",
    name: "Parking Lot Restriping",
    category: "Parking Lot",
    subcategory: "Restriping",
    serviceType: "commercial",
    tags: ["onetime"],
    pricingModel: "per_unit",
    unitLabel: "per stall",
    tiers: [
      { label: "Standard stall restripe", min: 0, price: 12 },
      { label: "Handicap stall", min: 0, price: 90 },
      { label: "Fire lane (per LF)", min: 0, price: 2.00 },
      { label: "Directional arrow", min: 0, price: 25 },
      { label: "Stop bar", min: 0, price: 40 },
      { label: "Crosswalk", min: 0, price: 175 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Re-striping existing lines. New layout design adds 30-50%.",
    subCostPct: 0.78,
  },
  {
    id: "parking_driveway_reseal",
    name: "Driveway Resealing",
    category: "Parking Lot",
    subcategory: "Driveway Resealing",
    serviceType: "residential",
    tags: ["onetime"],
    pricingModel: "tiered",
    unitLabel: "per driveway",
    tiers: [
      { label: "Small (1-car, under 400 sqft)", min: 0, max: 400, price: 95 },
      { label: "Standard (2-car, 400-800 sqft)", min: 400, max: 800, price: 150 },
      { label: "Large (3-car+, 800-1,200 sqft)", min: 800, max: 1200, price: 225 },
      { label: "XL (1,200+ sqft)", min: 1200, max: 99999, price: 325 },
    ],
    frequencies: [FREQ_ONETIME],
    notes: "Sealcoat + minor crack repair. Minimum charge $95.",
    subCostPct: 0.78,
  },

  // ──────────────────────────────────────────
  // LANDSCAPING / MULCH
  // ──────────────────────────────────────────
  {
    id: "mulch_install",
    name: "Mulch Installation",
    category: "Landscaping",
    subcategory: "Mulch",
    serviceType: "both",
    tags: ["onetime"],
    pricingModel: "mulch",
    unitLabel: "per cubic yard",
    tiers: [],
    frequencies: [FREQ_ONETIME],
    notes: "Priced by cubic yards: (sqft × depth_in) ÷ 324, rounded up to nearest 0.5 yd. Includes material, delivery, and labor. Add-ons: bed weeding, edging, shrub trimming, debris haul-off.",
    subCostPct: 0.72,
    minimum: 175,
  },
];

// ============================================================
// MULCH PRICING ENGINE
// ============================================================

export interface MulchType {
  id: string;
  name: string;
  costPerYard: number;
  sellPerYard: number;
}

export interface MulchAddOn {
  id: string;
  label: string;
  price: number;
  unit: 'flat' | 'per_lf' | 'per_shrub';
}

export interface MulchDefaults {
  types: MulchType[];
  laborPerYard: number;
  deliveryFee: number;
  minimumJob: number;
  addOns: MulchAddOn[];
}

export const mulchDefaults: MulchDefaults = {
  types: [
    { id: 'hardwood',     name: 'Hardwood',              costPerYard: 32, sellPerYard: 55 },
    { id: 'double_shred', name: 'Double-Shred Hardwood', costPerYard: 36, sellPerYard: 62 },
    { id: 'cedar',        name: 'Cedar',                 costPerYard: 42, sellPerYard: 72 },
    { id: 'dyed',         name: 'Dyed Black/Red',        costPerYard: 38, sellPerYard: 65 },
    { id: 'rubber',       name: 'Rubber Mulch',          costPerYard: 75, sellPerYard: 120 },
  ],
  laborPerYard: 35,
  deliveryFee: 65,
  minimumJob: 175,
  addOns: [
    { id: 'weeding',  label: 'Bed Weeding',    price: 55,  unit: 'flat'      },
    { id: 'edging',   label: 'Bed Edging',     price: 1.5, unit: 'per_lf'   },
    { id: 'shrub',    label: 'Shrub Trimming', price: 20,  unit: 'per_shrub' },
    { id: 'haul_off', label: 'Debris Haul-Off',price: 65,  unit: 'flat'      },
  ],
};

export const MULCH_DIFFICULTY = [
  { id: 'easy',      label: 'Easy',      multiplier: 1.0  },
  { id: 'average',   label: 'Average',   multiplier: 1.15 },
  { id: 'difficult', label: 'Difficult', multiplier: 1.3  },
  { id: 'extreme',   label: 'Extreme',   multiplier: 1.5  },
] as const;

export const MULCH_DEPTHS = [1, 1.5, 2, 2.5, 3, 4] as const;

/** Calculate raw and rounded (up to nearest 0.5 yd) cubic yards */
export function calcMulchYards(sqft: number, depthInches: number): { raw: number; rounded: number } {
  const raw = (sqft * depthInches) / 324;
  const rounded = Math.ceil(raw * 2) / 2;
  return { raw, rounded };
}

/** Full mulch job price breakdown */
export function calcMulchPrice(opts: {
  sqft: number;
  depthInches: number;
  sellPerYard: number;
  laborPerYard: number;
  difficultyMultiplier: number;
  deliveryFee: number;
  minimumJob: number;
  addOns: { id: string; enabled: boolean; qty: number; price: number }[];
}): {
  rawYards: number;
  roundedYards: number;
  materialTotal: number;
  laborTotal: number;
  delivery: number;
  addOnsTotal: number;
  subtotal: number;
  finalPrice: number;
  hitMinimum: boolean;
} {
  const { raw, rounded } = calcMulchYards(opts.sqft, opts.depthInches);
  const materialTotal = Math.round(rounded * opts.sellPerYard * 100) / 100;
  const laborTotal = Math.round(rounded * opts.laborPerYard * opts.difficultyMultiplier * 100) / 100;
  const delivery = opts.deliveryFee;
  const addOnsTotal = opts.addOns
    .filter(a => a.enabled)
    .reduce((sum, a) => sum + a.price * a.qty, 0);
  const subtotal = materialTotal + laborTotal + delivery + addOnsTotal;
  const hitMinimum = subtotal < opts.minimumJob;
  const finalPrice = Math.round(Math.max(subtotal, opts.minimumJob) * 100) / 100;
  return { rawYards: raw, roundedYards: rounded, materialTotal, laborTotal, delivery, addOnsTotal, subtotal, finalPrice, hitMinimum };
}

// ============================================================
// RTCEP / CTCEP PLAN DEFINITIONS
// Lite plans are STANDALONE value packages (not a base for custom)
// Custom plans are built independently with their own services
// ============================================================

export interface TCEPLitePlan {
  name: string;
  type: "residential" | "commercial";
  monthlyPrice: number;
  includedServices: {
    serviceId: string;
    description: string;
    frequency: string;
  }[];
  perks: string[];
  commitmentMonths: number;
}

export const rtcepLite: TCEPLitePlan = {
  name: "Residential Total Care Exterior — Lite",
  type: "residential",
  monthlyPrice: 99.99,
  includedServices: [
    { serviceId: "pw_bin_cleaning", description: "Bin cleaning (2 bins)", frequency: "Quarterly" },
    { serviceId: "handyman_exterior_inspection", description: "Exterior inspection & adjustments", frequency: "Quarterly" },
    { serviceId: "gutter_dryer_vent", description: "Dryer vent cleaning", frequency: "Annual" },
  ],
  perks: [
    "10% discount on all one-time services",
    "Priority scheduling on all service requests",
    "Annual dryer vent cleaning included ($120+ value)",
  ],
  commitmentMonths: 6,
};

export const ctcepLite: TCEPLitePlan = {
  name: "Commercial Total Care Exterior — Lite",
  type: "commercial",
  monthlyPrice: 120.00,
  includedServices: [
    { serviceId: "pw_dumpster_pad", description: "Dumpster pad cleaning (single)", frequency: "Quarterly" },
    { serviceId: "handyman_exterior_inspection", description: "Exterior inspection & adjustments", frequency: "Quarterly" },
    { serviceId: "pw_flatwork_comm", description: "Entryway / front sidewalk wash", frequency: "Annual" },
  ],
  perks: [
    "10% discount on all one-time services",
    "Priority scheduling on all service requests",
    "Annual front-of-building sidewalk wash included",
  ],
  commitmentMonths: 6,
};

// ============================================================
// PRICING CALCULATION HELPERS
// ============================================================

export function calculatePerSqftPrice(
  tier: PriceTier,
  sqft: number,
): number {
  const calculated = tier.price * sqft;
  const minimum = tier.min; // min field stores the minimum charge for per_sqft tiers
  return Math.max(calculated, minimum);
}

export function calculateSubscriptionPrice(
  onetimePrice: number,
  frequency: FrequencyDiscount,
): { perVisit: number; monthlyAmount: number; annualAmount: number; savings: number } {
  if (frequency.frequency === "onetime") {
    return { perVisit: onetimePrice, monthlyAmount: 0, annualAmount: 0, savings: 0 };
  }

  const discountedPerVisit = onetimePrice * (1 - frequency.discountPct / 100);
  const monthlyAmount = discountedPerVisit * frequency.multiplierPerMonth;
  const annualAmount = monthlyAmount * frequency.annualMultiplier;
  const annualWithoutDiscount = onetimePrice * frequency.multiplierPerMonth * frequency.annualMultiplier;
  const savings = annualWithoutDiscount - annualAmount;

  return {
    perVisit: Math.round(discountedPerVisit * 100) / 100,
    monthlyAmount: Math.round(monthlyAmount * 100) / 100,
    annualAmount: Math.round(annualAmount * 100) / 100,
    savings: Math.round(savings * 100) / 100,
  };
}

export function getServicesByType(type: ServiceType): ServiceDefinition[] {
  return services.filter(s => s.serviceType === type || s.serviceType === "both");
}

export function getServicesByTag(tag: string): ServiceDefinition[] {
  return services.filter(s => s.tags.includes(tag));
}

export function getServiceCategories(type?: ServiceType): string[] {
  const filtered = type ? getServicesByType(type) : services;
  return Array.from(new Set(filtered.map(s => s.category)));
}

// ============================================================
// STACKING DISCOUNT HELPERS
// ============================================================

/**
 * Returns the bundle discount percentage based on the number of
 * recurring services in a TCEP/TPC custom plan.
 *   1 service  → 0%
 *   2 services → 10%
 *   3+ services → 15%
 * NOTE: Autopilot plans always use 0% regardless of count.
 */
export function getBundleDiscountPct(recurringServiceCount: number): number {
  if (recurringServiceCount >= 3) return 15;
  if (recurringServiceCount === 2) return 10;
  return 0;
}

/**
 * Given a pre-discount monthly subtotal and a service count,
 * returns the discounted total and the discount amount.
 */
export function applyBundleDiscount(
  monthlySubtotal: number,
  recurringServiceCount: number,
): { discountPct: number; discountAmount: number; discountedTotal: number } {
  const pct = getBundleDiscountPct(recurringServiceCount);
  const discountAmount = Math.round(monthlySubtotal * (pct / 100) * 100) / 100;
  const discountedTotal = Math.round((monthlySubtotal - discountAmount) * 100) / 100;
  return { discountPct: pct, discountAmount, discountedTotal };
}
