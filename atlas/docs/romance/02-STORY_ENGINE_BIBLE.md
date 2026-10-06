# Story Engine Bible — "The Court of Thorns" Season 1

The single most important document in this product. Every rule below is
written so it can be (and, in Stage 5+, is) checked by code — not prose
flavor text the LLM is merely asked to respect. Where a rule has a
`RULE_ID`, that ID is a literal string constant the Canon Validator checks
against; it is not decorative.

---

## 1. World Bible (Season 1 scope)

**Setting:** The Court of Thorns, one of several Fae courts in a world
split between the mortal realm and Faerie. The player-character is a
mortal woman pulled across the border at the season's opening (the
"Awakening" beat). Faerie runs on older, stricter rules than the mortal
world — rules that are load-bearing game mechanics, not atmosphere (§3).

**Locations (Season 1, fixed set — no open world):**
`THE_HOLLOW` (arrival point), `THE_COURT_HALL` (political/social scenes),
`THE_THORN_GARDEN` (private Caelan scenes), `THE_WILD_WOOD` (hunt/danger
scenes), `THE_MORTAL_DOOR` (the way home — thematically central, appears
in multiple beats).

**Factions (Season 1):** The Thorn Court (Caelan's court — ambiguous,
dangerous, seductive), The Wild Hunt (antagonistic faction, introduces
Rival), The Mortal Realm (home, stakes, what the player risks losing).

## 2. Character Bible

Every character is a **structured record**, never a prompt string. Fields
below map directly to the `StoryCharacter` Prisma model (Stage 3).

### 2.1 Caelan — main voiced love interest

- `identity`: Fae lord of the Thorn Court. Centuries old. Bound to the
  Court by an old bargain he has never fully disclosed.
- `personality`: Controlled, wry, dangerous-charming; cracks only around
  the player-character.
- `goals`: [`BREAK_HIS_OWN_BINDING`, `PROTECT_THE_COURT`,
  `KEEP_HIS_TRUE_NAME_HIDDEN`] — goals are enum-tagged, not free text,
  so the Beat Graph and Canon Validator can reference them by ID.
- `fears`: [`LOSING_CONTROL`, `BEING_NAMED_AND_COMMANDED`]
- `values`: [`WORD_IS_BINDING`, `THE_COURT_BEFORE_HIMSELF`]
- `secrets` (→ `CharacterSecret`, each with a `revealCondition` beat ID):
  `HIS_TRUE_NAME` (never revealed in Season 1 — a Season 2 hook, and see
  Fae Rule `FAE-003`), `THE_NATURE_OF_HIS_OWN_BINDING` (revealed at beat
  `REVELATION`).
- `knowledge scope`: Caelan knows only what (a) is common Fae-court
  knowledge, (b) he has witnessed directly, or (c) the player has told
  him in-fiction (tracked as `RomanceMemory` rows with
  `relatedCharacter = caelan`). He **cannot** know the player's true name
  unless a `RomanceMemory` of type `SECRET` with `subject = trueName` and
  `sharedWithCharacter = caelan` exists. This is a hard Canon Validator
  check (`RULE_ID: CANON-004`), not a suggestion to the model.
- `speech style`: Formal cadence, rarely contracts words, dry
  understatement under pressure.
- `forbidden behavior`: Never knowingly lies (Fae Rule `FAE-001`); never
  claims knowledge outside his knowledge scope; never references a
  player fact that was never told to him.
- `character arc` (Season 1): Controlled distance → reluctant honesty →
  forced choice between the Court and the player.
- `current emotional state`: derived at scene-plan time from
  `RelationshipState` + current beat, not stored as freestanding mood.

### 2.2 Rival (second voiced character — antagonist/complication)

- `identity`: A Wild Hunt lieutenant with a legitimate, non-cartoonish
  claim against Caelan (a debt Caelan owes the Hunt — ties directly into
  Fae Rule `FAE-004`).
- `goals`: [`COLLECT_THE_HUNTS_DEBT`, `TEST_THE_PLAYER`]
- Structured identically to Caelan (personality/fears/values/secrets/
  knowledge-scope/speech-style/forbidden-behavior/arc) — intentionally
  not fully re-specified here to avoid duplicating the schema; Stage 3's
  `StoryCharacter` row for Rival follows the identical shape.

### 2.3 Support character (silent/helper — not voiced in MVP)

