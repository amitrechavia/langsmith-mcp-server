/**
 * Tools for interacting with LangSmith experiments.
 */

import { Client } from "langsmith";
import { convertToSerializable, findInDict } from "../../common/helpers.js";

/**
 * List LangSmith experiment projects (reference projects) with mandatory dataset filtering.
 *
 * @param client - LangSmith client instance
 * @param options - Filtering options
 * @returns Dictionary containing an "experiments" key with simplified experiment project dictionaries
 */
export async function listExperimentsTool(
  client: Client,
  options: {
    referenceDatasetId?: string;
    referenceDatasetName?: string;
    limit?: number;
    projectName?: string;
  } = {}
): Promise<Record<string, unknown>> {
  const {
    referenceDatasetId,
    referenceDatasetName,
    limit = 5,
    projectName,
  } = options;

  // Validate that exactly one of referenceDatasetId or referenceDatasetName is provided
  if (referenceDatasetId === undefined && referenceDatasetName === undefined) {
    throw new Error(
      "Either 'reference_dataset_id' or 'reference_dataset_name' must be provided"
    );
  }
  if (referenceDatasetId !== undefined && referenceDatasetName !== undefined) {
    throw new Error(
      "Cannot provide both 'reference_dataset_id' and 'reference_dataset_name'. " +
        "Please provide only one."
    );
  }

  const projects: Record<string, unknown>[] = [];
  let count = 0;
  for await (const project of client.listProjects({
    referenceFree: false,
    referenceDatasetId,
    referenceDatasetName,
    nameContains: projectName,
    includeStats: true,
  })) {
    if (count >= limit) break;
    projects.push(convertToSerializable(project) as Record<string, unknown>);
    count++;
  }

  const simpleProjects: Record<string, unknown>[] = [];
  for (const project of projects) {
    const deploymentId = findInDict(project, "deployment_id");
    const projectId = project.id ?? null;

    // Extract and format latency (p50 and p99)
    const latencyP50 = project.latency_p50 as number | undefined;
    const latencyP99 = project.latency_p99 as number | undefined;

    // Extract cost values
    const totalCost = project.total_cost as number | undefined;
    const promptCost = project.prompt_cost as number | undefined;
    const completionCost = project.completion_cost as number | undefined;

    const projectDict: Record<string, unknown> = {
      name: project.name ?? null,
      experiment_id: projectId !== null ? String(projectId) : null,
      feedback_stats: project.feedback_stats ?? null,
    };

    // Add latency metrics if available
    // In JS SDK, latency values may already be numbers (seconds) rather than timedelta
    if (latencyP50 !== undefined && latencyP50 !== null) {
      // If it's already a number, use it directly
      // If it has a totalSeconds method (unlikely in JS), call it
      projectDict.latency_p50_seconds =
        typeof latencyP50 === "number" ? latencyP50 : Number(latencyP50);
    }
    if (latencyP99 !== undefined && latencyP99 !== null) {
      projectDict.latency_p99_seconds =
        typeof latencyP99 === "number" ? latencyP99 : Number(latencyP99);
    }

    // Add cost metrics if available
    if (totalCost !== undefined && totalCost !== null) {
      projectDict.total_cost = Number(totalCost);
    }
    if (promptCost !== undefined && promptCost !== null) {
      projectDict.prompt_cost = Number(promptCost);
    }
    if (completionCost !== undefined && completionCost !== null) {
      projectDict.completion_cost = Number(completionCost);
    }

    if (deploymentId) {
      projectDict.agent_deployment_id = deploymentId;
    }
    simpleProjects.push(projectDict);
  }

  return { experiments: simpleProjects };
}
