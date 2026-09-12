import type { CharacterIdentity } from "./character-types"

/** Compact headings use identity fields only; the full brief belongs in the dossier. */
export function characterIdentityLine(identity?: CharacterIdentity): string {
  return [identity?.role, identity?.affiliation, identity?.realm]
    .filter((value): value is string => typeof value === "string" && !!value.trim())
    .map(value => value.trim()).join(" · ")
}
