<template>
  <section class="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden bg-[#24251f]">
    <!-- Session sidebar -->
    <aside class="flex min-h-0 flex-col border-r border-neon-deep/30 bg-[#2a271f]">
      <div class="flex items-center justify-between border-b border-neon-deep/25 px-3 py-2.5">
        <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">会话</p>
        <button
          type="button"
          class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/40 bg-panel/50 text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
          :disabled="sessionCreating"
          title="新建会话"
          @click="handleCreateSession"
        >
          <Plus v-if="!sessionCreating" class="h-3.5 w-3.5" aria-hidden="true" />
          <Loader2 v-else class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-auto py-1">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="group relative flex items-center transition-colors"
          :class="session.id === activeSessionId ? 'bg-neon/10' : 'hover:bg-panel/40'"
        >
          <button
            type="button"
            class="retro-focus min-w-0 flex-1 px-3 py-2 text-left"
            :class="session.id === activeSessionId ? 'text-neon' : 'text-text-dim group-hover:text-text-main'"
            @click="handleSelectSession(session.id)"
          >
            <span class="flex items-center gap-1.5">
              <Loader2
                v-if="runningSessionIds.has(session.id)"
                class="h-3 w-3 shrink-0 animate-spin text-neon"
                title="生成中"
                aria-label="生成中"
              />
              <span class="block truncate text-xs font-bold">{{ session.title }}</span>
            </span>
            <span class="mt-0.5 block font-mono text-[10px] text-text-dim/80">
              {{ formatSessionTime(session.updatedAt) }}
              <span v-if="runningSessionIds.has(session.id) && session.id !== activeSessionId" class="text-neon">· 后台生成中</span>
            </span>
          </button>
          <div
            class="flex shrink-0 items-center gap-1 pr-2 transition-opacity"
            :class="session.id === activeSessionId ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
          >
            <button
              type="button"
              class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/40 bg-panel/50 text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
              :disabled="sessionRenaming"
              title="重命名会话"
              @click.stop="handleStartRename(session.id)"
            >
              <Pencil class="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="retro-focus grid h-6 w-6 place-items-center border border-danger/40 bg-danger/8 text-danger/85 transition-colors hover:bg-danger/20 hover:text-danger"
              :disabled="sessionDeleting"
              title="删除会话"
              @click.stop="handleDeleteSessionById(session.id)"
            >
              <Trash2 class="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
          <span
            v-if="session.id === activeSessionId"
            class="absolute inset-y-1 left-0 w-0.5 bg-neon"
            aria-hidden="true"
          />
        </div>
        <p
          v-if="sessions.length === 0 && !sessionCreating"
          class="px-3 py-6 text-center text-xs text-text-dim/70"
        >
          暂无会话
        </p>
      </div>
    </aside>

    <!-- Chat panel -->
    <section class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header class="flex flex-wrap items-center justify-between gap-2 border-b border-neon-deep/30 bg-[#2d2a23] px-4 py-2.5">
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="grid h-7 w-7 shrink-0 place-items-center border border-neon/45 bg-neon/10 text-neon">
            <Bot class="h-4 w-4" aria-hidden="true" />
          </span>
          <div class="min-w-0 leading-tight">
            <h1 class="truncate text-sm font-bold text-text-main">桌面助手</h1>
            <p class="truncate font-mono text-[10px] uppercase tracking-wider text-text-dim">
              {{ cardTitle }}
            </p>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <!-- 预设(服务商)下拉:一级,立即持久化.
               有任意会话(含后台)生成中时禁用——防止切走会话的后台 turn 与
               新选预设/模型打架(正在跑的 turn 已锁定 config,但全局 agent.json
               被改会影响下一次发送)。治标方案:运行中不让动模型配置。 -->
          <Select
            :model-value="assistantProviderPresetId || '__platform_default__'"
            :disabled="runningSessionIds.size > 0"
            @update:model-value="(value) => handlePresetChange(value as string)"
          >
            <SelectTrigger
              class="h-8 w-auto min-w-[6rem] max-w-[10rem] px-2 text-[11px]"
              :title="runningSessionIds.size > 0 ? '有会话正在生成，暂不可切换服务商' : '服务商预设'"
            >
              <SelectValue placeholder="平台默认" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__platform_default__">平台默认</SelectItem>
              <SelectItem
                v-for="preset in providerPresets"
                :key="preset.id"
                :value="preset.id"
              >
                {{ preset.name }}
              </SelectItem>
            </SelectContent>
          </Select>

          <!-- 模型下拉:二级,依赖预设选中.列出该预设的 models.
               额外禁用条件:有任意会话生成中(同预设下拉理由)。 -->
          <Select
            :model-value="assistantModelId || '__preset_default__'"
            :disabled="!assistantProviderPresetId || assistantModels.length === 0 || runningSessionIds.size > 0"
            @update:model-value="(value) => handleModelChange(value as string)"
          >
            <SelectTrigger
              class="h-8 w-auto min-w-[6rem] max-w-[10rem] px-2 text-[11px]"
              :title="runningSessionIds.size > 0 ? '有会话正在生成，暂不可切换模型' : (!assistantProviderPresetId ? '请先选择服务商' : '模型')"
            >
              <SelectValue placeholder="预设默认" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__preset_default__">预设默认</SelectItem>
              <SelectItem
                v-for="model in assistantModels"
                :key="model.id"
                :value="model.id"
              >
                {{ model.label }}
              </SelectItem>
            </SelectContent>
          </Select>

          <!-- 上下文窗口环:已用 input tokens / contextWindow.每轮回复后更新. -->
          <ContextRing
            :used="contextUsed"
            :total="contextTotal"
            :size="28"
          />

          <button
            type="button"
            class="retro-focus grid h-8 w-8 place-items-center border border-neon-deep/55 bg-elevated text-text-dim hover:text-neon"
            :title="configButtonTitle"
            aria-label="助手配置"
            @click="showAssistantConfig = true"
          >
            <Settings class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <main
        class="relative min-h-0 overflow-hidden"
        :class="{ 'ring-2 ring-neon/40': dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop="handleDrop"
      >
        <!-- Error state -->
        <div v-if="errorMessage" class="grid h-full min-h-[200px] place-items-center p-6">
          <div class="max-w-md border border-danger/45 bg-danger/8 p-5 text-center">
            <p class="font-mono text-xs uppercase tracking-wider text-danger">助手不可用</p>
            <p class="mt-2 text-sm leading-6 text-text-dim">{{ errorMessage }}</p>
            <button
              type="button"
              class="retro-button retro-focus mt-4 inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
              @click="errorMessage = ''"
            >
              关闭
            </button>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else-if="messages.length === 0" class="grid h-full min-h-[260px] place-items-center p-6">
          <div class="max-w-md text-center">
            <span class="mx-auto grid h-14 w-14 place-items-center border border-neon/40 bg-neon/8 text-neon">
              <Sparkles class="h-7 w-7" aria-hidden="true" />
            </span>
            <p class="mt-4 font-mono text-xs uppercase tracking-[0.22em] text-neon">桌面助手</p>
            <p class="mt-2 text-sm leading-6 text-text-dim">
              向助手询问当前游戏卡的内容、Agent、Skill 或编辑方式。
            </p>
            <div class="mt-5 flex flex-wrap justify-center gap-2">
              <button
                v-for="suggestion in suggestions"
                :key="suggestion.label"
                type="button"
                class="retro-focus border border-neon-deep/40 bg-panel/50 px-3 py-1.5 font-mono text-xs text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
                @click="sendSuggestion(suggestion.message)"
              >
                {{ suggestion.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- Conversation -->
        <div
          v-else
          ref="messageListRef"
          class="h-full overflow-auto"
          @scroll="handleScroll"
        >
          <div class="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-5">
            <div
              v-for="(msg, index) in messages"
              :key="index"
              class="group flex gap-3"
              :class="msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'"
            >
              <span
                class="grid h-7 w-7 shrink-0 place-items-center border"
                :class="msg.role === 'user'
                  ? 'border-neon-deep/45 bg-elevated text-text-main'
                  : 'border-neon/45 bg-neon/10 text-neon'"
              >
                <User v-if="msg.role === 'user'" class="h-3.5 w-3.5" aria-hidden="true" />
                <Bot v-else class="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div class="flex min-w-0 max-w-[calc(100%-2.75rem)] flex-col gap-1.5">
                <!-- 过程节点(assistant):思考/工具按发生顺序纵向平铺,各独立折叠.
                     放在回复正文框之外,用轻量"过程元信息"样式(左竖线+淡背景),与聊天框视觉分离.
                     reka-ui Collapsible 的 open=true 为展开,而节点字段 collapsed=true 为折叠,
                     语义相反,故用 :open="!node.collapsed" 反转绑定,finally/初值保持原意. -->
                <template v-if="msg.role === 'assistant' && msg.timeline && msg.timeline.length > 0">
                  <div class="flex flex-col gap-1">
                    <template v-for="(seg, segIdx) in groupTimelineForRender(msg.timeline)" :key="segIdx">
                      <!-- 单个节点:interim / thought / ask -->
                      <template v-if="seg.kind === 'node'">
                        <!-- 过渡文本节点(tool_calls 轮模型在调用工具前输出的可见文本,
                             如"我先看一下…").当正常回复处理:正文样式渲染,始终展开,
                             平铺在该轮工具节点之前(timeline 按发生顺序). -->
                        <div
                          v-if="seg.node.type === 'interim'"
                          class="prose-chat break-words text-sm leading-6"
                          v-html="renderMarkdown(seg.node.text)"
                        />
                        <!-- 思考节点(tool_calls 轮的推理文本,默认折叠,可展开回看) -->
                        <Collapsible
                          v-else-if="seg.node.type === 'thought'"
                          :open="!seg.node.collapsed"
                          @update:open="(v) => (seg.node.collapsed = !v)"
                          class="border-l border-neon-deep/30 bg-panel/15"
                        >
                          <CollapsibleTrigger class="retro-focus flex w-full items-center gap-1.5 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:text-neon">
                            <ChevronRight
                              class="h-3 w-3 transition-transform"
                              :class="seg.node.collapsed ? 'rotate-0' : 'rotate-90'"
                              aria-hidden="true"
                            />
                            <Brain class="h-3 w-3" aria-hidden="true" />
                            <span>思考</span>
                          </CollapsibleTrigger>
                          <CollapsibleContent class="ml-0.5 border-l border-neon-deep/15 pl-2.5 py-1.5">
                            <div class="prose-chat text-xs leading-5 text-text-dim" v-html="renderMarkdown(seg.node.text)" />
                          </CollapsibleContent>
                        </Collapsible>

                        <!-- ask_user 节点：只读 Q&A 记录。活跃提问不在 timeline 渲染
                             （由 footer 输入框变形承载，问题常驻焦点位、不与普通输入框并存）；
                             仅回答/取消后作为历史记录写入此处，可折叠回看。 -->
                        <Collapsible
                          v-else-if="seg.node.type === 'ask'"
                          :open="!seg.node.collapsed"
                          @update:open="(v) => (seg.node.collapsed = !v)"
                          class="border border-neon-deep/40 bg-neon/5"
                        >
                          <CollapsibleTrigger class="retro-focus flex w-full items-center gap-1.5 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:text-neon">
                            <ChevronRight
                              class="h-3 w-3 transition-transform"
                              :class="seg.node.collapsed ? 'rotate-0' : 'rotate-90'"
                              aria-hidden="true"
                            />
                            <HelpCircle class="h-3 w-3" aria-hidden="true" />
                            <span>{{ seg.node.cancelled ? "已取消提问" : "已回答" }}</span>
                          </CollapsibleTrigger>
                          <CollapsibleContent class="px-2.5 py-2">
                            <p class="prose-chat text-sm leading-6 text-text-main" v-html="renderMarkdown(seg.node.question)" />
                            <div class="mt-2 border-l border-neon-deep/30 bg-panel/30 px-2.5 py-1.5">
                              <p v-if="seg.node.cancelled" class="text-xs italic text-text-dim">已取消</p>
                              <template v-else>
                                <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">你的回答</p>
                                <p class="mt-0.5 prose-chat text-sm leading-6 text-text-main">{{ seg.node.answer }}</p>
                              </template>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </template>

                      <!-- 工具调用组:相邻 tool 节点合并成一行自然语言摘要.
                           不展示工具返回（结构化文本玩家看不懂），只显摘要+状态.
                           有 loading/running 时显示 spinner，全部完成显示 ✓/✗.
                           可展开看每个工具的标题行（工具名+状态），不显 output. -->
                      <Collapsible
                        v-else
                        :open="!toolGroupCollapsed(`${index}-${segIdx}`)"
                        @update:open="(v) => (toolGroupCollapsedMap[`${index}-${segIdx}`] = !v)"
                        class="border-l border-neon-deep/30 bg-panel/15"
                      >
                        <CollapsibleTrigger class="retro-focus flex w-full items-center gap-1.5 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:text-neon">
                          <ChevronRight
                            class="h-3 w-3 transition-transform"
                            :class="toolGroupCollapsed(`${index}-${segIdx}`) ? 'rotate-0' : 'rotate-90'"
                            aria-hidden="true"
                          />
                          <Wrench class="h-3 w-3" aria-hidden="true" />
                          <span>{{ seg.summary }}</span>
                          <span
                            :class="{
                              'text-neon/60': seg.tools.some((t) => t.status === 'loading' || t.status === 'running'),
                              'text-neon': seg.tools.every((t) => t.status === 'success'),
                              'text-red-400': seg.tools.some((t) => t.status === 'failed'),
                            }"
                          >
                            <Loader2 v-if="seg.tools.some((t) => t.status === 'loading' || t.status === 'running')" class="inline h-3 w-3 animate-spin" aria-hidden="true" />
                            <template v-else-if="seg.tools.every((t) => t.status === 'success')">✓</template>
                            <template v-else-if="seg.tools.some((t) => t.status === 'failed')">✗</template>
                          </span>
                        </CollapsibleTrigger>
                        <CollapsibleContent class="ml-0.5 border-l border-neon-deep/15 pl-2.5 py-1.5">
                          <div v-for="t in seg.tools" :key="t.id" class="flex items-center gap-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-dim">
                            <Wrench class="h-2.5 w-2.5" aria-hidden="true" />
                            <span>{{ agentCallDisplay(t.output)?.title ?? t.name }}</span>
                            <span
                              :class="{
                                'text-neon/60': t.status === 'loading' || t.status === 'running',
                                'text-neon': t.status === 'success',
                                'text-red-400': t.status === 'failed',
                              }"
                            >
                              <Loader2 v-if="t.status === 'loading' || t.status === 'running'" class="inline h-3 w-3 animate-spin" aria-hidden="true" />
                              <template v-else-if="t.status === 'success'">✓</template>
                              <template v-else-if="t.status === 'failed'">✗</template>
                            </span>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </template>
                  </div>
                </template>

                <!-- 回复正文泡:user 恒渲染;assistant 仅在有正文/流式、等待首 token、或无过程节点时渲染。
                     活跃 ask 期间助手在等用户回答而非思考,空泡 + 打字点会误导,故整泡隐藏。
                     若只有过程节点且已结束,也不渲染打字点,避免中断后永久三点动画。 -->
                <div
                  v-if="msg.role === 'user' || msg.streamingText || msg.content || (sending && index === messages.length - 1 && !activeAsk) || !(msg.timeline && msg.timeline.length > 0)"
                  class="break-words text-sm leading-6"
                  :class="msg.role === 'user'
                    ? 'whitespace-pre-wrap border border-neon-deep/35 bg-panel/55 px-3.5 py-2.5 text-text-main'
                    : 'text-text-main'"
                >
                <template v-if="msg.role === 'assistant'">
                  <!-- 当前轮流式文本:尚未分类(tool_calls→归入 thought 折叠;stop→写入 content) -->
                  <div v-if="msg.streamingText" class="prose-chat" v-html="renderMarkdown(msg.streamingText)" />
                  <!-- 最终回复 / 历史 / text 模式:无流式时展示 content -->
                  <div v-else-if="msg.content" class="flex flex-col gap-2">
                    <template v-for="(part, partIdx) in renderAssistantContentSegments(msg.content)" :key="partIdx">
                      <details v-if="part.kind === 'thought'" class="assistant-think rounded-sm border border-neon-deep/30 bg-panel/20 px-2 py-1">
                        <summary class="cursor-pointer select-none font-mono text-[11px] uppercase tracking-wider text-text-dim hover:text-neon">思考</summary>
                        <div class="prose-chat mt-1 text-xs leading-5 text-text-dim" v-html="renderMarkdown(part.text)" />
                      </details>
                      <div v-else class="prose-chat" v-html="renderMarkdown(part.text)" />
                    </template>
                  </div>
                  <!-- 等待首个 token:过程/流式/回复皆空时显示打字点(替代独立占位框) -->
                  <div v-else-if="sending && index === messages.length - 1" class="flex items-center gap-1.5">
                    <span class="typing-dot" />
                    <span class="typing-dot" />
                    <span class="typing-dot" />
                  </div>
                </template>
                <template v-else>
                  <!-- 用户消息附件:图片缩略图 -->
                  <div
                    v-if="msg.attachments && msg.attachments.some((a) => a.kind === 'image')"
                    class="mb-2 flex flex-wrap gap-2"
                  >
                    <AttachmentImage
                      v-for="att in msg.attachments.filter((a) => a.kind === 'image')"
                      :key="att.path"
                      :path="att.path"
                      :name="att.name"
                    />
                  </div>
                  <!-- 用户消息附件:文本文件标识 -->
                  <div
                    v-if="msg.attachments && msg.attachments.some((a) => a.kind === 'text')"
                    class="mb-2 flex flex-wrap gap-2"
                  >
                    <div
                      v-for="att in msg.attachments.filter((a) => a.kind === 'text')"
                      :key="att.path"
                      class="flex items-center gap-1.5 border border-neon-deep/40 bg-panel/40 px-2 py-1"
                    >
                      <FileText class="h-3.5 w-3.5 text-text-dim" aria-hidden="true" />
                      <span class="text-xs text-text-main">{{ att.name }}</span>
                      <span class="text-[10px] text-text-dim">{{ formatFileSize(att.size) }}</span>
                    </div>
                  </div>
                  <span v-if="msg.content">{{ msg.content }}</span>
                </template>
                </div>

                <!-- 消息工具条:hover 显示,复制(全部)+编辑重发(仅 user,发送中禁用) -->
                <div
                  class="flex items-center gap-1 px-1 transition-opacity"
                  :class="[
                    msg.role === 'user' ? 'justify-end' : 'justify-start',
                    copiedIndex === index || editingIndex === index ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
                  ]"
                >
                  <button
                    type="button"
                    class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/30 bg-panel/40 text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
                    :title="copiedIndex === index ? '已复制' : '复制消息'"
                    @click="handleCopyMessage(index)"
                  >
                    <Check v-if="copiedIndex === index" class="h-3 w-3 text-neon" aria-hidden="true" />
                    <Copy v-else class="h-3 w-3" aria-hidden="true" />
                  </button>
                  <button
                    v-if="msg.role === 'user'"
                    type="button"
                    class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/30 bg-panel/40 text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
                    :disabled="sending"
                    :title="sending ? '请等待当前回复完成' : '编辑并重新发送'"
                    @click="handleEditUserMessage(index)"
                  >
                    <Pencil class="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <transition name="fade">
          <button
            v-if="showJumpToBottom"
            type="button"
            class="retro-focus absolute bottom-3 left-1/2 grid h-8 w-8 -translate-x-1/2 place-items-center border border-neon/50 bg-[#2d2a23] text-neon shadow-[0_4px_14px_rgba(0,0,0,0.4)]"
            aria-label="跳到最新消息"
            @click="scrollToBottom(true)"
          >
            <ChevronDown class="h-4 w-4" aria-hidden="true" />
          </button>
        </transition>
      </main>

      <footer class="border-t border-neon-deep/30 bg-[#2d2a23] px-4 py-3">
        <!-- ask 模式:输入框变形为提问区。问题常驻 footer 焦点位(底部固定,滚动不影响),
             普通输入框/发送/停止整体隐藏,避免两个输入框并存。回答/取消后回到普通输入态。 -->
        <div v-if="activeAsk" class="mx-auto max-w-3xl border border-neon/30 bg-neon/5 px-3.5 py-3">
          <div class="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-neon">
            <HelpCircle class="h-3 w-3" aria-hidden="true" />
            <span>助手提问</span>
          </div>
          <p class="prose-chat mt-1.5 text-sm leading-6 text-text-main" v-html="renderMarkdown(activeAsk.question)" />

          <!-- 选项按钮 -->
          <div v-if="activeAsk.options && activeAsk.options.length > 0" class="mt-2.5 grid gap-1.5">
            <button
              v-for="opt in activeAsk.options"
              :key="opt"
              type="button"
              class="retro-focus border border-neon-deep/35 bg-panel/55 px-3 py-2 text-left text-sm text-text-main transition-colors hover:border-neon/55 hover:bg-neon/10"
              @click="answerAsk(activeAsk.requestId, opt)"
            >{{ opt }}</button>
          </div>

          <!-- 自定义输入(allowCustom 为 true 时);ask 期间唯一的输入框 -->
          <div v-if="activeAsk.allowCustom" class="mt-2.5 flex items-center gap-2">
            <input
              ref="askCustomInputRef"
              type="text"
              class="retro-focus h-10 flex-1 border border-neon-deep/40 bg-panel/55 px-3 text-sm text-text-main placeholder:text-text-dim focus:border-neon/55"
              placeholder="自定义回答…"
              spellcheck="false"
              @keydown.enter.prevent="submitCustomAsk(activeAsk.requestId, askCustomInputRef?.value ?? '')"
            >
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-10 shrink-0 items-center justify-center gap-2 px-4 font-mono text-xs"
              @click="submitCustomAsk(activeAsk.requestId, askCustomInputRef?.value ?? '')"
            >
              <Send class="h-4 w-4" aria-hidden="true" />
              提交
            </button>
          </div>

          <!-- 取消:resolve ask 为 cancelled,turn 继续(助手收尾);取消后回到普通输入态,若助手继续生成可再停止 -->
          <div class="mt-2.5 flex justify-end">
            <button
              type="button"
              class="retro-focus border border-neon-deep/30 bg-panel/40 px-3 py-1.5 text-xs text-text-dim transition-colors hover:border-red-400/50 hover:text-red-400"
              @click="cancelAsk(activeAsk.requestId)"
            >取消</button>
          </div>
        </div>

        <form v-else class="mx-auto max-w-3xl" @submit.prevent="send">
          <!-- 附件预览区 -->
          <div
            v-if="pendingAttachments.length > 0"
            class="mb-2 flex flex-wrap gap-2"
          >
            <div
              v-for="(att, index) in pendingAttachments"
              :key="att.ref.path"
              class="group relative flex items-center gap-2 border border-neon-deep/40 bg-panel/55 px-2 py-1.5"
            >
              <img
                v-if="att.previewUrl"
                :src="att.previewUrl"
                :alt="att.ref.name"
                class="h-10 w-10 object-cover"
              />
              <FileText
                v-else
                class="h-5 w-5 text-text-dim"
                aria-hidden="true"
              />
              <div class="flex flex-col">
                <span class="max-w-[140px] truncate text-xs text-text-main">{{ att.ref.name }}</span>
                <span class="text-[10px] text-text-dim">{{ formatFileSize(att.ref.size) }}</span>
              </div>
              <button
                type="button"
                class="ml-1 text-text-dim hover:text-neon"
                title="移除附件"
                @click="removePendingAttachment(index)"
              >
                <X class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div class="flex items-end gap-2">
            <!-- 附件按钮 -->
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-11 shrink-0 items-center justify-center px-3 font-mono text-xs"
              :disabled="sending"
              title="添加附件"
              @click="fileInputRef?.click()"
            >
              <Paperclip class="h-4 w-4" aria-hidden="true" />
            </button>
            <input
              ref="fileInputRef"
              type="file"
              class="hidden"
              :accept="ACCEPTED_FILE_TYPES"
              multiple
              @change="handleFilePick"
            />
            <textarea
              ref="inputRef"
              v-model="inputText"
              class="retro-focus max-h-[160px] min-h-[44px] flex-1 resize-none overflow-y-auto border border-neon-deep/40 bg-panel/55 px-3.5 py-2.5 text-sm leading-6 text-text-main placeholder:text-text-dim focus:border-neon/55"
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              rows="1"
              :disabled="sending"
              @keydown.enter.exact.prevent="send"
              @input="autoGrow"
              @paste="handlePaste"
            />
            <button
              type="submit"
              class="retro-button retro-focus inline-flex h-11 shrink-0 items-center justify-center gap-2 px-4 font-mono text-xs"
              :disabled="sending || (!inputText.trim() && pendingAttachments.length === 0)"
              title="发送"
            >
              <Send class="h-4 w-4" aria-hidden="true" />
              发送
            </button>
            <button
              v-if="sending"
              type="button"
              class="retro-button retro-focus inline-flex h-11 shrink-0 items-center justify-center gap-2 px-4 font-mono text-xs"
              title="停止生成"
              @click="stopGenerating"
            >
              <Square class="h-4 w-4" aria-hidden="true" />
              停止
            </button>
          </div>
        </form>
      </footer>
    </section>

    <!-- Rename modal -->
    <div
      v-if="renaming"
      class="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
      @click.self="closeRename"
    >
      <div class="w-full max-w-sm border border-neon/40 bg-[#2d2a23] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.5)]">
        <p class="font-mono text-xs uppercase tracking-wider text-neon">重命名会话</p>
        <input
          ref="renameInputRef"
          v-model="renaming"
          class="retro-focus mt-3 w-full border border-neon-deep/40 bg-panel/55 px-3 py-2 text-sm text-text-main"
          @keydown.enter.prevent="handleConfirmRename"
          @keydown.esc.prevent="closeRename"
        />
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
            @click="closeRename"
          >
            取消
          </button>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
            :disabled="sessionRenaming"
            @click="handleConfirmRename"
          >
            确认
          </button>
        </div>
      </div>
    </div>

    <!-- Assistant config floating window (slot mode, bypasses the dialog composable) -->
    <FloatingWindow
      v-if="showAssistantConfig"
      title="助手配置"
      width-class="max-w-lg"
      @close="showAssistantConfig = false"
    >
      <AssistantConfigPanel @change="handleAssistantConfigChange" @close="showAssistantConfig = false" />
    </FloatingWindow>
  </section>
