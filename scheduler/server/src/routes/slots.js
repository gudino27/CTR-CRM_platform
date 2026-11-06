/**
 * Slot routes (/api/slots): the Calendar's month, hand overrides on one slot, and the post type
 * change for a slot and its later slots.
 *
 * Slots come from each platform's schedule rules; syncPlatform (services/sync.js) makes them and
 * places library posts in them. Locked and pinned slots stay put, and regeneration only touches
 * future unlocked slots ("no domino": posts already in slots stay where they are).
 *
 * Permissions (ROUTES in services/permissions.js): GETs need any signed-in user; PATCH and the
 * type-change POST need editSlots. PATCH is written to the audit log by services/access.js; the
 * type-change POST writes its own entry.
 */
import { Router } from 'express';
import { config } from '../config.js';
import { clock } from '../services/clock.js';
import { COLORS, fitsSlot, monthBlueprint, monthsFrom, parseMonth } from '../services/projection.js';
import { parsePlatform, syncPlatform, withTypeChanges } from '../services/sync.js';
import { SELECT_POST, SELECT_SLOT, fixedDays, postTypesOf, rulesOf, slotViews, visible } from '../services/views.js';
import { writeAudit } from '../services/access.js';
// Months ahead that GET /api/slots generates on demand
import { slotMonthsAhead } from '../settings.js';
// The slot panel's post type choices beyond "Only this slot" (which is PATCH /:id)
const SCOPES = { later: 'This and later slots', rotation: 'Shift the rotation' };

/**
 * The /api/slots router.
 *
 * Usage:
 *   app.use('/api/slots', slotsRouter(db));   (app.js)
 *
 * Takes:
 *   db - the open database
 *
 * Returns:
 *   An Express router with the routes below.
 */
