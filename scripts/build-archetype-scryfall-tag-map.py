#!/usr/bin/env python3
"""Build a verified Archetype → Scryfall oracle-tag map.

Every Exact Tagger Tag is resolved against Scryfall's oracle_tags bulk file
(exact slug or normalized alias). Fabricated / card-name tags are rejected.

Usage:
  python3 scripts/build-archetype-scryfall-tag-map.py \\
    --oracle-tags data/scryfall/oracle-tags.json \\
    --out-dir data/archetype-scryfall-tags
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def load_tag_index(path: Path) -> tuple[dict, dict, dict]:
    tags = json.loads(path.read_text())
    by_slug = {t["slug"]: t for t in tags}
    by_norm: dict[str, str] = {}
    for t in tags:
        by_norm.setdefault(norm(t["slug"]), t["slug"])
        by_norm.setdefault(norm(t.get("label") or ""), t["slug"])
        for a in t.get("aliases") or []:
            by_norm.setdefault(norm(a), t["slug"])
    return tags, by_slug, by_norm


def resolve(tag: str, by_slug: dict, by_norm: dict) -> tuple[str, str | None]:
    tag = (tag or "").strip()
    if not tag:
        return "empty", None
    if tag in by_slug:
        return "exact", tag
    n = norm(tag)
    if n in by_norm:
        return "norm", by_norm[n]
    return "miss", None


def tagging_count(by_slug: dict, slug: str) -> int:
    t = by_slug.get(slug) or {}
    return len(t.get("taggings") or [])


def desc_of(by_slug: dict, slug: str, fallback: str = "") -> str:
    t = by_slug.get(slug) or {}
    d = (t.get("description") or "").strip()
    return d or fallback


# ── Curated archetype → (category, tag, description override?) ──────────────
# Descriptions default to Scryfall's when present; overrides are short deck-building notes.

Row = tuple[str, str, str]  # category, tag, optional description override

TRIBE_SHARED: list[Row] = [
    ("Core Mechanic", "anthem", "Lords and anthems that buff your creature type (Scryfall alias: lord)."),
    ("Core Mechanic", "typal-creature", "Cards that care about creature types in general."),
    ("Payoff", "warlord", "Power/toughness equal to creature count — classic tribal finisher shape."),
    ("Enabler", "changeling", "All-creature-types enablers that count for every typal payoff."),
    ("Tutor/Selection", "tutor", "Generic tutors; combine with t:creature type filters in search."),
    ("Combat", "gives-haste", "Haste enablers so tribal boards can attack immediately."),
    ("Combat", "evasion", "Evasion keywords that help tribal armies connect."),
    ("Protection", "gives-hexproof", "Hexproof grants protect key tribal pieces."),
    ("Protection", "gives-indestructible", "Indestructible grants protect the board from wipes."),
    ("Synergy", "creaturefall", "ETB-on-creature triggers common in go-wide tribal shells."),
]


def tribe_rows(creature: str, extra: list[Row] | None = None) -> list[Row]:
    """Build typal rows using real Scryfall typal-/tutor-creature- conventions."""
    rows: list[Row] = [
        ("Core Mechanic", f"typal-{creature}", f"Cards that care about {creature.title()} creatures."),
        ("Tutor/Selection", f"tutor-creature-{creature}", f"Tutors that specifically fetch {creature.title()} cards."),
        ("Tutor/Selection", f"impulse-creature-{creature}", f"Impulse-draw effects that can hit {creature.title()} cards."),
        ("Tutor/Selection", f"seek-creature-{creature}", f"Seek effects that find {creature.title()} cards."),
        ("Payoff", f"affinity-for-{creature}s", f"Cost reduction / affinity for {creature.title()}s."),
        ("Payoff", f"affinity-for-{creature}", f"Cost reduction / affinity for {creature.title()}s."),
    ]
    if creature == "sliver":
        rows.append(("Payoff", "sliver-stackable", "Sliver abilities that stack with multiples."))
        rows.append(("Payoff", "affinity-for-slivers", "Affinity for Slivers."))
    if creature == "dragon":
        rows.append(("Synergy", "typal-elder-dragon", "Elder Dragon typal care."))
    if creature == "goblin":
        rows.append(("Synergy", "typal-goblin-orc", "Goblin/Orc typal overlap."))
    if creature == "human":
        rows.append(("Payoff", "affinity-for-humans", "Affinity for Humans."))
        rows.append(("Synergy", "typal-non-human", "Effects that care about non-Humans (hate / mirror)."))
    rows.extend(TRIBE_SHARED)
    if extra:
        rows.extend(extra)
    return rows


ARCHETYPES: dict[str, list[Row]] = {
    # ── Original macro archetypes ────────────────────────────────────────────
    "Tokens (Go-Wide)": [
        ("Core Mechanic", "repeatable-creature-tokens", "Repeatable creature-token generators — the engine of go-wide."),
        ("Core Mechanic", "synergy-token", "Cards that explicitly care about tokens."),
        ("Core Mechanic", "synergy-token-creature", "Cards that care about creature tokens specifically."),
        ("Core Mechanic", "token-doubler", "Parallel Lives / Anointed Procession style doublers."),
        ("Core Mechanic", "convoke", "Tap creatures (often tokens) to help cast spells."),
        ("Payoff", "anthem", "Team-wide +N/+N buffs that scale with board width."),
        ("Payoff", "warlord", "P/T equal to creature count."),
        ("Payoff", "overrun", "Finishers that grant trample and a large pump."),
        ("Payoff", "tokenfall", "Triggers when tokens enter."),
        ("Enabler", "young-pyromancer-ability", "Cast-instant/sorcery → create a creature token."),
        ("Enabler", "token-increaser", "Effects that increase the number of tokens created."),
        ("Win Condition", "gives-haste", "Haste so freshly made tokens can attack."),
        ("Win Condition", "gives-trample", "Trample to push wide boards through blockers."),
        ("Synergy", "sacrifice-outlet", "Sac outlets convert excess tokens into value."),
        ("Synergy", "death-trigger", "Death triggers turn traded tokens into advantage."),
        ("Synergy", "affinity-for-tokens", "Affinity / cost reduction for tokens."),
    ],
    "Combo": [
        ("Core Mechanic", "tutor", "Tutors assemble combo pieces."),
        ("Core Mechanic", "ritual", "Mana rituals accelerate combos."),
        ("Core Mechanic", "untapper", "Untappers enable infinite mana / activated-ability loops."),
        ("Core Mechanic", "alternate-win-condition", "Explicit alternate win conditions (often combo payoffs)."),
        ("Payoff", "extra-turn", "Extra-turn effects as combo finishers or enablers."),
        ("Payoff", "storm-count-matters", "Storm-count payoffs for spell-based combos."),
        ("Enabler", "cost-reducer", "Cost reduction makes combo lines cheaper."),
        ("Enabler", "mana-rock", "Mana rocks for colorless acceleration."),
        ("Enabler", "mana-dork", "Mana dorks for green acceleration."),
        ("Enabler", "bottomless-mana-sink", "Infinite-mana sinks that convert mana into a win."),
        ("Protection", "gives-hexproof", "Protect combo pieces."),
        ("Protection", "counterspell", "Interaction to protect the combo turn."),
        ("Synergy", "copy", "Copy effects can duplicate combo pieces or spells."),
        ("Synergy", "recursion", "Recursion recovers combo pieces from the yard."),
    ],
    "Control/Pillowfort": [
        ("Core Mechanic", "pillowfort", "Tax / disincentive effects that discourage attacks at you."),
        ("Core Mechanic", "tax", "Resource taxes when opponents try to do things."),
        ("Core Mechanic", "tax-attack", "Costs to attack — classic pillowfort."),
        ("Core Mechanic", "cast-tax", "Taxes on casting spells."),
        ("Core Mechanic", "counterspell", "Hard permission."),
        ("Core Mechanic", "removal", "Spot and flexible removal."),
        ("Core Mechanic", "sweeper", "Board wipes (Scryfall aliases include board-wipe / boardwipe)."),
        ("Payoff", "fog", "Prevent combat damage for a turn."),
        ("Payoff", "pseudo-fog", "Fog-like combat shutdowns."),
        ("Payoff", "damage-prevention", "Prevent damage effects."),
        ("Enabler", "draw-engine", "Card advantage engines to outgrind the table."),
        ("Enabler", "spot-removal", "Efficient single-target removal."),
        ("Protection", "gives-player-hexproof", "Player hexproof / shroud-style protection."),
        ("Win Condition", "alternate-win-condition", "Slow alternate wins while locked down."),
        ("Synergy", "hatebear", "Low-curve hate creatures that lock lines of play."),
        ("Synergy", "lockdown-creature", "Keep opposing creatures tapped / locked."),
    ],
    "Artifacts": [
        ("Core Mechanic", "synergy-artifact", "Cards that care about artifacts."),
        ("Core Mechanic", "mana-rock", "Mana rocks — the backbone of artifact decks."),
        ("Core Mechanic", "affinity", "Affinity for artifacts."),
        ("Core Mechanic", "metalcraft", "Metalcraft thresholds."),
        ("Payoff", "cranial-plating", "Buffs based on artifact / equipment count."),
        ("Payoff", "animate-artifact", "Turn artifacts into creatures."),
        ("Enabler", "tutor-artifact-equipment", "Tutors for equipment (often artifact packages)."),
        ("Enabler", "improvise", "Improvise as an artifact-casting enabler."),
        ("Enabler", "imprint", "Imprint value engines."),
        ("Win Condition", "repeatable-artifact-tokens", "Repeatable artifact-token makers (Clues, Treasures, etc.)."),
        ("Synergy", "sacrifice-outlet-artifact", "Artifact sac outlets."),
        ("Synergy", "cost-reducer", "Cost reduction for expensive artifact payoffs."),
    ],
    "Landfall": [
        ("Core Mechanic", "landfall", "Landfall triggers — defining mechanic."),
        ("Core Mechanic", "land-ramp", "Ramp that puts lands onto the battlefield."),
        ("Core Mechanic", "lands-matter", "Cards that care about lands generally."),
        ("Core Mechanic", "land-count-matters", "Payoffs for high land counts."),
        ("Core Mechanic", "extra-land", "Extra land drops per turn."),
        ("Enabler", "fetchland", "Fetchlands that trigger landfall repeatedly."),
        ("Enabler", "multi-land-ramp", "Ramp that nets multiple lands."),
        ("Enabler", "ramp", "General ramp effects."),
        ("Payoff", "landfall-other", "Landfall-like triggers on others' lands / variants."),
        ("Payoff", "tokenfall", "Token ETBs often paired with landfall token makers."),
        ("Win Condition", "gives-haste", "Haste for landfall creature tokens."),
        ("Synergy", "mana-dork", "Early mana to accelerate land drops and payoffs."),
    ],
    "Graveyard/Reanimator": [
        ("Core Mechanic", "reanimate", "Put creatures from graveyard onto the battlefield."),
        ("Core Mechanic", "recursion", "Return cards from graveyard to hand / battlefield."),
        ("Core Mechanic", "castable-from-graveyard", "Flashback and other cast-from-yard effects."),
        ("Core Mechanic", "synergy-graveyard-cast", "Payoffs for casting from the graveyard."),
        ("Core Mechanic", "graveyard-fuel", "Fill the graveyard intentionally."),
        ("Enabler", "mill-self", "Self-mill to fuel the yard (alias: self-mill)."),
        ("Enabler", "discard-outlet", "Discard outlets to pitch reanimation targets."),
        ("Enabler", "surveil", "Surveil as selective self-mill."),
        ("Payoff", "regrowth", "Return cards from yard to hand."),
        ("Payoff", "delve", "Exile yard cards to help cast spells."),
        ("Payoff", "persist", "Persist recursion loops."),
        ("Synergy", "death-trigger", "Death triggers in reanimator / aristocrats hybrids."),
        ("Synergy", "sacrifice-outlet", "Sac outlets to re-kill and reanimate."),
    ],
    "Aristocrats": [
        ("Core Mechanic", "sacrifice-outlet", "Ways to sacrifice permanents for value."),
        ("Core Mechanic", "free-sacrifice-outlet", "Sac outlets with no extra cost."),
        ("Core Mechanic", "death-trigger", "Triggers when creatures die."),
        ("Core Mechanic", "synergy-sacrifice", "Cards that care about sacrificing."),
        ("Core Mechanic", "martyr", "Creatures that sac themselves for benefit."),
        ("Payoff", "drain-life", "Drain / life-loss on death or sac."),
        ("Payoff", "grave-pact", "Opponents sacrifice when your creatures die."),
        ("Enabler", "repeatable-creature-tokens", "Token fodder for the sac engine."),
        ("Enabler", "repeatable-sacrifice-outlet", "Repeatable sac outlets."),
        ("Win Condition", "bombard", "Sac a creature to deal damage."),
        ("Win Condition", "fling", "Sac a creature to deal its power as damage."),
        ("Synergy", "plunder", "Sac to draw cards."),
        ("Synergy", "sacrifice-outlet-creature", "Creature-specific sac outlets."),
    ],
    "Spellslinger/Storm": [
        ("Core Mechanic", "synergy-instant", "Cards that care about instants."),
        ("Core Mechanic", "synergy-sorcery", "Cards that care about sorceries."),
        ("Core Mechanic", "magecraft", "Magecraft — cast instant/sorcery triggers."),
        ("Core Mechanic", "storm-count-matters", "Payoffs for high storm count."),
        ("Core Mechanic", "cantrip", "Cantrips to chain spells."),
        ("Payoff", "copy-instant", "Copy instants."),
        ("Payoff", "copy-sorcery", "Copy sorceries."),
        ("Payoff", "copy-spell", "Copy spells generally."),
        ("Payoff", "young-pyromancer-ability", "Cast instant/sorcery → token."),
        ("Payoff", "gives-prowess", "Prowess grants for noncreature cast triggers."),
        ("Payoff", "prowess-anthem", "Team prowess on noncreature casts."),
        ("Enabler", "ritual", "Mana rituals for storm turns."),
        ("Enabler", "cost-reducer-instant-sorcery", "Make instants/sorceries cheaper."),
        ("Enabler", "cast-trigger-you", "Whenever you cast X, do something."),
        ("Win Condition", "storm-like", "Storm-adjacent finishers."),
        ("Win Condition", "burn-player", "Burn that finishes after a big spell turn."),
    ],
    "Voltron (Go-Tall)": [
        ("Core Mechanic", "synergy-equipment", "Cards that care about equipment."),
        ("Core Mechanic", "synergy-aura", "Cards that care about auras."),
        ("Core Mechanic", "living-weapon", "Equipment that makes its own creature."),
        ("Core Mechanic", "quick-equip", "Non-equip attach / cheap attach effects."),
        ("Core Mechanic", "auto-equip", "Equipment that attaches itself on ETB."),
        ("Payoff", "sword-of-x-and-y", "Protection swords and similar dual-protection equipment."),
        ("Payoff", "evasion", "Evasion so the Voltron attacker connects."),
        ("Payoff", "unblockable", "True unblockable."),
        ("Payoff", "gives-trample", "Trample for commander damage."),
        ("Enabler", "tutor-artifact-equipment", "Equipment tutors."),
        ("Enabler", "tutor-enchantment-aura", "Aura tutors."),
        ("Protection", "gives-hexproof", "Protect the Voltron creature."),
        ("Protection", "gives-indestructible", "Indestructible on the Voltron creature."),
        ("Protection", "gives-protection", "Protection from color / quality."),
        ("Win Condition", "gives-double-strike", "Double strike doubles commander damage."),
    ],
    # ── Macro archetypes from Draftsim / EDH expansion ───────────────────────
    "Ramp": [
        ("Core Mechanic", "ramp", "Mana acceleration for current or later turns."),
        ("Core Mechanic", "land-ramp", "Ramp that puts lands onto the battlefield."),
        ("Core Mechanic", "mana-dork", "Creatures that tap for mana."),
        ("Core Mechanic", "mana-rock", "Artifacts that tap for mana."),
        ("Core Mechanic", "ritual", "Temporary mana bursts."),
        ("Payoff", "mana-sink", "Ways to spend excess mana."),
        ("Payoff", "bottomless-mana-sink", "Sinks that scale with arbitrary mana."),
        ("Payoff", "mana-increaser", "Mana doublers / Wild Growth style increasers."),
        ("Enabler", "multi-land-ramp", "Multi-land ramp spells."),
        ("Enabler", "combat-ramp", "Ramp via combat damage / attacks."),
        ("Win Condition", "gives-haste", "Haste for expensive threats cast with ramp."),
        ("Synergy", "landfall", "Extra lands feed landfall payoffs."),
    ],
    "Aggro": [
        ("Core Mechanic", "gives-haste", "Haste so threats attack immediately."),
        ("Core Mechanic", "combat-trick", "Combat tricks to win races."),
        ("Core Mechanic", "evasion", "Evasion to connect for damage."),
        ("Payoff", "overrun", "Overrun finishers."),
        ("Payoff", "gives-double-strike", "Double strike for burst damage."),
        ("Payoff", "gives-first-strike", "First strike in combat."),
        ("Payoff", "gives-menace", "Menace as evasion."),
        ("Payoff", "gives-trample", "Trample to push damage through."),
        ("Enabler", "cost-reducer", "Cheaper creatures for aggressive curves."),
        ("Enabler", "ritual", "Burst mana for explosive turns."),
        ("Win Condition", "burn-player", "Burn to finish after combat."),
        ("Win Condition", "burn-any", "Flexible burn."),
        ("Synergy", "anthem", "Anthems for go-wide aggro."),
    ],
    "Counters (+1/+1)": [
        ("Core Mechanic", "counters-matter", "Cards that care about counters."),
        ("Core Mechanic", "counter-fuel-pt", "Sources of +1/+1 counters."),
        ("Core Mechanic", "counter-increaser", "Hardened Scales style increasers."),
        ("Core Mechanic", "move-counters", "Move counters (Ozolith patterns)."),
        ("Payoff", "synergy-proliferate", "Proliferate payoffs / enablers."),
        ("Payoff", "gives-trample", "Trample for oversized creatures."),
        ("Enabler", "outlast-mentor", "Outlast / mentor style counter builders."),
        ("Enabler", "pseudo-proliferate", "Proliferate-like effects."),
        ("Win Condition", "overrun", "Finishers once the board is grown."),
    ],
    "Counters (-1/-1)": [
        ("Core Mechanic", "pp-counters-matter", "Cards that care about -1/-1 counters."),
        ("Core Mechanic", "counters-matter", "General counters-matter payoffs."),
        ("Core Mechanic", "gives-wither", "Wither spreads -1/-1 via combat."),
        ("Payoff", "synergy-wither", "Wither synergy."),
        ("Payoff", "synergy-infect", "Infect synergy (poison + -1/-1 overlap)."),
        ("Enabler", "synergy-proliferate", "Proliferate spreads -1/-1 counters."),
        ("Enabler", "pseudo-proliferate", "Proliferate-like spread."),
        ("Win Condition", "poison-opponents", "Direct poison as a parallel win path."),
        ("Synergy", "counter-increaser", "Increasers that amplify -1/-1 placement."),
    ],
    "Infect/Poison": [
        ("Core Mechanic", "poisonous", "Poisonous / poison-on-damage creatures."),
        ("Core Mechanic", "synergy-poison", "Cards that care about poison counters."),
        ("Core Mechanic", "poison-mechanics", "Effects that interact with poison by name."),
        ("Core Mechanic", "poison-opponents", "Give poison without connecting in combat."),
        ("Core Mechanic", "gives-infect", "Grant infect."),
        ("Core Mechanic", "synergy-infect", "Infect synergy."),
        ("Payoff", "gives-wither", "Wither as a related counter strategy."),
        ("Enabler", "synergy-proliferate", "Proliferate poison."),
        ("Enabler", "evasion", "Evasion so infect creatures connect."),
        ("Win Condition", "alternate-win-condition", "Poison is an alternate win path."),
    ],
    "Wheel": [
        ("Core Mechanic", "wheel", "Discard hand, draw a new hand."),
        ("Core Mechanic", "wheel-symmetrical", "Each-player wheels."),
        ("Core Mechanic", "wheel-one-sided", "One-sided (usually you) wheels."),
        ("Core Mechanic", "miniwheel", "Discard hand, draw fewer than seven."),
        ("Payoff", "opponent-discard-matters", "Payoffs when opponents discard."),
        ("Payoff", "draw-matters", "Payoffs when you draw."),
        ("Payoff", "discard-symmetrical", "Force discards without drawing back up."),
        ("Enabler", "whirlpool", "Wheel into the library variants."),
        ("Win Condition", "rack-effect", "Punish small hands after wheels."),
        ("Synergy", "group-slug", "Damage while hands are cycled."),
    ],
    "Lifegain": [
        ("Core Mechanic", "lifegain", "Gain life."),
        ("Core Mechanic", "lifegain-matters", "Payoffs for gaining life."),
        ("Core Mechanic", "repeatable-lifegain", "Repeatable life gain."),
        ("Payoff", "drain-life", "Drain opponents while gaining life."),
        ("Payoff", "alternate-win-condition", "Felidar Sovereign style life wins."),
        ("Payoff", "soul-warden-ability", "ETB / creature life-gain triggers."),
        ("Enabler", "gives-lifelink", "Grant lifelink."),
        ("Synergy", "synergy-lifelink", "Lifelink synergy."),
        ("Win Condition", "burn-player", "Burn finishers after racing life totals."),
    ],
    "Superfriends": [
        ("Core Mechanic", "synergy-planeswalker", "Cards that care about planeswalkers."),
        ("Core Mechanic", "tutor-planeswalker", "Planeswalker tutors."),
        ("Core Mechanic", "protects-planeswalker", "Protect planeswalkers from attack / removal."),
        ("Payoff", "copy-planeswalker", "Copy planeswalkers."),
        ("Enabler", "synergy-proliferate", "Proliferate loyalty."),
        ("Enabler", "counter-fuel-loyalty", "Add loyalty counters."),
        ("Protection", "damage-prevention-planeswalker", "Prevent damage to planeswalkers."),
        ("Synergy", "reanimate-planeswalker", "Recur planeswalkers."),
        ("Synergy", "passive-ability", "Planeswalkers with static / non-loyalty abilities."),
    ],
    "Group Hug": [
        ("Core Mechanic", "group-hug", "Effects that benefit other players."),
        ("Core Mechanic", "selective-group-hug", "Hug that benefits only some opponents."),
        ("Enabler", "force-draw", "Force opponents to draw."),
        ("Enabler", "donate-token", "Create tokens for opponents."),
        ("Synergy", "catch-up", "Help players who are behind."),
        ("Win Condition", "alternate-win-condition", "Hug decks often pivot to alternate wins."),
    ],
    "Group Slug": [
        ("Core Mechanic", "group-slug", "Damage or effects that hit multiple players."),
        ("Core Mechanic", "burn-player-each", "Damage each player."),
        ("Core Mechanic", "burn-player", "Player-directed burn."),
        ("Payoff", "rack-effect", "Punish small hands."),
        ("Enabler", "synergy-burn", "Burn synergy."),
        ("Win Condition", "burn-any", "Flexible burn."),
        ("Synergy", "group-hug", "Sometimes mixed politics tables."),
    ],
    "Chaos": [
        ("Core Mechanic", "coin-flip", "Coin flip effects."),
        ("Core Mechanic", "dice-roll", "Dice roll effects."),
        ("Core Mechanic", "synergy-dice", "Dice synergy."),
        ("Core Mechanic", "coin-flips-matter", "Payoffs for coin flips."),
        ("Payoff", "random-card", "Random card selection effects."),
        ("Payoff", "conjure-random", "Conjure random cards."),
        ("Enabler", "dice-reroll", "Reroll dice."),
        ("Synergy", "wish", "Sideboard / wish tutoring as chaos value."),
    ],
    "Blink/Flicker": [
        ("Core Mechanic", "flicker", "Blink / flicker (alias: blink)."),
        ("Core Mechanic", "flicker-self", "Permanents that flicker themselves."),
        ("Core Mechanic", "flicker-slow", "Exile and return later (end of turn, etc.)."),
        ("Payoff", "creaturefall", "ETB triggers on creatures — the blink payoff."),
        ("Payoff", "enchantmentfall", "Enchantment ETBs (constellation)."),
        ("Enabler", "flicker-enchantment", "Flicker enchantments."),
        ("Synergy", "death-trigger", "Sometimes paired with sac-blink loops."),
        ("Protection", "gives-hexproof", "Protect key ETB pieces."),
    ],
    "Enchantress": [
        ("Core Mechanic", "synergy-enchantment", "Cards that care about enchantments."),
        ("Core Mechanic", "enchantmentfall", "Constellation / enchantment ETBs."),
        ("Core Mechanic", "enchantment-engine", "Repeatable enchantment value engines."),
        ("Core Mechanic", "synergy-aura", "Aura synergies inside enchantress."),
        ("Payoff", "draw-engine", "Enchantress draw engines."),
        ("Enabler", "tutor-enchantment", "Enchantment tutors."),
        ("Enabler", "tutor-enchantment-aura", "Aura tutors."),
        ("Enabler", "cost-reducer-enchantment", "Cheaper enchantments."),
        ("Synergy", "affinity-for-enchantments", "Affinity for enchantments."),
        ("Synergy", "synergy-enchantment-creature", "Enchantment creatures."),
        ("Protection", "protects-enchantment", "Protect your enchantments."),
    ],
    "Stax": [
        ("Core Mechanic", "tax", "Tax opponents' actions."),
        ("Core Mechanic", "cast-tax", "Tax on casts."),
        ("Core Mechanic", "tax-attack", "Tax on attacks."),
        ("Core Mechanic", "hatebear", "Low-curve hate creatures."),
        ("Core Mechanic", "hatebird", "Flying hate creatures (higher curve mirrors)."),
        ("Payoff", "lockdown-creature", "Keep creatures locked down."),
        ("Payoff", "lockdown-artifact", "Lock artifacts."),
        ("Payoff", "lockdown-land", "Lock lands."),
        ("Payoff", "freeze-creature", "Prevent untapping."),
        ("Enabler", "pillowfort", "Attack disincentives while locking the table."),
        ("Win Condition", "alternate-win-condition", "Win under a lock."),
        ("Synergy", "spot-removal", "Clean up what slips through."),
    ],
    "Theft": [
        ("Core Mechanic", "theft", "Steal cards and resources."),
        ("Core Mechanic", "threaten", "Gain control until end of turn."),
        ("Core Mechanic", "theft-mass", "Mass theft effects."),
        ("Core Mechanic", "nightveil-theft", "Exile and cast opponents' cards."),
        ("Core Mechanic", "synergy-theft", "Theft synergy."),
        ("Payoff", "theft-land", "Steal lands."),
        ("Payoff", "theft-equipment", "Steal equipment."),
        ("Payoff", "theft-enchantment", "Steal enchantments."),
        ("Payoff", "theft-planeswalker", "Steal planeswalkers."),
        ("Enabler", "theft-spell", "Steal / cast opponents' spells."),
        ("Synergy", "copy-creature", "Copy as a soft-theft plan."),
    ],
    "Legends Matter / Historic": [
        ("Core Mechanic", "synergy-legendary", "Cards that care about legendary permanents."),
        ("Core Mechanic", "synergy-historic", "Cards that care about historic."),
        ("Core Mechanic", "legendary-team-up", "Legendary partner / team-up designs."),
        ("Payoff", "copy-legendary", "Copy legendary permanents (often with legend-rule care)."),
        ("Payoff", "mirror-gallery", "Bypass the legend rule."),
        ("Enabler", "tutor-legendary", "Tutor legendary cards."),
        ("Enabler", "tutor-creature-legendary", "Tutor legendary creatures."),
        ("Enabler", "impulse-historic", "Impulse historic cards."),
        ("Synergy", "synergy-equipment-legendary", "Legendary equipment synergies."),
        ("Synergy", "cost-reducer-historic", "Cost reduction for historic."),
    ],
    "Mill": [
        ("Core Mechanic", "mill-opponent", "Mill opponents."),
        ("Core Mechanic", "mill-any", "Mill any library."),
        ("Core Mechanic", "mill-self", "Self-mill (also fuels your own yard)."),
        ("Core Mechanic", "synergy-mill", "Mill payoffs."),
        ("Core Mechanic", "mill-exile", "Exile from top of library."),
        ("Payoff", "alternate-win-condition", "Mill-out / empty-library wins."),
        ("Enabler", "surveil", "Selective mill / setup."),
        ("Enabler", "graveyard-fuel", "Fill yards intentionally."),
        ("Synergy", "hand-disruption", "Combine mill with hand attack."),
    ],
    "Extra Combats": [
        ("Core Mechanic", "extra-combat-phase", "Extra combat phases (alias: extra-combat)."),
        ("Payoff", "gives-haste", "Haste so new attackers can use extra combats."),
        ("Payoff", "gives-double-strike", "Double strike with extra combats."),
        ("Payoff", "overrun", "Combat finishers."),
        ("Enabler", "untapper", "Untap attackers between combats."),
        ("Synergy", "combat-trick", "Tricks during multiple combat steps."),
        ("Synergy", "evasion", "Ensure attackers connect each combat."),
    ],
    "Extra Turns": [
        ("Core Mechanic", "extra-turn", "Take extra turns."),
        ("Payoff", "alternate-win-condition", "Win during locked extra-turn loops."),
        ("Enabler", "tutor", "Find extra-turn spells."),
        ("Enabler", "recursion", "Recur extra-turn spells."),
        ("Enabler", "castable-from-graveyard", "Cast extra turns from the yard."),
        ("Protection", "counterspell", "Protect the extra-turn turn."),
        ("Synergy", "prevent-extra-turns", "Hate for opposing extra turns (sideboard mindset)."),
    ],
    "Equipment": [
        ("Core Mechanic", "synergy-equipment", "Equipment matters."),
        ("Core Mechanic", "living-weapon", "Living weapon equipment."),
        ("Core Mechanic", "quick-equip", "Cheap / alternate attach."),
        ("Core Mechanic", "auto-equip", "Self-attaching equipment."),
        ("Payoff", "french-vanilla-equipment", "Simple keyword/stat equipment."),
        ("Payoff", "cranial-plating", "Artifact-count buffs."),
        ("Payoff", "sword-of-x-and-y", "Dual-protection swords."),
        ("Enabler", "tutor-artifact-equipment", "Equipment tutors."),
        ("Enabler", "impulse-artifact-equipment", "Impulse equipment."),
        ("Synergy", "copy-equipment", "Copy equipment."),
        ("Synergy", "reanimate-equipment", "Recur equipment."),
        ("Protection", "gives-hexproof", "Protect the equipped creature."),
    ],
    "Vehicles": [
        ("Core Mechanic", "crew", "Crew keyword / crewed vehicles."),
        ("Core Mechanic", "synergy-vehicle", "Vehicle matters."),
        ("Core Mechanic", "bring-your-own-crew", "Vehicles that come with pilots."),
        ("Core Mechanic", "crewless-vehicle", "Vehicles that animate without crewing."),
        ("Core Mechanic", "alternative-crewing", "Alternate self-animation."),
        ("Payoff", "animate-vehicle", "Turn vehicles into creatures without crew."),
        ("Payoff", "animate-artifact", "Animate artifacts including vehicles."),
        ("Enabler", "impulse-artifact-vehicle", "Impulse vehicles."),
        ("Synergy", "reanimate-vehicle", "Recur vehicles."),
        ("Synergy", "flicker-vehicle", "Flicker vehicles."),
    ],
    "Copy/Clone": [
        ("Core Mechanic", "clone", "Clone creatures."),
        ("Core Mechanic", "copy-creature", "Copy creatures."),
        ("Core Mechanic", "copy-permanent", "Copy permanents."),
        ("Core Mechanic", "copy-spell", "Copy spells."),
        ("Core Mechanic", "copy-self", "Permanents that copy themselves / make copies of self."),
        ("Payoff", "copy-token", "Copy tokens."),
        ("Payoff", "copy-legendary", "Copy legendaries."),
        ("Payoff", "polymorph", "Polymorph effects."),
        ("Enabler", "copy-instant", "Copy instants."),
        ("Enabler", "copy-sorcery", "Copy sorceries."),
        ("Synergy", "copy-artifact", "Copy artifacts."),
        ("Synergy", "copy-enchantment", "Copy enchantments."),
        ("Synergy", "mirror-gallery", "Legend-rule bypass for copies."),
    ],
    "Devotion": [
        ("Core Mechanic", "affinity-for-devotion", "Effects keyed to devotion."),
        ("Payoff", "mana-sink", "Spend mana produced by devotion engines."),
        ("Enabler", "mana-dork", "Colored pips for devotion."),
        ("Enabler", "mana-rock", "Rocks that still support the plan."),
        ("Synergy", "synergy-enchantment", "Enchantments often carry colored pips."),
        ("Synergy", "cost-reducer", "Cost reduction alongside devotion payoffs."),
    ],
    "Cascade/Discover": [
        ("Core Mechanic", "gives-cascade", "Grant cascade."),
        ("Core Mechanic", "synergy-cascade", "Cascade synergy."),
        ("Core Mechanic", "synergy-discover", "Discover synergy."),
        ("Payoff", "gains-cascade", "Permanents that gain cascade."),
        ("Enabler", "cost-reducer", "Manipulate MV for cascade hits."),
        ("Enabler", "ritual", "Ritual into cascade spells."),
        ("Synergy", "cast-trigger-you", "Cast triggers in cascade shells."),
    ],
    "Big Mana / X Spells": [
        ("Core Mechanic", "mana-sink", "Spend large amounts of mana."),
        ("Core Mechanic", "bottomless-mana-sink", "Arbitrary-mana sinks."),
        ("Core Mechanic", "mana-increaser", "Mana doublers / increasers."),
        ("Core Mechanic", "ramp", "Acceleration into X spells."),
        ("Payoff", "burn-any", "X burn."),
        ("Enabler", "mana-rock", "Rocks for big mana."),
        ("Enabler", "mana-dork", "Dorks for big mana."),
        ("Enabler", "land-ramp", "Land ramp into X."),
        ("Enabler", "ritual", "Ritual into X."),
        ("Synergy", "cost-reducer", "Reduce X costs."),
    ],
    "Sacrifice": [
        ("Core Mechanic", "synergy-sacrifice", "Sacrifice matters."),
        ("Core Mechanic", "sacrifice-outlet", "Sac outlets."),
        ("Core Mechanic", "free-sacrifice-outlet", "Free sac outlets."),
        ("Core Mechanic", "repeatable-sacrifice-outlet", "Repeatable sac."),
        ("Payoff", "death-trigger", "Death triggers."),
        ("Payoff", "drain-life", "Drain on sac/death."),
        ("Enabler", "martyr", "Self-sac creatures."),
        ("Enabler", "repeatable-creature-tokens", "Fodder."),
        ("Win Condition", "bombard", "Sac for damage."),
        ("Synergy", "plunder", "Sac for cards."),
    ],
    "Party": [
        ("Core Mechanic", "synergy-party", "Party matters (alias: typal-party)."),
        ("Core Mechanic", "affinity-for-party", "Affinity / cost care for party."),
        ("Core Mechanic", "multiclass-party-member", "Creatures that fill multiple party roles."),
        ("Payoff", "anthem", "Party-wide buffs."),
        ("Enabler", "tutor", "Assemble the party."),
        ("Synergy", "typal-creature", "Typal care overlapping party classes."),
    ],
    "Kindred / Typal Payoffs": [
        ("Core Mechanic", "typal-creature", "General creature-type matters."),
        ("Core Mechanic", "anthem", "Lords / anthems (alias: lord)."),
        ("Core Mechanic", "changeling", "All creature types."),
        ("Payoff", "warlord", "P/T = creature count."),
        ("Enabler", "tutor", "Fetch tribal pieces."),
        ("Synergy", "creaturefall", "ETB when creatures enter."),
        ("Synergy", "affinity-for-tokens", "Often overlaps go-wide tribal."),
    ],
    "Enchantments / Auras": [
        ("Core Mechanic", "synergy-enchantment", "Enchantment matters."),
        ("Core Mechanic", "synergy-aura", "Aura matters."),
        ("Core Mechanic", "enchantmentfall", "Constellation / enchantment ETB."),
        ("Payoff", "parasitic-aura", "Auras that harm the enchanted permanent's controller."),
        ("Payoff", "french-vanilla-aura", "Simple pump/keyword auras."),
        ("Enabler", "tutor-enchantment", "Enchantment tutors."),
        ("Enabler", "tutor-enchantment-aura", "Aura tutors."),
        ("Enabler", "tutor-aura-curse", "Curse tutors."),
        ("Synergy", "synergy-curse", "Curse synergies."),
        ("Synergy", "copy-aura", "Copy auras."),
        ("Protection", "protects-enchantment", "Protect enchantments."),
    ],
    "Doubling / Copy Effects": [
        ("Core Mechanic", "token-doubler", "Double tokens created."),
        ("Core Mechanic", "counter-increaser", "Increase counters placed."),
        ("Core Mechanic", "copy", "Copy effects."),
        ("Core Mechanic", "copy-token", "Copy tokens."),
        ("Payoff", "exponential", "Exponential growth effects."),
        ("Payoff", "mana-increaser", "Mana doubling."),
        ("Enabler", "copy-permanent", "Copy permanents."),
        ("Enabler", "copy-spell", "Copy spells."),
        ("Synergy", "synergy-token", "Token synergy with doublers."),
        ("Synergy", "counters-matter", "Counters matter with increasers."),
    ],
    "Monarch / Goad Politics": [
        ("Core Mechanic", "monarch-matters", "Cards that care about the monarch."),
        ("Core Mechanic", "synergy-goad", "Goad synergy."),
        ("Payoff", "group-slug", "Multiplayer pressure."),
        ("Payoff", "selective-group-hug", "Political hug."),
        ("Enabler", "threaten", "Temporary control / goad-adjacent."),
        ("Synergy", "pillowfort", "Stay safe while politics happen."),
        ("Synergy", "combat-arbiter", "Limit attacks/blocks."),
    ],
}

# Tribes — original 9 + pass-4 six
for creature, label in [
    ("dragon", "Tribal (Dragons)"),
    ("elf", "Tribal (Elves)"),
    ("goblin", "Tribal (Goblins)"),
    ("human", "Tribal (Humans)"),
    ("merfolk", "Tribal (Merfolk)"),
    ("sliver", "Tribal (Slivers)"),
    ("vampire", "Tribal (Vampires)"),
    ("wizard", "Tribal (Wizards)"),
    ("zombie", "Tribal (Zombies)"),
    ("angel", "Tribal (Angels)"),
    ("demon", "Tribal (Demons)"),
    ("cat", "Tribal (Cats)"),
    ("rat", "Tribal (Rats)"),
    ("pirate", "Tribal (Pirates)"),
    ("dinosaur", "Tribal (Dinosaurs)"),
]:
    ARCHETYPES[label] = tribe_rows(creature)


def build_rows(by_slug: dict, by_norm: dict) -> tuple[list[dict], dict]:
    out: list[dict] = []
    stats = Counter()
    skipped: dict[str, list[str]] = defaultdict(list)
    seen_per_arch: dict[str, set[str]] = defaultdict(set)

    for archetype, rows in ARCHETYPES.items():
        for category, tag, override in rows:
            status, resolved = resolve(tag, by_slug, by_norm)
            if status == "miss":
                stats["skipped_missing"] += 1
                skipped[archetype].append(tag)
                continue
            slug = resolved  # type: ignore[assignment]
            if slug in seen_per_arch[archetype]:
                stats["skipped_dup"] += 1
                continue
            seen_per_arch[archetype].add(slug)
            stats[status] += 1
            description = override or desc_of(by_slug, slug)
            if not description:
                description = desc_of(by_slug, slug) or f"Scryfall oracle tag `{slug}`."
            # Prefer Scryfall description when override empty; if override set, keep it
            if override:
                description = override
            else:
                description = desc_of(by_slug, slug) or f"Scryfall oracle tag `{slug}`."
            out.append(
                {
                    "Archetype Name": archetype,
                    "Scryfall Tagger Category": category,
                    "Exact Tagger Tag": slug,
                    "Scryfall Search Syntax": f"otag:{slug}",
                    "Tag Description": description,
                    "Tagging Count": tagging_count(by_slug, slug),
                    "Match Type": status,
                    "Requested Tag": tag if tag != slug else "",
                }
            )
    return out, {"stats": dict(stats), "skipped": dict(skipped)}


def write_csv(path: Path, rows: list[dict], fieldnames: Iterable[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(fieldnames))
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--oracle-tags", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, required=True)
    args = ap.parse_args()

    tags, by_slug, by_norm = load_tag_index(args.oracle_tags)
    rows, meta = build_rows(by_slug, by_norm)

    args.out_dir.mkdir(parents=True, exist_ok=True)

    sheet_fields = [
        "Archetype Name",
        "Scryfall Tagger Category",
        "Exact Tagger Tag",
        "Scryfall Search Syntax",
        "Tag Description",
    ]
    write_csv(args.out_dir / "archetype-scryfall-tags.csv", rows, sheet_fields)
    write_csv(
        args.out_dir / "archetype-scryfall-tags.enriched.csv",
        rows,
        sheet_fields + ["Tagging Count", "Match Type", "Requested Tag"],
    )

    # Per-archetype summary
    by_arch = Counter(r["Archetype Name"] for r in rows)
    summary = {
        "oracle_tag_count": len(tags),
        "archetype_count": len(by_arch),
        "row_count": len(rows),
        "build_stats": meta["stats"],
        "skipped_missing_tags": meta["skipped"],
        "rows_per_archetype": dict(sorted(by_arch.items(), key=lambda x: (-x[1], x[0]))),
        "unique_tags": len({r["Exact Tagger Tag"] for r in rows}),
    }
    (args.out_dir / "build-summary.json").write_text(json.dumps(summary, indent=2) + "\n")

    # Sanity: zero unresolved
    bad = [r for r in rows if resolve(r["Exact Tagger Tag"], by_slug, by_norm)[0] == "miss"]
    if bad:
        print(f"ERROR: {len(bad)} unresolved tags leaked into output", file=sys.stderr)
        return 1

    print(f"Wrote {len(rows)} rows across {len(by_arch)} archetypes → {args.out_dir}")
    print(f"Build stats: {meta['stats']}")
    skipped_n = sum(len(v) for v in meta["skipped"].values())
    if skipped_n:
        print(f"Skipped {skipped_n} missing candidate tags (see build-summary.json)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
