// Test fixture: create() succeeds, start() throws; the counters let the test see stop() called once.
export const calls = { start: 0, stop: 0 };

export function create() {
  return {
    start: () => {
      calls.start++;
      throw new Error("start fallito");
    },
    stop: () => {
      calls.stop++;
    },
  };
}
