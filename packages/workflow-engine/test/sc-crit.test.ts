/**
 * SC-CRIT-5 / SC-CRIT-6 / SC-CRIT-7 验收测试
 *
 * SC-CRIT-5：compute 节点 5s 超时后调度器正确处理（NODE_RETRY_EXHAUSTED）
 * SC-CRIT-6：mod 工作流含 apply-patch 节点时校验器 loud 拒绝（MOD_REGISTERED_APPLY_PATCH）
 * SC-CRIT-7：外部 abort signal 中止在途轮次，WorkflowAbortError 上抛
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getDefaultBuiltinMod } from '../../../builtin/mods'
import {
  executeWorkflow,
  validateWorkflowDefinition,
  WorkflowValidationError,
  WorkflowAbortError,
  WorkflowNodeError,
} from '../src/index'
import type {
  WorkflowDefinition,
  WorkflowExecutionContext,
} from '../src/index'

// ============================================================================
// 工具函数：构建最小合法工作流（只含 result 节点，不需要 executor 注册也能通过校验）
// ============================================================================

/** 构造一个最小合法工作流定义（source 节点 → result 节点）*/
function makeMinimalDef(overrides?: Partial<WorkflowDefinition>): WorkflowDefinition {
  return {
    nodes: [
      { id: 'source', type: 'compute', config: { script: 'return {}' } },
      { id: 'result1', type: 'result', config: { name: 'out' } },
    ],
    edges: [
      { from: { nodeId: 'source', outputName: 'raw' }, to: { nodeId: 'result1', varName: 'value' } },
    ],
    ...overrides,
  }
}

/** 构造空 executor Map（仅用于校验测试，不会真的执行节点）*/
function makeEmptyContext(): WorkflowExecutionContext {
  return { executors: new Map() }
}

/** 创建一个简单的成功 executor */
function makeSuccessExecutor(outputs: Record<string, unknown> = {}) {
  return {
    execute: vi.fn().mockResolvedValue({ outputs }),
  }
}

// ============================================================================
// SC-CRIT-6：mod 注册 apply-patch loud 拒绝
// ============================================================================

describe('SC-CRIT-6 — mod 工作流拒绝 apply-patch 节点', () => {
  it('isModWorkflow=false 时含 apply-patch 节点不报错', () => {
    const def: WorkflowDefinition = {
      nodes: [
        // apply-patch 节点：需要 patchVarName config + 有入边
        {
          id: 'patcher',
          type: 'apply-patch',
          config: { patchVarName: 'patch' },
        },
        { id: 'result1', type: 'result', config: { name: 'out' } },
      ],
      edges: [
        // 给 apply-patch 节点提供 patchVarName='patch' 的入边（校验4需要）
        {
          from: { nodeId: 'patcher', outputName: 'raw' },
          to: { nodeId: 'result1', varName: 'value' },
        },
        // 虚构一个 source → patcher，需要有节点来自外部
        // 简化：用 patcher 自身充当 source（实际会自引用，但校验只检查 edge from/to 节点存在）
        // 正确做法：给 apply-patch 加一个入边
      ],
    }

    // 注意：patcher 节点没有入边覆盖 patchVarName='patch'，所以这里会报 APPLY_PATCH_INPUT_INCOMPLETE
    // 我们需要一个完整的 apply-patch 设置
    // 直接构造有效 def：source → patcher（with patch varName）→ result
    const fullDef: WorkflowDefinition = {
      nodes: [
        { id: 'source', type: 'compute', config: { script: 'return {raw: "{}"}' } },
        { id: 'patcher', type: 'apply-patch', config: { patchVarName: 'patch' } },
        { id: 'result1', type: 'result', config: { name: 'out' } },
      ],
      edges: [
        {
          from: { nodeId: 'source', outputName: 'raw' },
          to: { nodeId: 'patcher', varName: 'patch' },
        },
        {
          from: { nodeId: 'patcher', outputName: 'raw' },
          to: { nodeId: 'result1', varName: 'value' },
        },
      ],
    }

    // 非 mod 工作流：不应抛 MOD_REGISTERED_APPLY_PATCH
    expect(() =>
      validateWorkflowDefinition(fullDef, { isModWorkflow: false }),
    ).not.toThrow()
  })

  it('isModWorkflow=true 时含 apply-patch 节点抛 WorkflowValidationError(MOD_REGISTERED_APPLY_PATCH)', () => {
    const def: WorkflowDefinition = {
      nodes: [
        { id: 'source', type: 'compute', config: { script: 'return {raw: "{}"}' } },
        { id: 'patcher', type: 'apply-patch', config: { patchVarName: 'patch' } },
        { id: 'result1', type: 'result', config: { name: 'out' } },
      ],
      edges: [
        {
          from: { nodeId: 'source', outputName: 'raw' },
          to: { nodeId: 'patcher', varName: 'patch' },
        },
        {
          from: { nodeId: 'patcher', outputName: 'raw' },
          to: { nodeId: 'result1', varName: 'value' },
        },
      ],
    }

    let caught: unknown
    try {
      validateWorkflowDefinition(def, { isModWorkflow: true })
    } catch (e) {
      caught = e
    }

    // 断言：必须抛 WorkflowValidationError
    expect(caught).toBeInstanceOf(WorkflowValidationError)
    // 断言：code 精确为 MOD_REGISTERED_APPLY_PATCH
    expect((caught as WorkflowValidationError).code).toBe('MOD_REGISTERED_APPLY_PATCH')
  })

  it('isModWorkflow=true 但不含 apply-patch 节点时正常通过', () => {
    const def = makeMinimalDef()
    expect(() =>
      validateWorkflowDefinition(def, { isModWorkflow: true }),
    ).not.toThrow()
  })

  it('isModWorkflow=true 时允许 memory/template 底层节点', () => {
    const def: WorkflowDefinition = {
      nodes: [
        { id: 'query', type: 'memory-query', config: { source: 'collection' } },
        { id: 'write', type: 'memory-write', config: { operationsVarName: 'operations' } },
        { id: 'compose', type: 'template-compose', config: { template: '{{records.json}}' } },
        { id: 'result', type: 'result', config: { name: 'reply' } },
      ],
      edges: [],
    }

    expect(() =>
      validateWorkflowDefinition(def, { isModWorkflow: true }),
    ).not.toThrow()
  })
})

