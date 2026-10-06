/**
 * Pure chunking helpers for custom compaction.
 *
 * These functions have no I/O and no dependency on pi, so they run under
 * `node --test` directly. The extension feeds them serialized conversation
 * pieces (one string per message) and a token budget, and they return the
 * texts to send to the compaction model.
 *
 * Token counts use a chars/4 heuristic, the same one pi uses for its own
 * estimates. It overestimates for prose and underestimates for dense code,
 * which is why `safety-tokens` exists in the config.
 */

/** Characters per token assumed by the estimator. Matches pi's heuristic. */
export const CHARS_PER_TOKEN = 4;

const OMISSION_PREFIX = "\n\n[... ";
const OMISSION_SUFFIX = " characters omitted ...]\n\n";
const OMISSION_DIGITS = 20;

export interface BudgetInputs {
  /** The model's true usable context per request. */
  contextWindow: number;
  /** Tokens reserved for the generated summary. */
  responseTokens: number;
  /** Tokens consumed by the system and user prompt scaffolding. */
  overheadTokens: number;
  /** Configurable headroom for estimator error. */
  safetyTokens: number;
}

/**
 * Estimates tokens in a text. Conservative for prose, exact enough for
 * budgeting because `safety-tokens` absorbs the error.
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Computes the number of conversation tokens a single request may carry.
 * A non-positive result means the configuration cannot fit any input.
 */
export function computeChunkBudget(inputs: BudgetInputs): number {
  return (
    inputs.contextWindow -
    inputs.responseTokens -
    inputs.overheadTokens -
    inputs.safetyTokens
  );
}

/**
 * Truncates a text to a token budget, keeping the head and the tail and
 * eliding the middle. Structure sits at the start and errors sit at the end.
 */
export function truncateHeadTail(text: string, maxTokens: number): string {
  const maxChars = Math.max(0, maxTokens) * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;

  const markerOverhead = OMISSION_PREFIX.length + OMISSION_SUFFIX.length + OMISSION_DIGITS;
  const room = Math.max(0, maxChars - markerOverhead);
  const head = Math.floor(room / 2);
  const tail = room - head;
  const omitted = text.length - head - tail;

  return `${text.slice(0, head)}${OMISSION_PREFIX}${omitted}${OMISSION_SUFFIX}${text.slice(text.length - tail)}`;
}

/**
 * Groups serialized messages into texts that fit `budgetTokens`.
 *
 * Messages are the atomic unit, so a chunk never cuts one in half. When a
 * single message exceeds the budget alone, it is truncated head+tail instead.
 * `overlapMessages` repeats the tail of one chunk at the start of the next,
 * which helps when a task spans a boundary.
 */
export function splitPieces(
  pieces: string[],
  budgetTokens: number,
  overlapMessages = 0,
): string[] {
  const chunks: string[] = [];
  if (pieces.length === 0) return chunks;

  const budget = Math.max(1, Math.floor(budgetTokens));
  const overlap = Math.max(0, Math.floor(overlapMessages));

  let cursor = 0;
  while (cursor < pieces.length) {
    const start = Math.max(0, cursor - overlap);
    const group: string[] = [];
    let tokens = 0;
    let j = start;

    while (j < pieces.length) {
      const pieceTokens = estimateTextTokens(pieces[j]);

      if (group.length === 0 && pieceTokens > budget) {
        group.push(truncateHeadTail(pieces[j], budget));
        j += 1;
        break;
      }

      if (group.length > 0 && tokens + pieceTokens > budget) break;

      group.push(pieces[j]);
      tokens += pieceTokens;
      j += 1;
    }

    // Guarantee forward progress even when overlap covers the whole previous chunk.
    if (j <= cursor) j = cursor + 1;

    chunks.push(group.join("\n\n"));
    cursor = j;
  }

  return chunks;
}
