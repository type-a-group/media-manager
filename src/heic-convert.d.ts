/**
 * Ambient types for heic-convert (package ships without bundled typings here).
 * Used by the media-type upload route for HEIC → JPEG conversion.
 */
declare module 'heic-convert' {
	function convert(options: {
		buffer: ArrayBufferLike;
		format: 'JPEG' | 'PNG';
		quality?: number;
	}): Promise<ArrayBuffer | Uint8Array>;
	export default convert;
}
