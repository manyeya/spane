'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

export function FinalCTA() {
    return (
        <section className="w-full py-32 px-6">
            <div className="mx-auto max-w-4xl relative overflow-hidden rounded-[3rem] border border-zinc-800 bg-linear-to-b from-zinc-900 to-black p-12 text-center sm:p-24">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 h-1 w-24 bg-blue-500 rounded-full blur-sm" />

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                >
                    <h2 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
                        Start Processing <br /> at <span className="text-blue-500">Scale.</span>
                    </h2>
                    <p className="mt-8 text-lg text-zinc-400 max-w-xl mx-auto">
                        Join developers building high-performance workflow systems with SPANE.
                        Open source, MIT licensed, and ready for your next project.
                    </p>

                    <div className="mt-12 flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
                        <Link
                            href="/docs/getting-started"
                            className="w-full sm:w-auto rounded-full bg-white px-10 py-4 font-bold text-black transition-transform hover:scale-105 active:scale-95"
                        >
                            Get Started Now
                        </Link>
                        <Link
                            href="https://github.com/manyeya/spane"
                            className="text-zinc-400 hover:text-white transition-colors font-medium underline underline-offset-8"
                        >
                            View Documentation
                        </Link>
                    </div>
                </motion.div>

                {/* Decorative elements */}
                <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-blue-500/10 blur-[100px]" />
                <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-purple-500/10 blur-[100px]" />
            </div>
        </section>
    );
}
