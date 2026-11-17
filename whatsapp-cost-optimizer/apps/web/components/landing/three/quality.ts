/**
 * Watches how long frames take. Every 40 frames, if the scene is running under about 48 frames a
 * second, it calls `giveUp` (which trades some picture quality for speed) once, or twice when it is
 * under about 25. `giveUp` returns false when there is nothing left to give up.
 */
export function frameWatch(giveUp: () => boolean): (dt: number) => void {
  let frames = 0;
  let spent = 0;
  let done = false;
  return (dt) => {
    // A long gap is the tab coming back or the scene waking up, not a slow frame.
    if (done || dt <= 0 || dt > 0.25) return;
    frames += 1;
    spent += dt;
    if (frames < 40) return;
    const avg = spent / frames;
    frames = 0;
    spent = 0;
    if (avg <= 0.021) return;
    done = !giveUp();
    if (!done && avg > 0.04) done = !giveUp();
  };
}
