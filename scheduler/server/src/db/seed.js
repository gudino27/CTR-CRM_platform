/**
 * The four platforms and their starting post types and schedules, put in at every start
 * (index.js) and by `npm run seed`. Each step only adds what is missing, so a database
 * someone has already changed in the app keeps those changes.
 *
 * What lives here:
 *   platforms         the starting data: name, posting days and times, Google Calendar colorId,
 *                     character limit, whether it uses Blue/Purple, post types (and LinkedIn's order)
 *   seed              puts it in
 *   linkedInPattern   one-time switch 
 *   startingSchedules one-time switch
 *                     databases whose schedule nobody has changed yet
 *   linkedInAlternatingWeeks  one-time switch of LinkedIn to Mon/Wed/Fri and Tue/Thu weeks in turn
 *   alternatingSequences      splits one post type order over rules that take turns by week
 */
import { openDb } from './index.js';
import { syncPlatform } from '../services/sync.js';

// Starting days and times, in New York time (TIMEZONE): Facebook Monday
// and Friday 1:00 PM, Instagram Monday and Friday 2:00 PM, LinkedIn 12:00 PM on its earlier days
//  Older databases get them through startingSchedules.
const platforms = [
  { key: 'facebook',  name: 'Facebook',  days: ['MON', 'FRI'],        times: ['13:00'], color: '9', limit: 63206,
    usesColors: true, types: ['Reminder', 'Quote / Article', 'Student Quote'] },
  { key: 'instagram', name: 'Instagram', days: ['MON', 'FRI'],        times: ['14:00'], color: '3', limit: 2200,
    usesColors: true, types: ['Conversation Starter', 'Student Quote', 'Mission Post'] },
  { key: 'linkedin',  name: 'LinkedIn',  days: ['TUE', 'THU'],        times: ['12:00'], color: '7', limit: 3000,
    usesColors: false, types: ['C2R Newsletter Article', 'About Us', '3rd Party News'],
    // LinkedIn order: a newsletter article every other post, About Us and 3rd party news between
    sequence: ['C2R Newsletter Article', 'About Us', 'C2R Newsletter Article', '3rd Party News'] },
  { key: 'test',      name: 'Test',      days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], times: ['12:00'], color: '8', limit: 5000, isTest: true,
    usesColors: true, types: ['Type A', 'Type B', 'Type C'] },
];

/**
 * Puts the starting platforms, post types and schedule rules into a database that lacks them.
 *
 * Usage:
 *   await seed(db);   (index.js, at every start)
 *
 * Takes:
 *   db - the open, migrated database
 *
 * How it works:
 *   1. Inserts each platform unless its key exists (ON CONFLICT DO NOTHING).
 *   2. Post types and colors are seeded once per platform (only when it has no post types), so a
 *      database from before them gets them too.
 *   3. Every platform gets a Holiday type: Specific Date only, so it stays out of the rotation.
 *   4. Library posts from before post types existed get the platform's first rotation type, and
 *      Blue where colors apply.
 *   5. Platforms added after migration 004 get their first schedule the same way migrated ones
 *      did: one weekly rule per posting time, cycling the rotation types (or the platform's own
 *      type sequence, like LinkedIn's, when it has one).
 *   6. linkedInPattern, then startingSchedules, then linkedInAlternatingWeeks. A new database
 *      gets LinkedIn's alternating weeks the same way an existing one does.
 *
 * When editing:
 *   Changing the platforms list only affects new databases (or platforms not there yet); an
 *   existing platform's settings are changed on the Platforms page. Every query must run on both
 *   SQLite and MariaDB ("key" is quoted because it is a reserved word in MariaDB).
 */
