/**
 * Boot cinematic — procedural canvas, no video (brief §6). STUB: calls
 * onComplete immediately; the real sequence replaces this file (keep the
 * exported API identical).
 */

export interface BootOptions {
  /** 3-second cut (mobile / slow first frames) instead of the full 10s. */
  short: boolean;
  onComplete: () => void;
}

export interface BootHandle {
  /** Jump to the end now (Skip button, Escape). Idempotent. */
  skip(): void;
}

export function playBoot(root: HTMLElement, opts: BootOptions): BootHandle {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    root.remove();
    opts.onComplete();
  };
  queueMicrotask(finish);
  return { skip: finish };
}