</template>

<script setup lang="ts">
import { ref, reactive, nextTick, computed, watch, onBeforeUnmount, onMounted } from "vue"
import { useRoute } from "vue-router"
import "highlight.js/styles/atom-one-dark.min.css"
import { Bot, Check, ChevronDown, ChevronRight, Copy, FileText, HelpCircle, Loader2, Paperclip, Pencil, Plus, Send, Settings, Sparkles, Square, Trash2, User, Wrench, Brain, X } from "lucide-vue-next"
import type { ConversationMessageRecord } from "@tsian/contracts"
import FloatingWindow from "@/components/feedback/FloatingWindow.vue"
import AssistantConfigPanel from "@/components/assistant/AssistantConfigPanel.vue"
import ContextRing from "@/components/assistant/ContextRing.vue"
import { ACTIVE_CARD_CHANGED_EVENT, isActiveCardChangedEvent } from "@/lib/platform-events"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { useAssistantTimeline, type ChatMessage, type AssistantTimelineNode } from "@/composables/useAssistantTimeline"
import { confirm } from "@/composables/useConfirm"
import {
  subscribeInteractionRequest,
  resolveInteractionRequest,
} from "../interaction-events"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  runAssistantChat,
  getPlatformActiveGameCard,
  waitForPlatformHostReady,
  getLocalAssistantProviderPreset,
  updateLocalAssistantProviderPreset,
  updateLocalAssistantModel,
} from "../platform-host"
import { renderMarkdown } from "../lib/markdown"
import {
  createAssistantSession,
  deleteAssistantSession,
  ensureAssistantSession,
  getActiveAssistantSessionId,
  getAssistantAttachmentBlob,
  getAssistantSessionMessages,
  listAssistantSessions,
  loadContextUsed,
  loadScrollTop,
  renameAssistantSession,
  saveAssistantAttachment,
  saveAssistantSessionMessages,
  saveContextUsed,
  saveScrollTop,
  setActiveAssistantSessionId,
  type AssistantSessionSummary,
} from "../storage"
import type { AgentContextToolCall, AttachmentRef, TurnToolOutput } from "@tsian/contracts"
import AttachmentImage from "@/components/assistant/AttachmentImage.vue"
import {
  agentCallDisplay,
  mapStoredMessagesToChat,
  tryParseAgentCallOutput,
  chatToStoredMessages,
} from "./assistant-message-mappers"


