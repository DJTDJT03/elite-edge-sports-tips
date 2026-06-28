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
const wcSchedule = require('./wc2026Schedule');

// 2026 World Cup (48 teams) has 8 LMS rounds: 3 group matchdays + Round of 32
// + Round of 16 + Quarter-Final + Semi-Final + Final.
const WC_TOTAL_ROUNDS = 8;

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
    case 4: return 'Round of 32';
    case 5: return 'Round of 16';
    case 6: return 'Quarter-Final';
    case 7: return 'Semi-Final';
    case 8: return 'Final';
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

// Has the picked team's match for this round already kicked off? Uses the live
// feed's precise kickoff when available, otherwise the schedule's match date.
async function teamMatchStarted(round, team) {
  var fx = wcSchedule.fixtureForTeam(round, team);
  if (!fx) return { started: false };
  try {
    var kickoffs = await lmsStore.getWcKickoffs();
    var match = (kickoffs || []).find(function (k) {
      return (wcSchedule.teamsMatch(k.home_team, fx.home) && wcSchedule.teamsMatch(k.away_team, fx.away)) ||
             (wcSchedule.teamsMatch(k.home_team, fx.away) && wcSchedule.teamsMatch(k.away_team, fx.home));
    });
    if (match && match.kickoff) {
      return { started: Date.now() >= new Date(match.kickoff).getTime() };
    }
  } catch (e) { /* fall through to date check */ }
  // Fallback: block only once the match DATE has fully passed (day-granular)
  if (fx.date) {
    var today = new Date().toISOString().split('T')[0];
    if (fx.date < today) return { started: true };
  }
  return { started: false };
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

  // Pick deadline — you cannot pick/change to a team whose match has kicked off.
  if (competition.phase === 'world_cup') {
    var deadlineCheck = await teamMatchStarted(round, team);
    if (deadlineCheck.started) {
      return { ok: false, reason: team + "'s match has already kicked off — pick a team that hasn't started yet." };
    }
  }

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
async function resolveTeamResult(competition, round, team, finishedResults) {
  if (competition.phase === 'pl_rollover') {
    // PL fixtures aren't in the WC schedule — admin settles these for now.
    return { status: 'pending', fixtureId: null, detail: 'PL phase — awaiting admin settlement' };
  }

  // Find the team's fixture for this round from the CANONICAL schedule.
  var fx = wcSchedule.fixtureForTeam(round, team);
  if (!fx) return { status: 'pending', fixtureId: null, detail: 'No fixture for this team in ' + roundLabel(competition.phase, round) };
  if (wcSchedule.isPlaceholder(fx.home) || wcSchedule.isPlaceholder(fx.away)) {
    return { status: 'pending', fixtureId: null, detail: 'Knockout opponent not decided yet' };
  }

  // Resolve the actual result from the live feed, matched by team names.
  var results = finishedResults || (await lmsStore.getFinishedWcResults());
  var res = (results || []).find(function (r) {
    return (wcSchedule.teamsMatch(r.home_team, fx.home) && wcSchedule.teamsMatch(r.away_team, fx.away)) ||
           (wcSchedule.teamsMatch(r.home_team, fx.away) && wcSchedule.teamsMatch(r.away_team, fx.home));
  });
  if (!res) return { status: 'pending', fixtureId: null, detail: 'Result not in yet' };
  if (res.home_goals === null || res.away_goals === null) return { status: 'pending', fixtureId: null, detail: 'Score not in yet' };

  var teamIsHome = wcSchedule.teamsMatch(res.home_team, team);
  var gf = teamIsHome ? res.home_goals : res.away_goals;
  var ga = teamIsHome ? res.away_goals : res.home_goals;
  var group = isGroupRound(competition.phase, round);

  if (group) {
    // Group stage: 90-minute win required (a draw is out).
    if (gf > ga) return { status: 'won', detail: '90-min win' };
    return { status: 'lost', detail: gf === ga ? 'Draw — out' : 'Lost' };
  }
  // Knockout: team must advance. ET counts (in the goals); penalties leave the
  // score level and need admin confirmation of who went through.
  if (gf > ga) return { status: 'won', detail: 'Advanced' };
  if (gf === ga) return { status: 'pending', detail: 'Went to penalties — confirm who advanced' };
  return { status: 'lost', detail: 'Knocked out' };
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
  var nowTs = new Date().toISOString();
  // Fetch finished results once for this settlement pass.
  var finishedResults = await lmsStore.getFinishedWcResults();

  var aliveEntries = await lmsStore.getEntriesForCompetition(competition.id, 'alive');
  if (aliveEntries.length === 0) {
    return { competitionId: competition.id, round: round, settled: 0, message: 'No active entries' };
  }

  // ---- Phase A: progressive per-match settlement --------------------------
  // Resolve every alive entry whose pick's match has FINISHED, the moment it
  // finishes — losers are eliminated straight away rather than waiting for the
  // rest of the round. Picks whose match is still in progress stay pending.
  var resolvedNow = 0, eliminatedNow = 0;
  for (var i = 0; i < aliveEntries.length; i++) {
    var entry = aliveEntries[i];
    var pick = await lmsStore.getPick(entry.id, round);
    if (!pick || pick.result !== 'pending') continue; // no pick yet / already settled
    var res = await resolveTeamResult(competition, round, pick.team, finishedResults);
    if (res.status === 'pending' && !opts.force) continue; // match not finished (or penalties)
    var finalStatus = res.status === 'pending' ? 'lost' : res.status; // force => lost
    await lmsStore.updatePick(pick.id, { result: finalStatus, fixtureId: res.fixtureId || null, settledAt: nowTs });
    resolvedNow++;
    if (finalStatus !== 'won') {
      await lmsStore.updateEntry(entry.id, { status: 'out', eliminatedRound: round });
      eliminatedNow++;
    }
  }

  // ---- Is the whole round complete? ---------------------------------------
  // Complete when every fixture in the round has a finished result. Knockout
  // placeholders (opponent undecided) mean the round isn't ready.
  var roundComplete = opts.force === true;
  if (!roundComplete) {
    if (competition.phase === 'world_cup' && lmsStore.getWcRoundFixtures) {
      // Use the ACTUALLY-SYNCED matchday fixtures (deduplicated by SportMonks
      // round_name), NOT the hardcoded schedule. The hardcoded MATCHDAY list had
      // double-booked teams (a side appearing in two matchday-2 fixtures), which
      // could never match a real result — so the round-complete check could
      // never pass and the round froze indefinitely.
      var dbFx = await lmsStore.getWcRoundFixtures(round);
      var realFx = (dbFx || []).filter(function (fx) {
        return !wcSchedule.isPlaceholder(fx.home_team) && !wcSchedule.isPlaceholder(fx.away_team);
      });
      roundComplete = realFx.length > 0 && realFx.every(function (fx) { return fx.status === 'finished'; });
    } else {
      var roundFx = wcSchedule.roundFixtures(round) || [];
      roundComplete = roundFx.length > 0 && roundFx.every(function (fx) {
        if (wcSchedule.isPlaceholder(fx.home) || wcSchedule.isPlaceholder(fx.away)) return false;
        var r = (finishedResults || []).find(function (x) {
          return (wcSchedule.teamsMatch(x.home_team, fx.home) && wcSchedule.teamsMatch(x.away_team, fx.away)) ||
                 (wcSchedule.teamsMatch(x.home_team, fx.away) && wcSchedule.teamsMatch(x.away_team, fx.home));
        });
        return r && r.home_goals !== null && r.away_goals !== null;
      });
    }
  }

  if (!roundComplete) {
    // Round still in progress — finished picks are settled, the rest stay live.
    return {
      competitionId: competition.id, round: round,
      roundLabel: roundLabel(competition.phase, round),
      settled: resolvedNow, eliminated: eliminatedNow, held: true,
      message: resolvedNow > 0
        ? 'Settled ' + resolvedNow + ' finished pick(s) — ' + eliminatedNow + ' out. Round still in progress.'
        : 'Round in progress — no new results yet.',
    };
  }

  // ---- Phase B: round complete — finalise no-picks, rollover, winner, advance
  // Any still-alive entry with no pick (or an unresolved pick on a forced
  // settle) missed the round → eliminated.
  var remainingAlive = await lmsStore.getEntriesForCompetition(competition.id, 'alive');
  for (var n = 0; n < remainingAlive.length; n++) {
    var rp = await lmsStore.getPick(remainingAlive[n].id, round);
    if (!rp) {
      await lmsStore.updateEntry(remainingAlive[n].id, { status: 'out', eliminatedRound: round });
      eliminatedNow++;
    } else if (rp.result === 'pending') {
      await lmsStore.updatePick(rp.id, { result: 'lost', settledAt: nowTs });
      await lmsStore.updateEntry(remainingAlive[n].id, { status: 'out', eliminatedRound: round });
      eliminatedNow++;
    }
  }

  // Rollover: nobody survived this round → reinstate everyone who went out in it
  // (eliminations may have happened across several progressive passes, so judge
  // by who is eliminated-this-round, not by this pass's counts).
  var survivorsAlive = await lmsStore.getEntriesForCompetition(competition.id, 'alive');
  var outThisRound = (await lmsStore.getEntriesForCompetition(competition.id, 'out'))
    .filter(function (e) { return e.eliminatedRound === round; });
  var rollover = false;
  if (survivorsAlive.length === 0 && outThisRound.length > 0) {
    rollover = true;
    for (var k = 0; k < outThisRound.length; k++) {
      // keep them alive; their losing pick stays on record (team stays "used")
      await lmsStore.updateEntry(outThisRound[k].id, { status: 'alive', eliminatedRound: null });
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
      cfg.rollovers = (cfg.rollovers || []).concat([{ round: round, reinstated: aliveAfter, at: nowTs }]);
      compUpdate.config = cfg;
    }
  }
  await lmsStore.updateCompetition(competition.id, compUpdate);

  var survivedCount = rollover ? aliveAfter : aliveAfter;
  return {
    competitionId: competition.id,
    round: round,
    roundLabel: roundLabel(competition.phase, round),
    settled: resolvedNow,
    survived: survivedCount,
    eliminated: rollover ? 0 : eliminatedNow,
    rollover: rollover,
    completed: completed,
    championEntryIds: championEntryIds,
    nextRound: completed ? null : nextRound,
    message: rollover
      ? 'Rollover — everyone was eliminated, all reinstated for ' + roundLabel(competition.phase, nextRound)
      : completed
        ? (championEntryIds.length > 1 ? championEntryIds.length + ' winners share the pot' : 'We have a winner!')
        : survivedCount + ' through, ' + eliminatedNow + ' out — on to ' + roundLabel(competition.phase, nextRound),
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

// ---------------------------------------------------------------------------
// Banner / branding — data-driven so it can be re-skinned without a deploy.
// Phase defaults are overridden by anything in competition.config.banner, so
// the dashboard banner follows whatever competition is live (World Cup now,
// Premier League rollover later) and carries the live prize pot.
// ---------------------------------------------------------------------------
function bannerConfig(competition) {
  if (!competition) return null;
  var defaults = competition.phase === 'pl_rollover'
    ? { eyebrow: 'Premier League', title: 'LAST MAN STANDING', tagline: 'One pick a week. Survive the season. Win the pot.', emoji: '⚽', accent: '#d4a843', cta: 'Play Now' }
    : { eyebrow: 'World Cup 2026', title: 'LAST MAN STANDING', tagline: 'One pick. One life. Free to enter — survive to win the pot.', emoji: '🏆', accent: '#d4a843', cta: 'Play Now' };
  var custom = (competition.config && competition.config.banner) || {};
  return Object.assign(defaults, custom);
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
  bannerConfig,
};
