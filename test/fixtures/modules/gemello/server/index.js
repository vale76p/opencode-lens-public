// Test fixture: claims the same route as demo.
export function create() {
  return { routes: { "GET /api/demo": () => ({ gemello: true }) } };
}