// AssistantTimelineNode / ChatMessage 类型由 useAssistantTimeline composable 导出,
// 这里 import 复用(见上方 import 块),避免视图 ↔ composable 循环依赖.

/** 待发附件草稿(paste/drop/pick 添加后,send 前可移除). */
interface PendingAttachment {
  ref: AttachmentRef
  previewUrl?: string  // 图片缩略图 URL (URL.createObjectURL)
}

const suggestions = [
  { label: "这张卡有哪些 Agent？", message: "这张游戏卡里有哪些 Agent？分别负责什么？" },
  { label: "怎么编辑游戏卡？", message: "我想编辑当前游戏卡，应该从哪里开始？" },
  { label: "介绍游戏卡结构", message: "介绍一下当前游戏卡的内容结构。" },
]

/** ask_user 活跃提问状态(按 turn 隔离,存于 turn state)。 */
interface ActiveAskState {
  requestId: string
  question: string
  options?: string[]
  allowCustom?: boolean
}

/** recordAskNode 回调入参类型(镜像 useAssistantTimeline.recordAskNode)。 */
interface RecordAskInput {
  requestId: string
  question: string
  options?: string[]
  allowCustom?: boolean
  answer?: string
  cancelled?: boolean
}

/**
 * 按会话隔离的进行中 turn 状态。桌面助手支持切走会话时让 turn 在后台继续
 * 跑完(不中断),切回时把流式消息重新挂回 messages。每个 turn 持有自己专属的
 * assistantMsg/userMsg(reactive,被 send() push 进当时的 messages.value;切走后
 * 不在 messages.value 但仍被本 state 闭包持有,回调继续 mutate 不影响新会话)。
 * 不含 activeAsk——活跃提问统一存响应式 activeAskBySession(见下),供 computed
 * 与会话列表指示器可靠追踪;本 state 只存非响应式的控制句柄/消息引用。
 */
