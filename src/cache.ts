// src/cache.ts
/** 缓存中的引用来源 */
export interface CachedSource {
  source: string;
  content: string;
}

/** 单条缓存记录 */
interface CacheEntry {
  answer: string;
  sources: CachedSource[];
  timestamp: number; // 创建时间戳 (ms)，用于 TTL 判断
}

/** 缓存统计信息 */
export interface CacheStats {
  size: number;          // 当前缓存条目数
  totalRequests: number; // 总查询次数
  hits: number;          // 命中次数
  misses: number;        // 未命中次数
  hitRate: number;       // 命中率 (0-1)
  ttl: number;           // TTL (ms)
}

/**
 * 带 TTL 的查询缓存
 * - 以归一化后的问题文本为 key
 * - 命中时直接返回缓存的答案和来源，跳过检索与 LLM 调用
 * - 超过 TTL 的条目自动失效
 */
export class QueryCache {
  private store = new Map<string, CacheEntry>();
  private ttl: number;
  private totalRequests = 0;
  private hits = 0;

  /**
   * @param ttlMs 缓存过期时间，默认 1 小时
   */
  constructor(ttlMs: number = 60 * 60 * 1000) {
    this.ttl = ttlMs;
  }

  /** 归一化查询文本，作为缓存 key */
  private normalizeKey(query: string): string {
    return query.trim().toLowerCase();
  }

  /**
   * 获取缓存
   * @returns 命中且未过期返回缓存内容，否则返回 null
   */
  get(query: string): { answer: string; sources: CachedSource[] } | null {
    this.totalRequests++;
    const key = this.normalizeKey(query);
    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.ttl) {
      this.store.delete(key);
      return null;
    }

    this.hits++;
    return { answer: entry.answer, sources: entry.sources };
  }

  /**
   * 写入缓存
   */
  set(query: string, answer: string, sources: CachedSource[]): void {
    const key = this.normalizeKey(query);
    this.store.set(key, {
      answer,
      sources,
      timestamp: Date.now(),
    });
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * 清理过期条目
   */
  evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.timestamp > this.ttl) {
        this.store.delete(key);
      }
    }
  }

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    this.evictExpired();
    const misses = this.totalRequests - this.hits;
    const hitRate = this.totalRequests > 0 ? this.hits / this.totalRequests : 0;
    return {
      size: this.store.size,
      totalRequests: this.totalRequests,
      hits: this.hits,
      misses,
      hitRate,
      ttl: this.ttl,
    };
  }
}
