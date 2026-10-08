# Product Bible — "The Court of Thorns" (working title)

**⚠️ TRADEMARK RISK — read before any public-facing use of this name.**
"The Court of Thorns" is a near-identical match to *A Court of Thorns and
Roses* (Sarah J. Maas / Bloomsbury), the dominant, trademarked work in
exactly this genre (dark fae romantasy). Using this name publicly risks a
real trademark/passing-off claim and App Store/marketing rejection. This
document treats it strictly as the internal working title per the
brief's own framing ("Çalışma adı"). **A cleared, distinct name is a
hard blocker before any public launch, store listing, or marketing
asset** — not a cosmetic rename. Flagging this once, here, rather than
burying it.

---

## Product vision

A persistent, remembered, voice-performed romantic fiction universe where
the player's choices — spoken as free text, not menu clicks — genuinely
change how characters feel about them, what the world remembers, and what
happens next. Not a chatbot. Not a generic AI story generator. Not a
branching-choice visual novel. A **world that keeps a ledger on the
player** across sessions, seasons, and years.

## Target user

Adult (18+) readers/listeners of romantasy and interactive fiction —
primarily women 18–40, already consuming romantasy in book/audiobook
form (the genre's dominant existing audience), who want agency inside the
story rather than a fixed novel, and who are already comfortable paying
for serialized fiction (Kindle Unlimited, Royal Road, webnovel apps,
romance audiobook subscriptions).

## Target market

Global, English-language first. Romance/romantasy is one of the
highest-revenue fiction genres; interactive/AI fiction is nascent and
under-served for this specific audience (most "AI companion" products
skew male-coded and generic; most interactive fiction skews puzzle/branch,
not emotionally persistent).

## Core value proposition

"Create your character. Enter the story. Speak. Decide. Be remembered."

Three things competitors don't combine:
1. **Free-form input**, not a choice menu — you write what you do and say.
2. **Real persistent memory with consequences** — a promise made in
   session 1 can be called due in session 7, correctly, because the
   system (not the LLM's imagination) tracked it.
3. **Premium voice performance** — the payoff of a pivotal scene is a
   produced audio scene, not a wall of text.

## Positioning

Not competing with: generic "AI girlfriend" apps (low narrative
investment, no persistent consequence, no genre craft), branching visual
novels (no free-form agency, finite content), or passive audiobooks (no
agency at all). Competing for: romantasy readers' discretionary
entertainment spend and time, positioned as "a story that knows you
exist," priced and produced like premium audio fiction, not like a chat
app.

## UX principles

- The first five minutes earns trust through a *memory proof*, not an
  explanation of features (see Section 13 of the engineering brief — the
  "first 5 minutes" beat sequence is binding product spec, not a
  suggestion).
- Never show the player a raw error, a blank loading screen, or system
  vocabulary ("organization," "token limit," "model"). In-world framing
  for every wait state and every failure.
- Free-form input is the default interaction; suggested-action chips are
  a safety net for writer's block, never the primary mechanic.

## Product principles

- The Story Engine, not the LLM, owns truth. (Section 7 of the
  engineering brief; enforced structurally — see Story Engine Bible.)
- Every consequence the player can point to (a promise, a debt, a
  changed relationship number) must be traceable to a real stored event,
  never an LLM's unverified claim.
- Nothing in this product is allowed to silently retcon what already
  happened. A contradiction is caught before the player sees it, not
  patched after.

## Content principles

- Dark fae romantasy, female POV, first universe only. Tone: perilous,
  seductive, morally ambiguous courts; danger is real (the beloved can
  lie by omission, can be dangerous, can hurt the player-character) but
  sexual content is always consensual in-fiction (hard safety rule, see
  §16 of the engineering brief — non-consensual sexual content is an
  absolute prohibition at the validator layer, not a tone choice).
- Spice level: explicit-capable, gated behind 18+ verification and an
  explicit per-player content preference (player can play the exact same
  season at a "fade to black" or "explicit" spice setting — a scene-plan
  parameter, not two different products).

## Retention philosophy

Retention is earned by the world remembering the player, never by
notification pressure. No daily-streak mechanics, no FOMO countdown
timers, no generic "come back!" push. See §15 — every notification must
cite a real, specific story fact.

## Audio philosophy

Audio is a produced deliverable of a finished scene, not a live TTS
parrot of every message (§12). Provider-agnostic from day one (ADR
pending in Stage 3): `TTSProvider`/`AudioRenderer` interfaces, not a
vendor SDK call inlined into domain logic.

## AI philosophy

The LLM is a renderer of sanctioned prose, never an author of canon. It
receives a constrained, structured context (current beat, allowed
actions, relevant memories, character knowledge scope) and must pass
Canon Validation before the player ever sees its output. A validation
failure is invisible to the player (repair-or-regenerate), never shown as
a broken scene.

## Safety philosophy

Absolute, validator-enforced prohibitions (not prompts, not instructions
to the model — structural checks a scene cannot pass without satisfying):
no minor sexualization, no incest sexualization, no non-consensual sexual
content, no sexual-violence eroticization, no exploitative content. 18+
age gate before any mature content path is reachable. See Story Engine
Bible §Safety Rules for the enforceable rule list.

## Quality bar

Shared verbatim with the engineering brief's §27 — no flaky test, no
type/lint/build error, no unhandled error, no broken mobile UX, no
missing authorization/tenant scope, no fake data, no placeholder, no
critical-path TODO, no untested critical logic, no undocumented
architectural decision. This bar applies to Romance exactly as it applies
to the rest of Cevoryn.

## MVP boundary

1 universe ("The Court of Thorns," working title). 2 main voiced
characters + 1 silent/support character. 1 season, 6–8 beats. Free-form
input. Persistent memory (full taxonomy, not a stub subset). Relationship
state (multi-dimensional). World state + Fae Rules (structurally
enforced). Beat graph + Canon Validator (both real, both enforced — this
is the one piece of "MVP" that is explicitly *not* allowed to be a
simplified stand-in, because it is the product's core differentiator).
Personalized audio for key scenes (not every scene — see Audio Model).
FREE/PREMIUM entitlement, now wired to a real payment provider (Polar —
see "Live payment integration" below), gating audio narration
specifically (free-form play, memory, and relationships are never
paywalled; the differentiator being sold is the audio performance).

## Live payment integration (Polar)

Reuses Cevoryn's existing, already-production-tested Polar integration
(`src/lib/polar/**`, `src/server/services/billing.service.ts`) rather
than a second payment stack — same access token, same webhook secret,
same signature verification — but with Romance's own product
(`POLAR_PRODUCT_ROMANCE_PREMIUM`), checkout/portal routes
(`src/app/api/romance/billing/**`), and state table
(`RomanceSubscription`, player-scoped per ADR-0001, never the B2B
`Subscription` table). The single shared webhook route
(`/api/billing/polar/webhook`) branches on which metadata key an event
carries (`romancePlayerId` vs `organizationId`) — set by whichever
checkout route created it — so the two billing surfaces never cross
wires despite sharing one Polar account and one webhook endpoint.
PREMIUM gates exactly one thing: whether `submitStoryActionAction`
schedules `renderSceneAudio()` at all. A FREE player's scene is never
sent to TTS, not even to discard the result.

## Post-MVP boundary (explicitly deferred, not forgotten)

- Second universe / second season.
- Co-op or shared-story features.
- Full admin content-authoring UI (MVP ships with versioned
  JSON/TS-defined beat graphs + a seed script, not a visual editor — see
  §23; the *data model* for admin tooling ships in MVP, the *UI* does
  not).
- Semantic (embedding-based) memory retrieval (`SearchProvider<T>`'s
  `SEMANTIC` variant) — MVP ships keyword/structured retrieval, which is
  sufficient because memory *type* and *relatedBeat/relatedCharacter*
  scoping do most of the relevance work already.
- Background-playback audio, offline caching.

## Non-goals

- Not a general-purpose AI chatbot platform.
- Not a choose-your-own-adventure with a finite branch tree (the beat
  graph + state model explicitly replaces that approach — see Story
  Engine Bible).
- Not a platform for user-authored universes (MVP is one
  curated universe; UGC is out of scope entirely, not deferred — it
  changes the safety/moderation problem completely and is not assumed by
  any part of this design).
- Not reusing or depicting any real, identifiable person (voice,
  likeness, or character) without explicit, cleared rights.
