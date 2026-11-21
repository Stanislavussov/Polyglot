// The translate card arrives in pieces; typing each new piece out reads like a live answer
// instead of blocks of text popping in and shoving the page around.

/** Characters already on screen that the new text keeps: typing resumes after them. */
export function sharedPrefix(shown: string, target: string): number {
  let at = 0;
  while (at < shown.length && at < target.length && shown[at] === target[at]) at++;
  return at;
}

/** Characters per frame: at least two, and any reveal finishes within about 40 frames (~0.7 s). */
export function charsPerFrame(toReveal: number): number {
  return Math.max(2, Math.ceil(toReveal / 40));
}