interface AssistantTurnState {
  sessionId: string
  controller: AbortController
  userMsg: ChatMessage
  assistantMsg: ChatMessage
  flush: () => void
  recordAsk: (input: RecordAskInput) => void
  finalize: () => void
  timeline: AssistantTimelineNode[]
}

// 按会话隔离的进行中 turn 注册表(普通 Map:含 AbortController,不可深 reactive)。
// 内容对象(userMsg/assistantMsg)是 reactive,但 Map 本身不响应式——运行态追踪
// 走下面的 runningSessionIds / activeAskBySession 两个响应式集合。
const assistantTurns = new Map<string, AssistantTurnState>()
// ask 请求路由:requestId → sessionId。host 的 onAskUserRequest 回调填充,
// 用于把全局 interaction-request 事件路由到正确的(可能是后台的)turn。
const askRequestSession = new Map<string, string>()
// 响应式:正在运行的会话 id 集合(含前台与后台 turn)。供 sending computed 与
// 会话列表"生成中"指示器可靠追踪——assistantTurns 是普通 Map 不响应式,UI 靠
// 本集合在 turn 起/止(add/delete)时触发更新。
const runningSessionIds = reactive(new Set<string>())
// 响应式:各会话的活跃 ask_user 提问(key=sessionId)。供 activeAsk computed
// 追踪——把提问状态从 turn state 抽出统一管理,避免普通 Map value 字段赋值
// 不触发更新的缺陷。answer/cancel 时 delete 本 Map,computed 自动反映。
const activeAskBySession = reactive(new Map<string, ActiveAskState>())

const sessions = ref<AssistantSessionSummary[]>([])
const activeSessionId = ref<string | null>(null)
const messages = ref<ChatMessage[]>([])
const inputText = ref("")
// sending 语义改为"当前显示会话是否有进行中 turn"(支持后台 turn:切走时当前会话
// 无 turn→sending false,footer 恢复可输入;切回有后台 turn 的会话→sending true)。
// 读响应式 runningSessionIds,turn 起/止时 add/delete 触发可靠更新。
const sending = computed(() =>
  activeSessionId.value ? runningSessionIds.has(activeSessionId.value) : false,
)
const errorMessage = ref("")
const cardName = ref("")
const messageListRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const showJumpToBottom = ref(false)
const pendingAttachments = ref<PendingAttachment[]>([])
const dragOver = ref(false)
// 焦点切换滚动保持:窗口改用 CSS display:none(最小化)而非从 DOM 移除后,
// 切焦(非最小化)窗口常驻可见、scrollTop 天然保留,不再被浏览器异步重置.
// 仍把 scrollTop 持久化到会话(assistant-scroll-top:{id}),供硬刷新/重开
// 场景恢复;进入会话/获焦时单次兜底恢复(若极端情况下被重置为 0 则补回).
const route = useRoute()
const ASSISTANT_ROUTE_PATH = "/assistant"
// rAF 节流标记:scroll 期间每帧最多写一次 scrollTop 到存储.
let scrollPersistScheduled = false
// 复制反馈:记下刚复制的消息索引,显示「已复制」勾,短暂后自动清除.
const copiedIndex = ref<number | null>(null)
// 编辑中:正在通过工具条编辑的消息索引(仅用于工具条透明度保持).
const editingIndex = ref<number | null>(null)
// Smart scroll: auto-scroll only while the user is pinned near the bottom.
const userPinnedToBottom = ref(true)
// ask_user 订阅的 unsubscribe 闭包（onMounted 注册、onBeforeUnmount 释放）。
let unsubscribeInteractionRequest: (() => void) | null = null
// 当前活跃提问:派生自当前显示会话(支持后台 turn 的 ask 路由)。
// read 响应式 activeAskBySession,answer/cancel 时 delete 本 Map 触发更新,
// footer 随之在提问态/普通输入态间切换。
const activeAsk = computed<ActiveAskState | null>(() =>
  activeSessionId.value
    ? activeAskBySession.get(activeSessionId.value) ?? null
    : null,
)
// 工具调用组的折叠状态（key = "msgIdx-segIdx", 每条消息的每个段独立）.
// tool 节点不再用自身 collapsed 字段（因为合并成组了），用这个 map 管理.
const toolGroupCollapsedMap = reactive<Record<string, boolean>>({})
function toolGroupCollapsed(key: string): boolean {
  // 默认折叠（true），只有显式设为 false 时展开
  return toolGroupCollapsedMap[key] !== false
}
// 提问区自定义输入框（allowCustom 时唯一输入框），ask 触发后聚焦。
const askCustomInputRef = ref<HTMLInputElement | null>(null)
const sessionCreating = ref(false)
const sessionRenaming = ref(false)
const sessionDeleting = ref(false)
const renaming = ref("")
const renamingSessionId = ref<string | null>(null)
const renameInputRef = ref<HTMLInputElement | null>(null)
const providerPresets = ref<Array<{ id: string; name: string }>>([])
const assistantProviderPresetId = ref("")
const assistantModelId = ref("")
const assistantModels = ref<Array<{ id: string; label: string; contextWindow: number | null }>>([])
// 上下文窗口可视化:used = 最后一轮 provider 返回的 input tokens;total = 当前模型 contextWindow.
// used 每轮回复后更新(不持久化,刷新归零);total 切模型时更新.
const contextUsed = ref(0)
const contextTotal = ref(0)
const showAssistantConfig = ref(false)

