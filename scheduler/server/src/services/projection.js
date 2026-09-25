// Projected schedule (Deliverables 2 and 3): assigns every queued post on a
// platform to the next free posting slot from that platform's cadence.
// Order: override dates are fixed; the rest fill slots by priority DESC, queue_position ASC.

/**
 * @param {object} platform  row with parsed posting_days / posting_times
 * @param {object[]} posts   queued posts for that platform
 * @param {Date} from        app-clock now
 * @returns {{ postId: number, slot: Date }[]}
 */
export function projectPlatform(platform, posts, from) {
  // TODO(Sprint 4): generate slots from cadence in config.timezone, skip slots
  // taken by override_at posts, then assign in priority/queue order.
  // TODO(Sprint 5): pause and blackout dates.
  return [];
}