export async function seed(db) {
  for (const [i, p] of platforms.entries()) {
    await db.run(`
      INSERT INTO platform ("key", name, isTest, postingDays, postingTimes, calendarColorId, charLimit, sortOrder, usesColors)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT ("key") DO NOTHING`,
    [p.key, p.name, p.isTest ? 1 : 0, JSON.stringify(p.days), JSON.stringify(p.times), p.color, p.limit, i, p.usesColors ? 1 : 0]);
  }

  const platformId = async (key) => (await db.get('SELECT id FROM platform WHERE "key" = ?', [key])).id;
  for (const p of platforms) {
    const id = await platformId(p.key);
    if (await db.get('SELECT 1 FROM postType WHERE platformId = ?', [id])) continue;
    await db.run('UPDATE platform SET usesColors = ? WHERE id = ?', [p.usesColors ? 1 : 0, id]);
    for (const [i, name] of p.types.entries()) {
      await db.run('INSERT INTO postType (platformId, name, sortOrder) VALUES (?, ?, ?)', [id, name, i]);
    }
  }

  for (const p of platforms) {
    const id = await platformId(p.key);
    if (!(await db.get("SELECT 1 FROM postType WHERE platformId = ? AND name = 'Holiday'", [id]))) {
      await db.run("INSERT INTO postType (platformId, name, sortOrder, inRotation) VALUES (?, 'Holiday', 99, 0)", [id]);
    }
  }

  await db.exec(`
    UPDATE post SET
      postTypeId = (SELECT id FROM postType WHERE platformId = post.platformId AND inRotation = 1 ORDER BY sortOrder, id LIMIT 1),
      color = CASE WHEN (SELECT usesColors FROM platform WHERE id = post.platformId) THEN 'Blue' END
    WHERE kind = 'library' AND postTypeId IS NULL`);

  const withoutRules = await db.all(`SELECT * FROM platform
                                     WHERE NOT EXISTS (SELECT 1 FROM scheduleRule WHERE platformId = platform.id)`);
  for (const row of withoutRules) {
    const days = JSON.parse(row.postingDays);
    const byDay = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].filter((d) => days.includes(d)).map((d) => d.slice(0, 2)).join(',');
    if (!byDay) continue;
    const sequence = (await typeIdsByName(db, row.id, platforms.find((p) => p.key === row.key)?.sequence ?? [])) ?? [];
    for (const [i, time] of JSON.parse(row.postingTimes).entries()) {
      await db.run(`INSERT INTO scheduleRule (platformId, byDay, time, startDate, sortOrder, postTypeIds)
                    VALUES (?, ?, ?, '2026-01-01', ?, ?)`, [row.id, byDay, time, i, JSON.stringify(sequence)]);
    }
  }

  await linkedInPattern(db);
  await startingSchedules(db);
  await linkedInAlternatingWeeks(db);
}

/**
 * The rotation post type ids for those names, in that order.
 *
 * Usage:
 *   await typeIdsByName(db, platformId, ['About Us', '3rd Party News'])   // [12, 14]
 *
 * Returns:
 *   The ids, or null when one of the names is not a rotation type on the platform.
 */
async function typeIdsByName(db, platformId, names) {
  const ids = [];
  for (const name of names) {
    const row = await db.get('SELECT id FROM postType WHERE platformId = ? AND name = ? AND inRotation = 1 ORDER BY id LIMIT 1', [platformId, name]);
    if (!row) return null;
    ids.push(row.id);
  }
  return ids;
}

const LINKEDIN_PATTERN_FLAG = 'linkedinPattern2026Nov';
const LINKEDIN_OLD_NAMES = { 'C2R Newsletter Article': 'Newsletter', '3rd Party News': 'Article' };

/**
 * The type ids for the LinkedIn sequence, finding each type by its current name or its old
 * name (Newsletter, Article).
 *
 * Usage:
 *   const { ids, missing } = await linkedInSequence(tx, platformId, linkedIn.sequence);
 *
 * Returns:
 *   { ids } in sequence order, or { missing } naming the types that could not be found.
 */
async function linkedInSequence(db, platformId, names) {
  const ids = [];
  const missing = [];
  for (const name of names) {
    let row = null;
    for (const candidate of [name, LINKEDIN_OLD_NAMES[name]].filter(Boolean)) {
      row = await db.get('SELECT id FROM postType WHERE platformId = ? AND name = ? AND inRotation = 1 ORDER BY id LIMIT 1',
        [platformId, candidate]);
      if (row) break;
    }
    if (row) ids.push(row.id);
    else if (!missing.includes(name)) missing.push(name);
  }
  return missing.length ? { missing } : { ids };
}

/**
 * Databases seeded before the LinkedIn order existed get it once. It lives here rather
 * than in a migration because the rule's sequence is JSON of type ids found by name.
 *
 * Usage:
 *   await linkedInPattern(db);   (end of seed)
 *
 * How it works:
 *   Only LinkedIn changes, in one transaction:
 *   - "Newsletter" becomes "C2R Newsletter Article" and "Article" becomes "3rd Party News", only
 *     while the old name is still there and the new one isn't (a name someone chose is kept).
 *     The ids stay, so posts keep their type.
 *   - The rotation order becomes C2R Newsletter Article, About Us, 3rd Party News.
 *   - Rules still following the rotation (empty postTypeIds) get the four-step order; rules with
 *     their own order are left alone.
 *   Then the future unlocked slots are regenerated, as after a rule change on the Platforms page;
 *   past, locked and pinned slots stay as they are.
 *
 * When editing:
 *   The appSetting flag (LINKEDIN_PATTERN_FLAG) is "pending" until that regeneration has worked,
 *   so a failed one is retried on the next start, and "done" after. If a type still can't be
 *   found (someone renamed it before this ran), the log says which, the flag stays "pending" and
 *   the next start tries again, once the name is fixed.
 */