const cardTitle = computed(() => cardName.value || "未加载游戏卡")
const configButtonTitle = computed(() => {
  if (assistantProviderPresetId.value) {
    const name = providerPresets.value.find((p) => p.id === assistantProviderPresetId.value)?.name ?? "所选预设已失效"
    return `助手配置（服务商：${name}）`
  }
  return "助手配置（使用平台默认服务商）"
})
function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  if (isToday) {
    return `${hh}:${mm}`
  }
  const mo = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${mo}-${dd} ${hh}:${mm}`
}

async function refresh() {
  errorMessage.value = ""
  try {
    await waitForPlatformHostReady()
    const card = await getPlatformActiveGameCard()
    if (card) {
      cardName.value = card.manifest.name
    } else {
      cardName.value = ""
    }
    await loadProviderPreset()
  } finally {
    // nothing to reset; refresh is a silent context load
  }
}

async function refreshSessions() {
  sessions.value = await listAssistantSessions("local")
}

async function loadActiveSession() {
  const session = await ensureAssistantSession("local")
  activeSessionId.value = session.id
  const stored = await getAssistantSessionMessages(session.id)
  messages.value = mapStoredMessagesToChat(stored)
  await refreshSessions()

  // 恢复上下文环已用值(按会话持久化),避免刷新/重载归零.
  contextUsed.value = await loadContextUsed(session.id)

  // 刷新/关页面恢复:检测上次未完成回复的恢复点(localStorage),提示用户是否保留.
  // 恢复点只在有流式正文时写,且读后即清(一次性).确认则追加一条标记"已中断"的
  // assistant 消息并持久化;取消则丢弃.轻量兜底,不保证 100% 救回.
  const recovery = readRecoveryPoint(session.id)
  if (recovery) {
    clearRecoveryPoint(session.id)
    const keep = await confirm({
      title: "发现未完成的回复",
      message: `上次会话有未完成的回复（${new Date(recovery.ts).toLocaleString()}），是否保留到历史？`,
      confirmText: "保留",
      cancelText: "丢弃",
    })
    if (keep) {
      messages.value.push({
        role: "assistant",
        content: `${recovery.text}\n\n_（回复中断，已自动保留）_`,
      })
      await persistCurrentSession()
    }
  }

  await scrollToBottom()
}

async function handleSelectSession(id: string) {
  if (id === activeSessionId.value) {
    return
  }
  // 后台继续策略:切走会话时**不 abort** 当前 turn。它带着锁定的 sessionId
  // 继续在后台跑完,host 用该 sessionId 持久化;切回时重新挂回流式消息即可看到
  // 完整回复。这消除了旧设计"切走即 abort→回复被截断"的中断,也消除了
  // send() catch/finally 操作被切走的 messages.value 引发的竞态(误删新会话
  // 消息、持久化写错会话)。
  //
  // Optimistic UI update first: switch highlight immediately, then load the
  // target session's messages (one fast read). Persist the previous session in
  // the background so the click feels instant.
  const previousId = activeSessionId.value
  const previousMessages = chatToStoredMessages(messages.value)

  activeSessionId.value = id
  const stored = await getAssistantSessionMessages(id)
  let targetMessages = mapStoredMessagesToChat(stored)
  // 若目标会话有后台进行中 turn:存储里还没有本轮(turn 未结束,host 未写),
  // 把 turn 持有的 userMsg + assistantMsg 追加到 messages,让流式继续可见。
  // turn 的回调继续 mutate 同一对象引用,UI 自动更新(前台可见)。
  const targetTurn = assistantTurns.get(id)
  if (targetTurn) {
    targetMessages = [...targetMessages, targetTurn.userMsg, targetTurn.assistantMsg]
  }
  messages.value = targetMessages
  // 恢复目标会话的上下文环已用值.
  contextUsed.value = await loadContextUsed(id)
  await scrollToBottom()

  // Background persistence of the session we just left. Silent (touch=false):
  // merely selecting another session must not bump this one's sort order.
  // 若离开的会话有进行中 turn:跳过此处持久化——后台 turn 结束时 host 会用
  // 该 sessionId 写完整消息;这里写的是切走时刻的半截快照,会与 host 写入竞态
  // 且可能留下空 content 的 assistant 占位。无 turn 的会话才保存(用户可能编辑过)。
  void setActiveAssistantSessionId("local", id)
  if (previousId && previousId !== id && !assistantTurns.has(previousId)) {
    void saveAssistantSessionMessages("local", previousId, previousMessages, {
      touch: false,
    })
  }
}

async function handleCreateSession() {
  sessionCreating.value = true
  try {
    // Persist the current session in the background so creation feels instant.
    // 与 handleSelectSession 同理:前一会话若有后台 turn,跳过此处持久化——
    // 后台 turn 结束时 host 会写完整消息,这里写半截快照会与之竞态。
    const previousId = activeSessionId.value
    const previousMessages = chatToStoredMessages(messages.value)
    if (previousId && !assistantTurns.has(previousId)) {
      void saveAssistantSessionMessages("local", previousId, previousMessages, {
        touch: false,
      })
    }
    const session = await createAssistantSession("local")
    activeSessionId.value = session.id
    messages.value = []
    contextUsed.value = 0
    await refreshSessions()
    nextTick(() => inputRef.value?.focus())
  } finally {
    sessionCreating.value = false
  }
}

function handleStartRename(id: string) {
  const current = sessions.value.find((entry) => entry.id === id)
  renamingSessionId.value = id
  renaming.value = current?.title ?? ""
  nextTick(() => renameInputRef.value?.focus())
}

function closeRename() {
  renaming.value = ""
  renamingSessionId.value = null
}

async function handleConfirmRename() {
  const id = renamingSessionId.value
  if (!id || !renaming.value.trim()) {
    closeRename()
    return
  }
  sessionRenaming.value = true
  try {
    await renameAssistantSession("local", id, renaming.value.trim())
    await refreshSessions()
  } finally {
    sessionRenaming.value = false
    closeRename()
  }
}

async function handleDeleteSessionById(id: string) {
  if (!id) {
    return
  }
  const wasActive = id === activeSessionId.value
  sessionDeleting.value = true
  try {
    // 删除有后台 turn 的会话:先 abort 该 turn 并清注册表(防止后台 turn 结束时
    // 回写已删除的 sessionId)。host catch 路径 persistTurnFallback 会尝试写该
    // sessionId,但会话已删,saveAssistantSessionMessages 对不存在的 id 是 no-op
    // (或静默失败),不致脏数据。
    const turn = assistantTurns.get(id)
    if (turn) {
      const pendingAsk = activeAskBySession.get(id)
      if (pendingAsk) {
        askRequestSession.delete(pendingAsk.requestId)
        activeAskBySession.delete(id)
      }
      turn.controller.abort()
      assistantTurns.delete(id)
      runningSessionIds.delete(id)
    }
    await deleteAssistantSession("local", id)
    await refreshSessions()
    if (wasActive) {
      // The deleted session was active; pick the next one or create a fresh session.
      const nextId = await getActiveAssistantSessionId("local")
      if (nextId) {
        activeSessionId.value = nextId
        const stored = await getAssistantSessionMessages(nextId)
        let nextMessages = mapStoredMessagesToChat(stored)
        // 切到的会话若有后台 turn:挂回流式消息(与 handleSelectSession 同逻辑)。
        const nextTurn = assistantTurns.get(nextId)
        if (nextTurn) {
          nextMessages = [...nextMessages, nextTurn.userMsg, nextTurn.assistantMsg]
        }
        messages.value = nextMessages
        contextUsed.value = await loadContextUsed(nextId)
      } else {
        const session = await createAssistantSession("local")
        activeSessionId.value = session.id
        messages.value = []
        contextUsed.value = 0
        await refreshSessions()
      }
      await scrollToBottom()
    }
  } finally {
    sessionDeleting.value = false
  }
}

async function persistCurrentSession() {
  if (!activeSessionId.value) {
    return
  }
  const toStore: ConversationMessageRecord[] = chatToStoredMessages(messages.value)
  await saveAssistantSessionMessages("local", activeSessionId.value, toStore)
  await refreshSessions()
}

// ── 附件处理 ──

const ACCEPTED_FILE_TYPES = "image/*,.txt,.json,.md,.markdown,.csv,.xml,.yaml,.yml,.jsonl,.js,.ts,.css,.html,.htm,.svg"

/** 添加文件为待发附件. 图片生成缩略图 previewUrl. */
async function addFileAsAttachment(file: File) {
  if (!activeSessionId.value) return
  try {
    const ref = await saveAssistantAttachment(activeSessionId.value, file)
    const previewUrl = ref.kind === "image" ? URL.createObjectURL(file) : undefined
    pendingAttachments.value.push({ ref, previewUrl })
  } catch (error) {
    errorMessage.value = `附件添加失败: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** textarea paste 处理:检测剪贴板图片. */
function handlePaste(event: ClipboardEvent) {
  const clipboardData = event.clipboardData
  if (!clipboardData) return
  for (const item of clipboardData.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile()
      if (file) {
        event.preventDefault()
        void addFileAsAttachment(file)
      }
    }
  }
}

/** 聊天面板 drop 处理. */
function handleDrop(event: DragEvent) {
  event.preventDefault()
  dragOver.value = false
  if (!event.dataTransfer?.files) return
  for (const file of event.dataTransfer.files) {
    void addFileAsAttachment(file)
  }
}

/** 隐藏 file input 的 change 处理. */
function handleFilePick(event: Event) {
  const target = event.target as HTMLInputElement
  if (!target.files) return
  for (const file of target.files) {
    void addFileAsAttachment(file)
  }
  target.value = ""  // 重置,允许重复选同一文件
}

/** 移除待发附件. */
function removePendingAttachment(index: number) {
  const [removed] = pendingAttachments.value.splice(index, 1)
  if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
}

/** 格式化文件大小. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── 工具调用分组渲染 ──
// 相邻的 tool 节点合并成一行自然语言摘要（如"读取了 3 个文件、搜索了 1 次"），
// 不再逐个展开 output。interim/thought/ask 保持独立节点。
// 模仿 ZCode：工具调用只显成功与否，不显返回内容。

const TOOL_LABEL: Record<string, { verb: string; noun: string; unit: string | null }> = {
  read: { verb: "读取", noun: "文件", unit: "个" },
  list: { verb: "列出", noun: "条目", unit: "项" },
  search: { verb: "搜索", noun: "匹配", unit: "处" },
  glob: { verb: "匹配", noun: "文件", unit: "个" },
  diff: { verb: "比对", noun: "差异", unit: null },
  write: { verb: "写入", noun: "文件", unit: null },
  edit: { verb: "编辑", noun: "文件", unit: null },
  copy: { verb: "复制", noun: "文件", unit: null },
  move: { verb: "移动", noun: "文件", unit: null },
  delete: { verb: "删除", noun: "文件", unit: null },
  semantic_search: { verb: "语义检索", noun: "记忆", unit: null },
  use_skill: { verb: "激活", noun: "技能", unit: null },
  run_script: { verb: "执行", noun: "脚本", unit: null },
  inspect_frontend: { verb: "自检", noun: "前端", unit: null },
  test_skill_script: { verb: "测试", noun: "脚本", unit: null },
  ask_user: { verb: "向玩家", noun: "提问", unit: null },
}

/** 一组相邻 tool 节点 → 自然语言摘要句（按工具名分组，合并同名工具计数）. */
function toolGroupSummary(tools: ToolNode[]): string {
  const byName = new Map<string, { count: number; status: string }>()
  for (const t of tools) {
    const key = t.name
    const entry = byName.get(key)
    if (entry) {
      entry.count += 1
      // 任一失败则整组标失败
      if (t.status === "failed") entry.status = "failed"
    } else {
      byName.set(key, { count: 1, status: t.status })
    }
  }
  const sentences: string[] = []
  for (const [name, { count, status }] of byName) {
    const label = TOOL_LABEL[name]
    const verb = label?.verb ?? name
    const noun = label?.noun ?? "操作"
    if (status === "failed") {
      sentences.push(`${verb}${noun}失败`)
      continue
    }
    const unit = label?.unit ?? null
    if (unit && count > 1) {
      sentences.push(`${verb}了 ${count} ${unit}${noun}`)
    } else {
      sentences.push(`${verb}了${noun}`)
    }
  }
  return sentences.join("、")
}

/** 渲染段：单个节点 或 一组 tool 节点. */
type ToolNode = Extract<AssistantTimelineNode, { type: "tool" }>
type TimelineSegment =
  | { kind: "node"; node: AssistantTimelineNode }
  | { kind: "tool-group"; tools: ToolNode[]; summary: string }

/** 把 timeline 分成渲染段：相邻 tool 合并，其余独立. */
function groupTimelineForRender(timeline: AssistantTimelineNode[]): TimelineSegment[] {
  const segments: TimelineSegment[] = []
  let i = 0
  while (i < timeline.length) {
    const node = timeline[i]
    if (node.type === "tool") {
      // 收集连续的 tool 节点
      const group: ToolNode[] = [node]
      let j = i + 1
      while (j < timeline.length && timeline[j].type === "tool") {
        group.push(timeline[j] as ToolNode)
        j += 1
      }
      segments.push({ kind: "tool-group", tools: group, summary: toolGroupSummary(group) })
      i = j
    } else {
      segments.push({ kind: "node", node })
      i += 1
    }
  }
  return segments
}

type AssistantContentSegment =
  | { kind: "text"; text: string }
  | { kind: "thought"; text: string }

