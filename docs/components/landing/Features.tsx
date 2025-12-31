'use client';

import { motion } from 'framer-motion';
import { Zap, Share2, ShieldCheck, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';

const features = [
    {
        title: "Parallel Execution",
        description: "Built on BullMQ, SPANE natively handles thousands of parallel node executions across multiple workers.",
        icon: Zap,
        color: "text-yellow-500",
        bg: "bg-yellow-500/10"
    },
    {
        title: "DAG Orchestration",
        description: "Define complex Directed Acyclic Graphs simply. The engine handles all dependency logic and data flow.",
        icon: Share2,
        color: "text-blue-500",
        bg: "bg-blue-500/10"
    },
    {
        title: "Native Type Safety",
        description: "Written in TypeScript, providing full end-to-end type safety for node configurations and execution results.",
        icon: ShieldCheck,
        color: "text-green-500",
        bg: "bg-green-500/10"
    },
    {
        title: "Highly Extensible",
        description: "Create custom executors for any task. HTTP, Database, AI Workers, or anything you can code.",
        icon: Cpu,
        color: "text-purple-500",
        bg: "bg-purple-500/10"
    }
];

export function Features() {
    return (
        <section className="w-full py-24 px-6">
            <div className="mx-auto max-w-6xl">
                <div className="mb-16 text-center">
                    <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                        Built for Scale and Performance
                    </h2>
                    <p className="mt-4 text-zinc-400">
                        A minimalist engine that doesn't get in your way.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                    {features.map((feature, index) => (
                        <motion.div
                            key={feature.title}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: index * 0.1, duration: 0.5 }}
                            className="group relative rounded-3xl border border-zinc-800 bg-zinc-950 p-8 transition-colors hover:border-zinc-700"
                        >
                            <div className={cn("mb-6 flex h-12 w-12 items-center justify-center rounded-2xl", feature.bg)}>
                                <feature.icon className={cn("h-6 w-6", feature.color)} />
                            </div>
                            <h3 className="mb-3 text-lg font-semibold text-white">{feature.title}</h3>
                            <p className="text-sm leading-relaxed text-zinc-400">
                                {feature.description}
                            </p>

                            {/* Hover effect light */}
                            <div className="absolute inset-0 -z-10 rounded-3xl bg-white/5 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