async function linkedInPattern(db) {
  const flag = await db.get('SELECT value FROM appSetting WHERE "key" = ?', [LINKEDIN_PATTERN_FLAG]);
  if (flag?.value === 'done') return;
  const linkedIn = platforms.find((p) => p.key === 'linkedin');
  const row = await db.get('SELECT id FROM platform WHERE "key" = ?', ['linkedin']);

  const changed = row && await db.transaction(async (tx) => {
    let changes = 0;
    for (const [oldName, newName] of [['Newsletter', 'C2R Newsletter Article'], ['Article', '3rd Party News']]) {
      if (await tx.get('SELECT 1 FROM postType WHERE platformId = ? AND name = ?', [row.id, newName])) continue;
      changes += (await tx.run('UPDATE postType SET name = ? WHERE platformId = ? AND name = ?', [newName, row.id, oldName])).changes;
    }
    for (const [i, name] of linkedIn.types.entries()) {
      changes += (await tx.run('UPDATE postType SET sortOrder = ? WHERE platformId = ? AND name = ? AND inRotation = 1 AND sortOrder <> ?',
        [i, row.id, name, i])).changes;
    }
    const sequence = await linkedInSequence(tx, row.id, linkedIn.sequence);
    if (sequence.ids) {
      changes += (await tx.run(`UPDATE scheduleRule SET postTypeIds = ? WHERE platformId = ? AND REPLACE(postTypeIds, ' ', '') = '[]'`,
        [JSON.stringify(sequence.ids), row.id])).changes;
    }
    if (changes > 0 || flag || sequence.missing) {
      await tx.run('DELETE FROM appSetting WHERE "key" = ?', [LINKEDIN_PATTERN_FLAG]);
      await tx.run("INSERT INTO appSetting (\"key\", value) VALUES (?, 'pending')", [LINKEDIN_PATTERN_FLAG]);
    }
    return { regenerate: changes > 0 || Boolean(flag), missing: sequence.missing };
  });
  if (changed?.missing) {
    // Left "pending": the slots are regenerated once the order can be set, on a later start
    const named = changed.missing.map((n) => (LINKEDIN_OLD_NAMES[n] ? `"${n}" (or its old name "${LINKEDIN_OLD_NAMES[n]}")` : `"${n}"`));
    console.warn(`LinkedIn post order not set yet: no LinkedIn post type in the rotation is named ${named.join(', ')}.`
      + ' Give the type that name on the Platforms page; the order is set on the next start.');
    return;
  }
  if (changed?.regenerate) await syncPlatform(db, row.id, { regenerate: true });
  await db.run('DELETE FROM appSetting WHERE "key" = ?', [LINKEDIN_PATTERN_FLAG]);
  await db.run("INSERT INTO appSetting (\"key\", value) VALUES (?, 'done')", [LINKEDIN_PATTERN_FLAG]);
}

const STARTING_SCHEDULES_FLAG = 'startingSchedules2026Nov';
// The one weekly rule each platform was seeded with originally ("from"), and
// starting schedule ("to"). LinkedIn's days and time are unchanged.
const STARTING_SCHEDULES = [
  { key: 'facebook',  from: { byDay: 'MO,WE,FR', time: '10:00' }, to: { byDay: 'MO,FR', time: '13:00' } },
  { key: 'instagram', from: { byDay: 'TU,TH', time: '11:00' },    to: { byDay: 'MO,FR', time: '14:00' } },
  { key: 'linkedin',  from: { byDay: 'TU,TH', time: '12:00' },    to: { byDay: 'TU,TH', time: '12:00' } },
];

