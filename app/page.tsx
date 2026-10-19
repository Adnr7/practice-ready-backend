"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Expand,
  Eye,
  EyeOff,
  Headphones,
  MapPin,
  Moon,
  Music2,
  Search,
  Sun,
  ShieldCheck,
  TriangleAlert,
  User,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchAvailability,
  fetchBookingStatus,
  fetchCurrentUser,
  fetchEquipmentInventory,
  fetchRooms,
  fetchRoomEquipment,
  fetchSchedule,
  login,
  logout,
  register,
  resolveRoomId,
  submitBooking,
  updateCurrentUser,
  type EquipmentItem,
  type RoomData,
  type ScheduleResponse,
  type UserProfile,
} from "@/lib/api-client";
import { addCalendarDays, getInstitutionNow, isValidCalendarDate, minutesToTime, timeToMinutes, type BookingPhase } from "@/lib/booking-engine";
import { equipmentImageUrl } from "@/lib/equipment-images";
import { LiveReservations, LiveSupport } from "@/components/live-workflows";
import SampleAccount, { AccountControls } from "@/components/sample-account";
import RoomAvailabilityCalendar from "@/components/room-availability-calendar";


const PRACTICE_READY_MUSIC_SRC = "/practice-ready-smooth-jazz.mp3";
const PRACTICE_READY_UI_TONE_SRC = "/practice-ready-ui-tone.wav";
const PRACTICE_READY_SUCCESS_CHIME_SRC = "/practice-ready-success-chime.wav";
const PRACTICE_READY_CONFLICT_TONE_SRC = "/practice-ready-conflict-soft-descending.mp3";
const PRACTICE_READY_PERIOD_TONE_SRCS = [
  "/practice-ready-period-early-morning.wav",
  "/practice-ready-period-morning.wav",
  "/practice-ready-period-afternoon.wav",
  "/practice-ready-period-evening.wav",
  "/practice-ready-period-night.wav",
  "/practice-ready-period-late-night.wav",
] as const;
const PRACTICE_READY_HOME_VOLUME = 0.23;
const PRACTICE_READY_INTERNAL_VOLUME_DESKTOP = 0.15;
const PRACTICE_READY_INTERNAL_VOLUME_MOBILE = 0.13;

let practiceReadyMusic: HTMLAudioElement | null = null;
let practiceReadyUiTone: HTMLAudioElement | null = null;
let practiceReadySuccessChime: HTMLAudioElement | null = null;
let practiceReadyConflictTone: HTMLAudioElement | null = null;
let practiceReadyPeriodTones: HTMLAudioElement[] | null = null;
let practiceReadyAudioContext: AudioContext | null = null;
let practiceReadyMediaSource: MediaElementAudioSourceNode | null = null;
let practiceReadyGainNode: GainNode | null = null;
let practiceReadyMusicMuted = false;
let practiceReadyMusicTargetVolume = PRACTICE_READY_HOME_VOLUME;
const practiceReadyMusicSubscribers = new Set<(muted: boolean) => void>();

function getPracticeReadyMusic() {
  if (typeof window === "undefined") return null;
  if (!practiceReadyMusic) {
    practiceReadyMusic = new Audio(PRACTICE_READY_MUSIC_SRC);
    practiceReadyMusic.loop = true;
    practiceReadyMusic.preload = "auto";
    // Desktop fallback. iOS may ignore HTMLMediaElement.volume, so the
    // Web Audio gain node below is the authoritative volume control there.
    practiceReadyMusic.volume = practiceReadyMusicMuted
      ? 0
      : practiceReadyMusicTargetVolume;
  }
  return practiceReadyMusic;
}

function ensurePracticeReadyAudioGraph() {
  if (typeof window === "undefined") return null;

  const audio = getPracticeReadyMusic();
  if (!audio) return null;

  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextCtor) return null;

  if (!practiceReadyAudioContext) {
    practiceReadyAudioContext = new AudioContextCtor();
  }

  if (!practiceReadyMediaSource) {
    practiceReadyMediaSource =
      practiceReadyAudioContext.createMediaElementSource(audio);
  }

  if (!practiceReadyGainNode) {
    practiceReadyGainNode = practiceReadyAudioContext.createGain();
    practiceReadyMediaSource.connect(practiceReadyGainNode);
    practiceReadyGainNode.connect(practiceReadyAudioContext.destination);
  }

  practiceReadyGainNode.gain.value = practiceReadyMusicMuted
    ? 0
    : practiceReadyMusicTargetVolume;

  return practiceReadyAudioContext;
}

function setPracticeReadyMusicVolume(volume: number) {
  practiceReadyMusicTargetVolume = volume;

  const audio = getPracticeReadyMusic();
  if (audio) {
    // Keep this as a desktop fallback. iOS can ignore this value.
    audio.volume = practiceReadyMusicMuted ? 0 : volume;
  }

  if (practiceReadyGainNode) {
    const context = practiceReadyAudioContext;
    const now = context?.currentTime ?? 0;
    practiceReadyGainNode.gain.cancelScheduledValues(now);
    practiceReadyGainNode.gain.setTargetAtTime(
      practiceReadyMusicMuted ? 0 : volume,
      now,
      0.08,
    );
  }
}

