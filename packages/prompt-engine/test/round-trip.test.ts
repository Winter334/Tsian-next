/**
 * G4: SillyTavern preset round-trip 验证
 *
 * 验收标准：
 *   真实 ST preset.json 经 convertPresetFromSillyTavern 不抛错且至少产出 1 条 message。
 *
 * Fixture：`herebetween-0.0.3.json`（社区轻量 preset，源自项目根，已移到 test/fixtures/）
 *   - 45 prompts / 2 prompt_order / 6 SPreset.RegexBinding 正则
 *   - 方案 A：SPreset 路径不在 fast-tavern 默认识别的 `regexScripts` /
 *     `other.extensions.regex_scripts` 路径上，本测试不适配该插件路径，6 条正则会被忽略，
 *     不影响 round-trip 验收（仅要求 ≥1 条 message + 不抛错）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { convertPresetFromSillyTavern } from '../src/core/modules/inputs/convertFromSillyTavern';
import { assemblePromptFromPreset } from '../src/tsian/assemble';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, 'fixtures/herebetween-0.0.3.json');

describe('SillyTavern preset round-trip (herebetween-0.0.3)', () => {
  const rawPreset: unknown = JSON.parse(readFileSync(fixturePath, 'utf-8'));

  it('convertPresetFromSillyTavern does not throw on real-world community preset', () => {
    expect(() => convertPresetFromSillyTavern(rawPreset)).not.toThrow();
  });

  it('converted preset has prompts array', () => {
    const preset = convertPresetFromSillyTavern(rawPreset);
    expect(preset.prompts).toBeDefined();
    expect(Array.isArray(preset.prompts)).toBe(true);
    expect(preset.prompts.length).toBeGreaterThan(0);
  });

  it('assemblePromptFromPreset produces at least 1 message (openai channel)', () => {
    const preset = convertPresetFromSillyTavern(rawPreset);
    const result = assemblePromptFromPreset({
      preset,
      macros: {
        user: '玩家',
        char: '主角',
      },
      history: [
        { role: 'user', content: 'hello' },
      ],
      channel: 'openai',
    });

    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(typeof result.rendered).toBe('string');
    expect(result.rendered.length).toBeGreaterThan(0);
  });

  it('assemblePromptFromPreset works on text channel', () => {
    const preset = convertPresetFromSillyTavern(rawPreset);
    const result = assemblePromptFromPreset({
      preset,
      macros: { user: '玩家', char: '主角' },
      history: [{ role: 'user', content: 'hello' }],
      channel: 'text',
    });

    expect(result.messages.length).toBeGreaterThan(0);
    // text channel rendered 是合并后的纯字符串
    expect(typeof result.rendered).toBe('string');
    expect(result.rendered.length).toBeGreaterThan(0);
  });

  it('assemblePromptFromPreset works on gemini channel', () => {
    const preset = convertPresetFromSillyTavern(rawPreset);
    const result = assemblePromptFromPreset({
      preset,
      macros: { user: '玩家', char: '主角' },
      history: [{ role: 'user', content: 'hello' }],
      channel: 'gemini',
    });

    expect(result.messages.length).toBeGreaterThan(0);
    expect(typeof result.rendered).toBe('string');
  });
});
