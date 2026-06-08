/**
 * Elite Edge Sports Tips — Last Man Standing game engine
 *
 * Pure game logic on top of lmsStore. Pluggable, feature-flagged (ENABLE_LMS),
 * never touches core tipping code.
 *
 * Rules (confirmed 26 May 2026):
 *  - One pick per round. A team can't be reused unless an extra team is bought.
 *  - World Cup group stage: 90 minutes only — a draw means you're out.
 *  - World Cup knockouts: extra time + penalties count (the team must advance).
 *  - No pick made for a round = automatic elimination.
 *  - Rollover: if everyone still alive is eliminated in the same round, all of
 *    them are reinstated and the competition rolls over to the next round.
 *  - PL rollover phase: World Cup survivors continue; same rules; 90 mins only.
 *
 * Settlement reads finished results from the World Cup Mode fixtures table. PL
 * phase fixtures aren't in that table yet, so PL rounds are settled by the
 * admin (manual settle is always available) until the PL data source is wired.
 */

const lmsStore = require('../db/lmsStore');

// World Cup has 7 LMS rounds: 3 group matchdays + R16 + QF + SF + Final.
const WC_TOTAL_ROUNDS = 7;

function isGroupRound(phase, round) {
  // World Cup: rounds 1-3 are group matchdays. PL: every round is a league GW
  // (treated as "group-style" — 90 minutes, win required).
  if (phase === 'pl_rollover') return true;
  return round <= 3;
}

// Human label for a round (used by UI)
function roundLabel(phase, round) {
  if (phase === 'pl_rollover') return 'Gameweek ' + round;
  switch (round) {
    case 1: return 'Group Matchday 1';
    case 2: return 'Group Matchday 2';
    case 3: return 'Group Matchday 3';
    case 4: return 'Round of 16';
    case 5: return 'Quarter-Final';
    case 6: return 'Semi-Final';
    case 7: return 'Final';
    default: return 'Round ' + round;
  }
}

// ---------------------------------------------------------------------------
// Pick validation + placement
// ---------------------------------------------------------------------------
async function getEntryState(competition, userId) {
  var entry = await lmsStore.getEntry(competition.id, userId);
  if (!entry) return null;
  var allPicks = await lmsStore.getPicksForEntry(entry.id);
  var currentPick = allPicks.find(function (p) { return p.round === competition.currentRound; }) || null;
  // Teams "used" by picks in OTHER rounds (a team becomes locked once committed
  // to a prior/other round). The current round's own pick doesn't lock the team
  // against itself, so the user can freely switch back to it before settlement.
  var usedTeams = allPicks
    .filter(function (p) { return p.result !== 'void' && p.round !== competition.currentRound; })
    .map(function (p) { return p.team; });
  return { entry: entry, usedTeams: usedTeams, currentPick: currentPick };
}

/**
 * Validate a proposed pick. Returns { ok, reason, isReuse }.
 * isReuse=true means the user is reusing a team and must (and can) spend a
 * purchased extra-team allowance.
 */
function validatePick(entry, usedTeams, team) {
  if (!team || typeof team !== 'string') return { ok: false, reason: 'No team selected' };
  if (entry.status !== 'alive') return { ok: false, reason: 'Your entry is no longer active' };

  var alreadyUsed = usedTeams.indexOf(team) !== -1;
  if (!alreadyUsed) return { ok: true, isReuse: false };

  // Reuse path — needs an unused purchased allowance
  var allowancesLeft = (entry.extraTeams || 0) - (entry.reusesUsed || 0);
  if (allowancesLeft <= 0) {
    return { ok: false, reason: 'You have already used ' + team + '. Buy an extra team to pick them again.' };
  }
  return { ok: true, isReuse: true };
}

/**
 * Place or change a pick for the competition's current round.
 * Picks lock once the round is settled; before that they can be changed.
 */
async function makePick(competition, userId, team) {
  var state = await getEntryState(competition, userId);
  if (!state) return { ok: false, reason: 'You have not joined this competition' };

  var round = competition.currentRound;
  // usedTeams already excludes the current round's own pick (see getEntryState).
  var v = validatePick(state.entry, state.usedTeams, team);
  if (!v.ok) return v;

  if (state.currentPick) {
    // Changing an existing (unsettled) pick
    if (state.currentPick.result !== 'pending') return { ok: false, reason: 'This round is already settled' };
    // If reuse status changed, adjust the allowance counter
    if (v.isReuse && !state.currentPick.isReuse) {
      await lmsStore.updateEntry(state.entry.id, { reusesUsed: (state.entry.reusesUsed || 0) + 1 });
    } else if (!v.isReuse && state.currentPick.isReuse) {
      await lmsStore.updateEntry(state.entry.id, { reusesUsed: Math.max(0, (state.entry.reusesUsed || 0) - 1) });
    }
    var updated = await lmsStore.updatePick(state.currentPick.id, { team: team, isReuse: v.isReuse });
    return { ok: true, pick: updated, changed: true };
  }

  // New pick
  if (v.isReuse) {
    await lmsStore.updateEntry(state.entry.id, { reusesUsed: (state.entry.reusesUsed || 0) + 1 });
  }
  var pick = await lmsStore.createPick({
    competitionId: competition.id, entryId: state.entry.id, userId: userId,
    round: round, team: team, isReuse: v.isReuse,
  });
  return { ok: true, pick: pick, changed: false };
}

