### 串行模式（Serial）

**适用场景：** 任务有明确的先后顺序，后一步依赖前一步的结果。

**流程图：**

![image-20260725135754220](C:/Users/admin/AppData/Roaming/Typora/typora-user-images/image-20260725135754220.png)

**典型用例：**

- 研究 → 写作 → 编辑 → 审核
- 需求分析 → 系统设计 → 代码实现 → 测试



#### 实现示例

```ts
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { createAgent } from "langchain";

import model from "@/agent";

// 创建三个专门的 Agent（无工具，纯文本处理，避免网络请求卡顿）
const researcher = createAgent({
  model,
  tools: [],
  systemPrompt: `你是研究员，负责基于自身知识输出结构化的研究报告。
请以 Markdown 格式输出，包含：概述、核心观点、关键数据（如有）、总结。
报告要详实、有深度，不低于 500 字。`,
});

const writer = createAgent({
  model,
  tools: [],
  systemPrompt: `你是写作专家，基于研究员提供的资料撰写一篇完整的文章。
要求：
1. 语言流畅、有吸引力
2. 结构清晰：引言 → 正文（分小节） → 结语
3. 保留所有核心观点和数据
4. 不低于 800 字`,
});

const editor = createAgent({
  model,
  tools: [],
  systemPrompt: `你是编辑，负责润色文章，确保：
1. 语言流畅、逻辑清晰
2. 段落过渡自然
3. 用词精准、专业
4. 修正语病和错别字
5. 保持原文核心内容和结构不变`,
});

// 构建串行工作流
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("research", async (state) => {
    console.log("🔍 [研究员] 开始搜集资料...");
    const result = await researcher.invoke({ messages: state.messages });
    const newMessage = result.messages.at(-1);
    console.log(`✅ [研究员] 完成（${(newMessage?.content as string)?.length ?? 0} 字）\n`);
    return { messages: [newMessage] };
  })
  .addNode("write", async (state) => {
    console.log("✍️  [写作专家] 开始撰写文章...");
    const result = await writer.invoke({ messages: state.messages });
    const newMessage = result.messages.at(-1);
    console.log(`✅ [写作专家] 完成（${(newMessage?.content as string)?.length ?? 0} 字）\n`);
    return { messages: [newMessage] };
  })
  .addNode("edit", async (state) => {
    console.log("📝 [编辑] 开始润色...");
    const result = await editor.invoke({ messages: state.messages });
    const newMessage = result.messages.at(-1);
    console.log(`✅ [编辑] 完成（${(newMessage?.content as string)?.length ?? 0} 字）\n`);
    return { messages: [newMessage] };
  })
  .addEdge("__start__", "research")
  .addEdge("research", "write")
  .addEdge("write", "edit")
  .addEdge("edit", "__end__");

const serialApp = workflow.compile();

console.log("=".repeat(50));
console.log("  串行多 Agent 工作流");
console.log("  流程: 研究员 → 写作专家 → 编辑");
console.log("=".repeat(50) + "\n");

// 执行
const result = await serialApp.invoke({
  messages: [{ role: "user", content: "写一篇关于如何选择合适的第一台车的文章" }],
});

console.log("\n" + "=".repeat(50));
console.log("  最终输出（编辑后）");
console.log("=".repeat(50) + "\n");
console.log(result.messages.at(-1)?.content);

```



### 并行模式（Parallel）

**适用场景：** 多个子任务可以独立执行，最后汇总结果。

**流程图：**

![image-20260725140031646](C:/Users/admin/AppData/Roaming/Typora/typora-user-images/image-20260725140031646.png)

**典型用例：**

- 同时查询多个数据源
- 并行分析不同维度的数据
- 多语言翻译

#### 实现示例

