/**
 * JSON Schema (TypeBox) → zod raw shape for SDK MCP tool definitions.
 *
 * The Claude Agent SDK's createSdkMcpServer wants a zod raw shape per tool;
 * Pi tools carry JSON Schema parameters. This converts the shapes Pi actually
 * uses (object properties: string/number/boolean/array/object/enum/anyOf).
 * Anything unrecognized falls back to z.any() so a single odd schema never
 * drops a whole tool.
 */
import { z } from "zod";

type JsonSchema = Record<string, any>;

function propToZod(schema: JsonSchema | undefined): z.ZodType {
	if (!schema || typeof schema !== "object") return z.any();
	let out: z.ZodType;
	if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
		const variants = (schema.anyOf ?? schema.oneOf).map((v: JsonSchema) => propToZod(v));
		out = variants.length === 1 ? variants[0] : (z.union(variants as unknown as unknown as [z.ZodType, ...z.ZodType[]]) as z.ZodType);
	} else if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		out = schema.enum.every((v: unknown) => typeof v === "string")
			? (z.enum(schema.enum as [string, ...string[]]) as z.ZodType)
			: (z.union(schema.enum.map((v: string | number) => z.literal(v)) as unknown as [z.ZodType, ...z.ZodType[]]) as z.ZodType);
	} else {
		switch (schema.type) {
			case "string":
				out = z.string();
				break;
			case "number":
			case "integer":
				out = z.number();
				break;
			case "boolean":
				out = z.boolean();
				break;
			case "array":
				out = z.array(propToZod(schema.items));
				break;
			case "object": {
				const shape = jsonSchemaToRawShape(schema);
				out = z.object(shape as Record<string, z.ZodType>);
				break;
			}
			default:
				out = z.any();
		}
	}
	if (typeof schema.description === "string" && schema.description) {
		out = out.describe(schema.description);
	}
	return out;
}

/** Top-level JSON Schema object → zod raw shape (name → zod type). */
export function jsonSchemaToRawShape(schema: JsonSchema | undefined): Record<string, z.ZodType> {
	const required = new Set<string>(Array.isArray(schema?.required) ? schema.required : []);
	const shape: Record<string, z.ZodType> = {};
	for (const [key, value] of Object.entries(schema?.properties ?? {})) {
		let prop = propToZod(value as JsonSchema);
		if (!required.has(key)) prop = prop.optional();
		shape[key] = prop;
	}
	return shape;
}
