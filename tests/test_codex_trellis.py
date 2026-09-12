"""Focused wiring checks for the project-owned Codex memory workflow.

Run with: python -B -m unittest discover -s tests -p test_codex_trellis.py
No model calls, task mutations, product builds or third-party dependencies.
"""

import json
from pathlib import Path
import re
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]
CODEX = ROOT / ".codex"
SKILLS = ROOT / ".agents" / "skills"


def read(path):
    return path.read_text(encoding="utf-8")


class CodexTrellisWiringTests(unittest.TestCase):
    def test_codex_bootstrap_uses_local_policy(self):
        config = tomllib.loads(read(CODEX / "config.toml"))
        self.assertIn(".codex/trellis.md", config["developer_instructions"])
        self.assertIn(".codex/trellis.md", read(ROOT / "AGENTS.md"))
        self.assertEqual(config["project_doc_fallback_filenames"], ["AGENTS.md"])
        self.assertNotIn("model_instructions_file", config)  # Do not replace native safety instructions.

    def test_no_legacy_hooks_can_reinject_phase_rules(self):
        hooks = json.loads(read(CODEX / "hooks.json"))
        self.assertEqual(hooks, {"hooks": {}})
        for name in ("session-start.py", "inject-workflow-state.py", "inject-subagent-context.py"):
            self.assertFalse((CODEX / "hooks" / name).exists(),
                             f"Trellis update restored a retired Codex hook: {name}")

    def test_legacy_skills_are_explicit_only_via_codex_metadata(self):
        skills = list(SKILLS.glob("trellis-*"))
        self.assertTrue(skills)
        for skill in skills:
            policy = skill / "agents" / "openai.yaml"
            self.assertTrue(policy.is_file(),
                            f"New legacy skill needs an invocation policy: {skill.name}")
            # These small YAML files configure native discovery, not prompt wording.
            self.assertRegex(read(policy), r"(?m)^policy:\s*$")
            self.assertRegex(read(policy), r"(?m)^  allow_implicit_invocation:\s*false\s*$")
        config = tomllib.loads(read(CODEX / "config.toml"))
        self.assertNotIn("skills", config)  # Do not restore the ineffective project-layer toggle.

    def test_only_two_new_codex_skills_and_their_entry_names(self):
        for name in ("codex-task", "codex-memory"):
            text = read(SKILLS / name / "SKILL.md")
            self.assertTrue(text.startswith("---\n"))
            frontmatter = text.split("---", 2)[1]
            self.assertRegex(frontmatter, rf"(?m)^name: {re.escape(name)}$")
            self.assertIn("Codex only:", frontmatter)
            self.assertIn(".codex/trellis.md", text)

    def test_agent_permissions_match_optional_roles(self):
        expected = {"trellis-implement": "workspace-write", "trellis-check": "read-only",
                    "trellis-research": "read-only"}
        for name, sandbox in expected.items():
            agent = tomllib.loads(read(CODEX / "agents" / f"{name}.toml"))
            self.assertEqual(agent["name"], name)
            self.assertEqual(agent["sandbox_mode"], sandbox)
            self.assertIn(".codex/trellis.md", agent["developer_instructions"])
            self.assertNotIn("model", agent)  # Inherit the caller's model.

    def test_policy_references_and_no_commit_memory_commands(self):
        assets = [ROOT / "AGENTS.md", *CODEX.glob("*.md"),
                  SKILLS / "codex-task" / "SKILL.md", SKILLS / "codex-memory" / "SKILL.md"]
        for asset in assets:
            text = read(asset)
            for target in re.findall(r"`(\.codex/[a-z-]+\.md)`", text):
                self.assertTrue((ROOT / target).is_file(), f"Broken reference in {asset}: {target}")
        self.assertIn("archive <task-dir> --no-commit", read(SKILLS / "codex-task" / "SKILL.md"))
        self.assertIn("--no-commit", read(SKILLS / "codex-memory" / "SKILL.md"))
        for filename in ("task.py", "get_context.py", "add_session.py"):
            self.assertTrue((ROOT / ".trellis" / "scripts" / filename).is_file())


if __name__ == "__main__":
    unittest.main()
