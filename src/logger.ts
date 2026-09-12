// src/logger.ts
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

/** 单条查询日志记录 */
export interface QueryLog {
  timestamp: string;
  query: string;
  docCount: number;
  retrieveTime: number;   // 检索耗时 (ms)
  generateTime: number;   // 生成答案耗时 (ms)
  totalTime: number;      // 总耗时 (ms)
  success: boolean;
  error?: string;
}

/** 统计结果 */
export interface QueryStats {
  totalQueries: number;
  successCount: number;
  failureCount: number;
  avgTotalTime: number;       // 平均总耗时 (ms)
  avgRetrieveTime: number;    // 平均检索耗时 (ms)
  avgGenerateTime: number;    // 平均生成耗时 (ms)
  hotQuestions: Array<{ query: string; count: number }>;
}

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "queries.log");

/** 确保日志目录存在 */
function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * 记录一次查询日志
 * @param query 用户问题
 * @param metrics 检索/生成耗时等指标
 */
export function logQuery(
  query: string,
  metrics: {
    docCount: number;
    retrieveTime: number;
    generateTime: number;
    totalTime: number;
    success: boolean;
    error?: string;
  }
): void {
  ensureLogDir();

  const entry: QueryLog = {
    timestamp: new Date().toISOString(),
    query,
    ...metrics,
  };

  try {
    appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    console.error("写入查询日志失败:", err);
  }
}

/**
 * 读取所有查询日志
 */
export function readQueryLogs(): QueryLog[] {
  if (!existsSync(LOG_FILE)) {
    return [];
  }

  try {
    const content = readFileSync(LOG_FILE, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as QueryLog;
        } catch {
          return null;
        }
      })
      .filter((log): log is QueryLog => log !== null);
  } catch (err) {
    console.error("读取查询日志失败:", err);
    return [];
  }
}

/**
 * 统计查询日志：平均延迟、热门问题等
 * @param topN 热门问题返回数量
 */
export function getQueryStats(topN = 10): QueryStats {
  const logs = readQueryLogs();

  if (logs.length === 0) {
    return {
      totalQueries: 0,
      successCount: 0,
      failureCount: 0,
      avgTotalTime: 0,
      avgRetrieveTime: 0,
      avgGenerateTime: 0,
      hotQuestions: [],
    };
  }

  const successLogs = logs.filter((log) => log.success);
  const totalTimeSum = successLogs.reduce((sum, log) => sum + log.totalTime, 0);
  const retrieveTimeSum = successLogs.reduce(
    (sum, log) => sum + log.retrieveTime,
    0
  );
  const generateTimeSum = successLogs.reduce(
    (sum, log) => sum + log.generateTime,
    0
  );

  // 统计热门问题（按 query 归一化后计数）
  const queryCount = new Map<string, number>();
  for (const log of logs) {
    const key = log.query.trim().toLowerCase();
    queryCount.set(key, (queryCount.get(key) || 0) + 1);
  }

  const hotQuestions = Array.from(queryCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([query, count]) => ({ query, count }));

  const divisor = successLogs.length || 1;

  return {
    totalQueries: logs.length,
    successCount: successLogs.length,
    failureCount: logs.length - successLogs.length,
    avgTotalTime: Math.round(totalTimeSum / divisor),
    avgRetrieveTime: Math.round(retrieveTimeSum / divisor),
    avgGenerateTime: Math.round(generateTimeSum / divisor),
    hotQuestions,
  };
}
