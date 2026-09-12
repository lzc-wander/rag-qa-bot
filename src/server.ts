// src/server.ts
import express, { Request, Response } from "express";
import { RAGGenerator } from "./generator";
import { VectorStoreRetriever } from "@langchain/core/vectorstores";
import { logQuery, getQueryStats } from "./logger";
import { QueryCache } from "./cache";

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
    totalTime: number;
    historyLength: number;
    fromCache: boolean;
  };
}

export function startServer(
  generator: RAGGenerator,
  retriever: VectorStoreRetriever,
  cache: QueryCache
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

    const startTime = Date.now();
    let retrieveTime = 0;
    let generateTime = 0;
    let docCount = 0;

    try {
      // 先查缓存
      const cached = cache.get(query);
      if (cached) {
        const totalTime = Date.now() - startTime;

        logQuery(query, {
          docCount: cached.sources.length,
          retrieveTime: 0,
          generateTime: 0,
          totalTime,
          success: true,
        });

        const response: ChatResponse = {
          answer: cached.answer,
          sources: cached.sources,
          metadata: {
            retrieveTime: 0,
            generateTime: 0,
            totalTime,
            historyLength: generator.getHistoryLength(),
            fromCache: true,
          },
        };

        return res.json(response);
      }

      // 检索
      const retrieveStart = Date.now();
      const docs = await retriever.invoke(query);
      retrieveTime = Date.now() - retrieveStart;
      docCount = docs.length;

      // 生成
      const generateStart = Date.now();
      const answer = await generator.generate(query, docs);
      generateTime = Date.now() - generateStart;

      const totalTime = Date.now() - startTime;

      // 写入缓存
      cache.set(
        query,
        answer,
        docs.map((doc) => ({
          source: doc.metadata.source || "未知来源",
          content: doc.pageContent.slice(0, 200),
        }))
      );

      // 记录成功日志
      logQuery(query, {
        docCount,
        retrieveTime,
        generateTime,
        totalTime,
        success: true,
      });

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
          totalTime,
          historyLength: generator.getHistoryLength(),
          fromCache: false,
        },
      };

      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      console.error("API 错误:", error);

      // 记录失败日志
      logQuery(query, {
        docCount,
        retrieveTime,
        generateTime,
        totalTime: Date.now() - startTime,
        success: false,
        error: message,
      });

      res.status(500).json({
        error: "服务器内部错误",
        message,
      });
    }
  });

  /**
   * POST /clear - 清空对话历史和缓存
   */
  app.post("/clear", (req: Request, res: Response) => {
    generator.clearHistory();
    cache.clear();
    res.json({ message: "对话历史和缓存已清空" });
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
   * GET /stats - 统计信息（含查询日志统计和缓存统计）
   */
  app.get("/stats", (_req: Request, res: Response) => {
    const queryStats = getQueryStats();
    const cacheStats = cache.getStats();
    res.json({
      historyLength: generator.getHistoryLength(),
      queryStats,
      cacheStats,
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
