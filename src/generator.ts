// src/generator.ts
import { ChatOpenAI } from "@langchain/openai";
import { Document } from "@langchain/core/documents";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface GeneratorConfig {
  modelName?: string;
  temperature?: number;
  maxHistoryLength?: number;  // 最大历史消息数
}

export class RAGGenerator {
  private llm: ChatOpenAI;
  private history: Message[] = [];
  private maxHistoryLength: number;

  constructor(config: GeneratorConfig = {}) {
    this.llm = new ChatOpenAI({
      modelName: config.modelName || "gpt-4o",
      temperature: config.temperature ?? 0,  // 降低随机性
    });
    this.maxHistoryLength = config.maxHistoryLength || 10;
  }

  /**
   * 构建包含历史和上下文的 Prompt
   */
  private buildPrompt(query: string, docs: Document[]): string {
    // 组装参考资料
    const context = docs
      .map((doc, i) => `[文档 ${i + 1}] ${doc.pageContent}`)
      .join("\n\n");

    // 组装对话历史
    const historyText = this.history.length > 0
      ? this.history
          .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
          .join("\n")
      : "（新对话）";

    return `你是一个专业的知识库问答助手。请根据以下资料回答问题。

## 对话历史
${historyText}

## 参考资料
${context}

## 当前问题
${query}

## 回答要求
1. 严格基于提供的参考资料回答，不要编造信息
2. 如果资料中没有相关信息，请明确说明"根据现有资料无法回答"
3. 在回答中标注引用的文档编号，如"[文档 1]"、"[文档 2]"
4. 回答要简洁清晰，避免冗余
5. 如果涉及步骤或列表，使用清晰的格式

请开始回答：`;
  }

  /**
   * 生成答案
   */
  async generate(query: string, docs: Document[]): Promise<string> {
    const prompt = this.buildPrompt(query, docs);
    
    const messages = [
      new SystemMessage("你是一个专业的知识库问答助手。"),
      new HumanMessage(prompt),
    ];
    
    const response = await this.llm.invoke(messages);
    const answer = response.content as string;

    // 更新对话历史
    this.addToHistory("user", query);
    this.addToHistory("assistant", answer);

    return answer;
  }

  /**
   * 添加消息到历史记录
   */
  private addToHistory(role: "user" | "assistant", content: string) {
    this.history.push({
      role,
      content,
      timestamp: new Date(),
    });

    // 如果超过最大长度，移除最早的消息
    if (this.history.length > this.maxHistoryLength * 2) {
      this.history = this.history.slice(-this.maxHistoryLength * 2);
    }
  }

  /**
   * 清空对话历史
   */
  clearHistory() {
    this.history = [];
    console.log("✓ 对话历史已清空");
  }

  /**
   * 获取当前历史长度
   */
  getHistoryLength(): number {
    return this.history.length;
  }
}