describe('SC-CRIT-6 — 内置模组工作流使用显式记忆节点', () => {
  it('灰盐镇 manifest workflow 不再依赖 legacy retrieval bypass', () => {
    const workflow = getDefaultBuiltinMod().manifest.workflow
    expect(workflow).toBeDefined()
    expect(() =>
      validateWorkflowDefinition(workflow!, { isModWorkflow: true }),
    ).not.toThrow()

    const retrieval = workflow!.nodes.find((node) => node.id === 'retrieval')
    expect(retrieval?.type).toBe('memory-query')
    expect(retrieval?.config).toEqual({ source: 'event-archive' })
    expect(JSON.stringify(workflow)).not.toContain('__retrieval.raw')
    expect(JSON.stringify(workflow)).not.toContain('"bypass"')
    expect(workflow!.nodes.some((node) => node.type === 'apply-patch')).toBe(false)
    expect(workflow!.edges).toContainEqual({
      from: { nodeId: 'retrieval', outputName: 'directEntities' },
      to: { nodeId: 'maintenance', varName: 'retrieval.directEntities' },
    })
    expect(workflow!.edges).toContainEqual({
      from: { nodeId: 'retrieval', outputName: 'archives' },
      to: { nodeId: 'maintenance', varName: 'archives.recent.json' },
    })
  })
})

// ============================================================================
// SC-CRIT-5：compute 节点 5s 超时，调度器收到错误后抛 NODE_RETRY_EXHAUSTED
//
// 路径 A：在测试内 mock 一个"超时 compute executor"，
//   用 fake timer 推进 5000ms，验证调度器抛 WorkflowNodeError(NODE_RETRY_EXHAUSTED)
// ============================================================================

