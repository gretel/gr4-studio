import type {
	GraphDocument,
	GraphDocumentNode,
	GraphDocumentEdge,
} from "../../graph-document/model/types";
import {
	GRAPH_DOCUMENT_FORMAT,
	GRAPH_DOCUMENT_VERSION,
} from "../../graph-document/model/types";

export type ParseGrcBlock = {
	id: string;
	parameters: Record<string, string>;
};

export type ParseGrcConnection = [string, string, string, string];

export type ParseGrcResult = {
	name: string;
	blocks: ParseGrcBlock[];
	connections: ParseGrcConnection[];
};

/**
 * Minimal YAML parser for gr4 inline grc format.
 * Only handles the subset used by gr4-studio's toGrctrlPayload:
 *
 * metadata:
 *   name: <name>
 * blocks:
 *   - id: <blockTypeId>
 *     parameters:
 *       name: <instanceId>
 *       param: value
 * connections:
 *   - [src, 0, dst, 0]
 */
export function parseGrcYaml(yaml: string): ParseGrcResult {
	const lines = yaml.split("\n");
	const result: ParseGrcResult = { name: "", blocks: [], connections: [] };
	let section: "metadata" | "blocks" | "connections" | null = null;
	let currentBlock: ParseGrcBlock | null = null;

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (!line.trim() || line.trim().startsWith("#")) continue;

		// Detect section headers
		if (line === "metadata:") {
			section = "metadata";
			continue;
		}
		if (line === "blocks:") {
			section = "blocks";
			continue;
		}
		if (line === "connections:") {
			section = "connections";
			continue;
		}

		if (section === "metadata") {
			const nameMatch = line.match(/^\s{2}name:\s*(.+)$/);
			if (nameMatch) result.name = nameMatch[1].replace(/^"(.*)"$/, "$1");
			continue;
		}

		if (section === "blocks") {
			// New block entry
			const idMatch = line.match(/^\s{2}-\s*id:\s*(.+)$/);
			if (idMatch) {
				if (currentBlock) result.blocks.push(currentBlock);
				currentBlock = { id: idMatch[1].trim(), parameters: {} };
				continue;
			}

			// Parameter entry (indented under a block's `parameters:`)
			const paramMatch = line.match(/^\s{6}(\w[\w_]*):\s*(.*)$/);
			if (paramMatch && currentBlock) {
				const val = paramMatch[2].trim();
				// Strip quotes
				currentBlock.parameters[paramMatch[1]] = val.replace(/^"(.*)"$/, "$1");
				continue;
			}

			// Skip `parameters:` key line
			if (line.trim() === "parameters:") continue;

			continue;
		}

		if (section === "connections") {
			// Connection line:  - [src, 0, dst, 0]
			const connMatch = line.match(
				/^\s{2}-\s*\[(.+?),\s*(.+?),\s*(.+?),\s*(.+?)\]\s*$/,
			);
			if (connMatch) {
				result.connections.push([
					connMatch[1].trim(),
					connMatch[2].trim(),
					connMatch[3].trim(),
					connMatch[4].trim(),
				]);
			}
			continue;
		}
	}

	// Push last block
	if (currentBlock) result.blocks.push(currentBlock);

	return result;
}

/**
 * Build a GraphDocument from parsed grc content.
 * Auto-layouts blocks in a vertical column.
 */
export function buildGraphDocumentFromGrc(
	yaml: string,
	existingNodeIds: Set<string>,
): GraphDocument | null {
	const parsed = parseGrcYaml(yaml);
	if (parsed.blocks.length === 0) return null;

	const nodes: GraphDocumentNode[] = [];
	const edges: GraphDocumentEdge[] = [];

	// Build instanceId → block mapping and verify uniqueness
	const instanceIds = new Set<string>();
	for (const block of parsed.blocks) {
		const instanceId = block.parameters.name ?? block.id;
		if (!instanceId) continue;
		if (instanceIds.has(instanceId)) continue;
		instanceIds.add(instanceId);
	}

	// Create nodes
	let index = 0;
	for (const block of parsed.blocks) {
		const instanceId = block.parameters.name ?? `${block.id}_${index}`;
		if (existingNodeIds.has(instanceId)) {
			index++;
			continue; // skip duplicates
		}

		const parameters: GraphDocumentNode["parameters"] = {};
		for (const [key, value] of Object.entries(block.parameters)) {
			if (key === "name") continue; // 'name' is stored as node id
			parameters[key] = { kind: "literal", value };
		}

		nodes.push({
			id: instanceId,
			blockType: block.id,
			title: instanceId,
			position: { x: 100, y: 80 + index * 160 },
			parameters,
			executionMode: "active",
			rotation: 0,
		});

		index++;
	}

	// Create edges using instanceId resolution
	for (const [srcName, srcPort, dstName, dstPort] of parsed.connections) {
		edges.push({
			id: `${srcName}:${srcPort}->${dstName}:${dstPort}`,
			source: { nodeId: srcName, portId: srcPort },
			target: { nodeId: dstName, portId: dstPort },
		});
	}

	return {
		format: GRAPH_DOCUMENT_FORMAT,
		version: GRAPH_DOCUMENT_VERSION,
		metadata: {
			name: parsed.name || "imported",
			description: "",
			schedulerId: undefined,
		},
		graph: {
			nodes,
			edges,
		},
	};
}
