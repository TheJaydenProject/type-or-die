import crypto from "node:crypto";
import db from "../config/database.js";

interface SentenceRow {
	text: string;
}

interface PoolStatsRow {
	total: string;
	avg_words: number;
	avg_chars: number;
	easy_count: string;
	medium_count: string;
	hard_count: string;
}

interface SentenceValidationResult {
	valid: boolean;
	errors: string[];
	wordCount: number;
	charCount: number;
}

class SentenceService {
	async selectSentences(count: number): Promise<string[]> {
		// Split count by difficulty: 30% EASY, remainder to MEDIUM (no HARD)
		const easyCount = Math.floor(count * 0.3);
		const mediumCount = count - easyCount;

		try {
			const [easy, medium] = await Promise.all([
				this.fetchByDifficulty("EASY", easyCount),
				this.fetchByDifficulty("MEDIUM", mediumCount),
			]);

			// Order: easy first, then medium
			const all = [...easy, ...medium];

			console.log(
				`Selected ${all.length} sentences (${easyCount} easy, ${mediumCount} medium)`,
			);
			return all;
		} catch (error) {
			console.error(
				"Error selecting sentences:",
				error instanceof Error ? error.message : error,
			);
			throw error;
		}
	}

	/**
	 * Uniform random sample without `ORDER BY RANDOM()`.
	 *
	 * `id` is a random UUID (`gen_random_uuid()`), so ordering by it is a
	 * uniformly random permutation of the rows. Taking `limit` rows after a
	 * random UUID boundary is a uniform random sample, and it uses the
	 * primary-key index (roughly O(log n + limit)) instead of scanning and
	 * sorting the whole pool.
	 */
	private async fetchByDifficulty(
		difficulty: string,
		limit: number,
	): Promise<string[]> {
		if (limit <= 0) return [];

		const baseWhere = `
			is_active = TRUE
			AND language = 'en'
			AND contains_emoji = FALSE
			AND difficulty = $1
		`;

		const pivot = crypto.randomUUID();

		const tail = await db.query(
			`SELECT text FROM sentences WHERE ${baseWhere} AND id > $2::uuid ORDER BY id LIMIT $3`,
			[difficulty, pivot, limit],
		);

		let rows: SentenceRow[] = tail.rows;

		// If the boundary landed near the end of the pool, wrap around to the head.
		if (rows.length < limit) {
			const head = await db.query(
				`SELECT text FROM sentences WHERE ${baseWhere} AND id <= $2::uuid ORDER BY id LIMIT $3`,
				[difficulty, pivot, limit - rows.length],
			);
			rows = [...rows, ...head.rows];
		}

		if (rows.length < limit) {
			throw new Error(
				`Insufficient ${difficulty} sentences in pool (need ${limit}, got ${rows.length})`,
			);
		}

		return rows.map((row) => row.text);
	}

	validateSentence(text: string): SentenceValidationResult {
		const errors: string[] = [];

		const words = text.trim().split(/\s+/);

		if (words.length < 5 || words.length > 10) {
			errors.push(`Word count ${words.length} not in range [5,10]`);
		}

		if (text.length > 100) {
			errors.push(`Sentence too long: ${text.length} chars`);
		}

		if (!/^[a-zA-Z0-9\s.,!?'-]+$/.test(text)) {
			errors.push("Non-English characters detected");
		}

		// Unicode emoji ranges aren't caught by the alphanumeric check above
		const emojiRegex = /[\u{1F600}-\u{1F64F}]/u;
		if (emojiRegex.test(text)) {
			errors.push("Emoji detected");
		}

		return {
			valid: errors.length === 0,
			errors: errors,
			wordCount: words.length,
			charCount: text.length,
		};
	}

	async getPoolStats(): Promise<PoolStatsRow> {
		const query = `
      SELECT
        COUNT(*) as total,
        AVG(word_count)::int as avg_words,
        AVG(char_count)::int as avg_chars,
        COUNT(CASE WHEN difficulty = 'EASY' THEN 1 END) as easy_count,
        COUNT(CASE WHEN difficulty = 'MEDIUM' THEN 1 END) as medium_count,
        COUNT(CASE WHEN difficulty = 'HARD' THEN 1 END) as hard_count
      FROM sentences
      WHERE is_active = TRUE
    `;

		try {
			const result = await db.query(query);
			return result.rows[0];
		} catch (error) {
			console.error(
				"Error getting pool stats:",
				error instanceof Error ? error.message : error,
			);
			throw error;
		}
	}
}

export default new SentenceService();