describe('SC-CRIT-5 — compute 节点 5s 超时后调度器抛 NODE_RETRY_EXHAUSTED', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('超时 executor 触发后，调度器最终抛 WorkflowNodeError，code=NODE_RETRY_EXHAUSTED', async () => {
    // mock 一个内部会在 5000ms 后超时的 compute executor
    // 用 AbortSignal + setTimeout 模拟真实 compute executor 行为
    const timeoutMs = 5000

    const timeoutExecutor = {
      execute: vi.fn(({ signal }: { signal: AbortSignal }) => {
        return new Promise<{ outputs: Record<string, unknown> }>((_resolve, reject) => {
          // 模拟 compute executor：5000ms 后 timeout，或收到 abort 提前退出
          const timer = setTimeout(() => {
            reject(new Error(`compute node timed out after ${timeoutMs}ms`))
          }, timeoutMs)

          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('compute node aborted'))
          }, { once: true })
        })
      }),
    }

    const def: WorkflowDefinition = {
      nodes: [
        // maxRetries=0：只执行 1 次，超时就立即报 NODE_RETRY_EXHAUSTED
        { id: 'slow-compute', type: 'compute', config: { script: '', timeout: timeoutMs }, retry: { maxRetries: 0 } },
        { id: 'result1', type: 'result', config: { name: 'out' } },
      ],
      edges: [
        {
          from: { nodeId: 'slow-compute', outputName: 'raw' },
          to: { nodeId: 'result1', varName: 'value' },
        },
      ],
    }

    const context: WorkflowExecutionContext = {
      executors: new Map([
        ['compute', timeoutExecutor],
        // result 节点也需要 executor（否则抛 UNKNOWN_NODE_TYPE 注：实际会抛 WorkflowNodeError）
        ['result', makeSuccessExecutor({ value: null })],
      ]),
    }

    // 启动工作流（不 await，先推进 timer）
    // 立即 attach catch 避免 Node 把还未 await 的 rejection 标为 unhandled
    let caught: unknown
    const workflowPromise = executeWorkflow(def, context).catch((e) => { caught = e })

    // 推进 fake timer 超过 5000ms 触发超时
    await vi.advanceTimersByTimeAsync(timeoutMs + 100)

    // 等工作流 settle（catch 已经收住了）
    await workflowPromise

    // 断言：必须抛 WorkflowNodeError
    expect(caught).toBeInstanceOf(WorkflowNodeError)
    const nodeErr = caught as WorkflowNodeError
    // 断言：nodeId 为 slow-compute
    expect(nodeErr.nodeId).toBe('slow-compute')
    // 断言：code 为 NODE_RETRY_EXHAUSTED
    expect(nodeErr.code).toBe('NODE_RETRY_EXHAUSTED')
    // 断言：attempts 为 1（maxRetries=0 → totalAttempts=1）
    expect(nodeErr.attempts).toBe(1)
  })

  it('下游 result 节点在 compute 超时后不会被执行', async () => {
    const timeoutMs = 5000

    const resultExecutor = makeSuccessExecutor({ value: 'should-not-run' })

    const timeoutExecutor = {
      execute: vi.fn(({ signal }: { signal: AbortSignal }) => {
        return new Promise<{ outputs: Record<string, unknown> }>((_resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`timed out after ${timeoutMs}ms`))
          }, timeoutMs)
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('aborted'))
          }, { once: true })
        })
      }),
    }

    const def: WorkflowDefinition = {
      nodes: [
        { id: 'slow-compute', type: 'compute', config: {}, retry: { maxRetries: 0 } },
        { id: 'result1', type: 'result', config: { name: 'out' } },
      ],
      edges: [
        {
          from: { nodeId: 'slow-compute', outputName: 'raw' },
          to: { nodeId: 'result1', varName: 'value' },
        },
      ],
    }

    const context: WorkflowExecutionContext = {
      executors: new Map([
        ['compute', timeoutExecutor],
        ['result', resultExecutor],
      ]),
    }

    // 立即 attach catch 避免 unhandled rejection
    const workflowPromise = executeWorkflow(def, context).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(timeoutMs + 100)
    await workflowPromise

    // result 节点不应被执行（compute 超时后被 abort，result 入度减未被扣减）
    expect(resultExecutor.execute).not.toHaveBeenCalled()
  })
})

// ============================================================================
// SC-CRIT-7：外部 abort signal 中止在途轮次
// ============================================================================