// ---------------------------------------------------------------------------
// Result resolution
// ---------------------------------------------------------------------------
/**
 * Resolve the outcome of a team for a given LMS round from live fixture data.
 * Returns { status: 'won'|'lost'|'pending', fixtureId, detail }.
 *   - 'pending' means not finished yet, OR a knockout that went to penalties
 *     (goals level) which needs admin confirmation of who advanced.
 */
async function resolveTeamResult(competition, round, team) {
  if (competition.phase === 'pl_rollover') {
    // PL fixtures aren't in the WC table — admin settles these for now.
    return { status: 'pending', fixtureId: null, detail: 'PL phase — awaiting admin settlement' };
  }

  var group = isGroupRound(competition.phase, round);
  var index = group ? (round - 1) : (round - 4); // 0-based within group/knockout sets
  var fixture = await lmsStore.getWcFixtureByKickoffIndex(team, group, index);

  if (!fixture) return { status: 'pending', fixtureId: null, detail: 'No fixture found yet' };
  if (fixture.status !== 'finished') return { status: 'pending', fixtureId: fixture.id, detail: 'Fixture not finished' };

  var teamIsHome = fixture.home_team === team;
  var side = teamIsHome ? 'home' : 'away';

  if (group) {
    // Group stage / PL: 90-minute win required (the stored result is the 90-min result).
    if (fixture.result === side) return { status: 'won', fixtureId: fixture.id, detail: '90-min win' };
    return { status: 'lost', fixtureId: fixture.id, detail: fixture.result === 'draw' ? 'Draw — out' : 'Lost' };
  }

  // Knockout: team must advance. ET counts via the stored result; penalties
  // leave goals level (result 'draw') and need admin confirmation.
  if (fixture.result === side) return { status: 'won', fixtureId: fixture.id, detail: 'Advanced (incl. ET)' };
  if (fixture.result === 'draw') return { status: 'pending', fixtureId: fixture.id, detail: 'Went to penalties — confirm who advanced' };
  return { status: 'lost', fixtureId: fixture.id, detail: 'Knocked out' };
}

// ---------------------------------------------------------------------------
// Round settlement (+ rollover + winner detection)
// ---------------------------------------------------------------------------
/**
 * Settle the current round of a competition.
 *  - Alive entries with no pick are eliminated.
 *  - Each pick is resolved; losers are eliminated.
 *  - If a knockout pick is pending on penalties, the whole round is held
 *    (returns held=true) so the admin can confirm — nothing is finalised.
 *  - Rollover: if everyone alive is eliminated this round, all are reinstated
 *    and the round advances.
 *  - Winner: if exactly one entry remains (or the final settles), it's marked.
 *
 * Returns a settlement report.
 */
