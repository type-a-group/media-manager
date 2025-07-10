import { render, fireEvent, waitFor, screen, cleanup } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { writable } from 'svelte/store';
const mockFilteredList: string[] = [];

vi.mock('$app/navigation', () => ({
    goto: vi.fn()
}));

vi.mock('$lib/stores/imageList', () => ({
    filteredImageList: {
        subscribe: vi.fn((callback: Function) => {
            callback(mockFilteredList);
            return () => {};
        })
    }
}));

const mockSchema = {
    file_name: { type: 'string', removable: false },
    image_name: { type: 'string', removable: false },
    description: { type: 'string', removable: true, defaultValue: '' },
    featured: { type: 'boolean', removable: true, defaultValue: false },
    priority: { type: 'number', removable: true, defaultValue: 0 }
};
const mockMetadata = {
    file_name: 'test-image.jpg',
    image_name: 'Test Image',
    description: 'A test image description',
    featured: true,
    priority: 5,
    last_modified: new Date().toISOString()
};

describe('ImageForm.svelte', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
        vi.resetModules();
        originalFetch = global.fetch;
        global.fetch = vi.fn();
        vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const urlStr = (input instanceof Request ? input.url : input.toString());
            if (urlStr.includes('/api/schema')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockSchema)
                } as Response);
            }
            if (urlStr.includes('/api/images/compare')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        inBoth: ['prev-image.jpg', 'test-image.jpg', 'next-image.jpg'],
                        inAssetsOnly: ['unlinked1.jpg', 'unlinked2.jpg']
                    })
                } as Response);
            }
            if (urlStr.includes('/api/images/metadata/test-image.jpg')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockMetadata)
                } as Response);
            }
            return Promise.resolve({
                ok: false,
                status: 404,
                json: () => Promise.resolve({ error: 'Not found' })
            } as Response);
        });
        global.confirm = vi.fn(() => true);
        global.alert = vi.fn();
        vi.useFakeTimers();
        mockFilteredList.length = 0;
        cleanup();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.useRealTimers();
        cleanup();
    });

    // THE WAY THIS TEST IS SET UP, IT WORKS PROPERLY, FIX THE OTHER ONES
    it('renders loading state when filename is provided but data not yet loaded', async () => {
    vi.resetModules();
    // Mock after resetModules
    vi.doMock('$app/stores', () => ({
        page: {
            subscribe: (callback: Function) => {
                callback({
                    url: { searchParams: { get: () => 'linked' } },
                    params: { filename: 'test-image.jpg' }
                });
                return () => {};
            }
        }
    }));
    vi.doMock('$app/navigation', () => ({
        goto: vi.fn()
    }));
    vi.doMock('$lib/stores/imageList', () => ({
        filteredImageList: {
            subscribe: vi.fn((callback: Function) => {
                callback([]);
                return () => {};
            })
        }
    }));

    // Now import Svelte component
    const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
    const { render, screen } = await import('@testing-library/svelte');
    render(ImageForm, { filename: 'test-image.jpg' });
    expect(screen.getByText('Loading metadata for test-image.jpg...')).toBeInTheDocument();
});

    it('renders instruction message when no filename is provided', async () => {
        vi.resetModules();
        vi.doMock('$app/stores', () => ({
            page: {
                subscribe: (callback: Function) => {
                    callback({
                        url: { searchParams: { get: () => null } },
                        params: {}
                    });
                    return () => {};
                }
            }
        }));
        const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
        const { render, screen } = await import('@testing-library/svelte'); 
        render(ImageForm);
        expect(screen.getByText('Select an image from the sidebar to see its details.')).toBeInTheDocument();
    });

    // it('loads and displays image metadata when filename is provided', async () => {
    //     vi.resetModules();
    //     vi.doMock('$app/stores', () => ({
    //         page: {
    //             subscribe: (callback: Function) => {
    //                 callback({
    //                     url: { searchParams: { get: (param: string) => param === 'view' ? 'linked' : null } },
    //                     params: { filename: 'test-image.jpg' }
    //                 });
    //                 return () => {};
    //             }
    //         }
    //     }));
    //     const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
    //     render(ImageForm, { filename: 'test-image.jpg' });
    //     await waitFor(() => expect(screen.queryByText('Loading metadata for test-image.jpg...')).not.toBeInTheDocument());
    //     expect(screen.getByAltText('Test Image')).toBeInTheDocument();
    //     expect(screen.getByDisplayValue('test-image.jpg')).toBeInTheDocument();
    //     expect(screen.getByDisplayValue('Test Image')).toBeInTheDocument();
    //     expect(screen.getByDisplayValue('A test image description')).toBeInTheDocument();
    //     expect(screen.getByLabelText('featured')).toBeChecked();
    //     expect(screen.getByLabelText('priority')).toHaveValue(5);
    // }, 10000);

      it('loads and displays image metadata when filename is provided', async () => {
    vi.resetModules();

    // Define mock functions at the top level so they can be asserted later
    const goto = vi.fn();

    // 1. Mock global fetch *before* importing the component
    vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (url === '/api/images/compare') {
            return Promise.resolve(new Response(JSON.stringify({
                inBoth: ['test-image.jpg', 'another-image.png'],
                inAssetsOnly: []
            }), { status: 200 }));
        }
        if (url === '/api/schema') {
            return Promise.resolve(new Response(JSON.stringify({
                file_name: { type: 'string', removable: false },
                image_name: { type: 'string', removable: false },
                description: { type: 'string', removable: true },
                featured: { type: 'boolean', removable: true },
                priority: { type: 'number', removable: true },
                last_modified: { type: 'string', removable: false }
            }), { status: 200 }));
        }
        if (url === '/api/images/metadata/test-image.jpg') {
            return Promise.resolve(new Response(JSON.stringify({
                file_name: 'test-image.jpg',
                image_name: 'Test Image',
                description: 'A test image description',
                featured: true,
                priority: 5,
                last_modified: new Date().toISOString()
            }), { status: 200 }));
        }
        // Default catch-all for other fetches
        return Promise.reject(new Error(`Unhandled fetch request: ${url}`));
    }));

    // 2. Create writable stores to mock $app/stores and $lib/stores/imageList
    const mockPageStore = writable({
        url: {
            searchParams: {
                get: (param: string) => param === 'view' ? 'linked' : null
            }
        },
        params: { filename: 'test-image.jpg' }
    });

    const mockFilteredImageListStore = writable([
        'test-image.jpg',
        'another-image.png'
    ]);

    // 3. Mock $app/stores to return our writable mockPageStore
    vi.doMock('$app/stores', () => ({
        page: mockPageStore
    }));

    // 4. Mock $app/navigation using the top-level 'goto' vi.fn()
    vi.doMock('$app/navigation', () => ({
        goto: goto // Use the 'goto' function declared outside this mock
    }));

    // 5. Mock $lib/stores/imageList to return our writable mockFilteredImageListStore
    vi.doMock('$lib/stores/imageList', () => ({
        filteredImageList: mockFilteredImageListStore
    }));

    // Now import Svelte component *after* all mocks are set up
    const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
    
    // Render the component
    render(ImageForm, { filename: 'test-image.jpg' });

    // Wait for the loading state to disappear.
    await waitFor(() => {
        expect(screen.queryByText('Loading metadata for test-image.jpg...')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    // Assert that the image details are displayed
    expect(screen.getByAltText('Test Image')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test-image.jpg')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test Image')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A test image description')).toBeInTheDocument();
    expect(screen.getByLabelText('featured')).toBeChecked();
    expect(screen.getByLabelText('priority')).toHaveValue(5); 

    // Test navigation buttons
    const prevButton = screen.getByText('← Previous');
    const nextButton = screen.getByText('Next →');

    // In this specific mock setup, 'test-image.jpg' is the first, so prev should be disabled
    expect(prevButton).toBeDisabled(); 
    expect(nextButton).toBeEnabled();

    // Click next and assert goto was called
    await userEvent.click(nextButton);
    expect(goto).toHaveBeenCalledWith('/edit/another-image.png?view=linked');

    }, 10000);

    it('submits form data and shows success message', async () => {
        vi.resetModules();
        vi.doMock('$app/stores', () => ({
            page: {
                subscribe: (callback: Function) => {
                    callback({
                        url: { searchParams: { get: (param: string) => param === 'view' ? 'linked' : null } },
                        params: { filename: 'test-image.jpg' }
                    });
                    return () => {};
                }
            }
        }));
        vi.mocked(global.fetch).mockImplementationOnce((url, options) => {
            if (url.toString().includes('/api/images/metadata/test-image.jpg') && options?.method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ success: true })
                } as Response);
            }
            return Promise.resolve({
                ok: false,
                json: () => Promise.resolve({ error: 'Not found' })
            } as Response);
        });
        const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
        render(ImageForm, { filename: 'test-image.jpg' });
        await waitFor(() => expect(screen.queryByText('Loading metadata for test-image.jpg...')).not.toBeInTheDocument());
        const nameInput = screen.getByDisplayValue('Test Image') as HTMLInputElement;
        await fireEvent.input(nameInput, { target: { value: 'Updated Test Image' } });
        const submitButton = screen.getByRole('button', { name: 'Save' });
        await fireEvent.click(submitButton);
        expect(screen.getByText('Saving...')).toBeInTheDocument();
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
            '/api/images/metadata/test-image.jpg',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('Updated Test Image')
            })
        ));
        expect(screen.getByText('Saved successfully!')).toBeInTheDocument();
        vi.advanceTimersByTime(3000);
        await waitFor(() => expect(screen.queryByText('Saved successfully!')).not.toBeInTheDocument());
    }, 10000);

    it('shows error message when form submission fails', async () => {
        vi.resetModules();
        vi.doMock('$app/stores', () => ({
            page: {
                subscribe: (callback: Function) => {
                    callback({
                        url: { searchParams: { get: (param: string) => param === 'view' ? 'linked' : null } },
                        params: { filename: 'test-image.jpg' }
                    });
                    return () => {};
                }
            }
        }));
        vi.mocked(global.fetch).mockImplementationOnce((url, options) => {
            if (url.toString().includes('/api/images/metadata/test-image.jpg') && options?.method === 'POST') {
                return Promise.resolve({
                    ok: false,
                    status: 500,
                    json: () => Promise.resolve({ error: 'Server error' })
                } as Response);
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockMetadata)
            } as Response);
        });
        const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
        render(ImageForm, { filename: 'test-image.jpg' });
        await waitFor(() => expect(screen.queryByText('Loading metadata for test-image.jpg...')).not.toBeInTheDocument());
        const submitButton = screen.getByRole('button', { name: 'Save' });
        await fireEvent.click(submitButton);
        await waitFor(() => expect(screen.getByText('Error saving metadata.')).toBeInTheDocument());
    }, 10000);

    it('navigates between images using prev/next buttons', async () => {
        vi.resetModules();
        vi.doMock('$app/stores', () => ({
            page: {
                subscribe: (callback: Function) => {
                    callback({
                        url: { searchParams: { get: (param: string) => param === 'view' ? 'linked' : null } },
                        params: { filename: 'test-image.jpg' }
                    });
                    return () => {};
                }
            }
        }));
        const { goto } = await import('$app/navigation');
        const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
        render(ImageForm, { filename: 'test-image.jpg' });
        await waitFor(() => expect(screen.queryByText('Loading metadata for test-image.jpg...')).not.toBeInTheDocument());
        const prevButton = screen.getByRole('button', { name: '← Previous' });
        const nextButton = screen.getByRole('button', { name: 'Next →' });
        await fireEvent.click(nextButton);
        expect(goto).toHaveBeenCalledWith('/edit/next-image.jpg?view=linked');
        await fireEvent.click(prevButton);
        expect(goto).toHaveBeenCalledWith('/edit/prev-image.jpg?view=linked');
    }, 10000);

    it('adds a new field to the schema', async () => {
        vi.resetModules();
        vi.doMock('$app/stores', () => ({
            page: {
                subscribe: (callback: Function) => {
                    callback({
                        url: { searchParams: { get: (param: string) => param === 'view' ? 'linked' : null } },
                        params: { filename: 'test-image.jpg' }
                    });
                    return () => {};
                }
            }
        }));
        vi.mocked(global.fetch).mockImplementationOnce((url, options) => {
            if (url.toString().includes('/api/schema') && options?.method === 'POST') {
                const updatedSchema = {
                    ...mockSchema,
                    new_field: { type: 'string', removable: true, defaultValue: 'New Value' }
                };
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ schema: updatedSchema })
                } as Response);
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockSchema)
            } as Response);
        });
        const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
        render(ImageForm, { filename: 'test-image.jpg' });
        await waitFor(() => expect(screen.queryByText('Loading metadata for test-image.jpg...')).not.toBeInTheDocument());
        const showFormButton = screen.getByRole('button', { name: 'Create New Field' });
        await fireEvent.click(showFormButton);
        await fireEvent.input(screen.getByLabelText('Field Name'), { target: { value: 'new_field' } });
        await fireEvent.input(screen.getByLabelText('Default Value'), { target: { value: 'New Value' } });
        const addFieldButton = screen.getByRole('button', { name: 'Add Field' });
        await fireEvent.click(addFieldButton);
        expect(global.fetch).toHaveBeenCalledWith(
            '/api/schema',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    fieldName: 'new_field',
                    fieldType: 'string',
                    defaultValue: 'New Value'
                })
            })
        );
        await waitFor(() => {
            expect(screen.queryByText('Create New Field')).toBeInTheDocument();
            expect(screen.queryByLabelText('Field Name')).not.toBeInTheDocument();
        });
    }, 10000);

    it('validates field name when creating new field', async () => {
        vi.resetModules();
        vi.doMock('$app/stores', () => ({
            page: {
                subscribe: (callback: Function) => {
                    callback({
                        url: { searchParams: { get: (param: string) => param === 'view' ? 'linked' : null } },
                        params: { filename: 'test-image.jpg' }
                    });
                    return () => {};
                }
            }
        }));
        const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
        render(ImageForm, { filename: 'test-image.jpg' });
        await waitFor(() => expect(screen.queryByText('Loading metadata for test-image.jpg...')).not.toBeInTheDocument());
        const showFormButton = screen.getByRole('button', { name: 'Create New Field' });
        await fireEvent.click(showFormButton);
        const addFieldButton = screen.getByRole('button', { name: 'Add Field' });
        await fireEvent.click(addFieldButton);
        expect(global.alert).toHaveBeenCalledWith('Field name is required.');
    }, 10000);

    it('deletes a field after confirmation', async () => {
        vi.resetModules();
        vi.doMock('$app/stores', () => ({
            page: {
                subscribe: (callback: Function) => {
                    callback({
                        url: { searchParams: { get: (param: string) => param === 'view' ? 'linked' : null } },
                        params: { filename: 'test-image.jpg' }
                    });
                    return () => {};
                }
            }
        }));
        vi.mocked(global.fetch).mockImplementationOnce((url, options) => {
            if (url.toString().includes('/api/schema') && options?.method === 'DELETE') {
                const updatedSchema = {
                    file_name: { type: 'string', removable: false },
                    image_name: { type: 'string', removable: false },
                    featured: { type: 'boolean', removable: true, defaultValue: false },
                    priority: { type: 'number', removable: true, defaultValue: 0 }
                };
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ success: true, schema: updatedSchema })
                } as Response);
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockSchema)
            } as Response);
        });
        const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
        render(ImageForm, { filename: 'test-image.jpg' });
        await waitFor(() => expect(screen.queryByText('Loading metadata for test-image.jpg...')).not.toBeInTheDocument());
        const descriptionField = screen.getByDisplayValue('A test image description');
        const descriptionLabel = descriptionField.closest('label');
        const deleteButton = descriptionLabel?.querySelector('.delete-field-btn') as HTMLElement;
        expect(deleteButton).toBeInTheDocument();
        await fireEvent.click(deleteButton);
        expect(global.confirm).toHaveBeenCalledWith(
            'Are you sure you want to delete the "description" field? This will remove it from all images.'
        );
        expect(global.fetch).toHaveBeenCalledWith(
            '/api/schema',
            expect.objectContaining({
                method: 'DELETE',
                body: JSON.stringify({ fieldName: 'description' })
            })
        );
        await waitFor(() => {
            expect(screen.queryByDisplayValue('A test image description')).not.toBeInTheDocument();
        });
    }, 10000);

    it('formats last modified timestamp correctly', async () => {
        vi.resetModules();
        vi.doMock('$app/stores', () => ({
            page: {
                subscribe: (callback: Function) => {
                    callback({
                        url: { searchParams: { get: (param: string) => param === 'view' ? 'linked' : null } },
                        params: { filename: 'test-image.jpg' }
                    });
                    return () => {};
                }
            }
        }));
        const now = new Date();
        const testCases = [
            { desc: 'just now', date: new Date(now.getTime() - 30 * 1000), expected: 'Just now' },
            { desc: 'minutes ago', date: new Date(now.getTime() - 10 * 60 * 1000), expected: '10 minutes ago' },
            { desc: 'hours ago', date: new Date(now.getTime() - 3 * 60 * 60 * 1000), expected: '3 hours ago' },
            { desc: 'days ago', date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), expected: '2 days ago' }
        ];
        const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
        for (const testCase of testCases) {
            const testMetadata = { ...mockMetadata, last_modified: testCase.date.toISOString() };
            vi.mocked(global.fetch).mockImplementationOnce((url) => {
                if (url.toString().includes('/api/images/metadata/test-image.jpg')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(testMetadata)
                    } as Response);
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockSchema)
                } as Response);
            });
            const { unmount } = render(ImageForm, { filename: 'test-image.jpg' });
            await waitFor(() => expect(screen.queryByText('Loading metadata for test-image.jpg...')).not.toBeInTheDocument());
            expect(screen.getByText(`Last modified ${testCase.expected}`)).toBeInTheDocument();
            unmount();
        }
    }, 10000);

    it('renders appropriate input elements for different field types', async () => {
        vi.resetModules();
        vi.doMock('$app/stores', () => ({
            page: {
                subscribe: (callback: Function) => {
                    callback({
                        url: { searchParams: { get: (param: string) => param === 'view' ? 'linked' : null } },
                        params: { filename: 'test-image.jpg' }
                    });
                    return () => {};
                }
            }
        }));
        const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
        render(ImageForm, { filename: 'test-image.jpg' });
        await waitFor(() => expect(screen.queryByText('Loading metadata for test-image.jpg...')).not.toBeInTheDocument());
        const stringInput = screen.getByDisplayValue('Test Image');
        expect(stringInput).toHaveAttribute('type', 'text');
        const boolInput = screen.getByLabelText('featured') as HTMLInputElement;
        expect(boolInput).toHaveAttribute('type', 'checkbox');
        expect(boolInput).toBeChecked();
        const numInput = screen.getByLabelText('priority');
        expect(numInput).toHaveAttribute('type', 'number');
        expect(numInput).toHaveValue(5);
    }, 10000);

    it('uses filtered list for navigation when available', async () => {
        vi.resetModules();
        vi.doMock('$app/stores', () => ({
            page: {
                subscribe: (callback: Function) => {
                    callback({
                        url: { searchParams: { get: (param: string) => param === 'view' ? 'linked' : null } },
                        params: { filename: 'test-image.jpg' }
                    });
                    return () => {};
                }
            }
        }));
        mockFilteredList.length = 0;
        mockFilteredList.push('filtered1.jpg', 'test-image.jpg', 'filtered3.jpg');
        const { goto } = await import('$app/navigation');
        const { default: ImageForm } = await import('../../src/lib/components/ImageForm.svelte');
        render(ImageForm, { filename: 'test-image.jpg' });
        await waitFor(() => expect(screen.queryByText('Loading metadata for test-image.jpg...')).not.toBeInTheDocument());
        const nextButton = screen.getByRole('button', { name: 'Next →' });
        await fireEvent.click(nextButton);
        expect(goto).toHaveBeenCalledWith('/edit/filtered3.jpg?view=linked');
        const prevButton = screen.getByRole('button', { name: '← Previous' });
        await fireEvent.click(prevButton);
        expect(goto).toHaveBeenCalledWith('/edit/filtered1.jpg?view=linked');
    }, 10000);
});