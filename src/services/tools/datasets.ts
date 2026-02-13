/**
 * Tools for interacting with LangSmith datasets.
 */

import { Client } from "langsmith";
import { parseAsOfParameter } from "../../common/helpers.js";

/**
 * Fetch datasets from LangSmith with optional filtering.
 *
 * @param client - LangSmith client instance
 * @param options - Filtering options
 * @returns Dictionary containing the datasets and metadata
 */
export async function listDatasetsTool(
  client: Client,
  options: {
    datasetIds?: string[];
    dataType?: string;
    datasetName?: string;
    datasetNameContains?: string;
    metadata?: Record<string, unknown>;
    limit?: number;
  } = {}
): Promise<Record<string, unknown>> {
  try {
    const datasets: Record<string, unknown>[] = [];
    // Note: dataType is accepted for API parity with Python but not supported by JS SDK
    for await (const dataset of client.listDatasets({
      datasetIds: options.datasetIds,
      datasetName: options.datasetName,
      datasetNameContains: options.datasetNameContains,
      metadata: options.metadata,
      limit: options.limit,
    })) {
      const datasetObj = dataset as unknown as Record<string, unknown>;
      const datasetDict: Record<string, unknown> = {};

      for (const attr of [
        "id",
        "name",
        "inputs_schema_definition",
        "outputs_schema_definition",
        "description",
        "data_type",
        "example_count",
        "session_count",
        "created_at",
        "modified_at",
        "last_session_start_time",
      ]) {
        let value = attr in datasetObj ? datasetObj[attr] : undefined;

        // Format datetimes as isoformat
        if (
          ["created_at", "modified_at"].includes(attr) &&
          value !== undefined &&
          value !== null
        ) {
          value =
            value instanceof Date ? value.toISOString() : String(value);
        }
        // Convert UUIDs to strings for JSON serialization
        if (attr === "id" && value !== undefined && value !== null) {
          value = String(value);
        }

        datasetDict[attr] = value;
      }

      datasets.push(datasetDict);
    }

    return { datasets, total_count: datasets.length };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Error fetching datasets: ${message}` };
  }
}

/**
 * Fetch examples from a LangSmith dataset.
 *
 * @param client - LangSmith Client instance
 * @param options - Filtering options
 * @returns Dictionary containing the examples and metadata
 */
export async function listExamplesTool(
  client: Client,
  options: {
    datasetId?: string;
    datasetName?: string;
    exampleIds?: string[];
    filter?: string;
    metadata?: Record<string, unknown>;
    splits?: string[];
    inlineS3Urls?: boolean;
    includeAttachments?: boolean;
    asOf?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<Record<string, unknown>> {
  try {
    const examples: Record<string, unknown>[] = [];
    for await (const example of client.listExamples({
      datasetId: options.datasetId,
      datasetName: options.datasetName,
      exampleIds: options.exampleIds,
      metadata: options.metadata,
      splits: options.splits,
      inlineS3Urls: options.inlineS3Urls,
      includeAttachments: options.includeAttachments,
      asOf: options.asOf !== undefined ? parseAsOfParameter(options.asOf) : undefined,
      limit: options.limit,
      offset: options.offset,
      filter: options.filter,
    })) {
      const exampleObj = example as unknown as Record<string, unknown>;
      const exampleDict: Record<string, unknown> = {};

      for (const attr of [
        "id",
        "dataset_id",
        "inputs",
        "outputs",
        "metadata",
        "created_at",
        "modified_at",
        "runs",
        "source_run_id",
        "attachments",
      ]) {
        let value = attr in exampleObj ? exampleObj[attr] : undefined;

        // Format datetimes as isoformat
        if (
          ["created_at", "modified_at"].includes(attr) &&
          value !== undefined &&
          value !== null
        ) {
          value =
            value instanceof Date ? value.toISOString() : String(value);
        }
        // Convert UUIDs to strings for JSON serialization
        if (
          ["id", "dataset_id", "source_run_id"].includes(attr) &&
          value !== undefined &&
          value !== null
        ) {
          value = String(value);
        }

        exampleDict[attr] = value;
      }

      examples.push(exampleDict);
    }

    return { examples, total_count: examples.length };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Error fetching examples: ${message}` };
  }
}

/**
 * Read a specific dataset from LangSmith.
 *
 * @param client - LangSmith Client instance
 * @param options - Dataset identification options
 * @returns Dictionary containing the dataset details
 */
export async function readDatasetTool(
  client: Client,
  options: {
    datasetId?: string;
    datasetName?: string;
  } = {}
): Promise<Record<string, unknown>> {
  try {
    const dataset = await client.readDataset({
      datasetId: options.datasetId,
      datasetName: options.datasetName,
    });
    const datasetObj = dataset as unknown as Record<string, unknown>;
    const datasetDict: Record<string, unknown> = {};

    for (const attr of [
      "id",
      "name",
      "inputs_schema_definition",
      "outputs_schema_definition",
      "description",
      "data_type",
      "example_count",
      "session_count",
      "created_at",
      "modified_at",
      "last_session_start_time",
    ]) {
      let value = attr in datasetObj ? datasetObj[attr] : undefined;

      // Format datetimes as isoformat
      if (
        ["created_at", "modified_at", "last_session_start_time"].includes(
          attr
        ) &&
        value !== undefined &&
        value !== null
      ) {
        value =
          value instanceof Date ? value.toISOString() : String(value);
      }
      // Convert UUIDs to strings for JSON serialization
      if (attr === "id" && value !== undefined && value !== null) {
        value = String(value);
      }

      datasetDict[attr] = value;
    }

    return { dataset: datasetDict };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Error reading dataset: ${message}` };
  }
}

/**
 * Read a specific example from LangSmith.
 *
 * @param client - LangSmith Client instance
 * @param exampleId - Example ID to retrieve
 * @param asOf - Dataset version tag OR ISO timestamp
 * @returns Dictionary containing the example details
 */
export async function readExampleTool(
  client: Client,
  exampleId: string,
  asOf?: string
): Promise<Record<string, unknown>> {
  try {
    // Note: The JS SDK readExample takes just the example ID as a string
    const example = await client.readExample(exampleId);
    const exampleObj = example as unknown as Record<string, unknown>;
    const exampleDict: Record<string, unknown> = {};

    for (const attr of [
      "id",
      "dataset_id",
      "inputs",
      "outputs",
      "metadata",
      "created_at",
      "modified_at",
      "runs",
      "source_run_id",
      "attachments",
    ]) {
      let value = attr in exampleObj ? exampleObj[attr] : undefined;

      // Format datetimes as isoformat
      if (
        ["created_at", "modified_at"].includes(attr) &&
        value !== undefined &&
        value !== null
      ) {
        value =
          value instanceof Date ? value.toISOString() : String(value);
      }
      // Convert UUIDs to strings for JSON serialization
      if (
        ["id", "dataset_id", "source_run_id"].includes(attr) &&
        value !== undefined &&
        value !== null
      ) {
        value = String(value);
      }

      exampleDict[attr] = value;
    }

    return { example: exampleDict };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Error reading example: ${message}` };
  }
}
