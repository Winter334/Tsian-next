import { describe, expect, it } from 'vitest';

import { replaceMacros } from '../src/core/modules/macro/replaceMacros';
import { applyRegex } from '../src/core/modules/regex/applyRegex';
import { assemblePromptFromPreset } from '../src/tsian/assemble';
import type { PresetInfo } from '../src/core/types';

const presetWithFlattenedMacros: PresetInfo = {
  name: 'macro-key-fixture',
  prompts: [
    {
      identifier: 'frame',
      name: 'frame',
      enabled: true,
      role: 'user',
      content:
        'time={{narrative.currentTime}} text={{user.input}} entity={{node:retrieval.events}} raw={{globals.json}}',
      depth: 0,
      order: 0,
      trigger: [],
      position: 'relative',
    },
  ],
  utilityPrompts: {},
  regexScripts: [],
  other: {},
};

describe('flattened macro keys', () => {
  it('replaceMacros expands dotted and colon-delimited keys', () => {
    const rendered = replaceMacros(
      'time={{narrative.currentTime}} entity={{node:retrieval.events}}',
      {
        'narrative.currentTime': '1901-01-15 23:00',
        'node:retrieval.events': '盐仓事件',
      },
    );

    expect(rendered).toBe('time=1901-01-15 23:00 entity=盐仓事件');
  });

  it('applyRegex expands flattened macro keys in regex patterns', () => {
    const rendered = applyRegex('seed', {
      scripts: [
        {
          id: 'macro-regex',
          name: 'macro-regex',
          enabled: true,
          findRegex: 'seed',
          replaceRegex: '{{narrative.currentTime}}',
          trimRegex: [],
          targets: ['reasoning'],
          view: ['model'],
          runOnEdit: false,
          macroMode: 'raw',
          minDepth: null,
          maxDepth: null,
        },
      ],
      target: 'reasoning',
      view: 'model',
      macros: {
        'narrative.currentTime': '1901-01-15 23:00',
      },
    });

    expect(rendered).toBe('1901-01-15 23:00');
  });

  it('assemblePromptFromPreset passes flattened macro keys through the full pipeline', () => {
    const result = assemblePromptFromPreset({
      preset: presetWithFlattenedMacros,
      macros: {
        'narrative.currentTime': '1901-01-15 23:00',
        'user.input': '检查旧井',
        'node:retrieval.events': '盐仓事件',
        'globals.json': '{"天气":"冷雨"}',
      },
      channel: 'openai',
    });

    expect(result.rendered).toContain('1901-01-15 23:00');
    expect(result.rendered).toContain('检查旧井');
    expect(result.rendered).toContain('盐仓事件');
    expect(result.rendered).toContain('天气');
    expect(result.rendered).toContain('冷雨');
    expect(result.rendered).not.toContain('{{narrative.currentTime}}');
    expect(result.rendered).not.toContain('{{user.input}}');
  });
});
