// ─────────────────────────────────────────────
// Canonical Reference — Noorani Qaida Phoneme Lookup Table
// ─────────────────────────────────────────────
// Deterministic (non-ML) lookup table mapping every Noorani Qaida
// teaching unit to its expected QPS phoneme+sifat sequence.
//
// ⚠️ TODO: This file contains a SCAFFOLDED PLACEHOLDER based on the
// obadx QPS paper's phoneme set. The actual phoneme mappings for each
// Noorani Qaida unit need to be filled in by a qualified Tajweed reviewer.
// Errors here would silently corrupt every downstream alignment diff —
// do NOT have the AI invent these mappings.
//
// Structure: Each unit has an id, Arabic text, expected phoneme sequence,
// applicable Tajweed rules, lesson number, and category.
// ─────────────────────────────────────────────

import type { NooraniQaidaUnit, QPSPhoneme, TajweedRule } from "@/lib/qps-types";

// ─────────────────────────────────────────────
// QPS Phoneme Inventory (Placeholder)
// ─────────────────────────────────────────────
// Based on obadx's published QPS phoneme set. Each phoneme has its
// sifat (articulation properties) and makhraj (articulation point).
//
// TODO: Verify against the actual obadx vocab file once obtained from
// the obadx repository. This placeholder covers the 28 Arabic consonants
// + vowels + special articulations.

/** Utility to create a QPSPhoneme with defaults */
function ph(
  symbol: string,
  sifat: string[],
  makhraj: string,
  durationClass: QPSPhoneme["durationClass"] = "short",
): QPSPhoneme {
  return { symbol, sifat, makhraj, durationClass };
}

// ── Core Consonant Phonemes ──
export const QPS_PHONEMES: Record<string, QPSPhoneme> = {
  // Throat letters (حروف الحلق)
  hamza:   ph("ʔ",  ["jahr", "shidda"],    "halq_aqsa"),
  haa:     ph("h",  ["hams", "rakhawa"],   "halq_aqsa"),
  ayn:     ph("ʕ",  ["jahr", "tawassut"],  "halq_wasat"),
  hha:     ph("ħ",  ["hams", "rakhawa"],   "halq_wasat"),
  ghayn:   ph("ɣ",  ["jahr", "rakhawa", "isti_ala"],  "halq_adna"),
  khaa:    ph("x",  ["hams", "rakhawa", "isti_ala"],   "halq_adna"),

  // Back-tongue letters
  qaaf:    ph("q",  ["jahr", "shidda", "isti_ala", "qalqalah"], "lisan_aqsa"),
  kaaf:    ph("k",  ["hams", "shidda"],    "lisan_aqsa_adna"),

  // Middle-tongue letters
  jiim:    ph("dʒ", ["jahr", "shidda"],    "lisan_wasat"),
  shiin:   ph("ʃ",  ["hams", "rakhawa", "tafashi"], "lisan_wasat"),
  yaa_c:   ph("j",  ["jahr", "rakhawa"],   "lisan_wasat"),  // consonantal yaa

  // Edge-of-tongue
  daad:    ph("dˤ", ["jahr", "rakhawa", "isti_ala", "itbaq", "istitala"], "lisan_haffa"),

  // Tip-of-tongue letters
  laam:    ph("l",  ["jahr", "tawassut", "inhiraf"], "lisan_taraf_lam"),
  nuun:    ph("n",  ["jahr", "tawassut"], "lisan_taraf_nun"),
  raa:     ph("r",  ["jahr", "tawassut", "takarur"], "lisan_taraf_ra"),
  taa:     ph("t",  ["hams", "shidda"],   "lisan_taraf_dal"),
  taa_e:   ph("tˤ", ["hams", "shidda", "isti_ala", "itbaq"], "lisan_taraf_dal"),  // emphatic taa
  daal:    ph("d",  ["jahr", "shidda", "qalqalah"], "lisan_taraf_dal"),
  saad:    ph("sˤ", ["hams", "rakhawa", "isti_ala", "itbaq", "safeer"], "lisan_taraf_sin"),
  zaay:    ph("z",  ["jahr", "rakhawa", "safeer"],  "lisan_taraf_sin"),
  siin:    ph("s",  ["hams", "rakhawa", "safeer"],  "lisan_taraf_sin"),
  thaa:    ph("θ",  ["hams", "rakhawa"],   "lisan_taraf_tha"),
  dhaal:   ph("ð",  ["jahr", "rakhawa"],   "lisan_taraf_tha"),
  dhaa:    ph("ðˤ", ["jahr", "rakhawa", "isti_ala", "itbaq"], "lisan_taraf_tha"),  // emphatic dhaal

  // Lip letters (حروف شفوية)
  baa:     ph("b",  ["jahr", "shidda", "qalqalah"], "shafatan"),
  miim:    ph("m",  ["jahr", "tawassut"],  "shafatan"),
  waaw_c:  ph("w",  ["jahr", "rakhawa"],   "shafatan"),  // consonantal waaw
  faa:     ph("f",  ["hams", "rakhawa"],   "shafa_ulya"),

  // Nasal (خيشوم)
  ghunnah: ph("ŋ",  ["jahr"],              "khayshum"),

  // ── Vowels / Harakat ──
  fatha:   ph("a",  ["jahr"],  "jawf", "short"),
  kasra:   ph("i",  ["jahr"],  "jawf", "short"),
  damma:   ph("u",  ["jahr"],  "jawf", "short"),

  // Tanween
  fathatayn:  ph("an", ["jahr"], "jawf", "short"),
  kasratayn:  ph("in", ["jahr"], "jawf", "short"),
  dammatayn:  ph("un", ["jahr"], "jawf", "short"),

  // Madd vowels
  alif_madd:  ph("aː", ["jahr"], "jawf", "long"),    // alif after fatha
  yaa_madd:   ph("iː", ["jahr"], "jawf", "long"),    // yaa after kasra
  waaw_madd:  ph("uː", ["jahr"], "jawf", "long"),    // waaw after damma

  // Sukoon (absence of vowel)
  sukoon:  ph("∅",  [], "jawf", "short"),
};


