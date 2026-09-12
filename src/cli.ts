// src/cli.ts
import * as readline from "readline";
import { RAGGenerator } from "./generator";
import { VectorStoreRetriever } from "@langchain/core/vectorstores";

export function startCLI(
  generator: RAGGenerator,
  retriever: VectorStoreRetriever
) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n📖 RAG 文档问答机器人已启动");
  console.log("可用命令：");
  console.log("  /exit  - 退出程序");
  console.log("  /clear - 清空对话历史");
  console.log("  /help  - 显示帮助\n");

  const ask = () => {
    rl.question("> ", async (query) => {
      const trimmedQuery = query.trim();

      // 处理特殊命令
      if (trimmedQuery === "/exit") {
        console.log("再见！👋");
        rl.close();
        return;
      }

      if (trimmedQuery === "/clear") {
        generator.clearHistory();
        ask();
        return;
      }

      if (trimmedQuery === "/help") {
        console.log("\n可用命令：");
        console.log("  /exit  - 退出程序");
        console.log("  /clear - 清空对话历史");
        console.log("  /help  - 显示帮助");
        console.log("  直接输入问题进行问答\n");
        ask();
        return;
      }

      // 空输入
      if (!trimmedQuery) {
        ask();
        return;
      }

      try {
        console.log("\n🔍 正在检索相关文档...");
        
        // 检索
        const startTime = Date.now();
        const docs = await retriever.invoke(trimmedQuery);
        const retrieveTime = Date.now() - startTime;
        
        console.log(`✓ 找到 ${docs.length} 个相关片段（耗时 ${retrieveTime}ms）\n`);

        // 生成答案
        console.log("💬 正在生成答案...");
        const generateStartTime = Date.now();
        const answer = await generator.generate(trimmedQuery, docs);
        const generateTime = Date.now() - generateStartTime;

        console.log(`\n${answer}\n`);
        console.log(`⏱️  生成耗时: ${generateTime}ms`);

        // 显示引用来源
        if (docs.length > 0) {
          console.log("\n📎 引用来源:");
          for (const [i, doc] of docs.entries()) {
            const source = doc.metadata.source || "未知来源";
            const preview = doc.pageContent.slice(0, 100).replace(/\n/g, " ");
            console.log(`  [${i + 1}] ${source}`);
            console.log(`      ${preview}...`);
          }
        }
        
        console.log(`\n📊 对话历史长度: ${generator.getHistoryLength()} 条消息\n`);
      } catch (error) {
        console.error(`\n❌ 处理失败: ${error.message}\n`);
      }

      ask();
    });
  };

  ask();
}
