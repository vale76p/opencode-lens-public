// Test fixture: create() throws, and so do hasData() and files() (asked while the module is off).
export function create() {
  throw new Error("avvio fallito");
}

export function hasData() {
  throw new Error("dati illeggibili");
}

export function files() {
  throw new Error("file illeggibili");
}
