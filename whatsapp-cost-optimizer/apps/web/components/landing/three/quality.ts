/**
 * Watches how long frames take. Every 60 frames, if the scene is running under about 36 frames a
 * second, it calls `giveUp` (which trades some picture quality for speed). `giveUp` returns false
 * when there is nothing left to give up.
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
    if (frames < 60) return;
    const avg = spent / frames;
    frames = 0;
    spent = 0;
    if (avg <= 0.028) return;
    done = !giveUp();
  };
}
