// Fast-forward pacing shared by the worker and the main-thread fallback.
// Tick cost does not depend on the step length, so when the machine cannot run `speed` x 20 ticks a second the
// step is widened (0.05 s -> 0.1 s -> 0.2 s) instead of freezing. Past that, the sim runs flat out and the real speed is reported.
export const BASE = 0.05, STEPS = [1, 2, 4], HEADROOM = 0.95;
export class Pacer {
  constructor(coarse = true) { this.coarse = coarse; this.m = 1; this.cost = 0; this.owed = 0; this.done = 0; this.wall = 0; this.achieved = 1; }
  /** record how long one tick took (ms) */
  note(ms) { this.cost = this.cost ? this.cost * 0.9 + ms * 0.1 : ms; }
  /** step multiplier for the requested speed; widens at once when behind, narrows only with clear margin */
  pick(speed) {
    if (!this.coarse || !this.cost) return (this.m = 1);
    const need = (m) => (this.cost * 20 * speed) / (m * 1000); // fraction of a second of CPU needed per second
    let m = this.m;
    while (m < 4 && need(m) > HEADROOM) m *= 2;
    while (m > 1 && need(m / 2) < HEADROOM * 0.6) m /= 2;
    return (this.m = m);
  }
  /** call once per loop with sim-seconds just simulated and wall seconds elapsed; keeps a ~1 s window of the real speed */
  tally(simSec, wallSec) {
    this.done += simSec; this.wall += wallSec;
    if (this.wall >= 0.5) { this.achieved = this.done / this.wall; this.done = 0; this.wall = 0; }
  }
}
