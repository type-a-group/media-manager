// import { render, fireEvent, waitFor, screen } from '@testing-library/svelte';
// import { get } from 'svelte/store';
// import Sidebar from '../../src/lib/components/Sidebar.svelte';
// import { filteredImageList } from '../../src/lib/stores/imageList';
// import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
// // import '@testing-library/jest-dom';

// /**
//  * Mock the Svelte page store to simulate URL parameters
//  */
// vi.mock('$app/stores', () => ({
//   page: {
//     subscribe: (callback: Function) => {
//       callback({ url: { searchParams: { get: () => 'linked' } } });
//       return () => {};
//     }
//   }
// }));

// /**
//  * Mock the filteredImageList store with proper subscribe and set methods
//  * This simulates the Svelte store behavior for testing purposes
//  */
// const mockFilteredList: string[] = [];
// vi.mock('$lib/stores/imageList', () => ({
//   filteredImageList: {
//     set: vi.fn((list: string[]) => {
//       mockFilteredList.length = 0;
//       mockFilteredList.push(...list);
//     }),
//     subscribe: vi.fn((callback: Function) => {
//       callback(mockFilteredList);
//       return () => {};
//     })
//   }
// }));

// describe('Sidebar.svelte', () => {
//   // Setup fetch mock
//   const originalFetch = global.fetch;

//   beforeEach(() => {
//     vi.resetAllMocks();
//     global.fetch = vi.fn();
    
//     // Default mock responses for fetch
//     vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
//       const urlStr = (input instanceof Request ? input.url : input.toString());

//       if (urlStr.includes('/api/images/compare')) {
//         return Promise.resolve({
//           ok: true,
//           json: () => Promise.resolve({
//             inBoth: ['image1.jpg', 'image2.png'],
//             inAssetsOnly: ['image3.gif']
//           })
//         } as Response);
//       }
      
//       if (urlStr.includes('/api/schema')) {
//         return Promise.resolve({
//           ok: true,
//           json: () => Promise.resolve({
//             file_name: { type: 'string', removable: false },
//             image_name: { type: 'string', removable: false }
//           })
//         } as Response);
//       }
      
//       if (urlStr.includes('/api/images/metadata/')) {
//         return Promise.resolve({
//           ok: true,
//           json: () => Promise.resolve({
//             file_name: 'image1.jpg',
//             image_name: 'Custom Name'
//           })
//         } as Response);
//       }
      
//       return Promise.resolve({
//         ok: false,
//         status: 404,
//         json: () => Promise.resolve({ error: 'Not found' })
//       } as Response);
//     });
    
//     // Mock confirm dialog
//     global.confirm = vi.fn(() => true);
//     // Mock alert dialog
//     global.alert = vi.fn();
//   });
  
//   afterEach(() => {
//     global.fetch = originalFetch;
//   });

//   /**
//    * Test that the sidebar initially shows loading state before data is loaded
//    */
//   it('renders with initial loading state', async () => {
//     render(Sidebar);
//     expect(screen.getByText('Loading...')).toBeInTheDocument();
//   });

//   /**
//    * Test that the sidebar displays image filenames after data is fetched
//    */
//   it('displays image filenames after fetch completes', async () => {
//     render(Sidebar);
    
//     // Wait for the loading to complete and data to be displayed
//     await waitFor(() => {
//       expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
//     });
    
//     expect(screen.getByText('image1.jpg')).toBeInTheDocument();
//     expect(screen.getByText('image2.png')).toBeInTheDocument();
//   });

//   /**
//    * Test that switching views (linked/unlinked) updates the displayed list
//    */
//   it('switches between linked and unlinked views', async () => {
//     render(Sidebar);
    
//     // Wait for initial data load
//     await waitFor(() => {
//       expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
//     });
    
//     // Initially in linked view, should show 'inBoth' images
//     expect(screen.getByText('image1.jpg')).toBeInTheDocument();
    
//     // Click to switch to unlinked view
//     await fireEvent.click(screen.getByText('Unlinked'));
    
//     // Should update the filteredImageList store with unlinked images
//     expect(vi.mocked(filteredImageList.set)).toHaveBeenCalledWith(['image3.gif']);
//   });

//   /**
//    * Test that search functionality filters the images correctly
//    */
//   it('filters images when search query is entered', async () => {
//     // Specific mock for search
//     vi.mocked(global.fetch).mockImplementationOnce((url) => {
//       if (url.toString().includes('query=image1')) {
//         return Promise.resolve({
//           ok: true,
//           json: () => Promise.resolve({
//             inBoth: ['image1.jpg'],
//             inAssetsOnly: []
//           })
//         } as Response);
//       }
//       return Promise.resolve({
//         ok: true,
//         json: () => Promise.resolve({
//           inBoth: ['image1.jpg', 'image2.png'],
//           inAssetsOnly: ['image3.gif']
//         })
//       } as Response);
//     });

