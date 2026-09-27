/**
 * True School of Music (TSM) University Seed Dataset
 * Matches the rich interactive inventory in Practice Ready.
 */

export interface SeedRoom {
  id: number;
  name: string;
  code: string;
  capacity: number;
  description: string;
}

export interface SeedLocation {
  id: number;
  name: string;
  code: string;
  type: string;
}

export interface SeedEquipment {
  equipmentId: string;
  name: string;
  type: string;
  modelName?: string;
  condition: string;
  status: "ready" | "away" | "attention" | "service" | "missing";
  defaultLocationCode: string;
  currentLocationCode: string;
  defaultRoomCode: string;
  notes?: string;
}

export const SEED_ROOMS: SeedRoom[] = [
  {
    id: 2,
    name: "MPR 2",
    code: "mpr-2",
    capacity: 6,
    description: "Ensemble & Digital Piano Room equipped with Roland keyboard and JBL PA.",
  },
  {
    id: 3,
    name: "MPR 3",
    code: "mpr-3",
    capacity: 8,
    description: "Full Band Rehearsal & Drum Kit Room with Yamaha digital piano and Pearl drum kit.",
  },
  {
    id: 4,
    name: "MPR 4",
    code: "mpr-4",
    capacity: 4,
    description: "Vocal & Acoustic Practice Suite with Casio Privia piano and electronic tanpura.",
  },
  {
    id: 5,
    name: "MPR 5",
    code: "mpr-5",
    capacity: 4,
    description: "Guitar & Music Production Suite with Fender electric, bass, and Ampeg amplifier.",
  },
  {
    id: 1,
    name: "Performance Hall",
    code: "perf-hall",
    capacity: 25,
    description: "Grand Stage & Large Ensemble Rehearsal Space with Yamaha grand piano and full PA.",
  },
];

export const SEED_LOCATIONS: SeedLocation[] = [
  { id: 1, name: "MPR 2", code: "mpr-2", type: "room" },
  { id: 2, name: "MPR 3", code: "mpr-3", type: "room" },
  { id: 3, name: "MPR 4", code: "mpr-4", type: "room" },
  { id: 4, name: "MPR 5", code: "mpr-5", type: "room" },
  { id: 5, name: "Performance Hall", code: "perf-hall", type: "room" },
  { id: 6, name: "Arts Block A", code: "arts-block-a", type: "block" },
  { id: 7, name: "MP Lab 1", code: "mp-lab-1", type: "lab" },
  { id: 8, name: "Central Gear Storage", code: "central-storage", type: "storage" },
];

