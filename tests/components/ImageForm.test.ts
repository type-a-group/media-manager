/// <reference types="@testing-library/jest-dom" />
import { render, fireEvent, waitFor, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, beforeEach, expect } from 'vitest';
// jest-dom is imported in test/setup.ts
import ImageForm from '../../src/lib/components/ImageForm.svelte';

// Import the mock so we can reference it directly
import * as navigation from '$app/navigation';

// Mock $app/stores and $app/navigation
vi.mock('$app/stores', () => ({
  page: {
    subscribe: (fn: any) => {
      fn({ url: new URL('http://localhost/edit/ariel_nicholas_muffins_deceptionpass.jpg?view=linked') });
      return () => {};
    },
  },
}));
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
}));

// Mock filteredImageList store
vi.mock('../../src/lib/stores/imageList', () => ({
  filteredImageList: {
    subscribe: (fn: any) => {
      fn([]);
      return () => {};
    },
  },
}));

// Helper: mock fetch

// Simple mock for Response class
const createMockResponse = ({
  ok = true,
  status = 200,
  statusText = 'OK',
  headers = {},
  jsonData = undefined as any,
  blobData = undefined as any
} = {}) => {
  const mockResponse = {
    ok,
    status,
    statusText,
    headers: new Headers(headers),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    body: null,
    bodyUsed: false,
    json: () => Promise.resolve(jsonData),
    blob: () => Promise.resolve(blobData),
    text: () => Promise.resolve(jsonData ? JSON.stringify(jsonData) : ''),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    formData: () => Promise.resolve(new FormData()),
    clone: function() { return this; },
  };
  // Bypass type checking since we can't match the full Response interface
  return mockResponse as unknown as Response;
}

function setupFetchMocks({
  imageLists = { inBoth: ['ariel_nicholas_muffins_deceptionpass.jpg'], inAssetsOnly: [] },
  schema = {
    image_name: { type: 'string', removable: false },
    title: { type: 'string', removable: true },
    rating: { type: 'number', removable: true },
    published: { type: 'boolean', removable: true },
  },
  metadata = {
    image_name: 'ariel_nicholas_muffins_deceptionpass.jpg',
    title: 'Muffins at Deception Pass',
    rating: 5,
    published: true,
  },
  imageUrl = '/api/images/ariel_nicholas_muffins_deceptionpass.jpg',
  fail = {} as Record<string, boolean>,
} = {}) {
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    
    if (url.includes('/api/images/compare')) {
      return Promise.resolve(createMockResponse({ 
        ok: !fail.compare,
        jsonData: imageLists
      }));
    }
    
    if (url.includes('/api/schema')) {
      if (init?.method === 'DELETE') {
        if (fail.deleteField) {
          return Promise.resolve(createMockResponse({ 
            ok: false, 
            status: 400, 
            statusText: 'Bad Request',
            jsonData: { message: 'Delete error' }
          }));
        }
        return Promise.resolve(createMockResponse({ 
          ok: true,
          jsonData: { schema }
        }));
      }
      
      if (init?.method === 'POST') {
        if (fail.addField) {
          return Promise.resolve(createMockResponse({ 
            ok: false, 
            status: 400, 
            statusText: 'Bad Request',
            jsonData: { message: 'Add error' }
          }));
        }
        return Promise.resolve(createMockResponse({ 
          ok: true,
          jsonData: { schema }
        }));
      }
      
      return Promise.resolve(createMockResponse({ 
        ok: !fail.schema,
        jsonData: schema
      }));
    }
    
    if (url.includes('/api/images/metadata/')) {
      if (init?.method === 'POST') {
        if (fail.save) {
          return Promise.resolve(createMockResponse({ 
            ok: false, 
            status: 500, 
            statusText: 'Internal Server Error'
          }));
        }
        return Promise.resolve(createMockResponse({ ok: true }));
      }
      
      if (fail.metadata) {
        return Promise.resolve(createMockResponse({ 
          ok: false, 
          status: 404, 
          statusText: 'Not Found'
        }));
      }
      
      return Promise.resolve(createMockResponse({ 
        ok: true,
        jsonData: metadata
      }));
    }
    
    if (url.includes('/api/images/')) {
      return Promise.resolve(createMockResponse({ 
        ok: true,
        blobData: imageUrl
      }));
    }
    
    return Promise.resolve(createMockResponse({ 
      ok: false, 
      status: 404, 
      statusText: 'Not Found'
    }));
  }) as unknown as typeof global.fetch;
}