//     render(Sidebar);
    
//     // Wait for initial data load
//     await waitFor(() => {
//       expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
//     });
    
//     // Enter search query
//     const searchInput = screen.getByLabelText('Search');
//     await fireEvent.input(searchInput, { target: { value: 'image1' } });
    
//     // Should make a fetch request with the search query
//     expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('query=image1'));
//   });

//   /**
//    * Test that the file upload functionality works
//    * This test simulates clicking the upload button and selecting a file
//    */
//   it('handles file upload process', async () => {
//     // Mock successful upload response
//     vi.mocked(global.fetch).mockImplementationOnce((url, options) => {
//       if (url.toString().includes('/api/images/upload')) {
//         return Promise.resolve({
//           ok: true,
//           json: () => Promise.resolve({
//             success: true,
//             message: 'Upload successful',
//             filename: 'newimage.jpg'
//           })
//         } as Response);
//       }
//       return Promise.resolve({
//         ok: true,
//         json: () => Promise.resolve({})
//       } as Response);
//     });

//     render(Sidebar);
    
//     // Wait for data load
//     await waitFor(() => {
//       expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
//     });
    
//     // Find and click the upload button (using title attribute)
//     const uploadBtn = screen.getByTitle('Upload new image');
//     await fireEvent.click(uploadBtn);
    
//     // Get the hidden file input by using its accept attribute
//     const fileInput = document.querySelector('input[accept="image/*"]') as HTMLInputElement;
//     expect(fileInput).toBeInTheDocument();
    
//     // Create a test file and trigger change event
//     const file = new File(['dummy content'], 'test-image.jpg', { type: 'image/jpeg' });
//     await fireEvent.change(fileInput, { target: { files: [file] } });
    
//     // Verify upload status message appears
//     await waitFor(() => {
//       expect(screen.getByText('Uploading...')).toBeInTheDocument();
//     });
    
//     // Check that FormData was properly used in the fetch call
//     expect(global.fetch).toHaveBeenCalledWith(
//       '/api/images/upload',
//       expect.objectContaining({
//         method: 'POST',
//         body: expect.any(FormData)
//       })
//     );
    
//     // Verify success message appears
//     await waitFor(() => {
//       expect(screen.getByText('✅ Upload successful')).toBeInTheDocument();
//     });
//   });

//   /**
//    * Test error handling during file upload
//    */
//   it('displays error message when upload fails', async () => {
//     // Mock failed upload response
//     vi.mocked(global.fetch).mockImplementationOnce((url, options) => {
//       if (url.toString().includes('/api/images/upload')) {
//         return Promise.resolve({
//           ok: false,
//           json: () => Promise.resolve({
//             success: false,
//             message: 'Invalid file type'
//           })
//         } as Response);
//       }
//       return Promise.resolve({
//         ok: true,
//         json: () => Promise.resolve({})
//       } as Response);
//     });

//     render(Sidebar);
    
//     // Wait for data load
//     await waitFor(() => {
//       expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
//     });
    
//     // Find and click the upload button
//     const uploadBtn = screen.getByTitle('Upload new image');
//     await fireEvent.click(uploadBtn);
    
//     // Get the hidden file input
//     const fileInput = document.querySelector('input[accept="image/*"]') as HTMLInputElement;
    
//     // Create a test file and trigger change event
//     const file = new File(['dummy content'], 'test-image.jpg', { type: 'image/jpeg' });
//     await fireEvent.change(fileInput, { target: { files: [file] } });
    
//     // Verify error message appears
//     await waitFor(() => {
//       expect(screen.getByText(/❌.*Invalid file type/)).toBeInTheDocument();
//     });
//   });

//   /**
//    * Test that toggling the sidebar collapse state works
//    */
//   it('collapses and expands when collapse button is clicked', async () => {
//     const { container } = render(Sidebar, { collapsed: false });
    
//     // Wait for data load
//     await waitFor(() => {
//       expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
//     });
    
//     // Find the collapse button
//     const collapseBtn = screen.getByTitle('Toggle sidebar');
    
//     // Initially sidebar should not be collapsed
//     expect(container.querySelector('.sidebar.collapsed')).not.toBeInTheDocument();
    
//     // Click to collapse
//     await fireEvent.click(collapseBtn);
    
//     // Sidebar should now be collapsed
//     expect(container.querySelector('.sidebar.collapsed')).toBeInTheDocument();
    
//     // Click again to expand
//     await fireEvent.click(collapseBtn);
    
//     // Sidebar should now be expanded
//     expect(container.querySelector('.sidebar.collapsed')).not.toBeInTheDocument();
//   });
// });