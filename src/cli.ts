// src/cli.ts
import * as readline from "readline";
import { RAGGenerator } from "./generator";
import { VectorStoreRetriever } from "@langchain/core/vectorstores";
import { logQuery, getQueryStats } from "./logger";
import { QueryCache } from "./cache";

export function startCLI(
  generator: RAGGenerator,
  retriever: VectorStoreRetriever,
  cache: QueryCache
) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n📖 RAG 文档问答机器人已启动");
  console.log("可用命令：");
  console.log("  /exit  - 退出程序");
  console.log("  /clear - 清空对话历史");
  console.log("  /stats - 查看查询统计");
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

      if (trimmedQuery === "/stats") {
        const stats = getQueryStats();
        const cacheStats = cache.getStats();
        console.log("\n📊 查询统计:");
        console.log(`  总查询次数: ${stats.totalQueries}`);
        console.log(`  成功: ${stats.successCount}  失败: ${stats.failureCount}`);
        console.log(`  平均总耗时: ${stats.avgTotalTime}ms`);
        console.log(`  平均检索耗时: ${stats.avgRetrieveTime}ms`);
        console.log(`  平均生成耗时: ${stats.avgGenerateTime}ms`);
        if (stats.hotQuestions.length > 0) {
          console.log("  热门问题:");
          stats.hotQuestions.forEach((item, i) => {
            console.log(`    ${i + 1}. [${item.count}次] ${item.query}`);
          });
        }
        console.log("\n💾 缓存统计:");
        console.log(`  缓存条目数: ${cacheStats.size}`);
        console.log(`  命中/未命中: ${cacheStats.hits} / ${cacheStats.misses}`);
        console.log(`  命中率: ${(cacheStats.hitRate * 100).toFixed(1)}%`);
        console.log(`  TTL: ${cacheStats.ttl / 1000 / 60} 分钟`);
        console.log("");
        ask();
        return;
      }

      if (trimmedQuery === "/help") {
        console.log("\n可用命令：");
        console.log("  /exit  - 退出程序");
        console.log("  /clear - 清空对话历史");
        console.log("  /stats - 查看查询统计");
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

      const startTime = Date.now();
      let retrieveTime = 0;
      let generateTime = 0;
      let docCount = 0;

      try {
        // 先查缓存
        const cached = cache.get(trimmedQuery);
        if (cached) {
          const totalTime = Date.now() - startTime;
          console.log("\n⚡ 命中缓存，直接返回答案\n");
          console.log(cached.answer);
          console.log(`\n⏱️  总耗时: ${totalTime}ms（缓存命中，跳过检索与生成）`);

          // 显示缓存的引用来源
          if (cached.sources.length > 0) {
            console.log("\n📎 引用来源:");
            cached.sources.forEach((src, i) => {
              console.log(`  [${i + 1}] ${src.source}`);
            });
          }

          // 记录日志（生成耗时为 0）
          logQuery(trimmedQuery, {
            docCount: cached.sources.length,
            retrieveTime: 0,
            generateTime: 0,
            totalTime,
            success: true,
          });
          ask();
          return;
        }

        console.log("\n🔍 正在检索相关文档...");
        
        // 检索
        const retrieveStart = Date.now();
        const docs = await retriever.invoke(trimmedQuery);
        retrieveTime = Date.now() - retrieveStart;
        docCount = docs.length;
        
        console.log(`✓ 找到 ${docs.length} 个相关片段（耗时 ${retrieveTime}ms）\n`);

        // 生成答案
        console.log("💬 正在生成答案...");
        const generateStart = Date.now();
        const answer = await generator.generate(trimmedQuery, docs);
        generateTime = Date.now() - generateStart;

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

        // 写入缓存
        cache.set(
          trimmedQuery,
          answer,
          docs.map((doc) => ({
            source: doc.metadata.source || "未知来源",
            content: doc.pageContent.slice(0, 200),
          }))
        );

        // 记录成功日志
        logQuery(trimmedQuery, {
          docCount,
          retrieveTime,
          generateTime,
          totalTime: Date.now() - startTime,
          success: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n❌ 处理失败: ${message}\n`);

        // 记录失败日志
        logQuery(trimmedQuery, {
          docCount,
          retrieveTime,
          generateTime,
          totalTime: Date.now() - startTime,
          success: false,
          error: message,
        });
      }

      ask();
    });
  };

  ask();
}
