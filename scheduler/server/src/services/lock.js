/**
 * One shared queue so Calendar sync, the calendar pull, dispatch and media rotation run one
 * at a time.
 */
let pending = Promise.resolve();

/**
 * Runs fn after every job queued before it has finished, so two requests can't both insert
 * an event for the same post and a due post can't be sent twice.
 *
 * Usage:
 *   return serialized(() => syncPlatformNow(db, platformId, options));
 *
 * Takes:
 *   fn - a function (usually async) to run once the queue is free
 *
 * Returns:
 *   A promise for fn's result; it rejects if fn throws or rejects.
 *
 * How it works:
 *   Chains fn onto the last queued job. The queue itself swallows fn's error, so one failed
 *   job does not block the ones after it; the caller still gets the rejection.
 *
 * When editing:
 *   This is a single in-process queue: it does not protect two server processes sharing one
 *   database. Calling serialized() from inside a serialized job deadlocks (the inner job waits
 *   for the outer one), so call the "...Now" versions from inside a job instead.
 */
export function serialized(fn) {
  const run = pending.then(fn);
  pending = run.catch(() => {});
  return run;
}