```ts
import "dotenv/config";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { AIMessage, BaseMessage, HumanMessage, createAgent } from "langchain";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

import model from "@/agent";

// 用 LLM 从用户输入中提取城市名
const cityExtractPrompt = ChatPromptTemplate.fromMessages([
  ["system", "你是一个城市提取助手。从用户的问题中提取出目的地城市名称，只输出城市名，不要输出任何其他内容。如果未提及城市，输出'北京'。"],
  ["human", "{input}"],
]);
const cityExtractor = cityExtractPrompt.pipe(model).pipe(new StringOutputParser());

// 定义包含多个子任务结果的状态
const ParallelState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, next) => [...current, ...next], // 每次节点返回新消息时， 追加 到现有消息列表尾部
    default: () => [],
  }),
  taskResults: Annotation<Record<string, string>>({
    reducer: (current, next) => ({ ...current, ...next }), // 每次节点返回新结果时， 合并 到现有结果对象中
    default: () => ({}),
  }),
});

// 创建专门的 Agent（无工具，纯知识回答）
const attractionAgent = createAgent({
  model,
  tools: [],
  name: "attraction_agent",
  systemPrompt: `你是景点推荐专家，请根据自身知识推荐目的地景点信息。
回答需包含：
1. 必去景点及特点
2. 最佳游览时间
3. 门票价格参考
4. 游玩时长建议
回答要具体、有细节。`,
});

const foodAgent = createAgent({
  model,
  tools: [],
  name: "food_agent",
  systemPrompt: `你是美食推荐专家，请根据自身知识推荐目的地美食。
回答需包含：
1. 特色餐厅推荐（含菜系和招牌菜）
2. 当地小吃和夜市推荐
3. 人均消费参考
4. 适合的用餐时段`,
});

const routeAgent = createAgent({
  model,
  tools: [],
  name: "route_agent",
  systemPrompt: `你是行程规划专家，请根据自身知识规划出行路线。
回答需包含：
1. 推荐的游玩路线（按天/半天规划）
2. 交通方式建议（地铁/公交/打车）
3. 景点之间的衔接时间
4. 注意事项和实用贴士`,
});

// 并行执行多个 Agent
async function parallelNode(state: typeof ParallelState.State) {
  const userQuery = state.messages.at(-1)?.content as string;

  // 用 LLM 从用户输入中提取城市名
  const city = await cityExtractor.invoke({ input: userQuery });

  console.log(`🔍 正在并行查询 ${city} 的景点、美食、路线...`);

  const [attractionResult, foodResult, routeResult] = await Promise.all([
    attractionAgent.invoke({
      messages: [{ role: "user", content: `推荐${city}的景点：${userQuery}` }],
    }),
    foodAgent.invoke({
      messages: [{ role: "user", content: `推荐${city}的美食：${userQuery}` }],
    }),
    routeAgent.invoke({
      messages: [{ role: "user", content: `规划${city}的路线：${userQuery}` }],
    }),
  ]);

  console.log(`✅ ${city} 并行查询完成\n`);

  return {
    taskResults: {
      attractions: attractionResult.messages.at(-1)?.content as string,
      food: foodResult.messages.at(-1)?.content as string,
      route: routeResult.messages.at(-1)?.content as string,
    },
  };
}

// 汇总节点
async function mergeNode(state: typeof ParallelState.State) {
  const { attractions, food, route } = state.taskResults;

  console.log("📝 正在整合生成出行攻略...");

  const summaryPrompt = `请整合以下信息，给用户一份完整的出行攻略：

景点推荐：
${attractions}

美食推荐：
${food}

路线规划：
${route}

请整合成一份结构清晰、实用的一日游攻略，包含：上午行程、午餐推荐、下午行程、晚餐推荐、实用贴士。`;

  const response = await model.invoke([
    { role: "system", content: "你是一个专业旅行规划师，整合景点、美食和路线信息给出一份实用的出行攻略。" },
    { role: "user", content: summaryPrompt },
  ]);

  console.log("✅ 攻略生成完成\n");

  return {
    messages: [new AIMessage(response.content as string)],
  };
}

// 构建并行工作流
const workflow = new StateGraph(ParallelState)
  .addNode("parallel", parallelNode)
  .addNode("merge", mergeNode)
  .addEdge("__start__", "parallel")
  .addEdge("parallel", "merge")
  .addEdge("merge", "__end__");

const parallelApp = workflow.compile();

console.log("=".repeat(50));
console.log("  并行多 Agent — 出行路由攻略");
console.log("  流程: [景点 + 美食 + 路线] → 整合攻略");
console.log("=".repeat(50) + "\n");

const result = await parallelApp.invoke({
  messages: [new HumanMessage("给我一份重庆一日游攻略")],
});

console.log("\n" + "=".repeat(50));
console.log("  出行攻略");
console.log("=".repeat(50) + "\n");
console.log(result.messages.at(-1)?.content);
```



