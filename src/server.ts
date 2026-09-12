// src/server.ts
import express, { Request, Response } from "express";
import { RAGGenerator } from "./generator";
import { VectorStoreRetriever } from "@langchain/core/vectorstores";

interface ChatRequest {
  query: string;
  sessionId?: string;  // 可选：用于多用户会话隔离
}

interface ChatResponse {
  answer: string;
  sources: Array<{
    source: string;
    content: string;
    relevance?: number;
  }>;
  metadata: {
    retrieveTime: number;
    generateTime: number;
    historyLength: number;
  };
}

export function startServer(
  generator: RAGGenerator,
  retriever: VectorStoreRetriever
): void {
  const app = express();
  app.use(express.json());

  // CORS 支持（如果需要跨域访问）
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    next();
  });

  /**
   * POST /chat - 问答接口
   */
  app.post("/chat", async (req: Request, res: Response) => {
    const { query }: ChatRequest = req.body;

    // 参数验证
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return res.status(400).json({
        error: "缺少必要参数: query",
      });
    }

    try {
      const startTime = Date.now();

      // 检索
      const retrieveStart = Date.now();
      const docs = await retriever.invoke(query);
      const retrieveTime = Date.now() - retrieveStart;

      // 生成
      const generateStart = Date.now();
      const answer = await generator.generate(query, docs);
      const generateTime = Date.now() - generateStart;

      const totalTime = Date.now() - startTime;

      // 组装响应
      const response: ChatResponse = {
        answer,
        sources: docs.map((doc) => ({
          source: doc.metadata.source || "未知来源",
          content: doc.pageContent.slice(0, 200),
        })),
        metadata: {
          retrieveTime,
          generateTime,
          historyLength: generator.getHistoryLength(),
        },
      };

      res.json(response);
    } catch (error) {
      console.error("API 错误:", error);
      res.status(500).json({
        error: "服务器内部错误",
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  });

  /**
   * POST /clear - 清空对话历史
   */
  app.post("/clear", (req: Request, res: Response) => {
    generator.clearHistory();
    res.json({ message: "对话历史已清空" });
  });

  /**
   * GET /health - 健康检查端点
   */
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /stats - 统计信息
   */
  app.get("/stats", (_req: Request, res: Response) => {
    res.json({
      historyLength: generator.getHistoryLength(),
    });
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  
  app.listen(port, () => {
    console.log(`\n🚀 RAG API 服务已启动`);
    console.log(`   http://localhost:${port}`);
    console.log(`   健康检查: http://localhost:${port}/health`);
    console.log(`   问答接口: POST http://localhost:${port}/chat\n`);
  });
}
