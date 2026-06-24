import { localDb } from "./db"

/**
 * Storage API for player-saved skill config overrides.
 *
 * Overrides are keyed by the skill **directory** path (e.g. "skills/web-search"
 * or "agents/master/skills/my-skill"), the same key `buildSkillRegistry` uses
 * to attach `configItems` to a `SkillRegistryEntry`. The skill directory is
 * derived from the `SKILL.md` path by stripping the trailing `/SKILL.md`.
 *
 * Overrides never enter the workspace file system and are never exported with
 * a skill package — only the `skill.config` declaration + default values travel
 * with the package. This mirrors how AI provider apiKey presets stay local
 * (see the "Browser AI Provider Config And Secrets" scenario in state-management.md).
 */

function skillDirectoryFromPath(skillFilePath: string): string {
  const slashIndex = skillFilePath.lastIndexOf("/")
  return slashIndex >= 0 ? skillFilePath.slice(0, slashIndex) : skillFilePath
}

/**
 * Read a skill's player-saved config overrides. Returns `{}` when the skill
 * has no saved overrides (the caller then falls back to `skill.config` defaults).
 */
export async function readSkillConfig(
  skillFilePath: string,
): Promise<Record<string, string>> {
  const skillPath = skillDirectoryFromPath(skillFilePath)
  const record = await localDb.skillConfigs.get(skillPath)
  if (!record) {
    return {}
  }
  try {
    const parsed = JSON.parse(record.values) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>
    }
  } catch {
    // Corrupt stored JSON — degrade to empty overrides (defaults will apply).
  }
  return {}
}

/**
 * Write a skill's player-saved config overrides. Replaces any existing record
 * for the skill directory. Values are JSON-serialized.
 */
export async function writeSkillConfig(
  skillFilePath: string,
  values: Record<string, string>,
): Promise<void> {
  const skillPath = skillDirectoryFromPath(skillFilePath)
  await localDb.skillConfigs.put({
    skillPath,
    values: JSON.stringify(values),
    updatedAt: Date.now(),
  })
}

/**
 * Delete a skill's player-saved config overrides (revert to defaults).
 */
export async function deleteSkillConfig(
  skillFilePath: string,
): Promise<void> {
  const skillPath = skillDirectoryFromPath(skillFilePath)
  await localDb.skillConfigs.delete(skillPath)
}