function setPracticeReadyMusicMuted(muted: boolean) {
  practiceReadyMusicMuted = muted;
  const audio = getPracticeReadyMusic();

  if (audio) {
    audio.muted = muted;
    audio.volume = muted ? 0 : practiceReadyMusicTargetVolume;
  }

  const context = ensurePracticeReadyAudioGraph();
  if (practiceReadyGainNode) {
    const now = context?.currentTime ?? 0;
    practiceReadyGainNode.gain.cancelScheduledValues(now);
    practiceReadyGainNode.gain.setTargetAtTime(
      muted ? 0 : practiceReadyMusicTargetVolume,
      now,
      0.05,
    );
  }

  if (!muted) {
    if (context?.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
    if (audio) void audio.play().catch(() => undefined);
  }

  practiceReadyMusicSubscribers.forEach((subscriber) => subscriber(muted));
}

function getPracticeReadyUiTone() {
  if (typeof window === "undefined") return null;
  if (!practiceReadyUiTone) {
    practiceReadyUiTone = new Audio(PRACTICE_READY_UI_TONE_SRC);
    practiceReadyUiTone.preload = "auto";
    practiceReadyUiTone.volume = 0.42;
  }
  return practiceReadyUiTone;
}

function playPracticeReadyButtonTone() {
  const audio = getPracticeReadyUiTone();
  if (!audio) return;

  try {
    audio.currentTime = 0;
  } catch {
    // Some mobile browsers may not allow seeking before metadata is ready.
  }

  void audio.play().catch(() => undefined);
}

function getPracticeReadySuccessChime() {
  if (typeof window === "undefined") return null;
  if (!practiceReadySuccessChime) {
    practiceReadySuccessChime = new Audio(PRACTICE_READY_SUCCESS_CHIME_SRC);
    practiceReadySuccessChime.preload = "auto";
    practiceReadySuccessChime.volume = 0.58;
  }
  return practiceReadySuccessChime;
}

function playPracticeReadySuccessChime() {
  const audio = getPracticeReadySuccessChime();
  if (!audio) return;

  try {
    audio.currentTime = 0;
  } catch {
    // Safe fallback for mobile media elements before metadata is ready.
  }

  void audio.play().catch(() => undefined);
}

function getPracticeReadyConflictTone() {
  if (typeof window === "undefined") return null;
  if (!practiceReadyConflictTone) {
    practiceReadyConflictTone = new Audio(PRACTICE_READY_CONFLICT_TONE_SRC);
    practiceReadyConflictTone.preload = "auto";
    practiceReadyConflictTone.volume = 0.52;
  }
  return practiceReadyConflictTone;
}

function playPracticeReadyConflictTone() {
  const audio = getPracticeReadyConflictTone();
  if (!audio) return;

  try {
    audio.currentTime = 0;
  } catch {
    // Safe fallback before metadata is ready on mobile browsers.
  }

  void audio.play().catch(() => undefined);
}

function getPracticeReadyPeriodTones() {
  if (typeof window === "undefined") return [];
  if (!practiceReadyPeriodTones) {
    practiceReadyPeriodTones = PRACTICE_READY_PERIOD_TONE_SRCS.map((src) => {
      const audio = new Audio(src);
      audio.preload = "auto";
      // Deliberately quieter than the standard selection tone: these belong
      // to the visual period-intro wave, not to ordinary button feedback.
      audio.volume = 0.18;
      return audio;
    });
  }
  return practiceReadyPeriodTones;
}

function playPracticeReadyPeriodTone(index: number) {
  const audio = getPracticeReadyPeriodTones()[index];
  if (!audio) return;

  try {
    audio.currentTime = 0;
  } catch {
    // Safe fallback before metadata is ready on mobile browsers.
  }

  void audio.play().catch(() => undefined);
}

function MusicToggle({ inline = false }: { inline?: boolean }) {
  const [muted, setMuted] = useState(practiceReadyMusicMuted);

  useEffect(() => {
    const subscriber = (nextMuted: boolean) => setMuted(nextMuted);
    practiceReadyMusicSubscribers.add(subscriber);
    return () => {
      practiceReadyMusicSubscribers.delete(subscriber);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={() => setPracticeReadyMusicMuted(!muted)}
      aria-label={muted ? "Turn background music on" : "Mute background music"}
      title={muted ? "Turn background music on" : "Mute background music"}
      className={`${
        inline
          ? "relative shrink-0"
          : "fixed right-5 top-5 sm:right-[5.25rem] sm:top-8"
      } z-50 grid h-11 w-11 place-items-center rounded-2xl border border-slate-200/80 bg-white/96 text-slate-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:border-violet-300 hover:bg-violet-50/90 hover:shadow-md dark:border-[#30384D]/90 dark:bg-[#1B2133]/96 dark:text-[#E7EAF2] dark:hover:border-[#4A3A67] dark:hover:bg-[#252C3E]`}
    >
      {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
    </button>
  );
}

type Screen =
  | "home"
  | "reservations"
  | "support"
  | "date"
  | "mpr"
  | "period"
  | "slots"
  | "setup"
  | "slots2"
  | "slots3"
  | "slots4"
  | "setup2"
  | "setup3"
  | "setup4"
  | "issues3"
  | "mixer-search"
  | "stand-search"
  | "alternative-search"
  | "slots5"
  | "setup5"
  | "issues5"
  | "available-equipment"
  | "review"
  | "recheck"
  | "success"
  | "conflict"
  | "booking-error"
  | "directory-search"
  | "directory-browse"
  | "schedule"
  | "availability"
  | "directory-results";

type Equipment = {
  id: string;
  name: string;
  modelName?: string;
  specifications?: string;
  defaultLocation?: string;
  currentLocation: string;
  condition: string;
  status: "ready" | "away" | "attention" | "service" | "missing";
};

type EquipmentLoadStatus = "idle" | "loading" | "loaded" | "error";

type RoomEquipmentViewState = {
  status: EquipmentLoadStatus;
  items: Equipment[];
  error?: string;
};

const equipmentFromApi = (item: EquipmentItem): Equipment => ({
  id: item.equipmentId,
  name: item.name,
  modelName: item.modelName ?? undefined,
  defaultLocation: item.defaultLocationName ?? undefined,
  currentLocation: item.currentLocationName ?? item.defaultLocationName ?? "Unknown",
  condition: item.condition,
  status: item.status,
});

const isExplicitDemoPresentation = () => {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get("demo") === "1" ||
    (typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_DEMO_PRESENTATION === "true")
  );
};

const subscribeDemoPresentation = () => () => {};
const getDemoPresentationSnapshot = () => isExplicitDemoPresentation();
const getDemoPresentationServerSnapshot = () => false;

const drumPartDefinitions = [
  ["KICK", "Kick drum"],
  ["SNARE", "Snare drum"],
  ["RACK-TOM", "Rack tom"],
  ["FLOOR-TOM", "Floor tom"],
  ["HIHAT", "Hi-hat cymbals"],
  ["CRASH", "Crash cymbal"],
  ["RIDE", "Ride cymbal"],
  ["KICK-PEDAL", "Kick pedal"],
  ["HIHAT-STAND", "Hi-hat stand"],
  ["CYMBAL-STAND", "Cymbal stand"],
  ["THRONE", "Drum throne"],
] as const;

const drumSetParts = (
  prefix: string,
  location: string,
  model: string,
  overrides: Record<string, Partial<Equipment>> = {},
): Equipment[] =>
  drumPartDefinitions.map(([suffix, name]) => ({
    id: `${prefix}-${suffix}`,
    name: `${model} ${name.toLowerCase()}`,
    currentLocation: location,
    condition: "Fully functional",
    status: "ready",
    ...overrides[suffix],
  }));

const numberedEquipment = (
  prefix: string,
  name: string,
  count: number,
  location: string,
): Equipment[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${String(i + 1).padStart(2, "0")}`,
    name: `${name} ${i + 1}`,
    currentLocation: location,
    condition: "Fully functional",
    status: "ready",
  }));

const mpr3: Equipment[] = [
  {
    id: "KEY-01",
    name: "Yamaha P-125 digital piano",
    currentLocation: "MPR 3",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "KEY-03-ADP-01",
    name: "Yamaha PA-150B AC adapter",
    currentLocation: "MPR 3",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "MIX-01",
    name: "Yamaha MG10XU mixer",
    currentLocation: "Arts Block A",
    condition: "Fully functional",
    status: "away",
  },
  {
    id: "GTR-STAND-03-01",
    name: "Guitar Stand",
    currentLocation: "MPR 3",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "GTR-STAND-03-02",
    name: "Guitar Stand",
    currentLocation: "MPR 3",
    condition: "Fully functional",
    status: "ready",
  },
  ...numberedEquipment("MON-03", "JBL 305P MkII monitor speaker", 2, "MPR 3"),
  {
    id: "SPK-03-EON-01",
    name: "JBL EON ONE MK2 portable PA speaker",
    currentLocation: "MPR 3",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "SPK-PWR-03-EON-01",
    name: "JBL EON ONE MK2 power cable",
    currentLocation: "MPR 3",
    condition: "Fully functional",
    status: "ready",
  },
  ...numberedEquipment("XLR-03", "Mogami Gold Studio XLR cable", 4, "MPR 3"),
  ...numberedEquipment(
    "INST-03",
    "Fender Professional Series instrument cable",
    4,
    "MPR 3",
  ),
  ...numberedEquipment(
    "MON-CBL-03",
    "Hosa CSS-110 balanced TRS cable",
    2,
    "MPR 3",
  ),
  {
    id: "MIX-PWR-01",
    name: "Yamaha MG10XU power adapter",
    currentLocation: "MPR 3",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "MIC-01",
    name: "Shure SM58 microphone",
    currentLocation: "MPR 3",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "MS-01",
    name: "K&M 210/9 boom microphone stand",
    currentLocation: "MP Lab 1",
    condition: "Fully functional",
    status: "away",
  },
  ...drumSetParts("DRM-01", "MPR 3", "Pearl Export"),
];

const mpr2: Equipment[] = [
  {
    id: "KEY-02",
    name: "Roland FP-30X digital piano",
    currentLocation: "MPR 2",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "KEY-02-ADP-01",
    name: "Roland PSB-7U power adapter",
    currentLocation: "MPR 2",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "SPK-02-EON-01",
    name: "JBL EON ONE MK2 portable PA speaker",
    currentLocation: "MPR 2",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "SPK-PWR-02-EON-01",
    name: "JBL EON ONE MK2 power cable",
    currentLocation: "MPR 2",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "TAN-02",
    name: "Radel Saarang electronic tanpura",
    currentLocation: "MPR 2",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "HAR-02",
    name: "Bina No. 23 harmonium",
    currentLocation: "MPR 2",
    condition: "Fully functional",
    status: "ready",
  },
];

const mpr4: Equipment[] = [
  {
    id: "KEY-04-01",
    name: "Yamaha P-45 digital piano",
    currentLocation: "MPR 4",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "KEY-04-02",
    name: "Yamaha P-125 digital piano",
    currentLocation: "MPR 4",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "KEY-04-03",
    name: "Casio Privia PX-S1100 digital piano",
    currentLocation: "MPR 4",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "KEY-04-04",
    name: "Roland FP-30X digital piano",
    currentLocation: "MPR 4",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "KEY-04-ADP-01",
    name: "Yamaha PA-150B AC adapter 1",
    currentLocation: "MPR 4",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "KEY-04-ADP-02",
    name: "Yamaha PA-150B AC adapter 2",
    currentLocation: "MPR 4",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "KEY-04-ADP-03",
    name: "Casio AD-A12150LW AC adapter",
    currentLocation: "MPR 4",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "KEY-04-ADP-04",
    name: "Roland PSB-7U power adapter",
    currentLocation: "MPR 4",
    condition: "Out of service",
    status: "service",
  },
];

const mpr5: Equipment[] = [
  {
    id: "KEY-05",
    name: "Roland FP-30X digital piano",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "KEY-05-ADP-01",
    name: "Roland PSB-7U power adapter",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "MIX-02",
    name: "Yamaha MG10XU mixer",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  ...numberedEquipment("MON-05", "JBL 305P MkII monitor speaker", 2, "MPR 5"),
  ...numberedEquipment("XLR-05", "Mogami Gold Studio XLR cable", 4, "MPR 5"),
  {
    id: "MON-CBL-02",
    name: "Hosa CSS-110 balanced TRS cable",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "MIX-PWR-02",
    name: "Yamaha MG10XU power adapter",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "MIC-02",
    name: "Shure SM58 microphone",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  ...drumSetParts("DRM-02", "MPR 5", "Mapex Tornado", {
    KICK: { condition: "Needs tuning", status: "attention" },
    SNARE: {
      currentLocation: "Unknown",
      condition: "Missing",
      status: "missing",
    },
    "RACK-TOM": { condition: "Needs tuning", status: "attention" },
    "FLOOR-TOM": { condition: "Needs tuning", status: "attention" },
  }),
  {
    id: "ACG-05-01",
    name: "Yamaha F310 acoustic guitar",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "ACG-05-02",
    name: "Fender CD-60S acoustic guitar",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "GTR-05",
    name: "Fender Player Stratocaster electric guitar",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "GTR-05-02",
    name: "Squier Classic Vibe '60s Telecaster electric guitar",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "BAS-05-01",
    name: "Yamaha TRBX174 bass guitar",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "BAS-05-02",
    name: "Ibanez GSR200 bass guitar",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "BAS-05-03",
    name: "Squier Affinity Jazz Bass",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "GTR-STAND-05-01",
    name: "Guitar Stand",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "GTR-STAND-05-02",
    name: "Guitar Stand",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "GTR-RACK-05-01",
    name: "Guitar Rack Floor Stand",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "BAMP-01",
    name: "Ampeg BA-210 bass amplifier",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "GAMP-01",
    name: "Boss Katana-50 MkII guitar amplifier",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "GAMP-05-02",
    name: "Fender Mustang LT25 guitar amplifier",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "INST-05-01",
    name: "Fender Professional Series instrument cable",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "INST-05-02",
    name: "Fender Professional Series instrument cable",
    currentLocation: "Unknown",
    condition: "Unknown",
    status: "missing",
  },
  {
    id: "INST-05-03",
    name: "Fender Professional Series instrument cable",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "INST-05-04",
    name: "Fender Professional Series instrument cable",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "BAMP-PWR-01",
    name: "Ampeg BA-210 power cable",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "GAMP-PWR-01",
    name: "Boss Katana-50 MkII power cable",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "GAMP-PWR-05-02",
    name: "Fender Mustang LT25 power cable",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
];

const mixerResults: Equipment[] = [
  {
    id: "MIX-01",
    name: "Yamaha MG10XU mixer",
    defaultLocation: "MPR 3",
    currentLocation: "Arts Block A",
    condition: "Fully functional",
    status: "away",
  },
  {
    id: "MIX-02",
    name: "Yamaha MG10XU mixer",
    defaultLocation: "MPR 5",
    currentLocation: "MPR 5",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "MIX-03",
    name: "Behringer Xenyx X1222USB mixer",
    defaultLocation: "MP Lab 2",
    currentLocation: "Store Room",
    condition: "Out of service",
    status: "service",
  },
];

const auditorium: Equipment[] = [
  {
    id: "FOH-CON-01",
    name: "Allen & Heath SQ-6 FOH digital console",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "PA-L-01",
    name: "JBL SRX835P left PA speaker",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "PA-R-01",
    name: "JBL SRX835P right PA speaker",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  ...numberedEquipment(
    "WEDGE",
    "Yamaha DBR12 stage wedge monitor",
    4,
    "Auditorium",
  ),
  {
    id: "GPN-01",
    name: "Yamaha C7X grand piano",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  ...drumSetParts("DRM-03", "Auditorium", "Yamaha Stage Custom"),
  ...numberedEquipment(
    "DRM-STK",
    "Vic Firth American Classic 5A drumstick pair",
    2,
    "Auditorium",
  ),
  ...numberedEquipment(
    "IEM-BP",
    "Sennheiser EK IEM G4 body pack",
    2,
    "Auditorium",
  ),
  ...numberedEquipment(
    "IEM",
    "Sennheiser IE 100 Pro in-ear monitor",
    2,
    "Auditorium",
  ),
  ...Array.from({ length: 4 }, (_, i): Equipment => ({
    id: `KMS-${String(i + 4).padStart(2, "0")}`,
    name: `K&M 210/9 boom microphone stand ${i + 1}`,
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  })),
  ...Array.from({ length: 2 }, (_, i): Equipment => ({
    id: `SM58-${String(i + 1).padStart(2, "0")}`,
    name: `Shure SM58 microphone ${i + 1}`,
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  })),
  ...Array.from({ length: 3 }, (_, i): Equipment => ({
    id: `WMIC-${String(i + 1).padStart(2, "0")}`,
    name: "Wireless Shure Mic",
    modelName: "SHURE SLX2/58 RADIOMIC TRANSMITTER",
    specifications: "Handheld · SM58 capsule · 606–630 MHz",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  })),
  ...Array.from({ length: 2 }, (_, i): Equipment => ({
    id: `SM57-${String(i + 1).padStart(2, "0")}`,
    name: `Shure SM57 microphone ${i + 1}`,
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  })),
  {
    id: "DRM-MIC-KICK-01",
    name: "Shure Beta 52A kick-drum microphone",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "DRM-MIC-SNARE-01",
    name: "Shure SM57 snare-drum microphone",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  ...numberedEquipment(
    "DRM-MIC-TOM",
    "Sennheiser e604 tom microphone",
    3,
    "Auditorium",
  ),
  {
    id: "DRM-MIC-OH-L",
    name: "AKG C214 left overhead condenser microphone",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "DRM-MIC-OH-R",
    name: "AKG C214 right overhead condenser microphone",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "DRM-MIC-HH-01",
    name: "Shure SM81 hi-hat condenser microphone",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  ...Array.from({ length: 8 }, (_, i): Equipment => ({
    id: `XLR-${String(i + 1).padStart(2, "0")}`,
    name: `Mogami Gold Studio XLR cable ${i + 1}`,
    currentLocation: "Auditorium",
    condition: i === 3 ? "Out of service" : "Fully functional",
    status: i === 3 ? "service" : "ready",
  })),
  {
    id: "BAMP-02",
    name: "Ampeg SVT-CL bass amplifier",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "BAMP-03",
    name: "Fender Rumble 100 bass amplifier",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "GAMP-02",
    name: "Fender Hot Rod Deluxe IV guitar amplifier",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "GAMP-03",
    name: "Marshall DSL40CR guitar amplifier",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  ...Array.from({ length: 6 }, (_, i): Equipment => ({
    id: `INST-${String(i + 1).padStart(2, "0")}`,
    name: `Fender Professional Series instrument cable ${i + 1}`,
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  })),
  {
    id: "SNAKE-01",
    name: "Whirlwind Medusa 32-channel stage snake",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "IEM-TX-01",
    name: "Sennheiser SR IEM G4 transmitter rack",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "LIGHT-CON-01",
    name: "ETC ColorSource 40 lighting console",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "LIGHT-RIG-01",
    name: "Chauvet Professional LED stage lighting rig",
    currentLocation: "Auditorium",
    condition: "Fully functional",
    status: "ready",
  },
];

const studio: Equipment[] = [
  {
    id: "SSL-AWS-01",
    name: "Solid State Logic AWS 948 mixing console",
    currentLocation: "Studio",
    condition: "Fully functional",
    status: "ready",
  },
  ...numberedEquipment(
    "GEN-8040B",
    "Genelec 8040B monitor speaker",
    2,
    "Studio",
  ),
  ...numberedEquipment("GEN-7360A", "Genelec 7360A subwoofer", 2, "Studio"),
  {
    id: "SCARLETT-18I20-01",
    name: "Focusrite Scarlett 18i20 2nd Gen audio interface",
    currentLocation: "Studio",
    condition: "Fully functional",
    status: "ready",
  },
  ...numberedEquipment(
    "CM25",
    "Focusrite CM25 condenser microphone",
    2,
    "Studio",
  ),
  ...numberedEquipment(
    "ATH-M30X",
    "Audio-Technica ATH-M30x headphones",
    2,
    "Studio",
  ),
  {
    id: "MS-03",
    name: "K&M 210/9 boom microphone stand 1",
    currentLocation: "Studio",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "KMS-02",
    name: "K&M 210/9 boom microphone stand 2",
    currentLocation: "Studio",
    condition: "Fully functional",
    status: "ready",
  },
  ...numberedEquipment(
    "MOG-XLR-STU",
    "Mogami Gold Studio XLR cable",
    4,
    "Studio",
  ),
  ...numberedEquipment("HOSA-CPP", "Hosa CPP-830 patch cable", 4, "Studio"),
];

const liveRoom: Equipment[] = [
  ...numberedEquipment("YAM-HS8", "Yamaha HS8 monitor speaker", 2, "Live Room"),
  {
    id: "SCARLETT-18I20-02",
    name: "Focusrite Scarlett 18i20 2nd Gen audio interface",
    currentLocation: "Live Room",
    condition: "Fully functional",
    status: "ready",
  },
  ...drumSetParts(
    "DRM-LR-01",
    "Live Room",
    "Tama Imperialstar",
    Object.fromEntries(
      drumPartDefinitions.map(([suffix]) => [
        suffix,
        { condition: "Out of service", status: "service" as const },
      ]),
    ),
  ),
  ...numberedEquipment("SM58-LR", "Shure SM58 microphone", 2, "Live Room"),
  ...numberedEquipment(
    "KMS-LR",
    "K&M 210/9 boom microphone stand",
    2,
    "Live Room",
  ),
  ...numberedEquipment(
    "MOG-XLR-LR",
    "Mogami Gold Studio XLR cable",
    4,
    "Live Room",
  ),
];

const mpLab1: Equipment[] = [
  ...numberedEquipment(
    "IMAC-MPL1",
    "Apple iMac 24-inch M1 production workstation",
    15,
    "MP Lab 1",
  ),
  ...numberedEquipment(
    "MPK-MPL1",
    "Akai MPK Mini Mk3 MIDI controller",
    4,
    "MP Lab 1",
  ),
  ...numberedEquipment(
    "FLX4-MPL1",
    "Pioneer DJ DDJ-FLX4 controller",
    2,
    "MP Lab 1",
  ),
  ...numberedEquipment(
    "SCARLETT-2I2-MPL1",
    "Focusrite Scarlett 2i2 3rd Gen audio interface",
    4,
    "MP Lab 1",
  ),
  ...numberedEquipment(
    "ATH-M20X-MPL1",
    "Audio-Technica ATH-M20x headphones",
    15,
    "MP Lab 1",
  ),
  ...numberedEquipment(
    "ERIS-MPL1",
    "PreSonus Eris 3.5 monitor speaker",
    2,
    "MP Lab 1",
  ),
];

const mpLab2: Equipment[] = [
  ...numberedEquipment(
    "IMAC-MPL2",
    "Apple iMac 24-inch M1 production workstation",
    15,
    "MP Lab 2",
  ),
  ...numberedEquipment(
    "CDJ-900NXS",
    "Pioneer CDJ-900NXS player",
    2,
    "MP Lab 2",
  ),
  {
    id: "DJM-750MK2-01",
    name: "Pioneer DJM-750MK2 DJ mixer",
    currentLocation: "MP Lab 2",
    condition: "Fully functional",
    status: "ready",
  },
  ...numberedEquipment(
    "LAUNCHKEY-MPL2",
    "Novation Launchkey Mini Mk3 MIDI controller",
    2,
    "MP Lab 2",
  ),
  ...numberedEquipment(
    "SCARLETT-2I2-MPL2",
    "Focusrite Scarlett 2i2 3rd Gen audio interface",
    4,
    "MP Lab 2",
  ),
  ...numberedEquipment(
    "HD280-MPL2",
    "Sennheiser HD 280 Pro headphones",
    15,
    "MP Lab 2",
  ),
  ...numberedEquipment(
    "ROKIT5-MPL2",
    "KRK Rokit 5 G4 monitor speaker",
    2,
    "MP Lab 2",
  ),
  mixerResults[2],
];

const storeRoom: Equipment[] = [
  mixerResults[2],
  {
    id: "KEY-SR-ADP-01",
    name: "Yamaha PA-150B AC adapter",
    currentLocation: "Store Room",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "KEY-SR-ADP-02",
    name: "Roland PSB-7U power adapter",
    currentLocation: "Store Room",
    condition: "Fully functional",
    status: "ready",
  },
  {
    id: "SM58-SPARE-01",
    name: "Shure SM58 microphone",
    currentLocation: "Store Room",
    condition: "Fully functional",
    status: "ready",
  },
  ...numberedEquipment(
    "KMS-SPARE",
    "K&M 210/9 boom microphone stand",
    3,
    "Store Room",
  ),
  ...numberedEquipment(
    "MOG-XLR-SPARE",
    "Mogami Gold Studio XLR cable",
    6,
    "Store Room",
  ),
  ...numberedEquipment(
    "FEN-INST-SPARE",
    "Fender Professional Series instrument cable",
    6,
    "Store Room",
  ),
  ...numberedEquipment(
    "HERC-KS120B",
    "Hercules KS120B keyboard stand",
    3,
    "Store Room",
  ),
  ...numberedEquipment(
    "ATH-M20X-SPARE",
    "Audio-Technica ATH-M20x headphones",
    4,
    "Store Room",
  ),
];

const withDefaultLocation = (items: Equipment[], location: string) =>
  items.map((item) => ({
    ...item,
    defaultLocation: item.defaultLocation ?? location,
  }));

const directoryEquipment: Equipment[] = Array.from(
  new Map(
    [
      ...withDefaultLocation(mpr2, "MPR 2"),
      ...withDefaultLocation(mpr3, "MPR 3"),
      ...withDefaultLocation(mpr4, "MPR 4"),
      ...withDefaultLocation(mpr5, "MPR 5"),
      ...withDefaultLocation(auditorium, "Auditorium"),
      ...withDefaultLocation(studio, "Studio"),
      ...withDefaultLocation(liveRoom, "Live Room"),
      ...withDefaultLocation(mpLab1, "MP Lab 1"),
      ...withDefaultLocation(mpLab2, "MP Lab 2"),
      ...withDefaultLocation(storeRoom, "Store Room"),
    ].map((item) => [item.id, item]),
  ).values(),
);

const fixtureEquipmentForRoom = (roomName: string): Equipment[] => {
  if (roomName === "MPR 2") return mpr2;
  if (roomName === "MPR 4") return mpr4;
  if (roomName === "MPR 5") return mpr5;
  return mpr3;
};

const emptyEquipment: Equipment[] = [];

const normalizeEquipmentSearch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    // Forgive the most likely student shorthand / typo variants without
    // turning the search into fuzzy matching that could create false results.
    .replace(/\bmicrphone\b/g, "microphone")
    .replace(/\bmicphone\b/g, "microphone")
    .replace(/\bmike\b/g, "mic")
    .replace(/\bkeybord\b/g, "keyboard")
    .replace(/\bguiter\b/g, "guitar")
    .replace(/\badaptor\b/g, "adapter");

const containsNormalizedPhrase = (text: string, phrase: string) => {
  if (!phrase) return false;
  return (
    text === phrase ||
    text.startsWith(`${phrase} `) ||
    text.endsWith(` ${phrase}`) ||
    text.includes(` ${phrase} `)
  );
};

const equipmentSearchTags = (item: Equipment) => {
  const text = normalizeEquipmentSearch(`${item.name} ${item.modelName ?? ""} ${item.specifications ?? ""} ${item.id}`);
  const tags: string[] = [];

  // General student terminology.
  if (/\b(microphone|mic)\b/.test(text))
    tags.push("mic microphone");
  if (
    /wireless shure mic/.test(text) ||
    /shure slx2 58 radiomic transmitter/.test(text)
  ) {
    tags.push(
      "wireless mic wireless microphone cordless mic cordless microphone radio mic radio microphone radiomic radiomic transmitter handheld mic handheld microphone shure wireless mic shure wireless microphone shure radio mic shure radio microphone slx2 slx2 58 sm58 wireless mic sm58 wireless microphone",
    );
  }
  if (/\bheadphones?\b/.test(text))
    tags.push("headphone headphones");
  if (/\b(speaker|monitor)\b/.test(text))
    tags.push("speaker speakers monitor monitors");
  if (
    /jbl eon one mk2/.test(text) &&
    /\bpower cable\b/.test(text)
  ) {
    tags.push(
      "speaker cable speaker power cable pa speaker cable pa power cable jbl cable jbl power cable eon cable eon power cable jbl eon cable jbl eon power cable",
    );
  }
  if (/\bcables?\b/.test(text))
    tags.push("cable cables cord lead");
  if (/\bmixers?\b/.test(text))
    tags.push("mixer mixers");
  if (/\b(amplifier|amp)\b/.test(text))
    tags.push("amp amps amplifier amplifiers");

  // Compatibility / relationship language students naturally type.
  // These are search aliases only; they do not change what any item actually is.
  if (/\bxlr\b/.test(text) && /\bcable\b/.test(text)) {
    tags.push(
      "mic cable microphone cable mic xlr microphone xlr vocal mic cable vocal microphone cable",
    );
  }

  if (/\binstrument\b/.test(text) && /\bcable\b/.test(text)) {
    tags.push(
      "guitar cable electric guitar cable electric guitar lead acoustic electric guitar cable acoustic electric lead bass cable bass guitar cable bass guitar lead instrument lead guitar lead bass lead",
    );
  }

  if (
    /mixer to monitor cable|mixer-to-monitor cable|hosa css 110 balanced trs cable/.test(
      item.name.toLowerCase(),
    )
  ) {
    tags.push(
      "mixer cable monitor cable speaker cable mixer monitor cable mixer to monitor cable mixer to speaker cable monitor speaker cable studio monitor cable",
    );
  }

  if (/\bpower\b/.test(text) && /\b(cable|adapter)\b/.test(text)) {
    tags.push("power cable power adapter power supply mains cable");
  }

  // Keyboard/digital-piano power supplies in the prototype have model names,
  // so add the way a student is much more likely to search for them.
  if (
    /yamaha pa 150b/.test(text) ||
    /roland psb 7u/.test(text) ||
    /casio ad a12150lw/.test(text) ||
    /keyboard.*adapter/.test(text) ||
    /piano.*adapter/.test(text)
  ) {
    tags.push(
      "keyboard adapter keyboard power adapter keyboard cable keyboard power cable keyboard power supply piano adapter piano cable piano power cable digital piano adapter digital piano cable digital piano power cable",
    );
  }

  if (
    (/yamaha mg10xu/.test(text) && /\b(power adapter|power cable|adapter)\b/.test(text)) ||
    /\bmix pwr\b/.test(text)
  ) {
    tags.push(
      "mixer adapter mixer power cable mixer power adapter mixer power supply mixer mains cable",
    );
  }

  const isGuitarAmpPowerCable =
    /\bgamp pwr\b/.test(text) ||
    (/\b(boss katana|fender mustang)\b/.test(text) && /\bpower cable\b/.test(text));
  if (isGuitarAmpPowerCable) {
    tags.push(
      "guitar amp cable guitar amplifier cable guitar amp power cable guitar amplifier power cable amp power cable amplifier power cable",
    );
  }

  const isBassAmpPowerCable =
    /\bbamp pwr\b/.test(text) ||
    (/\bampeg ba 210\b/.test(text) && /\bpower cable\b/.test(text));
  if (isBassAmpPowerCable) {
    tags.push(
      "bass amp cable bass amplifier cable bass amp power cable bass amplifier power cable amp power cable amplifier power cable",
    );
  }

  if (/\bmicrophone stand\b|\bmic stand\b/.test(text))
    tags.push("mic stand microphone stand vocal mic stand vocal microphone stand");

  if (/\bkeyboard stand\b|\bpiano stand\b/.test(text))
    tags.push("keyboard stand piano stand digital piano stand");

  if (/\bguitar stand\b/.test(text))
    tags.push("guitar stand guitar stands instrument stand instrument stands");

  if (/\bguitar rack floor stand\b/.test(text))
    tags.push(
      "guitar rack guitar floor rack guitar rack stand guitar floor stand multi guitar stand multi guitar rack instrument rack floor guitar rack",
    );

  if (/\bmonitor speaker\b/.test(text))
    tags.push("monitor speaker studio monitor studio speaker");

  const isDrumRelated =
    /\bdrum\b/.test(text) ||
    /\b(kick|snare|rack tom|floor tom|tom|hi hat|hihat|crash|ride|cymbal|throne|kick pedal)\b/.test(text) ||
    /\bdrm\b/.test(text);
  if (isDrumRelated)
    tags.push("drum drums drumset drum set percussion");

  if (/\bhi hat\b/.test(text) || /\bhihat\b/.test(text))
    tags.push("hi hat hihat hi-hat");

  // Mapping intent:
  // mic/microphone cable -> XLR cable
  // guitar/bass-guitar cable -> instrument cable
  // keyboard/piano cable or adapter -> keyboard/digital-piano power adapter
  // guitar amplifier cable -> guitar-amplifier power cable
  // bass amplifier cable -> bass-amplifier power cable
  // mixer-to-monitor/monitor/speaker cable -> balanced TRS monitor cable
  return normalizeEquipmentSearch(`${text} ${tags.join(" ")}`);
};

const equipmentType = (item: Equipment) => {
  const name = normalizeEquipmentSearch(item.name);

  // Specific accessory/microphone types must be classified before their
  // broader drum terms so they cannot masquerade as drum alternatives.
  if (/kick drum microphone|kick microphone/.test(name)) return "kick-drum-microphone";
  if (/snare drum microphone|snare microphone/.test(name)) return "snare-drum-microphone";
  if (/hi hat stand|hihat stand/.test(name)) return "hi-hat-stand";
  if (/cymbal stand/.test(name)) return "cymbal-stand";
  if (/kick pedal/.test(name)) return "kick-pedal";
  if (/drum throne/.test(name)) return "drum-throne";
  if (/floor tom/.test(name)) return "floor-tom";
  if (/rack tom/.test(name)) return "rack-tom";
  if (/snare drum/.test(name)) return "snare-drum";
  if (/kick drum/.test(name)) return "kick-drum";
  if (/hi hat cymbals|hihat cymbals|hi hat/.test(name)) return "hi-hat-cymbals";
  if (/crash cymbal/.test(name)) return "crash-cymbal";
  if (/ride cymbal/.test(name)) return "ride-cymbal";
  if (/instrument cable/.test(name)) return "instrument-cable";
  if (/xlr/.test(name) && /cable/.test(name)) return "xlr-cable";
  if (/microphone stand|mic stand/.test(name)) return "microphone-stand";
  if (/keyboard stand|piano stand/.test(name)) return "keyboard-stand";
  if (
    /\b(drum set|drum kit|kick drum|bass drum|snare drum|rack tom|floor tom|tom drum|hi[- ]?hat|crash cymbal|ride cymbal|china cymbal|splash cymbal)\b/.test(name)
  ) return "drum-kit";
  if (/monitor speaker/.test(name)) return "monitor-speaker";
  if (/yamaha pa 150b ac adapter/.test(name)) return "yamaha-pa150b-adapter";
  if (/roland psb 7u power adapter/.test(name)) return "roland-psb7u-adapter";
  if (/casio ad a12150lw ac adapter/.test(name)) return "casio-ada12150lw-adapter";
  if (/mixer/.test(name)) return "mixer";
  if (/\bamplifier\b|\bguitar amp\b|\bbass amp\b/.test(name)) return "amplifier";
  if (/digital piano|grand piano|acoustic piano|keyboard/.test(name)) return "keyboard-piano";
  return "";
};

const requestedAlternativeType = (value: string) => {
  const query = normalizeEquipmentSearch(value);
  if (query === "floor tom") return "floor-tom";
  if (query === "rack tom") return "rack-tom";
  if (query === "snare drum") return "snare-drum";
  if (query === "kick drum") return "kick-drum";
  if (query === "hi hat" || query === "hi hat cymbals" || query === "hihat") return "hi-hat-cymbals";
  if (query === "crash cymbal") return "crash-cymbal";
  if (query === "ride cymbal") return "ride-cymbal";
  if (query === "kick pedal") return "kick-pedal";
  if (query === "hi hat stand" || query === "hihat stand") return "hi-hat-stand";
  if (query === "cymbal stand") return "cymbal-stand";
  if (query === "drum throne") return "drum-throne";
  if (query === "instrument cable") return "instrument-cable";
  if (query === "xlr cable") return "xlr-cable";
  if (query === "microphone stand" || query === "mic stand") return "microphone-stand";
  if (query === "keyboard stand" || query === "piano stand") return "keyboard-stand";
  if (query === "drum" || query === "drums" || query === "drum kit" || query === "drum set") return "drum-kit";
  if (query === "mixer") return "mixer";
  if (
    query === "amp" ||
    query === "amps" ||
    query === "amplifier" ||
    query === "amplifiers" ||
    query === "guitar amp" ||
    query === "bass amp"
  ) return "amplifier";
  if (query === "monitor speaker" || query === "monitor") return "monitor-speaker";
  if (query === "yamaha pa 150b ac adapter") return "yamaha-pa150b-adapter";
  if (query === "roland psb 7u power adapter") return "roland-psb7u-adapter";
  if (query === "casio ad a12150lw ac adapter") return "casio-ada12150lw-adapter";
  if (query === "keyboard" || query === "digital piano" || query === "piano")
    return "keyboard-piano";
  return "";
};

const alternativeQueryForItem = (item: Equipment) => {
  const labels: Record<string, string> = {
    "floor-tom": "Floor tom",
    "rack-tom": "Rack tom",
    "snare-drum": "Snare drum",
    "kick-drum": "Kick drum",
    "hi-hat-cymbals": "Hi-hat cymbals",
    "crash-cymbal": "Crash cymbal",
    "ride-cymbal": "Ride cymbal",
    "kick-pedal": "Kick pedal",
    "hi-hat-stand": "Hi-hat stand",
    "cymbal-stand": "Cymbal stand",
    "drum-throne": "Drum throne",
    "instrument-cable": "Instrument cable",
    "xlr-cable": "XLR cable",
    "microphone-stand": "Microphone stand",
    "keyboard-stand": "Keyboard stand",
    "drum-kit": "Drum kit",
    "monitor-speaker": "Monitor speaker",
    "yamaha-pa150b-adapter": "Yamaha PA-150B AC adapter",
    "roland-psb7u-adapter": "Roland PSB-7U power adapter",
    "casio-ada12150lw-adapter": "Casio AD-A12150LW AC adapter",
    mixer: "Mixer",
    amplifier: "Amplifier",
    "keyboard-piano": "Digital piano",
  };
  return labels[equipmentType(item)] ?? item.name;
};

const alternativeEquipmentMatches = (item: Equipment, value: string) => {
  const requestedType = requestedAlternativeType(value);
  if (requestedType && equipmentType(item) === requestedType) return true;
  return appWideEquipmentSearchRank(item, value) < 99;
};

const equipmentQueryWords = (value: string) => {
  const normalized = normalizeEquipmentSearch(value);
  if (!normalized) return [];

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (word === "mics") return "mic";
      if (word === "amps") return "amp";
      if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
      return word;
    });
};

const equipmentSearchWordMatches = (searchWord: string, queryWord: string) => {
  if (searchWord === queryWord) return true;

  // Three characters is enough to make prefix filtering useful while avoiding
  // noisy matches from one- and two-letter fragments.
  if (queryWord.length >= 3 && searchWord.startsWith(queryWord)) return true;

  // "mic" is accepted as the common shorthand for "microphone".
  if (queryWord === "mic" && searchWord === "microphone") return true;
  if (queryWord === "microphone" && searchWord === "mic") return true;

  return false;
};

const appWideEquipmentSearchRank = (item: Equipment, value: string) => {
  const normalized = normalizeEquipmentSearch(value);
  if (!normalized) return 0;

  const itemName = normalizeEquipmentSearch(item.name);
  const itemId = normalizeEquipmentSearch(item.id);
  const searchable = equipmentSearchTags(item);
  const queryWords = equipmentQueryWords(normalized);
  const searchableWords = searchable.split(" ").filter(Boolean);

  const everyQueryWordMatches = queryWords.every((queryWord) =>
    searchableWords.some((searchWord) =>
      equipmentSearchWordMatches(searchWord, queryWord),
    ),
  );

  if (!everyQueryWordMatches) return 99;

  const nameWords = itemName.split(" ").filter(Boolean);
  const idWords = itemId.split(" ").filter(Boolean);

  // Exact/near-exact label matches first.
  if (itemName === normalized || itemId === normalized) return 0;

  const allWordsInNameOrId = queryWords.every((queryWord) =>
    [...nameWords, ...idWords].some((word) =>
      equipmentSearchWordMatches(word, queryWord),
    ),
  );
  if (allWordsInNameOrId) return 1;

  // Category/compatibility aliases (e.g. "mic cable" -> XLR cable,
  // "guitar cable" -> instrument cable, "keyboard adapter" -> its adapter).
  return 2;
};

const locationEquipmentSearchRank = (
  item: Equipment,
  normalizedQuery: string,
) => {
  if (!normalizedQuery) return 0;

  const itemName = normalizeEquipmentSearch(item.name);
  const itemId = normalizeEquipmentSearch(item.id);
  const type = equipmentType(item);

  // "tom" is a shorthand category search: actual rack/floor toms are the
  // primary results; items such as tom microphones are secondary results.
  if (normalizedQuery === "tom" || normalizedQuery === "toms") {
    if (type === "floor-tom" || type === "rack-tom") return 0;
    if (
      containsNormalizedPhrase(itemName, "tom") ||
      containsNormalizedPhrase(itemId, "tom")
    ) {
      return 1;
    }
    return 99;
  }

  // Broad drum searches include the actual kit parts first and drum-specific
  // accessories afterwards.
  if (
    normalizedQuery === "drum" ||
    normalizedQuery === "drums" ||
    normalizedQuery === "drum kit" ||
    normalizedQuery === "drum set"
  ) {
    const mainDrumTypes = new Set([
      "kick-drum",
      "snare-drum",
      "rack-tom",
      "floor-tom",
      "hi-hat-cymbals",
      "crash-cymbal",
      "ride-cymbal",
      "drum-kit",
    ]);
    if (mainDrumTypes.has(type)) return 0;

    const drumAccessoryTypes = new Set([
      "kick-pedal",
      "hi-hat-stand",
      "cymbal-stand",
      "drum-throne",
    ]);
    if (drumAccessoryTypes.has(type)) return 1;

    if (
      containsNormalizedPhrase(itemName, "drum") ||
      containsNormalizedPhrase(itemId, "drum")
    ) {
      return 1;
    }
    return 99;
  }

  const requestedType = requestedAlternativeType(normalizedQuery);

  // Actual requested equipment always comes before related label matches.
  if (requestedType && type === requestedType) return 0;

  // Secondary matches require the query to occur as a whole word/phrase,
  // preventing false matches such as "tom" inside "Custom" or "amp" inside
  // "Ampeg".
  if (
    containsNormalizedPhrase(itemName, normalizedQuery) ||
    containsNormalizedPhrase(itemId, normalizedQuery)
  ) {
    return 1;
  }

  return 99;
};


const resolveEquipmentFilterPrefix = (value: string) => {
  const query = normalizeEquipmentSearch(value);
  if (!query) return "";

  // Current-list searches behave like live filters. Once a user has typed a
  // meaningful prefix of a common equipment term, treat it as that full term
  // so "mic", "micro", "microp"... all behave like "microphone", and the
  // same interaction applies to other equipment categories.
  const canonicalTerms = [
    "microphone",
    "microphone stand",
    "mixer",
    "monitor",
    "monitor speaker",
    "keyboard",
    "digital piano",
    "piano",
    "amplifier",
    "guitar",
    "electric guitar",
    "acoustic guitar",
    "bass guitar",
    "instrument cable",
    "xlr cable",
    "cable",
    "headphones",
    "speaker",
    "drum",
    "drum kit",
    "floor tom",
    "rack tom",
    "snare drum",
    "kick drum",
    "hi hat",
    "crash cymbal",
    "ride cymbal",
    "harmonium",
    "tanpura",
    "controller",
    "adapter",
    "power cable",
    "stand",
  ];

  if (query.length >= 3) {
    const exactOrPrefix = canonicalTerms.find(
      (term) => term === query || term.startsWith(query),
    );
    if (exactOrPrefix) return exactOrPrefix;
  }

  return query;
};

const equipmentWordsPrefixMatch = (text: string, query: string) => {
  const textWords = normalizeEquipmentSearch(text).split(" ").filter(Boolean);
  const queryWords = normalizeEquipmentSearch(query).split(" ").filter(Boolean);
  if (!queryWords.length) return false;

  return queryWords.every((queryWord) =>
    textWords.some(
      (textWord) =>
        textWord === queryWord ||
        (queryWord.length >= 3 && textWord.startsWith(queryWord)),
    ),
  );
};

const liveListEquipmentSearchRank = (item: Equipment, value: string) => {
  const rawQuery = normalizeEquipmentSearch(value);
  if (!rawQuery) return 0;

  const resolvedQuery = resolveEquipmentFilterPrefix(rawQuery);
  const itemName = normalizeEquipmentSearch(item.name);
  const itemId = normalizeEquipmentSearch(item.id);

  // For microphone prefixes, actual microphones should come before related
  // labels such as microphone stands.
  if (
    rawQuery.length >= 3 &&
    "microphone".startsWith(rawQuery)
  ) {
    const hasMicrophoneWord = itemName
      .split(" ")
      .some((word) => word === "microphone");
    if (hasMicrophoneWord && equipmentType(item) !== "microphone-stand") return 0;
    if (
      equipmentWordsPrefixMatch(itemName, rawQuery) ||
      equipmentWordsPrefixMatch(itemId, rawQuery)
    ) {
      return 1;
    }
    return 99;
  }

  // Reuse the established category ordering whenever the typed prefix resolves
  // to a known equipment term.
  const establishedRank = locationEquipmentSearchRank(item, resolvedQuery);
  if (establishedRank < 99) return establishedRank;

  // Otherwise behave like a true live filter over the labels/IDs and the same
  // app-wide compatibility aliases, so multi-word searches such as
  // "mic cable", "guitar cable" and "keyboard adapter" work here too.
  const semanticRank = appWideEquipmentSearchRank(item, rawQuery);
  if (semanticRank < 99) return 2 + semanticRank;

  if (
    equipmentWordsPrefixMatch(itemName, rawQuery) ||
    equipmentWordsPrefixMatch(itemId, rawQuery)
  ) {
    return 5;
  }

  return 99;
};

const clockLabel = (absoluteMinutes: number) => {
  const minutesInDay = ((absoluteMinutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(minutesInDay / 60);
  const minute = minutesInDay % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
};

const slotKey = (absoluteMinutes: number) => minutesToTime(absoluteMinutes);
const slotBaseTime = (slot: string) => slot.replace(/\s*·\s*next day$/i, "");
const slotLabel = (startTime: string) => {
  const base = slotBaseTime(startTime);
  if (!/^\d{2}:\d{2}$/.test(base)) return startTime;
  return `${clockLabel(timeToMinutes(base))}–${clockLabel(timeToMinutes(base) + 30)}${startTime.endsWith(" · next day") ? " · next day" : ""}`;
};

const slotsBetween = (startMinutes: number, endMinutes: number) =>
  Array.from(
    { length: (endMinutes - startMinutes) / 30 },
    (_, index) => slotKey(startMinutes + index * 30),
  );

const periods = [
  { name: "Late Night", times: slotsBetween(0, 360) },
  { name: "Early Morning", times: slotsBetween(360, 540) },
  { name: "Morning", times: slotsBetween(540, 720) },
  { name: "Afternoon", times: slotsBetween(720, 1020) },
  { name: "Evening", times: slotsBetween(1020, 1200) },
  { name: "Night", times: slotsBetween(1200, 1440) },
  { name: "Next day · Late Night", times: slotsBetween(1440, 1800).map((time) => `${time} · next day`) },
];

const allTimeSlots = periods.flatMap((period) => period.times);
const timeRangeLabel = (slots: string[]) => {
  if (slots.length === 0) return "";
  const firstIndex = allTimeSlots.indexOf(slots[0]);
  const lastIndex = allTimeSlots.indexOf(slots[slots.length - 1]);
  if (firstIndex < 0 || lastIndex < 0) return "";
  return `${clockLabel(firstIndex * 30)}–${clockLabel((lastIndex + 1) * 30)}${lastIndex >= 48 ? " · next day" : ""}`;
};

const durationLabel = (slotCount: number) => {
  const totalMinutes = slotCount * 30;
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0
    ? `${hours} ${hours === 1 ? "hour" : "hours"}`
    : `${hours} hr ${minutes} min`;
};

const bookingDateForSlots = (baseDate: Date, slots: string[]) => {
  const bookingDate = new Date(baseDate);
  if (slots.length === 0) return bookingDate;
  const firstIndex = allTimeSlots.indexOf(slots[0]);
  // The operational day runs 06:00–06:00. Slots from midnight onward
  // belong to the following calendar date even though they remain on this screen.
  if (firstIndex >= 48) bookingDate.setDate(bookingDate.getDate() + 1);
  return bookingDate;
};

// YYYY-MM-DD in the viewer's local calendar, matching how the date picker
// constructs dates. Unlike toISOString(), this never shifts the day for
// timezones ahead of UTC (e.g. IST, the institution's timezone).
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const bookingWindowMessage = (now = getInstitutionNow()) =>
  now.minutes < 360
    ? "Only today’s midnight–6:00 AM slots are open. Daytime bookings open at 6:00 AM."
    : "Booking is open until 6:00 AM tomorrow.";

const ACTIVE_RESERVATION_STORAGE_KEY = "practice-ready-active-reservation";

const subscribeHydration = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
const subscribeStorage = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
const readStoredReservation = () => {
  try {
    return window.localStorage.getItem(ACTIVE_RESERVATION_STORAGE_KEY);
  } catch {
    return null;
  }
};
const getServerReservation = () => null;
const subscribeGreeting = (onChange: () => void) => {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
};
const getGreeting = () => {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 12 ? "Good morning"
    : hour >= 12 && hour < 17 ? "Good afternoon"
    : hour >= 17 && hour < 20 ? "Good evening" : "Ready for a late session?";
};
const getServerGreeting = () => "Welcome";

interface ActiveReservation {
  bookingRef: string;
  roomId: number;
  roomName?: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  bookedFor?: string;
}

const isActiveReservation = (value: unknown): value is ActiveReservation => {
  if (!value || typeof value !== "object") return false;

  const reservation = value as Partial<ActiveReservation>;
  return (
    typeof reservation.bookingRef === "string" &&
    /^PR-\d{4}-\d{4}$/.test(reservation.bookingRef) &&
    typeof reservation.roomId === "number" &&
    Number.isSafeInteger(reservation.roomId) &&
    reservation.roomId > 0 &&
    (reservation.roomName === undefined || typeof reservation.roomName === "string") &&
    typeof reservation.date === "string" &&
    isValidCalendarDate(reservation.date) &&
    typeof reservation.startTime === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(reservation.startTime) &&
    typeof reservation.endTime === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(reservation.endTime) &&
    typeof reservation.status === "string" &&
    (reservation.bookedFor === undefined || typeof reservation.bookedFor === "string")
  );
};

// Room booking times are always IST, including for users browsing abroad.
const localDateTimeMs = (date: string, time: string, dayOffset = 0) => {
  return Date.parse(`${date}T${time}:00+05:30`) + dayOffset * 86_400_000;
};

const humanizeDuration = (ms: number) => {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
};

const reservationCountdownLabel = (
  reservation: Pick<ActiveReservation, "date" | "startTime" | "endTime">,
  nowMs: number,
) => {
  const startMs = localDateTimeMs(reservation.date, reservation.startTime);
  const endMs = localDateTimeMs(
    reservation.date,
    reservation.endTime,
    reservation.endTime === "00:00" ? 1 : 0,
  );
  if (nowMs < startMs) return `Starts in ${humanizeDuration(startMs - nowMs)}`;
  if (nowMs < endMs) return `In progress, ${humanizeDuration(endMs - nowMs)} left`;
  return "Completed";
};

const bookedFromHourStarts = (starts: number[]) =>
  new Set(starts.flatMap((start) => [slotKey(start), slotKey(start + 30)]));

const booked3 = bookedFromHourStarts([420, 600, 780, 1080, 1260, 1560]);
const booked5 = bookedFromHourStarts([420, 540, 720, 900, 1140, 1380]);
const booked2 = bookedFromHourStarts([480, 660, 840, 1020, 1320]);
const booked4 = bookedFromHourStarts([360, 540, 960, 1200, 1500]);

const locations = [
  "MPR 2",
  "MPR 3",
  "MPR 4",
  "MPR 5",
  "Auditorium",
  "Studio",
  "Live Room",
  "MP Lab 1",
  "MP Lab 2",
  "Store Room",
];

const startOfMonth = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
const longDate = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
const shortDate = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
const monthName = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    date,
  );

function ThemeToggle({ fixed = true, inline = false }: { fixed?: boolean; inline?: boolean }) {
  const mounted = useSyncExternalStore(subscribeHydration, getClientSnapshot, getServerSnapshot);
  const [themeOverride, setIsDarkTheme] = useState<boolean | null>(null);
  const [isThemeSpinning, setIsThemeSpinning] = useState(false);
  const readTheme = () => {
    let savedTheme: string | null = null;
    try { savedTheme = window.localStorage.getItem("practice-ready-theme"); } catch { /* Storage is optional. */ }
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return savedTheme
      ? savedTheme === "dark"
      : document.documentElement.classList.contains("dark") || systemPrefersDark;
  };
  const isDarkTheme = themeOverride ?? (mounted ? readTheme() : null);
  useEffect(() => {
    if (isDarkTheme === null) return;
    document.documentElement.classList.toggle("dark", isDarkTheme);
    document.documentElement.style.colorScheme = isDarkTheme ? "dark" : "light";
  }, [isDarkTheme]);

  const toggleTheme = () => {
    if (isThemeSpinning || isDarkTheme === null) return;

    setIsThemeSpinning(true);
    window.setTimeout(() => {
      const nextIsDark = !isDarkTheme;

      // Keep the actual palette swap in its own animation frame. The browser can
      // keep the continuously animated wave/equalizer transforms on the compositor
      // instead of doing the class change, native color-scheme update and storage
      // write in the same frame.
      window.requestAnimationFrame(() => {
        document.documentElement.classList.toggle("dark", nextIsDark);
        setIsDarkTheme(nextIsDark);

        window.requestAnimationFrame(() => {
          document.documentElement.style.colorScheme = nextIsDark ? "dark" : "light";
          try {
            window.localStorage.setItem("practice-ready-theme", nextIsDark ? "dark" : "light");
          } catch { /* The palette still works when storage is blocked. */ }
        });
      });
    }, 520);
    window.setTimeout(() => setIsThemeSpinning(false), 760);
  };

  return (
    <>
      <style>{`
        @keyframes practice-ready-theme-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(720deg); }
        }
        .practice-ready-theme-spin {
          animation: practice-ready-theme-spin .72s cubic-bezier(.4, 0, .2, 1);
        }
        .practice-ready-global-theme-toggle {
          top: 1.25rem;
          right: 1.25rem;
        }
        @media (min-width: 640px) {
          .practice-ready-global-theme-toggle {
            top: 2rem;
            right: 2rem;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .practice-ready-theme-spin { animation: none !important; }
        }
      `}</style>
      <button
        type="button"
        onClick={toggleTheme}
        disabled={isDarkTheme === null || isThemeSpinning}
        aria-label={isDarkTheme ? "Switch to light mode" : "Switch to dark mode"}
        title={isDarkTheme ? "Switch to light mode" : "Switch to dark mode"}
        className={`${inline ? "relative shrink-0" : fixed ? "fixed practice-ready-global-theme-toggle" : "absolute practice-ready-global-theme-toggle"} z-50 grid h-11 w-11 place-items-center rounded-2xl border border-slate-200/80 bg-white/96 text-slate-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:border-violet-300 hover:bg-violet-50/90 hover:shadow-md disabled:cursor-default disabled:opacity-80 dark:border-[#30384D]/90 dark:bg-[#1B2133]/96 dark:text-[#E7EAF2] dark:hover:border-[#4A3A67] dark:hover:bg-[#252C3E]`}
      >
        <span
          className={isThemeSpinning ? "practice-ready-theme-spin" : undefined}
          aria-hidden="true"
        >
          {isDarkTheme ? (
            <Sun size={21} className="text-orange-400" />
          ) : (
            <Moon size={20} className="fill-violet-700 text-violet-700" />
          )}
        </span>
      </button>
    </>
  );
}

function Shell({
  children,
  title,
  subtitle,
  scrollHint,
  back,
  home,
  headerExtra,
  headerTitleAside,
  stickyHeader = true,
  headerRef,
  compactActionBarPadding = false,
  compactMobileHeader = false,
  lockMobileViewport = false,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  scrollHint?: string;
  back?: () => void;
  home?: () => void;
  headerExtra?: React.ReactNode;
  headerTitleAside?: React.ReactNode;
  stickyHeader?: boolean;
  headerRef?: React.RefObject<HTMLElement | null>;
  compactActionBarPadding?: boolean;
  compactMobileHeader?: boolean;
  lockMobileViewport?: boolean;
}) {
  const contextualScrollHint =
    scrollHint ??
    (title.startsWith("MPR ") && title.endsWith(" availability")
      ? undefined
      : title.endsWith(" setup")
        ? undefined
        : title === "Equipment availability issues"
          ? "Scroll to review all affected items and your options."
          : title.startsWith("Search for another")
            ? "Search, then scroll to review all matching equipment."
            : title === "Equipment directory"
              ? "Search, then scroll to review all matching equipment."
              : title === "Browse by location"
                ? "Scroll to view all TSM locations."
                : title.endsWith(" equipment")
                  ? "Scroll to review all equipment in this location."
                  : undefined);
  return (
    <main className={`relative w-full max-w-full bg-[#f3f5fb] dark:bg-[#0F1220] text-[#151a31] dark:text-[#F5F7FF] ${lockMobileViewport ? "h-[100dvh] overflow-hidden sm:min-h-screen sm:h-auto sm:overflow-x-clip" : "min-h-screen overflow-x-clip"}`}>
      <div className="hidden sm:block">
        <ThemeToggle />
      </div>
      <div className="hidden sm:block">
        <MusicToggle />
      </div>
      <style>{`
        button, [role="button"] { touch-action: manipulation; }
        @keyframes practice-ready-shell-wave-drift-a {
          0%, 100% { transform: translate3d(-2.4%, -0.7%, 0); }
          50% { transform: translate3d(2.6%, 0.9%, 0); }
        }
        @keyframes practice-ready-shell-wave-drift-b {
          0%, 100% { transform: translate3d(2.2%, 0.8%, 0); }
          50% { transform: translate3d(-2.5%, -0.8%, 0); }
        }
        @keyframes practice-ready-shell-wave-drift-c {
          0%, 100% { transform: translate3d(-1.1%, 1.2%, 0); }
          50% { transform: translate3d(1.4%, -1.4%, 0); }
        }
        @keyframes practice-ready-shell-wave-breathe {
          0%, 100% { opacity: .48; }
          50% { opacity: .64; }
        }
        .practice-ready-shell-wave-field {
          background: rgba(246, 244, 255, .62);
          animation: practice-ready-shell-wave-breathe 7.4s ease-in-out infinite;
          contain: paint;
          isolation: isolate;
          transform: translateZ(0);
          will-change: opacity;
        }
        html.dark .practice-ready-shell-wave-field {
          background:
            radial-gradient(circle at 82% 16%, rgba(146, 120, 228, .14), transparent 36%),
            radial-gradient(circle at 18% 76%, rgba(118, 123, 214, .11), transparent 40%),
            radial-gradient(circle at 52% 48%, rgba(114, 92, 195, .08), transparent 52%),
            rgba(14, 17, 38, .86);
        }
        .practice-ready-shell-wave-group-a {
          animation: practice-ready-shell-wave-drift-a 11s ease-in-out infinite;
          backface-visibility: hidden;
          transform: translateZ(0);
          will-change: transform;
        }
        .practice-ready-shell-wave-group-b {
          animation: practice-ready-shell-wave-drift-b 12.5s ease-in-out infinite;
          backface-visibility: hidden;
          transform: translateZ(0);
          will-change: transform;
        }
        .practice-ready-shell-wave-group-c {
          animation: practice-ready-shell-wave-drift-c 14.8s ease-in-out infinite;
          backface-visibility: hidden;
          transform: translateZ(0);
          will-change: transform;
          opacity: 0;
        }
        html.dark .practice-ready-shell-wave-group-a {
          animation-duration: 12.8s;
          animation-delay: -2.1s;
        }
        html.dark .practice-ready-shell-wave-group-b {
          animation-duration: 15.2s;
          animation-delay: -4.7s;
        }
        html.dark .practice-ready-shell-wave-group-c {
          opacity: 1;
          animation-delay: -6.2s;
        }
        .practice-ready-shell-wave-band {
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
          vector-effect: non-scaling-stroke;
        }
        .practice-ready-shell-wave-1 { stroke: rgba(196, 181, 253, .29); }
        .practice-ready-shell-wave-2 { stroke: rgba(221, 214, 254, .34); }
        .practice-ready-shell-wave-3 { stroke: rgba(167, 139, 250, .23); }
        .practice-ready-shell-wave-4 { stroke: rgba(233, 213, 255, .31); }
        .practice-ready-shell-wave-5 { stroke: rgba(192, 132, 252, .21); }
        .practice-ready-shell-wave-6,
        .practice-ready-shell-wave-7 { stroke: transparent; opacity: 0; }
        html.dark .practice-ready-shell-wave-1 { stroke: rgba(155, 136, 236, .16); }
        html.dark .practice-ready-shell-wave-2 { stroke: rgba(186, 166, 246, .175); }
        html.dark .practice-ready-shell-wave-3 { stroke: rgba(128, 134, 220, .145); }
        html.dark .practice-ready-shell-wave-4 { stroke: rgba(172, 140, 232, .155); }
        html.dark .practice-ready-shell-wave-5 { stroke: rgba(112, 101, 198, .135); }
        html.dark .practice-ready-shell-wave-6 { stroke: rgba(205, 178, 249, .145); opacity: 1; }
        html.dark .practice-ready-shell-wave-7 { stroke: rgba(147, 108, 214, .125); opacity: 1; }
        @media (max-width: 639px) {
          .practice-ready-shell-wave-field {
            background:
              radial-gradient(circle at 18% 14%, rgba(196, 181, 253, .10), transparent 34%),
              radial-gradient(circle at 82% 82%, rgba(216, 180, 254, .09), transparent 36%),
              rgba(247, 245, 255, .76);
          }
          html.dark .practice-ready-shell-wave-field {
            background:
              radial-gradient(circle at 18% 16%, rgba(154, 118, 228, .14), transparent 34%),
              radial-gradient(circle at 82% 80%, rgba(132, 108, 210, .11), transparent 38%),
              radial-gradient(circle at 50% 42%, rgba(110, 88, 188, .08), transparent 50%),
              rgba(17, 19, 43, .94);
          }
          .practice-ready-shell-wave-group-a { animation-duration: 13.5s; }
          .practice-ready-shell-wave-group-b { animation-duration: 15s; }
          .practice-ready-shell-wave-group-c { animation-duration: 16.5s; }
          .practice-ready-shell-wave-band { opacity: .72; }
          html.dark .practice-ready-shell-wave-band { opacity: .74; }
          .practice-ready-shell-wave-3,
          .practice-ready-shell-wave-4 { opacity: .42; }
          html.dark .practice-ready-shell-wave-3,
          html.dark .practice-ready-shell-wave-4 { opacity: .44; }
          html.dark .practice-ready-shell-wave-6,
          html.dark .practice-ready-shell-wave-7 { opacity: .52; }
        }
        @media (prefers-reduced-motion: reduce) {
          .practice-ready-shell-wave-field,
          .practice-ready-shell-wave-group-a,
          .practice-ready-shell-wave-group-b,
          .practice-ready-shell-wave-group-c { animation: none !important; }
        }
      `}</style>
      <div className="practice-ready-shell-wave-field pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <svg
          className="absolute -left-[10%] -top-[8%] h-[116%] w-[120%]"
          viewBox="0 0 1200 1000"
          preserveAspectRatio="none"
        >
          <g className="practice-ready-shell-wave-group-a">
            <path className="practice-ready-shell-wave-band practice-ready-shell-wave-1" strokeWidth="260" d="M-230 70 C 90 -70, 330 135, 610 75 S 1030 -35, 1430 110" />
            <path className="practice-ready-shell-wave-band practice-ready-shell-wave-3" strokeWidth="275" d="M-220 515 C 100 365, 355 650, 650 525 S 1060 365, 1430 555" />
            <path className="practice-ready-shell-wave-band practice-ready-shell-wave-5" strokeWidth="255" d="M-210 940 C 105 785, 385 1060, 700 925 S 1080 790, 1410 955" />
          </g>
          <g className="practice-ready-shell-wave-group-b">
            <path className="practice-ready-shell-wave-band practice-ready-shell-wave-2" strokeWidth="250" d="M-220 285 C 95 145, 340 405, 625 300 S 1040 150, 1420 325" />
            <path className="practice-ready-shell-wave-band practice-ready-shell-wave-4" strokeWidth="265" d="M-215 730 C 105 575, 370 850, 675 735 S 1070 585, 1420 765" />
          </g>
          <g className="practice-ready-shell-wave-group-c">
            <path className="practice-ready-shell-wave-band practice-ready-shell-wave-6" strokeWidth="220" d="M-210 170 C 120 0, 335 260, 615 170 S 1010 40, 1410 205" />
            <path className="practice-ready-shell-wave-band practice-ready-shell-wave-7" strokeWidth="235" d="M-200 620 C 120 485, 330 730, 605 610 S 980 500, 1390 645" />
          </g>
        </svg>
      </div>
      <div className={`relative z-10 mx-auto w-full min-w-0 max-w-[760px] overflow-x-clip bg-transparent sm:bg-[#f8f9fd] dark:bg-transparent sm:dark:bg-[#151A2B] shadow-[0_0_60px_rgba(21,26,49,.08)] ${lockMobileViewport ? "h-full min-h-0 overflow-y-hidden sm:min-h-screen sm:h-auto sm:overflow-y-visible" : "min-h-screen"}`}>
        <header ref={headerRef} className={`${stickyHeader ? "sticky top-0 z-20" : "relative z-10"} border-b border-slate-200/80 dark:border-[#30384D]/80 bg-[#f8f9fd]/96 dark:bg-[#151A2B]/96 sm:bg-[#f8f9fd]/98 sm:dark:bg-[#151A2B]/98 px-5 ${compactMobileHeader ? "pb-2 pt-2 sm:pb-3 sm:pt-3" : "pb-3 pt-3"} sm:px-8`}>
          <div className={`${compactMobileHeader ? "mb-1.5 sm:mb-2.5" : "mb-2.5"} flex items-center justify-between`}>
            {back ? (
              <button
                onClick={back}
                className="flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-slate-600 dark:text-[#AAB3C7] hover:bg-white dark:hover:bg-[#20273A]"
              >
                <ArrowLeft size={18} /> Back
              </button>
            ) : (
              <Brand />
            )}
            {home && (
              <button
                onClick={home}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-[#2B2145]"
              >
                Home
              </button>
            )}
          </div>
          <div className={headerTitleAside ? "sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(220px,260px)] sm:items-center sm:gap-5" : undefined}>
            <div className="min-w-0">
              <h1 className="min-w-0 break-words text-[1.6rem] font-semibold leading-tight tracking-[-0.035em] sm:text-[1.65rem]">
                {title}
              </h1>
              {subtitle && (
                <p
                  className={`min-w-0 break-words mt-1.5 text-[15px] leading-5 text-slate-600 dark:text-[#AAB3C7] sm:mt-1 sm:leading-5 ${
                    title === "Equipment directory" ? "text-left" : "text-pretty"
                  }`}
                >
                  {subtitle}
                </p>
              )}
            </div>
            {headerTitleAside && (
              <div className={`${compactMobileHeader ? "mt-2 sm:mt-0" : "mt-3 sm:mt-0"} min-w-0`}>{headerTitleAside}</div>
            )}
          </div>
          {contextualScrollHint && (
            <p className="mt-0.5 text-sm font-normal leading-5 text-slate-500 dark:text-[#9AA6BC] sm:mt-1">
              {contextualScrollHint}
            </p>
          )}
          {headerExtra && <div className={compactMobileHeader ? "mt-2.5 sm:mt-3" : "mt-4 sm:mt-3"}>{headerExtra}</div>}
        </header>
        <div className={`w-full min-w-0 max-w-full px-5 ${compactMobileHeader ? "pt-2.5 sm:pt-5" : "pt-3.5 sm:pt-5"} sm:px-8 ${compactActionBarPadding ? "pb-24 sm:pb-24" : "pb-36 sm:pb-40"}`}>{children}</div>
      </div>
    </main>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 font-bold">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-600 dark:bg-violet-500 text-white">
        <Music2 size={18} />
      </span>
      Practice Ready
    </div>
  );
}
function Primary({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      className="min-h-12 w-full rounded-2xl bg-violet-600 dark:bg-violet-600 text-[15px] font-semibold text-white shadow-lg shadow-violet-200 dark:shadow-none hover:bg-violet-700 dark:hover:bg-violet-500 disabled:bg-slate-200 dark:disabled:bg-[#252C3E] disabled:text-slate-400 dark:disabled:text-[#74809A] disabled:shadow-none"
    >
      {children}
    </Button>
  );
}
function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-0 left-1/2 z-30 w-full min-w-0 max-w-[760px] -translate-x-1/2 overflow-x-hidden border-t border-slate-200/80 dark:border-[#30384D]/80 bg-[#f8f9fd]/95 dark:bg-[#151A2B]/95 px-5 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_30px_rgba(21,26,49,.08)] sm:px-8 sm:pb-[max(1rem,env(safe-area-inset-bottom))] sm:pt-3">
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function StatusPill({
  status,
  condition,
}: {
  status: Equipment["status"];
  condition?: string;
}) {
  const map = {
    ready: "bg-emerald-100 text-emerald-800 dark:bg-[#102A21] dark:text-emerald-200",
    away: "bg-amber-100 text-amber-800 dark:bg-[#3A2B12] dark:text-amber-200",
    attention: "bg-amber-100 text-amber-800 dark:bg-[#3A2B12] dark:text-amber-200",
    service: "bg-rose-100 text-rose-800 dark:bg-[#3A1720] dark:text-rose-200",
    missing: "bg-slate-200 text-slate-700 dark:bg-[#2A3246] dark:text-[#CBD3E2]",
  };
  const labels = {
    ready: "Available",
    away: "Currently elsewhere",
    attention: "Needs attention",
    service: "Out of service",
    missing: "Missing",
  };
  const label =
    status === "attention" && condition ? condition : labels[status];
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${map[status]}`}
    >
      {label}
    </span>
  );
}
function Summary({
  room,
  time,
  date,
  bookedFor,
}: {
  room: string;
  time: string;
  date: Date;
  bookedFor?: string;
}) {
  const details = [
    { label: "Date", value: shortDate(date) },
    { label: "Time", value: time },
    { label: "Room", value: room },
  ];

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-[#30384D] dark:bg-[#151A2B] dark:text-[#F5F7FF]">
      <div className="grid min-w-0 grid-cols-3">
        {details.map((detail, index) => (
          <div
            key={detail.label}
            className={`min-w-0 px-3 py-3.5 sm:px-5 sm:py-4 ${index > 0 ? "border-l border-slate-200 dark:border-[#30384D]" : ""}`}
          >
            <small className="block text-xs text-slate-500 dark:text-[#8F9BB2]">
              {detail.label}
            </small>
            <p className="mt-1 break-words text-[13px] font-semibold leading-5 sm:text-sm">
              {detail.value}
            </p>
          </div>
        ))}
      </div>
      {bookedFor ? (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 dark:border-[#30384D] px-3 py-2.5 sm:px-5 sm:py-3">
          <small className="text-xs text-slate-500 dark:text-[#8F9BB2]">Booked for</small>
          <p className="min-w-0 truncate text-[13px] font-semibold sm:text-sm">{bookedFor}</p>
        </div>
      ) : null}
    </div>
  );
}
function ConfirmationDetails({
  room,
  time,
  date,
  bookedFor,
}: {
  room: string;
  time: string;
  date: Date;
  bookedFor?: string;
}) {
  const details = [
    { label: "Date", value: shortDate(date), icon: <CalendarDays size={18} /> },
    { label: "Time", value: time, icon: <Clock3 size={18} /> },
    { label: "Room", value: room, icon: <MapPin size={18} /> },
  ];
  return (
    <section className="mt-3.5 sm:mt-5" aria-labelledby="reservation-details">
      <h2 id="reservation-details" className="mb-2 text-base font-semibold sm:mb-3">
        Reservation details
      </h2>
      <div className="grid rounded-2xl border border-slate-200 dark:border-[#30384D] bg-white dark:bg-[#1B2133] shadow-sm sm:grid-cols-3">
        {details.map((detail, index) => (
          <div
            key={detail.label}
            className={`flex items-center gap-2.5 px-3.5 py-3 ${index > 0 ? "border-t border-slate-100 dark:border-[#252C3E] sm:border-l sm:border-t-0" : ""} sm:gap-3 sm:p-4`}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 dark:bg-[#211A38] text-violet-700 dark:text-violet-300 sm:h-10 sm:w-10">
              {detail.icon}
            </span>
            <div>
              <small className="text-slate-500 dark:text-[#9AA6BC]">{detail.label}</small>
              <p className="mt-0.5 font-semibold text-[#151a31] dark:text-[#F5F7FF]">
                {detail.value}
              </p>
            </div>
          </div>
        ))}
      </div>
      {bookedFor ? (
        <div className="mt-2.5 flex items-center gap-2.5 rounded-2xl border border-slate-200 dark:border-[#30384D] bg-white dark:bg-[#1B2133] px-3.5 py-3 shadow-sm sm:gap-3 sm:p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 dark:bg-[#211A38] text-violet-700 dark:text-violet-300 sm:h-10 sm:w-10">
            <User size={18} />
          </span>
          <span className="min-w-0">
            <small className="block text-xs text-slate-500 dark:text-[#8F9BB2]">Booked for</small>
            <p className="mt-0.5 truncate text-[13px] font-semibold leading-5 sm:text-sm">{bookedFor}</p>
          </span>
        </div>
      ) : null}
    </section>
  );
}


function EquipmentRow({
  item,
  showDefault = false,
  showStatus = true,
  action,
  compactResult = false,
  availableEquipmentLayout = false,
  transparentDarkSurface = false,
  availableStatusOnIdRow = false,
}: {
  item: Equipment;
  showDefault?: boolean;
  showStatus?: boolean;
  action?: React.ReactNode;
  compactResult?: boolean;
  availableEquipmentLayout?: boolean;
  transparentDarkSurface?: boolean;
  availableStatusOnIdRow?: boolean;
}) {
  const [imageOpen, setImageOpen] = useState(false);
  const imageUrl = equipmentImageUrl(item);

  useEffect(() => {
    if (!imageOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImageOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [imageOpen]);

  return (
    <>
      <div
        className={
          compactResult
            ? `flex h-full min-w-0 flex-col bg-transparent px-1 py-3 dark:bg-transparent sm:px-4 sm:py-4 ${availableEquipmentLayout ? "dark:px-3 sm:dark:px-4" : ""}`
            : `flex h-full flex-col bg-transparent py-3 sm:py-5 ${availableEquipmentLayout ? "dark:bg-transparent dark:px-3 sm:dark:px-4" : transparentDarkSurface ? "dark:bg-transparent" : "dark:bg-[#1B2133]"}`
        }
      >
        <div className="flex items-start gap-2.5 sm:gap-4">
          <div className="shrink-0">
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setImageOpen(true)}
                className="group relative h-[54px] w-[54px] cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 dark:border-[#30384D] bg-white dark:bg-[#1B2133] transition-colors hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:h-[72px] sm:w-[72px]"
                aria-label={`View larger image of ${item.name}`}
              >
                <img
                  src={imageUrl}
                  alt={`Reference image of ${item.name}`}
                  className="h-full w-full object-contain p-1.5 transition-transform group-hover:scale-105"
                  loading="lazy"
                />
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-white/96 dark:bg-[#1B2133]/96 text-slate-600 dark:text-[#AAB3C7] shadow-sm ring-1 ring-slate-200 dark:ring-[#30384D]/90 dark:ring-[#30384D] transition-colors group-hover:bg-white group-hover:text-slate-900 dark:text-[#F5F7FF]"
                >
                  <Expand size={11} />
                </span>
              </button>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug">{item.name}</p>
                {availableStatusOnIdRow ? (
                  <div className="mt-0.5 flex min-w-0 items-center gap-2">
                    <p className="min-w-0 flex-1 text-xs font-bold tracking-wide text-violet-600 dark:text-violet-200">
                      {item.id}
                    </p>
                    <div className="ml-auto shrink-0">
                      <StatusPill status="ready" condition={item.condition} />
                    </div>
                  </div>
                ) : (
                  <p className="mt-0.5 min-w-0 text-xs font-bold tracking-wide text-violet-600 dark:text-violet-200">
                    {item.id}
                  </p>
                )}
              </div>
              {showStatus && !availableStatusOnIdRow && (
                <div className="ml-auto shrink-0 pt-0.5">
                  <StatusPill status={item.status} condition={item.status === "missing" ? "Unknown" : item.condition} />
                </div>
              )}
            </div>
          </div>
        </div>
        <dl
          className={
            compactResult
              ? "mt-2 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-200 dark:border-[#30384D] pt-2 text-sm sm:mt-2.5 sm:pt-2.5"
              : "mt-2 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-200 dark:border-[#30384D] pt-2 text-sm sm:mt-3 sm:gap-4 sm:pt-3"
          }
        >
          {showDefault && (
            <div>
              <dt className="whitespace-nowrap text-xs text-slate-500 dark:text-[#9AA6BC]">Default location</dt>
              <dd className={compactResult ? "mt-0.5 font-medium" : "mt-0.5 font-medium sm:mt-1"}>
                {item.defaultLocation}
              </dd>
            </div>
          )}
          {availableEquipmentLayout ? (
            <>
              <div className="text-left">
                <dt className="text-xs text-slate-500 dark:text-[#9AA6BC]">Working condition</dt>
                <dd className={compactResult ? "mt-0.5 font-medium" : "mt-0.5 font-medium sm:mt-1"}>
                  {item.status === "missing" ? "Unknown" : item.condition}
                </dd>
              </div>
              <div className="justify-self-end text-left">
                <div>
                  <dt className="whitespace-nowrap text-xs text-slate-500 dark:text-[#9AA6BC]">Current location</dt>
                  <dd className={compactResult ? "mt-0.5 font-medium" : "mt-0.5 font-medium sm:mt-1"}>
                    {item.currentLocation}
                  </dd>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="justify-self-end text-left">
                <div>
                  <dt className="text-xs text-slate-500 dark:text-[#9AA6BC]">Working condition</dt>
                  <dd className={compactResult ? "mt-0.5 font-medium" : "mt-0.5 font-medium sm:mt-1"}>
                    {item.status === "missing" ? "Unknown" : item.condition}
                  </dd>
                </div>
              </div>
              <div className={showDefault ? "col-span-1" : undefined}>
                <dt className="whitespace-nowrap text-xs text-slate-500 dark:text-[#9AA6BC]">Current location</dt>
                <dd className={compactResult ? "mt-0.5 font-medium" : "mt-0.5 font-medium sm:mt-1"}>
                  {item.currentLocation}
                </dd>
              </div>
            </>
          )}
        </dl>
        {action && <div className="mt-auto pt-2 sm:pt-3">{action}</div>}
      </div>

      {imageOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[1px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setImageOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`equipment-image-title-${item.id}`}
            className="relative w-full max-w-xl rounded-3xl bg-white dark:bg-[#1B2133] p-5 shadow-2xl sm:p-6"
          >
            <button
              type="button"
              onClick={() => setImageOpen(false)}
              className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-white dark:bg-[#1B2133] text-slate-600 dark:text-[#AAB3C7] shadow-sm ring-1 ring-slate-200 dark:ring-[#30384D] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              aria-label="Close equipment image"
            >
              <X size={20} />
            </button>
            <div className="pr-12">
              <h2 id={`equipment-image-title-${item.id}`} className="text-lg font-bold text-[#151a31] dark:text-[#F5F7FF] sm:text-xl">
                {item.name}
              </h2>
              <p className="mt-1 text-sm font-bold tracking-wide text-violet-600 dark:text-violet-300">{item.id}</p>
              {item.modelName && (
                <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-[#D5D9E4]">{item.modelName}</p>
              )}
              {item.specifications && (
                <p className="mt-1 text-sm text-slate-500 dark:text-[#9AA6BC]">{item.specifications}</p>
              )}
            </div>
            <div className="mt-4 flex max-h-[60vh] min-h-64 items-center justify-center overflow-hidden rounded-2xl bg-slate-50 dark:bg-[#171D2D] p-4">
              <img
                src={imageUrl}
                alt={`Larger reference image of ${item.name}`}
                className="max-h-[54vh] w-full object-contain"
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-[#9AA6BC]">
              Reference image for visual identification. It may not show the exact physical unit currently at TSM.
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-[#252C3E] pt-4 text-sm">
              <div>
                <dt className="text-xs text-slate-500 dark:text-[#9AA6BC]">Current location</dt>
                <dd className="mt-1 font-semibold">{item.currentLocation}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-[#9AA6BC]">Working condition</dt>
                <dd className="mt-1 font-semibold">{item.status === "missing" ? "Unknown" : item.condition}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </>
  );
}

function EquipmentDataNotice({ status }: { status: EquipmentLoadStatus }) {
  if (status === "loading") {
    return (
      <p role="status" className="rounded-2xl border border-violet-100 bg-violet-50 p-4 text-sm text-violet-800 dark:border-violet-500/30 dark:bg-[#211A38] dark:text-violet-200">
        Loading live equipment data…
      </p>
    );
  }
  if (status === "error") {
    return (
      <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-800 dark:bg-[#321820] dark:text-rose-200">
        Could not load live equipment data. Please try again later.
      </div>
    );
  }
  return null;
}

function BookingLoginPage({ onUserChange }: { onUserChange: (user: UserProfile) => void }) {
  return <SampleAccount onUserChange={onUserChange} controls={<><MusicToggle inline /><ThemeToggle inline /></>} />;

  /* Legacy API-backed form retained below as a reference while the Asmi
     presentation is active. */
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "sent">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = mode === "login"
      ? await login({ email, password })
      : await register({ email, password, fullName });
    if (!result.success || !result.user) {
      setError(result.error ?? "Email or password is incorrect.");
      setPending(false);
      return;
    }
    if (mode === "register" && phone.trim()) {
      const updated = await updateCurrentUser({ fullName: result.user.fullName, phone: phone.trim() });
      onUserChange(updated.success && updated.user ? updated.user : result.user);
    } else {
      onUserChange(result.user);
    }
    setPassword("");
    setPending(false);
  };

  return (
    <main className="relative isolate min-h-[100dvh] overflow-x-clip bg-[#f3efff] text-[#151a31] dark:bg-[#171D2D] dark:text-white">
      <div className="relative z-10 mx-auto grid min-h-[100dvh] max-w-6xl lg:grid-cols-[.9fr_1.1fr]">
        <section className="relative hidden overflow-hidden bg-[#111733] p-14 text-white lg:grid lg:grid-rows-[auto_1fr_auto]">
          <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-violet-600/25 blur-3xl" />
          <div className="relative flex items-center gap-3 text-sm font-semibold tracking-wide"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-500"><Music2 size={20} /></span>TRUE SCHOOL OF MUSIC</div>
          <div className="relative self-center py-6"><p className="mb-5 text-sm font-bold uppercase tracking-[.22em] text-orange-300">Practice Ready</p><h1 className="text-5xl font-semibold leading-[1.06] tracking-[-.04em]">Your next practice<br />starts here.</h1><p className="mt-6 max-w-md text-lg leading-8 text-slate-300">Find an open room and check its equipment before your session begins.</p></div>
          <div className="relative flex h-24 items-end gap-2">{[28, 46, 64, 38, 74, 52, 34, 68, 44, 58, 30, 50].map((height, index) => <span key={index} className="w-3 rounded-full bg-gradient-to-t from-violet-500 to-orange-300" style={{ height }} />)}</div>
        </section>
        <section className="flex min-h-[100dvh] items-center px-6 py-8 sm:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-md">
            <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">Practice Ready</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{mode === "register" ? "Create account" : mode === "forgot" ? "Forgot your password?" : mode === "sent" ? "Reset request received" : "Welcome back"}</h2>
            <p className="mb-5 mt-3 leading-6 text-slate-600 dark:text-slate-300">{mode === "register" ? "Get ready for your next practice at TSM." : mode === "login" ? "Log in to get ready for your next practice." : "This is a demo. No reset email has been sent and your password is unchanged."}</p>
            {mode === "sent" ? <button type="button" onClick={() => setMode("login")} className="min-h-12 w-full rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white hover:bg-violet-700">Back to login</button> : mode === "forgot" ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setMode("sent"); }}><label className="block text-sm font-semibold">Email<input className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 dark:border-slate-600 dark:bg-[#1B2133] dark:text-white" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><button className="min-h-12 w-full rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white hover:bg-violet-700">Request password reset</button><button type="button" onClick={() => setMode("login")} className="min-h-11 text-sm font-medium text-violet-700 dark:text-violet-300">Back to login</button></form> : <form className="space-y-4" onSubmit={submit}>{mode === "register" && <><label className="block text-sm font-semibold">Full name<input className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 dark:border-slate-600 dark:bg-[#1B2133] dark:text-white" required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label><label className="block text-sm font-semibold">Phone number<input className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 dark:border-slate-600 dark:bg-[#1B2133] dark:text-white" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label></>}<label className="block text-sm font-semibold">Email<input className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 dark:border-slate-600 dark:bg-[#1B2133] dark:text-white" type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="block text-sm font-semibold">Password<div className="relative"><input className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-12 text-base text-slate-900 dark:border-slate-600 dark:bg-[#1B2133] dark:text-white" type={showPassword ? "text" : "password"} required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)} className="absolute bottom-0 right-0 grid h-12 w-12 place-items-center text-slate-500">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>{error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}<button disabled={pending} className="min-h-12 w-full rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white hover:bg-violet-700 disabled:opacity-60">{pending ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</button>{mode === "login" && <button type="button" onClick={() => setMode("forgot")} className="min-h-10 text-left text-sm font-medium text-violet-700 hover:underline dark:text-violet-300">Forgot password?</button>}<p className="text-sm text-slate-600 dark:text-slate-300">{mode === "login" ? "Don’t have an account?" : "Already have an account?"} <button type="button" className="font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Create account" : "Log in"}</button></p></form>}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [history, setHistory] = useState<Screen[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [studentName, setStudentName] = useState("");
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const demoPresentation = useSyncExternalStore(
    subscribeDemoPresentation,
    getDemoPresentationSnapshot,
    getDemoPresentationServerSnapshot,
  );
  const [liveDirectoryEquipment, setLiveDirectoryEquipment] = useState<Equipment[] | null>(null);
  const [bookableRooms, setBookableRooms] = useState<RoomData[]>([]);
  const [roomsStatus, setRoomsStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [directoryEquipmentStatus, setDirectoryEquipmentStatus] = useState<EquipmentLoadStatus>("idle");
  const [liveRoomEquipment, setLiveRoomEquipment] = useState<Record<string, RoomEquipmentViewState>>({});
  const [liveSlotResult, setLiveSlotResult] = useState<{
    key: string;
    slots: Record<string, { booked: boolean; bookedBy?: string | null }> | null;
  } | null>(null);
  const [reservationOverride, setActiveReservation] = useState<ActiveReservation | null>();
  const storedReservationJson = useSyncExternalStore(subscribeStorage, readStoredReservation, getServerReservation);
  const storedReservation = useMemo(() => {
    try {
      const value = JSON.parse(storedReservationJson ?? "null");
      return isActiveReservation(value) ? value : null;
    } catch { return null; }
  }, [storedReservationJson]);
  const activeReservation = reservationOverride === undefined ? storedReservation : reservationOverride;
  const [calendarMonth, setCalendarMonth] = useState(() =>
    startOfMonth(new Date()),
  );
  const [room, setRoom] = useState("MPR 3");
  const [mprSelected, setMprSelected] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null);
  const [returnToTimeSlotsAfterMprChange, setReturnToTimeSlotsAfterMprChange] = useState(false);
  const [time, setTime] = useState("");
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [alternativeSearchLabel, setAlternativeSearchLabel] = useState("");
  const [alternativeSourceRoom, setAlternativeSourceRoom] = useState("");
  const [alternativeSourceItemId, setAlternativeSourceItemId] = useState("");
  const [alternativeFromDirectory, setAlternativeFromDirectory] = useState(false);
  const [location, setLocation] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [availableEquipmentQuery, setAvailableEquipmentQuery] = useState("");
  const [directoryTab, setDirectoryTab] = useState("available");
  const statusTabClass =
    "rounded-xl font-medium text-slate-500 dark:text-[#9AA6BC] data-[state=active]:bg-white dark:data-[state=active]:bg-[#252C3E] data-[state=active]:text-violet-700 dark:data-[state=active]:text-violet-200 data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-violet-300 dark:data-[state=active]:ring-violet-500/70";
  const [conflictSlot, setConflictSlot] = useState("");
  const [bookingError, setBookingError] = useState("");
  const bookingAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [recoveringFromConflict, setRecoveringFromConflict] = useState(false);
  // Start from a deterministic value so SSR and the client's first render
  // match; the effect below applies the real time-of-day greeting on mount.
  const greeting = useSyncExternalStore(subscribeGreeting, getGreeting, getServerGreeting);
  const liveSlotKey = `${screen}:${room}:${selectedDate ? dateKey(selectedDate) : "today"}:${availabilityRetry}`;
  const liveSlots = liveSlotResult?.key === liveSlotKey ? liveSlotResult.slots : null;

  useEffect(() => {
    // Keep the prototype at the real device width on mobile. This also protects
    // every screen from accidental page-level horizontal overflow.
    let viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!viewportMeta) {
      viewportMeta = document.createElement("meta");
      viewportMeta.name = "viewport";
      document.head.appendChild(viewportMeta);
    }
    viewportMeta.content = "width=device-width, initial-scale=1, viewport-fit=cover";
    document.documentElement.style.overflowX = "clip";
    document.body.style.overflowX = "clip";

  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchRooms().then((rooms) => {
      if (cancelled) return;
      if (!rooms) {
        setRoomsStatus("error");
        return;
      }
      setBookableRooms(rooms);
      setRoomsStatus("loaded");
      setRoom((current) => rooms.some((item) => item.name === current) ? current : rooms[0]?.name ?? "");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser().then((user) => {
      if (cancelled) return;
      setCurrentUser(user);
      if (user) setStudentName((name) => name || user.fullName);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const directoryScreen = [
      "directory-search",
      "directory-browse",
      "directory-results",
      "mixer-search",
      "stand-search",
      "alternative-search",
    ].includes(screen);
    if (!directoryScreen || demoPresentation) return;

    let cancelled = false;
    const loadDirectoryEquipment = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setDirectoryEquipmentStatus("loading");
      const items = await fetchEquipmentInventory();
      if (cancelled) return;
      if (!items) {
        setDirectoryEquipmentStatus("error");
        return;
      }
      setLiveDirectoryEquipment(items.map(equipmentFromApi));
      setDirectoryEquipmentStatus("loaded");
    };
    void loadDirectoryEquipment();
    return () => {
      cancelled = true;
    };
  }, [screen, demoPresentation]);

  useEffect(() => {
    const roomScreen = [
      "setup",
      "setup2",
      "setup3",
      "setup4",
      "setup5",
      "issues3",
      "issues5",
      "available-equipment",
    ].includes(screen);
    if (!roomScreen || demoPresentation) return;

    let cancelled = false;
    const loadRoomEquipment = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLiveRoomEquipment((previous) => ({
        ...previous,
        [room]: { status: "loading", items: [] },
      }));
      try {
        const roomId = await resolveRoomId(room);
        const groups = await fetchRoomEquipment(roomId);
        if (cancelled) return;
        if (!groups) {
          setLiveRoomEquipment((previous) => ({
            ...previous,
            [room]: {
              status: "error",
              items: [],
              error: "Could not load room equipment.",
            },
          }));
          return;
        }
        const items = [...groups.ready, ...groups.away, ...groups.attention].map(
          equipmentFromApi,
        );
        setLiveRoomEquipment((previous) => ({
          ...previous,
          [room]: { status: "loaded", items },
        }));
      } catch {
        if (cancelled) return;
        setLiveRoomEquipment((previous) => ({
          ...previous,
          [room]: {
            status: "error",
            items: [],
            error: "Could not load room equipment.",
          },
        }));
      }
    };
    void loadRoomEquipment();
    return () => {
      cancelled = true;
    };
  }, [screen, room, demoPresentation]);

  const { phase: reservationPhase, nowMs: reservationNowMs } =
    useActiveReservation(activeReservation);
  const visibleActiveReservation =
    reservationPhase === "completed" || reservationPhase === "cancelled"
      ? null
      : activeReservation;

  // Once the reservation is finished or cancelled, drop it and forget it.
  useEffect(() => {
    if (!activeReservation) return;
    if (reservationPhase === "completed" || reservationPhase === "cancelled") {
      try {
        window.localStorage.removeItem(ACTIVE_RESERVATION_STORAGE_KEY);
      } catch {
        // Ignore storage errors.
      }
    }
  }, [reservationPhase, activeReservation]);

  useEffect(() => {
    let lastInteractionSoundAt = 0;

    const resolveInteractiveTarget = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null;
      if (!element) return null;

      return element.closest(
        'button, [role="button"], [role="tab"], a[href], input[type="button"], input[type="submit"]',
      ) as HTMLElement | null;
    };

    const shouldIgnoreInteractiveTarget = (element: HTMLElement | null) => {
      if (!element) return true;

      if (
        element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement
      ) {
        if (element.disabled) return true;
      }

      return element.getAttribute("aria-disabled") === "true";
    };

    const playInteractionSound = (event: Event) => {
      const interactive = resolveInteractiveTarget(event.target);
      if (shouldIgnoreInteractiveTarget(interactive)) return;

      // Touch/pointer interactions can also emit a follow-up click.
      // Debounce them so one user action produces one soft tone.
      const now = performance.now();
      if (now - lastInteractionSoundAt < 180) return;
      lastInteractionSoundAt = now;

      playPracticeReadyButtonTone();
    };

    const playPointerInteractionSound = (event: PointerEvent) => {
      playInteractionSound(event);
    };

    const playKeyboardInteractionSound = (event: MouseEvent) => {
      // Mouse, touch and pen interactions are already handled by pointerdown.
      // Keyboard-generated clicks report detail === 0, so keyboard users still
      // receive the same feedback without replaying the tone for one gesture.
      if (event.detail !== 0) return;
      playInteractionSound(event);
    };

    document.addEventListener("pointerdown", playPointerInteractionSound, true);
    document.addEventListener("click", playKeyboardInteractionSound, true);

    return () => {
      document.removeEventListener("pointerdown", playPointerInteractionSound, true);
      document.removeEventListener("click", playKeyboardInteractionSound, true);
    };
  }, []);

  useEffect(() => {
    const audio = getPracticeReadyMusic();
    if (!audio) return;

    // Try immediately. Browsers that block audible autoplay will start the
    // music on the user's first pointer/keyboard interaction instead.
    void audio.play().catch(() => undefined);

    const unlockAudio = () => {
      const context = ensurePracticeReadyAudioGraph();

      audio.muted = practiceReadyMusicMuted;
      audio.volume = practiceReadyMusicMuted
        ? 0
        : practiceReadyMusicTargetVolume;

      if (practiceReadyGainNode) {
        practiceReadyGainNode.gain.value = practiceReadyMusicMuted
          ? 0
          : practiceReadyMusicTargetVolume;
      }

      const startPlayback = () => {
        if (!practiceReadyMusicMuted) {
          void audio.play().catch(() => undefined);
        }

        // Prepare the short UI sounds from the same user gesture so iPhone
        // treats them as normal media playback later in the session.
        const uiTone = getPracticeReadyUiTone();
        const successChime = getPracticeReadySuccessChime();
        const conflictTone = getPracticeReadyConflictTone();
        const periodTones = getPracticeReadyPeriodTones();
        uiTone?.load();
        successChime?.load();
        conflictTone?.load();
        periodTones.forEach((tone) => tone.load());
      };

      if (context?.state === "suspended") {
        void context
          .resume()
          .then(startPlayback)
          .catch(() => undefined);
      } else {
        startPlayback();
      }
    };

    // iPhone/iOS may only unlock media/Web Audio from a direct touch gesture.
    window.addEventListener("touchstart", unlockAudio, {
      once: true,
      passive: true,
    });
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("click", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("touchstart", unlockAudio);
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 639px)").matches;

    const internalVolume = isMobile
      ? PRACTICE_READY_INTERNAL_VOLUME_MOBILE
      : PRACTICE_READY_INTERNAL_VOLUME_DESKTOP;

    // Only Home uses the higher music level. Success and conflict-final
    // screens remain at the same lower task-focused level as other internals.
    const targetVolume =
      screen === "home" ? PRACTICE_READY_HOME_VOLUME : internalVolume;

    setPracticeReadyMusicVolume(targetVolume);

    const context = ensurePracticeReadyAudioGraph();
    if (context?.state === "suspended") {
      void context.resume().catch(() => undefined);
    }

    if (screen === "success") {
      playPracticeReadySuccessChime();
    }

    if (screen === "conflict") {
      playPracticeReadyConflictTone();
    }
  }, [screen]);

  useEffect(() => {
    if (!["slots", "slots2", "slots3", "slots4", "slots5"].includes(screen)) {
      return;
    }
    let cancelled = false;
    const base = selectedDate || new Date();
    const nextDay = new Date(base);
    nextDay.setDate(base.getDate() + 1);
    // Slots from midnight to 06:00 belong to the next calendar date (see
    // bookingDateForSlots), so booked names come from two calendar dates.
    // The operational day spans both fetches, so treat them as one logical
    // query. A failed half must never be replaced with fixture availability.
    resolveRoomId(room)
      .then((roomId) =>
        Promise.all([
          fetchAvailability(roomId, dateKey(base)),
          fetchAvailability(roomId, dateKey(nextDay)),
        ]),
      )
      .then(([today, tomorrow]) => {
        if (cancelled) return;
        if (!today || !tomorrow) {
          setLiveSlotResult({ key: liveSlotKey, slots: null });
          return;
        }
        const info: Record<string, { booked: boolean; bookedBy?: string | null }> = {};
        for (const slot of today?.slots ?? []) {
          info[slot.startTime] = { booked: slot.status !== "available", bookedBy: null };
        }
        for (const slot of tomorrow?.slots ?? []) {
          if (slot.startTime < "06:00") {
             info[`${slot.startTime} · next day`] = { booked: slot.status !== "available", bookedBy: null };
          }
        }

        setLiveSlotResult({ key: liveSlotKey, slots: info });
      })
      .catch(() => {
        if (!cancelled) setLiveSlotResult({ key: liveSlotKey, slots: null });
      });
    return () => {
      cancelled = true;
    };
  }, [screen, room, selectedDate, liveSlotKey]);

  const go = (next: Screen) => {
    setHistory((h) => [...h, screen]);
    setScreen(next);
    window.scrollTo(0, 0);
  };
  const back = () => {
    const next = history.at(-1) || "home";
    setHistory((h) => h.slice(0, -1));
    setScreen(next);
    window.scrollTo(0, 0);
  };
  const changeMprFromTimeSlots = () => {
    // "Change" is a contextual edit action, not a one-step Back action.
    // Keep the current period and selected slots while the user is deciding.
    // They are only cleared if a different MPR is actually confirmed.
    setHistory((h) => {
      const lastMprIndex = h.lastIndexOf("mpr");
      return lastMprIndex >= 0 ? h.slice(0, lastMprIndex) : h;
    });
    setScreen("mpr");
    setMprSelected(room);
    setReturnToTimeSlotsAfterMprChange(true);
    window.scrollTo(0, 0);
  };

  const home = () => {
    setScreen("home");
    setHistory([]);
    setSelectedDate(null);
    setCalendarMonth(startOfMonth(new Date()));
    setMprSelected("");
    setSelectedPeriod(null);
    setReturnToTimeSlotsAfterMprChange(false);
    setRoom("MPR 3");
    setTime("");
    setSelectedSlots([]);
    setQuery("");
    setSearched(false);
    setAlternativeFromDirectory(false);
    setLocation("");
    setLocationQuery("");
    setDirectoryTab("available");
    setConflictSlot("");
    setStudentName("");
    setRecoveringFromConflict(false);
  };
  const confirm = () => {
    go("recheck");

    setBookingError("");

    const baseDate = selectedDate || new Date();
    const firstIndex = selectedSlots.length ? allTimeSlots.indexOf(selectedSlots[0]) : 0;
    const lastIndex = selectedSlots.length ? allTimeSlots.indexOf(selectedSlots[selectedSlots.length - 1]) : firstIndex;
    const startDate = new Date(baseDate);
    if (firstIndex >= 48) startDate.setDate(startDate.getDate() + 1);
    const endDateValue = new Date(baseDate);
    if (lastIndex >= 48 || lastIndex === 47) endDateValue.setDate(endDateValue.getDate() + 1);
    const dateStr = dateKey(startDate);
    const endDateStr = dateKey(endDateValue);
    const startTime = slotBaseTime(selectedSlots[0] || "09:00");
    const endTime = selectedSlots.length > 0
      ? minutesToTime(((lastIndex % 48) + 1) * 30)
      : minutesToTime(timeToMinutes(startTime) + 30);

    let bookingUser: UserProfile | null = currentUser;
    resolveRoomId(room)
      .then(async (roomId) => {
        bookingUser = currentUser ?? (await fetchCurrentUser());
        if (bookingUser) {
          setCurrentUser(bookingUser);
          setStudentName(bookingUser.fullName);
        }
        const fingerprint = JSON.stringify([bookingUser?.id, roomId, dateStr, endDateStr, startTime, endTime]);
        if (bookingAttempt.current?.fingerprint !== fingerprint) {
          bookingAttempt.current = { fingerprint, key: `booking-${crypto.randomUUID()}` };
        }
        if (!bookingUser) throw new Error("Sign in before confirming an operational reservation.");
        return submitBooking({
           roomId,
           date: dateStr,
           ...(endDateStr !== dateStr ? { endDate: endDateStr } : {}),
           startTime,
           endTime,
         }, bookingAttempt.current.key);
      })
      .then((res) => {
        if (!res.success && res.conflictingSlots && res.conflictingSlots.length > 0) {
          setConflictSlot(res.conflictingSlots[0]);
          setScreen("conflict");
        } else if (!res.success) {
          setBookingError(res.error ?? "The reservation could not be confirmed.");
          setScreen("booking-error");
        } else {
          bookingAttempt.current = null;
          const booking = res.booking;
          if (booking) {
            const reservation: ActiveReservation = {
              bookingRef: booking.bookingRef,
              roomId: booking.roomId,
              roomName: booking.roomName,
              date: booking.date,
              startTime: booking.startTime,
              endTime: booking.endTime,
              status: booking.status,
              bookedFor:
                booking.guestStudentName ??
                bookingUser?.fullName ??
                (studentName.trim() || undefined),
            };
            setActiveReservation(reservation);
            try {
              window.localStorage.setItem(
                ACTIVE_RESERVATION_STORAGE_KEY,
                JSON.stringify(reservation),
              );
            } catch {
              // Storage can be unavailable (private mode); the card still shows
              // for this session via state.
            }
          }
          setStudentName(
            booking?.guestStudentName ??
              bookingUser?.fullName ??
              (studentName.trim() || "Student Practice User"),
          );
          setScreen("success");
        }
      })
      .catch((error) => {
        setBookingError(
          error instanceof Error
            ? error.message
            : "The reservation could not be confirmed. Please try again.",
        );
        setScreen("booking-error");
      });
  };
  const directoryEquipmentForView = demoPresentation
    ? directoryEquipment
    : liveDirectoryEquipment ?? emptyEquipment;
  const availableForLocation = useMemo(() => {
    return directoryEquipmentForView.filter(
      (item) => item.currentLocation === location,
    );
  }, [directoryEquipmentForView, location]);
  const availableItemsForLocation = availableForLocation.filter(
    (item) => item.status === "ready",
  );
  const unavailableItemsForLocation = availableForLocation
    .filter((item) => item.status !== "ready")
    .sort((a, b) => {
      const severity: Record<Equipment["status"], number> = {
        missing: 0,
        service: 1,
        away: 2,
        attention: 3,
        ready: 4,
      };
      const drumOrder = ["SNARE", "KICK", "RACK-TOM", "FLOOR-TOM"];
      const aDrum = drumOrder.findIndex((part) => a.id.includes(part));
      const bDrum = drumOrder.findIndex((part) => b.id.includes(part));
      return (
        severity[a.status] - severity[b.status] ||
        (aDrum < 0 ? 99 : aDrum) - (bDrum < 0 ? 99 : bDrum)
      );
    });
  const locationHasEquipmentRecords = availableForLocation.length > 0;
  const directoryMatches = useMemo(() => {
    const rawNormalized = normalizeEquipmentSearch(query);
    // Treat partial typing of "microphone" from "mic" onward as the full
    // category search, so mic / micro / microp / ... / microphone all return
    // the same results and ordering: microphones first, then related labels
    // such as microphone stands.
    const normalized =
      rawNormalized.length >= 3 && "microphone".startsWith(rawNormalized)
        ? "microphone"
        : rawNormalized;
    const locationOrder: Record<string, number> = {
      "MPR 2": 0,
      "MPR 3": 1,
      "MPR 4": 2,
      "MPR 5": 3,
      Auditorium: 4,
      Studio: 5,
      "Live Room": 6,
      "MP Lab 1": 7,
      "MP Lab 2": 8,
      "Arts Block A": 9,
      "Store Room": 99,
    };
    const unavailableOrder: Record<Equipment["status"], number> = {
      away: 0,
      attention: 1,
      missing: 2,
      service: 3,
      ready: 4,
    };
    const directoryCategoryRank = (item: Equipment) => {
      const itemName = normalizeEquipmentSearch(item.name);
      const itemId = normalizeEquipmentSearch(item.id);
      const requestedType = requestedAlternativeType(normalized);

      // Exact equipment name/ID is always the strongest possible match.
      if (itemName === normalized || itemId === normalized) return 0;

      const semanticRank = appWideEquipmentSearchRank(item, normalized);

      // Whenever the query maps to one of our known equipment types, place
      // that actual equipment type before anything that merely contains the
      // same words in its label.
      if (requestedType && equipmentType(item) === requestedType) return 1;

      const queryWords = normalized.split(" ").filter(Boolean);
      const nameWords = itemName.split(" ").filter(Boolean);

      // Words that usually make an item an accessory/related item rather than
      // the main equipment named by a broader search. A descriptor is ignored
      // when the user explicitly searched for it (e.g. "microphone stand",
      // "XLR cable", "power adapter", "kick pedal").
      const relatedDescriptors = new Set([
        "adapter",
        "adaptor",
        "cable",
        "cord",
        "stand",
        "mount",
        "holder",
        "clip",
        "clamp",
        "case",
        "bag",
        "cover",
        "supply",
        "power",
        "pedal",
        "throne",
        "rack",
        "bracket",
      ]);

      const queryDescriptorWords = new Set(
        queryWords.filter((word) => relatedDescriptors.has(word)),
      );

      const hasExtraRelatedDescriptor = nameWords.some(
        (word) =>
          relatedDescriptors.has(word) &&
          !queryDescriptorWords.has(word),
      );

      // A search for "tom" should prioritize the actual tom drums first,
      // followed only by other labels that explicitly contain the word "tom"
      // (for example, tom microphones).
      if (normalized === "tom" || normalized === "toms") {
        const type = equipmentType(item);
        if (type === "floor-tom" || type === "rack-tom") return 1;
        return 2;
      }

      // Broad guitar searches: actual acoustic, electric and bass guitars
      // come first. Related guitar/bass amplifiers follow, then instrument
      // cables/leads. More specific searches such as "guitar amp" or
      // "guitar cable" keep the normal equipment-specific ranking.
      if (normalized === "guitar" || normalized === "guitars") {
        const isRack =
          /\bguitar rack floor stand\b/.test(itemName) || /^gtr rack\b/.test(itemId);
        const isStand =
          !isRack &&
          (/\bguitar stand\b/.test(itemName) || /^gtr stand\b/.test(itemId));
        const isCable =
          /\b(instrument cable|guitar cable|bass cable|instrument lead|guitar lead|bass lead)\b/.test(
            itemName,
          );
        const isAmp =
          /\b(guitar amp|guitar amplifier|bass amp|bass amplifier|amplifier)\b/.test(
            itemName,
          );
        const isActualGuitar =
          !isRack &&
          !isStand &&
          !isCable &&
          !isAmp &&
          (
            /\b(acoustic guitar|electric guitar|bass guitar|stratocaster|telecaster)\b/.test(
              itemName,
            ) ||
            /^(acg|gtr|bas)\b/.test(itemId)
          );

        if (isActualGuitar) return 1;
        if (isAmp) return 2;
        if (isCable) return 3;
        if (isStand) return 4;
        if (isRack) return 5;
      }

      // Broad drum searches: main kit parts first; sticks, pedals, thrones,
      // and similar accessories follow afterwards.
      if (
        normalized === "drum" ||
        normalized === "drums" ||
        normalized === "drum kit" ||
        normalized === "drum set"
      ) {
        const type = equipmentType(item);
        const mainDrumTypes = new Set([
          "drum-kit",
          "floor-tom",
          "rack-tom",
          "snare-drum",
          "kick-drum",
          "hi-hat-cymbals",
          "crash-cymbal",
          "ride-cymbal",
        ]);
        if (mainDrumTypes.has(type)) return 1;
        return 2;
      }

      // Broad category searches should put the actual equipment first. This
      // works for every search term rather than only hard-coded examples:
      // microphone -> microphones, then microphone stands/cables/etc.
      // keyboard -> keyboards, then keyboard adapters/stands/etc.
      // mixer -> mixers, then mixer power cables/etc.
      // speaker -> speakers, then speaker stands/cables/etc.
      if (!hasExtraRelatedDescriptor && semanticRank < 99) return 1;

      return semanticRank < 99 ? 2 : 3;
    };
    const locationRank = (item: Equipment) =>
      locationOrder[item.defaultLocation ?? item.currentLocation] ?? 50;
    const requestedTypeForSearch = requestedAlternativeType(normalized);
    const isBroadDrumSearch =
      normalized === "drum" ||
      normalized === "drums" ||
      normalized === "drum kit" ||
      normalized === "drum set";

    const matches = directoryEquipmentForView.filter((item) => {
      // All directory searches now share the same prefix, shorthand, typo and
      // equipment+accessory combination matching used elsewhere in the app.
      // Existing broad drum/category handling is preserved by the shared tags
      // and the category ranking below.
      if (appWideEquipmentSearchRank(item, normalized) < 99) return true;

      const itemName = normalizeEquipmentSearch(item.name);
      const itemId = normalizeEquipmentSearch(item.id);

      // Preserve the existing broad drum family behavior.
      if (isBroadDrumSearch) {
        const type = equipmentType(item);
        const mainDrumTypes = new Set([
          "drum-kit",
          "floor-tom",
          "rack-tom",
          "snare-drum",
          "kick-drum",
          "hi-hat-cymbals",
          "crash-cymbal",
          "ride-cymbal",
        ]);
        const isMainDrumPart = mainDrumTypes.has(type);
        const isDrumAccessory =
          /\b(drumstick|drum stick|kick pedal|bass drum pedal|hi[- ]?hat pedal|drum pedal|drum throne|drum stool)\b/.test(
            itemName,
          );
        if (isMainDrumPart || isDrumAccessory) return true;
      }

      if (normalized === "tom" || normalized === "toms") {
        const type = equipmentType(item);
        if (type === "floor-tom" || type === "rack-tom") return true;
        return (
          containsNormalizedPhrase(itemName, "tom") ||
          containsNormalizedPhrase(itemId, "tom")
        );
      }

      if (
        requestedTypeForSearch &&
        equipmentType(item) === requestedTypeForSearch
      ) {
        return true;
      }

      return false;
    });
    const available = matches
      .filter((item) => item.status === "ready")
      .sort(
        (a, b) =>
          directoryCategoryRank(a) - directoryCategoryRank(b) ||
          locationRank(a) - locationRank(b) ||
          a.name.localeCompare(b.name),
      );
    const unavailable = matches
      .filter((item) => item.status !== "ready")
      .sort(
        (a, b) =>
          directoryCategoryRank(a) - directoryCategoryRank(b) ||
          locationRank(a) - locationRank(b) ||
          unavailableOrder[a.status] - unavailableOrder[b.status] ||
          a.name.localeCompare(b.name),
      );
    return { all: matches, available, unavailable };
  }, [directoryEquipmentForView, query]);

  if (!currentUser && !demoPresentation) {
    return <BookingLoginPage onUserChange={(user) => { setCurrentUser(user); setStudentName(user.fullName); }} />;
  }
  if (screen === "home")
    return (
      <HomeScreen
        onBook={() => {
          setConflictSlot("");
          setRecoveringFromConflict(false);
          go("date");
        }}
        onEquipment={() => {
          setQuery("");
          setSearched(false);
          go("directory-search");
        }}
        onAvailability={() => go("availability")}
        onReservations={() => go("reservations")}
        onSupport={() => go("support")}
         onLogout={async () => {
           const result = await logout();
           if (result.success) setCurrentUser(null);
         }}
         user={currentUser}
         onUserChange={setCurrentUser}
         greeting={greeting}
        activeReservation={visibleActiveReservation}
        reservationPhase={reservationPhase}
        reservationNowMs={reservationNowMs}
      />
    );
  if (screen === "reservations") return <LiveReservations user={currentUser} onBack={back} />;
  if (screen === "support") return <LiveSupport user={currentUser} onBack={back} />;
  if (screen === "availability")
    return (
      <ScheduleScreen
        back={back}
        onSelect={(selectedRoom, date, index) => {
          const slot = allTimeSlots[index];
          if (!slot) return;
          setSelectedDate(date);
          setRoom(selectedRoom);
          setMprSelected(selectedRoom);
          setSelectedSlots([slot]);
          setSelectedPeriod(periods.findIndex((period) => period.times.includes(slot)));
          setTime(slot);
          go("slots");
        }}
      />
    );
  if (screen === "date") {
    const institutionNow = getInstitutionNow();
    const today = new Date(`${institutionNow.date}T00:00:00`);
    today.setHours(0, 0, 0, 0);

    // Asmi releases daytime bookings at 06:00. Before then only the
    // remaining midnight–06:00 tail of today is selectable; after then the
    // only additional selectable date is tomorrow's midnight–06:00 tail.
    const latestBookableDate = new Date(`${addCalendarDays(institutionNow.date, institutionNow.minutes < 360 ? 0 : 1)}T00:00:00`);

    const earliestBrowseMonth = new Date(
      today.getFullYear(),
      today.getMonth() - 12,
      1,
    );
    const latestBrowseMonth = new Date(
      today.getFullYear(),
      today.getMonth() + 12,
      1,
    );
    const previousMonthStart = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth() - 1,
      1,
    );
    const nextMonthStart = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth() + 1,
      1,
    );

    const monthKey = (date: Date) =>
      date.getFullYear() * 12 + date.getMonth();
    const canBrowsePrevious =
      monthKey(previousMonthStart) >= monthKey(earliestBrowseMonth);
    const canBrowseNext =
      monthKey(nextMonthStart) <= monthKey(latestBrowseMonth);

    // These values come from the real JavaScript calendar for the displayed
    // month/year, so weekday placement, month length, leap years and year
    // rollover are all calculated rather than hard-coded.
    const days = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth() + 1,
      0,
    ).getDate();
    const leading = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth(),
      1,
    ).getDay();

    return (
      <Shell
        title="Choose a date"
        subtitle="Select a date to view MPR availability."
        back={back}
        compactActionBarPadding
        lockMobileViewport
      >
        <div className="rounded-3xl border border-slate-200 dark:border-[#30384D] bg-white dark:bg-[#1B2133] p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <button
              disabled={!canBrowsePrevious}
              onClick={() => {
                if (canBrowsePrevious) setCalendarMonth(previousMonthStart);
              }}
              aria-label={`Previous month${canBrowsePrevious ? `, ${monthName(previousMonthStart)}` : ""}`}
              className="grid h-11 w-11 place-items-center rounded-xl text-xl text-slate-500 dark:text-[#CBD3E2] hover:bg-violet-50 dark:hover:bg-[#2B2145] hover:text-violet-700 dark:hover:text-violet-200 disabled:cursor-not-allowed disabled:text-slate-300 dark:disabled:text-[#657089] disabled:hover:bg-transparent"
            >
              ‹
            </button>
            <strong aria-live="polite">{monthName(calendarMonth)}</strong>
            <button
              disabled={!canBrowseNext}
              onClick={() => {
                if (canBrowseNext) setCalendarMonth(nextMonthStart);
              }}
              aria-label={`Next month${canBrowseNext ? `, ${monthName(nextMonthStart)}` : ""}`}
              className="grid h-11 w-11 place-items-center rounded-xl text-xl text-slate-500 dark:text-[#CBD3E2] hover:bg-violet-50 dark:hover:bg-[#2B2145] hover:text-violet-700 dark:hover:text-violet-200 disabled:cursor-not-allowed disabled:text-slate-300 dark:disabled:text-[#657089] disabled:hover:bg-transparent"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-sm">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <span key={i} className="py-2 text-xs font-bold text-slate-400 dark:text-[#7F8AA3]">
                {d}
              </span>
            ))}

            {Array.from({ length: leading }, (_, i) => (
              <span key={`blank-${i}`} aria-hidden="true" />
            ))}

            {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
              const value = new Date(
                calendarMonth.getFullYear(),
                calendarMonth.getMonth(),
                d,
              );
              value.setHours(0, 0, 0, 0);

              const isToday = sameDay(value, today);
              const isPast = value < today;
              const isTooFar = value > latestBookableDate;
              const isBookable = !isPast && !isTooFar;
              const isSelected = selectedDate
                ? sameDay(value, selectedDate)
                : false;

              return (
                <button
                  key={`${calendarMonth.getFullYear()}-${calendarMonth.getMonth()}-${d}`}
                  disabled={!isBookable}
                  onClick={() => {
                    setSelectedDate(value);
                    setSelectedPeriod(null);
                  }}
                  aria-label={`${longDate(value)}${isToday ? ", today" : ""}${isPast ? ", unavailable" : isTooFar ? ", booking not open yet" : ""}`}
                  aria-current={isToday ? "date" : undefined}
                  aria-pressed={isSelected}
                  className={`h-11 rounded-xl text-sm font-medium transition ${
                    isSelected
                      ? "bg-violet-600 dark:bg-violet-600 text-white shadow-lg shadow-violet-200 dark:shadow-none"
                      : !isBookable
                        ? "cursor-not-allowed text-slate-300 dark:text-[#74809A]"
                        : isToday
                          ? "bg-violet-50 text-violet-700 dark:bg-[#211A38] dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-500"
                          : "hover:bg-slate-50 dark:hover:bg-[#202739]"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>

          <p className="mt-4 text-center text-xs font-medium text-slate-500 dark:text-[#9AA6BC]">
            {bookingWindowMessage(institutionNow)}
          </p>
        </div>

        <ActionBar>
            <Primary disabled={!selectedDate || dateKey(selectedDate) > dateKey(latestBookableDate)} onClick={() => go("mpr")}>
            Choose an MPR <ArrowRight />
          </Primary>
        </ActionBar>
      </Shell>
    );
  }
  if (screen === "mpr")
    return (
      <Shell
        title="Choose an MPR"
        subtitle={`Selected date: ${longDate(selectedDate || new Date())}`}
        back={back}
        lockMobileViewport
        compactMobileHeader
        compactActionBarPadding
      >
        {roomsStatus === "loading" && <p role="status" className="rounded-2xl border border-violet-100 bg-violet-50 p-4 text-sm text-violet-800 dark:border-violet-500/30 dark:bg-[#211A38] dark:text-violet-200">Loading available rooms…</p>}
        {roomsStatus === "error" && <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-800 dark:bg-[#321820] dark:text-rose-200">Could not load the available rooms. Please retry.</p>}
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
          {bookableRooms.map((roomOption) => {
            const r = roomOption.name;
            return (
            <button
              key={r}
              onClick={() => setMprSelected(r)}
              className={`flex min-h-14 w-full items-center justify-center rounded-2xl border p-3 text-center font-semibold transition-all duration-150 sm:min-h-16 sm:p-4 ${mprSelected === r ? "border-violet-500 bg-violet-50 dark:bg-[#211A38] text-violet-800 dark:text-violet-100 shadow-sm hover:-translate-y-0.5 hover:shadow-md" : "border-slate-200 bg-white dark:border-violet-500/40 dark:bg-[#1B2133] dark:text-[#F5F7FF] hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-50/70 hover:shadow-md dark:hover:border-violet-500/70 dark:hover:bg-[#211A38]"}`}
            >
              <span>{roomOption.name}</span>
            </button>
            );
          })}
        </div>
        <ActionBar>
          <Primary
            disabled={!mprSelected || roomsStatus !== "loaded"}
            onClick={() => {
              const returnDirectlyToTimeSlots = returnToTimeSlotsAfterMprChange;
              const roomChanged = mprSelected !== room;

              setRoom(mprSelected);

              // If the user only opened "Change" and kept the same MPR,
              // preserve the selected period. A genuinely different MPR
              // starts with a fresh period choice in the normal booking flow.
              if (!returnDirectlyToTimeSlots && roomChanged) {
                setSelectedPeriod(null);
              }

              if (recoveringFromConflict && mprSelected === "MPR 5") {
              } else {
                // Time slots are room-specific. Preserve them only when the
                // user confirms the same MPR; clear them when the room changes.
                if (roomChanged) {
                  setTime("");
                  setSelectedSlots([]);
                }
              }

              setRecoveringFromConflict(false);
              setReturnToTimeSlotsAfterMprChange(false);
              go(
                returnDirectlyToTimeSlots
                  ? "slots"
                  : "period",
              );
            }}
          >
            Choose a Time Period <ArrowRight />
          </Primary>
        </ActionBar>
      </Shell>
    );

  if (screen === "period") {
    const periodOptions = [
      { label: "Late Night", range: "12:00 AM–6:00 AM" },
      { label: "Early Morning", range: "6:00 AM–9:00 AM" },
      { label: "Morning", range: "9:00 AM–12:00 PM" },
      { label: "Afternoon", range: "12:00 PM–5:00 PM" },
      { label: "Evening", range: "5:00 PM–8:00 PM" },
      { label: "Night", range: "8:00 PM–12:00 AM" },
      { label: "Next day · Late Night", range: "12:00 AM–6:00 AM" },
    ];

    return (
      <Shell
        title="Choose a Time Period"
        subtitle={`Selected date: ${longDate(selectedDate || new Date())}`}
        back={back}
        lockMobileViewport
        compactMobileHeader
        compactActionBarPadding
        headerTitleAside={
          <div className="hidden sm:flex min-h-11 items-center gap-2.5 rounded-xl border border-slate-200/80 dark:border-[#30384D]/80 bg-white dark:bg-[#1B2133] px-3 py-2 shadow-sm">
            <MapPin className="shrink-0 text-violet-600 dark:text-violet-300" size={18} />
            <div className="min-w-0 leading-tight">
              <small className="text-xs text-slate-500 dark:text-[#9AA6BC]">
                Selected MPR
              </small>
              <p className="mt-0.5 text-sm font-semibold">{room}</p>
            </div>
            <button
              onClick={back}
              className="ml-auto flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-[#2B2145]"
            >
              Change <ChevronDown size={14} />
            </button>
          </div>
        }
      >
        <div className="mb-2 flex min-h-12 items-center gap-2.5 rounded-2xl border border-slate-200 dark:border-[#30384D] bg-white dark:bg-[#1B2133] px-3.5 py-2 shadow-sm sm:hidden">
          <MapPin className="shrink-0 text-violet-600 dark:text-violet-300" size={17} />
          <span className="text-[13px] text-slate-500 dark:text-[#9AA6BC]">Selected MPR</span>
          <strong className="ml-auto text-sm">{room}</strong>
          <button
            onClick={back}
            className="ml-1.5 flex items-center gap-1 text-[13px] font-semibold text-violet-700 dark:text-violet-300"
          >
            Change <ChevronDown size={14} />
          </button>
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
          {periodOptions.map((period, index) => (
            <button
              key={period.label}
              type="button"
              onClick={() => setSelectedPeriod(index)}
              aria-pressed={selectedPeriod === index}
              className={`flex min-h-[52px] w-full items-center justify-between rounded-2xl border px-3.5 py-2 text-left transition-all duration-150 sm:min-h-16 sm:px-4 sm:py-3 ${
                selectedPeriod === index
                  ? "border-violet-500 bg-violet-50 dark:bg-[#211A38] text-violet-800 dark:text-violet-100 shadow-sm hover:-translate-y-0.5 hover:shadow-md"
                  : "border-slate-200 bg-white dark:border-violet-500/40 dark:bg-[#1B2133] dark:text-[#F5F7FF] hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-50/70 hover:shadow-md dark:hover:border-violet-500/70 dark:hover:bg-[#211A38]"
              }`}
            >
              <span>
                <span className="block font-semibold">{period.label}</span>
                <span className="mt-0 block text-[13px] leading-4 font-normal text-slate-500 dark:text-[#9AA6BC] sm:mt-0.5 sm:text-sm sm:leading-normal">
                  {period.range}
                </span>
              </span>
            </button>
          ))}
        </div>

        <ActionBar>
          <Primary
            disabled={selectedPeriod === null}
            onClick={() => go("slots")}
          >
            Choose Your Time Slots <ArrowRight />
          </Primary>
        </ActionBar>
      </Shell>
    );
  }

  const bookingDate = bookingDateForSlots(selectedDate || new Date(), selectedSlots);
  const roomEquipmentForView: RoomEquipmentViewState = demoPresentation
    ? { status: "loaded", items: fixtureEquipmentForRoom(room) }
    : liveRoomEquipment[room] ?? { status: "loading", items: [] };
  const roomEquipmentData = roomEquipmentForView.items;

  if (
    ["setup", "setup2", "setup3", "setup4", "setup5", "issues3", "issues5", "available-equipment"].includes(screen) &&
    !demoPresentation &&
    roomEquipmentForView.status !== "loaded"
  ) {
    return (
      <Shell
        title={`${room} equipment`}
        subtitle="Review live equipment readiness before continuing."
        back={back}
        home={home}
      >
        <EquipmentDataNotice status={roomEquipmentForView.status} />
      </Shell>
    );
  }

  if (["slots", "slots2", "slots3", "slots4", "slots5"].includes(screen)) {
    if (!demoPresentation && liveSlots === null) {
      const failed = liveSlotResult?.key === liveSlotKey;
      return <Shell title={`${room} availability`} subtitle="Live availability is required before choosing a time." back={back} home={home}>
        <p role={failed ? "alert" : "status"} className="mt-6 text-sm">{failed ? "Could not load the complete schedule. No sample availability is shown." : "Loading live availability…"}</p>
        {failed && <button className="mt-4 rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white" onClick={() => setAvailabilityRetry((value) => value + 1)}>Retry availability</button>}
      </Shell>;
    }
    const liveBookedStarts =
      liveSlots !== null ? Object.keys(liveSlots).filter((t) => liveSlots[t].booked) : null;
    const baseBooked =
      liveBookedStarts !== null
        ? liveBookedStarts
        : room === "MPR 2"
          ? booked2
          : room === "MPR 4"
            ? booked4
            : room === "MPR 5"
              ? booked5
              : booked3;
    const booked = new Set(baseBooked);
    if (conflictSlot) {
      booked.add(conflictSlot);
    }
    return (
      <Slots
        key={`${room}:${dateKey(selectedDate || new Date())}:${selectedPeriod ?? 0}`}
        room={room}
        date={selectedDate || new Date()}
        initialPeriod={selectedPeriod ?? 0}
        selectedSlots={selectedSlots}
        setSelectedSlots={(slots) => {
          setSelectedSlots(slots);
          setTime(timeRangeLabel(slots));
        }}
        booked={booked}
        back={back}
        onChangeMpr={changeMprFromTimeSlots}
        onContinue={() => go("setup")}
      />
    );
  }
  if (["setup", "setup2", "setup3", "setup4", "setup5"].includes(screen)) {
    const data = roomEquipmentData;
    const ready = data.filter((x) => x.status === "ready");
    const issueOrder: Record<Equipment["status"], number> = {
      missing: 0,
      service: 1,
      away: 2,
      attention: 3,
      ready: 4,
    };
    const unavailable = data
      .filter((x) => x.status !== "ready")
      .sort(
        (a, b) =>
          issueOrder[a.status] - issueOrder[b.status] ||
          a.name.localeCompare(b.name),
      );
    const issueReason = (item: Equipment) =>
      item.status === "missing"
        ? "Its current location cannot be confirmed."
        : item.status === "attention"
          ? "Needs tuning before reliable use."
          : item.status === "service"
            ? "Out of service and not currently usable."
            : `Currently located outside ${room}.`;

    return (
      <Shell
        title={`${room} setup`}
        subtitle="Review equipment readiness before continuing."
        scrollHint={
          unavailable.length === 0
            ? "All assigned equipment is currently available."
            : undefined
        }
        back={back}
      >
        <Summary room={room} time={time} date={bookingDate} />

        {unavailable.length > 0 ? (
          <>
            <div className="mb-2.5 mt-4 flex min-w-0 items-start gap-2 sm:mb-3 sm:mt-6 sm:items-center">
              <TriangleAlert className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300 sm:mt-0" size={20} />
              <h2 className="min-w-0 break-words text-[1.05rem] font-semibold leading-6 sm:text-lg">
                {unavailable.length} of {data.length} assigned {unavailable.length === 1 ? "item needs" : "items need"} attention
              </h2>
            </div>
            <div className="grid items-stretch gap-3 sm:grid-cols-2">
              {unavailable.map((item) => {
                const mpr5AlternativeQuery =
                  item.id.startsWith("INST-")
                    ? "Instrument cable"
                    : item.id.includes("SNARE")
                      ? "Snare drum"
                      : item.id.includes("FLOOR-TOM")
                        ? "Floor tom"
                        : item.id.includes("RACK-TOM")
                          ? "Rack tom"
                          : item.id.includes("KICK")
                            ? "Kick drum"
                            : item.name;
                const canSearchAlternatives =
                  (room === "MPR 3" &&
                    (item.id === "MIX-01" || item.id === "MS-01")) ||
                  room === "MPR 5" ||
                  (room === "MPR 4" && item.id === "KEY-04-ADP-04");
                return (
                  <Issue
                    key={item.id}
                    item={item}
                    reason={issueReason(item)}
                    action={canSearchAlternatives ? "Search alternatives" : undefined}
                    onAction={
                      room === "MPR 3" && item.id === "MIX-01"
                        ? () => {
                            setAlternativeFromDirectory(false);
                            setAlternativeSourceRoom("MPR 3");
                            setAlternativeSourceItemId(item.id);
                            setQuery("Mixer");
                            setSearched(false);
                            go("mixer-search");
                          }
                        : room === "MPR 3" && item.id === "MS-01"
                          ? () => {
                              setAlternativeFromDirectory(false);
                              setAlternativeSourceRoom("MPR 3");
                              setAlternativeSourceItemId(item.id);
                              setQuery("Microphone stand");
                              setSearched(false);
                              go("stand-search");
                            }
                          : room === "MPR 5"
                            ? () => {
                                setAlternativeFromDirectory(false);
                                setAlternativeSourceRoom("MPR 5");
                                setAlternativeSourceItemId(item.id);
                                setAlternativeSearchLabel(
                                  mpr5AlternativeQuery.toLowerCase(),
                                );
                                setQuery(mpr5AlternativeQuery);
                                setSearched(false);
                                go("alternative-search");
                              }
                            : room === "MPR 4" && item.id === "KEY-04-ADP-04"
                              ? () => {
                                  const alternativeQuery = alternativeQueryForItem(item);
                                  setAlternativeFromDirectory(false);
                                  setAlternativeSourceRoom("MPR 4");
                                  setAlternativeSourceItemId(item.id);
                                  setAlternativeSearchLabel(alternativeQuery.toLowerCase());
                                  setQuery(alternativeQuery);
                                  setSearched(false);
                                  go("alternative-search");
                                }
                              : undefined
                    }
                  />
                );
              })}
            </div>
          </>
        ) : (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-[#10271F] p-4 text-emerald-950 dark:text-emerald-200 sm:mt-6">
            <Check className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" size={20} />
            <div>
              <p className="font-semibold">All assigned equipment is currently available</p>
              <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
                No equipment issues are currently shown for {room}.
              </p>
            </div>
          </div>
        )}

        <ActionBar>
          <button
            type="button"
            onClick={() => {
              setAvailableEquipmentQuery("");
              go("available-equipment");
            }}
            className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-[#10271F] px-4 py-2.5 text-left text-emerald-900 dark:text-emerald-200 transition hover:border-emerald-300 dark:hover:border-emerald-500 hover:bg-emerald-100 dark:hover:bg-[#153327]"
          >
            <span>
              <strong className="text-sm">View available equipment ({ready.length})</strong>
              <small className="mt-0.5 block text-xs text-emerald-700 dark:text-emerald-300">
                View the {ready.length} {ready.length === 1 ? "item" : "items"} currently available in {room}.
              </small>
            </span>
            <ArrowRight className="shrink-0" size={19} />
          </button>
          <Primary onClick={() => go("review")}>
            Continue with {room} <ArrowRight />
          </Primary>
        </ActionBar>
      </Shell>
    );
  }

  if (screen === "available-equipment") {
    const data = roomEquipmentData;

    const ready = data.filter((item) => item.status === "ready");
    const normalizedAvailableQuery =
      normalizeEquipmentSearch(availableEquipmentQuery);

    const filteredReady = normalizedAvailableQuery
      ? ready
          .map((item, index) => ({
            item,
            index,
            rank: liveListEquipmentSearchRank(
              item,
              normalizedAvailableQuery,
            ),
          }))
          .filter(({ rank }) => rank < 99)
          .sort((a, b) => a.rank - b.rank || a.index - b.index)
          .map(({ item }) => item)
      : ready;

    return (
      <Shell
        compactMobileHeader
        title={`Available equipment in ${room}`}
        subtitle={`${ready.length} items currently available`}
        scrollHint="For viewing only — equipment is not selected or reserved here."
        back={back}
        home={home}
      >
        <div className="mb-3 sm:mb-5">
          <label
            className="text-sm font-semibold"
            htmlFor="available-equipment-query"
          >
            Search available equipment in {room}
          </label>
          <Input
            id="available-equipment-query"
            className="mt-1 h-11 rounded-2xl bg-white dark:!bg-[#1B2133] dark:!text-[#F5F7FF] dark:placeholder:!text-[#74809A] sm:mt-2 sm:h-12"
            value={availableEquipmentQuery}
            onChange={(e) => setAvailableEquipmentQuery(e.target.value)}
            placeholder="Search by equipment name or ID..."
            autoComplete="off"
          />
          {normalizedAvailableQuery && (
            <p className="mt-2 text-[13px] leading-5 font-normal text-slate-500 dark:text-[#9AA6BC] sm:mt-3 sm:text-sm">
              {filteredReady.length} available{" "}
              {filteredReady.length === 1 ? "item matches" : "items match"} “
              {availableEquipmentQuery.trim()}”.
            </p>
          )}
        </div>

        {filteredReady.length > 0 ? (
          <div className="grid items-stretch divide-y divide-slate-300 dark:divide-[#30384D] px-1 sm:relative sm:grid-cols-2 sm:gap-x-6 sm:before:pointer-events-none sm:before:absolute sm:before:inset-y-0 sm:before:left-1/2 sm:before:w-px sm:before:-translate-x-1/2 sm:before:bg-slate-300 dark:sm:before:bg-[#30384D] sm:before:content-[''] sm:divide-y-0 sm:px-0 [&>*:nth-child(n+3)]:sm:border-t [&>*:nth-child(n+3)]:sm:border-slate-300 dark:[&>*:nth-child(n+3)]:sm:border-[#30384D]">
            {filteredReady.map((item) => (
              <div key={item.id} className="min-w-0 px-0 sm:px-4">
                <EquipmentRow
                  item={item}
                  showStatus={false}
                  availableEquipmentLayout
                  availableStatusOnIdRow
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-xl">
            <SearchEmpty query={availableEquipmentQuery.trim()} />
          </div>
        )}
      </Shell>
    );
  }
  if (screen === "issues3") {
    const mixer = roomEquipmentData.find((item) => item.id === "MIX-01")!;
    const microphoneStand = roomEquipmentData.find((item) => item.id === "MS-01")!;
    return (
      <Shell
        title="Equipment availability issues"
        subtitle="Two assigned items are not currently available in MPR 3."
        scrollHint="Review both affected items and available alternatives."
        back={back}
      >
        <Summary room="MPR 3" time={time} date={bookingDate} />
        <div className="mt-4 grid items-stretch gap-3 sm:grid-cols-2">
          <Issue
            item={mixer}
            reason="Currently located outside MPR 3."
            action="Search Alternatives"
            onAction={() => {
              setAlternativeFromDirectory(false);
                            setAlternativeSourceRoom("MPR 3");
              setAlternativeSourceItemId(mixer.id);
              setQuery("Mixer");
              setSearched(false);
              go("mixer-search");
            }}
          />
          <Issue
            item={microphoneStand}
            reason="Currently located outside MPR 3."
            action="Search Alternatives"
            onAction={() => {
              setAlternativeFromDirectory(false);
                            setAlternativeSourceRoom("MPR 3");
              setAlternativeSourceItemId(microphoneStand.id);
              setQuery("Microphone stand");
              setSearched(false);
              go("stand-search");
            }}
          />
        </div>
        <ActionBar>
          <Primary onClick={() => go("review")}>
            Continue with MPR 3
          </Primary>
        </ActionBar>
      </Shell>
    );
  }
  if (screen === "issues5") {
    const issueOrder: Record<Equipment["status"], number> = {
      missing: 0,
      service: 1,
      away: 2,
      attention: 3,
      ready: 4,
    };
    const affected = roomEquipmentData
      .filter((item) => item.status !== "ready")
      .sort(
        (a, b) =>
          issueOrder[a.status] - issueOrder[b.status] ||
          a.name.localeCompare(b.name),
      );
    return (
      <Shell
        title="Equipment availability issues"
        subtitle={`${affected.length} assigned items need attention in MPR 5.`}
        scrollHint={`Scroll to review all ${affected.length} affected items.`}
        back={back}
      >
        <Summary room="MPR 5" time={time} date={bookingDate} />
        <div className="mt-4 grid items-stretch gap-3 sm:grid-cols-2">
          {affected.map((item) => {
            const alternativeQuery =
              item.id.startsWith("INST-")
                ? "Instrument cable"
                : item.id.includes("SNARE")
                  ? "Snare drum"
                  : item.id.includes("FLOOR-TOM")
                    ? "Floor tom"
                    : item.id.includes("RACK-TOM")
                      ? "Rack tom"
                      : item.id.includes("KICK")
                        ? "Kick drum"
                        : item.name;
            return (
              <Issue
                key={item.id}
                item={item}
                reason={
                  item.status === "missing"
                    ? "Its current location cannot be confirmed."
                    : item.status === "attention"
                      ? "Needs tuning before reliable use."
                      : item.status === "service"
                        ? "Out of service and not currently usable."
                        : "Currently located outside MPR 5."
                }
                action="Search alternatives"
                onAction={() => {
                  setAlternativeFromDirectory(false);
                  setAlternativeSourceRoom("MPR 5");
                  setAlternativeSourceItemId(item.id);
                  setAlternativeSearchLabel(alternativeQuery.toLowerCase());
                  setQuery(alternativeQuery);
                  setSearched(false);
                  go("alternative-search");
                }}
              />
            );
          })}
        </div>
        <ActionBar>
          <Primary onClick={() => go("review")}>
            Continue with MPR 5
          </Primary>
        </ActionBar>
      </Shell>
    );
  }
  if (
    screen === "mixer-search" ||
    screen === "stand-search" ||
    screen === "alternative-search"
  ) {
    if (!demoPresentation && directoryEquipmentStatus !== "loaded") {
      return (
        <Shell
          title="Equipment alternatives"
          subtitle="Find alternatives by location and condition."
          back={back}
          home={home}
        >
          <EquipmentDataNotice status={directoryEquipmentStatus} />
        </Shell>
      );
    }
    const mixer = screen === "mixer-search";
    const stand = screen === "stand-search";
    const sourceRoom = alternativeSourceRoom || room;
    const resultOrder: Record<Equipment["status"], number> = {
      ready: 0,
      away: 1,
      attention: 2,
      missing: 3,
      service: 4,
    };
    const isBookableMprLocation = (location: string) =>
      bookableRooms.some((roomOption) => roomOption.name === location);
    const isRoomDefiningAlternative = (item: Equipment) =>
      [
        "keyboard-piano",
        "mixer",
        "monitor-speaker",
        "kick-drum",
        "snare-drum",
        "rack-tom",
        "floor-tom",
      ].includes(equipmentType(item));
    const canViewAlternativeMpr = (item: Equipment) =>
      item.status === "ready" &&
      isBookableMprLocation(item.currentLocation) &&
      item.currentLocation !== sourceRoom &&
      isRoomDefiningAlternative(item);
    const mprNumber = (location: string) => {
      const match = location.match(/^MPR ([2345])$/);
      return match ? Number(match[1]) : null;
    };
    const orderedNonMprLocations = [
      "MP Lab 1",
      "MP Lab 2",
      "Live Room",
      "Studio",
      "Auditorium",
      "Store Room",
    ];
    const nonMprLocationPriority = (item: Equipment) => {
      const locations = [item.currentLocation ?? "", item.defaultLocation ?? ""];
      const ranks = locations
        .map((location) => orderedNonMprLocations.indexOf(location))
        .filter((rank) => rank !== -1);
      return ranks.length ? Math.min(...ranks) : orderedNonMprLocations.length;
    };
    const alternativeGroupPriority = (item: Equipment) => {
      const currentMpr = mprNumber(item.currentLocation ?? "");
      const defaultMpr = mprNumber(item.defaultLocation ?? "");
      const isAvailable = item.status === "ready";
      const isMprRelated = currentMpr !== null || defaultMpr !== null;

      // 1. Fully usable equipment currently in an MPR.
      if (isAvailable && currentMpr !== null) {
        return [0, currentMpr - 2];
      }

      // 2. Fully functional MPR-related equipment that is merely elsewhere.
      // It stays near the MPR results, but keeps its truthful status/location.
      if (
        isMprRelated &&
        item.condition === "Fully functional" &&
        item.status !== "missing" &&
        item.status !== "service"
      ) {
        const mpr = currentMpr ?? defaultMpr!;
        return [1, mpr - 2];
      }

      // 3. All other available equipment, in the requested location order.
      if (isAvailable) {
        return [2, nonMprLocationPriority(item)];
      }

      // 4. Genuine attention/unusable results always come last, even when
      // assigned to or currently inside an MPR. Location only orders within
      // this final group.
      const mprRank =
        currentMpr !== null
          ? currentMpr - 2
          : defaultMpr !== null
            ? defaultMpr - 2
            : null;

      return [
        3,
        mprRank !== null ? mprRank : 4 + nonMprLocationPriority(item),
        resultOrder[item.status],
      ];
    };
    const results = directoryEquipmentForView
      .filter(
        (item) =>
          item.id !== alternativeSourceItemId &&
          alternativeEquipmentMatches(item, query),
      )
      .sort((a, b) => {
        const [aGroup, aLocation] = alternativeGroupPriority(a);
        const [bGroup, bLocation] = alternativeGroupPriority(b);
        return (
          aGroup - bGroup ||
          aLocation - bLocation ||
          (a.currentLocation ?? "").localeCompare(b.currentLocation ?? "") ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id)
        );
      });
    return (
      <Shell
        title={`Search for another ${
          mixer ? "mixer" : stand ? "microphone stand" : alternativeSearchLabel
        }`}
        subtitle="Find alternatives by location and condition."
        scrollHint=""
        compactMobileHeader
        back={() => {
          if (!alternativeFromDirectory && room !== sourceRoom) setRoom(sourceRoom);
          back();
        }}
        stickyHeader={false}
      >
        <label className="text-sm font-semibold" htmlFor="equipment-query">
          Equipment name or ID
        </label>
        <form
          className="mt-1 flex gap-1 max-sm:flex-col sm:mt-2 sm:gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) setSearched(true);
          }}
        >
          <Input
            id="equipment-query"
            value={query}
            placeholder="e.g., monitor, microphone or equipment ID"
            onChange={(e) => {
              setQuery(e.target.value);
              setSearched(false);
            }}
            className="min-h-11 rounded-2xl bg-white dark:!bg-[#1B2133] dark:!text-[#F5F7FF] dark:placeholder:!text-[#74809A] sm:min-h-12"
          />
          <Button
            type="submit"
            disabled={!query.trim()}
            variant={searched ? "outline" : "default"}
            className={
              searched
                ? "min-h-11 rounded-2xl border-violet-300 bg-white dark:bg-[#211A38] dark:border-violet-500/70 px-5 font-semibold text-violet-700 dark:text-violet-200 shadow-none hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-[#2B2145] dark:hover:border-violet-400 hover:text-violet-800 dark:hover:text-violet-100 max-sm:w-full"
                : "min-h-11 rounded-2xl bg-violet-600 dark:bg-violet-600 dark:hover:bg-violet-500 px-5 max-sm:w-full sm:min-h-12"
            }
          >
            <Search size={18} /> Search
          </Button>
        </form>
        {searched &&
          (results.length > 0 ? (
            <>
              <p className="mt-2 text-sm font-medium text-slate-600 dark:text-[#AAB3C7] sm:mt-5">
                {results.length} {results.length === 1 ? "result" : "results"}{" "}
                for “{query.trim()}”
              </p>
              <p className="mt-0.5 text-[13px] leading-5 text-slate-500 dark:text-[#9AA6BC] sm:mt-1 sm:text-sm">
                For reference only — equipment cannot be reserved here.
              </p>
              <div className="mt-2 grid items-stretch divide-y divide-slate-300 dark:divide-[#30384D] border-y border-slate-200 dark:border-[#30384D] sm:mt-3 sm:relative sm:grid-cols-2 sm:gap-x-6 sm:before:pointer-events-none sm:before:absolute sm:before:inset-y-0 sm:before:left-1/2 sm:before:w-px sm:before:-translate-x-1/2 sm:before:bg-slate-300 dark:sm:before:bg-[#30384D] sm:before:content-[''] sm:divide-y-0 sm:border-y-0 [&>*:nth-child(n+3)]:sm:border-t [&>*:nth-child(n+3)]:sm:border-slate-300 dark:[&>*:nth-child(n+3)]:sm:border-[#30384D]">
                {results.map((item) => (
                  <EquipmentRow
                    key={item.id}
                    item={item}
                    showDefault
                    compactResult
                    action={
                      !alternativeFromDirectory && canViewAlternativeMpr(item) ? (
                        <div className="flex justify-center">
                          <Button
                            onClick={() => {
                              const targetRoom = item.currentLocation;
                              setRoom(targetRoom);
                              go("slots");
                            }}
                            variant="ghost"
                            className="h-auto min-h-11 w-auto justify-start gap-1.5 rounded-xl border border-violet-200 dark:border-violet-500/70 !bg-violet-50/70 dark:!bg-[#211A38] px-3.5 text-sm font-semibold !text-violet-700 dark:!text-violet-200 shadow-none transition-colors hover:!border-violet-300 dark:hover:!border-violet-400 hover:!bg-violet-100 dark:hover:!bg-[#2B2145] hover:!text-violet-800 dark:hover:!text-violet-100 active:!bg-violet-200 dark:active:!bg-[#332653] focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                          >
                            View {item.currentLocation} availability <ArrowRight className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <SearchEmpty query={query} />
          ))}
        {!alternativeFromDirectory && (
          <ActionBar>
            <Button
              onClick={() => {
                setRoom(sourceRoom);
                go("review");
              }}
              className="min-h-12 w-full rounded-2xl bg-violet-600 dark:bg-violet-600 font-semibold text-white shadow-sm dark:shadow-none hover:bg-violet-700 dark:hover:bg-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
            >
              Continue booking with {sourceRoom}
            </Button>
          </ActionBar>
        )}
      </Shell>
    );
  }
  if (screen === "review") {
    const data = roomEquipmentData;
    const reviewOrder: Record<Equipment["status"], number> = {
      missing: 0,
      service: 1,
      away: 2,
      attention: 3,
      ready: 4,
    };
    const unavailable = data
      .filter((x) => x.status !== "ready")
      .sort(
        (a, b) =>
          reviewOrder[a.status] - reviewOrder[b.status] ||
          a.name.localeCompare(b.name),
      );
    const hasIssues = unavailable.length > 0;
    return (
      <Shell
        title="Review reservation"
        subtitle="Check the details before confirming."
        back={back}
      >
        <Summary
          room={room}
          time={time}
          date={bookingDate}
          bookedFor={currentUser?.fullName}
        />
        <div
          className={`mt-3.5 rounded-2xl border p-3.5 sm:mt-5 sm:p-4 ${
            hasIssues
              ? "border-amber-200/70 bg-amber-50/40 dark:border-amber-300/20 dark:bg-amber-950/10"
              : "border-slate-200 bg-white dark:border-[#30384D] dark:bg-[#1B2133]"
          }`}
        >
          <div className="flex items-start gap-2.5 sm:gap-3">
            {hasIssues ? (
              <TriangleAlert className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
            ) : (
              <ShieldCheck className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
            )}
            <div>
              <h2 className="font-semibold">Equipment readiness</h2>
              {hasIssues ? (
                <>
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    {unavailable.length} of {data.length} assigned {
                      unavailable.length === 1 ? "item needs" : "items need"
                    } attention.
                  </p>
                  <p className="text-xs leading-4 text-slate-500 dark:text-[#9AA6BC] sm:mt-0.5">
                    You can still continue with this reservation.
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-500 dark:text-[#9AA6BC]">
                  All {data.length} assigned items are currently available.
                </p>
              )}
            </div>
          </div>
          {unavailable.map((x) => (
            <div
              key={x.id}
              className="mt-2.5 flex items-center justify-between gap-3 border-t border-slate-100 dark:border-[#252C3E] pt-2.5 text-sm sm:mt-3 sm:pt-3"
            >
              <span>
                {x.name} · {x.id}
              </span>
              <StatusPill status={x.status} condition={x.condition} />
            </div>
          ))}
        </div>
        <ActionBar>
          <Primary onClick={confirm}>Confirm Reservation</Primary>
          <Button
            variant="outline"
            onClick={home}
            className="min-h-10 w-full rounded-2xl border-slate-300 dark:border-[#4A556D] bg-white dark:bg-[#1B2133] py-2 text-sm font-semibold text-slate-700 dark:text-[#F5F7FF] shadow-sm hover:border-slate-400 dark:hover:border-[#657089] hover:bg-slate-50 dark:hover:bg-[#202739] hover:text-slate-900 dark:hover:text-white sm:min-h-12 sm:py-0 sm:text-base"
          >
            Cancel and Return Home
          </Button>
        </ActionBar>
      </Shell>
    );
  }
  if (screen === "recheck")
    return (
      <Shell
        title="Rechecking availability"
        subtitle="Please wait while we confirm that your selected time is still available."
      >
        <Summary room={room} time={time} date={bookingDate} />
        <div className="mt-6 rounded-3xl border border-violet-100 dark:border-violet-500/45 bg-white dark:bg-[#1B2133] p-6 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 animate-pulse place-items-center rounded-full bg-violet-100 dark:bg-[#2B2145] text-violet-700 dark:text-violet-300">
            <Clock3 />
          </div>
          <h2 className="mt-4 font-semibold">Checking availability…</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-[#AAB3C7]">
            Your reservation has not been created yet.
          </p>
        </div>
      </Shell>
    );
  if (screen === "success")
    return (
      <Shell title="Reservation confirmed">
        <div
          role="status"
          className="flex items-center gap-3 rounded-3xl border border-emerald-600 dark:border-emerald-600 bg-emerald-600 dark:bg-[#087A5A] p-4 text-white shadow-lg shadow-emerald-200/70 dark:shadow-none sm:gap-4 sm:p-5"
        >
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/20 dark:bg-white/10">
            <Check size={27} />
          </div>
          <div>
            <h2 className="text-xl font-semibold">You’re practice ready.</h2>
          </div>
        </div>
        <ConfirmationDetails
          room={room}
          time={time}
          date={bookingDate}
          bookedFor={studentName.trim() || undefined}
        />
        <ActionBar>
          <Primary onClick={home}>Return Home</Primary>
        </ActionBar>
      </Shell>
    );
  if (screen === "booking-error")
    return (
      <Shell
        title="Reservation not confirmed"
        subtitle="Please check the details below before trying again."
      >
        <div className="rounded-3xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-[#321820] p-4 sm:p-5">
          <TriangleAlert className="text-rose-600 dark:text-rose-300" size={30} />
          <h2 className="mt-3 text-xl font-semibold text-rose-950 dark:text-rose-200 sm:mt-4">
            We could not complete that reservation.
          </h2>
          <p className="mt-1.5 text-sm leading-5 text-rose-800 dark:text-rose-200 sm:mt-2 sm:leading-6">
            {bookingError || "Please review your selection and try again."}
          </p>
        </div>
        <ActionBar>
          <Primary
            onClick={() => {
              setBookingError("");
              setScreen("review");
            }}
          >
            Review and try again <ArrowRight />
          </Primary>
          <Button
            variant="outline"
            onClick={home}
            className="min-h-10 w-full rounded-2xl border-slate-300 dark:border-[#4A556D] bg-white dark:bg-[#1B2133] py-2 text-sm font-semibold text-slate-700 dark:text-[#F5F7FF] shadow-sm hover:border-slate-400 dark:hover:border-[#657089] hover:bg-slate-50 dark:hover:bg-[#202739] hover:text-slate-900 dark:hover:text-white sm:min-h-12 sm:py-0 sm:text-base"
          >
            Return Home
          </Button>
        </ActionBar>
      </Shell>
    );
  if (screen === "conflict")
    return (
      <Shell
        title={
          selectedSlots.length > 1
            ? "Part of your selected time is no longer available"
            : "Selected time no longer available"
        }
        subtitle="Your reservation was not created."
      >
        <div className="rounded-3xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-[#321820] p-4 sm:p-5">
          <TriangleAlert className="text-rose-600 dark:text-rose-300" size={30} />
          <h2 className="mt-3 text-xl font-semibold text-rose-950 dark:text-rose-200 sm:mt-4">
            {slotLabel(conflictSlot)} was just booked by someone else.
          </h2>
          <p className="mt-1.5 text-sm leading-5 text-rose-800 dark:text-rose-200 sm:mt-2 sm:leading-6">
            Another student completed their booking before yours could be confirmed.
          </p>
        </div>
        <ActionBar>
          <Primary
            onClick={() => {
              const remainingSlots = selectedSlots.filter(
                (slot) => slot !== conflictSlot,
              );
              setSelectedSlots(remainingSlots);
              setTime(timeRangeLabel(remainingSlots));
               go("slots");
            }}
          >
            Adjust Time Selection in {room}
          </Primary>
          <Button
            variant="outline"
            onClick={() => {
              setMprSelected("");
              setRecoveringFromConflict(true);
              go("mpr");
            }}
            className="min-h-12 w-full rounded-2xl border-violet-300 dark:border-violet-500 bg-white dark:bg-[#211A38] font-semibold text-violet-700 dark:text-violet-200 shadow-sm hover:border-violet-400 dark:hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-[#2B2145] hover:text-violet-800 dark:hover:text-violet-100"
          >
            Choose Another MPR
          </Button>
          <Button
            variant="outline"
            onClick={home}
            className="min-h-12 w-full rounded-2xl border-slate-300 dark:border-[#4A556D] bg-white dark:bg-[#1B2133] font-semibold text-slate-700 dark:text-[#F5F7FF] shadow-sm hover:border-slate-400 dark:hover:border-[#657089] hover:bg-slate-50 dark:hover:bg-[#202739] hover:text-slate-900 dark:hover:text-white"
          >
            Return Home
          </Button>
        </ActionBar>
      </Shell>
    );
  if (screen === "directory-search") {
    const activeMatches =
      directoryTab === "available"
        ? directoryMatches.available
        : directoryMatches.unavailable;
    const scrollHint =
      searched && activeMatches.length > 4
        ? `Scroll to review all ${activeMatches.length} ${directoryTab} matches.`
        : "";
    return (
      <Shell
        title="Equipment directory"
        subtitle="Check equipment locations and working conditions."
        scrollHint=""
        back={back}
        home={home}
      >
        <Tabs
          defaultValue="search"
          onValueChange={(v) => v === "browse" && go("directory-browse")}
        >
          <TabsList className="grid h-11 w-full grid-cols-2 rounded-2xl dark:bg-[#202739] sm:h-12">
            <TabsTrigger value="search" className="rounded-xl dark:text-[#9AA6BC] dark:data-[state=active]:bg-[#252C3E] dark:data-[state=active]:text-violet-200 dark:data-[state=active]:ring-1 dark:data-[state=active]:ring-violet-500/70">
              Search Equipment
            </TabsTrigger>
            <TabsTrigger value="browse" className="rounded-xl dark:text-[#9AA6BC] dark:data-[state=active]:bg-[#252C3E] dark:data-[state=active]:text-violet-200 dark:data-[state=active]:ring-1 dark:data-[state=active]:ring-violet-500/70">
              Browse by Location
            </TabsTrigger>
          </TabsList>
          {!demoPresentation && directoryEquipmentStatus !== "loaded" && (
            <div className="mt-3">
              <EquipmentDataNotice status={directoryEquipmentStatus} />
            </div>
          )}
          <TabsContent value="search" className="mt-1.5 sm:mt-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (query.trim()) {
                  if (
                    directoryMatches.available.length === 0 &&
                    directoryMatches.unavailable.length > 0
                  ) {
                    setDirectoryTab("unavailable");
                  } else {
                    setDirectoryTab("available");
                  }
                  setSearched(true);
                }
              }}
            >
              <label
                className="text-sm font-semibold"
                htmlFor="directory-query"
              >
                Equipment name or ID
              </label>
              <div className="mt-0.5 flex flex-col gap-0.5 sm:mt-2 sm:gap-2 sm:flex-row">
                <Input
                  id="directory-query"
                  autoComplete="off"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSearched(false);
                    setDirectoryTab("available");
                  }}
                  placeholder="e.g. microphone or SM58"
                  className="min-h-11 rounded-2xl bg-white dark:!bg-[#1B2133] dark:!text-[#F5F7FF] dark:placeholder:!text-[#74809A] sm:min-h-12"
                />
                <Button
                  type="submit"
                  disabled={!query.trim()}
                  variant={searched ? "outline" : "default"}
                  className={
                    searched
                      ? "min-h-11 w-full rounded-2xl border-violet-300 bg-white px-5 font-semibold text-violet-700 shadow-none hover:border-violet-400 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-500/70 dark:bg-[#211A38] dark:text-violet-200 dark:hover:border-violet-400 dark:hover:bg-[#2B2145] dark:hover:text-violet-100 sm:min-h-12 sm:w-auto"
                      : "min-h-11 w-full rounded-2xl border border-violet-600 bg-violet-600 text-white hover:bg-violet-700 dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-500 disabled:border-violet-300 dark:disabled:border-violet-500/60 disabled:bg-violet-50 dark:disabled:bg-[#211A38] disabled:text-violet-600 dark:disabled:text-violet-300 disabled:opacity-100 sm:min-h-12 sm:w-auto"
                  }
                >
                  <Search /> Search
                </Button>
              </div>
            </form>
            {!searched && (
              <div className="flex min-h-[270px] flex-col items-center justify-center px-6 pb-4 text-center sm:min-h-[420px] sm:pb-0">
                <div className="grid h-16 w-16 place-items-center rounded-full bg-violet-50 dark:bg-[#211A38] text-violet-500 dark:text-violet-300">
                  <Search size={30} strokeWidth={1.8} />
                </div>
                <p className="mt-4 font-semibold text-slate-700 dark:text-[#CBD3E2]">
                  Search to view equipment results
                </p>
                <p className="mt-1 max-w-sm text-sm leading-5 text-slate-500 dark:text-[#9AA6BC]">
                  Enter an equipment name or ID to check locations and working condition.
                </p>
              </div>
            )}
            {searched &&
              (directoryMatches.all.length > 0 ? (
                <>
                  <p className="mt-1.5 text-sm font-medium text-slate-600 dark:text-[#AAB3C7] sm:mt-5">
                    {directoryMatches.all.length}{" "}
                    {directoryMatches.all.length === 1 ? "result" : "results"}{" "}
                    for “{query.trim()}”
                  </p>
                  <Tabs
                    value={directoryTab}
                    onValueChange={setDirectoryTab}
                    className="mt-1 sm:mt-3"
                  >
                    <TabsList className="grid h-11 w-full grid-cols-2 rounded-2xl dark:bg-[#202739] sm:h-12">
                      <TabsTrigger value="available" className={statusTabClass}>
                        Available{" "}
                        <span className="ml-1 text-xs opacity-70">
                          ({directoryMatches.available.length})
                        </span>
                      </TabsTrigger>
                      <TabsTrigger
                        value="unavailable"
                        className={statusTabClass}
                      >
                        Unavailable{" "}
                        <span className="ml-1 text-xs opacity-70">
                          ({directoryMatches.unavailable.length})
                        </span>
                      </TabsTrigger>
                    </TabsList>
                    {scrollHint && (
                      <p className="mt-1 text-[13px] leading-5 font-normal text-slate-500 dark:text-[#9AA6BC] sm:mt-3 sm:text-sm">
                        {scrollHint}
                      </p>
                    )}
                    <TabsContent
                      value="available"
                      className="mt-1 grid items-stretch divide-y divide-slate-300 dark:divide-[#30384D] sm:mt-4 sm:relative sm:grid-cols-2 sm:gap-x-6 sm:before:pointer-events-none sm:before:absolute sm:before:inset-y-0 sm:before:left-1/2 sm:before:w-px sm:before:-translate-x-1/2 sm:before:bg-slate-300 dark:sm:before:bg-[#30384D] sm:before:content-[''] sm:divide-y-0 [&>*:nth-child(n+3)]:sm:border-t [&>*:nth-child(n+3)]:sm:border-slate-300 dark:[&>*:nth-child(n+3)]:sm:border-[#30384D]"
                    >
                      {directoryMatches.available.length ? (
                        directoryMatches.available.map((x) => (
                          <EquipmentRow key={x.id} item={x} showDefault transparentDarkSurface />
                        ))
                      ) : (
                        <SearchTabEmpty
                          type="available"
                          count={directoryMatches.unavailable.length}
                        />
                      )}
                    </TabsContent>
                    <TabsContent
                      value="unavailable"
                      className="mt-4 grid items-stretch divide-y divide-slate-300 dark:divide-[#30384D] sm:relative sm:grid-cols-2 sm:gap-x-6 sm:before:pointer-events-none sm:before:absolute sm:before:inset-y-0 sm:before:left-1/2 sm:before:w-px sm:before:-translate-x-1/2 sm:before:bg-slate-300 dark:sm:before:bg-[#30384D] sm:before:content-[''] sm:divide-y-0 [&>*:nth-child(n+3)]:sm:border-t [&>*:nth-child(n+3)]:sm:border-slate-300 dark:[&>*:nth-child(n+3)]:sm:border-[#30384D]"
                    >
                      {directoryMatches.unavailable.length ? (
                        directoryMatches.unavailable.map((x) => (
                          <EquipmentRow key={x.id} item={x} showDefault transparentDarkSurface />
                        ))
                      ) : (
                        <SearchTabEmpty
                          type="unavailable"
                          count={directoryMatches.available.length}
                        />
                      )}
                    </TabsContent>
                  </Tabs>
                </>
              ) : (
                <SearchEmpty query={query} />
              ))}
          </TabsContent>
        </Tabs>
      </Shell>
    );
  }
  if (screen === "directory-browse") {
    const locationOptions = demoPresentation
      ? locations
      : Array.from(
          new Set(
            (liveDirectoryEquipment ?? emptyEquipment).map(
              (item) => item.currentLocation,
            ),
          ),
        ).sort();
    return (
      <Shell
        title="Browse by location"
        subtitle="Choose a TSM location to view its assigned equipment."
        back={back}
        home={home}
      >
        {!demoPresentation && directoryEquipmentStatus !== "loaded" ? (
          <EquipmentDataNotice status={directoryEquipmentStatus} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {locationOptions.map((l) => (
              <button
                key={l}
                onClick={() => {
                  setLocation(l);
                  setLocationQuery("");
                  setDirectoryTab("available");
                }}
                className={`min-h-14 rounded-2xl border p-3 font-semibold ${location === l ? "border-violet-500 bg-violet-50 dark:bg-[#211A38] text-violet-800 dark:text-violet-200" : "border-slate-200 bg-white dark:border-[#3A4358] dark:bg-[#1B2133] dark:text-[#CBD3E2] dark:hover:border-violet-500/70 dark:hover:bg-[#202739]"}`}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <ActionBar>
          <Primary
            disabled={!location || (!demoPresentation && directoryEquipmentStatus !== "loaded")}
            onClick={() => go("directory-results")}
          >
            View Equipment <ArrowRight />
          </Primary>
        </ActionBar>
      </Shell>
    );
  }
  if (screen === "directory-results") {
    if (!demoPresentation && directoryEquipmentStatus !== "loaded") {
      return (
        <Shell
          title={`${location} equipment`}
          subtitle="Review current locations and working conditions."
          back={back}
          home={home}
        >
          <EquipmentDataNotice status={directoryEquipmentStatus} />
        </Shell>
      );
    }
    const normalizedLocationQuery = normalizeEquipmentSearch(locationQuery);
    const filterAndRankLocationItems = (items: Equipment[]) =>
      items
        .map((item, index) => ({
          item,
          index,
          rank: liveListEquipmentSearchRank(item, normalizedLocationQuery),
        }))
        .filter(({ rank }) => rank < 99)
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map(({ item }) => item);

    const filteredAvailableItems = normalizedLocationQuery
      ? filterAndRankLocationItems(availableItemsForLocation)
      : availableItemsForLocation;
    const filteredUnavailableItems = normalizedLocationQuery
      ? filterAndRankLocationItems(unavailableItemsForLocation)
      : unavailableItemsForLocation;
    const noLocationSearchMatches =
      Boolean(normalizedLocationQuery) &&
      filteredAvailableItems.length === 0 &&
      filteredUnavailableItems.length === 0;
    const activeItems =
      directoryTab === "available"
        ? filteredAvailableItems
        : filteredUnavailableItems;
    const activeCount = activeItems.length;
    const scrollHint = normalizedLocationQuery
      ? `${activeCount} ${directoryTab} item${activeCount === 1 ? "" : "s"} match “${locationQuery.trim()}”.`
      : locationHasEquipmentRecords && activeCount > 4
        ? `Scroll to review all ${activeCount} ${directoryTab} items.`
        : "";
    return (
      <Shell
        compactMobileHeader
        title={`${location} equipment`}
        subtitle="Review current locations and working conditions."
        scrollHint=""
        back={back}
        home={home}
      >
        <div className="mb-3 sm:mb-5">
          <label className="text-sm font-semibold" htmlFor="location-equipment-query">
            Search equipment in {location}
          </label>
          <Input
            id="location-equipment-query"
            className="mt-1 h-11 rounded-2xl bg-white dark:!bg-[#1B2133] dark:!text-[#F5F7FF] dark:placeholder:!text-[#74809A] sm:mt-2 sm:h-12"
            value={locationQuery}
            onChange={(e) => {
              const nextQuery = e.target.value;
              const normalizedNextQuery = normalizeEquipmentSearch(nextQuery);
              setLocationQuery(nextQuery);

              if (!normalizedNextQuery) {
                setDirectoryTab("available");
                return;
              }

              const hasAvailableMatch = availableItemsForLocation.some(
                (item) =>
                  liveListEquipmentSearchRank(item, normalizedNextQuery) < 99,
              );
              const hasUnavailableMatch = unavailableItemsForLocation.some(
                (item) =>
                  liveListEquipmentSearchRank(item, normalizedNextQuery) < 99,
              );

              if (hasAvailableMatch) {
                setDirectoryTab("available");
              } else if (hasUnavailableMatch) {
                setDirectoryTab("unavailable");
              } else {
                setDirectoryTab("available");
              }
            }}
            placeholder="Search by equipment name or ID..."
            autoComplete="off"
          />
        </div>
        <Tabs value={directoryTab} onValueChange={setDirectoryTab}>
          <TabsList className="grid h-12 w-full grid-cols-2 rounded-2xl dark:bg-[#202739]">
            <TabsTrigger value="available" className={statusTabClass}>
              Available{" "}
              <span className="ml-1 text-xs opacity-70">
                ({normalizedLocationQuery ? filteredAvailableItems.length : availableItemsForLocation.length})
              </span>
            </TabsTrigger>
            <TabsTrigger value="unavailable" className={statusTabClass}>
              Unavailable{" "}
              <span className="ml-1 text-xs opacity-70">
                ({normalizedLocationQuery ? filteredUnavailableItems.length : unavailableItemsForLocation.length})
              </span>
            </TabsTrigger>
          </TabsList>
          {scrollHint && (
            <p className="mt-1.5 text-[13px] leading-5 font-normal text-slate-500 dark:text-[#9AA6BC] sm:mt-3 sm:text-sm">
              {scrollHint}
            </p>
          )}
          <TabsContent
            value="available"
            className={`mt-2.5 grid items-stretch divide-y divide-slate-300 dark:divide-[#30384D] sm:mt-5 sm:relative sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0 [&>*:nth-child(n+3)]:sm:border-t [&>*:nth-child(n+3)]:sm:border-slate-300 dark:[&>*:nth-child(n+3)]:sm:border-[#30384D] ${filteredAvailableItems.length > 0 ? "sm:before:pointer-events-none sm:before:absolute sm:before:inset-y-0 sm:before:left-1/2 sm:before:w-px sm:before:-translate-x-1/2 sm:before:bg-slate-300 dark:sm:before:bg-[#30384D] sm:before:content-['']" : ""}`}
          >
            {!locationHasEquipmentRecords ? (
              <NoEquipmentRecords />
            ) : filteredAvailableItems.length === 0 ? (
              normalizedLocationQuery ? (
                <div className={noLocationSearchMatches ? "sm:col-span-2 mx-auto w-full max-w-xl" : ""}>
                  <SearchEmpty query={locationQuery.trim()} />
                </div>
              ) : (
                <NoAvailableItems />
              )
            ) : (
              filteredAvailableItems.map((x) => (
                <EquipmentRow key={x.id} item={x} availableEquipmentLayout />
              ))
            )}
          </TabsContent>
          <TabsContent
            value="unavailable"
            className={`mt-2.5 grid items-stretch divide-y divide-slate-300 dark:divide-[#30384D] sm:mt-5 sm:relative sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0 [&>*:nth-child(n+3)]:sm:border-t [&>*:nth-child(n+3)]:sm:border-slate-300 dark:[&>*:nth-child(n+3)]:sm:border-[#30384D] ${filteredUnavailableItems.length > 0 ? "sm:before:pointer-events-none sm:before:absolute sm:before:inset-y-0 sm:before:left-1/2 sm:before:w-px sm:before:-translate-x-1/2 sm:before:bg-slate-300 dark:sm:before:bg-[#30384D] sm:before:content-['']" : ""}`}
          >
            {!locationHasEquipmentRecords ? (
              <NoEquipmentRecords />
            ) : filteredUnavailableItems.length === 0 ? (
              normalizedLocationQuery ? (
                <div className={noLocationSearchMatches ? "sm:col-span-2 mx-auto w-full max-w-xl" : ""}>
                  <SearchEmpty query={locationQuery.trim()} />
                </div>
              ) : (
                <EmptyState
                  count={availableItemsForLocation.length}
                  location={location}
                />
              )
            ) : (
              filteredUnavailableItems.map((x) => {
                const alternativeQuery = alternativeQueryForItem(x);
                return (
                  <EquipmentRow
                    key={x.id}
                    item={x}
                    availableEquipmentLayout
                    action={
                      <div className="flex justify-center">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setAlternativeFromDirectory(true);
                            setAlternativeSourceRoom("");
                            setAlternativeSourceItemId(x.id);
                            setAlternativeSearchLabel(alternativeQuery.toLowerCase());
                            setQuery(alternativeQuery);
                            setSearched(false);
                            go("alternative-search");
                          }}
                          className="min-h-11 rounded-xl border-violet-200 bg-white px-4 text-sm font-semibold text-violet-700 shadow-none hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:border-violet-500/70 dark:bg-[#211A38] dark:text-violet-200 dark:hover:border-violet-400 dark:hover:bg-[#2B2145] dark:hover:text-violet-100"
                        >
                          Search alternatives
                          <Search size={16} />
                        </Button>
                      </div>
                    }
                  />
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </Shell>
    );
  }
  return null;
}

function useActiveReservation(reservation: ActiveReservation | null) {
  const [phase, setPhase] = useState<BookingPhase>("upcoming");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [syncedBookingRef, setSyncedBookingRef] = useState<string | null>(null);
  const bookingRef = reservation?.bookingRef ?? null;

  useEffect(() => {
    if (!bookingRef) return;
    let cancelled = false;

    const sync = async () => {
      setNowMs(Date.now());
      const status = await fetchBookingStatus(bookingRef);
      if (cancelled || !status) return;
      setSyncedBookingRef(bookingRef);
      setPhase(status.phase);
    };

    sync();
    const pollId = window.setInterval(sync, 30_000);
    const tickId = window.setInterval(() => setNowMs(Date.now()), 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.clearInterval(tickId);
    };
  }, [bookingRef]);

  const displayPhase =
    bookingRef && syncedBookingRef === bookingRef ? phase : "upcoming";

  return { phase: displayPhase, nowMs };
}

function ActiveReservationCard({
  reservation,
  phase,
  nowMs,
}: {
  reservation: ActiveReservation;
  phase: BookingPhase;
  nowMs: number;
}) {
  const inProgress = phase === "in_progress";
  const statusLabel = inProgress ? "In progress" : "Confirmed";
  const statusClass = inProgress
    ? "bg-violet-500/15 text-violet-200 ring-1 ring-inset ring-violet-400/40"
    : "bg-emerald-500/15 text-emerald-200 ring-1 ring-inset ring-emerald-400/40";

  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-[#1B2133] px-4 py-3.5 text-white shadow-[0_10px_28px_rgba(15,23,42,0.28)] sm:px-5 sm:py-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300">
          <ShieldCheck size={18} />
        </span>
        <strong className="min-w-0 flex-1 truncate text-base font-semibold">
          Your Active Reservation
        </strong>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}
        >
          {statusLabel}
        </span>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 text-slate-300">
          <MapPin size={15} className="shrink-0 text-slate-400" />
          <span className="truncate">
            {reservation.roomName ?? "MPR"} · {reservation.date} (
            {reservation.startTime}–{reservation.endTime})
          </span>
        </span>
        <span className="shrink-0 font-mono text-xs text-slate-400">
          {reservation.bookingRef}
        </span>
      </div>
      <p className="mt-2 text-xs font-medium text-violet-300">
        {reservationCountdownLabel(reservation, nowMs)}
      </p>
    </div>
  );
}

function HomeScreen({
  onBook,
  onEquipment,
  onAvailability,
  onReservations,
  onSupport,
  onLogout,
  user,
  onUserChange,
  greeting,
  activeReservation,
  reservationPhase,
  reservationNowMs,
}: {
  onBook: () => void;
  onEquipment: () => void;
  onAvailability: () => void;
  onReservations: () => void;
  onSupport: () => void;
  onLogout: () => void;
  user: UserProfile | null;
  onUserChange: (user: UserProfile) => void;
  greeting: string;
  activeReservation: ActiveReservation | null;
  reservationPhase: BookingPhase;
  reservationNowMs: number;
}) {
  const bars = [28, 46, 64, 38, 74, 52, 34, 68, 44, 58, 30, 50];
  return (
    <main className="relative h-[100dvh] w-full max-w-full overflow-hidden bg-[#f7f8fc] dark:bg-[#171D2D] text-[#151a31] dark:text-[#F5F7FF] lg:h-auto lg:min-h-screen lg:overflow-x-hidden">
      <style>{`
        /* Fast, polished hover feedback on the Home screen. */
        [class*="hover:"],
        [class*="group-hover:"] {
          transition-duration: 60ms !important;
        }

        @keyframes practice-ready-equalizer {
          0%, 100% { transform: scaleY(0.72); }
          18% { transform: scaleY(1.08); }
          38% { transform: scaleY(0.86); }
          58% { transform: scaleY(1.18); }
          78% { transform: scaleY(0.94); }
        }
        @keyframes practice-ready-wave-drift-a {
          0%, 100% { transform: translate3d(-4.5%, -1.5%, 0) scale(1.035); }
          50% { transform: translate3d(4.5%, 2%, 0) scale(1.09); }
        }
        @keyframes practice-ready-wave-drift-b {
          0%, 100% { transform: translate3d(4%, 2%, 0) scale(1.075); }
          50% { transform: translate3d(-4.5%, -2%, 0) scale(1.025); }
        }
        @keyframes practice-ready-wave-breathe {
          0%, 100% { opacity: .82; }
          50% { opacity: 1; }
        }
        .practice-ready-eq-bar {
          transform-origin: center bottom;
          animation-name: practice-ready-equalizer;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
          backface-visibility: hidden;
          transform: translateZ(0);
          will-change: transform;
        }
        .practice-ready-wave-field {
          background: rgba(245, 243, 255, .72);
          animation: practice-ready-wave-breathe 6.8s ease-in-out infinite;
          contain: paint;
          isolation: isolate;
          transform: translateZ(0);
          will-change: opacity;
        }
        html.dark .practice-ready-wave-field {
          background:
            radial-gradient(circle at 78% 20%, rgba(139, 92, 246, .14), transparent 36%),
            radial-gradient(circle at 22% 76%, rgba(99, 102, 241, .10), transparent 40%),
            radial-gradient(circle at 52% 48%, rgba(168, 85, 247, .07), transparent 42%),
            rgba(22, 24, 48, .54);
        }
        .practice-ready-wave-group-a {
          transform-origin: center;
          animation: practice-ready-wave-drift-a 9.5s ease-in-out infinite;
          backface-visibility: hidden;
          transform: translateZ(0);
          will-change: transform;
        }
        .practice-ready-wave-group-b {
          transform-origin: center;
          animation: practice-ready-wave-drift-b 11s ease-in-out infinite;
          backface-visibility: hidden;
          transform: translateZ(0);
          will-change: transform;
        }
        .practice-ready-wave-band {
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
          vector-effect: non-scaling-stroke;
        }
        .practice-ready-wave-1 { stroke: rgba(196, 181, 253, .34); }
        .practice-ready-wave-2 { stroke: rgba(221, 214, 254, .42); }
        .practice-ready-wave-3 { stroke: rgba(167, 139, 250, .26); }
        .practice-ready-wave-4 { stroke: rgba(233, 213, 255, .36); }
        .practice-ready-wave-5 { stroke: rgba(192, 132, 252, .22); }
        .practice-ready-wave-6 { stroke: rgba(216, 180, 254, .31); }
        .practice-ready-wave-7 { stroke: rgba(196, 181, 253, .25); }
        html.dark .practice-ready-wave-1 { stroke: rgba(139, 92, 246, .17); }
        html.dark .practice-ready-wave-2 { stroke: rgba(184, 160, 255, .19); }
        html.dark .practice-ready-wave-3 { stroke: rgba(192, 132, 252, .16); }
        html.dark .practice-ready-wave-4 { stroke: rgba(129, 140, 248, .14); }
        html.dark .practice-ready-wave-5 { stroke: rgba(216, 180, 254, .14); }
        html.dark .practice-ready-wave-6 { stroke: rgba(174, 151, 246, .16); }
        html.dark .practice-ready-wave-7 { stroke: rgba(147, 91, 219, .13); }
        @keyframes practice-ready-panel-breathe {
          0%, 100% { transform: scale(1); opacity: .82; }
          50% { transform: scale(1.07); opacity: 1; }
        }
        .practice-ready-panel-ambient {
          transform-origin: center;
          animation: practice-ready-panel-breathe 16s ease-in-out infinite;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .practice-ready-eq-bar,
          .practice-ready-wave-field,
          .practice-ready-wave-group-a,
          .practice-ready-wave-group-b,
          .practice-ready-panel-ambient { animation: none !important; }
        }
      `}</style>
      <div className="practice-ready-wave-field pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <svg
          className="absolute -left-[12%] -top-[10%] h-[120%] w-[124%]"
          viewBox="0 0 1200 900"
          preserveAspectRatio="none"
        >
          <g className="practice-ready-wave-group-a">
            <path className="practice-ready-wave-band practice-ready-wave-1" strokeWidth="280" d="M-220 40 C 80 -85, 260 150, 520 70 S 930 -40, 1420 120" />
            <path className="practice-ready-wave-band practice-ready-wave-3" strokeWidth="255" d="M-220 330 C 70 195, 300 455, 555 340 S 960 185, 1420 365" />
            <path className="practice-ready-wave-band practice-ready-wave-5" strokeWidth="270" d="M-210 630 C 110 480, 325 750, 590 625 S 995 470, 1400 665" />
            <path className="practice-ready-wave-band practice-ready-wave-7" strokeWidth="250" d="M-190 900 C 120 760, 360 1000, 640 880 S 1040 750, 1380 900" />
          </g>
          <g className="practice-ready-wave-group-b">
            <path className="practice-ready-wave-band practice-ready-wave-2" strokeWidth="250" d="M-210 190 C 95 60, 280 285, 535 195 S 940 65, 1410 235" />
            <path className="practice-ready-wave-band practice-ready-wave-4" strokeWidth="265" d="M-215 475 C 90 340, 315 600, 575 485 S 985 325, 1410 515" />
            <path className="practice-ready-wave-band practice-ready-wave-6" strokeWidth="255" d="M-200 770 C 115 620, 350 885, 620 760 S 1020 610, 1390 790" />
          </g>
        </svg>
      </div>
      <div className="hidden lg:block">
        <ThemeToggle />
        <MusicToggle />
        {user && <div className="fixed right-5 top-5 z-40 sm:right-[5.25rem] sm:top-8"><AccountControls user={user} onUserChange={onUserChange} onLogout={onLogout} /></div>}
      </div>
      <div className="relative z-10 mx-auto grid h-full min-h-0 w-full min-w-0 max-w-6xl lg:min-h-screen lg:grid-cols-[0.9fr_1.1fr]">
        <section className="relative hidden overflow-hidden bg-[#111733] dark:bg-[#0B0F1B] p-14 lg:flex lg:flex-col lg:justify-between">
          <div className="practice-ready-panel-ambient pointer-events-none absolute -left-24 top-24 h-72 w-72 rounded-full bg-violet-600/25 dark:bg-violet-400/20 blur-3xl" />
          <div className="practice-ready-panel-ambient pointer-events-none absolute -right-24 bottom-24 h-64 w-64 rounded-full bg-orange-300/10 dark:bg-orange-300/8 blur-3xl" style={{ animationDelay: "-5s" }} />
          <div className="practice-ready-panel-ambient pointer-events-none absolute left-1/3 top-1/2 h-60 w-60 rounded-full bg-indigo-500/10 dark:bg-indigo-400/10 blur-3xl" style={{ animationDelay: "-10s" }} />
          <div className="relative flex items-center gap-3 text-sm font-semibold tracking-wide text-white">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-500 dark:bg-violet-400">
              <Music2 size={20} />
            </span>
            TRUE SCHOOL OF MUSIC
          </div>
          <div className="relative">
            <p className="mb-5 text-sm font-bold uppercase tracking-[.22em] text-orange-300">
              Practice Ready
            </p>
            <h1 className="text-5xl font-semibold leading-[1.06] tracking-[-.04em] text-white">
              Walk in ready.
              <br />
              Not wondering.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-8 text-slate-300 dark:text-[#AAB3C7]">
              Find an open practice room and check its equipment before your
              session begins.
            </p>
          </div>
          <div className="relative flex h-24 items-end gap-2">
            {bars.map((h, i) => (
              <span
                key={i}
                className="practice-ready-eq-bar w-3 rounded-full bg-gradient-to-t from-violet-500 to-orange-300"
                style={{
                  height: h,
                  animationDuration: `${1.7 + (i % 5) * 0.28}s`,
                  animationDelay: `${-0.16 * i}s`,
                }}
              />
            ))}
          </div>
        </section>
        <section className="relative flex h-full min-h-0 min-w-0 items-start overflow-x-hidden overflow-y-auto px-5 py-5 sm:px-10 sm:py-8 lg:min-h-screen lg:items-center lg:px-20">
          <div className="relative z-10 mx-auto w-full min-w-0 max-w-xl">
            <div className="mb-6 flex items-center justify-between sm:mb-10 lg:hidden">
              <Brand />
              <div className="flex items-center gap-2">
                <MusicToggle inline />
                <ThemeToggle inline />
              </div>
            </div>
            <div className="mb-2 flex items-center justify-between gap-3"><p className="text-sm font-semibold text-violet-700 dark:text-violet-300">{greeting}</p><div className="lg:hidden">{user && <AccountControls user={user} onUserChange={onUserChange} onLogout={onLogout} />}</div></div>
            <h2 className="text-[2rem] font-semibold leading-tight tracking-[-.035em] sm:text-4xl">
              What do you need for practice?
            </h2>
            <p className="mt-3 text-base leading-7 text-slate-600 dark:text-[#AAB3C7]">
              Book a room or check where equipment is and whether it works.
            </p>
            <div className="mt-5 space-y-3 sm:mt-8 sm:space-y-4">
              {activeReservation && (
                <ActiveReservationCard
                  reservation={activeReservation}
                  phase={reservationPhase}
                  nowMs={reservationNowMs}
                />
              )}
              <HomeCard
                dark
                icon={<CalendarDays />}
                title="Book a Room"
                text="Choose a time and reserve a room."
                onClick={onBook}
              />
              <HomeCard
                icon={<CalendarDays />}
                title="Room availability"
                text="Compare room schedules."
                onClick={onAvailability}
              />
              <HomeCard
                icon={<CalendarDays />}
                title="My Reservations"
                text="View and manage your sessions."
                onClick={onReservations}
              />
              <HomeCard
                icon={<Headphones />}
                title="Equipment"
                text="Check locations and working conditions."
                onClick={onEquipment}
              />
              <HomeCard
                icon={<TriangleAlert />}
                title="Reports & Support"
                text="Report an issue or contact FTS."
                onClick={onSupport}
              />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
function HomeCard({
  dark = false,
  icon,
  title,
  text,
  onClick,
}: {
  dark?: boolean;
  icon: React.ReactNode;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full min-w-0 max-w-full items-center gap-3 rounded-[1.4rem] px-4 py-3.5 text-left shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-300 sm:gap-4 sm:p-5 ${dark ? "bg-[#20284A] text-white hover:bg-[#28335A] dark:border dark:border-violet-500/60 dark:bg-[#21183d] dark:shadow-[0_10px_28px_rgba(124,58,237,0.16)] dark:hover:border-violet-400/80 dark:hover:bg-[#2a1d4b]" : "border border-violet-200 dark:border-[#30384D] bg-[#F1EDFF] dark:bg-[#1B2133] text-[#151a31] dark:text-[#F5F7FF] shadow-violet-100/70 dark:shadow-none hover:border-violet-300 dark:hover:border-violet-500/70 hover:bg-[#EAE4FF] dark:hover:bg-[#202739]"}`}
    >
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl sm:h-12 sm:w-12 sm:rounded-2xl ${dark ? "bg-violet-500 dark:bg-violet-500" : "bg-violet-600 text-white"}`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block break-words text-lg">{title}</strong>
        <span
          className={`mt-1 block text-sm ${dark ? "text-slate-300" : "text-slate-600 dark:text-[#AAB3C7]"}`}
        >
          {text}
        </span>
      </span>
      <ArrowRight
        className={`shrink-0 transition-transform group-hover:translate-x-1 ${dark ? "dark:text-violet-200" : "text-violet-700 dark:text-violet-300"}`}
      />
    </button>
  );
}
function ScheduleScreen({ back, onSelect }: { back: () => void; onSelect?: (room: string, date: Date, index: number) => void }) {
  const [scheduleDate, setScheduleDate] = useState(() => new Date());
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [failedDate, setFailedDate] = useState<string | null>(null);
  const requestedDate = dateKey(scheduleDate);

  useEffect(() => {
    let cancelled = false;
    fetchSchedule(requestedDate).then((data) => {
      if (cancelled) return;
      if (data) {
        setSchedule(data);
        setFailedDate(null);
      } else {
        setFailedDate(requestedDate);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [requestedDate]);

  const loadFailed = failedDate === requestedDate;
  const isLoading = !loadFailed && schedule?.date !== requestedDate;

  const days = Array.from({ length: 2 }, (_, offset) => {
    const day = new Date();
    day.setDate(day.getDate() + offset);
    return day;
  });

  return <Shell title="Room availability" subtitle="Compare room schedules." back={back}>
    <RoomAvailabilityCalendar onHome={back} onSelect={onSelect} />
  </Shell>;

  return (
    <Shell
      title="Room availability"
      subtitle="Compare room availability for today and tomorrow."
      back={back}
    >
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((day) => {
          const selected = sameDay(day, scheduleDate);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => setScheduleDate(day)}
              aria-pressed={selected}
              className={`min-h-10 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition ${
                selected
                  ? "border-violet-600 bg-violet-600 text-white shadow-sm"
                  : "border-violet-200 dark:border-[#30384D] bg-white dark:bg-[#1B2133] text-slate-600 dark:text-[#AAB3C7] hover:border-violet-400 dark:hover:border-violet-500"
              }`}
            >
              {sameDay(day, new Date()) ? "Today" : shortDate(day)}
            </button>
          );
        })}
      </div>

      {loadFailed ? (
        <div className="mt-4 rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-[#321820] p-4 text-sm text-rose-900 dark:text-rose-200">
          Could not load the schedule. Please try again later.
        </div>
      ) : isLoading ? (
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-[#9AA6BC]">
          Loading schedule…
        </p>
      ) : (
        <div className="mt-3 space-y-3 sm:space-y-4">
          {schedule?.rooms.map((room) => (
            <div
              key={room.id}
              className="rounded-2xl border border-slate-200 dark:border-[#30384D] bg-white dark:bg-[#1B2133] p-4 shadow-sm sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">{room.name}</h2>
                <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-[#9AA6BC]">
                  {room.bookings.length === 0
                    ? "Free all day"
                    : `${room.bookings.length} booking${room.bookings.length === 1 ? "" : "s"}`}
                </span>
              </div>
              {room.bookings.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-[#9AA6BC]">
                  No bookings yet.
                </p>
              ) : (
                <ul className="mt-2.5 space-y-2">
                  {room.bookings.map((booking) => (
                    <li
                      key={`${room.id}-${booking.bookingRef}-${booking.startTime}`}
                      className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-[#252C3E] pt-2 text-sm"
                    >
                      <span className="shrink-0 font-semibold">
                        {booking.startTime}–{booking.endTime}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
function Slots({
  room,
  date,
  initialPeriod,
  selectedSlots,
  setSelectedSlots,
  booked,
  back,
  onChangeMpr,
  onContinue,
}: {
  room: string;
  date: Date;
  initialPeriod: number;
  selectedSlots: string[];
  setSelectedSlots: (slots: string[]) => void;
  booked: Set<string>;
  back: () => void;
  onChangeMpr: () => void;
  onContinue: () => void;
}) {
  const nextDay = new Date(date);
  nextDay.setDate(date.getDate() + 1);
  const [activePeriod, setActivePeriod] = useState(initialPeriod);
  const slotListRef = useRef<HTMLElement | null>(null);
  const availabilityHeaderRef = useRef<HTMLElement | null>(null);
  const periodContentStartRef = useRef<HTMLParagraphElement | null>(null);
  const periodTabsRef = useRef<HTMLDivElement | null>(null);
  const initialPeriodPositionedRef = useRef(false);
  const pendingInitialPeriodRef = useRef<number | null>(null);
  const [periodScrollProgress, setPeriodScrollProgress] = useState(0);
  const [periodIndicatorLeft, setPeriodIndicatorLeft] = useState(0);
  const [periodIndicatorWidth, setPeriodIndicatorWidth] = useState(0);
  const [periodIntroActive, setPeriodIntroActive] = useState(false);
  const periodScrollTrackRef = useRef<HTMLDivElement | null>(null);
  const periodScrollDraggingRef = useRef(false);
  const pendingPeriodAlignmentRef = useRef<number | null>(null);
  const periodAlignmentFrameRef = useRef<number | null>(null);
  const periodTabsDragRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    dragging: false,
    moved: false,
  });
  const selectedRange = timeRangeLabel(selectedSlots);
  const selectionHasBookedSlot = selectedSlots.some((slot) => booked.has(slot));

  useEffect(() => {
    // The user now chooses a time period explicitly before entering this screen.
    // That selection is the initial active tab. The existing tab scroller,
    // indicator, swipe/drag behavior and intro animation remain unchanged.
    pendingInitialPeriodRef.current = initialPeriod;
    initialPeriodPositionedRef.current = false;
  }, [date, initialPeriod]);

  const selectSlot = (slot: string) => {
    const slotIndex = allTimeSlots.indexOf(slot);
    if (slotIndex < 0 || booked.has(slot)) return;

    if (selectedSlots.length === 0) {
      setSelectedSlots([slot]);
      return;
    }

    const selectedIndices = selectedSlots
      .map((item) => allTimeSlots.indexOf(item))
      .filter((index) => index >= 0);
    const firstIndex = Math.min(...selectedIndices);
    const lastIndex = Math.max(...selectedIndices);

    // Clicking any slot inside a multi-slot selection starts a new range from that slot.
    if (selectedSlots.length > 1 && slotIndex >= firstIndex && slotIndex <= lastIndex) {
      setSelectedSlots([slot]);
      return;
    }

    // Clicking the only selected start again clears it.
    if (selectedSlots.length === 1 && slotIndex === firstIndex) {
      setSelectedSlots([]);
      return;
    }

    const rangeStart = Math.min(firstIndex, slotIndex);
    const rangeEnd = Math.max(firstIndex, slotIndex);
    const candidate = allTimeSlots.slice(rangeStart, rangeEnd + 1);
    const canExtendForward =
      slotIndex > lastIndex &&
      candidate.length <= 6 &&
      !candidate.some((candidateSlot) => booked.has(candidateSlot));

    if (canExtendForward) {
      setSelectedSlots(candidate);
      return;
    }

    // "Available" always means begin a new range here.
    // This also removes the old two-click clearing requirement.
    setSelectedSlots([slot]);
  };

  const selectedIndicesForGuidance = selectedSlots
    .map((item) => allTimeSlots.indexOf(item))
    .filter((index) => index >= 0);
  const selectedStartIndex =
    selectedIndicesForGuidance.length > 0
      ? Math.min(...selectedIndicesForGuidance)
      : -1;
  const selectedEndIndex =
    selectedIndicesForGuidance.length > 0
      ? Math.max(...selectedIndicesForGuidance)
      : -1;
  const maxEndIndex =
    selectedStartIndex >= 0
      ? Math.min(selectedStartIndex + 5, allTimeSlots.length - 1)
      : -1;

  const validExtensionSlots =
    selectedStartIndex >= 0 && selectedSlots.length < 6
      ? allTimeSlots
          .slice(selectedEndIndex + 1, maxEndIndex + 1)
          .filter((candidateSlot, offset) => {
            const candidateIndex = selectedEndIndex + 1 + offset;
            return (
              !booked.has(candidateSlot) &&
              !allTimeSlots
                .slice(selectedStartIndex, candidateIndex + 1)
                .some((rangeSlot) => booked.has(rangeSlot))
            );
          })
      : [];

  const extensionInCurrentPeriod =
    activePeriod >= 0 &&
    periods[activePeriod].times.some((time) => validExtensionSlots.includes(time));
  const extensionPeriodIndex = periods.findIndex(
    (period, index) =>
      index !== activePeriod &&
      period.times.some((time) => validExtensionSlots.includes(time)),
  );
  const extensionPeriodLabel =
    extensionPeriodIndex >= 0
      ? periods[extensionPeriodIndex].name.startsWith("Late Night")
        ? "Late Night"
        : periods[extensionPeriodIndex].name
      : "";
  const extensionInAnotherPeriod = extensionPeriodIndex >= 0;
  const maxBookingReached = selectedSlots.length >= 6;

  const selectionGuidance =
    selectedSlots.length === 0
      ? "Choose a start time · Book up to 3 hours"
      : maxBookingReached
        ? "3 hours selected · Maximum booking length reached"
        : validExtensionSlots.length === 0
          ? `${durationLabel(selectedSlots.length)} selected · No later times available to extend`
          : !extensionInCurrentPeriod && extensionInAnotherPeriod
            ? `${durationLabel(selectedSlots.length)} selected · More times available in ${extensionPeriodLabel}`
            : selectedSlots.length === 1
              ? "30 min selected · Want longer? Select an end time"
              : `${durationLabel(selectedSlots.length)} selected · Choose another end time to adjust`;

  const alignPeriodIndicatorToSelectedTab = (index: number) => {
    const scroller = periodTabsRef.current;
    const track = periodScrollTrackRef.current;
    if (!scroller || !track) return;

    const tabs = Array.from(
      scroller.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    const tab = tabs[index];
    if (!tab) return;

    const trackRect = track.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const thumbWidth = Math.min(128, Math.max(112, trackRect.width * 0.27));
    const travel = Math.max(0, trackRect.width - thumbWidth);

    // Both the tab strip and indicator track share the same horizontal frame.
    // Measure the selected pill after scrolling has settled, then center the
    // bar beneath it while respecting the physical ends of the track.
    const tabCenterInTrack = tabRect.left + tabRect.width / 2 - trackRect.left;
    const left = Math.max(
      0,
      Math.min(travel, tabCenterInTrack - thumbWidth / 2),
    );

    setPeriodIndicatorWidth(thumbWidth);
    setPeriodIndicatorLeft(left);
  };

  const alignPeriodContentToStickyHeader = () => {
    const contentStart = periodContentStartRef.current;
    const header = availabilityHeaderRef.current;
    if (!contentStart || !header) return;

    const headerBottom = header.getBoundingClientRect().bottom;
    const contentTop = contentStart.getBoundingClientRect().top;
    const gap = window.matchMedia("(min-width: 640px)").matches ? 16 : 12;
    const delta = contentTop - (headerBottom + gap);

    // A manual period change returns to the beginning of the availability
    // content directly beneath the sticky header.
    if (Math.abs(delta) > 1) {
      window.scrollBy({ top: delta, behavior: "auto" });
    }
  };

  const settlePeriodIndicatorUnderTab = (index: number) => {
    pendingPeriodAlignmentRef.current = index;

    if (periodAlignmentFrameRef.current !== null) {
      cancelAnimationFrame(periodAlignmentFrameRef.current);
      periodAlignmentFrameRef.current = null;
    }

    let lastScrollLeft = Number.NaN;
    let stableFrames = 0;

    const checkSettled = () => {
      const scroller = periodTabsRef.current;
      if (!scroller || pendingPeriodAlignmentRef.current !== index) {
        periodAlignmentFrameRef.current = null;
        return;
      }

      const currentScrollLeft = scroller.scrollLeft;

      if (
        Number.isFinite(lastScrollLeft) &&
        Math.abs(currentScrollLeft - lastScrollLeft) < 0.25
      ) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }

      lastScrollLeft = currentScrollLeft;

      // Three consecutive stable animation frames means either:
      // 1) the smooth scroll has genuinely finished, or
      // 2) this selection required no scroll at all because both tabs share
      //    the same clamped viewport position (the edge case that was broken).
      if (stableFrames >= 3) {
        alignPeriodIndicatorToSelectedTab(index);
        pendingPeriodAlignmentRef.current = null;
        periodAlignmentFrameRef.current = null;
        return;
      }

      periodAlignmentFrameRef.current = requestAnimationFrame(checkSettled);
    };

    periodAlignmentFrameRef.current = requestAnimationFrame(checkSettled);
  };

  const changePeriod = (index: number, resetPeriodContent = false) => {
    setActivePeriod(index);

    if (resetPeriodContent) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          alignPeriodContentToStickyHeader();
        });
      });
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scroller = periodTabsRef.current;
        if (!scroller || !window.matchMedia("(max-width: 639px)").matches) {
          return;
        }

        const tabs = Array.from(
          scroller.querySelectorAll<HTMLElement>('[role="tab"]'),
        );
        const selectedTab = tabs[index];
        if (!selectedTab) return;

        const maxScroll = Math.max(
          0,
          scroller.scrollWidth - scroller.clientWidth,
        );

        let targetScroll = 0;

        if (index === 0) {
          targetScroll = 0;
        } else if (index === periods.length - 1) {
          targetScroll = maxScroll;
        } else {
          const scrollerRect = scroller.getBoundingClientRect();
          const tabRect = selectedTab.getBoundingClientRect();
          const currentTabCenter = tabRect.left + tabRect.width / 2;
          const desiredCenter = scrollerRect.left + scrollerRect.width / 2;
          const delta = currentTabCenter - desiredCenter;

          targetScroll = Math.max(
            0,
            Math.min(maxScroll, scroller.scrollLeft + delta),
          );
        }

        scroller.scrollTo({
          left: targetScroll,
          behavior: "smooth",
        });

        // The scroll listener follows movement live. This watcher finalises
        // the bar beneath the selected pill even when targetScroll equals the
        // current scrollLeft and the browser emits no scroll event.
        settlePeriodIndicatorUnderTab(index);
      });
    });
  };

  useEffect(() => {
    const pendingIndex = pendingInitialPeriodRef.current;

    // Wait until React has actually committed the period calculated for this
    // date. This prevents the initial Early Morning state (0) from being
    // positioned before the current-time period (for example Afternoon = 2)
    // has reached the DOM.
    if (
      pendingIndex === null ||
      activePeriod !== pendingIndex ||
      initialPeriodPositionedRef.current
    ) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const scroller = periodTabsRef.current;
      const track = periodScrollTrackRef.current;
      if (!scroller || !track) return;

      initialPeriodPositionedRef.current = true;
      pendingInitialPeriodRef.current = null;
      changePeriod(activePeriod);
    });

    return () => cancelAnimationFrame(frame);
    // Manual period changes already position themselves through changePeriod().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, activePeriod]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const chimeTimers: number[] = [];
    const start = window.setTimeout(() => {
      setPeriodIntroActive(true);

      // Match the existing visual cascade: each tab starts 90 ms after the
      // previous one. These sounds occur only during this intro animation.
      periods.forEach((_, index) => {
        chimeTimers.push(
          window.setTimeout(() => playPracticeReadyPeriodTone(index), index * 90),
        );
      });
    }, 80);

    const stop = window.setTimeout(() => setPeriodIntroActive(false), 1180);

    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
      chimeTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [room]);

  useEffect(() => {
    const scroller = periodTabsRef.current;
    const track = periodScrollTrackRef.current;
    if (!scroller || !track) return;

    const updatePeriodIndicator = () => {
      const maxScroll = Math.max(
        0,
        scroller.scrollWidth - scroller.clientWidth,
      );
      const progress =
        maxScroll > 0 ? scroller.scrollLeft / maxScroll : 0;

      setPeriodScrollProgress(Math.max(0, Math.min(1, progress)));

      // The bar is always the real horizontal-scroll indicator.
      // Manual swipe, programmatic tab centering, automatic current-period
      // positioning and bar dragging all converge on this same geometry.
      const trackWidth = track.getBoundingClientRect().width;
      const thumbWidth = Math.min(128, Math.max(112, trackWidth * 0.27));
      const travel = Math.max(0, trackWidth - thumbWidth);
      const clampedProgress = Math.max(0, Math.min(1, progress));

      setPeriodIndicatorWidth(thumbWidth);
      setPeriodIndicatorLeft(clampedProgress * travel);

    };

    updatePeriodIndicator();
    scroller.addEventListener("scroll", updatePeriodIndicator, {
      passive: true,
    });
    window.addEventListener("resize", updatePeriodIndicator);

    return () => {
      scroller.removeEventListener("scroll", updatePeriodIndicator);
      window.removeEventListener("resize", updatePeriodIndicator);
      if (periodAlignmentFrameRef.current !== null) {
        cancelAnimationFrame(periodAlignmentFrameRef.current);
        periodAlignmentFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const scroller = periodTabsRef.current;
    if (!scroller) return;

    const updatePeriodScrollIndicator = () => {
      const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const progress = maxScroll > 0 ? scroller.scrollLeft / maxScroll : 0;
      setPeriodScrollProgress(Math.max(0, Math.min(1, progress)));
    };

    updatePeriodScrollIndicator();
    scroller.addEventListener("scroll", updatePeriodScrollIndicator, {
      passive: true,
    });
    window.addEventListener("resize", updatePeriodScrollIndicator);

    return () => {
      scroller.removeEventListener("scroll", updatePeriodScrollIndicator);
      window.removeEventListener("resize", updatePeriodScrollIndicator);
    };
  }, []);

  const setPeriodScrollFromPointer = (clientX: number) => {
    const scroller = periodTabsRef.current;
    const track = periodScrollTrackRef.current;
    if (!scroller || !track) return;

    const rect = track.getBoundingClientRect();
    const thumbWidth =
      periodIndicatorWidth > 0
        ? periodIndicatorWidth
        : Math.min(120, rect.width * 0.27);
    const travel = Math.max(0, rect.width - thumbWidth);

    const thumbLeft = Math.max(
      0,
      Math.min(
        travel,
        clientX - rect.left - thumbWidth / 2,
      ),
    );

    const progress = travel > 0 ? thumbLeft / travel : 0;
    const maxScroll = Math.max(
      0,
      scroller.scrollWidth - scroller.clientWidth,
    );

    scroller.scrollLeft = progress * maxScroll;
  };

  const selectNearestPeriodAfterDrag = () => {
    const scroller = periodTabsRef.current;
    if (!scroller) return;

    const tabs = Array.from(
      scroller.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    if (!tabs.length) return;

    const maxScroll = Math.max(
      0,
      scroller.scrollWidth - scroller.clientWidth,
    );

    // At the physical ends, the viewport center is naturally closer to an
    // inner tab. Explicitly map those end positions to the first/last period.
    const edgeTolerance = 2;

    if (scroller.scrollLeft <= edgeTolerance) {
      changePeriod(0, true);
      return;
    }

    if (scroller.scrollLeft >= maxScroll - edgeTolerance) {
      changePeriod(periods.length - 1, true);
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const viewportCenter = scrollerRect.left + scrollerRect.width / 2;

    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    tabs.forEach((tab, index) => {
      const rect = tab.getBoundingClientRect();
      const tabCenter = rect.left + rect.width / 2;
      const distance = Math.abs(tabCenter - viewportCenter);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    changePeriod(nearestIndex, true);
  };

  const handlePeriodTabsPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const scroller = periodTabsRef.current;
    if (!scroller || event.button !== 0) return;

    pendingPeriodAlignmentRef.current = null;
    if (periodAlignmentFrameRef.current !== null) {
      cancelAnimationFrame(periodAlignmentFrameRef.current);
      periodAlignmentFrameRef.current = null;
    }

    periodTabsDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scroller.scrollLeft,
      dragging: false,
      moved: false,
    };
  };

  const handlePeriodTabsPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const scroller = periodTabsRef.current;
    const drag = periodTabsDragRef.current;
    if (!scroller || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.dragging) {
      // Wait until the gesture is clearly horizontal. This preserves normal
      // vertical page scrolling and normal taps on the period buttons.
      if (Math.abs(dx) < 6) return;
      if (Math.abs(dx) <= Math.abs(dy)) return;

      drag.dragging = true;
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    event.preventDefault();
    scroller.scrollLeft = drag.startScrollLeft - dx;
  };

  const handlePeriodTabsPointerEnd = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const drag = periodTabsDragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    drag.pointerId = -1;
    drag.dragging = false;

    // Keep moved=true through the synthetic click that follows pointerup,
    // then clear it. This prevents a swipe ending over a pill from selecting it.
    requestAnimationFrame(() => {
      periodTabsDragRef.current.moved = false;
    });
  };

  const handlePeriodTabsClickCapture = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (!periodTabsDragRef.current.moved) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePeriodScrollPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (window.matchMedia("(min-width: 640px)").matches) return;
    pendingPeriodAlignmentRef.current = null;
    if (periodAlignmentFrameRef.current !== null) {
      cancelAnimationFrame(periodAlignmentFrameRef.current);
      periodAlignmentFrameRef.current = null;
    }
    periodScrollDraggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPeriodScrollFromPointer(event.clientX);
  };

  const handlePeriodScrollPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!periodScrollDraggingRef.current) return;
    setPeriodScrollFromPointer(event.clientX);
  };

  const handlePeriodScrollPointerEnd = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const wasDragging = periodScrollDraggingRef.current;
    periodScrollDraggingRef.current = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (wasDragging) {
      requestAnimationFrame(selectNearestPeriodAfterDrag);
    }
  };

  const periodTabs = (
    <div>
      <style>{`
        @keyframes period-intro-wave {
          0%, 100% { transform: translateY(0); box-shadow: none; }
          42% { transform: translateY(-3px); box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.10), 0 4px 12px rgba(124, 58, 237, 0.12); }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="tab"] { animation: none !important; }
        }
      `}</style>
      <div
        ref={periodTabsRef}
        id="period-tabs"
        className="-mt-1 overflow-x-auto pb-0 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mt-0 sm:pb-1 sm:pt-1.5"
        role="tablist"
        aria-label="Time periods"
        onPointerDown={handlePeriodTabsPointerDown}
        onPointerMove={handlePeriodTabsPointerMove}
        onPointerUp={handlePeriodTabsPointerEnd}
        onPointerCancel={handlePeriodTabsPointerEnd}
        onClickCapture={handlePeriodTabsClickCapture}
        style={{ touchAction: "pan-y" }}
      >
        <div className="flex min-w-max gap-2 sm:min-w-0 sm:w-full sm:items-center sm:justify-between sm:gap-2 sm:pr-0">
        {periods.map((period, index) => {
          const label = period.name.startsWith("Late Night") ? "Late Night" : period.name;
          const isActive = activePeriod === index;
          const hasExtensionHere =
            index !== activePeriod &&
            period.times.some((time) => validExtensionSlots.includes(time));
          return (
            <button
              key={period.name}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => changePeriod(index, true)}
              style={periodIntroActive ? {
                animation: `period-intro-wave 720ms ease-out ${index * 90}ms 1 both`,
              } : undefined}
              className={`min-h-10 shrink-0 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold transition sm:min-h-9 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 dark:ring-violet-500/60 sm:px-3.5 lg:px-4 lg:text-sm ${
                isActive
                  ? "bg-violet-600 text-white shadow-sm"
                  : "border border-violet-300 bg-white text-slate-600 hover:border-violet-400 hover:bg-violet-50/50 hover:text-violet-700 dark:border-violet-500 dark:bg-[#211A38]/50 dark:text-[#AAB3C7] dark:hover:border-violet-400 dark:hover:bg-[#2B2145] dark:hover:text-violet-100"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {label}
                {hasExtensionHere && (
                  <span
                    className="h-2 w-2 rounded-full bg-violet-500 dark:bg-violet-400"
                    aria-label="More booking times available here"
                    title="More booking times available here"
                  />
                )}
              </span>
            </button>
          );
        })}
        </div>
      </div>

      <div
        ref={periodScrollTrackRef}
        role="scrollbar"
        aria-label="Scroll time periods"
        aria-controls="period-tabs"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(periodScrollProgress * 100)}
        onPointerDown={handlePeriodScrollPointerDown}
        onPointerMove={handlePeriodScrollPointerMove}
        onPointerUp={handlePeriodScrollPointerEnd}
        onPointerCancel={handlePeriodScrollPointerEnd}
        className="relative mx-1 mt-0 h-4 touch-none cursor-ew-resize sm:hidden"
      >
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-slate-200 dark:bg-[#2A3246]">
          <div
            className="h-full rounded-full bg-violet-500 dark:bg-violet-400"
            style={{
              width:
                periodIndicatorWidth > 0
                  ? `${periodIndicatorWidth}px`
                  : "27%",
              transform: `translateX(${periodIndicatorLeft}px)`,
            }}
          />
        </div>
      </div>
    </div>
  );

  return (
    <Shell
      headerRef={availabilityHeaderRef}
      compactMobileHeader
      compactActionBarPadding
      title="Choose Your Time Slots"
      subtitle={longDate(date)}
      back={back}
      headerTitleAside={
        <div className="flex min-h-11 items-center gap-2.5 rounded-xl border border-slate-200/80 dark:border-[#30384D]/80 bg-white dark:bg-[#1B2133] px-3 py-1 shadow-sm sm:min-h-0 sm:py-2">
          <MapPin className="shrink-0 text-violet-600 dark:text-violet-300" size={18} />
          <div className="min-w-0 flex items-baseline gap-1.5 leading-tight sm:block">
            <small className="text-xs text-slate-500 dark:text-[#9AA6BC]">
              Selected MPR<span className="sm:hidden"> ·</span>
            </small>
            <p className="text-sm font-semibold sm:mt-0.5">{room}</p>
          </div>
          <button
            onClick={onChangeMpr}
            className="ml-auto flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-[#2B2145] sm:min-h-9"
          >
            Change <ChevronDown size={14} />
          </button>
        </div>
      }
      headerExtra={
        <div className="space-y-1.5 sm:space-y-1.5">
          {selectedSlots.length > 0 && (
            <div
              className="flex items-center justify-between gap-3 rounded-lg bg-slate-100/80 dark:bg-[#202739]/80 px-3 py-1.5 text-sm sm:px-4 sm:py-1.5"
              aria-label={`Selected time ${selectedRange}, ${durationLabel(selectedSlots.length)}`}
            >
              <span className="text-slate-500 dark:text-[#9AA6BC]">Selected time</span>
              <strong className="text-right text-violet-800 dark:text-violet-200">
                {selectedRange} · {durationLabel(selectedSlots.length)}
              </strong>
            </div>
          )}
          <div className="rounded-xl border border-violet-100 dark:border-violet-500/45 bg-violet-50/95 dark:bg-[#211A38]/95 px-3.5 py-1.5 text-sm font-medium leading-5 text-violet-800 dark:text-violet-200 sm:py-2">
            {selectionGuidance}
          </div>
          {periodTabs}
        </div>
      }
    >
      <div ref={periodContentStartRef} />
      <section
        ref={slotListRef}
        role="tabpanel"
        aria-label={
          periods[activePeriod].name.startsWith("Late Night")
            ? `Late Night, ${shortDate(nextDay)}`
            : periods[activePeriod].name
        }
      >
        {periods[activePeriod].name.startsWith("Late Night") && (
          <p className="mb-1 text-xs font-medium text-slate-500 dark:text-[#9AA6BC] sm:mb-2">
            After midnight · {shortDate(nextDay)}
          </p>
        )}
        <div className="space-y-1 sm:space-y-2">
          {periods[activePeriod].times.map((t) => {
            const isBooked = booked.has(t);
            const isSelected = !isBooked && selectedSlots.includes(t);
            const tIndex = allTimeSlots.indexOf(t);
            const selectedIndices = selectedSlots
              .map((item) => allTimeSlots.indexOf(item))
              .filter((index) => index >= 0);
            const startIndex =
              selectedIndices.length > 0 ? Math.min(...selectedIndices) : -1;
            const extensionCandidate =
              !isBooked &&
              selectedSlots.length > 0 &&
              !isSelected &&
              tIndex > startIndex &&
              tIndex - startIndex + 1 <= 6 &&
              !allTimeSlots
                .slice(startIndex, tIndex + 1)
                .some((candidateSlot) => booked.has(candidateSlot));
            return (
              <button
                key={t}
                type="button"
                disabled={isBooked}
                onClick={() => selectSlot(t)}
                className={`flex min-h-13 w-full items-center justify-between rounded-2xl border px-4 text-left sm:min-h-14 ${
                  isBooked
                    ? "cursor-not-allowed border-slate-200 dark:border-[#30384D] bg-slate-100 dark:bg-[#252C3E] text-slate-400 dark:text-[#74809A]"
                    : isSelected
                      ? "border-violet-600 bg-violet-600 dark:bg-violet-600 dark:border-violet-500 text-white shadow-lg shadow-violet-200 dark:shadow-none"
                      : extensionCandidate
                        ? "border-violet-200 dark:border-violet-500/70 bg-violet-50/40 dark:bg-[#211A38] hover:border-violet-400 dark:hover:border-violet-400 dark:hover:bg-[#2B2145]"
                        : "border-emerald-100 dark:border-emerald-800 bg-white dark:bg-[#1B2133] hover:border-emerald-400 dark:hover:border-emerald-600"
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{slotLabel(t)}</span>
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    isBooked
                      ? "bg-slate-200 text-slate-500 dark:bg-[#2A3246] dark:text-[#9AA6BC]"
                      : isSelected
                        ? "bg-white/20"
                        : extensionCandidate
                          ? "bg-violet-100 text-violet-700 dark:bg-[#2B2145] dark:text-violet-200"
                          : "bg-emerald-100 text-emerald-700 dark:bg-[#123427] dark:text-emerald-200"
                  }`}
                >
                  {isBooked
                    ? "Booked"
                    : isSelected
                      ? selectedSlots.length === 1
                        ? "Start"
                        : t === selectedSlots[0]
                          ? "Start"
                          : t === selectedSlots[selectedSlots.length - 1]
                            ? "End"
                            : "Selected"
                      : extensionCandidate
                        ? "Extend"
                        : "Available"}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <ActionBar>
        <Primary
          disabled={selectedSlots.length === 0 || selectionHasBookedSlot}
          onClick={onContinue}
        >
          View {room} Setup <ArrowRight />
        </Primary>
      </ActionBar>
    </Shell>
  );
}
function Issue({
  item,
  reason,
  action,
  onAction,
}: {
  item: Equipment;
  reason: string;
  action?: string;
  onAction?: () => void;
}) {
  const [imageOpen, setImageOpen] = useState(false);
  const imageUrl = equipmentImageUrl(item);

  useEffect(() => {
    if (!imageOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImageOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [imageOpen]);

  return (
    <>
      <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-amber-200 dark:border-amber-700 bg-white dark:bg-[#1B2133] p-3.5 shadow-sm sm:p-4">
        <div>
          <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={() => setImageOpen(true)}
              className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-200 dark:border-[#30384D] bg-slate-50 dark:bg-[#171D2D] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
              aria-label={`View larger reference image of ${item.name}`}
              title="View larger image"
            >
              <img
                src={imageUrl}
                alt={`Reference image of ${item.name}`}
                className="h-full w-full object-contain p-1.5 transition-transform group-hover:scale-105"
                loading="lazy"
              />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="min-w-0 break-words font-semibold leading-5">{item.name}</h2>
              <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
                <p className="min-w-0 text-xs font-bold text-violet-600 dark:text-violet-200">{item.id}</p>
                <div className="ml-auto shrink-0">
                  <StatusPill status={item.status} condition={item.condition} />
                </div>
              </div>
              <p className="mt-1.5 text-xs leading-4 text-slate-500 dark:text-[#9AA6BC]">
                {reason}
              </p>
            </div>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-100 dark:border-[#252C3E] pt-3 text-sm min-[360px]:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500 dark:text-[#9AA6BC]">Current location</dt>
            <dd className="mt-1 font-semibold">{item.currentLocation}</dd>
          </div>
          <div className="min-[360px]:justify-self-end text-left">
            <div>
              <dt className="text-xs text-slate-500 dark:text-[#9AA6BC]">Working condition</dt>
              <dd className="mt-1 font-semibold">{item.status === "missing" ? "Unknown" : item.condition}</dd>
            </div>
          </div>
        </dl>
        {action && onAction && (
          <div className="mt-auto pt-3">
            <Button
              onClick={onAction}
              variant="outline"
              className="min-h-11 w-full rounded-xl border-violet-200 bg-white text-violet-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-500/70 dark:bg-[#211A38] dark:text-violet-200 dark:hover:border-violet-400 dark:hover:bg-[#2B2145] dark:hover:text-violet-100"
            >
              {action}
              <Search />
            </Button>
          </div>
        )}
      </div>

      {imageOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[1px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setImageOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`issue-equipment-image-title-${item.id}`}
            className="relative w-full max-w-xl rounded-3xl bg-white dark:bg-[#1B2133] p-5 shadow-2xl sm:p-6"
          >
            <button
              type="button"
              onClick={() => setImageOpen(false)}
              className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-white dark:bg-[#1B2133] text-slate-600 dark:text-[#AAB3C7] shadow-sm ring-1 ring-slate-200 dark:ring-[#30384D] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              aria-label="Close equipment image"
            >
              <X size={20} />
            </button>
            <div className="pr-12">
              <h2 id={`issue-equipment-image-title-${item.id}`} className="text-lg font-bold text-[#151a31] dark:text-[#F5F7FF] sm:text-xl">
                {item.name}
              </h2>
              <p className="mt-1 text-sm font-bold tracking-wide text-violet-600 dark:text-violet-300">{item.id}</p>
              {item.modelName && (
                <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-[#D5D9E4]">{item.modelName}</p>
              )}
              {item.specifications && (
                <p className="mt-1 text-sm text-slate-500 dark:text-[#9AA6BC]">{item.specifications}</p>
              )}
            </div>
            <div className="mt-4 flex max-h-[60vh] min-h-64 items-center justify-center overflow-hidden rounded-2xl bg-slate-50 dark:bg-[#171D2D] p-4">
              <img
                src={imageUrl}
                alt={`Larger reference image of ${item.name}`}
                className="max-h-[54vh] w-full object-contain"
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-[#9AA6BC]">
              Reference image for visual identification. It may not show the exact physical unit currently at TSM.
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-[#252C3E] pt-4 text-sm">
              <div>
                <dt className="text-xs text-slate-500 dark:text-[#9AA6BC]">Current location</dt>
                <dd className="mt-1 font-semibold">{item.currentLocation}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-[#9AA6BC]">Working condition</dt>
                <dd className="mt-1 font-semibold">{item.status === "missing" ? "Unknown" : item.condition}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </>
  );
}
function SearchEmpty({ query }: { query: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-slate-300 dark:border-[#3A4358] bg-white dark:bg-[#1B2133] p-8 text-center">
      <Search className="mx-auto text-slate-400 dark:text-[#7F8AA3]" />
      <p className="mt-3 font-semibold">No matching equipment found</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-[#9AA6BC]">
        Try another equipment name or ID instead of “{query.trim() || "blank"}”.
      </p>
    </div>
  );
}
function SearchTabEmpty({
  type,
  count,
}: {
  type: "available" | "unavailable";
  count: number;
}) {
  if (type === "unavailable")
    return (
      <AvailabilityClearState
        text={`All ${count} matching ${count === 1 ? "item is" : "items are"} currently available.`}
      />
    );
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-[#3A4358] bg-white dark:bg-[#1B2133] p-8 text-center sm:col-span-2">
      <TriangleAlert className="mx-auto text-amber-500 dark:text-amber-300" />
      <p className="mt-3 font-semibold">No available matching equipment</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-[#9AA6BC]">
        Check the Unavailable tab for matching equipment that cannot currently
        be used.
      </p>
    </div>
  );
}
function NoEquipmentRecords() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-[#3A4358] bg-white dark:bg-[#1B2133] p-8 text-center sm:col-span-2">
      <Search className="mx-auto text-slate-400 dark:text-[#7F8AA3]" />
      <p className="mt-3 font-semibold">No equipment records available</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-[#9AA6BC]">
        Equipment data has not been added for this location.
      </p>
    </div>
  );
}
function NoAvailableItems() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-[#3A4358] bg-white dark:bg-[#1B2133] p-8 text-center sm:col-span-2">
      <TriangleAlert className="mx-auto text-amber-500 dark:text-amber-300" />
      <p className="mt-3 font-semibold">No available items</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-[#9AA6BC]">
        No assigned equipment is currently available at this location.
      </p>
    </div>
  );
}
function AvailabilityClearState({ text }: { text: string }) {
  return (
    <div className="relative z-10 flex items-center gap-3 rounded-2xl border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-[#10271F] px-4 py-4 text-left sm:col-span-2">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 dark:bg-[#123427] text-emerald-700 dark:text-emerald-300">
        <Check size={19} />
      </span>
      <div>
        <p className="font-semibold text-emerald-950 dark:text-emerald-200">
          All equipment is available
        </p>
        <p className="mt-0.5 text-sm text-emerald-800 dark:text-emerald-200">{text}</p>
      </div>
    </div>
  );
}
function EmptyState({ count, location }: { count: number; location: string }) {
  return (
    <AvailabilityClearState
      text={`All ${count} recorded ${count === 1 ? "item" : "items"} in ${location} ${count === 1 ? "is" : "are"} currently available.`}
    />
  );
}
