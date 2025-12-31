'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

const nodes = [
    { id: 1, label: 'Trigger', x: '10%', y: '50%', delay: 0 },
    { id: 2, label: 'Fetch Data', x: '40%', y: '30%', delay: 1 },
    { id: 3, label: 'Validation', x: '40%', y: '70%', delay: 1.2 },
    { id: 4, label: 'Processor', x: '70%', y: '50%', delay: 2.5 },
    { id: 5, label: 'Output', x: '90%', y: '50%', delay: 3.5 },
];

const connections = [
    { from: 1, to: 2 },
    { from: 1, to: 3 },
    { from: 2, to: 4 },
    { from: 3, to: 4 },
    { from: 4, to: 5 },
];

export function WorkflowVisual() {
    return (
        <section className="w-full py-24 px-6">
            <div className="mx-auto max-w-6xl">
                <div className="mb-20 text-center">
                    <h2 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">
                        Orchestration, Visualised.
                    </h2>
                    <p className="mt-4 text-zinc-400 max-w-2xl mx-auto">
                        SPANE manages complex flows with parallel execution branches.
                        Watch tasks execute concurrently while maintaining strict dependency orders.
                    </p>
                </div>

                <div className="relative aspect-video w-full rounded-[2rem] border border-zinc-800 bg-linear-to-r from-zinc-950 to-black p-8 overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(59,130,246,0.1),transparent)]" />

                    <svg className="absolute inset-0 h-full w-full opacity-20">
                        {connections.map((conn, i) => {
                            const fromNode = nodes.find(n => n.id === conn.from)!;
                            const toNode = nodes.find(n => n.id === conn.to)!;
                            return (
                                <motion.line
                                    key={i}
                                    x1={fromNode.x}
                                    y1={fromNode.y}
                                    x2={toNode.x}
                                    y2={toNode.y}
                                    stroke="white"
                                    strokeWidth="1"
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    whileInView={{ pathLength: 1, opacity: 1 }}
                                    transition={{ delay: 0.5, duration: 1.5 }}
                                />
                            );
                        })}
                    </svg>

                    {nodes.map((node) => (
                        <motion.div
                            key={node.id}
                            style={{ left: node.x, top: node.y }}
                            initial={{ scale: 0, opacity: 0 }}
                            whileInView={{ scale: 1, opacity: 1 }}
                            transition={{ delay: node.delay * 0.2, type: 'spring' }}
                            className="absolute flex shrink-0 -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-4xl border border-zinc-800 bg-zinc-900/80 px-4 py-2 backdrop-blur-md"
                        >
                            <div className="relative h-2 w-2">
                                <div className="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-75" />
                                <div className="relative h-full w-full rounded-full bg-blue-500" />
                            </div>
                            <span className="text-sm font-medium text-zinc-200">{node.label}</span>
                        </motion.div>
                    ))}

                    {/* Data packet animation */}
                    <motion.div
                        animate={{
                            left: ['10%', '40%', '70%', '90%'],
                            top: ['50%', '30%', '50%', '50%'],
                        }}
                        transition={{
                            duration: 5,
                            repeat: Infinity,
                            ease: "linear",
                        }}
                        className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400 blur-sm shadow-[0_0_15px_rgba(96,165,250,0.8)]"
                    />
                </div>
            </div>
        </section>
    );
}
