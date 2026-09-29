// Calendar sync and dispatch run one at a time, so two requests can't both
// insert an event for the same post and a due post can't be sent twice.
let pending = Promise.resolve();

export function serialized(fn) {
  const run = pending.then(fn);
  pending = run.catch(() => {});
  return run;
}
