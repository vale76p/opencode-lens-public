// Test fixture: create() is async (the module entry must be synchronous) and its promise rejects.
export async function create() {
  throw new Error("create asincrona fallita");
}