describe('ImageForm.svelte', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state when filename is provided but metadata is loading', async () => {
    setupFetchMocks({ metadata: undefined });
    render(ImageForm, { props: { filename: 'ariel_nicholas_muffins_deceptionpass.jpg' } });
    expect(screen.getByText(/Loading metadata for ariel_nicholas_muffins_deceptionpass.jpg/i)).toBeInTheDocument();
  });

  it('renders select image message when no filename', () => {
    setupFetchMocks();
    render(ImageForm, { props: { filename: null } });
    expect(screen.getByText(/Select an image from the sidebar/i)).toBeInTheDocument();
  });

  it('renders metadata form and image preview', async () => {
    setupFetchMocks();
    render(ImageForm, { props: { filename: 'ariel_nicholas_muffins_deceptionpass.jpg' } });
    await waitFor(() => {
      expect(screen.getByRole('img')).toHaveAttribute('src', '/api/images/ariel_nicholas_muffins_deceptionpass.jpg');
      expect(screen.getByText('ariel_nicholas_muffins_deceptionpass.jpg')).toBeInTheDocument();
      expect(screen.getByLabelText('title')).toBeInTheDocument();
      expect(screen.getByLabelText('rating')).toBeInTheDocument();
      expect(screen.getByLabelText('published')).toBeInTheDocument();
    });
  });

  it('renders correct input types for schema fields', async () => {
    setupFetchMocks();
    render(ImageForm, { props: { filename: 'ariel_nicholas_muffins_deceptionpass.jpg' } });
    await waitFor(() => {
      expect(screen.getByLabelText('title')).toHaveAttribute('type', 'text');
      expect(screen.getByLabelText('rating')).toHaveAttribute('type', 'number');
      expect(screen.getByLabelText('published')).toHaveAttribute('type', 'checkbox');
    });
  });

  it('saves metadata and shows success message', async () => {
    setupFetchMocks();
    render(ImageForm, { props: { filename: 'ariel_nicholas_muffins_deceptionpass.jpg' } });
    await waitFor(() => screen.getByText('Save'));
    await userEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByText('Saved successfully!')).toBeInTheDocument());
  });

  it('shows error message on failed save', async () => {
    setupFetchMocks({ fail: { save: true } });
    render(ImageForm, { props: { filename: 'ariel_nicholas_muffins_deceptionpass.jpg' } });
    await waitFor(() => screen.getByText('Save'));
    await userEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByText('Error saving metadata.')).toBeInTheDocument());
  });

  it('navigates to previous and next images', async () => {
    setupFetchMocks({ imageLists: { inBoth: ['a.jpg', 'b.jpg', 'c.jpg'], inAssetsOnly: [] }, metadata: { image_name: 'b.jpg', title: '', rating: 0, published: false } });
    render(ImageForm, { props: { filename: 'b.jpg' } });
    await waitFor(() => screen.getByText('b.jpg'));
    await userEvent.click(screen.getByText(/Previous/i));
    expect(navigation.goto).toHaveBeenCalledWith('/edit/a.jpg?view=linked');
    await userEvent.click(screen.getByText(/Next/i));
    expect(navigation.goto).toHaveBeenCalledWith('/edit/c.jpg?view=linked');
  });

  it('disables navigation buttons at boundaries', async () => {
    setupFetchMocks({ imageLists: { inBoth: ['a.jpg'], inAssetsOnly: [] }, metadata: { image_name: 'a.jpg', title: '', rating: 0, published: false } });
    render(ImageForm, { props: { filename: 'a.jpg' } });
    await waitFor(() => screen.getByText('a.jpg'));
    expect(screen.getByText(/Previous/i)).toBeDisabled();
    expect(screen.getByText(/Next/i)).toBeDisabled();
  });

  it('toggles new field form and adds a new field', async () => {
    setupFetchMocks();
    const { container } = render(ImageForm, { props: { filename: 'ariel_nicholas_muffins_deceptionpass.jpg' } });
    
    // Wait for the form to render first
    await waitFor(() => screen.getByText('ariel_nicholas_muffins_deceptionpass.jpg'));
    
    // Now interact with the button
    await userEvent.click(screen.getByRole('button', { name: 'Create New Field' }));
    
    // Check that the form appears
    expect(screen.getByText('Create New Field')).toBeInTheDocument();
    
    // Fill in the form
    await userEvent.type(screen.getByLabelText('Field Name'), 'newField');
    await userEvent.selectOptions(screen.getByLabelText('Field Type'), 'string');
    await userEvent.type(screen.getByLabelText('Default Value'), 'defaultValue');
    
    // Submit the form
    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }));
    
    // Wait for the form to disappear
    await waitFor(() => {
      // Check that the new field form is no longer visible
      const formHeader = screen.queryByText('Create New Field Form');
      expect(formHeader).not.toBeInTheDocument();
    });
  });

  it('shows error alert when adding field fails', async () => {
    setupFetchMocks({ fail: { addField: true } });
    window.alert = vi.fn();
    render(ImageForm, { props: { filename: 'ariel_nicholas_muffins_deceptionpass.jpg' } });
    
    // Wait for the component to render fully
    await waitFor(() => screen.getByText('ariel_nicholas_muffins_deceptionpass.jpg'));
    
    // Open the create field form
    await userEvent.click(screen.getByRole('button', { name: 'Create New Field' }));
    
    // Wait for the form to appear
    await waitFor(() => screen.getByText('Create New Field'));
    
    // Fill in the form
    await userEvent.type(screen.getByLabelText('Field Name'), 'badField');
    
    // Submit the form
    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }));
    
    // Check that alert was called with the error message
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Error adding field')));
  });

  it('deletes a field and updates schema', async () => {
    setupFetchMocks();
    window.confirm = vi.fn(() => true);
    render(ImageForm, { props: { filename: 'ariel_nicholas_muffins_deceptionpass.jpg' } });
    await waitFor(() => screen.getByLabelText('title'));
    await userEvent.click(screen.getAllByRole('button', { name: /🗑️/ })[0]);
    await waitFor(() => expect(screen.getByLabelText('title')).toBeInTheDocument());
  });

  it('shows error alert when deleting field fails', async () => {
    setupFetchMocks({ fail: { deleteField: true } });
    window.confirm = vi.fn(() => true);
    window.alert = vi.fn();
    render(ImageForm, { props: { filename: 'ariel_nicholas_muffins_deceptionpass.jpg' } });
    await waitFor(() => screen.getByLabelText('title'));
    await userEvent.click(screen.getAllByRole('button', { name: /🗑️/ })[0]);
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Error deleting field')));
  });

  it('prevents adding field with empty name', async () => {
    setupFetchMocks();
    window.alert = vi.fn();
    render(ImageForm, { props: { filename: 'ariel_nicholas_muffins_deceptionpass.jpg' } });
    
    // Wait for the component to render fully
    await waitFor(() => screen.getByText('ariel_nicholas_muffins_deceptionpass.jpg'));
    
    // Open the create field form
    await userEvent.click(screen.getByRole('button', { name: 'Create New Field' }));
    
    // Wait for the form to appear
    await waitFor(() => screen.getByText('Create New Field'));
    
    // Try to submit without entering a field name
    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }));
    
    // Check that alert was called with validation message
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Field name is required.'));
  });

  it('handles missing schema gracefully', async () => {
    setupFetchMocks({ schema: undefined });
    render(ImageForm, { props: { filename: 'ariel_nicholas_muffins_deceptionpass.jpg' } });
    await waitFor(() => expect(screen.queryByLabelText('title')).not.toBeInTheDocument());
  });

  it('handles missing imageLists gracefully', async () => {
    setupFetchMocks({ imageLists: undefined });
    render(ImageForm, { props: { filename: 'ariel_nicholas_muffins_deceptionpass.jpg' } });
    await waitFor(() => expect(screen.getByText('ariel_nicholas_muffins_deceptionpass.jpg')).toBeInTheDocument());
  });
});
