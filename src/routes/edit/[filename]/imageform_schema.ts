import { z } from "zod";

export async function fetchSchema(fetchFn?: typeof fetch) {
	const f = fetchFn ?? fetch;
	const response = await f('/api/schema');
	const schemaDefinition = await response.json();
	
	if (!schemaDefinition || Object.keys(schemaDefinition).length === 0) {
		return z.object({});
	}

	const zodShape: Record<string, any> = {};
	Object.entries(schemaDefinition).forEach(([key, field]: [string, any]) => {
		// Skip these fields as they're handled separately
		if (key === 'file_name' || key === 'last_modified' || key === 'default') return;
		
		if (field.type === 'string') {
			zodShape[key] = z.string().min(0).max(200);
		} else if (field.type === 'number') {
			zodShape[key] = z.number();
		} else if (field.type === 'boolean') {
			zodShape[key] = z.boolean();
		} else {
			// Fallback: treat as string
			zodShape[key] = z.string();
		}
	});
	
	return z.object(zodShape);
}

// Also export a function to get UI schema for client-side rendering
export async function fetchUISchema(fetchFn?: typeof fetch) {
	const f = fetchFn ?? fetch;
	const response = await f('/api/schema');
	return await response.json();
}
 
export type FormSchema = Record<string, any>;