### 委托模式（Delegation / Supervisor）

**适用场景：** 需要一个"主管"来协调多个"专家"，动态决定下一步交给谁处理。

**流程图：**

![image-20260725141753237](C:/Users/admin/AppData/Roaming/Typora/typora-user-images/image-20260725141753237.png)

**典型用例：**

- 复杂的研究任务（需要多次切换研究方向）
- 客户服务（根据问题类型转接不同专家）
- 项目管理（动态分配任务给不同团队）



#### 完整实现

```ts
import "dotenv/config";
import { StateGraph, MessagesAnnotation, Annotation } from "@langchain/langgraph";
import { AIMessage, BaseMessage, createAgent, HumanMessage } from "langchain";
import model from '@/agent'

// 定义包含路由信息的状态
const SupervisorState = Annotation.Root({
  // 继承默认的消息历史
  ...MessagesAnnotation.spec,

  // 下一个要执行的 Agent 名称
  nextAgent: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "supervisor",
  }),

  // 任务进度追踪
  taskProgress: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),

  // ---- 错误恢复相关字段 ----

  // 各 Agent 的失败次数
  errorCount: Annotation<Record<string, number>>({
    reducer: (current, next) => ({ ...current, ...next }),
    default: () => ({}),
  }),

  // 最后一次错误消息
  lastError: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
});

const MAX_RETRIES = 2; // 每个 Agent 最多重试次数

/** 用 try/catch 包裹 worker 节点，失败时记录错误并返回错误消息 */
function withErrorHandling(
  name: string,
  run: (messages: BaseMessage[]) => Promise<{ messages: BaseMessage[] }>
) {
  return async (state: typeof SupervisorState.State) => {
    const currentFails = state.errorCount?.[name] ?? 0;

    if (currentFails >= MAX_RETRIES) {
      const msg = `[跳过] ${name} 已失败 ${currentFails} 次，超过最大重试次数`;
      console.log(`  ⚠️ ${msg}`);
      return {
        messages: [new AIMessage(`[系统] ${msg}，任务已移交给下一步处理。`)],
        errorCount: { [name]: currentFails },
        lastError: msg,
      };
    }

    console.log(`[${name}] 开始工作...`);
    try {
      const result = await run(state.messages);
      console.log(`[${name}] 工作完成`);
      return {
        messages: result.messages,
        lastError: "",
      };
    } catch (error) {
      const newFails = currentFails + 1;
      const errorMsg = `${name} 执行失败（第 ${newFails} 次）: ${error instanceof Error ? error.message : "未知错误"}`;
      console.error(`  ❌ ${errorMsg}`);

      return {
        messages: [new AIMessage(`[系统] ${errorMsg}，将重试（剩余 ${MAX_RETRIES - newFails} 次）。`)],
        errorCount: { [name]: newFails },
        nextAgent: "supervisor",
        lastError: errorMsg,
      };
    }
  };
}

// 研究员 Agent：负责搜集信息
const researchAgent = createAgent({
  model,
  tools: [],
  systemPrompt: `你是资深研究员，擅长搜集和整理信息。

职责：
1. 根据任务要求搜索相关信息
2. 从多个来源验证信息准确性
3. 输出结构化的研究报告

输出格式：
- 关键发现（3-5 条）
- 数据来源
- 待确认的问题`,
});

// 作家 Agent：负责撰写内容
const writerAgent = createAgent({
  model,
  tools: [],
  systemPrompt: `你是专业作家，擅长将信息整合成易读的文章。

职责：
1. 基于研究员提供的资料撰写文章
2. 确保文章结构清晰、逻辑连贯
3. 语言生动、引人入胜

