// src/retriever.ts
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { VectorStoreRetriever } from "@langchain/core/vectorstores";

export interface RetrieverConfig {
  k?: number;                // 返回结果数量
  scoreThreshold?: number;   // 相似度阈值
}

export function createRetriever(
  vectorStore: Chroma,
  config: RetrieverConfig = {}
): VectorStoreRetriever {
  const { k = 4, scoreThreshold } = config;
  
  const retriever = vectorStore.asRetriever({ k });
  
  if (scoreThreshold !== undefined) {
    // 重写 invoke 方法，加入分数过滤逻辑
    retriever.invoke = async (query: string) => {
      // 1. 获取带有分数的检索结果 (注意：Chroma 返回的是距离 distance)
      // 假设 Chroma 使用余弦相似度，分数越高越相似；如果是 L2 距离，分数越低越相似
      const resultsWithScore = await vectorStore.similaritySearchWithScore(query, k);
      
      // 2. 根据阈值过滤
      const filteredDocs = resultsWithScore
        .filter(([doc, score]) => score >= scoreThreshold) 
        .map(([doc]) => doc);
        
      return filteredDocs;
    };
  }
  
  return retriever;
}
