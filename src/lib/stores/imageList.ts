import { writable } from 'svelte/store';

export const filteredImageList = writable<string[]>([]);