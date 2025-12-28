import React, { useState, useRef, useEffect } from 'react';
import { useSessionAutocomplete, AutocompleteItem } from '../hooks/useSessionAutocomplete';
import { Search, History } from 'lucide-react';

interface AutocompleteInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    storageKey: string;
    label?: string;
    onValueChange?: (value: string) => void;
    executionData?: Record<string, any>;
}

export function AutocompleteInput({
    storageKey,
    label,
    onValueChange,
    executionData,
    className = '',
    ...props
}: AutocompleteInputProps) {
    const { addItem, getSuggestions: getHistorySuggestions } = useSessionAutocomplete(storageKey);
    const [isOpen, setIsOpen] = useState(false);
    const [inputValue, setInputValue] = useState(props.value?.toString() || '');
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync internal state with props
    useEffect(() => {
        if (props.value !== undefined) {
            setInputValue(props.value.toString());
        }
    }, [props.value]);

    const getSuggestions = (query: string) => {
        // 1. Check for $node("...") pattern
        const nodeMatch = query.match(/\$node\(['"]([^'"]+)['"]\)\.?$/);
        const nodeMatchWithDot = query.match(/\$node\(['"]([^'"]+)['"]\)\.([a-zA-Z0-9_]*)$/);

        // Debug log
        // console.log('Autocomplete Query:', query, 'Execution Data:', executionData);

        if (executionData && (nodeMatch || nodeMatchWithDot)) {
            const nodeId = nodeMatch ? nodeMatch[1] : nodeMatchWithDot![1];
            const partialKey = nodeMatchWithDot ? nodeMatchWithDot[2] : '';

            // Find node data
            const nodeResult = executionData[nodeId];
            if (nodeResult?.data) {
                const keys = Object.keys(nodeResult.data);
                return keys
                    .filter(key => key.toLowerCase().includes(partialKey.toLowerCase()))
                    .map(key => ({
                        value: `$node("${nodeId}").${key}`,
                        label: `.${key}`,
                        type: 'node' as const,
                        metadata: { value: nodeResult.data[key] }
                    }));
            }
        }

        // 2. Check for input. pattern
        const inputMatch = query.match(/input\.([a-zA-Z0-9_]*)$/);
        if (inputMatch) {
            // "input" usually refers to the parent node(s) output.
            // In this simple context, we might not know exactly WHICH node is the parent without more graph info.
            // But if we did, we could autocomplete here too.
            // For now, fall back to history.
        }

        // 3. Default: History
        return getHistorySuggestions(query);
    };

    const suggestions = getSuggestions(inputValue);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (inputValue.trim()) {
                addItem({
                    value: inputValue,
                    label: inputValue,
                    type: 'history',
                    metadata: { timestamp: Date.now() }
                });
                setIsOpen(false);
                onValueChange?.(inputValue);
            }
        }
    };

    const handleSelect = (item: AutocompleteItem) => {
        setInputValue(item.value);
        onValueChange?.(item.value);
        setIsOpen(false);
        inputRef.current?.focus();
    };

    return (
        <div className={`relative ${className}`} ref={wrapperRef}>
            {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    {...props}
                    value={inputValue}
                    onChange={(e) => {
                        setInputValue(e.target.value);
                        onValueChange?.(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onKeyDown={(e) => {
                        handleKeyDown(e);
                        props.onKeyDown?.(e);
                    }}
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-400">
                    <Search className="w-4 h-4" />
                </div>
            </div>

            {isOpen && (suggestions.length > 0 || inputValue) && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
                    {suggestions.length > 0 ? (
                        <ul className="py-1">
                            {suggestions.map((item, index) => (
                                <li
                                    key={`${item.value}-${index}`}
                                    className="px-4 py-2 hover:bg-gray-100 cursor-pointer flex items-center gap-2"
                                    onClick={() => handleSelect(item)}
                                >
                                    <History className="w-3 h-3 text-gray-400" />
                                    <div className="flex flex-col">
                                        <span className="text-sm text-gray-800">{item.label || item.value}</span>
                                        {item.metadata?.value !== undefined && (
                                            <span className="text-xs text-gray-500">Value: {JSON.stringify(item.metadata.value)}</span>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="px-4 py-2 text-sm text-gray-500">
                            Press Enter to save this value
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
