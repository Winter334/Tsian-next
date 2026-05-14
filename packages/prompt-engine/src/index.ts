export * from './core/types';
export * from './core/convert';

// 功能模块（隔离实现，便于单独调试）
export * from './core/modules/history';
export * from './core/modules/worldbook';
export * from './core/modules/regex';
export * from './core/modules/macro';
export * from './core/modules/variables';
export * from './core/modules/assemble';
export * from './core/modules/pipeline';
export * from './core/modules/inputs';
export * from './core/modules/build';

// 渠道转换层
export * as Channels from './core/channels/index';

// Tsian 高层 API（包装 buildPrompt + channel）
export * from './tsian/assemble';
