<script lang="ts">
	import BasePopup from './BasePopup.svelte';
	
	/**
	 * MetadataPopup component for displaying image file metadata
	 * 
	 * @param isOpen - Controls whether the popup is visible
	 * @param filename - The filename of the image to fetch metadata for
	 * @param onClose - Callback function to close the popup
	 * 
	 * Features:
	 * - Fetches actual image file metadata using sharp library
	 * - Displays comprehensive metadata including EXIF data, dimensions, file info
	 * - Modal overlay with click-outside-to-close functionality
	 * - Responsive design with scrollable content
	 * - Loading states and error handling
	 * 
	 * #NOTE: Future concerns:
	 * - Performance: Large images may take time to process metadata
	 * - UI/UX: Could add tabs for different metadata categories
	 * - Accessibility: Could improve keyboard navigation and screen reader support
	 * - Export functionality: Could add button to export metadata as JSON
	 */
	
	let { isOpen = $bindable(), filename = null, onClose = () => {} } = $props<{
		isOpen: boolean;
		filename: string | null;
		onClose: () => void;
	}>();
	
	let metadata = $state<Record<string, any> | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	
	/**
	 * Fetch metadata from the API when filename changes
	 * Handles loading states and error cases
	 * 
	 * @param filename - The image filename to fetch metadata for
	 */
	async function fetchMetadata(filename: string) {
		loading = true;
		error = null;
		metadata = null;
		
		try {
			const response = await fetch(`/api/images/file-metadata/${filename}`);
			
			if (!response.ok) {
				throw new Error(`Failed to fetch metadata: ${response.status}`);
			}
			
			metadata = await response.json();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch metadata';
			console.error('Error fetching metadata:', err);
		} finally {
			loading = false;
		}
	}
	

	
	/**
	 * Format a value for display, handling various data types
	 * 
	 * @param value - The value to format
	 * @returns Formatted string representation
	 */
	function formatValue(value: any): string {
		if (value === null || value === undefined) {
			return 'N/A';
		}
		
		if (typeof value === 'boolean') {
			return value ? 'Yes' : 'No';
		}
		
		if (value instanceof Date) {
			return value.toLocaleString();
		}
		
		if (typeof value === 'object') {
			return JSON.stringify(value, null, 2);
		}
		
		return String(value);
	}
	
	/**
	 * Get display label for metadata keys
	 * Converts camelCase to readable format
	 * 
	 * @param key - The metadata key
	 * @returns Human-readable label
	 */
	function getDisplayLabel(key: string): string {
		const labelMap: Record<string, string> = {
			filename: 'Filename',
			fileSize: 'File Size (bytes)',
			fileSizeFormatted: 'File Size',
			dateCreated: 'Date Created',
			dateModified: 'Date Modified',
			width: 'Width',
			height: 'Height',
			format: 'Format',
			density: 'Density (DPI)',
			channels: 'Channels',
			depth: 'Bit Depth',
			space: 'Color Space',
			hasAlpha: 'Has Alpha Channel',
			hasProfile: 'Has Color Profile',
			exif: 'EXIF Data',
			orientation: 'Orientation',
			compression: 'Compression',
			resolutionUnit: 'Resolution Unit',
			isProgressive: 'Progressive',
			pages: 'Pages',
			pageHeight: 'Page Height',
			loop: 'Loop',
			delay: 'Delay',
			aspectRatio: 'Aspect Ratio',
			megapixels: 'Megapixels'
		};
		
		return labelMap[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
	}
	
	// Fetch metadata when filename changes and popup is open
	$effect(() => {
		if (isOpen && filename) {
			fetchMetadata(filename);
		}
	});
</script>

<BasePopup bind:show={isOpen} {onClose} title="Image Metadata" maxWidth="1000px">
	{#snippet children()}
				{#if loading}
					<div class="flex items-center justify-center py-8">
						<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
						<span class="ml-2 text-gray-600">Loading metadata...</span>
					</div>
				{:else if error}
					<div class="bg-red-50 border border-red-200 rounded-md p-4">
						<div class="flex">
							<svg class="w-5 h-5 text-red-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
								<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
							</svg>
							<div>
								<h3 class="text-sm font-medium text-red-800">Error loading metadata</h3>
								<p class="text-sm text-red-700 mt-1">{error}</p>
							</div>
						</div>
					</div>
				{:else if metadata}
					<div class="space-y-6">
						<!-- Info banner about image format -->
						<div class="bg-blue-50 border border-blue-200 rounded-md p-4">
							<div class="flex">
								<svg class="w-5 h-5 text-blue-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
									<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
								</svg>
								<div>
									<h3 class="text-sm font-medium text-blue-800">Image Format: {metadata.format?.toUpperCase()}</h3>
									<p class="text-sm text-blue-700 mt-1">
										{#if metadata.format === 'png'}
											PNG files typically contain basic image properties but limited EXIF data compared to JPEG files.
										{:else if metadata.format === 'jpeg' || metadata.format === 'jpg'}
											JPEG files can contain rich EXIF data including camera settings, GPS coordinates, and creation details.
										{:else}
											Metadata availability varies by image format and creation method.
										{/if}
									</p>
								</div>
							</div>
						</div>
						<!-- Basic Information -->
						<div>
							<h3 class="text-lg font-semibold text-gray-900 mb-3">Basic Information</h3>
							<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
								{#each ['filename', 'fileSizeFormatted', 'dateCreated', 'dateModified'] as key}
									{#if metadata[key] !== undefined}
										<div class="bg-gray-50 rounded-md p-3">
											<dt class="text-sm font-medium text-gray-600">{getDisplayLabel(key)}</dt>
											<dd class="text-sm text-gray-900 mt-1">{formatValue(metadata[key])}</dd>
										</div>
									{/if}
								{/each}
							</div>
						</div>
						
						<!-- Image Properties -->
						<div>
							<h3 class="text-lg font-semibold text-gray-900 mb-3">Image Properties</h3>
							<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
								{#each ['width', 'height', 'format', 'aspectRatio', 'megapixels', 'channels', 'depth', 'density'] as key}
									{#if metadata[key] !== undefined}
										<div class="bg-gray-50 rounded-md p-3">
											<dt class="text-sm font-medium text-gray-600">{getDisplayLabel(key)}</dt>
											<dd class="text-sm text-gray-900 mt-1">{formatValue(metadata[key])}</dd>
										</div>
									{/if}
								{/each}
							</div>
						</div>
						
						<!-- Color Information -->
						<div>
							<h3 class="text-lg font-semibold text-gray-900 mb-3">Color Information</h3>
							<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
								{#each ['space', 'hasAlpha', 'hasProfile', 'orientation'] as key}
									{#if metadata[key] !== undefined}
										<div class="bg-gray-50 rounded-md p-3">
											<dt class="text-sm font-medium text-gray-600">{getDisplayLabel(key)}</dt>
											<dd class="text-sm text-gray-900 mt-1">{formatValue(metadata[key])}</dd>
										</div>
									{/if}
								{/each}
							</div>
						</div>
						
						<!-- Technical Details -->
						<div>
							<h3 class="text-lg font-semibold text-gray-900 mb-3">Technical Details</h3>
							<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
								{#each ['compression', 'resolutionUnit', 'isProgressive', 'pages', 'pageHeight', 'loop', 'delay'] as key}
									{#if metadata[key] !== undefined}
										<div class="bg-gray-50 rounded-md p-3">
											<dt class="text-sm font-medium text-gray-600">{getDisplayLabel(key)}</dt>
											<dd class="text-sm text-gray-900 mt-1">{formatValue(metadata[key])}</dd>
										</div>
									{/if}
								{/each}
							</div>
						</div>
						
						<!-- EXIF Data -->
						<div>
							<h3 class="text-lg font-semibold text-gray-900 mb-3">EXIF Data</h3>
							{#if metadata.exif && Object.keys(metadata.exif).length > 0}
								<div class="bg-gray-50 rounded-md p-4">
									<pre class="text-sm text-gray-900 whitespace-pre-wrap">{formatValue(metadata.exif)}</pre>
								</div>
							{:else}
								<div class="bg-gray-50 border border-gray-200 rounded-md p-4">
									<div class="text-center">
										<svg class="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
										</svg>
										<p class="text-sm text-gray-500">No EXIF data available</p>
										<p class="text-xs text-gray-400 mt-1">
											{#if metadata.format === 'png'}
												PNG files typically don't contain traditional EXIF data
											{:else}
												This image may have been processed or edited, removing EXIF data
											{/if}
										</p>
									</div>
								</div>
							{/if}
						</div>
						
						<!-- Raw EXIF Data (Debug) -->
						<div>
							<h3 class="text-lg font-semibold text-gray-900 mb-3">Raw EXIF Data (Debug)</h3>
							{#if metadata.rawExif}
								<div class="bg-gray-50 rounded-md p-4">
									<div class="space-y-2">
										<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
											<div class="bg-white rounded-md p-3">
												<dt class="text-sm font-medium text-gray-600">Buffer Size</dt>
												<dd class="text-sm text-gray-900 mt-1">{metadata.rawExif.size} bytes</dd>
											</div>
											<div class="bg-white rounded-md p-3">
												<dt class="text-sm font-medium text-gray-600">Encoding</dt>
												<dd class="text-sm text-gray-900 mt-1">Base64</dd>
											</div>
										</div>
										<div class="mt-4">
											<dt class="text-sm font-medium text-gray-600 mb-2">Raw Buffer (Base64)</dt>
											<dd class="bg-white rounded-md p-3">
												<pre class="text-xs text-gray-700 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{metadata.rawExif.buffer}</pre>
											</dd>
										</div>
									</div>
								</div>
							{:else}
								<div class="bg-gray-50 border border-gray-200 rounded-md p-4">
									<div class="text-center">
										<svg class="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
										</svg>
										<p class="text-sm text-gray-500">No raw EXIF buffer available</p>
										<p class="text-xs text-gray-400 mt-1">This image format doesn't contain raw EXIF data</p>
									</div>
								</div>
							{/if}
						</div>
					</div>
				{:else}
					<div class="text-center py-8">
						<p class="text-gray-500">No metadata to display</p>
					</div>
				{/if}
	{/snippet}
</BasePopup>

<style>
	/* Content-specific styles are now handled by Tailwind CSS classes in the template */
</style> 