// src/indexer.ts
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { ChromaClient } from "chromadb";
import { readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { Document } from "@langchain/core/documents";
import { AlibabaTongyiEmbeddings, type AlibabaTongyiEmbeddingsParams } from "@langchain/community/embeddings/alibaba_tongyi";


interface IndexerOptions {
  docsDir: string;           // 文档目录
  collectionName: string;    // Collection 名称
  chunkSize?: number;        // 切分大小
  chunkOverlap?: number;     // 重叠大小
}

export async function buildIndex(options: IndexerOptions): Promise<Chroma> {
  const {
    docsDir,
    collectionName,
    chunkSize = 500,
    chunkOverlap = 50,
  } = options;

  console.log(`\n【索引管道】开始处理文档目录: ${docsDir}`);
  
  // 扫描文档目录
  const files = scanDocuments(docsDir);
  console.log(`找到 ${files.length} 个文档文件`);
  
  if (files.length === 0) {
    throw new Error(`文档目录为空: ${docsDir}`);
  }

  // 加载和切分所有文档
  let allChunks: Document[] = [];
  
  for (const file of files) {
    console.log(`  处理: ${file}`);
    
    try {
      const chunks = await loadAndSplitFile(file, chunkSize, chunkOverlap);
      allChunks.push(...chunks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`    ❌ 处理失败: ${message}`);
      // 继续处理其他文件，不中断整个流程
    }
  }

  console.log(`\n✓ 文档加载完成，共 ${allChunks.length} 个片段`);

  // 向量化和存储
  console.log("正在生成向量并存储...");
  
    const embeddings = new AlibabaTongyiEmbeddings({
      // 类型定义的枚举未包含最新模型，运行时直接透传给 API，故用类型断言
      modelName: "qwen3.7-text-embedding-flash" as AlibabaTongyiEmbeddingsParams["modelName"],
      apiKey: process.env.ALIBABA_TONGYI_API_KEY,
      batchSize: 10,
    });

  // 解析 Chroma 连接地址（chromadb v3 弃用了 path，改用 host/port/ssl）
  const chromaUrl = new URL(process.env.CHROMA_HOST || "http://localhost:8000");
  const chromaClientParams = {
    host: chromaUrl.hostname,
    port: parseInt(chromaUrl.port, 10) || (chromaUrl.protocol === "https:" ? 443 : 80),
    ssl: chromaUrl.protocol === "https:",
  };

  // 连接 Chroma 客户端
  const client = new ChromaClient(chromaClientParams);
  
  // 删除旧的 Collection（如果存在）
  try {
    await client.deleteCollection({ name: collectionName });
    console.log(`已删除旧的 Collection: ${collectionName}`);
  } catch (error) {
    // Collection 不存在，忽略
  }

  // 批量存入向量数据库（复用已创建的 client）
  const vectorStore = await Chroma.fromDocuments(
    allChunks,
    embeddings,
    {
      collectionName,
      index: client,
    }
  );

  console.log(`✓ 索引完成：${allChunks.length} 个片段，来自 ${files.length} 个文件\n`);
  
  return vectorStore;
}

/**
 * 扫描文档目录，返回所有支持的文件路径
 */
function scanDocuments(dir: string): string[] {
  const supportedExts = [".md", ".txt", ".pdf"];
  const files: string[] = [];

  function scan(currentDir: string) {
    const entries = readdirSync(currentDir);
    
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        // 递归扫描子目录
        scan(fullPath);
      } else if (stat.isFile() && supportedExts.includes(extname(entry).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  scan(dir);
  return files;
}

/**
 * 加载单个文件并切分为 chunks
 */
async function loadAndSplitFile(
  filePath: string,
  chunkSize: number,
  chunkOverlap: number
): Promise<Document[]> {
  const ext = extname(filePath).toLowerCase();
  
  let docs: Document[];

  if (ext === ".pdf") {
    // PDF 需要使用 PDFLoader
    const { PDFLoader } = await import("@langchain/community/document_loaders/fs/pdf");
    const loader = new PDFLoader(filePath);
    docs = await loader.load();
  } else {
    // Markdown 和 TXT 使用 TextLoader
    const loader = new TextLoader(filePath);
    docs = await loader.load();
  }
  
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });
  
  const chunks = await splitter.splitDocuments(docs);
  
  // 为每个 chunk 添加文件来源元数据
  for (const chunk of chunks) {
    chunk.metadata.source = filePath;
    chunk.metadata.fileType = ext;
  }
  
  return chunks;
}
