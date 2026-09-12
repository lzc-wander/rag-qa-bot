# 工具解决什么问题

## 知识滞后性

大模型无法感知实时的信息，它的能力来源于训练数据，例如：问它今天广州天气如何？  它是无法解答的，此时就可以借用工具来处理

## 缺乏精准的计算与执行

在处理复杂数学运算或确定性任务时容易产生“幻觉”。 这就就像是一个被关在图书馆里的知识渊博的学者，尽管他知道很多知识（训练数据），但他无法上网查最新信息，也无法帮你发邮件，执行任务。



# 工具调用机制

工具调用的核心流程：

![image-20260722193115597](C:/Users/admin/AppData/Roaming/Typora/typora-user-images/image-20260722193115597.png)



# 定义工具：tool() API

每个工具由三部分组成：

- 要执行的函数

- 函数的元数据，包括名称、描述等

- 使用`tool`工具函数进行包装

  

```js
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const myTool = tool(
  // 第一部分：执行函数（做什么）
  (params) => {
    // 实际的业务逻辑
    return "结果字符串";
  },
  
  // 第二部分：元数据（告诉 LLM 这是什么）
  {
    name: "my_tool",                    // 工具名称
    description: "工具的功能描述",       // LLM 根据描述决定是否调用
    schema: z.object({...}),            // 参数校验规则
  }
);

```



例如：

```js
import { tool } from "langchain";
import { z } from "zod";

function getCurrentTime({ format }: { format?: string }): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  switch (format) {
    case "iso":
      return now.toISOString();
    case "date":
      return `${year}年${month}月${day}日`;
    case "time":
      return `${hours}:${minutes}:${seconds}`;
    default:
      return `${year}年${month}月${day}日 ${hours}:${minutes}:${seconds}`;
  }
}

export const getTime = tool(getCurrentTime, {
  name: "get_time",
  description: "获取当前的日期和时间，支持多种格式返回",
  schema: z.object({
    format: z  // format是函数的参数
      .enum(["full", "date", "time", "iso"])
      .optional()
      .describe("返回格式：full（完整日期时间）、date（仅日期）、time（仅时间）、iso（ISO 格式）"),
  }),
});
```



# 工具错误处理

### 工具内部处理

```js
const searchDatabase = tool(
  async ({ query, table }) => {
    try {
      // 执行数据库查询
      const results = await db.query(`SELECT * FROM ${table} WHERE ...`);
      
      if (results.length === 0) {
        return "查询没有找到结果，请尝试不同的搜索条件。";
      }
      
      // 只返回前 10 条，避免 Token 浪费
      return JSON.stringify(results.slice(0, 10));
      
    } catch (error) {
      // 根据错误类型返回不同的消息
      if (error instanceof DatabaseError) {
        return `数据库查询失败：表 "${table}" 不存在或无权访问。`;
      }
      
      return `查询出错：${error instanceof Error ? error.message : "未知错误"}`;
    }
  },
  {
    name: "search_database",
    description: "在数据库中搜索数据，返回匹配的记录",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
      table: z.string().describe("要搜索的表名，如 'users' 或 'orders'"),
    }),
  }
);

```

### 中间件统一处理

```js
import { createAgent, createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";

// 创建统一的工具错误处理中间件
const toolErrorHandler = createMiddleware({
  name: "ToolErrorHandler",
  
  // 拦截工具调用
  wrapToolCall: async (request, handler) => {
    try {
      // 正常执行工具
      return await handler(request);
    } catch (error) {
      // 统一返回友好的错误消息
      console.error(`工具 ${request.toolCall.name} 调用失败:`, error);
      
      return new ToolMessage({
        content: `工具调用失败：${error instanceof Error ? error.message : "未知错误"}。请尝试其他方式或告知用户无法完成该操作。`,
        tool_call_id: request.toolCall.id!,
      });
    }
  },
});

// 注册中间件
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: [searchDatabase, getWeather, calculator],
  middleware: [toolErrorHandler],  // 添加错误处理中间件
});

```

# 工具注册

### 静态工具列表（最常见）

```js
import { createAgent } from "langchain";

const agent = createAgent({
  model: "openai:gpt-4o",
  tools: [
    searchTool,
    calculatorTool,
    weatherTool,
    emailTool,
  ],
});

```

### 动态工具选择（基于权限）

```js
import { createAgent } from "langchain";

// 定义工具池
const allTools = {
  basic: [searchTool, calculatorTool],
  advanced: [weatherTool, codeExecutorTool],
  admin: [deleteDataTool, systemConfigTool],
};

// 根据用户角色获取可用工具
function getToolsForUser(userRole: "admin" | "user" | "guest") {
  switch (userRole) {
    case "admin":
      return [...allTools.basic, ...allTools.advanced, ...allTools.admin];
    case "user":
      return [...allTools.basic, ...allTools.advanced];
    case "guest":
      return allTools.basic;
    default:
      return allTools.basic;
  }
}

// 创建 Agent（初始不传工具）
const agent = createAgent({ 
  model: "openai:gpt-4o", 
  tools: [] 
});

// 调用时动态传入工具
const userRole = "user";  // 从会话中获取
const result = await agent.invoke(
  { messages: [{ role: "user", content: "帮我删除测试数据" }] },
  { configurable: { tools: getToolsForUser(userRole) } }
);

```