function renderAssistantContentSegments(content: string): AssistantContentSegment[] {
  const segments: AssistantContentSegment[] = []
  const pattern = /<think>([\s\S]*?)(?:<\/think>|$)/gi
  let cursor = 0
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) {
      const text = content.slice(cursor, index).trim()
      if (text) segments.push({ kind: "text", text })
    }
    const thought = (match[1] ?? "").trim()
    if (thought) segments.push({ kind: "thought", text: thought })
    cursor = index + match[0].length
  }
  if (cursor < content.length) {
    const text = content.slice(cursor).trim()
    if (text) segments.push({ kind: "text", text })
  }
  return segments.length > 0 ? segments : [{ kind: "text", text: content }]
}

function sendSuggestion(message: string) {
  inputText.value = message
  send()
}

async function send() {
  const content = inputText.value.trim()
  const attachments = pendingAttachments.value.map((p) => p.ref)
  if ((!content && attachments.length === 0) || sending.value) {
    return
  }

  errorMessage.value = ""
  // 释放待发附件的 previewUrl(已发送,不再需要缩略图)
  for (const p of pendingAttachments.value) {
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
  }
  pendingAttachments.value = []

  // activeSessionId 由 loadActiveSession/ensureAssistantSession 保证非空;
  // guard 兜底边缘时序(组件未初始化完成就发消息),类型上收窄 string|null -> string.
  const sessionId = activeSessionId.value
  if (!sessionId) {
    return
  }

  // 本轮 user/assistant 消息存为独立 reactive 对象(非内联字面量),turn state
  // 持有它们的引用。切走会话后 messages.value 被换成新会话,但 turn 回调继续
  // mutate 这两个对象——它们已不在 messages.value,故不影响新会话;切回时
  // handleSelectSession 把同一对象引用重新挂回 messages.value,流式继续可见。
  const userMsg = reactive<ChatMessage>({
    role: "user",
    content,
    ...(attachments.length > 0 ? { attachments } : {}),
  })
  messages.value.push(userMsg)
  inputText.value = ""
  resetInputHeight()

  // Placeholder assistant message:过程节点(thought/tool)按发生顺序纵向平铺,
  // streamingText 承载当前轮 content 流式文本,onRoundEnd 写入 content;
  // streamingReasoning 承载当前轮思维链,onRoundEnd 折叠为 thought 节点(不流式显示).
  const assistantMsg = reactive<ChatMessage>({
    role: "assistant",
    content: "",
    timeline: [],
    streamingText: "",
    streamingReasoning: "",
  })
  messages.value.push(assistantMsg)
  await scrollToBottom()

  const history: ConversationMessageRecord[] = messages.value
    .slice(0, -2)
    .map((msg) => ({ role: msg.role, content: msg.content }))

  // 时间线式流式:native 模式按 round 顺序把过程事件(thought/tool)作为独立节点纵向平铺.
  // onDelta/onRoundEnd/onTool 的解析逻辑抽到 useAssistantTimeline composable(纯流式状态,
  // 不碰 DOM/持久化);onUpdate 只在 turn 属于当前显示会话时滚动(后台 turn 不扰动新会话视图).
  // text 模式无回调,content 在 reconcile 一次性赋值,timeline 为空——降级为现状.
  const { timeline, onDelta, onRoundEnd, onTool, recordAskNode, flushStreaming, finalize } = useAssistantTimeline(
    assistantMsg,
    () => {
      if (sessionId === activeSessionId.value) {
        maybeScrollToBottom()
      }
    },
  )

  // ③ Stop-generating: an AbortController for this turn, abortable from the UI.
  const controller = new AbortController()

  // 注册按会话隔离的 turn state:sending 由 computed 从 runningSessionIds 派生。
  const state: AssistantTurnState = {
    sessionId,
    controller,
    userMsg,
    assistantMsg,
    flush: flushStreaming,
    recordAsk: recordAskNode,
    finalize,
    timeline,
  }
  assistantTurns.set(sessionId, state)
  runningSessionIds.add(sessionId)

  let shouldPersistAfterFinalize = false

  try {
    const result = await runAssistantChat({
      message: content,
      ...(attachments.length > 0 ? { attachments } : {}),
      history,
      sessionId,
      onDelta,
      onRoundEnd,
      onTool,
      signal: controller.signal,
      // ask_user 路由:host emit 前回调,把 requestId 关联到本会话,
      // 供全局 interaction-request 订阅路由到正确的(可能后台的)turn。
      onAskUserRequest: (requestId) => {
        askRequestSession.set(requestId, sessionId)
      },
    })
    // reconcile:replyText 是最后一轮(final)的文本,以它为准(strip 工具块等).
    // native 模式 onRoundEnd(stop)已写入 content;text 模式无回调,这里首次赋值.
    // 对 state.assistantMsg 赋值:前台时它就是 messages.value 里的对象(UI 更新);
    // 后台时不在 messages.value,赋值无副作用,切回时从存储读 host 写入的完整结果。
    assistantMsg.content = result.replyText
    assistantMsg.streamingText = ""
    assistantMsg.streamingReasoning = ""
    // 更新上下文环:used = 最后一轮 provider 返回的 input tokens(当前上下文大小).
    // 仅在前台(本会话是当前显示会话)时更新环显示,避免后台 turn 窜改新会话的环。
    // 按会话持久化 used 始终执行,刷新/切走再切回恢复。
    if (result.usage?.input !== undefined) {
      void saveContextUsed(sessionId, result.usage.input)
      if (sessionId === activeSessionId.value) {
        contextUsed.value = result.usage.input
      }
    }
    // 消息 + context + timeline 已由 host(runAssistantChat)同步写入(含 toolCalls +
    // timeline).前端不再补写——runtime 层采集 thought/interim/tool 供 host 写入,
    // 消除双写竞态.catch 路径仍保留前端持久化作兜底(host catch 不写消息).
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError"
    const budgetExhausted = error instanceof Error && error.name === "ContextBudgetExhaustedError"
    const taskTimeout = error instanceof Error && error.name === "TaskTimeoutError"
    const taskStalled = error instanceof Error && error.name === "TaskCompressionStalledError"
    const isFront = sessionId === activeSessionId.value
    // flushStreaming 由 useAssistantTimeline 提供:把流式缓冲落盘(防中止/出错丢进度).
    if (aborted) {
      // Keep the partial text; mark it so the user knows it was cut short.
      flushStreaming()
      if (assistantMsg.content) {
        assistantMsg.content = `${assistantMsg.content}\n\n_（已停止）_`
      } else if (timeline.length === 0 && isFront) {
        // 前台且啥都没产出:弹出空占位(后台时 assistantMsg 不在 messages.value,无需 pop)。
        messages.value.pop()
      }
      shouldPersistAfterFinalize = true
    } else if (budgetExhausted || taskTimeout || taskStalled) {
      // 三类温和中止同路径(非失败的中止,与 abort 对称):
      // - budgetExhausted:turn 内第二次达预算(narrative)/压无可压(task).
      // - taskTimeout:任务型 agent 超时(task 模式时长兜底).
      // - taskStalled:任务压缩无效早退(下降 <10%,不傻等超时烧钱).
      // 保留已流式 thought,用 content 承载温和提示,不设 errorMessage、不 pop 占位.
      const hint = taskTimeout
        ? "任务超时，已中止"
        : taskStalled
          ? "上下文持续膨胀且压缩无效，已中止"
          : "上下文已满，请开始新会话或精简对话"
      flushStreaming()
      if (assistantMsg.content) {
        assistantMsg.content = `${assistantMsg.content}\n\n_（${hint}）_`
      } else {
        assistantMsg.content = `${hint}。`
      }
      shouldPersistAfterFinalize = true
    } else {
      const message = error instanceof Error ? error.message : String(error)
      // 错误提示只在前台显示(用户在当前会话);后台 turn 失败不窜改新会话的错误栏,
      // 半截结果由持久化兜底,用户切回原会话可见。
      if (isFront) {
        errorMessage.value = message
      } else {
        console.error("[assistant] 后台 turn 失败", message)
      }
      flushStreaming()
      if (!assistantMsg.content && timeline.length === 0 && isFront) {
        messages.value.pop()
      }
      shouldPersistAfterFinalize = true
    }
  } finally {
    // 回合结束:折叠所有仍展开的 thought/tool 节点 + 清空流式缓冲(composable 负责).
    finalize()
    // 清理 ask 路由 + turn 注册表 + 响应式集合:sending/activeAsk computed 随之更新。
    const pendingAsk = activeAskBySession.get(sessionId)
    if (pendingAsk) {
      askRequestSession.delete(pendingAsk.requestId)
      activeAskBySession.delete(sessionId)
    }
    assistantTurns.delete(sessionId)
    runningSessionIds.delete(sessionId)
    // 持久化兜底(host catch 不写消息):前台用 persistCurrentSession(保留完整
    // attachments/toolCalls/timeline),后台用 history 快照兜底(保住本轮半截正文)。
    if (shouldPersistAfterFinalize) {
      if (sessionId === activeSessionId.value) {
        await persistCurrentSession()
      } else {
        await persistTurnFallback(state, history)
      }
    }
    // 滚动/聚焦只在前台(后台 turn 结束不扰动当前显示会话的视图)。
    if (sessionId === activeSessionId.value) {
      await scrollToBottom()
      nextTick(() => inputRef.value?.focus())
    }
  }
}

/**
 * 后台 turn 结束(abort/超时/错误)时的持久化兜底:用 send() 时刻的 history 快照 +
 * 本轮 user/assistant 构造完整消息写回 turn 的 sessionId。前台 turn 用
 * persistCurrentSession(更完整),本函数仅服务后台场景——host catch 不写消息,
 * 否则切回原会话会丢失本轮半截回复。history 快照不含历史 toolCalls/timeline,
 * 但保住本轮正文已足够(中止/错误的半截回复本就是临时保留)。
 */
async function persistTurnFallback(
  state: AssistantTurnState,
  history: ConversationMessageRecord[],
): Promise<void> {
  const fullMessages: ConversationMessageRecord[] = [
    ...history,
    {
      role: "user",
      content: state.userMsg.content,
      ...(state.userMsg.attachments && state.userMsg.attachments.length > 0
        ? { attachments: state.userMsg.attachments }
        : {}),
    },
  ]
  if (state.assistantMsg.content || state.timeline.length > 0) {
    fullMessages.push({ role: "assistant", content: state.assistantMsg.content })
  }
  await saveAssistantSessionMessages("local", state.sessionId, fullMessages, { touch: true })
  await refreshSessions()
}

