/** A conversion the reader stopped from the log. */
export class JobCancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "JobCancelled";
  }
}

let stopped = false;

export function armJob() {
  stopped = false;
}

export function cancelJob() {
  stopped = true;
}

export function cancelled() {
  return stopped;
}

/** Leave the current page and the files still waiting. */
export function checkpoint() {
  if (stopped) throw new JobCancelled();
}
