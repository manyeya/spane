'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { Github, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Hero() {
    return (
        <section className="relative flex min-h-[80vh] flex-col items-center justify-center overflow-hidden px-6 pt-20 pb-16 text-center">
            {/* Background decoration */}
            <div className="absolute inset-0 z-0">
                <div className="absolute top-1/2 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[120px]" />
                <div className="absolute top-1/4 left-1/3 h-[300px] w-[300px] rounded-full bg-purple-500/10 blur-[100px]" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="z-10 flex flex-col items-center"
            >
                <div className="mb-6 inline-flex items-center rounded-full border border-zinc-800 bg-zinc-950/50 px-3 py-1 text-sm font-medium text-zinc-400 backdrop-blur-sm">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                    Experimental Release v0.1.1
                </div>

                <h1 className="max-w-4xl bg-linear-to-b from-white to-zinc-500 bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-7xl lg:text-8xl">
                    Parallel Node Execution, <br />
                    <span className="text-white">Simplified.</span>
                </h1>

                <p className="mt-8 max-w-2xl text-lg text-zinc-400 sm:text-xl">
                    A high-performance workflow orchestration engine built on BullMQ and Redis.
                    Execute complex DAGs with parallel processing, retries, and native type safety.
                </p>

                <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
                    <Link
                        href="/docs/getting-started"
                        className="group relative flex items-center gap-2 overflow-hidden rounded-full bg-white px-8 py-3.5 text-black transition-transform hover:scale-105 active:scale-95"
                    >
                        <Play className="h-4 w-4 fill-current" />
                        <span className="font-semibold">Get Started</span>
                        <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
                    </Link>

                    <Link
                        href="https://github.com/manyeya/spane"
                        target="_blank"
                        className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-8 py-3.5 text-zinc-300 transition-colors hover:bg-zinc-900 active:scale-95"
                    >
                        <Github className="h-5 w-5" />
                        <span className="font-medium">GitHub</span>
                    </Link>
                </div>

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5, duration: 1 }}
                    className="mt-12 flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/50 p-1 pl-4 pr-2 backdrop-blur-sm"
                >
                    <code className="text-sm font-mono text-zinc-400">
                        <span className="text-blue-400">npm</span> install @manyeya/spane
                    </code>
                    <button
                        onClick={() => navigator.clipboard.writeText('npm install spane')}
                        className="rounded-xl bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 active:bg-zinc-700"
                    >
                        Copy
                    </button>
                </motion.div>
            </motion.div>

            {/* Grid Pattern */}
            <div className="absolute inset-0 z-[-1] opacity-20 mask-[radial-gradient(ellipse_at_center,black,transparent_75%)]">
                <div className="absolute inset-0 h-full w-full bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-size-[4rem_4rem]" />
            </div>
        </section>
    );
}