注意：不要编造事实，所有内容必须基于提供的资料。`,
});

// 编辑 Agent：负责质量把关
const editorAgent = createAgent({
  model,
  tools: [],
  systemPrompt: `你是资深编辑，负责审核和优化文章质量。

审核标准：
1. 事实准确性：是否有错误或遗漏
2. 逻辑连贯性：段落之间是否衔接自然
3. 语言表达：是否简洁、准确、生动
4. 格式规范：标题、段落、标点是否正确

输出：修改后的文章 + 修改说明`,
});


// Supervisor 决定下一步交给谁
async function supervisorNode(state: typeof SupervisorState.State) {
  // 构建决策 Prompt
  const decisionPrompt = `你是任务协调员。根据当前进展，决定下一步应该交给谁处理。

可用选项：
- research：研究员（需要搜集更多信息时）
- writer：作家（需要撰写或修改文章时）
- editor：编辑（需要审核和优化质量时）
- finish：任务完成（用户对结果满意时）

当前任务进度：
${state.taskProgress || "尚未开始"}

${state.lastError ? `最近错误：${state.lastError}\n` : ""}

最近对话：
${state.messages.slice(-3).map(m => {
    const role = m._getType?.() ?? "unknown";
    const content = typeof m.content === "string" ? m.content.slice(0, 200) : "";
    return `[${role}]: ${content}`;
  }).join("\n")}

请只回复一个单词（research/writer/editor/finish），不要解释。`;

  const response = await model.invoke([
    { role: "system", content: decisionPrompt },
  ]);

  const raw = response.content?.toString().trim().toLowerCase() || "finish";
  // 只取第一行/第一个单词
  const nextAgent = raw.split("\n")[0].trim().replace(/[^a-z]/g, "");

  console.log(`[Supervisor] 下一步 → ${nextAgent}`);

  return { 
    nextAgent,
    taskProgress: `[${new Date().toLocaleTimeString()}] Supervisor 决策 → ${nextAgent}`,
  };
}

// ------------------------实现worker节点（带错误恢复）------------------------

const researchNode = withErrorHandling("研究员", (msgs) => researchAgent.invoke({ messages: msgs }));
const writerNode = withErrorHandling("作家", (msgs) => writerAgent.invoke({ messages: msgs }));
const editorNode = withErrorHandling("编辑", (msgs) => editorAgent.invoke({ messages: msgs }));


// ------------------------构建工作流------------------------

// 条件路由函数
function routeFromSupervisor(state: typeof SupervisorState.State) {
  const next = state.nextAgent;

  if (next === "finish" || next === "end" || next === "__end__") {
    return "__end__";
  }

  // 映射到有效的节点名
  const validNodes: Record<string, string> = {
    research: "research",
    writer: "writer",
    editor: "editor",
  };

  return validNodes[next] || "research"; // 默认走 research
}

// 构建多 Agent 图
const workflow = new StateGraph(SupervisorState)
  // 添加节点
  .addNode("supervisor", supervisorNode)
  .addNode("research", researchNode)
  .addNode("writer", writerNode)
  .addNode("editor", editorNode)
  
  // 定义边
  .addEdge("__start__", "supervisor")  // 入口 → Supervisor
  
  // Supervisor 的条件路由
  .addConditionalEdges("supervisor", routeFromSupervisor, {
    research: "research",
    writer: "writer",
    editor: "editor",
    __end__: "__end__",
  })
  
  // Worker 完成后返回 Supervisor（静态边确保永远回到协调者）
  .addEdge("research", "supervisor")
  .addEdge("writer", "supervisor")
  .addEdge("editor", "supervisor");

// 编译为可执行应用
const multiAgentApp = workflow.compile();


console.log("=".repeat(50));
console.log("  Supervisor 多 Agent 协调系统");
console.log("  Supervisor → [研究员 → 作家 → 编辑]");
console.log("=".repeat(50) + "\n");

// 执行多 Agent 系统
const result = await multiAgentApp.invoke({
  messages: [new HumanMessage("写一篇长沙一日游攻略文章")],
});

console.log("\n" + "=".repeat(50));
console.log("  最终结果");
console.log("=".repeat(50) + "\n");
console.log(result.messages.at(-1)?.content);

console.log("\n" + "=".repeat(50));
console.log("  任务进度");
console.log("=".repeat(50));
console.log(result.taskProgress);

```



