// src/main.ts
import "dotenv/config";
import { join } from "path";
import { buildIndex } from "./indexer";
import { createRetriever } from "./retriever";
import { RAGGenerator } from "./generator";
import { startCLI } from "./cli";
import { startServer } from "./server";
import { QueryCache } from "./cache";

async function main() {
  console.log("=== RAG 文档问答机器人 ===\n");

  // ========== 索引阶段 ==========
  const vectorStore = await buildIndex({
    docsDir: join(__dirname, "../docs"),
    collectionName: "knowledge_base",
    chunkSize: 500,
    chunkOverlap: 50,
  });

  // ========== 检索-生成阶段 ==========
  const retriever = createRetriever(vectorStore, { k: 4 });
  const generator = new RAGGenerator({
    modelName: "deepseek-v4-flash",
    temperature: 0,
    maxHistoryLength: 10,
  });
  const cache = new QueryCache(); // 默认 TTL 1 小时

  // 根据命令行参数选择模式
  const mode = process.argv[2] || "cli";

  if (mode === "server") {
    console.log("启动模式: REST API 服务\n");
    startServer(generator, retriever, cache);
  } else {
    console.log("启动模式: CLI 交互\n");
    startCLI(generator, retriever, cache);
  }
}

main().catch((error) => {
  console.error("启动失败:", error);
  process.exit(1);
});
