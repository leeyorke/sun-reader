import { defineConfig } from 'vitest/config';

/**
 * 单元测试配置
 * - 主进程代码（Node 环境）与渲染层纯函数共用 node 环境；
 *   测试文件统一放在 tests/ 下，不进入 tsc 应用编译范围（tsconfig include 仅 src/）。
 * - 涉及 DOM 的组件测试将来可按文件加 @vitest-environment jsdom 注释并补充依赖。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{js,ts}'],
    environment: 'node',
  },
})