- `identity`: Wren, a half-Fae servant of the Thorn Court who owes the
  player-character a small, specific debt from the opening beat
  (seeds Fae Rule `FAE-004` early, at low stakes, before Caelan/Rival
  raise the stakes). Text-only dialogue; no `AudioAsset` generated for
  Wren in MVP (Audio Model §9 — selective rendering).

## 3. Fae Rules (structural, enforceable)

Each rule has a `RULE_ID`, a plain description, and an explicit
**enforcement point** — where in the pipeline (§7 of the engineering
brief) it is actually checked, not merely narrated.

| RULE_ID | Rule | Enforcement point |
|---|---|---|
| `FAE-001` | A Fae character cannot *knowingly* state something they believe to be false. (They can mislead by omission, ambiguity, or technically-true statements — that is the genre's whole seduction/danger dynamic — but never an assertion they know is false.) | Canon Validator, post-generation: any `StoryCharacter` with `race = FAE` whose generated dialogue asserts a fact contradicting a `CanonFact` or the character's own `knowledge scope` → **INVALID**, triggers repair/regenerate. |
| `FAE-002` | A bargain spoken aloud by both parties is binding the instant both have spoken, regardless of intent or later regret. | State Transition: a `Bargain` row transitions `PROPOSED → SEALED` the moment both `proposerConfirmed` and `counterpartyConfirmed` are true in the same scene; no further confirmation step exists. Once `SEALED`, its terms become `CanonFact` rows. |
| `FAE-003` | A true name gives the knower power over its holder (compel a single truthful answer, once per story, from the named Fae). | Enforced as an `Intent` precondition: the `COMPEL_WITH_TRUE_NAME` action is only in the Beat Graph's `availableActions` set if a `RomanceMemory` of type `SECRET`/`subject=trueName` exists for that character, AND a `trueNameCompelUsed` flag (on `RelationshipState`) is still false. Using it flips the flag permanently — it is a one-shot power by design, not a repeatable command. |
| `FAE-004` | A debt must eventually be repaid; the Fae party will act (not just complain) to collect it if ignored long enough. | A `Debt` row has `status: OPEN \| REPAID \| FORGIVEN \| ESCALATED`. The Beat Graph's beat-advance check includes a scan for `OPEN` debts older than N beats past their `dueBeat`; if found, the owed character's next scene plan is forced to include a `DEBT_COLLECTION` scene intent — this is not optional flavor, it is a required scene-plan input the LLM cannot omit. |
| `FAE-005` | A broken bargain carries an automatic, specific consequence — never a hand-waved "bad things happen." | Every `Bargain` row has a required `breachConsequence` (a `CanonFact` template written at bargain-creation time, e.g. "if broken, the Thorn Garden's protection over the player lapses"). Breaching sets `Bargain.status = BROKEN` and **mechanically applies** the pre-declared consequence as a real `WorldStateFact`/`RelationshipState` mutation in the same transaction — the LLM narrates it, it does not decide it. |
| `FAE-006` | Fae characters remember every promise made *to* them and *by* them, exactly, forever (within the story's own continuity) — Fae memory of bargains/promises never decays, unlike ordinary `RomanceMemory` staleness rules (§5.6). | `Promise` and `Bargain` rows are explicitly exempt from the staleness/decay pass in §5.6; they are only ever closed by an explicit state transition (`FULFILLED`/`BROKEN`/`FORGIVEN`), never by age. |

## 4. Relationship Model

Chose **5** dimensions (not the full illustrative 9 in the brief) — each
one must earn its place by (a) being independently legible to the player
and (b) actually gating different content in the Beat Graph. Rejected
`jealousy` and `respect` as MVP dimensions: in Season 1's actual beat
graph their effects fully collapse into `trust`+`tension` and
`trust`+`loyalty` respectively — adding them now would be unused state,
which the brief explicitly forbids ("gereksiz entity üretme" applies
equally to gratuitous state dimensions).

| Dimension | Range | Gates in Season 1 |
|---|---|---|
| `trust` | -100..100 | Whether Caelan discloses his binding (`REVELATION` beat requires `trust >= 40`) |
| `attraction` | 0..100 | Available intimate-scene intents at a given spice setting |
| `fear` | 0..100 | Whether the player can plausibly `DEFY` Caelan in a scene without an escalation branch |
| `loyalty` | -100..100 | Which side the player stands with at `BLOOD_MOON` (signed, can go to Rival) |
| `tension` | 0..100 | Decays toward 0 each beat unless a scene explicitly raises it; gates "confrontation" scene variants |

**Hard rule:** `RelationshipState` is mutated **only** by the Story
Engine's State Transition step, from a declared, logged cause — never
directly by LLM output. A generated scene may *suggest* an effect (e.g.
the model's structured scene-plan response includes a proposed
`relationshipDelta`), but the Story Engine clamps, validates, and applies
it; the LLM's suggestion is an input to a deterministic function, not a
write. Every change is a row in `StoryEvent` carrying
`{dimension, previousValue, newValue, sourceBeatId, reason}` — fully
reconstructable, matching the brief's explicit traceability requirement.

## 5. Memory Model

### 5.1 Types (`RomanceMemoryType` enum)

`PROMISE`, `BARGAIN`, `DEBT`, `SECRET`, `RELATIONSHIP_EVENT`, `USER_FACT`,
`CHARACTER_FACT`, `WORLD_EVENT`, `DISCOVERED_TRUTH`, `ITEM`, `LOCATION`,
`BETRAYAL`, `PREFERENCE` — exactly the taxonomy given in the brief; none
dropped (each has a distinct retrieval/decay rule below), none added.

### 5.2 Metadata (every `RomanceMemory` row)

`subject`, `object` (nullable — not every memory is relational),
`source` (`USER_STATED | CHARACTER_STATED | SYSTEM_INFERRED | NARRATION`),
`confidence` (0..1 — only meaningfully < 1 for `SYSTEM_INFERRED`),
`importance` (0..1, decided at extraction time, drives retrieval
ranking), `createdAt`, `updatedAt`, `status`
(`ACTIVE | SUPERSEDED | RETRACTED`), `validity`
(`PERMANENT | SCOPED_TO_SEASON | SCOPED_TO_BEAT`), `scope`
(`playerId` always; optionally `relatedCharacter`, `relatedStory`,
`relatedBeat`).

### 5.3 Lifecycle

`EXTRACTED` (written by the post-generation Memory Extraction step, from
the *validated* scene — never from raw model text before Canon
Validation) → `ACTIVE` → (`SUPERSEDED` by a newer, contradicting memory of
the same `subject`+`object`, or `RETRACTED` if a later canon check proves
it was never true) → eventually `ARCHIVED` for `SCOPED_TO_BEAT` memories
once their beat is long past (still queryable, excluded from default
retrieval).

### 5.4 Duplication prevention

Before insert, the extraction step checks for an existing `ACTIVE` memory
with the same `(playerId, type, subject, object)` tuple. If found and the
new content is materially identical → no-op (update `updatedAt` only). If
found and materially different → §5.5 (contradiction), never a silent
second row.

### 5.5 Contradiction detection

A new memory that contradicts an existing `ACTIVE` memory of the same
`(subject, object)` triggers: for `PROMISE`/`BARGAIN`/`DEBT`/`SECRET` →
**hard fail**, this must never happen because those are State-Transition
owned, not extracted freely (§3's rules make them explicit transitions,
not inferred facts) — a contradiction here means a Canon Validator bug
and is logged as a `FailureMode` event (§12), not silently resolved.
For soft types (`USER_FACT`/`CHARACTER_FACT`/`PREFERENCE`) → the newer
memory supersedes the old (`status = SUPERSEDED`), since people's stated
facts can legitimately change ("I used to live in the city" → "I live in
the Hollow now").

### 5.6 Staleness

`SCOPED_TO_BEAT` memories lose retrieval priority (not deleted) once 3+
beats have passed. `PROMISE`/`BARGAIN`/`DEBT` are explicitly exempt
(Fae Rule `FAE-006`) — a promise never goes stale on its own; it is only
closed by an explicit transition.

### 5.7 Retrieval

Never "give the model the whole history" (explicitly forbidden). Retrieval
for a scene-generation call is: all `ACTIVE` memories with
`relatedBeat = currentBeat OR relatedCharacter IN sceneCharacters`,
ranked by `importance * recencyWeight`, capped at a fixed count (tuned in
Stage 5, not unbounded), via the existing `SearchProvider<T>` seam
(keyword/structured now; `SEMANTIC` is a drop-in swap later, not a
rewrite).

## 6. Canon Model

`CanonFact` is the ground truth table: immutable-once-written facts about
the world/characters/relationships that have actually happened
(`Bargain` terms, `Promise` content, revealed secrets, `WorldStateFact`
changes). A `CanonFact` is written **only** by the State Transition step,
after a scene passes validation — never speculatively, never by the LLM
directly.

**Canon Validator checks** (run on every generated scene, before the
player sees it):

| RULE_ID | Check |
|---|---|
| `CANON-001` | No generated line asserts a `WorldStateFact` that contradicts an existing one. |
| `CANON-002` | No generated line has a character reference an event that hasn't happened yet in `StoryEvent` order (timeline integrity). |
| `CANON-003` | No generated line has a character act outside their declared `knowledge scope` (§2). |
| `CANON-004` | No generated line has a character use the player's true name unless the `SECRET`/`trueName` memory exists for that character (Fae Rule `FAE-003`'s precondition, checked in reverse — this is what the brief's own example describes verbatim). |
| `CANON-005` | No generated line contradicts an `ACTIVE` `Promise`/`Bargain`/`Debt` term. |
| `CANON-006` | No generated line changes `RelationshipState` directly in prose-implied terms beyond what the scene-plan's declared `relationshipDelta` allows (prevents the model from "acting as if" trust is high when it isn't). |
| `CANON-007` | No generated content violates a Safety Rule (§10) — checked first, short-circuits the rest. |

**On failure:** `regenerate` (same scene plan, new generation, same
constraints — default, cheap) → if still failing, `repair` (surgical
re-prompt citing exactly which `RULE_ID` failed and why) → if still
failing, `fallback` (a pre-authored, safe, generic continuation scene for
that beat, logged as a `FailureMode` event, §12). **A scene that has not
passed validation is never shown to the player.** No exceptions.

## 7. Beat Graph — Season 1 (6–8 beats, not hundreds of hard-coded branches)

```
AWAKENING → BARGAIN → FIRST_CHOICE → HUNT → REVELATION → BLOOD_MOON → SEASON_FINALE
```

Each beat (`Beat` model, Stage 3) declares:

- `entryConditions`: e.g. `BARGAIN` requires `AWAKENING.completed = true`.
- `exitConditions`: e.g. `BARGAIN` exits once a `Bargain` row reaches
  `SEALED` or the player explicitly refuses (→ a different, still-valid
  exit to `FIRST_CHOICE` with a different starting `WorldStateFact`).
- `availableActions`: the `Intent` set the Intent Parser is allowed to
  resolve to in this beat (§8) — e.g. `COMPEL_WITH_TRUE_NAME` is never in
  `AWAKENING`'s set because the precondition (§3 `FAE-003`) cannot yet be
  true.
- `stateEffects`: declarative deltas applied on entry (e.g. `HUNT` sets
  `fear += 10` baseline before any scene plays).
- `characterInvolvement`: which of Caelan/Rival/Wren are present.
- `canonFacts`: facts that become true/available upon entering this beat.
- `possibleSceneVariants`: 2-4 `SceneVariant` rows per beat (§8), selected
  by current `RelationshipState` + prior player choices — this is where
  "different playthroughs feel different" lives, not in branch explosion.
- `failStates` + `recoveryPaths`: e.g. if the player breaks the `BARGAIN`
  (Fae Rule `FAE-005`), `BARGAIN`'s fail state routes to a *harder*
  `FIRST_CHOICE` variant with the pre-declared `breachConsequence`
  already applied — the story continues, consequences compound, nothing
  dead-ends.

## 8. Scene Model & Intent Parser

**Intent Parser pipeline** (free-form text → structured, validated
intent):

1. Deterministic pass: pattern/keyword extraction for unambiguous
   action verbs + stance words (fast, free, catches the common cases —
   "I open the door" → `action: OPEN_DOOR`).
2. LLM-assisted pass (only if (1) is ambiguous): the model is asked to
   emit a **structured** `{action, stance, target}` object against a
   **closed, beat-scoped vocabulary** (the current beat's
   `availableActions` and known character/location IDs) — never asked
   to "continue the story" or produce prose at this step.
3. Validation: if the parsed `action` is not in the current beat's
   `availableActions`, or `target` doesn't exist/isn't present in-scene →
   **reject** with a safe, in-world clarifying response ("Caelan isn't
   here to open a door for" / ask the player to rephrase) — never passed
   to Scene Generation as if valid.

**Scene Generation** receives: current beat, validated `Intent`, retrieved
memories (§5.7), relevant `CanonFact`s, character structured records
(§2) trimmed to knowledge scope, and the beat's declared
`stateEffects`/`relationshipDelta` bounds. It returns structured
`{prose, dialogueLines[], proposedRelationshipDelta, proposedMemoryCandidates[]}`
— never raw "whatever you want" text. Canon Validator (§6) runs on this
structured output before commit.

## 9. Audio Model

Pipeline (exactly per the brief): `interactive session → scene finalized
→ script approved → voice assignment → dialogue segmentation → TTS →
ambience → music → effects → mix → final audio asset → cache`.

- **Selective rendering**: not every scene gets audio in MVP — only
  scenes flagged `audioEligible` on the `SceneVariant` (pivotal/emotional
  beats; Wren's lines render as text-only per §2.3). This is a product
  cost/pacing decision, not a technical limitation.
- **Idempotency**: `AudioRender` has a unique
  `(storyEventId, voiceProfileVersion)` constraint — re-processing the
  same finalized scene under the same voice config returns the existing
  `AudioAsset`, never creates a duplicate render job or asset.
  (golden test: brief's TEST 11.)
- **Failure isolation**: `StoryEvent`/state commit happens in its own
  transaction, fully independent of audio. If TTS/mix fails, the story
  has already advanced; the player sees text immediately and the audio
  asset attaches asynchronously when ready (or the player sees a clear,
  non-broken "audio unavailable, read the scene" state) — the brief's
  explicit "audio failure must never lose story state" requirement.
- **Provider abstraction**: `TTSProvider` (text+voice profile → raw audio)
  and `AudioRenderer` (raw audio + ambience/music/effects → final mixed
  asset) are separate interfaces (Stage 3/5) — human/licensed/AI voice is
  a `VoiceProfile.sourceType` field, not a code fork.

## 10. Safety Rules (structural, never prompt-only)

Absolute prohibitions, each enforced by `CANON-007` before any other
check runs, and backed by non-LLM heuristic/classifier checks on both
input and output (never trust the model's own restraint alone):

`SAFETY-001` no minor sexualization (age-gated at account level + no
character or player-character can be tagged/implied minor in any sexual
scene — structurally impossible, not just discouraged), `SAFETY-002` no
incest sexualization, `SAFETY-003` no non-consensual sexual content
(a scene-plan's intimacy step requires an explicit prior
`consentConfirmed` state on the relevant `StoryEvent` chain), `SAFETY-004`
no sexual-violence eroticization, `SAFETY-005` no exploitative content.
Free-form user input is itself scanned pre-parse for prompt-injection
patterns and safety-violating requests (§8's rejection path, not silently
passed through). 18+ age gate is a precondition for the entire `(romance)`
route group, checked server-side, not a client banner.

## 11. State Transitions (summary — authoritative source is each model's own section above)

Entity → who may transition it → how:
`Beat` (Story Engine only, entry/exit conditions), `Bargain`
(`PROPOSED→SEALED` on mutual confirm, `SEALED→FULFILLED|BROKEN`),
`Promise` (`MADE→FULFILLED|BROKEN|FORGIVEN`), `Debt`
(`OPEN→REPAID|FORGIVEN|ESCALATED`), `RelationshipState` (Story Engine
only, from a logged cause, never direct LLM write), `RomanceMemory`
(Memory Extraction step only, post-validation), `CanonFact` (State
Transition step only, post-validation), `AudioRender`
(idempotent, Audio pipeline only).

## 12. Failure Modes

| Dependency | Failure | Handling |
|---|---|---|
| LLM (scene gen) | timeout/error/invalid JSON | retry once with backoff → fallback pre-authored beat continuation → log `FailureMode` |
| LLM (intent parse) | ambiguous/invalid | safe in-world clarification, no state change |
| Canon Validator | repeated failure (3x) | fallback scene, flagged for content-team review (not silently accepted) |
| TTS/Audio | any stage fails | story state already committed (independent transaction); player sees text now, audio attaches later or shows a clear "unavailable" state |
| Database | transaction fails | full rollback, no partial `StoryEvent`/`CanonFact`/`RelationshipState` write — see Stage 3/5's transaction boundaries |
| Notification | send fails | logged, retried on next cycle, never blocks story progress |