function stopGenerating() {
  const sid = activeSessionId.value
  if (sid) {
    assistantTurns.get(sid)?.controller.abort()
  }
}

/**
 * ask_user 玩家回答处理：resolve 事件等待表（让助手 turn 拿到答案继续）+
 * 把 Q&A 作为只读记录写入 timeline（保留对话历史）+ 清该会话的活跃提问。
 * 活跃提问期间不在 timeline 渲染交互卡片（由 footer 承载），仅回答后落库。
 * UI 只渲染前台会话的 activeAsk（computed），故本组函数总针对前台 turn；
 * 但 requestId 可能来自后台 turn（路由表会指回后台 sessionId）——此时 resolve
 * 让后台 turn 继续，recordAsk 作用于后台 turn 的 timeline（切回时可见），前台
 * activeAsk 为 null 不受影响。断言兜底:requestId 路由不到 turn 说明已被清理,跳过。
 */
function answerAsk(requestId: string, answer: string): void {
  resolveInteractionRequest(requestId, answer)
  const ask = activeAsk.value
  const state = resolveAskTurn(requestId)
  if (ask && ask.requestId === requestId && state) {
    state.recordAsk({ ...ask, answer })
    activeAskBySession.delete(state.sessionId)
    askRequestSession.delete(requestId)
  }
}

function submitCustomAsk(requestId: string, value: string): void {
  const trimmed = value.trim()
  if (!trimmed) return
  resolveInteractionRequest(requestId, trimmed)
  const ask = activeAsk.value
  const state = resolveAskTurn(requestId)
  if (ask && ask.requestId === requestId && state) {
    state.recordAsk({ ...ask, answer: trimmed })
    activeAskBySession.delete(state.sessionId)
    askRequestSession.delete(requestId)
  }
}

function cancelAsk(requestId: string): void {
  // cancelled=true 时 answer 传空串（AskUserResult.answer 必填），助手侧据此识别取消。
  resolveInteractionRequest(requestId, "", true)
  const ask = activeAsk.value
  const state = resolveAskTurn(requestId)
  if (ask && ask.requestId === requestId && state) {
    state.recordAsk({ ...ask, cancelled: true })
    activeAskBySession.delete(state.sessionId)
    askRequestSession.delete(requestId)
  }
}

/** 按 requestId 路由到对应 turn state（前台优先,后台兜底）。 */
function resolveAskTurn(requestId: string): AssistantTurnState | null {
  const sid = askRequestSession.get(requestId)
  if (!sid) return null
  return assistantTurns.get(sid) ?? null
}

/**
 * 复制消息正文到剪贴板,并在该消息工具条短暂显示「已复制」勾.
 * assistant 消息复制 content(最终回复,不含过程节点);user 消息复制 content.
 */
async function handleCopyMessage(index: number) {
  const msg = messages.value[index]
  if (!msg || !msg.content) {
    return
  }
  try {
    await navigator.clipboard.writeText(msg.content)
    copiedIndex.value = index
    // 短暂显示后清除,让同一消息可再次复制并恢复复制图标.
    setTimeout(() => {
      if (copiedIndex.value === index) {
        copiedIndex.value = null
      }
    }, 1500)
  } catch {
    // 剪贴板写入失败(权限/非安全上下文)静默忽略,不打断对话.
  }
}

/**
 * 编辑并重新发送某条用户消息:截断到该条之前、把它的文本回填输入框、聚焦.
 * 回复中(sending)禁用,避免与正在进行的 turn 冲突.截断后未发送的消息及其
 * 回复一并删除(平铺列表模型,重做这一轮而非分支).用户改完正常点发送即可.
 */
function handleEditUserMessage(index: number) {
  if (sending.value) {
    return
  }
  const msg = messages.value[index]
  if (!msg || msg.role !== "user") {
    return
  }
  editingIndex.value = index
  inputText.value = msg.content
  // 截断:保留 index 之前的消息,丢弃该条及其后所有消息(含其回复).
  messages.value = messages.value.slice(0, index)
  resetInputHeight()
  nextTick(() => {
    inputRef.value?.focus()
    autoGrow()
    editingIndex.value = null
  })
  // 乐观更新已持久化的会话(后台,不阻塞 UI).
  if (activeSessionId.value) {
    const toStore: ConversationMessageRecord[] = chatToStoredMessages(messages.value)
    void saveAssistantSessionMessages("local", activeSessionId.value, toStore, { touch: false })
  }
}

function handleScroll(event: Event) {
  const el = event.target as HTMLElement
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  userPinnedToBottom.value = distanceFromBottom < 80
  showJumpToBottom.value = distanceFromBottom > 120
  // rAF 节流持久化 scrollTop 到会话存储(每帧最多一次,避免高频 scroll 写库).
  if (!scrollPersistScheduled) {
    scrollPersistScheduled = true
    requestAnimationFrame(() => {
      scrollPersistScheduled = false
      const sid = activeSessionId.value
      const node = messageListRef.value
      if (sid && node) {
        void saveScrollTop(sid, node.scrollTop)
      }
    })
  }
}

function autoGrow() {
  const el = inputRef.value
  if (!el) {
    return
  }
  // Reset to content-height first so scrollHeight reflects the actual content,
  // not the previous (possibly capped) height. Then cap at maxH.
  el.style.height = "auto"
  const maxH = 160
  const contentH = el.scrollHeight
  if (contentH <= maxH) {
    // Content fits: pin height to content and hide overflow so no scrollbar
    // flickers from sub-pixel scrollHeight/line-height rounding.
    el.style.height = `${contentH}px`
    el.style.overflowY = "hidden"
  } else {
    // Content exceeds cap: fix at maxH and allow scrolling.
    el.style.height = `${maxH}px`
    el.style.overflowY = "auto"
  }
}

function resetInputHeight() {
  const el = inputRef.value
  if (el) {
    el.style.height = "auto"
    el.style.overflowY = "hidden"
  }
}

async function scrollToBottom(force = false) {
  await nextTick()
  const el = messageListRef.value
  if (!el) {
    return
  }
  if (force) {
    showJumpToBottom.value = false
    userPinnedToBottom.value = true
  }
  el.scrollTop = el.scrollHeight
  // 过程节点折叠/展开会改变列表高度;补一帧再对齐底部,避免 scrollToBottom
  // 赶在布局变化前执行而停在过程节点区域,让落点回到回复正文.
  requestAnimationFrame(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight
    }
  })
}

// Auto-scroll during streaming only when the user is already near the bottom;
// never yank the view away from someone scrolling up through history.
function maybeScrollToBottom() {
  if (userPinnedToBottom.value) {
    void scrollToBottom()
  }
}

/**
 * 从会话存储恢复滚动位置.窗口改用 CSS 隐藏(非 DOM 移除)后,切焦窗口的
 * scrollTop 天然保留,正常情况无需恢复;此函数仅作单次兜底——若极端情况下
 * scrollTop 被重置为 0 且目标值>0,补回目标值.
 *
 * 用户主动滚到顶时 handleScroll 已把 0 写入存储,loadScrollTop 返回 0,
 * target===0 时直接跳过,不会误恢复.
 */
function restoreScrollTop(target: number) {
  if (target <= 0) {
    return
  }
  nextTick(() => {
    const el = messageListRef.value
    if (el && el.scrollTop === 0 && el.scrollHeight > el.clientHeight) {
      el.scrollTop = target
    }
  })
}

/** 进入一个会话后恢复其滚动位置(从存储读取目标值). */
async function restoreSessionScrollTop() {
  const sid = activeSessionId.value
  if (!sid) {
    return
  }
  const target = await loadScrollTop(sid)
  nextTick(() => restoreScrollTop(target))
}

// 路由变化反映焦点切换(focusWindow → navigateTo(routePath)).进入助手路由时
// 从会话存储恢复滚动位置(单次兜底,正常情况下 scrollTop 已被窗口常驻保留).
watch(
  () => route.path,
  (to, from) => {
    const isAssistant = (p: string) => p === ASSISTANT_ROUTE_PATH || p.startsWith(`${ASSISTANT_ROUTE_PATH}/`)
    const wasAssistant = isAssistant(from)
    const nowAssistant = isAssistant(to)
    if (nowAssistant && !wasAssistant) {
      void restoreSessionScrollTop()
    }
  },
)

async function loadProviderPreset() {
  try {
    const result = await getLocalAssistantProviderPreset()
    providerPresets.value = result.presets
    assistantProviderPresetId.value = result.providerPresetId
    assistantModelId.value = result.modelId
    assistantModels.value = result.models
    // 更新环总量:有 modelId 取对应模型的 contextWindow,否则取第一个模型的(预设默认 primary).
    const activeModel = result.modelId
      ? result.models.find((m) => m.id === result.modelId)
      : result.models[0]
    contextTotal.value = activeModel?.contextWindow ?? 0
  } catch {
    // Non-fatal: provider selection just won't show.
  }
}

/** 切换预设:立即持久化 + 重新加载该预设的模型列表 + 清空 modelId(新预设的模型 id 不同).
 *  防御 guard:有任意会话(含后台)生成中时拒绝——正在跑的 turn 已锁定 config,
 *  但改全局 agent.json 会影响下次发送,禁用期让用户等当前回合结束。 */
async function handlePresetChange(presetId: string) {
  if (runningSessionIds.size > 0) return
  const id = presetId === "__platform_default__" ? "" : presetId
  assistantProviderPresetId.value = id
  assistantModelId.value = ""
  assistantModels.value = []
  await updateLocalAssistantProviderPreset(id || null)
  if (id) {
    await updateLocalAssistantModel(null)
  }
  await loadProviderPreset()
}

