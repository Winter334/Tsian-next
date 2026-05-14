/**
 * compute 节点 executor（HC-1 / P-H-7 / P-H-8 沙箱守卫）
 *
 * 安全约束（design.md §10）：
 *   - 绝不透传 WorkflowExecutionContext / runtimeEngine / signal 给 script
 *   - 仅注入两个白名单变量：inputs（浅拷贝）/ macros（浅拷贝）
 *   - 用 new Function 构造 async IIFE，"use strict" 预防隐式全局
 *   - 超时由外层 Promise.race 强制：超过 config.timeout (默认 5000ms) → throw 'compute timeout'
 *   - 超时错误使用普通 Error（不带 code 字段；遵循执行计划）
 *   - 返回值必须是非 null object（端口名 → 值 map）；undefined / 非对象 → throw → 节点重试
 *
 * 静态语法预校验（D4）：
 *   - 首次执行某个 node 时调用 new Function(...) 即视为编译，编译失败 throw（fail loud）
 *   - 用 WeakMap<WorkflowNode, Function> 缓存编译产物，避免每次重新编译
 *   - 注意：缓存键是 node 引用，下一次工作流执行会传入新的 node 对象 → 自动失效（不会跨轮串扰）
 */

import type { NodeExecutor } from "@tsian/workflow-engine"
import type { ComputeNodeConfig, WorkflowNode } from "@tsian/contracts"

type ComputeFunction = (
  inputs: Record<string, unknown>,
  macros: Record<string, string>,
) => Promise<unknown>

const compiledCache = new WeakMap<WorkflowNode, ComputeFunction>()

function readComputeConfig(raw: unknown): ComputeNodeConfig {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { script?: unknown }).script !== "string"
  ) {
    throw new Error(`compute node config is invalid: expected { script: string }`)
  }
  return raw as ComputeNodeConfig
}

function compile(node: WorkflowNode, script: string): ComputeFunction {
  const cached = compiledCache.get(node)
  if (cached) return cached
  // new Function 在解析失败时同步抛 SyntaxError，等价于"加载期"静态校验。
  const fn = new Function(
    "inputs",
    "macros",
    `"use strict"; return (async () => { \n${script}\n })();`,
  ) as ComputeFunction
  compiledCache.set(node, fn)
  return fn
}

export const computeExecutor: NodeExecutor = {
  async execute({ node, inputs, context }) {
    const config = readComputeConfig(node.config)
    const timeoutMs =
      typeof config.timeout === "number" && config.timeout > 0 ? config.timeout : 5000

    // HC-1：白名单注入；故意不传 context / signal / runtimeEngine。
    const macrosFromContext = (context as { macros?: Record<string, string> }).macros ?? {}
    const safeInputs = { ...inputs }
    const safeMacros = { ...macrosFromContext }

    const fn = compile(node, config.script)

    let timer: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race<unknown>([
      Promise.resolve().then(() => fn(safeInputs, safeMacros)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("compute timeout")),
          timeoutMs,
        )
      }),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })

    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      throw new Error(
        `compute node "${node.id}" must return a non-null plain object (port → value)`,
      )
    }

    return { outputs: result as Record<string, unknown> }
  },
}