/**
 * The platform's only active schedule rule when it is still a plain weekly rule on those days at
 * that time, as seeded; null when the platform has any other set of active rules.
 *
 * Usage:
 *   const rule = await plainRule(tx, platformId, { byDay: 'MO,WE,FR', time: '10:00' });
 *
 * Takes:
 *   db         - the database or a transaction
 *   platformId - the platform's id
 *   schedule   - { byDay, time } as stored on scheduleRule ("MO,FR", "13:00")
 *
 * Returns:
 *   The scheduleRule row, or null.
 *
 * How it works:
 *   Reads the active rules; there must be exactly one, every week (intervalWeeks 1), starting on
 *   the seeded startDate 2026-01-01 with no endDate, on exactly those days and at that time.
 *   Its post type sequence is not compared: only the days and time are changed.
 */
async function plainRule(db, platformId, { byDay, time }) {
  const rules = await db.all('SELECT * FROM scheduleRule WHERE platformId = ? AND active = 1', [platformId]);
  if (rules.length !== 1) return null;
  const [rule] = rules;
  const same = rule.byDay.replace(/\s/g, '') === byDay && rule.time === time && Number(rule.intervalWeeks) === 1
    && rule.startDate === '2026-01-01' && !rule.endDate;
  return same ? rule : null;
}

/**
 * Databases seeded before the starting schedules existed get them once, but only on a
 * platform whose schedule is still exactly what the old seed made. New databases get them from
 * the platforms list above.
 *
 * Usage:
 *   await startingSchedules(db);   (end of seed)
 *
 * How it works:
 *   1. Stops when the appSetting flag (STARTING_SCHEDULES_FLAG) is "done".
 *   2. In one transaction, for each platform in STARTING_SCHEDULES whose schedule changes (not
 *      LinkedIn, whose "from" and "to" are the same):
 *      - already on the new schedule (a new database, or a retry): nothing to change;
 *      - exactly one active rule equal to the old seed default: that rule gets the new days and
 *        time (its id, start date and post type sequence stay), and the platform's old
 *        postingDays/postingTimes columns are set to match;
 *      - anything else: left alone, and the log says it was skipped because someone already
 *        changed that platform's schedule.
 *      The flag is set to "pending" in the same transaction when a rule changed.
 *   3. Regenerates the future unlocked slots of each platform on the new schedule, as after a rule
 *      change on the Platforms page: posts in slots that go away return to the library and fill
 *      the next matching slots; past, locked and pinned slots stay as they are.
 *   4. Sets the flag to "done".
 *
 * When editing:
 *   The flag stays "pending" if the regeneration fails, so the next start regenerates again
 *   (the rules then already match the new schedule, so they are not changed twice). Once "done",
 *   later schedule changes on the Platforms page are never touched. Every query must run on both
 *   SQLite and MariaDB ("key" is quoted because it is a reserved word in MariaDB).
 */
async function startingSchedules(db) {
  const flag = await db.get('SELECT value FROM appSetting WHERE "key" = ?', [STARTING_SCHEDULES_FLAG]);
  if (flag?.value === 'done') return;

  const result = await db.transaction(async (tx) => {
    const regenerate = [];
    let changed = false;
    for (const { key, from, to } of STARTING_SCHEDULES) {
      if (from.byDay === to.byDay && from.time === to.time) continue; // LinkedIn: nothing changes
      const platform = await tx.get('SELECT id, name FROM platform WHERE "key" = ?', [key]);
      if (!platform) continue;
      if (await plainRule(tx, platform.id, to)) {
        // Already on it; regenerate only when a change before this start did not finish
        if (flag?.value === 'pending') regenerate.push(platform.id);
        continue;
      }
      const rule = await plainRule(tx, platform.id, from);
      if (!rule) {
        console.log(`Starting schedule for ${platform.name} not applied: someone already changed its schedule rules.`);
        continue;
      }
      await tx.run('UPDATE scheduleRule SET byDay = ?, time = ? WHERE id = ?', [to.byDay, to.time, rule.id]);
      const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].filter((d) => to.byDay.split(',').includes(d.slice(0, 2)));
      await tx.run('UPDATE platform SET postingDays = ?, postingTimes = ? WHERE id = ?',
        [JSON.stringify(days), JSON.stringify([to.time]), platform.id]);
      console.log(`Starting schedule for ${platform.name} applied: ${to.byDay} at ${to.time}.`);
      regenerate.push(platform.id);
      changed = true;
    }
    if (changed) {
      await tx.run('DELETE FROM appSetting WHERE "key" = ?', [STARTING_SCHEDULES_FLAG]);
      await tx.run("INSERT INTO appSetting (\"key\", value) VALUES (?, 'pending')", [STARTING_SCHEDULES_FLAG]);
    }
    return regenerate;
  });

  for (const id of result) await syncPlatform(db, id, { regenerate: true });
  await db.run('DELETE FROM appSetting WHERE "key" = ?', [STARTING_SCHEDULES_FLAG]);
  await db.run("INSERT INTO appSetting (\"key\", value) VALUES (?, 'done')", [STARTING_SCHEDULES_FLAG]);
}