async function settleRound(competition, opts) {
  opts = opts || {};
  var round = competition.currentRound;
  var aliveEntries = await lmsStore.getEntriesForCompetition(competition.id, 'alive');
  if (aliveEntries.length === 0) {
    return { competitionId: competition.id, round: round, settled: 0, message: 'No active entries' };
  }

  // First pass: resolve every alive entry's outcome for this round
  var outcomes = [];
  var heldOnPenalties = [];
  for (var i = 0; i < aliveEntries.length; i++) {
    var entry = aliveEntries[i];
    var pick = await lmsStore.getPick(entry.id, round);
    if (!pick) {
      outcomes.push({ entry: entry, pick: null, status: 'lost', detail: 'No pick made' });
      continue;
    }
    if (pick.result !== 'pending') {
      outcomes.push({ entry: entry, pick: pick, status: pick.result, detail: 'Already settled' });
      continue;
    }
    var res = await resolveTeamResult(competition, round, pick.team);
    if (res.status === 'pending') {
      // Not ready (fixture unfinished or penalties). Hold unless forced by admin.
      if (!opts.force) heldOnPenalties.push({ entry: entry, pick: pick, detail: res.detail });
      outcomes.push({ entry: entry, pick: pick, status: 'pending', detail: res.detail, fixtureId: res.fixtureId });
      continue;
    }
    outcomes.push({ entry: entry, pick: pick, status: res.status, detail: res.detail, fixtureId: res.fixtureId });
  }

  // If any pick is still genuinely pending (fixture not finished), hold the
  // round so we don't eliminate someone whose match hasn't been played.
  var stillPending = outcomes.filter(function (o) { return o.status === 'pending'; });
  if (stillPending.length > 0 && !opts.force) {
    return {
      competitionId: competition.id, round: round, settled: 0, held: true,
      pending: stillPending.length,
      penalties: heldOnPenalties.length,
      message: 'Round held — ' + stillPending.length + ' pick(s) not resolved yet (incl. ' + heldOnPenalties.length + ' on penalties). Settle again when finished, or use admin override.',
    };
  }

  // Finalise outcomes
  var winners = [], losers = [], nowTs = new Date().toISOString();
  for (var j = 0; j < outcomes.length; j++) {
    var o = outcomes[j];
    var finalStatus = o.status === 'pending' ? 'lost' : o.status; // forced: treat unresolved as lost
    if (o.pick) {
      await lmsStore.updatePick(o.pick.id, { result: finalStatus, fixtureId: o.fixtureId || null, settledAt: nowTs });
    }
    if (finalStatus === 'won') winners.push(o.entry);
    else losers.push(o.entry);
  }

  // Rollover: everyone alive went out this round → reinstate them all.
  var rollover = false;
  if (winners.length === 0 && losers.length > 0) {
    rollover = true;
    for (var k = 0; k < losers.length; k++) {
      // keep them alive; their losing pick stays on record (team stays "used")
      await lmsStore.updateEntry(losers[k].id, { status: 'alive', eliminatedRound: null });
    }
  } else {
    // Normal: eliminate losers, survivors stay alive
    for (var m = 0; m < losers.length; m++) {
      await lmsStore.updateEntry(losers[m].id, { status: 'out', eliminatedRound: round });
    }
  }

  // Winner detection
  var aliveAfter = await lmsStore.countAlive(competition.id);
  var isFinalRound = (competition.phase === 'world_cup' && round >= WC_TOTAL_ROUNDS);
  var completed = false, championEntryIds = [];

  if (!rollover && aliveAfter === 1) {
    completed = true;
    var survivors = await lmsStore.getEntriesForCompetition(competition.id, 'alive');
    for (var s = 0; s < survivors.length; s++) {
      await lmsStore.updateEntry(survivors[s].id, { status: 'winner' });
      championEntryIds.push(survivors[s].id);
    }
  } else if (!rollover && isFinalRound && aliveAfter >= 1) {
    // Final played and people still alive → they share the pot
    completed = true;
    var champs = await lmsStore.getEntriesForCompetition(competition.id, 'alive');
    for (var c = 0; c < champs.length; c++) {
      await lmsStore.updateEntry(champs[c].id, { status: 'winner' });
      championEntryIds.push(champs[c].id);
    }
  }

  // Advance / complete the competition
  var nextRound = round + 1;
  var compUpdate = {};
  if (completed) {
    compUpdate.status = 'completed';
  } else {
    compUpdate.currentRound = nextRound;
    compUpdate.status = 'active';
    if (rollover) {
      var cfg = competition.config || {};
      cfg.rollovers = (cfg.rollovers || []).concat([{ round: round, reinstated: losers.length, at: nowTs }]);
      compUpdate.config = cfg;
    }
  }
  await lmsStore.updateCompetition(competition.id, compUpdate);

  return {
    competitionId: competition.id,
    round: round,
    roundLabel: roundLabel(competition.phase, round),
    settled: outcomes.length,
    survived: winners.length,
    eliminated: rollover ? 0 : losers.length,
    rollover: rollover,
    completed: completed,
    championEntryIds: championEntryIds,
    nextRound: completed ? null : nextRound,
    message: rollover
      ? 'Rollover — everyone was eliminated, all reinstated for ' + roundLabel(competition.phase, nextRound)
      : completed
        ? (championEntryIds.length > 1 ? championEntryIds.length + ' winners share the pot' : 'We have a winner!')
        : winners.length + ' through, ' + losers.length + ' out — on to ' + roundLabel(competition.phase, nextRound),
  };
}

// ---------------------------------------------------------------------------
// Prize pot
// ---------------------------------------------------------------------------
function potTotal(competition) {
  return (parseFloat(competition.prizePot) || 0);
}

// ---------------------------------------------------------------------------
// Extra-team purchases (£10, max 2) are only offered in a rollover situation —
// the PL rollover phase, or once a competition has rolled over (everyone
// knocked out the same round and reinstated), where the team pool gets tight.
// Entry itself is always free for subscribers.
// ---------------------------------------------------------------------------
function extraTeamsAllowed(competition) {
  if (!competition) return false;
  if (competition.phase === 'pl_rollover') return true;
  var rollovers = (competition.config && competition.config.rollovers) || [];
  return rollovers.length > 0;
}

module.exports = {
  WC_TOTAL_ROUNDS,
  MAX_EXTRA_TEAMS: 2,
  isGroupRound,
  roundLabel,
  getEntryState,
  validatePick,
  makePick,
  resolveTeamResult,
  settleRound,
  potTotal,
  extraTeamsAllowed,
};
