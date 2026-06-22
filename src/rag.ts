import fs from 'fs';
import path from 'path';
import { pipeline } from '@xenova/transformers';
import cosineSimilarity from 'cosine-similarity';
import { config } from './config.js';

interface DocumentChunk {
  id: string;
  text: string;
  embedding: number[];
  source: string;
}

let knowledgeBase: DocumentChunk[] = [];
let extractor: any = null;

async function getExtractor() {
  if (!extractor) {
    console.log('Initializing embedding model (this may take a while to download the first time)...');
    extractor = await pipeline('feature-extraction', config.EMBEDDING_MODEL, {
      quantized: true, // true makes the download much smaller and faster
      progress_callback: (progress: any) => {
        if (progress.status === 'progress') {
          process.stdout.write(`\rDownloading ${progress.file}: ${Math.round((progress.loaded / progress.total) * 100)}%`);
        } else if (progress.status === 'done') {
          console.log(`\nDownloaded ${progress.file}`);
        }
      }
    });
  }
  return extractor;
}

function chunkText(text: string, source: string, chunkSize = 500, overlap = 50): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + chunkSize, text.length);
    chunks.push({
      id: `${source}-${i}`,
      text: text.slice(i, end),
      embedding: [],
      source,
    });
    i += chunkSize - overlap;
  }
  return chunks;
}

export async function buildKnowledgeBase() {
  console.log('Loading docs...');
  const docsPath = path.join(process.cwd(), 'docs');
  if (!fs.existsSync(docsPath)) return;

  const files = fs.readdirSync(docsPath).filter((f) => f.endsWith('.txt'));
  
  const allChunks: DocumentChunk[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(docsPath, file), 'utf8');
    allChunks.push(...chunkText(content, file));
  }

  console.log(`Building embeddings for ${allChunks.length} chunks...`);
  const extract = await getExtractor();

  let count = 0;
  for (const chunk of allChunks) {
    const output = await extract(chunk.text, { pooling: 'mean', normalize: true });
    chunk.embedding = Array.from(output.data);
    count++;
    process.stdout.write(`\rProcessed ${count}/${allChunks.length} chunks`);
  }
  console.log('\n');

  knowledgeBase = allChunks;
  console.log('Knowledge Base built successfully.');
}

export async function searchKnowledgeBase(query: string, nResults = 4): Promise<string> {
  if (knowledgeBase.length === 0) return '';
  
  const extract = await getExtractor();
  const queryOutput = await extract(query, { pooling: 'mean', normalize: true });
  const queryEmbedding = Array.from(queryOutput.data) as number[];

  const scoredChunks = knowledgeBase.map((chunk) => {
    const score = cosineSimilarity(queryEmbedding, chunk.embedding);
    return { ...chunk, score };
  });

  scoredChunks.sort((a, b) => b.score - a.score);
  
  const topChunks = scoredChunks.slice(0, nResults);
  return topChunks.map((c) => c.text).join('\n\n--- \n\n');
}