/** 切换预设内模型:立即持久化 + 更新环总量. 同 handlePresetChange 的运行中 guard。 */
async function handleModelChange(modelId: string) {
  if (runningSessionIds.size > 0) return
  const id = modelId === "__preset_default__" ? "" : modelId
  assistantModelId.value = id
  await updateLocalAssistantModel(id || null)
  // 更新环总量:选了具体模型取其 contextWindow,没选取第一个(预设默认).
  const activeModel = id
    ? assistantModels.value.find((m) => m.id === id)
    : assistantModels.value[0]
  contextTotal.value = activeModel?.contextWindow ?? 0
}

/**
 * Called when the AssistantConfigPanel persists a config change. Re-reads the
 * provider preset state so the gear button's title reflects the active preset.
 */
async function handleAssistantConfigChange() {
  await loadProviderPreset()
}

// ── 刷新/关页面恢复点 ──
// streaming 期间 beforeunload/visibilitychange(hidden) 同步写 localStorage,
// 下次进会话检测到恢复点则提示用户是否保留.轻量兜底:不保证 100% 救回
// (卸载时 JS 执行窗口极短),但大多数刷新场景能保住已见正文.
const RECOVER_KEY_PREFIX = "assistant:recover:"

function recoverKey(sessionId: string): string {
  return `${RECOVER_KEY_PREFIX}${sessionId}`
}

/** 写恢复点(同步 localStorage,不阻塞卸载).只在有流式正文时写.
 *  修复:改为从 turn 注册表取本会话的 turn state,而非读单例 messages.value——
 *  切走后流式消息不在 messages.value,旧逻辑会漏写后台 turn 的恢复点。 */
function writeRecoveryPoint(sessionId: string): void {
  const state = assistantTurns.get(sessionId)
  if (!state) return
  const text = state.assistantMsg.streamingText ?? state.assistantMsg.content
  if (!text) return
  try {
    localStorage.setItem(
      recoverKey(sessionId),
      JSON.stringify({ text, ts: Date.now() }),
    )
  } catch {
    // localStorage 写失败(配额满/隐私模式)静默忽略,不阻断.
  }
}

/** 读恢复点.有则返回 {text, ts},无则 null.读后不清除(由调用方决定). */
function readRecoveryPoint(sessionId: string): { text: string; ts: number } | null {
  try {
    const raw = localStorage.getItem(recoverKey(sessionId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { text?: string; ts?: number }
    if (typeof parsed.text === "string" && typeof parsed.ts === "number") {
      return { text: parsed.text, ts: parsed.ts }
    }
  } catch {
    // 损坏的恢复点静默忽略.
  }
  return null
}

/** 清除恢复点. */
function clearRecoveryPoint(sessionId: string): void {
  try {
    localStorage.removeItem(recoverKey(sessionId))
  } catch {
    // 静默忽略.
  }
}

function onBeforeUnloadRecovery() {
  if (activeSessionId.value) {
    writeRecoveryPoint(activeSessionId.value)
  }
}

function onVisibilityChangeRecovery() {
  if (document.visibilityState === "hidden" && activeSessionId.value) {
    writeRecoveryPoint(activeSessionId.value)
  }
}

onMounted(async () => {
  window.addEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
  window.addEventListener("beforeunload", onBeforeUnloadRecovery)
  document.addEventListener("visibilitychange", onVisibilityChangeRecovery)
  // 订阅 ask_user 交互请求：助手 runtime 调 ask_user 时 emitInteractionRequest
  // 推给本订阅。host 的 onAskUserRequest 已把 requestId 关联到会话,这里路由到
  // 对应 turn state 并写入响应式 activeAskBySession——前台 turn 的 ask 通过
  // computed 反映到 footer 提问区;后台 turn 的 ask 存于本 Map(切回时若仍未答
  // 则恢复显示)。活跃期间不在 timeline 渲染交互卡片；玩家回答/取消后落只读记录。
  unsubscribeInteractionRequest = subscribeInteractionRequest(
    (requestId, question, options, allowCustom) => {
      const state = resolveAskTurn(requestId)
      if (!state) return // 无对应 turn（已结束/被清理），忽略（保守兜底）
      activeAskBySession.set(state.sessionId, {
        requestId,
        question,
        ...(options ? { options } : {}),
        ...(allowCustom !== undefined ? { allowCustom } : {}),
      })
      // 仅前台 turn 才需要聚焦输入(后台 turn 无 footer 提问区可见)。
      if (state.sessionId === activeSessionId.value) {
        nextTick(() => askCustomInputRef.value?.focus())
      }
    },
  )
  await refresh()
  await loadActiveSession()
  await loadProviderPreset()
  nextTick(() => inputRef.value?.focus())
})

onBeforeUnmount(() => {
  window.removeEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
  window.removeEventListener("beforeunload", onBeforeUnloadRecovery)
  document.removeEventListener("visibilitychange", onVisibilityChangeRecovery)
  unsubscribeInteractionRequest?.()
  // 组件卸载:abort 所有进行中 turn(含后台),清注册表。host catch 路径会
  // rejectAllInteractionRequests + 走 persistTurnFallback 兜底落盘半截回复。
  for (const [, state] of assistantTurns) {
    state.controller.abort()
  }
  assistantTurns.clear()
  askRequestSession.clear()
  runningSessionIds.clear()
  activeAskBySession.clear()
})

function onActiveCardChanged(event: Event) {
  if (!isActiveCardChangedEvent(event)) {
    return
  }
  void refresh()
}
</script>

<style scoped>
.typing-dot {
  width: 6px;
  height: 6px;
  background: var(--color-neon);
  opacity: 0.5;
  animation: typing-blink 1.2s infinite ease-in-out;
}
.typing-dot:nth-child(2) {
  animation-delay: 0.2s;
}
.typing-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing-blink {
  0%, 80%, 100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

<!-- Unscoped so .prose-chat can style rendered markdown HTML and hljs tokens. -->
<style>
.prose-chat {
  font-size: 0.875rem;
  line-height: 1.7;
  color: var(--color-text-main);
}
.prose-chat p {
  margin: 0 0 0.6em;
}
.prose-chat p:last-child {
  margin-bottom: 0;
}
.prose-chat h1,
.prose-chat h2,
.prose-chat h3,
.prose-chat h4 {
  margin: 1.1em 0 0.5em;
  font-weight: 700;
  line-height: 1.3;
  color: var(--color-text-main);
}
.prose-chat h1 { font-size: 1.15rem; }
.prose-chat h2 { font-size: 1.05rem; }
.prose-chat h3 { font-size: 0.98rem; }
.prose-chat h4 { font-size: 0.92rem; color: var(--color-neon); }
.prose-chat h1:first-child,
.prose-chat h2:first-child,
.prose-chat h3:first-child,
.prose-chat h4:first-child {
  margin-top: 0;
}
.prose-chat ul,
.prose-chat ol {
  margin: 0.4em 0 0.7em;
  padding-left: 1.4em;
}
.prose-chat li {
  margin: 0.2em 0;
}
.prose-chat ul { list-style: disc; }
.prose-chat ol { list-style: decimal; }
.prose-chat a {
  color: var(--color-neon);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.prose-chat a:hover {
  filter: brightness(1.15);
}
.prose-chat strong {
  color: var(--color-neon);
  font-weight: 700;
}
.prose-chat em {
  font-style: italic;
  color: var(--color-text-main);
}
.prose-chat blockquote {
  margin: 0.6em 0;
  padding: 0.2em 0.85em;
  border-left: 2px solid var(--color-neon-deep);
  color: var(--color-text-dim);
}
.prose-chat blockquote p {
  margin: 0.25em 0;
}
.prose-chat hr {
  margin: 1em 0;
  border: 0;
  border-top: 1px solid rgba(246, 236, 215, 0.16);
}
.prose-chat code {
  font-family: var(--font-mono);
  font-size: 0.82em;
  padding: 0.1em 0.35em;
  background: rgba(246, 236, 215, 0.1);
  color: var(--color-text-main);
  border: 1px solid rgba(246, 236, 215, 0.14);
}
.prose-chat pre {
  margin: 0.6em 0;
  padding: 0.7em 0.85em;
  overflow-x: auto;
  background: #1a1c18;
  border: 1px solid rgba(246, 236, 215, 0.16);
  box-shadow: inset 1px 1px 0 rgba(0, 0, 0, 0.75), inset -1px -1px 0 rgba(246, 236, 215, 0.08);
}
.prose-chat pre code {
  padding: 0;
  background: transparent;
  border: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  color: inherit;
}
.prose-chat table {
  width: 100%;
  margin: 0.6em 0;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.prose-chat th,
.prose-chat td {
  padding: 0.35em 0.6em;
  border: 1px solid rgba(246, 236, 215, 0.18);
  text-align: left;
}
.prose-chat th {
  background: rgba(243, 197, 109, 0.1);
  color: var(--color-neon);
  font-weight: 700;
}

/* Warm-tune the highlight.js atom-one-dark palette toward the CRT theme. */
.prose-chat .hljs {
  color: #e8dcc4;
  background: transparent;
}
.prose-chat .hljs-comment,
.prose-chat .hljs-quote {
  color: #6f6757;
  font-style: italic;
}
.prose-chat .hljs-keyword,
.prose-chat .hljs-selector-tag,
.prose-chat .hljs-built_in,
.prose-chat .hljs-name,
.prose-chat .hljs-tag {
  color: #f3c56d;
}
.prose-chat .hljs-string,
.prose-chat .hljs-title,
.prose-chat .hljs-section,
.prose-chat .hljs-attribute,
.prose-chat .hljs-literal,
.prose-chat .hljs-template-tag,
.prose-chat .hljs-template-variable,
.prose-chat .hljs-type,
.prose-chat .hljs-addition {
  color: #b8c98a;
}
.prose-chat .hljs-number,
.prose-chat .hljs-symbol,
.prose-chat .hljs-bullet,
.prose-chat .hljs-meta .hljs-string,
.prose-chat .hljs-subst {
  color: #e0b577;
}
.prose-chat .hljs-attr,
.prose-chat .hljs-variable,
.prose-chat .hljs-link {
  color: #d9b07a;
}
.prose-chat .hljs-deletion {
  color: #c84f5c;
}
</style>