describe('SC-CRIT-7 — 外部 abort signal 中止在途轮次', () => {
  it('externalSignal.abort() 后工作流抛 WorkflowAbortError', async () => {
    // 用 Deferred 协调 B 节点开始的信号
    let bStartedResolve!: () => void
    const bStartedPromise = new Promise<void>((resolve) => {
      bStartedResolve = resolve
    })

    // A 节点：快速成功（10ms 模拟计算）
    const aExecutor = {
      execute: vi.fn().mockResolvedValue({ outputs: { raw: 'a-output' } }),
    }

    // B 节点：慢节点（100ms），开始后通知 bStarted，然后等 abort 或超时
    const bExecutor = {
      execute: vi.fn(({ signal }: { signal: AbortSignal }) => {
        bStartedResolve() // 通知"B 已开始"
        return new Promise<{ outputs: Record<string, unknown> }>((_resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('B node timed out (should not reach here in test)'))
          }, 200)
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('B node aborted by signal'))
          }, { once: true })
        })
      }),
    }

    const resultExecutor = makeSuccessExecutor({ value: 'result' })

    // 工作流：A → B → result
    const def: WorkflowDefinition = {
      nodes: [
        { id: 'nodeA', type: 'compute', config: {}, retry: { maxRetries: 0 } },
        { id: 'nodeB', type: 'compute', config: {}, retry: { maxRetries: 0 } },
        { id: 'result1', type: 'result', config: { name: 'out' } },
      ],
      edges: [
        {
          from: { nodeId: 'nodeA', outputName: 'raw' },
          to: { nodeId: 'nodeB', varName: 'a_out' },
        },
        {
          from: { nodeId: 'nodeB', outputName: 'raw' },
          to: { nodeId: 'result1', varName: 'value' },
        },
      ],
    }

    const externalController = new AbortController()
    const context: WorkflowExecutionContext = {
      executors: new Map([
        ['compute', {
          execute: vi.fn((args: Parameters<typeof aExecutor.execute>[0]) => {
            // A 节点和 B 节点使用不同策略：根据 node.id 路由
            if (args.node.id === 'nodeA') {
              return aExecutor.execute(args)
            }
            return bExecutor.execute(args)
          }),
        }],
        ['result', resultExecutor],
      ]),
    }

    // spy console.debug 捕获 "aborted N nodes" 日志
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)

    // 启动工作流
    const workflowPromise = executeWorkflow(def, context, {
      signal: externalController.signal,
    })

    // 等 B 节点开始执行
    await bStartedPromise

    // 此时 B 正在运行，触发 abort
    externalController.abort('test-reason')

    // 等工作流完成
    let caught: unknown
    try {
      await workflowPromise
    } catch (e) {
      caught = e
    }

    debugSpy.mockRestore()

    // 断言：必须抛 WorkflowAbortError
    expect(caught).toBeInstanceOf(WorkflowAbortError)

    // 断言：WorkflowAbortError message 含有 abort 相关信息
    // （调度器内部检测到 externalSignal.aborted 后抛 "workflow aborted by caller"）
    expect((caught as WorkflowAbortError).message).toMatch(/aborted/)
  })

  it('abort 后 console.debug 输出 "aborted N nodes" 日志', async () => {
    let bStartedResolve!: () => void
    const bStartedPromise = new Promise<void>((resolve) => {
      bStartedResolve = resolve
    })

    const bExecutor = {
      execute: vi.fn(({ signal }: { signal: AbortSignal }) => {
        bStartedResolve()
        return new Promise<{ outputs: Record<string, unknown> }>((_resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('B timeout'))
          }, 200)
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('B aborted'))
          }, { once: true })
        })
      }),
    }

    // 并行节点：A 和 B 同时 ready（两者都没有入边，入度=0）
    // 当 A 成功后 abort，此时 B 仍在运行 → 应打印 "aborted 1 nodes"
    const aExecutor = makeSuccessExecutor({ raw: 'a' })

    const def: WorkflowDefinition = {
      nodes: [
        { id: 'nodeA', type: 'compute', config: {}, retry: { maxRetries: 0 } },
        { id: 'nodeB', type: 'compute', config: {}, retry: { maxRetries: 0 } },
        // result 节点需要两个上游（并行汇合）
        { id: 'result1', type: 'result', config: { name: 'out' } },
      ],
      edges: [
        {
          from: { nodeId: 'nodeA', outputName: 'raw' },
          to: { nodeId: 'result1', varName: 'a_val' },
        },
        {
          from: { nodeId: 'nodeB', outputName: 'raw' },
          to: { nodeId: 'result1', varName: 'b_val' },
        },
      ],
    }

    const externalController = new AbortController()

    const debugLogs: string[] = []
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation((...args) => {
      debugLogs.push(args.join(' '))
    })

    const context: WorkflowExecutionContext = {
      executors: new Map([
        ['compute', {
          execute: vi.fn((args: Parameters<typeof aExecutor.execute>[0]) => {
            if (args.node.id === 'nodeB') {
              return bExecutor.execute(args)
            }
            return aExecutor.execute(args)
          }),
        }],
        ['result', makeSuccessExecutor({ value: 'ok' })],
      ]),
    }

    const workflowPromise = executeWorkflow(def, context, {
      signal: externalController.signal,
    })

    // 等 B 开始
    await bStartedPromise

    // abort
    externalController.abort('test-reason')

    try {
      await workflowPromise
    } catch {
      // 期望抛 WorkflowAbortError 或 WorkflowNodeError（B 节点抛错触发 abort 传播）
    }

    debugSpy.mockRestore()

    // 断言：console.debug 收到了含 "aborted" 和 "nodes" 的日志
    const abortLog = debugLogs.find((l) => l.includes('aborted') && l.includes('nodes'))
    expect(abortLog).toBeDefined()
    expect(abortLog).toMatch(/aborted \d+ nodes/)
  })

  it('工作流执行前 externalSignal 已 abort，立即抛 WorkflowAbortError', async () => {
    const controller = new AbortController()
    controller.abort('pre-aborted')

    const def = makeMinimalDef()
    const context = makeEmptyContext()

    let caught: unknown
    try {
      await executeWorkflow(def, context, { signal: controller.signal })
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(WorkflowAbortError)
  })
})