export const SEED_EQUIPMENT: SeedEquipment[] = [
  // MPR 3 Gear
  {
    equipmentId: "KEY-01",
    name: "Yamaha P-125 digital piano",
    type: "keyboard",
    modelName: "P-125",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "KEY-03-ADP-01",
    name: "Yamaha PA-150B AC adapter",
    type: "accessory",
    modelName: "PA-150B",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "MIX-01",
    name: "Yamaha MG10XU mixer",
    type: "mixer",
    modelName: "MG10XU",
    condition: "Fully functional",
    status: "away",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "arts-block-a",
    defaultRoomCode: "mpr-3",
    notes: "Currently borrowed by faculty in Arts Block A",
  },
  {
    equipmentId: "GTR-STAND-03-01",
    name: "Hercules Guitar Stand",
    type: "stand",
    modelName: "GS414B PLUS",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "GTR-STAND-03-02",
    name: "Hercules Guitar Stand",
    type: "stand",
    modelName: "GS414B PLUS",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "SPK-03-EON-01",
    name: "JBL EON ONE MK2 portable PA speaker",
    type: "speaker",
    modelName: "EON ONE MK2",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "SPK-PWR-03-EON-01",
    name: "JBL EON ONE MK2 power cable",
    type: "cable",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "MIC-01",
    name: "Shure SM58 dynamic vocal microphone",
    type: "mic",
    modelName: "SM58-LC",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "MS-01",
    name: "K&M 210/9 boom microphone stand",
    type: "stand",
    modelName: "210/9",
    condition: "Fully functional",
    status: "away",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mp-lab-1",
    defaultRoomCode: "mpr-3",
    notes: "In MP Lab 1 for recording session",
  },
  {
    equipmentId: "DRM-01-KICK",
    name: "Pearl Export kick drum 22x18",
    type: "drum",
    modelName: "Pearl Export",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "DRM-01-SNARE",
    name: "Pearl Export snare drum 14x5.5",
    type: "drum",
    modelName: "Pearl Export",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "DRM-01-HIHAT",
    name: "Sabian SBR 14-inch hi-hat cymbals",
    type: "drum",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "DRM-01-CRASH",
    name: "Sabian SBR 16-inch crash cymbal",
    type: "drum",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "DRM-01-RIDE",
    name: "Sabian SBR 20-inch ride cymbal",
    type: "drum",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "DRM-01-THRONE",
    name: "Pearl D-790 drum throne",
    type: "drum",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "XLR-03-01",
    name: "Mogami Gold Studio XLR cable 25ft",
    type: "cable",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },
  {
    equipmentId: "XLR-03-02",
    name: "Mogami Gold Studio XLR cable 25ft",
    type: "cable",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-3",
    currentLocationCode: "mpr-3",
    defaultRoomCode: "mpr-3",
  },

  // MPR 2 Gear
  {
    equipmentId: "KEY-02",
    name: "Roland FP-30X digital piano",
    type: "keyboard",
    modelName: "FP-30X",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-2",
    currentLocationCode: "mpr-2",
    defaultRoomCode: "mpr-2",
  },
  {
    equipmentId: "KEY-02-ADP-01",
    name: "Roland PSB-7U power adapter",
    type: "accessory",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-2",
    currentLocationCode: "mpr-2",
    defaultRoomCode: "mpr-2",
  },
  {
    equipmentId: "SPK-02-EON-01",
    name: "JBL EON ONE MK2 portable PA speaker",
    type: "speaker",
    modelName: "EON ONE MK2",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-2",
    currentLocationCode: "mpr-2",
    defaultRoomCode: "mpr-2",
  },
  {
    equipmentId: "SPK-PWR-02-EON-01",
    name: "JBL EON ONE MK2 power cable",
    type: "cable",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-2",
    currentLocationCode: "mpr-2",
    defaultRoomCode: "mpr-2",
  },

  // MPR 4 Gear
  {
    equipmentId: "KEY-04",
    name: "Casio Privia PX-S1100 digital piano",
    type: "keyboard",
    modelName: "PX-S1100",
    condition: "Minor sustain pedal sensitivity wear",
    status: "attention",
    defaultLocationCode: "mpr-4",
    currentLocationCode: "mpr-4",
    defaultRoomCode: "mpr-4",
    notes: "Pedal jack needs cleaning at next maintenance check",
  },
  {
    equipmentId: "TANPURA-01",
    name: "Radel Saarang electronic tanpura",
    type: "accessory",
    modelName: "Saarang Magic",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-4",
    currentLocationCode: "mpr-4",
    defaultRoomCode: "mpr-4",
  },
  {
    equipmentId: "WMIC-01",
    name: "Shure BLX24/SM58 wireless microphone system",
    type: "mic",
    modelName: "BLX24/SM58",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-4",
    currentLocationCode: "mpr-4",
    defaultRoomCode: "mpr-4",
  },

  // MPR 5 Gear
  {
    equipmentId: "GTR-05-01",
    name: "Fender Player Stratocaster electric guitar",
    type: "guitar",
    modelName: "Player Stratocaster",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-5",
    currentLocationCode: "mpr-5",
    defaultRoomCode: "mpr-5",
  },
  {
    equipmentId: "BASS-05-01",
    name: "Yamaha TRBX174 electric bass guitar",
    type: "guitar",
    modelName: "TRBX174",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-5",
    currentLocationCode: "mpr-5",
    defaultRoomCode: "mpr-5",
  },
  {
    equipmentId: "GAMP-05-01",
    name: "Fender Champion 40 guitar amplifier",
    type: "amplifier",
    modelName: "Champion 40",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-5",
    currentLocationCode: "mpr-5",
    defaultRoomCode: "mpr-5",
  },
  {
    equipmentId: "BAMP-05-01",
    name: "Ampeg BA-210 bass amplifier",
    type: "amplifier",
    modelName: "BA-210",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-5",
    currentLocationCode: "mpr-5",
    defaultRoomCode: "mpr-5",
  },
  {
    equipmentId: "GTR-RACK-05-01",
    name: "Hercules 5-piece multi-guitar rack",
    type: "stand",
    modelName: "GS525B",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "mpr-5",
    currentLocationCode: "mpr-5",
    defaultRoomCode: "mpr-5",
  },

  // Performance Hall Gear
  {
    equipmentId: "GPN-01",
    name: "Yamaha C3X Grand Piano",
    type: "keyboard",
    modelName: "C3X",
    condition: "Fully functional - tuned recently",
    status: "ready",
    defaultLocationCode: "perf-hall",
    currentLocationCode: "perf-hall",
    defaultRoomCode: "perf-hall",
  },
  {
    equipmentId: "PA-L-01",
    name: "JBL SRX835P main PA left speaker",
    type: "speaker",
    modelName: "SRX835P",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "perf-hall",
    currentLocationCode: "perf-hall",
    defaultRoomCode: "perf-hall",
  },
  {
    equipmentId: "PA-R-01",
    name: "JBL SRX835P main PA right speaker",
    type: "speaker",
    modelName: "SRX835P",
    condition: "Fully functional",
    status: "ready",
    defaultLocationCode: "perf-hall",
    currentLocationCode: "perf-hall",
    defaultRoomCode: "perf-hall",
  },
];
