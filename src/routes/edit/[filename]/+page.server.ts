import type { Actions, PageServerLoad } from "./$types.js";
import { superValidate } from "sveltekit-superforms";
import { fetchSchema } from "./imageform_schema.js";
import { zod } from "sveltekit-superforms/adapters";
import { z } from "zod";
import { fail } from "@sveltejs/kit";
 
export const load: PageServerLoad = async ({ params, fetch }) => {
	const schema = await fetchSchema(fetch);
	if (schema == null) {
		return {
			form: await superValidate(zod(z.object({}))),
		};
	}

	const response = await fetch(`/api/images/properties/${params.filename}`);
	const properties = await response.json();
	if (properties == null) {
		return {
			form: await superValidate(zod(schema)),
			filename: params.filename,
		};
	}

	// TODO make sure this works even with some of the fields not being in the form (file name and stuff)
	return {
		form: await superValidate(properties, zod(schema)),
		filename: params.filename,
	};
};

export const actions: Actions = {
	default: async (event) => {
		const filename = event.params.filename;
		const schema = await fetchSchema(event.fetch);

		// Parse the form data using the dynamic schema
		const form = await superValidate(event, zod(schema));
		if (!form.valid) {
			return fail(400, {
				form,
			});
		}

		// Persist to properties API
		const data = form.data as Record<string, any>;
		const payload: Record<string, any> = {};
		for (const [key, value] of Object.entries(data)) {
			if (key !== "file_name" && key !== "last_modified" && key !== "default") {
				payload[key] = value;
			}
		}
		console.log('[action] saving for', filename, 'payload', payload);

		const res = await event.fetch(`/api/images/properties/${filename}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
		console.log('[action] properties POST status', res.status);

		if (!res.ok) {
			return fail(500, { form });
		}

		// Use the updated properties from the API response to refresh the form state
		const saved = await res.json();
		console.log('[action] properties response body', saved);
		const updatedProperties = saved?.properties ?? payload;
		const updatedForm = await superValidate(updatedProperties, zod(schema));
		return { form: updatedForm };
	},
};