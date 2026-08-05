// Single icon family (Phosphor), single weight, single size default.
// Importing through this module keeps the weight and sizing consistent and
// gives one place to swap the family later.
//
// Card suits (♠ ♥ ♦ ♣) are deliberately NOT icons — they are typographic marks
// and belong in the text flow. The winner/loser/streak badges (crown, fire, ice)
// are also left as-is: they are playful award glyphs, not interface chrome.
export {
  Trophy,
  Lightning,
  MapPin,
  CalendarBlank,
  Clock,
  Alarm,
  Megaphone,
  User,
  FlagCheckered,
  Camera,
  Play,
  Lock,
  Medal,
  Diamond,
  Cards,
  X,
  Check,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  CaretUp,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUpDown,
  PencilSimple,
  Copy,
  Sparkle,
  Plus,
  Minus,
} from "@phosphor-icons/react";

// Standard stroke weight for the whole app.
export const ICON_WEIGHT = "bold";
export const ICON_SIZE = 16;
