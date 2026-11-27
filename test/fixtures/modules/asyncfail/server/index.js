// Test fixture: an async start() that rejects; the counters let the test see stop() called once.
export const calls = { start: 0, stop: 0 };

export function create() {
  return {
    async start() {
      calls.start++;
      throw new Error("start asincrono fallito");
    },
    stop: () => {
      calls.stop++;
    },
  };
}