// ─────────────────────────────────────────────
// Noorani Qaida Reference Units (Scaffolded)
// ─────────────────────────────────────────────
// TODO: Complete this table for all 17 lessons.
// Each entry maps a Noorani Qaida teaching unit to its expected
// phoneme sequence. A qualified Tajweed reviewer should verify
// every mapping before production use.
//
// Current state: Lesson 1 (single letters with fatha) scaffolded
// as a structural example. All other lessons are stubs.

const NOORANI_QAIDA_UNITS: NooraniQaidaUnit[] = [
  // ── Lesson 1: Single Letters with Fatha ──
  {
    id: "alif_fatha",
    arabicText: "اَ",
    expectedPhonemes: [QPS_PHONEMES.hamza, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "ba_fatha",
    arabicText: "بَ",
    expectedPhonemes: [QPS_PHONEMES.baa, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "ta_fatha",
    arabicText: "تَ",
    expectedPhonemes: [QPS_PHONEMES.taa, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "tha_fatha",
    arabicText: "ثَ",
    expectedPhonemes: [QPS_PHONEMES.thaa, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "jiim_fatha",
    arabicText: "جَ",
    expectedPhonemes: [QPS_PHONEMES.jiim, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "hha_fatha",
    arabicText: "حَ",
    expectedPhonemes: [QPS_PHONEMES.hha, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "khaa_fatha",
    arabicText: "خَ",
    expectedPhonemes: [QPS_PHONEMES.khaa, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "daal_fatha",
    arabicText: "دَ",
    expectedPhonemes: [QPS_PHONEMES.daal, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "dhaal_fatha",
    arabicText: "ذَ",
    expectedPhonemes: [QPS_PHONEMES.dhaal, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "raa_fatha",
    arabicText: "رَ",
    expectedPhonemes: [QPS_PHONEMES.raa, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "zaay_fatha",
    arabicText: "زَ",
    expectedPhonemes: [QPS_PHONEMES.zaay, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "siin_fatha",
    arabicText: "سَ",
    expectedPhonemes: [QPS_PHONEMES.siin, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "shiin_fatha",
    arabicText: "شَ",
    expectedPhonemes: [QPS_PHONEMES.shiin, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "saad_fatha",
    arabicText: "صَ",
    expectedPhonemes: [QPS_PHONEMES.saad, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "daad_fatha",
    arabicText: "ضَ",
    expectedPhonemes: [QPS_PHONEMES.daad, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "taa_e_fatha",
    arabicText: "طَ",
    expectedPhonemes: [QPS_PHONEMES.taa_e, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "dhaa_fatha",
    arabicText: "ظَ",
    expectedPhonemes: [QPS_PHONEMES.dhaa, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "ayn_fatha",
    arabicText: "عَ",
    expectedPhonemes: [QPS_PHONEMES.ayn, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "ghayn_fatha",
    arabicText: "غَ",
    expectedPhonemes: [QPS_PHONEMES.ghayn, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "faa_fatha",
    arabicText: "فَ",
    expectedPhonemes: [QPS_PHONEMES.faa, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "qaaf_fatha",
    arabicText: "قَ",
    expectedPhonemes: [QPS_PHONEMES.qaaf, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "kaaf_fatha",
    arabicText: "كَ",
    expectedPhonemes: [QPS_PHONEMES.kaaf, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "laam_fatha",
    arabicText: "لَ",
    expectedPhonemes: [QPS_PHONEMES.laam, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "miim_fatha",
    arabicText: "مَ",
    expectedPhonemes: [QPS_PHONEMES.miim, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "nuun_fatha",
    arabicText: "نَ",
    expectedPhonemes: [QPS_PHONEMES.nuun, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "haa_fatha",
    arabicText: "هَ",
    expectedPhonemes: [QPS_PHONEMES.haa, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "waaw_fatha",
    arabicText: "وَ",
    expectedPhonemes: [QPS_PHONEMES.waaw_c, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },
  {
    id: "yaa_fatha",
    arabicText: "يَ",
    expectedPhonemes: [QPS_PHONEMES.yaa_c, QPS_PHONEMES.fatha],
    tajweedRules: [],
    lesson: 1,
    category: "letter",
  },

  // ── Lesson 2: Single Letters with Kasra ──
  // TODO: Add all 28 letters with kasra (same structure as Lesson 1)

  // ── Lesson 3: Single Letters with Damma ──
  // TODO: Add all 28 letters with damma

  // ── Lesson 4-6: Letters with Harakat combinations ──
  // TODO: Add compound harakat combinations

  // ── Lesson 7-8: Tanween ──
  // TODO: Add tanween (fathatayn, kasratayn, dammatayn) units

  // ── Lesson 9-11: Sukoon & Madd ──
  // TODO: Add sukoon and madd units with relevant tajweedRules

  // ── Lesson 12-15: Shadda & Advanced ──
  // TODO: Add shadda, combined rules

  // ── Lesson 16-17: Tajweed Rules ──
  // TODO: Add units with specific tajweedRules (ghunnah, ikhfa, idgham, etc.)
];


// ─────────────────────────────────────────────
// Lookup Functions
// ─────────────────────────────────────────────

/** Look up a Noorani Qaida unit by its ID */
export function lookupUnit(id: string): NooraniQaidaUnit | undefined {
  return NOORANI_QAIDA_UNITS.find((u) => u.id === id);
}

/** Look up a Noorani Qaida unit by Arabic text */
export function lookupByArabicText(arabicText: string): NooraniQaidaUnit | undefined {
  return NOORANI_QAIDA_UNITS.find((u) => u.arabicText === arabicText);
}

/** Get all units for a specific lesson */
export function lookupByLesson(lesson: number): NooraniQaidaUnit[] {
  return NOORANI_QAIDA_UNITS.filter((u) => u.lesson === lesson);
}

/** Get all units that involve a specific Tajweed rule */
export function lookupByRule(rule: TajweedRule): NooraniQaidaUnit[] {
  return NOORANI_QAIDA_UNITS.filter((u) => u.tajweedRules.includes(rule));
}

/** Get all units matching a category */
export function lookupByCategory(category: NooraniQaidaUnit["category"]): NooraniQaidaUnit[] {
  return NOORANI_QAIDA_UNITS.filter((u) => u.category === category);
}

/** Get the expected QPS phoneme sequence for a given unit */
export function getExpectedPhonemes(unitId: string): QPSPhoneme[] {
  const unit = lookupUnit(unitId);
  return unit?.expectedPhonemes ?? [];
}

/**
 * Infer which Tajweed rules apply to a given QPS phoneme sequence.
 * This is a simplified heuristic — the full rule determination requires
 * context (what comes before/after in the recitation).
 */
export function getRulesForPhonemeSequence(phonemes: QPSPhoneme[]): TajweedRule[] {
  const rules = new Set<TajweedRule>();

  for (const p of phonemes) {
    // Qalqalah letters with sukoon
    if (p.sifat.includes("qalqalah")) {
      rules.add("qalqalah");
    }
    // Ghunnah (noon/meem with specific conditions)
    if (p.makhraj === "khayshum") {
      rules.add("ghunnah");
    }
    // Madd
    if (p.durationClass === "long" || p.durationClass === "extended") {
      rules.add("madd_tabii");
    }
    // Tafkheem / emphatic letters
    if (p.sifat.includes("isti_ala")) {
      rules.add("tafkheem");
    }
  }

  return Array.from(rules);
}

/** Get total number of scaffolded units (for progress tracking) */
export function getTotalUnitsCount(): number {
  return NOORANI_QAIDA_UNITS.length;
}

/** Get the complete list of all scaffolded units */
export function getAllUnits(): NooraniQaidaUnit[] {
  return [...NOORANI_QAIDA_UNITS];
}

/** Get available lesson numbers */
export function getAvailableLessons(): number[] {
  const lessons = new Set(NOORANI_QAIDA_UNITS.map((u) => u.lesson));
  return Array.from(lessons).sort((a, b) => a - b);
}
