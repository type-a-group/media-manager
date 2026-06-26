<script lang="ts">
	import {
		Image,
		Camera,
		Film,
		Clapperboard,
		Video,
		Music,
		Headphones,
		FileAudio,
		FileText,
		Newspaper,
		Book,
		Quote,
		Tag,
		Bookmark,
		Hash,
		Flag,
		Star,
		Heart,
		Sparkles,
		Trophy,
		Target,
		Rocket,
		Folder,
		FolderOpen,
		Box,
		Package,
		Layers,
		Shapes,
		List,
		Database,
		Code,
		Link,
		Globe,
		MapPin,
		Calendar,
		Users,
		Mail,
		Phone,
		Palette,
		Brain,
		Wrench,
		Briefcase,
		GraduationCap,
		Gamepad2,
		Utensils,
		ShoppingCart,
		Plane,
		Car,
		House,
		type Icon as LucideIcon
	} from 'lucide-svelte';
	import { resolveIconId, type IconId } from '$lib/core/icons.js';

	/**
	 * Renders a per-entity icon (class / record type) from a stored {@link IconId}. The single owner of
	 * the id→Lucide-component map that pairs with `core/icons.ts` (the assignable-id source of truth);
	 * every render surface (rails, header, command palette, grid chips) goes through this so the mapping
	 * lives in exactly one place. An unknown/absent `name` falls back to the caller's generic glyph.
	 *
	 * @param name - The stored icon id (may be undefined/unknown — then `fallback` is used).
	 * @param fallback - The generic glyph for this surface when `name` is missing/unknown (e.g. `tag`
	 *   for classes, `file-text` for record types).
	 * @param class - Extra classes for sizing/color (defaults to `size-4`).
	 */
	let {
		name,
		fallback,
		class: className = 'size-4'
	}: {
		name?: string | null;
		fallback: IconId;
		class?: string;
	} = $props();

	const MAP: Record<IconId, typeof LucideIcon> = {
		image: Image,
		camera: Camera,
		film: Film,
		clapperboard: Clapperboard,
		video: Video,
		music: Music,
		headphones: Headphones,
		'file-audio': FileAudio,
		'file-text': FileText,
		newspaper: Newspaper,
		book: Book,
		quote: Quote,
		tag: Tag,
		bookmark: Bookmark,
		hash: Hash,
		flag: Flag,
		star: Star,
		heart: Heart,
		sparkles: Sparkles,
		trophy: Trophy,
		target: Target,
		rocket: Rocket,
		folder: Folder,
		'folder-open': FolderOpen,
		box: Box,
		package: Package,
		layers: Layers,
		shapes: Shapes,
		list: List,
		database: Database,
		code: Code,
		link: Link,
		globe: Globe,
		'map-pin': MapPin,
		calendar: Calendar,
		users: Users,
		mail: Mail,
		phone: Phone,
		palette: Palette,
		brain: Brain,
		wrench: Wrench,
		briefcase: Briefcase,
		'graduation-cap': GraduationCap,
		'gamepad-2': Gamepad2,
		utensils: Utensils,
		'shopping-cart': ShoppingCart,
		plane: Plane,
		car: Car,
		house: House
	};

	const Cmp = $derived(MAP[resolveIconId(name, fallback)]);
</script>

<Cmp class={className} />
