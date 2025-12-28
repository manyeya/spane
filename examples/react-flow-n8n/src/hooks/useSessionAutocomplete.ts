import { useState, useEffect, useCallback } from 'react';

export interface AutocompleteItem {
    value: string;
    label?: string;
    type?: 'variable' | 'function' | 'node' | 'history';
    metadata?: any;
}

export function useSessionAutocomplete(storageKey: string, maxItems: number = 50) {
    const [items, setItems] = useState<AutocompleteItem[]>([]);

    // Load from session storage on mount
    useEffect(() => {
        try {
            const stored = sessionStorage.getItem(storageKey);
            if (stored) {
                setItems(JSON.parse(stored));
            }
        } catch (e) {
            console.error('Failed to load autocomplete data', e);
        }
    }, [storageKey]);

    // Save item to history
    const addItem = useCallback((item: AutocompleteItem) => {
        setItems(prev => {
            // Remove duplicates
            const filtered = prev.filter(i => i.value !== item.value);
            // Add new item to top
            const newItems = [item, ...filtered].slice(0, maxItems);

            // Persist
            try {
                sessionStorage.setItem(storageKey, JSON.stringify(newItems));
            } catch (e) {
                console.error('Failed to save autocomplete data', e);
            }

            return newItems;
        });
    }, [storageKey, maxItems]);

    // Clear history
    const clearItems = useCallback(() => {
        setItems([]);
        sessionStorage.removeItem(storageKey);
    }, [storageKey]);

    // Filter items
    const getSuggestions = useCallback((query: string) => {
        if (!query) return items;
        const lowerQuery = query.toLowerCase();
        return items.filter(item =>
            item.value.toLowerCase().includes(lowerQuery) ||
            (item.label && item.label.toLowerCase().includes(lowerQuery))
        );
    }, [items]);

    return {
        items,
        addItem,
        clearItems,
        getSuggestions
    };
}
