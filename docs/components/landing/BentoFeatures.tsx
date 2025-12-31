'use client';

import { motion } from 'framer-motion';
import { RefreshCw, Shield, Database, Activity, Zap, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
    {
        title: "Smart Retries",
        description: "Exponential backoff and configurable retry policies per node type.",
        icon: RefreshCw,
        className: "md:col-span-1 md:row-span-2",
        color: "text-purple-500"
    },
    {
        title: "Persistent State",
        description: "Full execution versioning with PostgreSQL/Drizzle integration. Never lose a workflow state again.",
        icon: Database,
        className: "md:col-span-2 md:row-span-1",
        color: "text-blue-500"
    },
    {
        title: "Real-time Events",
        description: "Pub/Sub event streaming via Redis. Monitor executions as they happen.",
        icon: Activity,
        className: "md:col-span-1 md:row-span-1",
        color: "text-green-500"
    },
    {
        title: "Circuit Breakers",
        description: "Protection for external services built natively into the engine processor.",
        icon: Shield,
        className: "md:col-span-1 md:row-span-2",
        color: "text-red-500"
    },
    {
        title: "Sub-Workflows",
        description: "Manage complexity by nesting workflows up to 10 levels deep with native parent-child dependencies.",
        icon: Layers,
        className: "md:col-span-2 md:row-span-1",
        color: "text-orange-500"
    }
];

export function BentoFeatures() {
    return (
        <section className="w-full py-24 px-6">
            <div className="mx-auto max-w-6xl">
                <div className="mb-16">
                    <h2 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">
                        Engineered for <span className="bg-linear-to-b from-blue-400 to-blue-600 bg-clip-text text-transparent italic">Reliability.</span>
                    </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {items.map((item, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, scale: 0.95 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.1 }}
                            className={cn(
                                "group relative overflow-hidden rounded-[2.5rem] border border-zinc-800 bg-zinc-950/50 p-8 backdrop-blur-sm transition-colors hover:border-zinc-700",
                                item.className
                            )}
                        >
                            <item.icon className={cn("mb-6 h-8 w-8", item.color)} />
                            <h3 className="mb-4 text-xl font-bold text-white">{item.title}</h3>
                            <p className="text-zinc-400 leading-relaxed">
                                {item.description}
                            </p>

                            {/* Decorative gradient */}
                            <div className="absolute inset-0 -z-10 bg-linear-to-br from-zinc-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
