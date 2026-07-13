import type { WorkspaceFile } from "@tsian/contracts"
import type { RuntimeWorkspaceTransaction } from "../storage"

const RUNTIME_PATH = "save/playthrough/runtime.json"
const SCENES_PREFIX = "save/scenes/"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function warnSceneCleanup(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.warn(`[platform-host] ${message}`, details)
    return
  }
  console.warn(`[platform-host] ${message}`)
}

function parseJson(content: string, path: string): unknown | null {
  try {
    return JSON.parse(content) as unknown
  } catch (error) {
    warnSceneCleanup("Skipping scene cleanup because a workspace JSON file is malformed.", {
      path,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function activeSceneRefSetFromRuntime(runtime: unknown): Set<string> | null {
  if (!isRecord(runtime) || !Array.isArray(runtime.activeSceneRefs)) {
    return null
  }

  const refs = new Set<string>()
  for (const entry of runtime.activeSceneRefs) {
    if (!isRecord(entry) || typeof entry.ref !== "string" || !entry.ref.trim()) {
      return null
    }
    refs.add(entry.ref)
  }

  return refs
}

function isOneLevelSceneJsonPath(path: string): boolean {
  if (!path.startsWith(SCENES_PREFIX) || !path.endsWith(".json")) {
    return false
  }
  const localPath = path.slice(SCENES_PREFIX.length)
  return localPath.length > 0 && !localPath.includes("/")
}

function findWorkspaceFile(files: WorkspaceFile[], path: string): WorkspaceFile | undefined {
  return files.find((file) => file.path === path)
}

/**
 * Stage stale scene removals into the same post-turn maintenance transaction.
 *
 * Scene files are derived save-runtime views. The authoritative current-scene
 * set is `save/playthrough/runtime.json` `activeSceneRefs`; long-lived hub
 * scenes opt out by setting `status: "background"` on the scene file.
 * Cleanup is best-effort and must never fail the invoking Agent turn. Staging
 * deletes before `finalWorkspaceChanges()` ensures the post-maintenance
 * checkpoint does not restore stale scenes.
 */
export function cleanupScenesInTransaction(
  transaction: RuntimeWorkspaceTransaction,
): void {
  try {
    const runtimeFile = findWorkspaceFile(transaction.workspaceFiles, RUNTIME_PATH)
    if (!runtimeFile || typeof runtimeFile.content !== "string") {
      warnSceneCleanup("Skipping scene cleanup because runtime.json is missing.", {
        path: RUNTIME_PATH,
      })
      return
    }

    const runtime = parseJson(runtimeFile.content, RUNTIME_PATH)
    const activeSceneRefs = activeSceneRefSetFromRuntime(runtime)
    if (!activeSceneRefs) {
      warnSceneCleanup("Skipping scene cleanup because runtime.activeSceneRefs is malformed.", {
        path: RUNTIME_PATH,
      })
      return
    }

    const sceneFiles = transaction.workspaceFiles
      .filter((file) => isOneLevelSceneJsonPath(file.path))
      .sort((left, right) => left.path.localeCompare(right.path))

    const deletedPaths: string[] = []
    for (const sceneFile of sceneFiles) {
      if (typeof sceneFile.content !== "string") {
        warnSceneCleanup("Skipping scene cleanup for a non-text scene file.", {
          path: sceneFile.path,
        })
        continue
      }

      const scene = parseJson(sceneFile.content, sceneFile.path)
      if (!isRecord(scene) || typeof scene.id !== "string" || !scene.id.trim()) {
        warnSceneCleanup("Skipping scene cleanup for a malformed scene file.", {
          path: sceneFile.path,
        })
        continue
      }

      if (activeSceneRefs.has(scene.id) || scene.status === "background") {
        continue
      }

      try {
        const result = transaction.delete(sceneFile.path)
        deletedPaths.push(...result.deletedPaths)
      } catch (error) {
        warnSceneCleanup("Failed to stage stale scene deletion during cleanup.", {
          path: sceneFile.path,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (deletedPaths.length > 0) {
      console.info("[platform-host] Stale scene cleanup staged.", { deletedPaths })
    }
  } catch (error) {
    warnSceneCleanup("Scene cleanup failed; continuing without failing the invocation.", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