const LINKEDIN_WEEKS_FLAG = 'linkedinAlternatingWeeks';
// LinkedIn's alternating weeks: the first week (a Sunday) posts on the first set of days, the
// next week on the second, and so on, all at the same time. The weekly rule from before posts
// up to the day before firstWeek.
const LINKEDIN_WEEKS = {
  firstWeek: '2026-11-15',
  time: '12:00',
  weeks: [{ byDay: 'MO,WE,FR', label: 'Mon/Wed/Fri weeks' }, { byDay: 'TU,TH', label: 'Tue/Thu weeks' }],
  from: { byDay: 'TU,TH', time: '12:00' },
};
const DAY_MS = 86_400_000;
const dayOf = (date) => Date.UTC(...date.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) / DAY_MS;
const dateOf = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/**
 * Splits one post type order over rules that take turns by week, so that read across all their
 * posts in date order the types follow that one order.
 *
 * Usage:
 *   alternatingSequences([n, a, n, t], [3, 2])
 *   // [[n,a,n, a,n,t, n,t,n, t,n,a], [t,n, n,a, a,n, n,t]]
 *
 * Takes:
 *   sequence - the post type ids in order, cycled
 *   perWeek  - how many posts each rule makes in its week, in the order the weeks come
 *              ([3, 2]: Mon/Wed/Fri then Tue/Thu)
 *
 * Returns:
 *   One list of post type ids per rule, for that rule's postTypeIds.
 *
 * How it works:
 *   Each rule cycles only its own list (projection.js monthBlueprint), counting its own posts.
 *   One round of all the weeks makes sum(perWeek) posts; after enough rounds that the order
 *   comes back to its start, every rule's posts have repeated too. So each list is that rule's
 *   share of the combined order over those rounds (12 and 8 entries for [3, 2] and 4 types).
 *
 * When editing:
 *   This only holds while every rule makes all its posts each round. A slot type change on one
 *   rule (the slot panel) or a type taken out of the rotation changes that rule's list only.
 */
export function alternatingSequences(sequence, perWeek) {
  const round = perWeek.reduce((a, b) => a + b, 0);
  const rounds = sequence.length / gcd(round, sequence.length);
  return perWeek.map((count, w) => {
    const before = perWeek.slice(0, w).reduce((a, b) => a + b, 0);
    const ids = [];
    for (let r = 0; r < rounds; r++) {
      for (let j = 0; j < count; j++) ids.push(sequence[(r * round + before + j) % sequence.length]);
    }
    return ids;
  });
}

/**
 * LinkedIn moves once from Tue/Thu every week to Mon/Wed/Fri and Tue/Thu weeks in turn, at
 * 12:00 PM New York time, keeping its post type order running across all its posts. New and
 * existing databases both get it here, and only when LinkedIn's schedule is still the seeded one.
 *
 * Usage:
 *   await linkedInAlternatingWeeks(db);   (end of seed)
 *
 * How it works:
 *   1. Stops when the appSetting flag (LINKEDIN_WEEKS_FLAG) is "done", and waits (no change,
 *      tried on the next start) until linkedInPattern has set the LinkedIn order.
 *   2. In one transaction, unless the flag is "pending" (a retry):
 *      - LinkedIn's schedule must be exactly one active rule equal to the seeded one (TU,TH 12:00
 *        weekly from 2026-01-01, no end; plainRule). Anything else: logged as skipped because
 *        someone already changed it, and the flag is set to "done".
 *      - The old rule ends the day before LINKEDIN_WEEKS.firstWeek, so its posts before then
 *        stay where they are.
 *      - Two every-other-week rules are added: Mon/Wed/Fri from firstWeek, Tue/Thu from a week
 *        later. Their postTypeIds come from alternatingSequences over the order the old rule
 *        cycles (its postTypeIds, or the rotation when empty: the LinkedIn order once
 *        linkedInPattern has run), starting where the old rule would have gone on after its
 *        posts up to the end date.
 *      - The flag is set to "pending" when LinkedIn has slots to regenerate, else "done".
 *   3. Regenerates LinkedIn's future unlocked slots, as after a rule change on the Platforms
 *      page; past, locked and pinned slots stay. Then sets the flag to "done".
 *
 * When editing:
 *   The rule model has no shared sequence between rules: each rule cycles its own postTypeIds,
 *   so the combined order lives in the two lists (see alternatingSequences). The old rule's
 *   place in the order is counted from its days only; slot type changes on it are not counted.
 *   Every query must run on both SQLite and MariaDB ("key" is quoted, reserved in MariaDB).
 */