export function slotsRouter(db) {
  const router = Router();
  const platformById = (id) => db.get('SELECT * FROM platform WHERE id = ?', [id]);
  const slotById = (id) => db.get(`${SELECT_SLOT} WHERE slot.id = ?`, [id]);

  /**
   * GET /api/slots: one platform's month for the Calendar: its slots (generated on first view)
   * and the Specific Date posts on its days. Any signed-in user.
   *
   * Usage:
   *   GET /api/slots?platformId=2&month=2026-12
   *
   * Takes:
   *   platformId - the platform (the Test platform only in test mode)
   *   month      - "YYYY-MM"
   *
   * Returns:
   *   200 { slots: [slotViews], fixedPosts: [post] }; 400 for a bad platformId or month.
   *
   * How it works:
   *   Months from this one up to slotMonthsAhead (settings.js) ahead are synced (made if
   *   missing) before reading; other months are only read.
   */
  router.get('/', async (req, res) => {
    const row = await platformById(req.query.platformId);
    if (!row || !visible(row)) return res.status(400).json({ error: 'platformId must be a platform' });
    const month = req.query.month;
    if (!parseMonth(month)) return res.status(400).json({ error: 'month must be "YYYY-MM"' });

    const upcoming = monthsFrom(clock.now(), slotMonthsAhead, config.timezone);
    await syncPlatform(db, row.id, { months: upcoming.includes(month) ? [month] : [] });

    const slots = await db.all(`${SELECT_SLOT} WHERE slot.platformId = ? AND slot.date LIKE ? ORDER BY slot.scheduledAt`,
      [row.id, `${month}-%`]);
    const fixedPosts = await db.all(`${SELECT_POST} WHERE post.platformId = ? AND post.kind = 'fixed' AND post.fixedAt LIKE ?
                                     ORDER BY post.fixedAt, post.id`, [row.id, `${month}-%`]);
    res.json({ slots: await slotViews(db, slots), fixedPosts });
  });

  /**
   * PATCH /api/slots/:id: hand overrides on one future slot: its post type, color, the post in
   * it (pinned), and lock. This is also "Only this slot" in the slot panel. Needs editSlots.
   *
   * Usage:
   *   PATCH /api/slots/40  { postTypeId: 5 }
   *   PATCH /api/slots/40  { postId: 12 }      (pin that post here; null empties the slot)
   *   PATCH /api/slots/40  { locked: true }
   *
   * Takes:
   *   body.postTypeId - one of the platform's rotation ("monthly") post types
   *   body.color      - "Blue" or "Purple" on platforms that use colors, otherwise null
   *   body.locked     - true or false
   *   body.postId     - a waiting library post on this platform, or null to empty the slot
   *
   * Returns:
   *   200 with the slot (slotViews); 404 unknown; 409 when the slot has passed, or when a
   *   Specific Date post is on that day (its library slots are blocked); 400 for a bad field.
   *
   * How it works:
   *   1. Saves type, color and lock.
   *   2. With postId: the slot's current post goes back to the library; a picked post is taken
   *      from any other slot (which then refills from the library) and pinned here.
   *   3. Without postId: a new type or color frees an unpinned post that no longer fits, even in
   *      a locked slot (this is a hand change).
   *   4. syncPlatform places posts and writes the calendar.
   */
  router.patch('/:id', async (req, res) => {
    const slot = await slotById(req.params.id);
    const row = slot && (await platformById(slot.platformId));
    if (!slot || !visible(row)) return res.status(404).json({ error: 'Slot not found' });
    if (slot.scheduledAt <= clock.now().toISOString()) return res.status(409).json({ error: 'This slot has already passed' });
    const platform = parsePlatform(row);
    const body = req.body ?? {};
    const updates = [];
    if ('postTypeId' in body) {
      if (!(await db.get('SELECT 1 FROM postType WHERE id = ? AND platformId = ? AND inRotation = 1', [body.postTypeId, platform.id]))) {
        return res.status(400).json({ error: `postTypeId must be one of ${platform.name}'s monthly post types` });
      }
      updates.push(['postTypeId', body.postTypeId]);
    }
    if ('color' in body) {
      const ok = platform.usesColors ? COLORS.includes(body.color) : body.color === null;
      if (!ok) {
        return res.status(400).json({ error: platform.usesColors ? 'color must be "Blue" or "Purple"' : `${platform.name} does not use colors; color must be null` });
      }
      updates.push(['color', body.color]);
    }
    if ('locked' in body) {
      if (typeof body.locked !== 'boolean') return res.status(400).json({ error: 'locked must be true or false' });
      updates.push(['locked', body.locked ? 1 : 0]);
    }
    let pin;
    if ('postId' in body && body.postId !== null) {
      pin = await db.get(`SELECT * FROM post WHERE id = ? AND platformId = ? AND kind = 'library' AND status = 'queued'`,
        [body.postId, platform.id]);
      if (!pin) return res.status(400).json({ error: `postId must be a waiting library post on ${platform.name}` });
      if ((await fixedDays(db, platform.id)).has(slot.date)) {
        return res.status(409).json({ error: 'A Specific Date post is on this day, so its library slots are blocked' });
      }
    }
    if (updates.length > 0) {
      await db.run(`UPDATE slot SET ${updates.map(([col]) => `${col} = ?`).join(', ')} WHERE id = ?`,
        [...updates.map(([, value]) => value), slot.id]);
    }
    const free = (id) => db.run('UPDATE slot SET postId = NULL, pinned = 0 WHERE id = ?', [id]);
    if ('postId' in body) {
      await free(slot.id); // its post goes back to the library
      if (pin) {
        // Taking the post from another slot frees that one, which refills from the library
        await db.run('UPDATE slot SET postId = NULL, pinned = 0 WHERE postId = ?', [pin.id]);
        await db.run('UPDATE slot SET postId = ?, pinned = 1 WHERE id = ?', [pin.id, slot.id]);
        await db.run('UPDATE post SET scheduledAt = NULL WHERE id = ?', [pin.id]);
      }
    } else if (slot.postId && !slot.pinned && (updates.length > 0)) {
      // Frees a post that no longer fits, even in a locked slot (this is a hand change)
      const changed = await slotById(slot.id);
      const post = await db.get('SELECT * FROM post WHERE id = ?', [slot.postId]);
      if (!fitsSlot(changed, post, platform.usesColors)) await free(slot.id);
    }
    await syncPlatform(db, platform.id);
    res.json((await slotViews(db, [await slotById(slot.id)]))[0]);
  });

  /**
   * Works out a post type change for a slot AND its rule's later slots, for both the
   * preview (GET) and the change (POST).
   *
   * Usage:
   *   const plan = await typeChangePlan(slotId, { scope: 'later', postTypeId: 5 });
   *   if (plan.error) return res.status(plan.status).json({ error: plan.error });
   *
   * Takes:
   *   slotId - the slot picked in the Calendar
   *   input  - { scope, postTypeId }; scope is one of SCOPES:
   *              "later"    every later slot of the rule with this slot's old type gets the new one
   *              "rotation" the rule's type sequence carries on from the new type, as if it
   *                         restarted here
   *
   * Returns:
   *   { status, error } when it cannot be done (404 unknown slot, 409 passed, 400 bad scope or
   *   type, no active rule, already that type, or a type not in the rule's order for "rotation").
   *   Otherwise { slot, platform, rule, newType, change (the ruleTypeChange row to insert),
   *   updates (later slots to change), preview }; preview is what GET answers:
   *   { scope, postTypeId, changes, until, keptSlots, postsReturning, slots }.
   *
   * How it works:
   *   1. Finds the slot's active rule (with its type changes so far).
   *   2. For each later slot of that rule, works out its new type: "later" swaps the old type;
   *      "rotation" rebuilds the months with this change in place of the rule's changes from this
   *      day on (monthBlueprint) and reads each slot's type from that.
   *   3. Only future slots that are neither locked nor pinned (nor kept with a post)
   *      change; the others are counted as kept.
   *   4. Counts the queued posts that would no longer fit: this slot's (unless picked by hand) and
   *      the changed slots'. They go back to the library and refill matching slots.
   *
   * When editing:
   *   Both scopes are kept on the rule (ruleTypeChange), so months made later follow them too;
   *   monthBlueprint must read them the same way this preview does.
   */
  const typeChangePlan = async (slotId, input) => {
    const fail = (status, error) => ({ status, error });
    const slot = await slotById(slotId);
    const row = slot && (await platformById(slot.platformId));
    if (!slot || !visible(row)) return fail(404, 'Slot not found');
    if (slot.scheduledAt <= clock.now().toISOString()) return fail(409, 'This slot has already passed');
    if (!(input.scope in SCOPES)) {
      return fail(400, 'scope must be "later" or "rotation" (change only this slot with PATCH /api/slots/:id)');
    }
    const platform = parsePlatform(row);
    const types = (await postTypesOf(db, platform.id)).filter((t) => t.inRotation);
    const newType = types.find((t) => t.id === input.postTypeId);
    if (!newType) return fail(400, `postTypeId must be one of ${platform.name}'s monthly post types`);
    const rules = await withTypeChanges(db, (await rulesOf(db, platform.id)).filter((r) => r.active));
    const rule = rules.find((r) => r.id === slot.ruleId);
    if (!rule) return fail(400, 'This slot no longer comes from an active schedule rule, so only this slot can change');
    if (input.scope === 'later' && newType.id === slot.postTypeId) return fail(400, `This slot is already ${newType.name}`);

    const change = { ruleId: rule.id, date: slot.date, kind: input.scope,
      fromTypeId: input.scope === 'later' ? slot.postTypeId : null, toTypeId: newType.id };
    const later = await db.all('SELECT * FROM slot WHERE platformId = ? AND ruleId = ? AND scheduledAt > ? ORDER BY scheduledAt',
      [platform.id, rule.id, slot.scheduledAt]);
    let targetOf;
    if (input.scope === 'later') {
      targetOf = (s) => (s.postTypeId === slot.postTypeId ? newType.id : s.postTypeId);
    } else {
      const reshaped = rules.map((r) => (r.id !== rule.id ? r
        : { ...r, typeChanges: [...r.typeChanges.filter((c) => c.date < slot.date), { ...change, id: Number.MAX_SAFE_INTEGER }] }));
      const blueprint = new Map();
      for (const month of new Set([slot.date, ...later.map((s) => s.date)].map((d) => d.slice(0, 7)))) {
        const [year, m] = parseMonth(month);
        for (const s of monthBlueprint(platform, reshaped, types, year, m, config.timezone)) blueprint.set(`${s.date} ${s.time}`, s);
      }
      const own = blueprint.get(`${slot.date} ${slot.time}`);
      if (own?.ruleId !== rule.id || own.postTypeId !== newType.id) {
        return fail(400, `${newType.name} is not in this schedule rule's post type order, so the rotation cannot continue from it; choose "Only this slot" or "This and later slots"`);
      }
      targetOf = (s) => {
        const next = blueprint.get(`${s.date} ${s.time}`);
        return next?.ruleId === rule.id ? next.postTypeId : s.postTypeId;
      };
    }
    const moving = later.filter((s) => targetOf(s) !== s.postTypeId);
    // Locked and pinned slots never change here, nor kept ones holding a post
    const changed = moving.filter((s) => !s.locked && !s.pinned && !(s.kept && s.postId));
    const leaving = [];
    for (const s of [{ ...slot, target: newType.id, own: true }, ...changed.map((c) => ({ ...c, target: targetOf(c) }))]) {
      if (!s.postId || (s.own && s.pinned)) continue;
      const post = await db.get("SELECT * FROM post WHERE id = ? AND status = 'queued'", [s.postId]);
      if (post && !fitsSlot({ ...s, postTypeId: s.target }, post, platform.usesColors)) leaving.push(post.id);
    }
    return {
      slot, platform, rule, newType, change,
      updates: changed.map((s) => ({ id: s.id, date: s.date, time: s.time, fromTypeId: s.postTypeId, toTypeId: targetOf(s) })),
      preview: {
        scope: input.scope,
        postTypeId: newType.id,
        changes: changed.length, // later slots whose type changes
        until: changed.at(-1)?.date ?? null,
        keptSlots: moving.length - changed.length, // later locked or pinned slots left as they are
        postsReturning: leaving.length, // posts that go back to the library and refill matching slots
        slots: changed.map((s) => ({ id: s.id, date: s.date, time: s.time, fromTypeId: s.postTypeId, toTypeId: targetOf(s) })),
      },
    };
  };

  /**
   * GET /api/slots/:id/type-change: previews a post type change for this and later slots
   * (nothing is saved). Any signed-in user.
   *
   * Usage:
   *   GET /api/slots/40/type-change?scope=later&postTypeId=5
   *
   * Returns:
   *   200 { scope, postTypeId, changes, until, keptSlots, postsReturning, slots }; the plan's
   *   status and error otherwise (see typeChangePlan).
   */
  router.get('/:id/type-change', async (req, res) => {
    const plan = await typeChangePlan(req.params.id, { scope: req.query.scope, postTypeId: Number(req.query.postTypeId) });
    if (plan.error) return res.status(plan.status).json({ error: plan.error });
    res.json(plan.preview);
  });

  /**
   * POST /api/slots/:id/type-change: applies the post type change previewed above. Needs editSlots.
   *
   * Usage:
   *   POST /api/slots/40/type-change  { scope: "rotation", postTypeId: 5 }
   *
   * Returns:
   *   200 { ...the preview, slot (slotViews) }; the plan's status and error otherwise.
   *
   * How it works:
   *   1. In one transaction: stores the change on the rule (a new rotation start replaces the
   *      rule's changes from this day on; a swap adds to them), sets this slot's type (its post
   *      leaves if it no longer fits, unless picked by hand), and sets the later slots' types.
   *   2. syncPlatform lets go of the later slots' posts that no longer fit (placePosts) and
   *      refills matching slots.
   *   3. Writes one audit entry describing the change and its counts.
   *
   * When editing:
   *   ROUTES has no entity/action for this route because the audit entry is written here.
   */
  router.post('/:id/type-change', async (req, res) => {
    const body = req.body ?? {};
    const plan = await typeChangePlan(req.params.id, { scope: body.scope, postTypeId: body.postTypeId });
    if (plan.error) return res.status(plan.status).json({ error: plan.error });
    const { slot, platform, rule, newType, change, updates, preview } = plan;
    await db.transaction(async (tx) => {
      // A new rotation start replaces the rule's changes from this day on; a swap adds to them
      if (change.kind === 'rotation') await tx.run('DELETE FROM ruleTypeChange WHERE ruleId = ? AND date >= ?', [rule.id, slot.date]);
      await tx.run('INSERT INTO ruleTypeChange (ruleId, date, kind, fromTypeId, toTypeId) VALUES (?, ?, ?, ?, ?)',
        [change.ruleId, change.date, change.kind, change.fromTypeId, change.toTypeId]);
      await tx.run('UPDATE slot SET postTypeId = ? WHERE id = ?', [newType.id, slot.id]);
      // Like a type change in PATCH: this slot's post leaves if it no longer fits (unless picked by hand)
      if (slot.postId && !slot.pinned) {
        const post = await tx.get('SELECT * FROM post WHERE id = ?', [slot.postId]);
        if (!fitsSlot({ ...slot, postTypeId: newType.id }, post, platform.usesColors)) {
          await tx.run('UPDATE slot SET postId = NULL WHERE id = ?', [slot.id]);
        }
      }
      for (const u of updates) await tx.run('UPDATE slot SET postTypeId = ? WHERE id = ?', [u.toTypeId, u.id]);
    });
    await syncPlatform(db, platform.id);

    const typeName = new Map((await postTypesOf(db, platform.id)).map((t) => [t.id, t.name]));
    const what = change.kind === 'later'
      ? `${typeName.get(change.fromTypeId) ?? 'its old type'} becomes ${newType.name} from then on`
      : `the rotation continues from ${newType.name}`;
    await writeAudit(db, { userId: req.user?.id ?? null, action: 'slot.typeChange', entityType: 'slot', entityId: slot.id,
      summary: `Changed the ${platform.name} slot of ${slot.date} to ${newType.name} (${SCOPES[change.kind]}: ${what}); `
        + `${preview.changes} later slot${preview.changes === 1 ? '' : 's'} changed${preview.until ? ` until ${preview.until}` : ''}`
        + `${preview.keptSlots ? `, ${preview.keptSlots} locked or pinned kept` : ''}`
        + `${preview.postsReturning ? `, ${preview.postsReturning} post${preview.postsReturning === 1 ? '' : 's'} back to the library` : ''}` });
    res.json({ ...preview, slot: (await slotViews(db, [await slotById(slot.id)]))[0] });
  });
  return router;
}
