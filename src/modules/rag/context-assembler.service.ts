// CONCEPT: CONTEXT ASSEMBLY
//
// PURPOSE: Select the best chunks within a token budget and format them
// for the LLM prompt. Simple but critical — poor context assembly is the
// #1 cause of bad RAG answers.
//
// TOKEN BUDGETING:
// LLMs have a context window limit. We reserve 3,500 tokens for retrieved
// chunks. Beyond that, prompt quality degrades as the model struggles to
// find the relevant needle in a haystack of text.
// Chunks are added in score order (best first) until the budget is full.
//
// ADJACENT CHUNK DEDUPLICATION:
// Because chunking uses overlap (50 tokens), chunk 7 and chunk 8 share text.
// Including both wastes tokens on repeated content.
// Rule: skip a chunk if a chunk from the same document with index ±1 was
// already selected. Different documents are never considered redundant.
//
// CITATIONS:
// Each selected chunk is labelled [Source N]. The LLM is instructed to
// reference these labels in its answer. This creates a traceable chain:
// answer → [Source 2] → chunk → document → page.

import { Injectable } from '@nestjs/common';
import { SearchResult } from '../search/search.service';
import { RAG_CONFIG }   from '../../config/rag-prompts.config';

export interface Citation {
  index:         number;   // 1-based, matches [Source N] in the answer
  chunkId:       string;
  documentId:    string;
  documentTitle: string;
  chunkIndex:    number;
  score:         number;
}

export interface AssembledContext {
  chunks:      SearchResult[];
  contextText: string;
  totalTokens: number;
  citations:   Citation[];
}

@Injectable()
export class ContextAssemblerService {

  assemble(results: SearchResult[]): AssembledContext {
    const selected: SearchResult[] = [];
    let totalTokens = 0;

    for (const result of results) {
      // Skip adjacent chunks from the same document (overlap deduplication)
      // Check this BEFORE the budget check so redundant chunks don't block
      // smaller non-redundant chunks that come later in the list.
      if (this.isRedundant(result, selected)) continue;

      // Skip chunks that would exceed the token budget, but keep looking —
      // a later chunk might be smaller and still fit within the budget.
      // Using `continue` (not `break`) is intentional: the results list is
      // ordered by score, not by token count, so a large chunk early in the
      // list must not terminate the loop for all subsequent smaller chunks.
      if (totalTokens + result.tokenCount > RAG_CONFIG.contextTokenBudget) continue;

      selected.push(result);
      totalTokens += result.tokenCount;
    }

    const citations: Citation[] = selected.map((chunk, i) => ({
      index:         i + 1,
      chunkId:       chunk.chunkId,
      documentId:    chunk.documentId,
      documentTitle: chunk.documentTitle,
      chunkIndex:    chunk.chunkIndex,
      score:         chunk.score,
    }));

    const contextText = selected
      .map((chunk, i) =>
        `[Source ${i + 1}: "${chunk.documentTitle}", Section ${chunk.chunkIndex + 1}]\n${chunk.content}`,
      )
      .join('\n\n---\n\n');

    return { chunks: selected, contextText, totalTokens, citations };
  }

  // Private

  private isRedundant(candidate: SearchResult, selected: SearchResult[]): boolean {
    return selected.some(
      (s) =>
        s.documentId === candidate.documentId &&
        Math.abs(s.chunkIndex - candidate.chunkIndex) <= 1,
    );
  }
}