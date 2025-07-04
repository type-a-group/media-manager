import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as fs from 'node:fs';

const imageDataPath = 'src/lib/assets/image-data.json';
const schemaPath = 'src/lib/assets/schema.json';

// GET handler to retrieve the schema
export const GET: RequestHandler = () => {
    try {
        const schemaData = fs.readFileSync(schemaPath, 'utf-8');
        const data = JSON.parse(schemaData);
        return json(data.schema || {});
    } catch (err) {
        console.error(err);
        throw error(500, { message: 'Failed to read schema' });
    }
};

// POST handler to add a new field to the schema
export const POST: RequestHandler = async ({ request }) => {
    try {
        const { fieldName, fieldType, defaultValue } = await request.json();

        if (!fieldName || !fieldType) {
            throw error(400, 'Field name and type are required');
        }

        // Read schema
        const schemaData = fs.readFileSync(schemaPath, 'utf-8');
        const schemaJson = JSON.parse(schemaData);

		// Add new field to schema
		schemaJson.schema[fieldName] = {
			type: fieldType,
			removable: true, // New fields are always removable
			defaultValue: defaultValue
		};

        fs.writeFileSync(schemaPath, JSON.stringify(schemaJson, null, 2));

        // Read image data and update all images
        const jsonData = fs.readFileSync(imageDataPath, 'utf-8');
        const data = JSON.parse(jsonData);

        data.images.forEach((image: any) => {
            image[fieldName] = defaultValue;
        });

        fs.writeFileSync(imageDataPath, JSON.stringify(data, null, 2));

         return json({ success: true, schema: schemaJson.schema });
    } catch (err) {
        console.error(err);
        throw error(500, { message: 'Failed to update schema' });
    }
};

// DELETE handler to remove a field from the schema
export const DELETE: RequestHandler = async ({ request }) => {
    try {
        const { fieldName } = await request.json();

        if (!fieldName) {
            throw error(400, 'Field name is required');
        }

        // Read schema
        const schemaData = fs.readFileSync(schemaPath, 'utf-8');
        const schemaJson = JSON.parse(schemaData);

        if (!schemaJson.schema[fieldName]) {
            throw error(404, 'Field not found in schema');
        }

        if (schemaJson.schema[fieldName].removable === false) {
            throw error(400, 'This field cannot be removed');
        }

        // Remove field from schema
        delete schemaJson.schema[fieldName];

        fs.writeFileSync(schemaPath, JSON.stringify(schemaJson, null, 2));

        // Remove field from all existing images
        const jsonData = fs.readFileSync(imageDataPath, 'utf-8');
        const data = JSON.parse(jsonData);

        data.images.forEach((image: any) => {
            delete image[fieldName];
        });

        fs.writeFileSync(imageDataPath, JSON.stringify(data, null, 2));

        return json({ success: true, schema: schemaJson.schema });
    } catch (err) {
        console.error(err);
        if (err && typeof err === 'object' && 'status' in err) {
            throw err;
        }
        throw error(500, { message: 'Failed to delete field' });
    }
};