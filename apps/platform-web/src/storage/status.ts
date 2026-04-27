import { localDb } from "./db"

const STORAGE_PROBE_KEY = "storage-probe"

export async function ensureLocalStorageReady(): Promise<string> {
  await localDb.meta.put({
    key: STORAGE_PROBE_KEY,
    value: "ready",
  })

  const record = await localDb.meta.get(STORAGE_PROBE_KEY)
  return record?.value === "ready" ? "ready" : "unavailable"
}
