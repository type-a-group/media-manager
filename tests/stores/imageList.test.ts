/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { filteredImageList } from '../../src/lib/stores/imageList';

describe('imageList store', () => {
  beforeEach(() => {
    // Reset the store to an empty array before each test
    filteredImageList.set([]);
  });

  it('should initialize with an empty array', () => {
    const value = get(filteredImageList);
    expect(value).toEqual([]);
  });

  it('should update the store value when set is called', () => {
    const testImages = ['image1.jpg', 'image2.jpg', 'image3.jpg'];
    filteredImageList.set(testImages);
    
    const value = get(filteredImageList);
    expect(value).toEqual(testImages);
    expect(value.length).toBe(3);
  });

  it('should contain the correct image filenames', () => {
    const testImages = ['test1.png', 'test2.jpg', 'test3.gif'];
    filteredImageList.set(testImages);
    
    const value = get(filteredImageList);
    expect(value).toContain('test1.png');
    expect(value).toContain('test2.jpg');
    expect(value).toContain('test3.gif');
  });

  it('should support updating with an empty array', () => {
    // First set some values
    filteredImageList.set(['image1.jpg', 'image2.jpg']);
    
    // Then clear it
    filteredImageList.set([]);
    
    const value = get(filteredImageList);
    expect(value).toEqual([]);
    expect(value.length).toBe(0);
  });

  it('should support subscription mechanism', () => {
    const mockCallback = vi.fn();
    
    // Subscribe to changes
    const unsubscribe = filteredImageList.subscribe(mockCallback);
    
    // Initial call is made when subscribing
    expect(mockCallback).toHaveBeenCalledWith([]);
    
    // Update the store
    filteredImageList.set(['new-image.jpg']);
    
    // Callback should have been called again
    expect(mockCallback).toHaveBeenCalledTimes(2);
    expect(mockCallback).toHaveBeenCalledWith(['new-image.jpg']);
    
    // Clean up the subscription
    unsubscribe();
    
    // Update again - callback should not be called
    filteredImageList.set(['another-image.jpg']);
    expect(mockCallback).toHaveBeenCalledTimes(2);
  });
});