async function linkedInAlternatingWeeks(db) {
  const flag = await db.get('SELECT value FROM appSetting WHERE "key" = ?', [LINKEDIN_WEEKS_FLAG]);
  if (flag?.value === 'done') return;
  // The LinkedIn order is set first (linkedInPattern logs why when it can't be yet)
  const pattern = await db.get('SELECT value FROM appSetting WHERE "key" = ?', [LINKEDIN_PATTERN_FLAG]);
  if (pattern?.value !== 'done') return;
  const setFlag = async (tx, value) => {
    await tx.run('DELETE FROM appSetting WHERE "key" = ?', [LINKEDIN_WEEKS_FLAG]);
    await tx.run('INSERT INTO appSetting ("key", value) VALUES (?, ?)', [LINKEDIN_WEEKS_FLAG, value]);
  };

  const platformRow = await db.get('SELECT id FROM platform WHERE "key" = ?', ['linkedin']);
  if (!platformRow) return;
  const regenerate = flag?.value === 'pending' || await db.transaction(async (tx) => {
    const rule = await plainRule(tx, platformRow.id, LINKEDIN_WEEKS.from);
    if (!rule) {
      console.log("LinkedIn's alternating weeks not applied: someone already changed its schedule rules.");
      await setFlag(tx, 'done');
      return false;
    }
    // The order the old rule cycles: its own postTypeIds, or the rotation when it has none
    const rotation = (await tx.all('SELECT id FROM postType WHERE platformId = ? AND inRotation = 1 ORDER BY sortOrder, id',
      [platformRow.id])).map((t) => t.id);
    const stored = typeof rule.postTypeIds === 'string' ? JSON.parse(rule.postTypeIds) : rule.postTypeIds ?? [];
    const own = stored.filter((id) => rotation.includes(id));
    const sequence = own.length ? own : rotation;
    if (!sequence.length) return false;

    // Where the old rule would have gone on in that order, after its last post before firstWeek
    const first = dayOf(LINKEDIN_WEEKS.firstWeek);
    const oldDays = new Set(rule.byDay.split(',').map((code) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(code)));
    let posted = 0;
    for (let day = dayOf(rule.startDate); day < first; day++) if (oldDays.has((day + 4) % 7)) posted++;
    const start = posted % sequence.length;
    const order = [...sequence.slice(start), ...sequence.slice(0, start)];

    const perWeek = LINKEDIN_WEEKS.weeks.map((w) => w.byDay.split(',').length);
    const lists = alternatingSequences(order, perWeek);
    await tx.run('UPDATE scheduleRule SET endDate = ? WHERE id = ?', [dateOf(first - 1), rule.id]);
    for (const [i, week] of LINKEDIN_WEEKS.weeks.entries()) {
      await tx.run(`INSERT INTO scheduleRule (platformId, label, byDay, intervalWeeks, time, startDate, postTypeIds, sortOrder)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [platformRow.id, week.label, week.byDay, LINKEDIN_WEEKS.weeks.length, LINKEDIN_WEEKS.time, dateOf(first + 7 * i),
        JSON.stringify(lists[i]), Number(rule.sortOrder) + 1 + i]);
    }
    const hasSlots = Boolean(await tx.get('SELECT 1 FROM slot WHERE platformId = ?', [platformRow.id]));
    await setFlag(tx, hasSlots ? 'pending' : 'done');
    if (hasSlots) console.log("LinkedIn's alternating weeks applied: Mon/Wed/Fri and Tue/Thu weeks in turn from "
      + `${LINKEDIN_WEEKS.firstWeek}.`);
    return hasSlots;
  });
  if (!regenerate) return;
  await syncPlatform(db, platformRow.id, { regenerate: true });
  await setFlag(db, 'done');
}

// Run directly (npm run seed): seed the configured database and list the platforms
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = await openDb();
  await seed(db);
  console.log('Seeded platforms:', (await db.all('SELECT name FROM platform')).map((r) => r.name).join(', '));
  await db.close();
}
