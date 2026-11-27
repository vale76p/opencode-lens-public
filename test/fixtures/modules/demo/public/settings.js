// Test fixture: the demo module's panel in Impostazioni › Moduli.
export function mount(el, { status }) {
  el.textContent = `demo: ${status?.state ?? "–"}`;
  return {
    update(next) {
      el.textContent = `demo: ${next?.state ?? "–"}`;
    },
  };
}
