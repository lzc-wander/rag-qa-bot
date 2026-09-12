有些操作——比如删除数据、发送通知、执行付款——需要在执行前得到人工确认。LangGraph 的**中断（Interrupt）** 机制支持在任意节点暂停 Agent，等待外部输入。



### 基本实现

#### 第一步：定义需要确认的工具

```ts
import { interrupt, tool } from "langchain";
import { z } from "zod";

const deleteData = tool(
  async ({ recordId }) => {
    // 发起中断，等待人工确认
    const confirmed = await interrupt({
      question: `确认删除记录 ${recordId}？此操作不可撤销。`,
      type: "confirm",
    });

    if (!confirmed) {
      return "操作已取消";
    }

    // 执行删除
    await db.delete(recordId);
    return `记录 ${recordId} 已删除`;
  },
  {
    name: "delete_data",
    description: "删除指定记录（需要人工确认）",
    schema: z.object({ 
      recordId: z.string().describe("要删除的记录 ID") 
    }),
  }
);




```

#### 第二步：创建 Agent

```ts
import { createAgent } from "langchain";
import { MemorySaver } from "@langchain/langgraph";

const agent = createAgent({
  model: "openai:gpt-4o",
  tools: [deleteData],
  checkpointer: new MemorySaver(),  // ⚠️ Human-in-the-loop 需要 checkpointer
});

```

**⚠️ 重要提示**：

- Human-in-the-loop **必须**配置 `checkpointer`
- 因为中断后需要恢复状态，checkpointer 负责保存和恢复