## 子 Agent 的资源隔离

#### 静态工具配置

最简单的方式：创建 Agent 时只传入它需要的工具。

```ts
// 研究员 Agent：只有搜索相关工具
const researchAgent = createAgent({
  model: "openai:gpt-4o",
  tools: [
    searchTool,           // ✅ 允许
    fetchWebpageTool,     // ✅ 允许
    wikipediaTool,        // ✅ 允许
  ],
  // ❌ 没有文件写入权限
  // ❌ 没有数据库访问权限
  // ❌ 没有邮件发送权限
});

```

#### 动态工具配置

根据上下文动态决定可用的工具。

```ts
import { createAgent } from "langchain";

// 创建基础 Agent（不传工具）
const flexibleAgent = createAgent({
  model: "openai:gpt-4o",
  tools: [],  // 初始为空
});

// 根据用户角色动态提供工具
async function invokeWithDynamicTools(userRole: string, query: string) {
  let availableTools = [];
  
  switch (userRole) {
    case "admin":
      availableTools = [
        searchTool,
        databaseQueryTool,
        deleteUserTool,      // ⚠️ 危险操作
        systemConfigTool,
      ];
      break;
      
    case "editor":
      availableTools = [
        searchTool,
        readFileTool,
        writeFileTool,
      ];
      break;
      
    case "viewer":
      availableTools = [
        searchTool,
        readFileTool,
      ];
      break;
  }
  
  // 调用时传入工具
  const result = await flexibleAgent.invoke(
    { messages: [{ role: "user", content: query }] },
    { configurable: { tools: availableTools } }
  );
  
  return result;
}

```

### 实现数据隔离

#### 命名空间隔离

不同的 Agent 使用不同的向量数据库命名空间。

```ts
import { PineconeStore } from "@langchain/pinecone";

// 研究员的知识库（公开信息）
const researchVectorStore = await PineconeStore.fromExistingIndex(
  embeddings,
  {
    pineconeIndex: index,
    namespace: "public-research",  // 命名空间隔离
  }
);

// 财务 Agent 的知识库（敏感信息）
const financeVectorStore = await PineconeStore.fromExistingIndex(
  embeddings,
  {
    pineconeIndex: index,
    namespace: "confidential-finance",  // 不同的命名空间
  }
);

// 研究员 Agent 只能访问公开知识库
const researchAgent = createAgent({
  model: "openai:gpt-4o",
  tools: [createRetrieverTool(researchVectorStore)],
});

// 财务 Agent 只能访问财务知识库
const financeAgent = createAgent({
  model: "openai:gpt-4o",
  tools: [createRetrieverTool(financeVectorStore)],
});

```

#### 元数据过滤

在检索时根据 Agent 身份过滤结果。

```ts
// 文档中添加权限标签
await vectorStore.addDocuments([
  new Document({
    pageContent: "财务报告内容...",
    metadata: {
      source: "finance-report.pdf",
      allowedAgents: ["finance", "supervisor"],  // 只有特定 Agent 能访问
      sensitivity: "high",
    },
  }),
  new Document({
    pageContent: "产品说明书...",
    metadata: {
      source: "product-manual.pdf",
      allowedAgents: ["research", "writer", "supervisor"],  // 更多 Agent 能访问
      sensitivity: "low",
    },
  }),
]);

// 检索时过滤
function createRestrictedRetriever(agentName: string) {
  return vectorStore.asRetriever({
    filter: {
      allowedAgents: { $in: [agentName] },  // 只返回该 Agent 有权访问的文档
    },
  });
}

// 研究员只能访问公开文档
const researchRetriever = createRestrictedRetriever("research");

// 财务可以访问财务文档
const financeRetriever = createRestrictedRetriever("finance");

```

