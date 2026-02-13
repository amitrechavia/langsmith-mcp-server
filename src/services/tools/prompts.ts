/**
 * Tools for interacting with LangSmith prompts.
 */

import { Client } from "langsmith";

/**
 * Fetch prompts from LangSmith with optional filtering.
 *
 * @param client - LangSmith Client instance
 * @param isPublic - Filter by prompt visibility
 * @param limit - Maximum number of prompts to return
 * @returns Dictionary containing the prompts and metadata
 */
export async function listPromptsTool(
  client: Client,
  isPublic: boolean = false,
  limit: number = 20
): Promise<Record<string, unknown>> {
  try {
    const formattedPrompts: Record<string, unknown>[] = [];
    let count = 0;

    for await (const prompt of client.listPrompts({ isPublic })) {
      if (count >= limit) break;

      const promptObj = prompt as unknown as Record<string, unknown>;
      const promptDict: Record<string, unknown> = {};

      for (const attr of [
        "repo_handle",
        "description",
        "id",
        "is_public",
        "tags",
        "owner",
        "full_name",
        "num_likes",
        "num_downloads",
        "num_views",
      ]) {
        promptDict[attr] = attr in promptObj ? promptObj[attr] : undefined;
      }

      if (
        "created_at" in promptObj &&
        promptObj.created_at instanceof Date
      ) {
        promptDict.created_at = promptObj.created_at.toISOString();
      } else if ("created_at" in promptObj && promptObj.created_at) {
        promptDict.created_at = String(promptObj.created_at);
      }

      if (
        "updated_at" in promptObj &&
        promptObj.updated_at instanceof Date
      ) {
        promptDict.updated_at = promptObj.updated_at.toISOString();
      } else if ("updated_at" in promptObj && promptObj.updated_at) {
        promptDict.updated_at = String(promptObj.updated_at);
      }

      formattedPrompts.push(promptDict);
      count++;
    }

    return { prompts: formattedPrompts, total_count: formattedPrompts.length };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Error fetching prompts: ${message}` };
  }
}

/**
 * Get a specific prompt by its name or ID and return its full representation.
 *
 * Uses pullPromptCommit from the JS SDK (equivalent to Python's pull_prompt).
 * The JS SDK does not require langchain_core for serialization.
 *
 * @param client - LangSmith Client instance
 * @param promptName - The full name of the prompt (e.g., 'owner/repo')
 * @param promptId - The UUID of the prompt
 * @returns Dictionary containing the prompt details
 */
export async function getPromptTool(
  client: Client,
  promptName?: string,
  promptId?: string
): Promise<Record<string, unknown>> {
  try {
    const identifier = promptName || promptId;
    if (!identifier) {
      return {
        error: "Error: Either prompt_name or prompt_id must be provided.",
      };
    }

    const promptCommit = await client.pullPromptCommit(identifier);

    // The JS SDK returns a PromptCommit object that is already serializable
    return promptCommit as unknown as Record<string, unknown>;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Error fetching prompt: ${message}` };
  }
}
